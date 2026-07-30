import * as THREE from 'three';

import type {Controller} from '../input/Controller.js';
import {objectIsDescendantOf} from '../utils/SceneGraphUtils.js';
import {DirectTouch} from './DirectTouch.js';
import {GazeDwell} from './GazeDwell.js';
import {HitResolver} from './HitResolver.js';
import {
  DirectTouchInput,
  InteractionDependencies,
  InteractionManipulation,
  InteractionSourceSnapshot,
  RaySourceInput,
  ResolvedRay,
  SelectionCapture,
} from './InteractionTypes.js';
import {dispatchInteractionPath, isSelectionValid} from './InteractionUtils.js';
import {ReticlePresenter} from './ReticlePresenter.js';

type ActiveCapture =
  | {kind: 'none'}
  | {kind: 'auxiliary'}
  | {
      kind: 'target';
      selection: SelectionCapture;
      ancestry: readonly THREE.Object3D[];
    };

const NO_MANIPULATION: InteractionManipulation = {
  resolve: () => undefined,
  tryClaimScale: () => false,
  tryStart: () => false,
  update: () => {},
  end: () => {},
  cancelSource: () => {},
};

/** Owns ray target resolution, hover state, and balanced Select capture. */
export class Interaction {
  private readonly callbacks;
  private readonly manipulation;
  private readonly reticle;
  private readonly resolver;
  private readonly directTouch;
  private readonly gazeDwell = new GazeDwell();
  private readonly snapshots = new Map<Controller, InteractionSourceSnapshot>();
  private readonly resolvedRays = new Map<Controller, ResolvedRay>();
  private readonly hoverPaths = new Map<
    Controller,
    readonly THREE.Object3D[]
  >();
  private readonly captures = new Map<Controller, ActiveCapture>();
  private readonly suppressedUntilRelease = new Set<Controller>();

  constructor(dependencies: InteractionDependencies) {
    this.callbacks = dependencies.callbacks;
    this.manipulation = dependencies.manipulation ?? NO_MANIPULATION;
    this.reticle =
      dependencies.reticle ??
      new ReticlePresenter(dependencies.defaultReticleDistance);
    this.resolver = new HitResolver(this.callbacks, this.manipulation);
    this.directTouch = new DirectTouch({
      callbacks: this.callbacks,
      manipulation: this.manipulation,
      resolver: this.resolver,
      suspendRay: (controller) => this.suspendRayForDirectTouch(controller),
    });
  }

  /** Replaces the physical state for all ray sources in one frame. */
  updateRaySources(inputs: readonly RaySourceInput[], deltaSeconds = 0): void {
    const frameSnapshots: InteractionSourceSnapshot[] = [];
    const selectionEnds: Controller[] = [];
    for (const input of inputs) {
      if (this.directTouch.has(input.controller)) {
        this.resolvedRays.delete(input.controller);
        this.updateHoverPath(input.controller, []);
        this.reticle.clear(input.controller);
        continue;
      }

      const previousSelected =
        this.snapshots.get(input.controller)?.selected ?? false;
      let snapshot = this.createSnapshot(input);
      this.snapshots.set(input.controller, snapshot);

      if (!snapshot.selected) {
        this.suppressedUntilRelease.delete(input.controller);
      }

      const capture = this.captures.get(input.controller);
      if (capture?.kind === 'target' && !this.isCaptureValid(capture)) {
        this.cancelCapture(input.controller);
      }

      if (this.suppressedUntilRelease.has(input.controller)) {
        frameSnapshots.push(snapshot);
        this.resolvedRays.delete(input.controller);
        this.updateHoverPath(input.controller, []);
        this.reticle.clear(input.controller);
        continue;
      }

      const resolved = this.resolver.resolve(
        input.intersections,
        input.sourceType
      );
      let gazeCompleted = false;
      if (input.sourceType === 'gaze') {
        const dwell = this.gazeDwell.update(
          input.controller,
          resolved,
          deltaSeconds
        );
        snapshot = Object.freeze({
          ...snapshot,
          selectionProgress: dwell.progress,
        });
        this.snapshots.set(input.controller, snapshot);
        gazeCompleted = dwell.completed;
      } else {
        this.gazeDwell.remove(input.controller);
      }
      this.setResolvedRay(input.controller, snapshot, resolved);
      if (gazeCompleted) {
        this.beginSelection(input.controller);
        selectionEnds.push(input.controller);
      } else if (snapshot.selected !== previousSelected) {
        if (snapshot.selected) this.beginSelection(input.controller);
        else selectionEnds.push(input.controller);
      }
      frameSnapshots.push(snapshot);
    }

    this.manipulation.update(frameSnapshots);
    for (const snapshot of frameSnapshots) {
      if (snapshot.selected && this.captures.has(snapshot.controller)) {
        this.callbacks.invokeGlobal('onSelecting', {
          target: snapshot.controller,
        });
      }
    }
    for (const controller of selectionEnds) this.endSelection(controller);
  }

