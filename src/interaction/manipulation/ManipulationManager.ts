import * as THREE from 'three';

import type {Script} from '../../core/Script';
import type {Controller} from '../../input/Controller';
import {
  resumeTransformScripts,
  suspendTransformScripts,
} from '../../placement/TransformScript';
import {objectIsDescendantOf} from '../../utils/SceneGraphUtils';
import type {
  InteractionSourceSnapshot,
  ManipulationResolution,
  ResolvedManipulationAction,
  SelectionCapture,
} from '../InteractionTypes';
import {
  cloneScaleOptions,
  isHandleAction,
  isManipulationActionEnabled,
  normalizeManipulationConfig,
  normalizeRotationAxis,
  type NormalizedManipulationConfig,
} from './ManipulationConfig';
import {
  clampScaleFactor,
  faceCameraQuaternion,
  isFiniteQuaternion,
  isFiniteVector,
  isPositiveFinite,
  isPositiveVector,
  worldPositionToLocal,
  worldQuaternionToLocal,
} from './ManipulationMath';
import {
  ManipulationAction,
  type ManipulationEvent,
  type ManipulationPhase,
  type RotateOptions,
  type ScaleOptions,
  type TranslateOptions,
} from './ManipulationTypes';

export type DispatchManipulationEvent = (
  script: Script,
  event: ManipulationEvent
) => boolean | void;

interface PrimaryRole {
  capture: SelectionCapture;
  snapshot: InteractionSourceSnapshot;
}

interface Session {
  owner: THREE.Object3D;
  ownerParent: THREE.Object3D | null;
  config: NormalizedManipulationConfig;
  primary: PrimaryRole;
  primaryAction?: ResolvedManipulationAction;
  auxiliary?: InteractionSourceSnapshot;
  phase?: ActivePhase;
}

interface TranslateBaseline {
  action: typeof ManipulationAction.Translate;
  worldPosition: THREE.Vector3;
  sourcePosition: THREE.Vector3;
  rayDepth?: number;
  rayPoint?: THREE.Vector3;
  options: TranslateOptions;
}

interface RotateBaseline {
  action: typeof ManipulationAction.Rotate;
  localQuaternion: THREE.Quaternion;
  worldQuaternion: THREE.Quaternion;
  sourcePosition: THREE.Vector3;
  sourceOrientationInverse: THREE.Quaternion;
  axis: THREE.Vector3;
  options: Required<Pick<RotateOptions, 'space' | 'sensitivity'>>;
}

interface ScaleBaseline {
  action: typeof ManipulationAction.Scale;
  scale: THREE.Vector3;
  distance: number;
  options: ScaleOptions;
}

type PhaseBaseline = TranslateBaseline | RotateBaseline | ScaleBaseline;

interface ActivePhase {
  action: ResolvedManipulationAction;
  baseline: PhaseBaseline;
  defaultPrevented: boolean;
  lastProposal?: Proposal;
}

interface ProposalBase {
  apply(): void;
}

type Proposal = ProposalBase &
  (
    | {
        action: typeof ManipulationAction.Translate;
        point: THREE.Vector3;
        delta: THREE.Vector3;
        position: THREE.Vector3;
        worldPosition: THREE.Vector3;
      }
    | {
        action: typeof ManipulationAction.Rotate;
        angle: number;
        quaternion: THREE.Quaternion;
      }
    | {
        action: typeof ManipulationAction.Scale;
        factor: number;
        center: THREE.Vector3;
        scale: THREE.Vector3;
      }
  );

/**
 * Private runtime used by Interaction. It does not observe input or raycast.
 * It is exported only so the sibling Interaction module can construct it.
 */
export class ManipulationManager {
  private readonly sessions = new Map<THREE.Object3D, Session>();
  private readonly roles = new Map<Controller, Session>();
  private readonly suppressedUntilRelease = new Set<Controller>();

  constructor(
    private readonly dispatch: DispatchManipulationEvent,
    private readonly camera?: THREE.Camera
  ) {}

