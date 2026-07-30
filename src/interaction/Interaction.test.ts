import * as THREE from 'three';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {ReticleOptions} from '../core/Options.js';
import type {Controller} from '../input/Controller.js';
import {Reticle} from './reticle/Reticle.js';
import {Interaction} from './Interaction.js';
import {
  activateSemanticControl,
  registerSemanticControl,
} from './SemanticControl.js';
import {
  DirectTouchInput,
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

function updateRays(
  interaction: Interaction,
  raySources: readonly RaySourceInput[],
  deltaSeconds = 0
): void {
  interaction.update({raySources, directTouches: []}, deltaSeconds);
}

function updateTouches(
  interaction: Interaction,
  directTouches: readonly DirectTouchInput[]
): void {
  interaction.update({raySources: [], directTouches});
}

class TestCallbacks implements InteractionCallbackDispatch {
  readonly calls: string[] = [];
  readonly arguments: Array<{key: string; argument: unknown}> = [];
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
    this.arguments.push({key, argument});
    if (hook === 'onObjectTouchStart' && this.preventTouch) {
      (argument as {preventDefault(): void}).preventDefault();
    }
    return this.returns.get(key);
  }

  invokeGlobal(hook: GlobalInteractionHook): void {
    this.calls.push(`global:${hook}`);
  }

  invokeSemantic(object: THREE.Object3D): boolean {
    this.calls.push(`${object.name}:onClick`);
    return activateSemanticControl(object);
  }
}