  private beginSelection(controller: Controller): void {
    if (this.directTouch.has(controller) || this.captures.has(controller))
      return;
    const snapshot = this.snapshots.get(controller);
    if (!snapshot) return;
    const selectedSnapshot = this.withSelected(snapshot, true);
    this.snapshots.set(controller, selectedSnapshot);
    const event = {target: controller};

    if (this.manipulation.tryClaimScale(selectedSnapshot)) {
      this.captures.set(controller, {kind: 'auxiliary'});
      this.callbacks.invokeGlobal('onSelectStart', event);
      return;
    }

    const resolved = this.resolvedRays.get(controller);
    if (!resolved?.target) {
      this.captures.set(controller, {kind: 'none'});
      this.callbacks.invokeGlobal('onSelectStart', event);
      return;
    }

    const selection: SelectionCapture = {
      source: controller,
      surface: resolved.surface,
      owner: resolved.manipulation?.owner ?? resolved.target,
      point: resolved.intersection.point.clone(),
      scriptPath: Object.freeze([...resolved.scriptPath]),
    };
    this.captures.set(controller, {
      kind: 'target',
      selection,
      ancestry: Object.freeze([...resolved.objectPath]),
    });
    dispatchInteractionPath(
      this.callbacks,
      selection.scriptPath,
      'onObjectSelectStart',
      event
    );
    if (resolved.manipulation) {
      this.manipulation.tryStart(selection, selectedSnapshot);
    }
    this.callbacks.invokeGlobal('onSelectStart', event);
  }

  private endSelection(controller: Controller): void {
    if (this.directTouch.has(controller)) return;
    const capture = this.captures.get(controller);
    if (!capture) return;
    this.captures.delete(controller);
    const snapshot = this.snapshots.get(controller);
    if (snapshot)
      this.snapshots.set(controller, this.withSelected(snapshot, false));
    const event = {target: controller};

    this.manipulation.end(controller);
    if (capture.kind === 'target') {
      dispatchInteractionPath(
        this.callbacks,
        capture.selection.scriptPath,
        'onObjectSelectEnd',
        event
      );
    }
    this.callbacks.invokeGlobal('onSelect', event);
    this.callbacks.invokeGlobal('onSelectEnd', event);
  }

  /** Replaces the physical direct-touch sources for one frame. */
  updateDirectTouches(inputs: readonly DirectTouchInput[]): void {
    this.directTouch.update(inputs);
  }

  /** Cancels a disconnected or disabled source and removes all stored state. */
  removeSource(controller: Controller): void {
    const hadTouch = this.directTouch.remove(controller);
    const hadCapture = this.captures.has(controller);
    this.cancelCapture(controller);
    if (!hadTouch && !hadCapture) this.manipulation.cancelSource(controller);
    this.updateHoverPath(controller, []);
    this.reticle.clear(controller);
    this.snapshots.delete(controller);
    this.resolvedRays.delete(controller);
    this.hoverPaths.delete(controller);
    this.gazeDwell.remove(controller);
    this.suppressedUntilRelease.delete(controller);
  }

  getSourceSnapshot(
    controller: Controller
  ): InteractionSourceSnapshot | undefined {
    return (
      this.directTouch.getSnapshot(controller) ?? this.snapshots.get(controller)
    );
  }

  getResolvedRay(controller: Controller): ResolvedRay | undefined {
    return this.resolvedRays.get(controller);
  }

  isPointingAt(object: THREE.Object3D): boolean {
    for (const resolved of this.resolvedRays.values()) {
      if (objectIsDescendantOf(resolved.surface, object)) return true;
    }
    return false;
  }

  isSelectingAt(object: THREE.Object3D): boolean {
    for (const capture of this.captures.values()) {
      if (
        capture.kind === 'target' &&
        objectIsDescendantOf(capture.selection.surface, object)
      ) {
        return true;
      }
    }
    return this.directTouch.isSelectingAt(object);
  }

