import * as THREE from 'three';

import type {ObjectGrabEvent, ObjectTouchEvent} from '../core/Script.js';
import type {Controller} from '../input/Controller.js';
import {objectIsDescendantOf} from '../utils/SceneGraphUtils.js';
import {HitResolver} from './HitResolver.js';
import type {
  DirectTouchInput,
  InteractionCallbackDispatch,
  InteractionManipulation,
  InteractionSourceSnapshot,
  ResolvedRay,
  SelectionCapture,
  TargetedInteractionHook,
} from './InteractionTypes.js';
import {dispatchInteractionPath, isSelectionValid} from './InteractionUtils.js';
import {
  isSemanticControl,
  isSemanticControlDisabled,
} from './SemanticControl.js';

interface TouchCapture {
  readonly selection: SelectionCapture;
  readonly ancestry: readonly THREE.Object3D[];
  readonly handIndex: number;
  point: THREE.Vector3;
  synthesized: boolean;
  semanticControl?: THREE.Object3D;
  grab?: ObjectGrabEvent;
}

interface DirectTouchDependencies {
  callbacks: InteractionCallbackDispatch;
  manipulation: InteractionManipulation;
  resolver: HitResolver;
  suspendRay(controller: Controller): void;
}

/** Owns direct-touch capture, callbacks, and synthesized selection. */
export class DirectTouch {
  private readonly captures = new Map<Controller, TouchCapture>();
  private readonly snapshots = new Map<Controller, InteractionSourceSnapshot>();

  constructor(private readonly dependencies: DirectTouchDependencies) {}

  /** Replaces the physical direct-touch sources and returns active snapshots. */
  update(inputs: readonly DirectTouchInput[]): InteractionSourceSnapshot[] {
    const activeSources = new Set<Controller>();
    const snapshots: InteractionSourceSnapshot[] = [];
    for (const input of inputs) {
      activeSources.add(input.controller);
      const snapshot = this.updateSource(input);
      if (snapshot) snapshots.push(snapshot);
    }
    for (const controller of [...this.captures.keys()]) {
      if (!activeSources.has(controller)) this.finish(controller, true);
    }
    return snapshots;
  }

  remove(controller: Controller): boolean {
    if (!this.captures.has(controller)) return false;
    this.finish(controller, true);
    return true;
  }

  has(controller: Controller): boolean {
    return this.captures.has(controller);
  }

  getSnapshot(controller: Controller): InteractionSourceSnapshot | undefined {
    return this.snapshots.get(controller);
  }

  isSelectingAt(object: THREE.Object3D): boolean {
    for (const touch of this.captures.values()) {
      if (
        touch.synthesized &&
        objectIsDescendantOf(touch.selection.surface, object)
      ) {
        return true;
      }
    }
    return false;
  }

  private updateSource(
    input: DirectTouchInput
  ): InteractionSourceSnapshot | undefined {
    const resolved = this.dependencies.resolver.resolve(
      input.intersections,
      'direct-touch'
    );
    let touch = this.captures.get(input.controller);
    touch?.point.copy(input.point);

    if (touch && !isSelectionValid(touch.selection, touch.ancestry)) {
      this.finish(input.controller, true);
      touch = undefined;
    } else if (touch && !resolved?.target) {
      this.finish(input.controller, false);
      touch = undefined;
    } else if (
      touch &&
      (resolved!.manipulation?.owner ?? resolved!.target) !==
        touch.selection.owner
    ) {
      this.finish(input.controller, true);
      touch = undefined;
    }

    if (!touch && resolved?.target) {
      this.start(input, resolved);
    } else if (touch) {
      const snapshot = this.createSnapshot(input);
      this.snapshots.set(input.controller, snapshot);
      this.dispatchTouchPath(
        touch.selection.scriptPath,
        'onObjectTouching',
        touch.handIndex,
        input.point
      );
      this.updateGrab(touch, input);
      if (touch.synthesized) {
        return snapshot;
      }
    }
    return undefined;
  }

  private start(input: DirectTouchInput, resolved: ResolvedRay): void {
    this.dependencies.suspendRay(input.controller);
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
      handIndex: input.handIndex,
      point: input.point.clone(),
      synthesized: false,
      semanticControl:
        isSemanticControl(resolved.target!) &&
        !isSemanticControlDisabled(resolved.target!)
          ? resolved.target
          : undefined,
    };
    this.captures.set(input.controller, touch);

    const prevented = this.dispatchTouchPath(
      selection.scriptPath,
      'onObjectTouchStart',
      input.handIndex,
      input.point
    );
    this.updateGrab(touch, input);
    if (prevented) return;

    const snapshot = this.createSnapshot(input);
    this.snapshots.set(input.controller, snapshot);
    dispatchInteractionPath(
      this.dependencies.callbacks,
      selection.scriptPath,
      'onObjectSelectStart',
      {target: input.controller}
    );
    if (resolved.manipulation) {
      this.dependencies.manipulation.tryStart(selection, snapshot);
    }
    this.dependencies.callbacks.invokeGlobal('onSelectStart', {
      target: input.controller,
    });
    touch.synthesized = true;
  }

  private finish(controller: Controller, canceled: boolean): void {
    const touch = this.captures.get(controller);
    if (!touch) return;
    this.captures.delete(controller);
    this.finishGrab(touch);
    this.dispatchTouchPath(
      touch.selection.scriptPath,
      'onObjectTouchEnd',
      touch.handIndex,
      touch.point
    );

    if (touch.synthesized) {
      if (canceled) this.dependencies.manipulation.cancelSource(controller);
      else this.dependencies.manipulation.end(controller);
      dispatchInteractionPath(
        this.dependencies.callbacks,
        touch.selection.scriptPath,
        'onObjectSelectEnd',
        {target: controller}
      );
      if (
        !canceled &&
        touch.semanticControl &&
        !isSemanticControlDisabled(touch.semanticControl)
      ) {
        this.dependencies.callbacks.invokeSemantic(touch.semanticControl);
      }
      if (!canceled) {
        this.dependencies.callbacks.invokeGlobal('onSelect', {
          target: controller,
        });
      }
      this.dependencies.callbacks.invokeGlobal('onSelectEnd', {
        target: controller,
      });
    }

    this.snapshots.delete(controller);
  }

  private updateGrab(touch: TouchCapture, input: DirectTouchInput): void {
    if (!input.selected || !input.hand) {
      this.finishGrab(touch);
      return;
    }

    if (!touch.grab) {
      touch.grab = {handIndex: input.handIndex, hand: input.hand};
      dispatchInteractionPath(
        this.dependencies.callbacks,
        touch.selection.scriptPath,
        'onObjectGrabStart',
        touch.grab
      );
      return;
    }

    dispatchInteractionPath(
      this.dependencies.callbacks,
      touch.selection.scriptPath,
      'onObjectGrabbing',
      touch.grab
    );
  }

  private finishGrab(touch: TouchCapture): void {
    if (!touch.grab) return;
    dispatchInteractionPath(
      this.dependencies.callbacks,
      touch.selection.scriptPath,
      'onObjectGrabEnd',
      touch.grab
    );
    touch.grab = undefined;
  }

  private createSnapshot(input: DirectTouchInput): InteractionSourceSnapshot {
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
      if (
        this.dependencies.callbacks.invokeTarget(script, hook, event) === true
      ) {
        break;
      }
    }
    return preventState.value;
  }
}
