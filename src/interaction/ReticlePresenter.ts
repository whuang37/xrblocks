import * as THREE from 'three';

import type {Controller} from '../input/Controller.js';
import type {
  InteractionSourceSnapshot,
  ResolvedRay,
  ReticlePresentationObserver,
} from './InteractionTypes.js';

interface LegacyUXOwner extends THREE.Object3D {
  ux?: {
    update(controller: THREE.Object3D, hit: THREE.Intersection): void;
  };
}

const NORMAL_MATRIX = new THREE.Matrix3();
const WORLD_NORMAL = new THREE.Vector3();

/** Presents resolved state. It never performs a raycast or changes targeting. */
export class ReticlePresenter implements ReticlePresentationObserver {
  constructor(public defaultDistance = 0) {}

  present(
    snapshot: InteractionSourceSnapshot,
    resolved: ResolvedRay | undefined
  ): void {
    const reticle = snapshot.controller.reticle;
    if (!reticle) return;
    const ray = snapshot.ray;
    if (!ray) {
      this.clear(snapshot.controller);
      return;
    }

    reticle.direction.copy(ray.direction).normalize();
    reticle.setPressed(snapshot.selected);

    if (resolved?.reticleMode === 'hidden') {
      this.clear(snapshot.controller);
      return;
    }

    if (!resolved) {
      reticle.intersection = undefined;
      reticle.targetObject = undefined;
      if (this.defaultDistance <= 0) {
        reticle.visible = false;
        return;
      }
      reticle.visible = true;
      reticle.position
        .copy(ray.origin)
        .addScaledVector(ray.direction, this.defaultDistance);
      WORLD_NORMAL.copy(ray.direction).negate().normalize();
      reticle.setRotationFromNormalVector(WORLD_NORMAL);
      return;
    }

    const {intersection} = resolved;
    reticle.visible = true;
    reticle.intersection = intersection;
    reticle.targetObject = resolved.target;
    reticle.position.copy(intersection.point);

    if (intersection.normal) {
      intersection.object.updateWorldMatrix(true, false);
      NORMAL_MATRIX.getNormalMatrix(intersection.object.matrixWorld);
      WORLD_NORMAL.copy(intersection.normal)
        .applyMatrix3(NORMAL_MATRIX)
        .normalize();
    } else {
      WORLD_NORMAL.copy(ray.direction).negate().normalize();
    }
    reticle.setRotationFromNormalVector(WORLD_NORMAL);

    const legacyOwner = resolved.objectPath.find(
      (object) => typeof (object as LegacyUXOwner).ux?.update === 'function'
    ) as LegacyUXOwner | undefined;
    legacyOwner?.ux?.update(snapshot.controller, intersection);
  }

  clear(controller: Controller): void {
    if (!controller.reticle) return;
    controller.reticle.visible = false;
    controller.reticle.intersection = undefined;
    controller.reticle.targetObject = undefined;
  }
}
