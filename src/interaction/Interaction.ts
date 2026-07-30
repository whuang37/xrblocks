import * as THREE from 'three';

import type {ObjectTouchEvent} from '../core/Script.js';
import type {Controller} from '../input/Controller.js';
import {objectIsDescendantOf} from '../utils/SceneGraphUtils.js';
import {HitResolver} from './HitResolver.js';
import {
  DirectTouchInput,
  InteractionDependencies,
  InteractionManipulation,
  InteractionSourceSnapshot,
  RaySourceInput,
  ResolvedRay,
  SelectionCapture,
  TargetedInteractionHook,
} from './InteractionTypes.js';
import {ReticlePresenter} from './ReticlePresenter.js';

type ActiveCapture =
  | {kind: 'none'}
  | {kind: 'auxiliary'}
  | {
      kind: 'target';
      selection: SelectionCapture;
      ancestry: readonly THREE.Object3D[];
    };

interface TouchCapture {
  readonly selection: SelectionCapture;
  readonly ancestry: readonly THREE.Object3D[];
  readonly resolved: ResolvedRay;
  readonly handIndex: number;
  point: THREE.Vector3;
  synthesized: boolean;
}

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
  private readonly snapshots = new Map<Controller, InteractionSourceSnapshot>();
  private readonly resolvedRays = new Map<Controller, ResolvedRay>();
  private readonly hoverPaths = new Map<
    Controller,
    readonly THREE.Object3D[]
  >();
  private readonly captures = new Map<Controller, ActiveCapture>();
  private readonly touchCaptures = new Map<Controller, TouchCapture>();
  private readonly suppressedUntilRelease = new Set<Controller>();

  constructor(dependencies: InteractionDependencies) {
    this.callbacks = dependencies.callbacks;
    this.manipulation = dependencies.manipulation ?? NO_MANIPULATION;
    this.reticle =
      dependencies.reticle ??
      new ReticlePresenter(dependencies.defaultReticleDistance);
    this.resolver = new HitResolver(this.callbacks, this.manipulation);
  }

  /** Replaces the physical state for all ray sources in one frame. */
  updateRaySources(inputs: readonly RaySourceInput[]): void {
    const frameSnapshots: InteractionSourceSnapshot[] = [];
    for (const input of inputs) {
      if (this.touchCaptures.has(input.controller)) {
        this.resolvedRays.delete(input.controller);
        this.updateHoverPath(input.controller, []);
        this.reticle.clear(input.controller);
        continue;
      }

      const snapshot = this.createSnapshot(input);
      this.snapshots.set(input.controller, snapshot);
      frameSnapshots.push(snapshot);

      if (!snapshot.selected) {
        this.suppressedUntilRelease.delete(input.controller);
      }

      const capture = this.captures.get(input.controller);
      if (capture?.kind === 'target' && !this.isCaptureValid(capture)) {
        this.cancelCapture(input.controller);
      }

      if (this.suppressedUntilRelease.has(input.controller)) {
        this.resolvedRays.delete(input.controller);
        this.updateHoverPath(input.controller, []);
        this.reticle.clear(input.controller);
        continue;
      }

      const resolved = this.resolver.resolve(
        input.intersections,
        input.sourceType
      );
      this.setResolvedRay(input.controller, snapshot, resolved);
    }

    this.manipulation.update(frameSnapshots);
    for (const snapshot of frameSnapshots) {
      if (snapshot.selected && this.captures.has(snapshot.controller)) {
        this.callbacks.invokeGlobal('onSelecting', {
          target: snapshot.controller,
        });
      }
    }
  }

  selectStart(controller: Controller): void {
    if (this.touchCaptures.has(controller) || this.captures.has(controller))
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
    this.dispatchPath(selection.scriptPath, 'onObjectSelectStart', event);
    if (resolved.manipulation) {
      this.manipulation.tryStart(selection, selectedSnapshot);
    }
    this.callbacks.invokeGlobal('onSelectStart', event);
  }

  selectEnd(controller: Controller): void {
    if (this.touchCaptures.has(controller)) return;
    const capture = this.captures.get(controller);
    if (!capture) return;
    this.captures.delete(controller);
    const snapshot = this.snapshots.get(controller);
    if (snapshot)
      this.snapshots.set(controller, this.withSelected(snapshot, false));
    const event = {target: controller};

    this.manipulation.end(controller);
    if (capture.kind === 'target') {
      this.dispatchPath(
        capture.selection.scriptPath,
        'onObjectSelectEnd',
        event
      );
    }
    this.callbacks.invokeGlobal('onSelect', event);
    this.callbacks.invokeGlobal('onSelectEnd', event);
  }

  /** Updates one fingertip contact and returns its captured physical surface. */
  updateDirectTouch(input: DirectTouchInput): THREE.Object3D | undefined {
    const resolved = this.resolver.resolve(input.intersections, 'direct-touch');
    let touch = this.touchCaptures.get(input.controller);
    touch?.point.copy(input.point);

    if (touch && !this.isSelectionValid(touch.selection, touch.ancestry)) {
      this.finishDirectTouch(input.controller, true);
      touch = undefined;
    } else if (
      touch &&
      (!resolved?.target ||
        (resolved.manipulation?.owner ?? resolved.target) !==
          touch.selection.owner)
    ) {
      this.finishDirectTouch(input.controller, false);
      touch = undefined;
    }

    if (!touch && resolved?.target) {
      touch = this.startDirectTouch(input, resolved);
    } else if (touch) {
      const snapshot = this.createDirectTouchSnapshot(input);
      this.snapshots.set(input.controller, snapshot);
      this.dispatchTouchPath(
        touch.selection.scriptPath,
        'onObjectTouching',
        touch.handIndex,
        input.point
      );
      if (touch.synthesized) {
        this.manipulation.update([snapshot]);
        this.callbacks.invokeGlobal('onSelecting', {
          target: input.controller,
        });
      }
    }

    return touch?.resolved.surface;
  }

  /** Cancels a fingertip contact when its hand or tracking source is lost. */
  removeDirectTouch(controller: Controller): void {
    this.finishDirectTouch(controller, true);
  }

  /** Cancels a disconnected or disabled source and removes all stored state. */
  removeSource(controller: Controller): void {
    const hadTouch = this.touchCaptures.has(controller);
    if (hadTouch) {
      this.finishDirectTouch(controller, true);
    }
    const hadCapture = this.captures.has(controller);
    this.cancelCapture(controller);
    if (!hadTouch && !hadCapture) this.manipulation.cancelSource(controller);
    this.updateHoverPath(controller, []);
    this.reticle.clear(controller);
    this.snapshots.delete(controller);
    this.resolvedRays.delete(controller);
    this.hoverPaths.delete(controller);
    this.suppressedUntilRelease.delete(controller);
  }

  getSourceSnapshot(
    controller: Controller
  ): InteractionSourceSnapshot | undefined {
    return this.snapshots.get(controller);
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
    return false;
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

  private startDirectTouch(
    input: DirectTouchInput,
    resolved: ResolvedRay
  ): TouchCapture {
    if (this.captures.has(input.controller)) {
      this.cancelCapture(input.controller);
      this.suppressedUntilRelease.delete(input.controller);
    }

    const selection: SelectionCapture = {
      source: input.controller,
      surface: resolved.surface,
      owner: resolved.manipulation?.owner ?? resolved.target!,
      point: input.point.clone(),
      scriptPath: Object.freeze([...resolved.scriptPath]),
    };
    const touch: TouchCapture = {
      selection,
      ancestry: Object.freeze([...resolved.objectPath]),
      resolved,
      handIndex: input.handIndex,
      point: input.point.clone(),
      synthesized: false,
    };
    this.touchCaptures.set(input.controller, touch);
    this.resolvedRays.delete(input.controller);
    this.updateHoverPath(input.controller, []);
    this.reticle.clear(input.controller);

    const prevented = this.dispatchTouchPath(
      selection.scriptPath,
      'onObjectTouchStart',
      input.handIndex,
      input.point
    );
    if (prevented) return touch;

    const snapshot = this.createDirectTouchSnapshot(input);
    this.snapshots.set(input.controller, snapshot);
    this.captures.set(input.controller, {
      kind: 'target',
      selection,
      ancestry: touch.ancestry,
    });
    this.dispatchPath(selection.scriptPath, 'onObjectSelectStart', {
      target: input.controller,
    });
    if (resolved.manipulation) {
      this.manipulation.tryStart(selection, snapshot);
    }
    this.callbacks.invokeGlobal('onSelectStart', {target: input.controller});
    touch.synthesized = true;
    return touch;
  }

  private finishDirectTouch(controller: Controller, canceled: boolean): void {
    const touch = this.touchCaptures.get(controller);
    if (!touch) return;
    this.touchCaptures.delete(controller);
    this.dispatchTouchPath(
      touch.selection.scriptPath,
      'onObjectTouchEnd',
      touch.handIndex,
      touch.point
    );

    if (touch.synthesized) {
      this.captures.delete(controller);
      if (canceled) this.manipulation.cancelSource(controller);
      else this.manipulation.end(controller);
      this.dispatchPath(touch.selection.scriptPath, 'onObjectSelectEnd', {
        target: controller,
      });
      if (!canceled) {
        this.callbacks.invokeGlobal('onSelect', {target: controller});
      }
      this.callbacks.invokeGlobal('onSelectEnd', {target: controller});
    }

    this.snapshots.delete(controller);
  }

  private createDirectTouchSnapshot(
    input: DirectTouchInput
  ): InteractionSourceSnapshot {
    const orientation = input.orientation?.clone() ?? new THREE.Quaternion();
    if (!input.orientation) input.controller.getWorldQuaternion(orientation);
    return Object.freeze({
      controller: input.controller,
      sourceType: 'direct-touch' as const,
      position: input.point.clone(),
      orientation,
      selected: true,
    });
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
      selected: input.selected,
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

    this.dispatchPath(
      oldPath.slice(0, oldIndex + 1),
      'onHoverExit',
      controller
    );
    this.dispatchPath(
      nextPath.slice(0, nextIndex + 1),
      'onHoverEnter',
      controller
    );
    this.dispatchPath(nextPath, 'onHovering', controller);

    if (nextPath.length > 0) this.hoverPaths.set(controller, nextPath);
    else this.hoverPaths.delete(controller);
  }

  private dispatchPath(
    path: readonly THREE.Object3D[],
    hook: TargetedInteractionHook,
    argument: unknown
  ): void {
    for (const script of path) {
      if (this.callbacks.invokeTarget(script, hook, argument) === true) return;
    }
  }

  private dispatchTouchPath(
    path: readonly THREE.Object3D[],
    hook: Extract<
      TargetedInteractionHook,
      'onObjectTouchStart' | 'onObjectTouching' | 'onObjectTouchEnd'
    >,
    handIndex: number,
    point: THREE.Vector3
  ): boolean {
    const preventState = {value: false};
    for (const script of path) {
      const event: ObjectTouchEvent = {
        handIndex,
        touchPosition: point.clone(),
        get defaultPrevented() {
          return preventState.value;
        },
        preventDefault() {
          preventState.value = true;
        },
      };
      if (this.callbacks.invokeTarget(script, hook, event) === true) break;
    }
    return preventState.value;
  }

  private isCaptureValid(
    capture: Extract<ActiveCapture, {kind: 'target'}>
  ): boolean {
    return this.isSelectionValid(capture.selection, capture.ancestry);
  }

  private isSelectionValid(
    selection: SelectionCapture,
    ancestry: readonly THREE.Object3D[]
  ): boolean {
    const ownerIndex = ancestry.indexOf(selection.owner);
    if (ownerIndex < 0) return false;
    for (let index = 0; index < ancestry.length; index++) {
      const object = ancestry[index];
      if (object.visible === false || object.pointerEvents === 'none')
        return false;
      if (index <= ownerIndex && object.interactionEnabled === false) {
        return false;
      }
      if (
        index + 1 < ancestry.length &&
        object.parent !== ancestry[index + 1]
      ) {
        return false;
      }
    }
    return true;
  }

  private cancelCapture(controller: Controller): void {
    const capture = this.captures.get(controller);
    if (!capture) return;
    this.captures.delete(controller);
    this.manipulation.cancelSource(controller);
    if (capture.kind === 'target') {
      this.dispatchPath(capture.selection.scriptPath, 'onObjectSelectEnd', {
        target: controller,
      });
    }
    this.callbacks.invokeGlobal('onSelectEnd', {target: controller});
    this.suppressedUntilRelease.add(controller);
  }
}