  resolve(surface: THREE.Object3D): ManipulationResolution | undefined {
    let current: THREE.Object3D | null = surface;
    let childHandle:
      | ResolvedManipulationAction
      | typeof ManipulationAction.None
      | undefined;
    let hasChildHandle = false;

    while (current) {
      const options = current.xb;
      if (!hasChildHandle && options?.manipulationHandle !== undefined) {
        hasChildHandle = true;
        const action =
          options.manipulationHandle === 'none'
            ? ManipulationAction.None
            : options.manipulationHandle.action;
        if (action !== undefined && !isHandleAction(action)) return undefined;
        childHandle = action;
      }

      if (options?.manipulation !== undefined) {
        if (
          options.manipulation === false ||
          options.manipulationHandle !== undefined
        ) {
          return undefined;
        }
        const config = normalizeManipulationConfig(options.manipulation);
        if (!config) return undefined;

        const requested = hasChildHandle ? childHandle : config.handle;
        if (requested === ManipulationAction.None) return undefined;
        if (requested !== undefined) {
          return isManipulationActionEnabled(config, requested)
            ? {owner: current, action: requested}
            : undefined;
        }

        const primaryActions = [
          config.translate && ManipulationAction.Translate,
          config.rotate && ManipulationAction.Rotate,
        ].filter(Boolean) as ResolvedManipulationAction[];
        if (primaryActions.length === 1) {
          return {owner: current, action: primaryActions[0]};
        }
        if (primaryActions.length === 0 && config.scale) {
          return {owner: current};
        }
        return undefined;
      }
      current = current.parent;
    }
    return undefined;
  }

  /** Starts a primary session after Interaction has dispatched Select start. */
  tryStart(
    capture: SelectionCapture,
    snapshot: InteractionSourceSnapshot
  ): boolean {
    if (
      snapshot.sourceType === 'gaze' ||
      capture.source !== snapshot.controller ||
      this.roles.has(snapshot.controller) ||
      this.suppressedUntilRelease.has(snapshot.controller)
    ) {
      return false;
    }

    const resolution = this.resolve(capture.surface);
    if (!resolution || this.sessions.has(resolution.owner)) return false;
    const config = normalizeManipulationConfig(
      resolution.owner.xb?.manipulation
    );
    if (!config) return false;

    const session: Session = {
      owner: resolution.owner,
      ownerParent: resolution.owner.parent,
      config,
      primary: {capture, snapshot: cloneSnapshot(snapshot)},
      primaryAction: resolution.action,
    };
    const baseline = session.primaryAction
      ? this.captureBaseline(session, session.primaryAction)
      : undefined;
    if (session.primaryAction && !baseline) return false;

    this.sessions.set(session.owner, session);
    suspendTransformScripts(session.owner);
    this.roles.set(snapshot.controller, session);
    if (
      session.primaryAction &&
      baseline &&
      !this.beginPhase(session, session.primaryAction, baseline)
    ) {
      this.removeSession(session, false);
      return false;
    }
    return true;
  }

  /** Claims a free spatial Select for Scale before normal target resolution. */
  tryClaimScale(snapshot: InteractionSourceSnapshot): boolean {
    if (
      snapshot.sourceType === 'gaze' ||
      this.roles.has(snapshot.controller) ||
      this.suppressedUntilRelease.has(snapshot.controller)
    ) {
      return false;
    }
    const eligible = [...this.sessions.values()].filter(
      (session) => session.config.scale && !session.auxiliary
    );
    if (eligible.length !== 1) return false;

    const session = eligible[0];
    const auxiliary = cloneSnapshot(snapshot);
    const baseline = this.captureBaseline(
      session,
      ManipulationAction.Scale,
      auxiliary
    );
    if (baseline?.action !== ManipulationAction.Scale) return false;

    if (session.phase) this.finishPhase(session, 'end');
    session.auxiliary = auxiliary;
    this.roles.set(snapshot.controller, session);
    this.beginPhase(session, ManipulationAction.Scale, baseline);
    return true;
  }

