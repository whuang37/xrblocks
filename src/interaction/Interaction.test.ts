import * as THREE from 'three';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import type {Controller} from '../input/Controller.js';
import {Reticle} from '../ui/core/Reticle.js';
import {Interaction} from './Interaction.js';
import {
  GlobalInteractionHook,
  InteractionCallbackDispatch,
  InteractionManipulation,
  InteractionSourceSnapshot,
  RaySourceInput,
  SelectionCapture,
  TargetedInteractionHook,
} from './InteractionTypes.js';

class TestObject extends THREE.Object3D {
  declare pointerEvents?: 'auto' | 'none';
  declare interactionEnabled?: boolean;
  declare reticleMode?: 'auto' | 'surface' | 'hidden';
  declare ux?: {update: ReturnType<typeof vi.fn>};
}

function hit(object: THREE.Object3D, distance = 1): THREE.Intersection {
  return {
    distance,
    object,
    point: new THREE.Vector3(0, 0, -distance),
    normal: new THREE.Vector3(0, 0, 1),
  };
}

function controller(): Controller {
  return new THREE.Object3D() as Controller;
}

function input(
  source: Controller,
  intersections: readonly THREE.Intersection[],
  selected = false
): RaySourceInput {
  return {
    controller: source,
    sourceType: 'controller-ray',
    ray: new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1)),
    intersections,
    selected,
  };
}

class TestCallbacks implements InteractionCallbackDispatch {
  readonly calls: string[] = [];
  readonly scripts = new Set<THREE.Object3D>();
  readonly targets = new Set<THREE.Object3D>();
  readonly returns = new Map<string, unknown>();
  preventTouch = false;

  isScript = (object: THREE.Object3D) => this.scripts.has(object);
  hasTargetHandler = (object: THREE.Object3D) => this.targets.has(object);

  invokeTarget(
    script: THREE.Object3D,
    hook: TargetedInteractionHook,
    argument: unknown
  ): unknown {
    const key = `${script.name}:${hook}`;
    this.calls.push(key);
    if (hook === 'onObjectTouchStart' && this.preventTouch) {
      (argument as {preventDefault(): void}).preventDefault();
    }
    return this.returns.get(key);
  }

  invokeGlobal(hook: GlobalInteractionHook): void {
    this.calls.push(`global:${hook}`);
  }
}

class TestManipulation implements InteractionManipulation {
  readonly calls: string[] = [];
  resolution?: {owner: THREE.Object3D};
  claimScale = false;

  resolve(): {owner: THREE.Object3D} | undefined {
    return this.resolution;
  }
  tryClaimScale(): boolean {
    this.calls.push('claimScale');
    return this.claimScale;
  }
  tryStart(_capture: SelectionCapture): boolean {
    this.calls.push('start');
    return true;
  }
  update(_snapshots: Iterable<InteractionSourceSnapshot>): void {
    this.calls.push('update');
  }
  end(): void {
    this.calls.push('end');
  }
  cancelSource(): void {
    this.calls.push('cancel');
  }
}

