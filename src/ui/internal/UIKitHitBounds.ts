import * as THREE from 'three';

import type {HitBoundsSource} from '../../interaction/HitBoundsSource';

const LOCAL_PANEL_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-0.5, -0.5, 0),
  new THREE.Vector3(0.5, 0.5, 0)
);

type UIKitHitObject = THREE.Object3D & {
  readonly size?: {readonly value?: readonly [number, number]};
};

/** Adapts UIKit's signal-driven panel transform to HitRegistry bounds. */
export function createUIKitHitBoundsSource(
  physical: UIKitHitObject
): HitBoundsSource {
  return {
    writeWorldBounds(target) {
      if (!physical.size?.value) {
        target.makeEmpty();
        return false;
      }
      physical.updateWorldMatrix(true, false);
      target.copy(LOCAL_PANEL_BOUNDS).applyMatrix4(physical.matrixWorld);
      return !target.isEmpty();
    },
  };
}
