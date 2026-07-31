import * as THREE from 'three';
import {beforeEach, describe, expect, it} from 'vitest';

import {Script} from '../../core/Script';
import type {Controller} from '../../input/Controller';
import type {
  InteractionSourceSnapshot,
  SelectionCapture,
} from '../InteractionTypes';
import {ManipulationManager} from './ManipulationManager';
import {ManipulationAction, type ManipulationEvent} from './ManipulationTypes';

function controller(): Controller {
  return new THREE.Object3D() as Controller;
}

function snapshot(
  source: Controller,
  position = new THREE.Vector3(),
  sourceType: InteractionSourceSnapshot['sourceType'] = 'controller-ray'
): InteractionSourceSnapshot {
  return {
    controller: source,
    sourceType,
    position,
    orientation: new THREE.Quaternion(),
    selected: true,
  };
}

function capture(
  source: Controller,
  surface: THREE.Object3D,
  scriptPath: readonly Script[] = []
): SelectionCapture {
  return {
    source,
    surface,
    owner: surface,
    point: surface.getWorldPosition(new THREE.Vector3()),
    scriptPath,
  };
}

describe('ManipulationManager resolution', () => {
  const manager = new ManipulationManager(() => {});

  it('normalizes true and does not merge defaults into explicit options', () => {
    const shorthand = new THREE.Object3D();
    shorthand.xb = {manipulation: true};
    expect(manager.resolve(shorthand)).toEqual({
      owner: shorthand,
      action: ManipulationAction.Translate,
    });

    const scaleOnly = new THREE.Object3D();
    scaleOnly.xb = {manipulation: {actions: {scale: true}}};
    expect(manager.resolve(scaleOnly)).toEqual({owner: scaleOnly});

    const rotateOnly = new THREE.Object3D();
    rotateOnly.xb = {manipulation: {actions: {rotate: true}}};
    expect(manager.resolve(rotateOnly)).toEqual({
      owner: rotateOnly,
      action: ManipulationAction.Rotate,
    });
  });

  it.each(['cylindrical', 'spherical'] as const)(
    'uses the %s camera-facing mode while translating',
    (mode) => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 3, 4);
      const localManager = new ManipulationManager(() => {}, camera);
      const owner = new THREE.Object3D();
      owner.position.set(0, 1, 0);
      owner.xb = {
        manipulation: {
          actions: {translate: {faceCamera: true, mode}},
        },
      };
      const source = controller();

      expect(
        localManager.tryStart(
          capture(source, owner),
          snapshot(source, new THREE.Vector3())
        )
      ).toBe(true);
      localManager.update([snapshot(source, new THREE.Vector3(0.25, 0, 0))]);
      owner.updateWorldMatrix(true, false);

      const target = camera.position.clone();
      if (mode === 'cylindrical') target.y = owner.position.y;
      const expected = new THREE.Object3D();
      expected.position.copy(owner.getWorldPosition(new THREE.Vector3()));
      expected.lookAt(target);

      expect(
        Math.abs(
          owner
            .getWorldQuaternion(new THREE.Quaternion())
            .dot(expected.quaternion)
        )
      ).toBeCloseTo(1);
      localManager.end(source);
    }
  );

  it('smooths camera-facing rotation during translation', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 3, 4);
    const timer = {getDelta: () => 1 / 60} as THREE.Timer;
    const localManager = new ManipulationManager(() => {}, camera, timer);
    const owner = new THREE.Object3D();
    owner.xb = {
      manipulation: {
        actions: {translate: {faceCamera: true}},
      },
    };
    const source = controller();

    expect(
      localManager.tryStart(
        capture(source, owner),
        snapshot(source, new THREE.Vector3())
      )
    ).toBe(true);
    localManager.update([snapshot(source, new THREE.Vector3(0.25, 0, 0))]);

    const target = camera.position.clone();
    target.y = owner.position.y;
    const exact = new THREE.Object3D();
    exact.position.copy(owner.position);
    exact.lookAt(target);
    const expected = new THREE.Quaternion().slerp(
      exact.quaternion,
      1 - Math.exp(-0.1)
    );

    expect(Math.abs(owner.quaternion.dot(expected))).toBeCloseTo(1);
    expect(Math.abs(owner.quaternion.dot(exact.quaternion))).toBeLessThan(1);
    localManager.end(source);
  });

  it('uses the nearest handle and stops at the nearest owner seam', () => {
    const outer = new THREE.Object3D();
    outer.xb = {manipulation: true};
    const inner = new THREE.Object3D();
    inner.xb = {manipulation: {actions: {rotate: true}}};
    const handle = new THREE.Object3D();
    handle.xb = {
      manipulationHandle: {action: ManipulationAction.Translate},
    };
    outer.add(inner);
    inner.add(handle);

    expect(manager.resolve(handle)).toBeUndefined();
    handle.xb = {
      manipulationHandle: {action: ManipulationAction.Rotate},
    };
    expect(manager.resolve(handle)).toEqual({
      owner: inner,
      action: ManipulationAction.Rotate,
    });
    handle.xb = {manipulationHandle: 'none'};
    expect(manager.resolve(handle)).toBeUndefined();
  });

  it('rejects ambiguous owner handles and objects with both roles', () => {
    const ambiguous = new THREE.Object3D();
    ambiguous.xb = {
      manipulation: {actions: {translate: true, rotate: true}},
    };
    expect(manager.resolve(ambiguous)).toBeUndefined();

    ambiguous.xb.manipulationHandle = {
      action: ManipulationAction.Translate,
    };
    expect(manager.resolve(ambiguous)).toBeUndefined();
  });

  it('rejects invalid runtime handle actions', () => {
    const owner = new THREE.Object3D();
    owner.xb = {
      manipulation: {
        actions: {scale: true},
        handle: {action: 'spin' as typeof ManipulationAction.Scale},
      },
    };
    const source = controller();

    expect(manager.resolve(owner)).toBeUndefined();
    expect(manager.tryStart(capture(source, owner), snapshot(source))).toBe(
      false
    );

    const child = new THREE.Object3D();
    child.xb = {
      manipulationHandle: {
        action: 'spin' as typeof ManipulationAction.Scale,
      },
    };
    const validOwner = new THREE.Object3D();
    validOwner.xb = {manipulation: true};
    validOwner.add(child);
    expect(manager.resolve(child)).toBeUndefined();
  });
});