  /** Runs a one-shot Scale phase for simulator and equivalent private intents. */
  applyScaleIntent(
    capture: SelectionCapture,
    snapshot: InteractionSourceSnapshot,
    requestedFactor: number
  ): boolean {
    if (
      snapshot.sourceType === 'gaze' ||
      capture.source !== snapshot.controller ||
      this.roles.has(snapshot.controller) ||
      this.suppressedUntilRelease.has(snapshot.controller) ||
      !isPositiveFinite(requestedFactor)
    ) {
      return false;
    }
    const resolution = this.resolve(capture.surface);
    if (!resolution || this.sessions.has(resolution.owner)) return false;
    const config = normalizeManipulationConfig(
      resolution.owner.xb?.manipulation
    );
    if (!config?.scale || !isPositiveVector(resolution.owner.scale)) {
      return false;
    }
    const factor = clampScaleFactor(
      requestedFactor,
      resolution.owner.scale,
      config.scale
    );
    if (!isPositiveFinite(factor)) return false;

    const scale = resolution.owner.scale.clone().multiplyScalar(factor);
    if (!isPositiveVector(scale)) return false;
    const session: Session = {
      owner: resolution.owner,
      ownerParent: resolution.owner.parent,
      config,
      primary: {capture, snapshot: cloneSnapshot(snapshot)},
      primaryAction: resolution.action,
      phase: {
        action: ManipulationAction.Scale,
        baseline: {
          action: ManipulationAction.Scale,
          scale: resolution.owner.scale.clone(),
          distance: 1,
          options: {...config.scale},
        },
        defaultPrevented: false,
      },
    };
    const proposal: Proposal = {
      action: ManipulationAction.Scale,
      factor,
      center: resolution.owner.getWorldPosition(new THREE.Vector3()),
      scale,
      apply: () => resolution.owner.scale.copy(scale),
    };
    this.dispatchPhase(session, 'start', proposal);
    if (!session.phase?.defaultPrevented) proposal.apply();
    this.dispatchPhase(session, 'update', proposal);
    this.dispatchPhase(session, 'end', proposal);
    return true;
  }

  /** Updates active sessions from Interaction's current frame snapshots. */
  update(snapshots: Iterable<InteractionSourceSnapshot>): void {
    for (const snapshot of snapshots) {
      const session = this.roles.get(snapshot.controller);
      if (!session) continue;
      if (session.primary.snapshot.controller === snapshot.controller) {
        session.primary.snapshot = cloneSnapshot(snapshot);
      } else if (session.auxiliary?.controller === snapshot.controller) {
        session.auxiliary = cloneSnapshot(snapshot);
      }
    }

    for (const session of [...this.sessions.values()]) {
      if (!this.validate(session)) continue;
      this.updateSession(session);
    }
  }

  /** Ends the role held by a source. Returns true when the source was claimed. */
  end(source: Controller, finalSnapshot?: InteractionSourceSnapshot): boolean {
    if (this.suppressedUntilRelease.delete(source)) return true;
    const session = this.roles.get(source);
    if (!session) return false;
    if (finalSnapshot) {
      if (session.primary.snapshot.controller === source) {
        session.primary.snapshot = cloneSnapshot(finalSnapshot);
      } else if (session.auxiliary?.controller === source) {
        session.auxiliary = cloneSnapshot(finalSnapshot);
      }
      this.updateSession(session);
    }

    if (session.primary.snapshot.controller === source) {
      if (session.phase) this.finishPhase(session, 'end');
      this.removeSession(session, true);
      return true;
    }

    if (session.auxiliary?.controller === source) {
      this.finishPhase(session, 'end');
      this.roles.delete(source);
      session.auxiliary = undefined;
      if (session.primaryAction)
        this.startPhase(session, session.primaryAction);
      return true;
    }
    return false;
  }

  cancelSource(source: Controller): boolean {
    if (this.suppressedUntilRelease.delete(source)) return true;
    const session = this.roles.get(source);
    if (!session) return false;
    if (session.primary.snapshot.controller === source) {
      if (session.phase) this.finishPhase(session, 'cancel');
      this.removeSession(session, true);
      return true;
    }
    if (session.auxiliary?.controller === source) {
      this.finishPhase(session, 'cancel');
      this.roles.delete(source);
      session.auxiliary = undefined;
      if (session.primaryAction)
        this.startPhase(session, session.primaryAction);
      return true;
    }
    return false;
  }