class TestManipulation implements InteractionManipulation {
  readonly calls: string[] = [];
  readonly updates: InteractionSourceSnapshot[][] = [];
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
  update(snapshots: Iterable<InteractionSourceSnapshot>): void {
    this.calls.push('update');
    this.updates.push([...snapshots]);
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

    updateRays(interaction, [
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

    updateRays(interaction, [input(source, [hit(child)])]);

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

    updateRays(interaction, [input(source, [hit(first)])]);
    callbacks.calls.length = 0;
    updateRays(interaction, [input(source, [hit(second)])]);

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

    updateRays(interaction, [input(source, [hit(child)])]);
    expect(callbacks.calls).toContain('parent:onHoverEnter');

    interaction.removeSource(source);
    callbacks.calls.length = 0;
    callbacks.returns.set('child:onHoverEnter', true);
    updateRays(interaction, [input(source, [hit(child)])]);
    expect(callbacks.calls).not.toContain('parent:onHoverEnter');
  });

  it('keeps the original Select path captured when release misses', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);

    updateRays(interaction, [input(source, [hit(target)])]);
    callbacks.calls.length = 0;
    manipulation.calls.length = 0;
    updateRays(interaction, [input(source, [hit(target)], true)]);
    updateRays(interaction, [input(source, [])]);

    expect(callbacks.calls).toEqual([
      'target:onHovering',
      'target:onObjectSelectStart',
      'global:onSelectStart',
      'global:onSelecting',
      'target:onHoverExit',
      'target:onObjectSelectEnd',
      'global:onSelect',
      'global:onSelectEnd',
    ]);
    expect(manipulation.calls).toEqual([
      'claimScale',
      'update',
      'update',
      'end',
    ]);
  });

  it('activates a semantic control only after release on the same control', () => {
    const target = new TestObject();
    target.name = 'button';
    const onClick = vi.fn();
    registerSemanticControl(target, {
      isDisabled: () => false,
      activate: onClick,
    });
    callbacks.scripts.add(target);
    callbacks.targets.add(target);

    updateRays(interaction, [input(source, [hit(target)])]);
    updateRays(interaction, [input(source, [hit(target)], true)]);
    updateRays(interaction, [input(source, [hit(target)])]);
    expect(onClick).toHaveBeenCalledTimes(1);

    updateRays(interaction, [input(source, [hit(target)], true)]);
    updateRays(interaction, [input(source, [])]);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('fires long select once on the captured target path', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);

    updateRays(interaction, [input(source, [hit(target)])]);
    callbacks.calls.length = 0;
    callbacks.arguments.length = 0;

    updateRays(interaction, [input(source, [hit(target)], true)], 0.25);
    expect(callbacks.calls).not.toContain('target:onObjectLongSelect');

    updateRays(interaction, [input(source, [], true)], 0.5);
    updateRays(interaction, [input(source, [], true)], 1);

    expect(
      callbacks.calls.filter((call) => call === 'target:onObjectLongSelect')
    ).toHaveLength(1);
    expect(
      callbacks.arguments.find(({key}) => key === 'target:onObjectLongSelect')
        ?.argument
    ).toEqual({target: source, duration: 0.75});
  });

  it('cancels long select when the source releases before the delay', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);

    updateRays(interaction, [input(source, [hit(target)])]);
    updateRays(interaction, [input(source, [hit(target)], true)], 0.25);
    updateRays(interaction, [input(source, [hit(target)])], 1);

    expect(callbacks.calls).not.toContain('target:onObjectLongSelect');
  });

  it('does not fire long select when manipulation claims the capture', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);
    manipulation.resolution = {owner: target};

    updateRays(interaction, [input(source, [hit(target)])]);
    updateRays(interaction, [input(source, [hit(target)], true)], 1);

    expect(manipulation.calls).toContain('start');
    expect(callbacks.calls).not.toContain('target:onObjectLongSelect');
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
    updateRays(interaction, [input(source, [hit(target)])]);
    callbacks.calls.length = 0;

    updateRays(interaction, [input(source, [hit(target)], true)]);
    updateRays(interaction, [input(source, [hit(target)])]);

    expect(callbacks.calls).toEqual([
      'target:onHovering',
      'target:onObjectSelectStart',
      'manipulation:start',
      'global:onSelectStart',
      'global:onSelecting',
      'target:onHovering',
      'manipulation:end',
      'target:onObjectSelectEnd',
      'global:onSelect',
      'global:onSelectEnd',
    ]);
  });

  it('completes stable gaze dwell once and rearms after leaving the target', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);
    const gazeInput = (distance: number) => ({
      ...input(source, [hit(target, distance)]),
      sourceType: 'gaze' as const,
    });
    const selectionCalls = () =>
      callbacks.calls.filter((call) => call.includes('Select'));

    updateRays(interaction, [gazeInput(1)], 1);
    updateRays(interaction, [gazeInput(2)], 1);
    expect(selectionCalls()).toEqual([]);

    updateRays(interaction, [gazeInput(2)], 2);
    expect(selectionCalls()).toEqual([
      'target:onObjectSelectStart',
      'global:onSelectStart',
      'target:onObjectSelectEnd',
      'global:onSelect',
      'global:onSelectEnd',
    ]);

    updateRays(interaction, [gazeInput(2)], 2);
    expect(selectionCalls()).toHaveLength(5);

    updateRays(interaction, [{...input(source, []), sourceType: 'gaze'}], 2);
    updateRays(interaction, [gazeInput(2)], 2);
    updateRays(interaction, [gazeInput(2)], 2);
    expect(selectionCalls()).toHaveLength(10);
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
      selected: false,
    };

    updateTouches(interaction, [touch]);
    updateTouches(interaction, [
      {...touch, point: new THREE.Vector3(0.2, 0, -1)},
    ]);
    updateTouches(interaction, [{...touch, intersections: []}]);

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

  it('updates manipulation once with every active source snapshot', () => {
    const rayTarget = new TestObject();
    rayTarget.name = 'ray';
    const touchTarget = new TestObject();
    touchTarget.name = 'touch';
    callbacks.scripts.add(rayTarget);
    callbacks.targets.add(rayTarget);
    callbacks.scripts.add(touchTarget);
    callbacks.targets.add(touchTarget);

    const touchSource = controller();
    const touch: DirectTouchInput = {
      controller: touchSource,
      handIndex: 0,
      point: new THREE.Vector3(),
      intersections: [hit(touchTarget)],
      selected: false,
    };
    updateTouches(interaction, [touch]);
    manipulation.calls.length = 0;
    manipulation.updates.length = 0;

    interaction.update({
      raySources: [input(source, [hit(rayTarget)])],
      directTouches: [touch],
    });

    expect(manipulation.calls).toEqual(['update']);
    expect(manipulation.updates[0]).toHaveLength(2);
    expect(
      manipulation.updates[0].map((snapshot) => snapshot.sourceType)
    ).toEqual(['controller-ray', 'direct-touch']);
  });

  it('activates a semantic control after direct touch completes', () => {
    const target = new TestObject();
    target.name = 'button';
    const onClick = vi.fn();
    registerSemanticControl(target, {
      isDisabled: () => false,
      activate: onClick,
    });
    callbacks.scripts.add(target);
    callbacks.targets.add(target);
    const touch: DirectTouchInput = {
      controller: source,
      handIndex: 0,
      point: new THREE.Vector3(),
      intersections: [hit(target)],
      selected: false,
    };

    updateTouches(interaction, [touch]);
    updateTouches(interaction, [{...touch, intersections: []}]);

    expect(onClick).toHaveBeenCalledOnce();
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
      selected: false,
    };

    updateTouches(interaction, [touch]);
    updateTouches(interaction, [{...touch, intersections: []}]);

    expect(callbacks.calls).toEqual([
      'target:onObjectTouchStart',
      'target:onObjectTouchEnd',
    ]);
    expect(manipulation.calls).toEqual([]);
  });

  it('cancels direct touch when its tracked source disappears', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);
    manipulation.resolution = {owner: target};
    updateTouches(interaction, [
      {
        controller: source,
        handIndex: 0,
        point: new THREE.Vector3(0, 0, -1),
        intersections: [hit(target)],
        selected: false,
      },
    ]);
    callbacks.calls.length = 0;
    manipulation.calls.length = 0;

    updateTouches(interaction, []);

    expect(callbacks.calls).toEqual([
      'target:onObjectTouchEnd',
      'target:onObjectSelectEnd',
      'global:onSelectEnd',
    ]);
    expect(manipulation.calls).toEqual(['cancel']);
  });

  it('dispatches a balanced grab while direct touch and pinch overlap', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);
    const hand = new THREE.Object3D();
    const touch = {
      controller: source,
      handIndex: 0,
      hand,
      point: new THREE.Vector3(0, 0, -1),
      intersections: [hit(target)],
      selected: false,
    };

    updateTouches(interaction, [touch]);
    updateTouches(interaction, [{...touch, selected: true}]);
    updateTouches(interaction, [{...touch, selected: true}]);
    updateTouches(interaction, [touch]);
    updateTouches(interaction, [{...touch, intersections: []}]);

    expect(callbacks.calls).toEqual([
      'target:onObjectTouchStart',
      'target:onObjectSelectStart',
      'global:onSelectStart',
      'target:onObjectTouching',
      'target:onObjectGrabStart',
      'global:onSelecting',
      'target:onObjectTouching',
      'target:onObjectGrabbing',
      'global:onSelecting',
      'target:onObjectTouching',
      'target:onObjectGrabEnd',
      'global:onSelecting',
      'target:onObjectTouchEnd',
      'target:onObjectSelectEnd',
      'global:onSelect',
      'global:onSelectEnd',
    ]);
  });

  it('cancels capture when a new interaction barrier blocks its owner', () => {
    const owner = new TestObject();
    owner.name = 'owner';
    const surface = new TestObject();
    owner.add(surface);
    callbacks.scripts.add(owner);
    callbacks.targets.add(owner);
    manipulation.resolution = {owner};

    updateRays(interaction, [input(source, [hit(surface)])]);
    updateRays(interaction, [input(source, [hit(surface)], true)]);
    callbacks.calls.length = 0;
    manipulation.calls.length = 0;
    surface.interactionEnabled = false;
    updateRays(interaction, [input(source, [hit(surface)], true)]);

    expect(manipulation.calls).toContain('cancel');
    expect(callbacks.calls).toContain('owner:onObjectSelectEnd');
    expect(callbacks.calls).toContain('global:onSelectEnd');
  });

  it('cancels a hidden captured target exactly once without completion', () => {
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);

    updateRays(interaction, [input(source, [hit(target)])]);
    updateRays(interaction, [input(source, [hit(target)], true)]);
    callbacks.calls.length = 0;
    manipulation.calls.length = 0;
    target.visible = false;
    updateRays(interaction, [input(source, [hit(target)], true)]);
    updateRays(interaction, [input(source, [hit(target)], true)]);
    updateRays(interaction, [input(source, [hit(target)])]);

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

  it('does not show the reticle while a canceled source is suppressed', () => {
    const reticle = new Reticle(0);
    source.reticle = reticle;
    interaction = new Interaction({
      callbacks,
      manipulation,
    });
    const target = new TestObject();
    callbacks.scripts.add(target);
    callbacks.targets.add(target);
    updateRays(interaction, [input(source, [hit(target)])]);
    updateRays(interaction, [input(source, [hit(target)], true)]);
    target.visible = false;

    updateRays(interaction, [input(source, [], true)]);

    expect(reticle.visible).toBe(false);
  });

  it('copies physical source state instead of retaining adapter values', () => {
    const ray = new THREE.Ray(
      new THREE.Vector3(1, 2, 3),
      new THREE.Vector3(0, 0, -1)
    );
    updateRays(interaction, [
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
    updateRays(interaction, [input(source, [hit(target)])]);
    callbacks.calls.length = 0;

    updateRays(interaction, [input(source, [hit(target)], true)]);
    updateRays(interaction, [input(source, [hit(target)])]);

    expect(callbacks.calls).toEqual([
      'target:onHovering',
      'global:onSelectStart',
      'global:onSelecting',
      'target:onHovering',
      'global:onSelect',
      'global:onSelectEnd',
    ]);
    expect(manipulation.calls).toContain('end');
  });

  it('presents only resolved hits', () => {
    const reticle = new Reticle(0);
    source.reticle = reticle;
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);

    updateRays(interaction, [input(source, [hit(target)])]);
    expect(reticle.visible).toBe(true);
    expect(reticle.targetObject).toBe(target);
    expect(reticle.position.toArray()).toEqual([0, 0, -1]);
    target.reticleMode = 'hidden';
    updateRays(interaction, [input(source, [hit(target)])]);
    expect(reticle.visible).toBe(false);
    expect(reticle.targetObject).toBeUndefined();
  });

  it('uses the default render distance for hits beyond the maximum', () => {
    const reticle = new Reticle(0);
    source.reticle = reticle;
    const reticleOptions = new ReticleOptions();
    reticleOptions.maxDistance = 2;
    reticleOptions.defaultRenderDistance = 1;
    interaction = new Interaction({
      callbacks,
      manipulation,
      reticleOptions,
    });
    const target = new TestObject();
    target.name = 'target';
    callbacks.scripts.add(target);
    callbacks.targets.add(target);

    updateRays(interaction, [input(source, [hit(target, 1.5)])]);

    expect(reticle.visible).toBe(true);
    expect(reticle.targetObject).toBe(target);

    updateRays(interaction, [input(source, [hit(target, 2)])]);

    expect(reticle.visible).toBe(true);
    expect(reticle.position.toArray()).toEqual([0, 0, -1]);
    expect(reticle.targetObject).toBeUndefined();
    expect(callbacks.calls).toContain('target:onHoverExit');
  });
});