describe('Interaction', () => {
  let callbacks: TestCallbacks;
  let manipulation: TestManipulation;
  let interaction: Interaction;
  let source: Controller;

  beforeEach(() => {
    callbacks = new TestCallbacks();
    manipulation = new TestManipulation();
    interaction = new Interaction({callbacks, manipulation});
    source = controller();
  });

  it('skips excluded subtrees and stops logical resolution at a disabled barrier', () => {
    const hiddenParent = new TestObject();
    hiddenParent.visible = false;
    const hiddenChild = new TestObject();
    hiddenParent.add(hiddenChild);

    const ignoredParent = new TestObject();
    ignoredParent.pointerEvents = 'none';
    const ignoredChild = new TestObject();
    ignoredParent.add(ignoredChild);

    const disabled = new TestObject();
    disabled.interactionEnabled = false;
    const surface = new TestObject();
    disabled.add(surface);
    callbacks.scripts.add(disabled);
    callbacks.targets.add(disabled);

    interaction.updateRaySources([
      input(source, [hit(hiddenChild), hit(ignoredChild), hit(surface)]),
    ]);

    const resolved = interaction.getResolvedRay(source);
    expect(resolved?.surface).toBe(surface);
    expect(resolved?.target).toBeUndefined();
    expect(resolved?.scriptPath).toEqual([]);
  });

  it('allows a child target below a disabled barrier without propagating above it', () => {
    const ancestor = new TestObject();
    ancestor.name = 'ancestor';
    ancestor.interactionEnabled = false;
    const child = new TestObject();
    child.name = 'child';
    ancestor.add(child);
    callbacks.scripts.add(ancestor);
    callbacks.scripts.add(child);
    callbacks.targets.add(child);

    interaction.updateRaySources([input(source, [hit(child)])]);

    expect(interaction.getResolvedRay(source)?.target).toBe(child);
    expect(interaction.getResolvedRay(source)?.scriptPath).toEqual([child]);
    expect(callbacks.calls).not.toContain('ancestor:onHoverEnter');
  });

  it('diffs sibling hover paths without exiting or entering shared ancestors', () => {
    const parent = new TestObject();
    parent.name = 'parent';
    const first = new TestObject();
    first.name = 'first';
    const second = new TestObject();
    second.name = 'second';
    parent.add(first, second);
    for (const object of [first, second, parent]) callbacks.scripts.add(object);
    callbacks.targets.add(first);
    callbacks.targets.add(second);

    interaction.updateRaySources([input(source, [hit(first)])]);
    callbacks.calls.length = 0;
    interaction.updateRaySources([input(source, [hit(second)])]);

    expect(callbacks.calls).toEqual([
      'first:onHoverExit',
      'second:onHoverEnter',
      'second:onHovering',
      'parent:onHovering',
    ]);
  });

  it('stops targeted propagation only for literal true', () => {
    const parent = new TestObject();
    parent.name = 'parent';
    const child = new TestObject();
    child.name = 'child';
    parent.add(child);
    callbacks.scripts.add(child);
    callbacks.scripts.add(parent);
    callbacks.targets.add(child);
    callbacks.returns.set('child:onHoverEnter', {handled: true});

    interaction.updateRaySources([input(source, [hit(child)])]);
    expect(callbacks.calls).toContain('parent:onHoverEnter');

    interaction.removeSource(source);
    callbacks.calls.length = 0;
    callbacks.returns.set('child:onHoverEnter', true);
    interaction.updateRaySources([input(source, [hit(child)])]);
    expect(callbacks.calls).not.toContain('parent:onHoverEnter');
  });

  it('keeps the original Select path captured when release misses', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);

    interaction.updateRaySources([input(source, [hit(target)])]);
    callbacks.calls.length = 0;
    manipulation.calls.length = 0;
    interaction.selectStart(source);
    interaction.updateRaySources([input(source, [], true)]);
    interaction.selectEnd(source);

    expect(callbacks.calls).toEqual([
      'target:onObjectSelectStart',
      'global:onSelectStart',
      'target:onHoverExit',
      'global:onSelecting',
      'target:onObjectSelectEnd',
      'global:onSelect',
      'global:onSelectEnd',
    ]);
    expect(manipulation.calls).toEqual(['claimScale', 'update', 'end']);
  });

  it('orders manipulation between targeted and global Select callbacks', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);
    manipulation.resolution = {owner: target};
    vi.spyOn(manipulation, 'tryStart').mockImplementation(() => {
      callbacks.calls.push('manipulation:start');
      return true;
    });
    vi.spyOn(manipulation, 'end').mockImplementation(() => {
      callbacks.calls.push('manipulation:end');
    });
    interaction.updateRaySources([input(source, [hit(target)])]);
    callbacks.calls.length = 0;

    interaction.selectStart(source);
    interaction.selectEnd(source);

    expect(callbacks.calls).toEqual([
      'target:onObjectSelectStart',
      'manipulation:start',
      'global:onSelectStart',
      'manipulation:end',
      'target:onObjectSelectEnd',
      'global:onSelect',
      'global:onSelectEnd',
    ]);
  });

  it('captures one direct-touch target and synthesizes selection', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);
    manipulation.resolution = {owner: target};
    const touch = {
      controller: source,
      handIndex: 0,
      point: new THREE.Vector3(0, 0, -1),
      intersections: [hit(target)],
    };

    expect(interaction.updateDirectTouch(touch)).toBe(target);
    interaction.updateDirectTouch({
      ...touch,
      point: new THREE.Vector3(0.2, 0, -1),
    });
    interaction.updateDirectTouch({...touch, intersections: []});

    expect(callbacks.calls).toEqual([
      'target:onObjectTouchStart',
      'target:onObjectSelectStart',
      'global:onSelectStart',
      'target:onObjectTouching',
      'global:onSelecting',
      'target:onObjectTouchEnd',
      'target:onObjectSelectEnd',
      'global:onSelect',
      'global:onSelectEnd',
    ]);
    expect(manipulation.calls).toEqual(['start', 'update', 'end']);
  });

  it('keeps prevented direct touch callbacks without synthesized selection', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);
    manipulation.resolution = {owner: target};
    callbacks.preventTouch = true;
    const touch = {
      controller: source,
      handIndex: 0,
      point: new THREE.Vector3(0, 0, -1),
      intersections: [hit(target)],
    };

    interaction.updateDirectTouch(touch);
    interaction.updateDirectTouch({...touch, intersections: []});

    expect(callbacks.calls).toEqual([
      'target:onObjectTouchStart',
      'target:onObjectTouchEnd',
    ]);
    expect(manipulation.calls).toEqual([]);
  });

  it('cancels capture when a new interaction barrier blocks its owner', () => {
    const owner = new TestObject();
    owner.name = 'owner';
    const surface = new TestObject();
    owner.add(surface);
    callbacks.scripts.add(owner);
    callbacks.targets.add(owner);
    manipulation.resolution = {owner};

    interaction.updateRaySources([input(source, [hit(surface)])]);
    interaction.selectStart(source);
    callbacks.calls.length = 0;
    manipulation.calls.length = 0;
    surface.interactionEnabled = false;
    interaction.updateRaySources([input(source, [hit(surface)], true)]);

    expect(manipulation.calls).toContain('cancel');
    expect(callbacks.calls).toContain('owner:onObjectSelectEnd');
    expect(callbacks.calls).toContain('global:onSelectEnd');
  });

  it('cancels a hidden captured target exactly once without completion', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);

    interaction.updateRaySources([input(source, [hit(target)])]);
    interaction.selectStart(source);
    callbacks.calls.length = 0;
    manipulation.calls.length = 0;
    target.visible = false;
    interaction.updateRaySources([input(source, [hit(target)], true)]);
    interaction.updateRaySources([input(source, [hit(target)], true)]);
    interaction.selectEnd(source);

    expect(callbacks.calls).toEqual([
      'target:onObjectSelectEnd',
      'global:onSelectEnd',
      'target:onHoverExit',
    ]);
    expect(manipulation.calls.filter((call) => call === 'cancel')).toHaveLength(
      1
    );
    expect(callbacks.calls).not.toContain('global:onSelect');
  });

  it('does not show the miss fallback while a canceled source is suppressed', () => {
    const reticle = new Reticle(0);
    source.reticle = reticle;
    interaction = new Interaction({
      callbacks,
      manipulation,
      defaultReticleDistance: 2,
    });
    const target = new TestObject();
    callbacks.scripts.add(target);
    callbacks.targets.add(target);
    interaction.updateRaySources([input(source, [hit(target)])]);
    interaction.selectStart(source);
    target.visible = false;

    interaction.updateRaySources([input(source, [], true)]);

    expect(reticle.visible).toBe(false);
  });

  it('copies physical source state instead of retaining adapter values', () => {
    const ray = new THREE.Ray(
      new THREE.Vector3(1, 2, 3),
      new THREE.Vector3(0, 0, -1)
    );
    interaction.updateRaySources([
      {...input(source, []), ray, position: new THREE.Vector3(4, 5, 6)},
    ]);
    ray.origin.set(9, 9, 9);

    expect(interaction.getSourceSnapshot(source)?.ray.origin.toArray()).toEqual(
      [1, 2, 3]
    );
    expect(interaction.getSourceSnapshot(source)?.position.toArray()).toEqual([
      4, 5, 6,
    ]);
  });

  it('lets an auxiliary Scale claim bypass normal object callbacks', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);
    manipulation.claimScale = true;
    interaction.updateRaySources([input(source, [hit(target)])]);
    callbacks.calls.length = 0;

    interaction.selectStart(source);
    interaction.selectEnd(source);

    expect(callbacks.calls).toEqual([
      'global:onSelectStart',
      'global:onSelect',
      'global:onSelectEnd',
    ]);
    expect(manipulation.calls).toContain('end');
  });

  it('presents only resolved hits and keeps legacy UX as presentation state', () => {
    const reticle = new Reticle(0);
    source.reticle = reticle;
    const target = new TestObject();
    target.name = 'target';
    target.ux = {update: vi.fn()};
    callbacks.scripts.add(target);
    callbacks.targets.add(target);

    interaction.updateRaySources([input(source, [hit(target)])]);
    expect(reticle.visible).toBe(true);
    expect(reticle.targetObject).toBe(target);
    expect(reticle.position.toArray()).toEqual([0, 0, -1]);
    expect(target.ux.update).toHaveBeenCalledOnce();

    target.reticleMode = 'hidden';
    interaction.updateRaySources([input(source, [hit(target)])]);
    expect(reticle.visible).toBe(false);
    expect(reticle.targetObject).toBeUndefined();
  });

  it('uses the configured ray-facing fallback on a miss', () => {
    const reticle = new Reticle(0);
    source.reticle = reticle;
    interaction = new Interaction({
      callbacks,
      manipulation,
      defaultReticleDistance: 2,
    });

    interaction.updateRaySources([input(source, [])]);

    expect(reticle.visible).toBe(true);
    expect(reticle.position.toArray()).toEqual([0, 0, -2]);
    expect(reticle.targetObject).toBeUndefined();
  });
});