  cancelOwner(owner: THREE.Object3D): boolean {
    const session = this.sessions.get(owner);
    if (!session) return false;
    if (session.phase) this.finishPhase(session, 'cancel');
    this.removeSession(session, true);
    return true;
  }

  isManipulating(object?: THREE.Object3D): boolean {
    return object ? this.sessions.has(object) : this.sessions.size > 0;
  }

  private validate(session: Session): boolean {
    const current = normalizeManipulationConfig(session.owner.xb?.manipulation);
    const resolution = this.resolve(session.primary.capture.surface);
    if (
      !current ||
      !session.owner.visible ||
      session.owner.parent !== session.ownerParent ||
      !objectIsDescendantOf(session.primary.capture.surface, session.owner) ||
      resolution?.owner !== session.owner ||
      resolution.action !== session.primaryAction
    ) {
      this.cancelOwner(session.owner);
      return false;
    }

    if (session.phase?.action === ManipulationAction.Scale && !current.scale) {
      const auxiliary = session.auxiliary;
      this.finishPhase(session, 'cancel');
      if (auxiliary) this.roles.delete(auxiliary.controller);
      session.auxiliary = undefined;
      session.config = current;
      if (session.primaryAction)
        this.startPhase(session, session.primaryAction);
      return false;
    }
    if (
      session.primaryAction &&
      !isManipulationActionEnabled(current, session.primaryAction)
    ) {
      this.cancelOwner(session.owner);
      return false;
    }
    session.config = current;
    return true;
  }

  private removeSession(session: Session, suppressAuxiliary: boolean): void {
    this.sessions.delete(session.owner);
    resumeTransformScripts(session.owner);
    this.roles.delete(session.primary.snapshot.controller);
    if (session.auxiliary) {
      this.roles.delete(session.auxiliary.controller);
      if (suppressAuxiliary && session.auxiliary.selected) {
        this.suppressedUntilRelease.add(session.auxiliary.controller);
      }
    }
  }

  private startPhase(
    session: Session,
    action: ResolvedManipulationAction
  ): boolean {
    const baseline = this.captureBaseline(session, action);
    return baseline ? this.beginPhase(session, action, baseline) : false;
  }

  private beginPhase(
    session: Session,
    action: ResolvedManipulationAction,
    baseline: PhaseBaseline
  ): boolean {
    session.phase = {action, baseline, defaultPrevented: false};
    const proposal = this.propose(session);
    if (!proposal) {
      session.phase = undefined;
      return false;
    }
    session.phase.lastProposal = proposal;
    this.dispatchPhase(session, 'start', proposal);
    return true;
  }

  private finishPhase(session: Session, phase: 'end' | 'cancel'): void {
    if (!session.phase) return;
    const proposal = this.propose(session) ?? session.phase.lastProposal;
    this.dispatchPhase(session, phase, proposal);
    session.phase = undefined;
  }

  private updateSession(session: Session): void {
    if (!session.phase) return;
    const proposal = this.propose(session);
    if (!proposal) return;
    session.phase.lastProposal = proposal;
    if (!session.phase.defaultPrevented) proposal.apply();
    this.dispatchPhase(session, 'update', proposal);
  }