describe('ManipulationManager sessions', () => {
  let events: ManipulationEvent[];
  let script: Script;
  let manager: ManipulationManager;

  beforeEach(() => {
    events = [];
    script = new Script();
    manager = new ManipulationManager((_script, event) => {
      events.push(event);
    });
  });

  it('does not start manipulation from gaze', () => {
    const owner = new THREE.Object3D();
    owner.xb = {manipulation: true};
    const source = controller();

    expect(
      manager.tryStart(
        capture(source, owner),
        snapshot(source, undefined, 'gaze')
      )
    ).toBe(false);
    expect(manager.isManipulating(owner)).toBe(false);
  });

  it('does not claim a source when Rotate options are invalid', () => {
    const owner = new THREE.Object3D();
    owner.xb = {
      manipulation: {
        actions: {rotate: {axis: {x: 0, y: 0, z: 0}}},
      },
    };
    const source = controller();

    expect(manager.tryStart(capture(source, owner), snapshot(source))).toBe(
      false
    );
    expect(manager.isManipulating(owner)).toBe(false);

    const validOwner = new THREE.Object3D();
    validOwner.xb = {manipulation: true};
    expect(
      manager.tryStart(capture(source, validOwner), snapshot(source))
    ).toBe(true);
  });

  it('translates in world space under a transformed parent', () => {
    const parent = new THREE.Object3D();
    parent.position.set(4, 2, -1);
    parent.rotation.y = Math.PI / 2;
    parent.scale.setScalar(2);
    const owner = new THREE.Object3D();
    owner.position.set(1, 0, 0);
    owner.xb = {manipulation: {actions: {translate: true}}};
    parent.add(owner);
    parent.updateWorldMatrix(true, true);

    const source = controller();
    const initialWorld = owner.getWorldPosition(new THREE.Vector3());
    expect(
      manager.tryStart(capture(source, owner, [script]), snapshot(source))
    ).toBe(true);
    manager.update([snapshot(source, new THREE.Vector3(1.5, -0.5, 2))]);

    expect(owner.getWorldPosition(new THREE.Vector3()).toArray()).toEqual(
      initialWorld.add(new THREE.Vector3(1.5, -0.5, 2)).toArray()
    );
    expect(events.map((event) => event.phase)).toEqual(['start', 'update']);
  });

  it('translates from direct fingertip movement without a ray', () => {
    const owner = new THREE.Object3D();
    owner.xb = {manipulation: {actions: {translate: true}}};
    const source = controller();

    manager.tryStart(
      capture(source, owner),
      snapshot(source, new THREE.Vector3(), 'direct-touch')
    );
    manager.update([
      snapshot(source, new THREE.Vector3(0.25, 0.1, 0), 'direct-touch'),
    ]);

    expect(owner.position.toArray()).toEqual([0.25, 0.1, 0]);
  });

  it('preserves ray grab depth and offset', () => {
    const owner = new THREE.Object3D();
    owner.position.set(1, 0, -3);
    owner.xb = {manipulation: true};
    const source = controller();
    const start = snapshot(source);
    start.ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    const selected = capture(source, owner);
    selected.point.set(0, 0, -3);
    manager.tryStart(selected, start);

    const moved = snapshot(source);
    moved.ray = new THREE.Ray(
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(0, 0, -1)
    );
    manager.update([moved]);
    expect(owner.position.toArray()).toEqual([3, 0, -3]);
  });

  it('rotates around a world axis under a rotated parent', () => {
    const parent = new THREE.Object3D();
    parent.rotation.z = 0.4;
    const owner = new THREE.Object3D();
    owner.rotation.x = 0.2;
    owner.xb = {
      manipulation: {
        actions: {rotate: {axis: 'y', space: 'world', sensitivity: 1}},
      },
    };
    parent.add(owner);
    parent.updateWorldMatrix(true, true);
    const baselineWorld = owner.getWorldQuaternion(new THREE.Quaternion());
    const source = controller();
    manager.tryStart(capture(source, owner), snapshot(source));
    manager.update([snapshot(source, new THREE.Vector3(0.5, 0, 0))]);
    parent.updateWorldMatrix(true, true);

    const expected = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5)
      .multiply(baselineWorld);
    expect(
      Math.abs(owner.getWorldQuaternion(new THREE.Quaternion()).dot(expected))
    ).toBeCloseTo(1);
  });

  it('rotates a fixed-position mouse source from its orientation', () => {
    const owner = new THREE.Object3D();
    owner.xb = {
      manipulation: {
        actions: {rotate: {axis: 'y', space: 'world', sensitivity: 2}},
      },
    };
    const source = controller();
    const start = snapshot(source, new THREE.Vector3(), 'mouse');
    const moved = snapshot(source, new THREE.Vector3(), 'mouse');
    moved.orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.25);

    manager.tryStart(capture(source, owner), start);
    manager.update([moved]);

    const expected = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -0.5
    );
    expect(Math.abs(owner.quaternion.dot(expected))).toBeCloseTo(1);
  });

  it('claims Scale anywhere and balances phases when it restarts primary', () => {
    const owner = new THREE.Object3D();
    owner.xb = {manipulation: true};
    const primary = controller();
    const auxiliary = controller();
    manager.tryStart(
      capture(primary, owner, [script]),
      snapshot(primary, new THREE.Vector3(0, 0, 0))
    );
    expect(
      manager.tryClaimScale(snapshot(auxiliary, new THREE.Vector3(1, 0, 0)))
    ).toBe(true);
    manager.update([
      snapshot(primary, new THREE.Vector3(0, 0, 0)),
      snapshot(auxiliary, new THREE.Vector3(2, 0, 0)),
    ]);
    expect(owner.scale.toArray()).toEqual([2, 2, 2]);
    manager.end(auxiliary);
    manager.end(primary);

    expect(events.map((event) => `${event.action}:${event.phase}`)).toEqual([
      'translate:start',
      'translate:end',
      'scale:start',
      'scale:update',
      'scale:end',
      'translate:start',
      'translate:end',
    ]);
  });

  it('preserves primary manipulation when Scale cannot start', () => {
    const owner = new THREE.Object3D();
    owner.xb = {manipulation: true};
    const primary = controller();
    const auxiliary = controller();
    manager.tryStart(capture(primary, owner, [script]), snapshot(primary));

    expect(manager.tryClaimScale(snapshot(auxiliary))).toBe(false);
    manager.update([snapshot(primary, new THREE.Vector3(1, 0, 0))]);

    expect(owner.position.toArray()).toEqual([1, 0, 0]);
    expect(events.map((event) => event.phase)).toEqual(['start', 'update']);

    const other = new THREE.Object3D();
    other.xb = {manipulation: true};
    expect(
      manager.tryStart(capture(auxiliary, other), snapshot(auxiliary))
    ).toBe(true);
  });

  it('does not claim Scale when its limits are invalid', () => {
    const owner = new THREE.Object3D();
    owner.xb = {
      manipulation: {
        actions: {
          translate: true,
          scale: {minScale: 2, maxScale: 1},
        },
        handle: {action: ManipulationAction.Translate},
      },
    };
    const primary = controller();
    const auxiliary = controller();
    manager.tryStart(capture(primary, owner, [script]), snapshot(primary));

    expect(
      manager.tryClaimScale(snapshot(auxiliary, new THREE.Vector3(1, 0, 0)))
    ).toBe(false);
    manager.update([snapshot(primary, new THREE.Vector3(1, 0, 0))]);
    expect(owner.position.toArray()).toEqual([1, 0, 0]);
    expect(events.map((event) => event.phase)).toEqual(['start', 'update']);

    const other = new THREE.Object3D();
    other.xb = {manipulation: true};
    expect(
      manager.tryStart(capture(auxiliary, other), snapshot(auxiliary))
    ).toBe(true);
  });

  it('ends a phase after an invalid update snapshot', () => {
    const owner = new THREE.Object3D();
    owner.xb = {manipulation: {actions: {scale: true}}};
    const primary = controller();
    const auxiliary = controller();
    manager.tryStart(
      capture(primary, owner, [script]),
      snapshot(primary, new THREE.Vector3())
    );
    manager.tryClaimScale(snapshot(auxiliary, new THREE.Vector3(1, 0, 0)));

    manager.update([
      snapshot(primary),
      snapshot(auxiliary, new THREE.Vector3(Infinity, 0, 0)),
    ]);
    manager.end(auxiliary);

    expect(events.map((event) => event.phase)).toEqual(['start', 'end']);
  });

  it('does not choose an arbitrary Scale owner and permits independent owners', () => {
    const first = new THREE.Object3D();
    first.xb = {manipulation: true};
    const second = new THREE.Object3D();
    second.xb = {manipulation: true};
    const a = controller();
    const b = controller();
    const c = controller();
    manager.tryStart(capture(a, first), snapshot(a));
    manager.tryStart(capture(b, second), snapshot(b));

    expect(manager.tryClaimScale(snapshot(c))).toBe(false);
    expect(manager.isManipulating(first)).toBe(true);
    expect(manager.isManipulating(second)).toBe(true);
  });

  it('keeps prevented phases captured without applying the transform', () => {
    manager = new ManipulationManager((_script, event) => {
      events.push(event);
      if (event.phase === 'start') event.preventDefault();
    });
    const owner = new THREE.Object3D();
    owner.xb = {manipulation: {actions: {translate: true}}};
    const source = controller();
    manager.tryStart(capture(source, owner, [script]), snapshot(source));
    manager.update([snapshot(source, new THREE.Vector3(2, 0, 0))]);
    manager.end(source);

    expect(owner.position.toArray()).toEqual([0, 0, 0]);
    expect(events.map((event) => event.phase)).toEqual([
      'start',
      'update',
      'end',
    ]);
    expect(events.every((event) => event.defaultPrevented)).toBe(true);
  });

  it('clamps absolute scale and ignores invalid distances', () => {
    const owner = new THREE.Object3D();
    owner.scale.set(1, 2, 4);
    owner.xb = {
      manipulation: {
        actions: {scale: {minScale: 0.5, maxScale: {x: 2, y: 3, z: 5}}},
      },
    };
    const primary = controller();
    const auxiliary = controller();
    manager.tryStart(capture(primary, owner), snapshot(primary));
    manager.tryClaimScale(snapshot(auxiliary, new THREE.Vector3(1, 0, 0)));
    manager.update([
      snapshot(primary),
      snapshot(auxiliary, new THREE.Vector3(10, 0, 0)),
    ]);
    expect(owner.scale.toArray()).toEqual([1.25, 2.5, 5]);

    const invalid = new THREE.Object3D();
    invalid.scale.set(0, 1, 1);
    invalid.xb = {manipulation: {actions: {scale: true}}};
    const p2 = controller();
    const a2 = controller();
    manager.tryStart(capture(p2, invalid), snapshot(p2));
    manager.tryClaimScale(snapshot(a2));
    manager.update([
      snapshot(p2),
      snapshot(a2, new THREE.Vector3(Infinity, 0, 0)),
    ]);
    expect(invalid.scale.toArray()).toEqual([0, 1, 1]);
  });

  it('suppresses an auxiliary source until release after primary ends', () => {
    const owner = new THREE.Object3D();
    owner.xb = {manipulation: true};
    const primary = controller();
    const auxiliary = controller();
    manager.tryStart(capture(primary, owner), snapshot(primary));
    manager.tryClaimScale(snapshot(auxiliary, new THREE.Vector3(1, 0, 0)));
    manager.end(primary);

    const other = new THREE.Object3D();
    other.xb = {manipulation: true};
    expect(
      manager.tryStart(capture(auxiliary, other), snapshot(auxiliary))
    ).toBe(false);
    expect(manager.end(auxiliary)).toBe(true);
    expect(
      manager.tryStart(capture(auxiliary, other), snapshot(auxiliary))
    ).toBe(true);
  });

  it('cancels once when an owner becomes invalid', () => {
    const owner = new THREE.Object3D();
    owner.xb = {manipulation: true};
    const source = controller();
    manager.tryStart(capture(source, owner, [script]), snapshot(source));
    owner.visible = false;
    manager.update([snapshot(source)]);
    manager.update([snapshot(source)]);

    expect(events.map((event) => event.phase)).toEqual(['start', 'cancel']);
    expect(manager.isManipulating(owner)).toBe(false);
  });

  it('runs simulator Scale intents through the same event and limits', () => {
    const owner = new THREE.Object3D();
    owner.xb = {
      manipulation: {actions: {scale: {minScale: 0.5, maxScale: 2}}},
    };
    const source = controller();
    expect(
      manager.applyScaleIntent(
        capture(source, owner, [script]),
        snapshot(source, new THREE.Vector3(), 'simulator'),
        3
      )
    ).toBe(true);
    expect(owner.scale.toArray()).toEqual([2, 2, 2]);
    expect(events.map((event) => event.phase)).toEqual([
      'start',
      'update',
      'end',
    ]);
  });
});
