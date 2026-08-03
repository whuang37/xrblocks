import * as THREE from 'three';

import type {Controller} from '../input/Controller';
import {HitRegistry} from './HitRegistry';
import {HitResolver} from './HitResolver';
import {
  getInteractionSource,
  type DirectTouchInput,
  type InteractionSourceSnapshot,
  type ResolvedRay,
} from './InteractionTypes';

export interface DirectTouchContact {
  readonly phase: 'start' | 'move' | 'end';
  readonly controller: Controller;
  readonly snapshot: InteractionSourceSnapshot;
  readonly resolved?: ResolvedRay;
  readonly previous?: ResolvedRay;
  readonly handIndex: number;
  readonly hand?: THREE.Object3D;
  readonly point: THREE.Vector3;
  readonly selected: boolean;
  readonly endReason?: 'left-target' | 'target-changed' | 'source-lost';
}

interface ActiveContact {
  resolved: ResolvedRay;
  handIndex: number;
  hand?: THREE.Object3D;
  point: THREE.Vector3;
  snapshot: InteractionSourceSnapshot;
}

/**
 * Converts registered-bounds contacts into source-neutral contact phases.
 * Interaction owns callback dispatch, capture, completion, and cancellation.
 */
export class DirectTouch {
  private static readonly EXIT_PADDING = 0.01;
  private readonly active = new Map<Controller, ActiveContact>();
  private readonly awaitingExit = new Set<Controller>();
  private readonly snapshots = new Map<Controller, InteractionSourceSnapshot>();

  constructor(
    private readonly registry: HitRegistry,
    private readonly resolver: HitResolver
  ) {}

  update(inputs: readonly DirectTouchInput[]): DirectTouchContact[] {
    const contacts: DirectTouchContact[] = [];
    const present = new Set<Controller>();
    for (const input of inputs) {
      present.add(input.controller);
      const previous = this.active.get(input.controller);
      const resolved = this.resolver.resolve(
        this.registry.intersectionsAt(
          input.point,
          previous ? DirectTouch.EXIT_PADDING : 0,
          previous?.resolved.hitObject
        ),
        'direct-touch'
      );

      if (this.awaitingExit.has(input.controller)) {
        if (!resolved) this.awaitingExit.delete(input.controller);
        continue;
      }
      if (!previous && !resolved?.target) continue;

      const snapshot = createSnapshot(input);

      if (!previous && resolved?.target) {
        const active = {
          resolved,
          handIndex: input.handIndex,
          hand: input.hand,
          point: input.point.clone(),
          snapshot,
        };
        this.active.set(input.controller, active);
        this.snapshots.set(input.controller, snapshot);
        contacts.push({
          phase: 'start',
          controller: input.controller,
          snapshot,
          resolved,
          handIndex: input.handIndex,
          hand: input.hand,
          point: input.point.clone(),
          selected: input.selected,
        });
      } else if (
        previous &&
        resolved &&
        resolved.target === previous.resolved.target
      ) {
        previous.resolved = resolved;
        previous.point.copy(input.point);
        previous.snapshot = snapshot;
        this.snapshots.set(input.controller, snapshot);
        contacts.push({
          phase: 'move',
          controller: input.controller,
          snapshot,
          resolved,
          previous: previous.resolved,
          handIndex: input.handIndex,
          hand: input.hand,
          point: input.point.clone(),
          selected: input.selected,
        });
      } else if (previous) {
        if (resolved) this.awaitingExit.add(input.controller);
        contacts.push(
          this.endContact(
            input.controller,
            input.selected,
            resolved?.target ? 'target-changed' : 'left-target',
            snapshot,
            input.handIndex,
            input.hand,
            input.point
          )
        );
      }
    }
    for (const controller of [...this.active.keys()]) {
      if (!present.has(controller)) {
        contacts.push(this.endContact(controller, false, 'source-lost'));
      }
    }
    for (const controller of this.awaitingExit) {
      if (!present.has(controller)) this.awaitingExit.delete(controller);
    }
    return contacts;
  }

  remove(controller: Controller): DirectTouchContact | undefined {
    this.awaitingExit.delete(controller);
    return this.active.has(controller)
      ? this.endContact(controller, false, 'source-lost')
      : undefined;
  }

  has(controller: Controller): boolean {
    return this.active.has(controller);
  }

  getSnapshot(controller: Controller): InteractionSourceSnapshot | undefined {
    return this.snapshots.get(controller);
  }

  clear(): void {
    this.active.clear();
    this.awaitingExit.clear();
    this.snapshots.clear();
  }

  private endContact(
    controller: Controller,
    selected: boolean,
    endReason: NonNullable<DirectTouchContact['endReason']>,
    finalSnapshot?: InteractionSourceSnapshot,
    handIndex?: number,
    hand?: THREE.Object3D,
    point?: THREE.Vector3
  ): DirectTouchContact {
    const previous = this.active.get(controller)!;
    this.active.delete(controller);
    this.snapshots.delete(controller);
    return {
      phase: 'end',
      controller,
      snapshot: finalSnapshot ?? previous.snapshot,
      previous: previous.resolved,
      handIndex: handIndex ?? previous.handIndex,
      hand: hand ?? previous.hand,
      point: point?.clone() ?? previous.point.clone(),
      selected,
      endReason,
    };
  }
}

function createSnapshot(input: DirectTouchInput): InteractionSourceSnapshot {
  const orientation = input.orientation?.clone() ?? new THREE.Quaternion();
  if (!input.orientation) input.controller.getWorldQuaternion(orientation);
  return Object.freeze({
    source: getInteractionSource(input.controller, 'direct-touch'),
    controller: input.controller,
    sourceType: 'direct-touch' as const,
    position: input.point.clone(),
    orientation,
    selected: true,
  });
}