  private captureBaseline(
    session: Session,
    action: ResolvedManipulationAction,
    auxiliary = session.auxiliary
  ): PhaseBaseline | undefined {
    const owner = session.owner;
    owner.updateWorldMatrix(true, false);

    if (action === ManipulationAction.Translate) {
      const snapshot = session.primary.snapshot;
      const baseline: TranslateBaseline = {
        action,
        worldPosition: owner.getWorldPosition(new THREE.Vector3()),
        sourcePosition: snapshot.position.clone(),
        options: {...session.config.translate},
      };
      if (snapshot.ray) {
        baseline.rayDepth = snapshot.ray.direction.dot(
          session.primary.capture.point.clone().sub(snapshot.ray.origin)
        );
        baseline.rayPoint = snapshot.ray
          .at(baseline.rayDepth, new THREE.Vector3())
          .clone();
      }
      return baseline;
    }

    if (action === ManipulationAction.Rotate) {
      const raw = session.config.rotate ?? {};
      const axis = normalizeRotationAxis(raw.axis);
      const sensitivity = raw.sensitivity ?? 10;
      if (!axis || !Number.isFinite(sensitivity)) return undefined;
      return {
        action,
        localQuaternion: owner.quaternion.clone(),
        worldQuaternion: owner.getWorldQuaternion(new THREE.Quaternion()),
        sourcePosition: session.primary.snapshot.position.clone(),
        sourceOrientationInverse: session.primary.snapshot.orientation
          .clone()
          .invert(),
        axis,
        options: {space: raw.space ?? 'world', sensitivity},
      };
    }

    if (action !== ManipulationAction.Scale) return undefined;
    if (!auxiliary) return undefined;
    const distance = session.primary.snapshot.position.distanceTo(
      auxiliary.position
    );
    if (!isPositiveFinite(distance) || !isPositiveVector(owner.scale)) {
      return undefined;
    }
    const options = cloneScaleOptions(session.config.scale);
    if (!isPositiveFinite(clampScaleFactor(1, owner.scale, options))) {
      return undefined;
    }
    return {
      action,
      scale: owner.scale.clone(),
      distance,
      options,
    };
  }

  private propose(session: Session): Proposal | undefined {
    const baseline = session.phase?.baseline;
    if (!baseline) return undefined;
    if (baseline.action === ManipulationAction.Translate) {
      return this.proposeTranslate(session, baseline);
    }
    if (baseline.action === ManipulationAction.Rotate) {
      return this.proposeRotate(session, baseline);
    }
    return this.proposeScale(session, baseline);
  }

  private proposeTranslate(
    session: Session,
    baseline: TranslateBaseline
  ): Proposal | undefined {
    const snapshot = session.primary.snapshot;
    let delta: THREE.Vector3;
    let point: THREE.Vector3;
    if (snapshot.ray && baseline.rayDepth !== undefined && baseline.rayPoint) {
      point = snapshot.ray.at(baseline.rayDepth, new THREE.Vector3());
      delta = point.clone().sub(baseline.rayPoint);
    } else {
      delta = snapshot.position.clone().sub(baseline.sourcePosition);
      point = session.primary.capture.point.clone().add(delta);
    }
    const worldPosition = baseline.worldPosition.clone().add(delta);
    const parent = session.owner.parent;
    parent?.updateWorldMatrix(true, false);
    const localPosition = worldPositionToLocal(
      worldPosition,
      parent?.matrixWorld
    );
    const localQuaternion = baseline.options.faceCamera
      ? faceCameraQuaternion(
          worldPosition,
          this.camera?.getWorldPosition(new THREE.Vector3()),
          parent?.getWorldQuaternion(new THREE.Quaternion())
        )
      : undefined;
    if (
      !isFiniteVector(point) ||
      !isFiniteVector(delta) ||
      !isFiniteVector(worldPosition) ||
      !isFiniteVector(localPosition)
    ) {
      return undefined;
    }
    return {
      action: ManipulationAction.Translate,
      point,
      delta,
      position: localPosition,
      worldPosition,
      apply: () => {
        if (!isFiniteVector(localPosition)) return;
        session.owner.position.copy(localPosition);
        if (localQuaternion) session.owner.quaternion.copy(localQuaternion);
      },
    };
  }

  private proposeRotate(
    session: Session,
    baseline: RotateBaseline
  ): Proposal | undefined {
    const snapshot = session.primary.snapshot;
    let angle: number;
    if (snapshot.sourceType === 'mouse') {
      const deltaRotation = snapshot.orientation
        .clone()
        .multiply(baseline.sourceOrientationInverse);
      angle =
        -new THREE.Euler().setFromQuaternion(deltaRotation, 'YXZ').y *
        baseline.options.sensitivity;
    } else {
      const localDelta = snapshot.position
        .clone()
        .sub(baseline.sourcePosition)
        .applyQuaternion(baseline.sourceOrientationInverse);
      angle = localDelta.x * baseline.options.sensitivity;
    }
    const offset = new THREE.Quaternion().setFromAxisAngle(
      baseline.axis,
      angle
    );
    let quaternion: THREE.Quaternion;
    if (baseline.options.space === 'local') {
      quaternion = baseline.localQuaternion.clone().multiply(offset);
    } else {
      const world = offset.multiply(baseline.worldQuaternion);
      const parent = session.owner.parent;
      parent?.updateWorldMatrix(true, false);
      quaternion = worldQuaternionToLocal(
        world,
        parent?.getWorldQuaternion(new THREE.Quaternion())
      );
    }
    if (!Number.isFinite(angle) || !isFiniteQuaternion(quaternion)) {
      return undefined;
    }
    return {
      action: ManipulationAction.Rotate,
      angle,
      quaternion,
      apply: () => {
        if (Number.isFinite(angle) && isFiniteQuaternion(quaternion)) {
          session.owner.quaternion.copy(quaternion).normalize();
        }
      },
    };
  }

