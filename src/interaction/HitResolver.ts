import * as THREE from 'three';

import type {Script} from '../core/Script.js';
import type {
  InteractionCallbackDispatch,
  InteractionManipulation,
  InteractionSourceType,
  ResolvedRay,
} from './InteractionTypes.js';
import type {ReticleMode} from './manipulation/ManipulationTypes.js';

function cloneIntersection(
  intersection: THREE.Intersection
): THREE.Intersection {
  return {
    ...intersection,
    point: intersection.point.clone(),
    normal: intersection.normal?.clone(),
    uv: intersection.uv?.clone(),
    uv1: intersection.uv1?.clone(),
  };
}

/** Resolves one ordered raw hit list into one blocking surface and target. */
export class HitResolver {
  constructor(
    private readonly callbacks: InteractionCallbackDispatch,
    private readonly manipulation?: InteractionManipulation
  ) {}

  resolve(
    intersections: readonly THREE.Intersection[],
    sourceType: InteractionSourceType
  ): ResolvedRay | undefined {
    for (const rawIntersection of intersections) {
      const objectPath = this.getObjectPath(rawIntersection.object);
      if (this.isExcluded(objectPath)) continue;

      const eligiblePath = this.getEligiblePath(objectPath);
      const manipulation = this.manipulation?.resolve(
        rawIntersection.object,
        eligiblePath
      );
      const validManipulation =
        manipulation && eligiblePath.includes(manipulation.owner)
          ? manipulation
          : undefined;
      const callbackTarget = eligiblePath.find((object) =>
        this.callbacks.hasTargetHandler(object, sourceType)
      );
      const target = this.nearestTarget(
        eligiblePath,
        callbackTarget,
        validManipulation?.owner
      );
      const scriptPath = target
        ? (eligiblePath.filter((object) =>
            this.callbacks.isScript(object)
          ) as Script[])
        : [];

      return {
        intersection: cloneIntersection(rawIntersection),
        hitObject: rawIntersection.object,
        surface: rawIntersection.object,
        target,
        scriptPath: Object.freeze(scriptPath),
        objectPath: Object.freeze(objectPath),
        reticleMode: this.getReticleMode(objectPath),
        manipulation: validManipulation,
      };
    }
    return undefined;
  }

  private getObjectPath(surface: THREE.Object3D): THREE.Object3D[] {
    const path: THREE.Object3D[] = [];
    let object: THREE.Object3D | null = surface;
    while (object) {
      path.push(object);
      object = object.parent;
    }
    return path;
  }

  private isExcluded(path: readonly THREE.Object3D[]): boolean {
    return path.some(
      (object) => object.visible === false || object.pointerEvents === 'none'
    );
  }

  private getEligiblePath(
    objectPath: readonly THREE.Object3D[]
  ): THREE.Object3D[] {
    const barrierIndex = objectPath.findIndex(
      (object) => object.interactionEnabled === false
    );
    return barrierIndex < 0
      ? [...objectPath]
      : objectPath.slice(0, barrierIndex);
  }

  private nearestTarget(
    path: readonly THREE.Object3D[],
    callbackTarget?: THREE.Object3D,
    manipulationOwner?: THREE.Object3D
  ): THREE.Object3D | undefined {
    if (!callbackTarget) return manipulationOwner;
    if (!manipulationOwner) return callbackTarget;
    return path.indexOf(callbackTarget) <= path.indexOf(manipulationOwner)
      ? callbackTarget
      : manipulationOwner;
  }

  private getReticleMode(path: readonly THREE.Object3D[]): ReticleMode {
    for (const object of path) {
      const mode = object.reticleMode;
      if (mode === 'auto' || mode === 'surface' || mode === 'hidden') {
        return mode;
      }
    }
    return 'auto';
  }
}