  getIntersectionAt(
    object: THREE.Object3D,
    controller?: Controller
  ): THREE.Intersection | null {
    const resolvedRays = controller
      ? [this.resolvedRays.get(controller)]
      : this.resolvedRays.values();
    for (const resolved of resolvedRays) {
      if (resolved && objectIsDescendantOf(resolved.surface, object)) {
        return {
          ...resolved.intersection,
          point: resolved.intersection.point.clone(),
          normal: resolved.intersection.normal?.clone(),
          uv: resolved.intersection.uv?.clone(),
          uv1: resolved.intersection.uv1?.clone(),
        };
      }
    }
    return null;
  }

  isManipulating(object: THREE.Object3D): boolean {
    return this.manipulation.isManipulating?.(object) ?? false;
  }

  applyScaleIntent(controller: Controller, factor: number): boolean {
    const snapshot = this.snapshots.get(controller);
    const resolved = this.resolvedRays.get(controller);
    if (!snapshot || !resolved?.target) return false;
    const intentSnapshot = {...snapshot, sourceType: 'simulator' as const};
    return (
      this.manipulation.applyScaleIntent?.(
        {
          source: controller,
          surface: resolved.surface,
          owner: resolved.manipulation?.owner ?? resolved.target,
          point: resolved.intersection.point.clone(),
          scriptPath: resolved.scriptPath,
        },
        intentSnapshot,
        factor
      ) ?? false
    );
  }

  private createSnapshot(input: RaySourceInput): InteractionSourceSnapshot {
    const position = input.position?.clone() ?? new THREE.Vector3();
    const orientation = input.orientation?.clone() ?? new THREE.Quaternion();
    if (!input.position) input.controller.getWorldPosition(position);
    if (!input.orientation) input.controller.getWorldQuaternion(orientation);
    return Object.freeze({
      controller: input.controller,
      sourceType: input.sourceType,
      position,
      orientation,
      ray: input.ray.clone(),
      selected: input.sourceType === 'gaze' ? false : input.selected,
    });
  }

  private withSelected(
    snapshot: InteractionSourceSnapshot,
    selected: boolean
  ): InteractionSourceSnapshot {
    return Object.freeze({...snapshot, selected});
  }

  private setResolvedRay(
    controller: Controller,
    snapshot: InteractionSourceSnapshot,
    resolved: ResolvedRay | undefined
  ): void {
    if (resolved) this.resolvedRays.set(controller, resolved);
    else this.resolvedRays.delete(controller);
    this.updateHoverPath(controller, resolved?.scriptPath ?? []);
    this.reticle.present(snapshot, resolved);
  }

  private updateHoverPath(
    controller: Controller,
    nextPath: readonly THREE.Object3D[]
  ): void {
    const oldPath = this.hoverPaths.get(controller) ?? [];
    let oldIndex = oldPath.length - 1;
    let nextIndex = nextPath.length - 1;
    while (
      oldIndex >= 0 &&
      nextIndex >= 0 &&
      oldPath[oldIndex] === nextPath[nextIndex]
    ) {
      oldIndex--;
      nextIndex--;
    }

    dispatchInteractionPath(
      this.callbacks,
      oldPath.slice(0, oldIndex + 1),
      'onHoverExit',
      controller
    );
    dispatchInteractionPath(
      this.callbacks,
      nextPath.slice(0, nextIndex + 1),
      'onHoverEnter',
      controller
    );
    dispatchInteractionPath(this.callbacks, nextPath, 'onHovering', controller);

    if (nextPath.length > 0) this.hoverPaths.set(controller, nextPath);
    else this.hoverPaths.delete(controller);
  }

  private isCaptureValid(
    capture: Extract<ActiveCapture, {kind: 'target'}>
  ): boolean {
    return isSelectionValid(capture.selection, capture.ancestry);
  }

  private suspendRayForDirectTouch(controller: Controller): void {
    if (this.captures.has(controller)) this.cancelCapture(controller);
    this.suppressedUntilRelease.delete(controller);
    this.resolvedRays.delete(controller);
    this.updateHoverPath(controller, []);
    this.reticle.clear(controller);
  }

  private cancelCapture(controller: Controller): void {
    const capture = this.captures.get(controller);
    if (!capture) return;
    this.captures.delete(controller);
    this.manipulation.cancelSource(controller);
    if (capture.kind === 'target') {
      dispatchInteractionPath(
        this.callbacks,
        capture.selection.scriptPath,
        'onObjectSelectEnd',
        {target: controller}
      );
    }
    this.callbacks.invokeGlobal('onSelectEnd', {target: controller});
    this.suppressedUntilRelease.add(controller);
  }
}