  private proposeScale(
    session: Session,
    baseline: ScaleBaseline
  ): Proposal | undefined {
    if (!session.auxiliary) return undefined;
    const currentDistance = session.primary.snapshot.position.distanceTo(
      session.auxiliary.position
    );
    let factor = currentDistance / baseline.distance;
    if (!isPositiveFinite(factor)) return undefined;
    factor = clampScaleFactor(factor, baseline.scale, baseline.options);
    if (!isPositiveFinite(factor)) return undefined;
    const scale = baseline.scale.clone().multiplyScalar(factor);
    if (!isPositiveVector(scale)) return undefined;
    const center = session.primary.snapshot.position
      .clone()
      .add(session.auxiliary.position)
      .multiplyScalar(0.5);
    return {
      action: ManipulationAction.Scale,
      factor,
      center,
      scale,
      apply: () => session.owner.scale.copy(scale),
    };
  }

  private dispatchPhase(
    session: Session,
    phase: ManipulationPhase,
    proposal: Proposal | undefined
  ): void {
    if (!session.phase || !proposal) return;
    const preventState = {value: session.phase.defaultPrevented};
    for (const script of session.primary.capture.scriptPath) {
      const event = createEvent(session, script, phase, proposal, preventState);
      if (this.dispatch(script, event) === true) break;
    }
    if (phase === 'start') session.phase.defaultPrevented = preventState.value;
  }
}

function cloneSnapshot(
  snapshot: InteractionSourceSnapshot
): InteractionSourceSnapshot {
  return {
    ...snapshot,
    position: snapshot.position.clone(),
    orientation: snapshot.orientation.clone(),
    ray: snapshot.ray?.clone(),
  };
}

function createEvent(
  session: Session,
  currentTarget: Script,
  phase: ManipulationPhase,
  proposal: Proposal,
  preventState: {value: boolean}
): ManipulationEvent {
  const common = {
    phase,
    action: proposal.action,
    target: session.primary.snapshot.controller,
    controllers: Object.freeze(
      [
        session.primary.snapshot.controller,
        session.auxiliary?.controller,
      ].filter(Boolean) as Controller[]
    ),
    sourceType: session.primary.snapshot.sourceType,
    surface: session.primary.capture.surface,
    owner: session.owner,
    currentTarget,
    defaultPrevented: preventState.value,
    preventDefault() {
      if (phase === 'start') preventState.value = true;
    },
  };

  if (proposal.action === ManipulationAction.Translate) {
    return withDefaultPrevented(
      {
        ...common,
        action: proposal.action,
        point: proposal.point.clone(),
        delta: proposal.delta.clone(),
        position: proposal.position.clone(),
        worldPosition: proposal.worldPosition.clone(),
      },
      preventState
    );
  }
  if (proposal.action === ManipulationAction.Rotate) {
    return withDefaultPrevented(
      {
        ...common,
        action: proposal.action,
        angle: proposal.angle,
        quaternion: proposal.quaternion.clone(),
      },
      preventState
    );
  }
  return withDefaultPrevented(
    {
      ...common,
      action: proposal.action,
      factor: proposal.factor,
      center: proposal.center.clone(),
      scale: proposal.scale.clone(),
    },
    preventState
  );
}

function withDefaultPrevented<T extends ManipulationEvent>(
  event: T,
  state: {value: boolean}
): T {
  Object.defineProperty(event, 'defaultPrevented', {
    enumerable: true,
    get: () => state.value,
  });
  return event;
}
