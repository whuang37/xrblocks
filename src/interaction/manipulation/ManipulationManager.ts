import * as THREE from 'three';

import type {Script} from '../../core/Script';
import type {Controller} from '../../input/Controller';
import {
  resumeTransformScripts,
  suspendTransformScripts,
} from '../../placement/TransformScript';
import {objectIsDescendantOf} from '../../utils/SceneGraphUtils';
import {getUIElementKind, isUIElement} from '../../ui/UIElement';
import type {
  InteractionSourceSnapshot,
  InteractionSource,
  InteractionHitPart,
  ManipulationResolution,
  ResolvedManipulationAction,
  ResolvedRay,
  SelectionCapture,
} from '../InteractionTypes';
import {
  isHandleAction,
  isManipulationActionEnabled,
  normalizeManipulationConfig,
  type NormalizedManipulationConfig,
} from './ManipulationConfig';
import {
  clampScaleFactor,
  isPositiveFinite,
  isPositiveVector,
} from './ManipulationMath';
import {
  ManipulationAction,
  type ManipulationEvent,
  type ManipulationPhase,
} from './ManipulationTypes';
import type {PhaseBaseline, Proposal} from './drivers/DriverTypes';
import {RotateDriver} from './drivers/RotateDriver';
import {ScaleDriver} from './drivers/ScaleDriver';
import {TranslateDriver} from './drivers/TranslateDriver';

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
  cornerScale?: {
    primaryCorner: CardCorner;
  };
}

type CardCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface ActivePhase {
  action: ResolvedManipulationAction;
  baseline: PhaseBaseline;
  defaultPrevented: boolean;
  lastProposal?: Proposal;
}

/**
 * Private runtime used by Interaction. It does not observe input or raycast.
 * It is exported only so the sibling Interaction module can construct it.
 */
export class ManipulationManager {
  private readonly sessions = new Map<THREE.Object3D, Session>();
  private readonly roles = new Map<Controller, Session>();
  private readonly suppressedUntilRelease = new Set<Controller>();
  private readonly translateDriver: TranslateDriver;
  private readonly rotateDriver = new RotateDriver();
  private readonly scaleDriver = new ScaleDriver();

  constructor(
    private readonly dispatch: DispatchManipulationEvent,
    camera?: THREE.Camera,
    timer?: THREE.Timer
  ) {
    this.translateDriver = new TranslateDriver(camera, timer);
  }

  resolve(
    surface: THREE.Object3D,
    _eligiblePath?: readonly THREE.Object3D[],
    hitPart?: InteractionHitPart
  ): ManipulationResolution | undefined {
    let current: THREE.Object3D | null = surface;
    let childHandle:
      | ResolvedManipulationAction
      | typeof ManipulationAction.None
      | undefined;
    let hasChildHandle = false;

    while (current) {
      if (isUIElement(current) && getUIElementKind(current) === 'overlay') {
        return undefined;
      }
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

        const edge = getCardEdge(current);
        if (edge) {
          if (hitPart?.kind === 'card-edge') {
            return config.translate
              ? {owner: current, action: ManipulationAction.Translate}
              : undefined;
          }
          if (!edge.translateFromSurface) return undefined;
        }

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

    const resolution =
      capture.manipulation ??
      this.resolve(capture.surface, undefined, capture.hitPart);
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
      primaryAction:
        resolution.action === ManipulationAction.Scale
          ? undefined
          : resolution.action,
    };
    const edge = getCardEdge(session.owner);
    const corner =
      capture.hitPart?.kind === 'card-edge'
        ? capture.hitPart.corner
        : undefined;
    if (edge?.scale && corner) {
      session.cornerScale = {primaryCorner: corner};
    }
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
  tryClaimScale(
    snapshot: InteractionSourceSnapshot,
    resolved?: ResolvedRay
  ): boolean {
    if (
      snapshot.sourceType === 'gaze' ||
      this.roles.has(snapshot.controller) ||
      this.suppressedUntilRelease.has(snapshot.controller)
    ) {
      return false;
    }
    const eligible = [...this.sessions.values()].filter((session) => {
      if (!session.config.scale || session.auxiliary) return false;
      if (session.cornerScale) {
        const corner =
          resolved?.hitPart?.kind === 'card-edge'
            ? resolved.hitPart.corner
            : undefined;
        return (
          resolved?.manipulation?.owner === session.owner &&
          corner !== undefined &&
          oppositeCorner(session.cornerScale.primaryCorner) === corner
        );
      }
      return !getCardEdge(session.owner)?.scale;
    });
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
    if (this.suppressedUntilRelease.delete(source)) return false;
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

  isSourceActive(source: Controller): boolean {
    return this.roles.has(source);
  }

  private validate(session: Session): boolean {
    const current = normalizeManipulationConfig(session.owner.xb?.manipulation);
    const edge = getCardEdge(session.owner);
    if (
      !current ||
      !session.owner.visible ||
      session.owner.parent !== session.ownerParent ||
      !objectIsDescendantOf(session.primary.capture.surface, session.owner) ||
      (session.primary.capture.hitPart?.kind === 'card-edge' && !edge) ||
      (session.cornerScale &&
        (!edge?.scale || !current.scale || !current.translate))
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
    session.owner.updateWorldMatrix(true, false);
    if (action === ManipulationAction.Translate) {
      return this.translateDriver.capture(session);
    }
    if (action === ManipulationAction.Rotate) {
      return this.rotateDriver.capture(session);
    }
    return this.scaleDriver.capture(session, auxiliary);
  }

  private propose(session: Session): Proposal | undefined {
    const baseline = session.phase?.baseline;
    if (!baseline) return undefined;
    if (baseline.action === ManipulationAction.Translate) {
      return this.translateDriver.propose(session, baseline);
    }
    if (baseline.action === ManipulationAction.Rotate) {
      return this.rotateDriver.propose(session, baseline);
    }
    return this.scaleDriver.propose(session, baseline);
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

function getCardEdge(
  owner: THREE.Object3D
): {scale: boolean; translateFromSurface: boolean} | undefined {
  const candidate = owner as THREE.Object3D & {
    readonly isUI?: boolean;
    readonly edge?:
      | false
      | {readonly scale?: boolean; readonly translateFromSurface?: boolean};
  };
  if (!candidate.isUI || !candidate.edge) return undefined;
  return {
    scale: candidate.edge.scale ?? false,
    translateFromSurface: candidate.edge.translateFromSurface ?? false,
  };
}

function oppositeCorner(corner: CardCorner): CardCorner {
  if (corner === 'top-left') return 'bottom-right';
  if (corner === 'top-right') return 'bottom-left';
  if (corner === 'bottom-left') return 'top-right';
  return 'top-left';
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
    source: session.primary.snapshot.source,
    sources: Object.freeze(
      [session.primary.snapshot.source, session.auxiliary?.source].filter(
        Boolean
      ) as InteractionSource[]
    ),
    target: session.primary.capture.target,
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
