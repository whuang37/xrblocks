import * as THREE from 'three';
import {describe, expect, it, vi} from 'vitest';

import {Registry} from '../core/components/Registry';
import {User} from '../core/User';
import {WaitFrame} from '../core/components/WaitFrame';

import {World} from './World';
import {WorldOptions} from './WorldOptions';

async function makeWorld() {
  const world = new World();
  const options = new WorldOptions();
  const registry = new Registry();
  registry.register(registry);
  await world.init({
    options,
    camera: new THREE.PerspectiveCamera(),
    registry,
    waitFrame: new WaitFrame(),
    timer: new THREE.Timer(),
  });
  return {world, registry};
}

describe('World', () => {
  describe('lookingAt', () => {
    it('throws when no User is registered', async () => {
      const {world} = await makeWorld();
      expect(() => world.lookingAt()).toThrow(/User/i);
    });

    it('returns the targeted object from User.getReticleTarget', async () => {
      const {world, registry} = await makeWorld();
      const target = new THREE.Object3D();
      const user = Object.create(User.prototype) as User;
      Object.assign(user, {
        getReticleTarget: vi.fn().mockReturnValue(target),
      });
      registry.register(user, User);
      expect(world.lookingAt()).toBe(target);
      expect(world.lookingAt(1)).toBe(target);
      expect(
        (user.getReticleTarget as ReturnType<typeof vi.fn>).mock.calls
      ).toEqual([[0], [1]]);
    });
  });
});
