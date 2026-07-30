import * as THREE from 'three';

import type {Script} from '../core/Script.js';
import type {Controller} from '../input/Controller.js';
import type {
  ManipulationAction,
  ReticleMode,
} from './manipulation/ManipulationTypes.js';

export type InteractionSourceType =
  | 'mouse'
  | 'controller-ray'
  | 'hand-ray'
  | 'direct-touch'
  | 'gaze'
  | 'simulator';

export type RaySourceType = Exclude<InteractionSourceType, 'direct-touch'>;

export interface RaySourceInput {
  controller: Controller;
  sourceType: RaySourceType;
  ray: THREE.Ray;
  intersections: readonly THREE.Intersection[];
  selected: boolean;
  position?: THREE.Vector3;
  orientation?: THREE.Quaternion;
}

export interface DirectTouchInput {
  controller: Controller;
  handIndex: number;
  hand?: THREE.Object3D;
  point: THREE.Vector3;
  intersections: readonly THREE.Intersection[];
  selected: boolean;
  orientation?: THREE.Quaternion;
}

/** Frame-local physical input. */
export interface InteractionSourceSnapshot {
  readonly controller: Controller;
  readonly sourceType: InteractionSourceType;
  readonly position: THREE.Vector3;
  readonly orientation: THREE.Quaternion;
  readonly ray?: THREE.Ray;
  readonly selected: boolean;
  readonly selectionProgress?: number;
}

export interface ResolvedRay {
  readonly intersection: THREE.Intersection;
  readonly surface: THREE.Object3D;
  readonly target?: THREE.Object3D;
  readonly scriptPath: readonly Script[];
  readonly objectPath: readonly THREE.Object3D[];
  readonly reticleMode: ReticleMode;
  readonly manipulation?: ManipulationResolution;
}

export interface SelectionCapture {
  readonly source: Controller;
  readonly surface: THREE.Object3D;
  readonly owner: THREE.Object3D;
  readonly point: THREE.Vector3;
  readonly scriptPath: readonly Script[];
}

export type ResolvedManipulationAction = Exclude<ManipulationAction, 'none'>;

export interface ManipulationResolution {
  readonly owner: THREE.Object3D;
  readonly action?: ResolvedManipulationAction;
}

export type TargetedInteractionHook =
  | 'onObjectSelectStart'
  | 'onObjectSelectEnd'
  | 'onObjectLongSelect'
  | 'onObjectTouchStart'
  | 'onObjectTouching'
  | 'onObjectTouchEnd'
  | 'onObjectGrabStart'
  | 'onObjectGrabbing'
  | 'onObjectGrabEnd'
  | 'onHoverEnter'
  | 'onHovering'
  | 'onHoverExit';

export type GlobalInteractionHook =
  | 'onSelectStart'
  | 'onSelecting'
  | 'onSelect'
  | 'onSelectEnd';

/**
 * The only Script-facing seam. The implementation applies the existing Script
 * exception policy to each invocation.
 */
export interface InteractionCallbackDispatch {
  isScript(object: THREE.Object3D): boolean;
  hasTargetHandler(
    object: THREE.Object3D,
    sourceType: InteractionSourceType
  ): boolean;
  invokeTarget(
    script: THREE.Object3D,
    hook: TargetedInteractionHook,
    argument: unknown
  ): unknown;
  invokeGlobal(hook: GlobalInteractionHook, event: {target: Controller}): void;
}

/** Structural seam implemented by the private manipulation module. */
export interface InteractionManipulation {
  resolve(
    surface: THREE.Object3D,
    eligiblePath: readonly THREE.Object3D[]
  ): ManipulationResolution | undefined;
  tryClaimScale(snapshot: InteractionSourceSnapshot): boolean;
  tryStart(
    capture: SelectionCapture,
    snapshot: InteractionSourceSnapshot
  ): boolean;
  update(snapshots: Iterable<InteractionSourceSnapshot>): void;
  end(source: Controller): void;
  cancelSource(source: Controller): void;
  isManipulating?(object: THREE.Object3D): boolean;
  applyScaleIntent?(
    capture: SelectionCapture,
    snapshot: InteractionSourceSnapshot,
    factor: number
  ): boolean;
}

export interface ReticlePresentationObserver {
  present(
    snapshot: InteractionSourceSnapshot,
    resolved: ResolvedRay | undefined
  ): void;
  clear(controller: Controller): void;
}

export interface InteractionDependencies {
  callbacks: InteractionCallbackDispatch;
  manipulation?: InteractionManipulation;
  reticle?: ReticlePresentationObserver;
  defaultReticleDistance?: number;
  longSelectDuration?: number;
}
