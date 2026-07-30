import * as THREE from 'three';

import {ReticleOptions} from '../core/Options.js';
import type {Controller} from '../input/Controller.js';
import type {
  InteractionSourceSnapshot,
  ResolvedRay,
  ReticlePresentationObserver,
} from './InteractionTypes.js';

const NORMAL_MATRIX = new THREE.Matrix3();
const WORLD_NORMAL = new THREE.Vector3();

/** Presents resolved state. It never performs a raycast or changes targeting. */
export class ReticlePresenter implements ReticlePresentationObserver {
  constructor(private readonly options = new ReticleOptions()) {}

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
    if (snapshot.selectionProgress === undefined) {
      reticle.setPressed(snapshot.selected);
    } else {
      reticle.setPressedAmount(snapshot.selectionProgress);
    }

    if (resolved?.reticleMode === 'hidden') {
      this.clear(snapshot.controller);
      return;
    }

    if (!resolved) {
      reticle.intersection = undefined;
      reticle.targetObject = undefined;
      reticle.setHovering(false);
      reticle.visible = false;
      return;
    }

    const {intersection} = resolved;
    reticle.visible = true;
    reticle.setOpacity(this.getOpacity(intersection.distance));
    reticle.intersection = intersection;
    reticle.targetObject = resolved.target;
    reticle.setHovering(resolved.target !== undefined);
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
  }

  private getOpacity(distance: number): number {
    const {maxDistance} = this.options;
    if (maxDistance === undefined) return 1;
    if (distance >= maxDistance) return 0;

    const fadeDistance = Math.min(
      Math.max(this.options.fadeDistance, 0),
      maxDistance
    );
    if (fadeDistance === 0) return 1;

    const fadeStart = maxDistance - fadeDistance;
    const progress = Math.min(
      Math.max((distance - fadeStart) / fadeDistance, 0),
      1
    );
    const smoothProgress = progress * progress * (3 - 2 * progress);
    return 1 - smoothProgress;
  }

  clear(controller: Controller): void {
    if (!controller.reticle) return;
    controller.reticle.visible = false;
    controller.reticle.setOpacity(1);
    controller.reticle.intersection = undefined;
    controller.reticle.targetObject = undefined;
    controller.reticle.setHovering(false);
  }
}
