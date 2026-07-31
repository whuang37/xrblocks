import * as THREE from 'three';

import type {Script} from '../core/Script.js';
import type {
  InteractionCallbackDispatch,
  InteractionManipulation,
  InteractionSourceType,
  ResolvedRay,
} from './InteractionTypes.js';
import {HitRegistry} from './HitRegistry.js';
import {isSemanticControl} from './SemanticControl.js';

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
    private readonly manipulation?: InteractionManipulation,
    private readonly registry = new HitRegistry()
  ) {}

  resolve(
    intersections: readonly THREE.Intersection[],
    sourceType: InteractionSourceType
  ): ResolvedRay | undefined {
    for (const rawIntersection of intersections) {
      const registered = this.registry.resolve(rawIntersection.object);
      if (
        registered.logical === rawIntersection.object &&
        hasPrivateAncestor(rawIntersection.object)
      ) {
        continue;
      }
      const surface = registered.logical;
      const objectPath = this.getObjectPath(surface);
      if (this.isExcluded(objectPath)) continue;

      const eligiblePath = this.getEligiblePath(objectPath);
      const hitPart = withCorner(registered.part, rawIntersection.uv);
      const manipulation = this.manipulation?.resolve(
        surface,
        eligiblePath,
        hitPart
      );
      const validManipulation =
        manipulation && eligiblePath.includes(manipulation.owner)
          ? manipulation
          : undefined;
      const semanticControl = eligiblePath.find(isSemanticControl);
      const callbackTarget = eligiblePath.find((object) =>
        this.callbacks.hasTargetHandler(object, sourceType)
      );
      const target =
        hitPart?.kind === 'card-edge'
          ? validManipulation?.owner
          : (semanticControl ??
            this.nearestTarget(
              eligiblePath,
              callbackTarget,
              validManipulation?.owner
            ));
      const scriptPath = target
        ? (eligiblePath.filter((object) =>
            this.callbacks.isScript(object)
          ) as Script[])
        : [];

      return {
        intersection: {
          ...cloneIntersection(rawIntersection),
          object: surface,
        },
        hitObject: rawIntersection.object,
        surface,
        target,
        scriptPath: Object.freeze(scriptPath),
        objectPath: Object.freeze(objectPath),
        reticleMode: this.getReticleMode(objectPath),
        hitPart,
        semanticControl,
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
      (object) =>
        object.visible === false || object.xb?.pointerEvents === 'none'
    );
  }

  private getEligiblePath(
    objectPath: readonly THREE.Object3D[]
  ): THREE.Object3D[] {
    const barrierIndex = objectPath.findIndex(
      (object) => object.xb?.interactionEnabled === false
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

  private getReticleMode(
    path: readonly THREE.Object3D[]
  ): 'auto' | 'surface' | 'hidden' {
    for (const object of path) {
      const mode = object.xb?.reticleMode;
      if (mode === 'auto' || mode === 'surface' || mode === 'hidden') {
        return mode;
      }
    }
    return 'auto';
  }
}

function hasPrivateAncestor(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.xrblocksPrivate === true) return true;
    current = current.parent;
  }
  return false;
}

function withCorner(
  part: ResolvedRay['hitPart'],
  uv: THREE.Vector2 | undefined
): ResolvedRay['hitPart'] {
  if (part?.kind !== 'card-edge' || !uv) return part;
  const horizontal = uv.x <= 0.2 ? 'left' : uv.x >= 0.8 ? 'right' : undefined;
  const vertical = uv.y <= 0.2 ? 'bottom' : uv.y >= 0.8 ? 'top' : undefined;
  return horizontal && vertical
    ? {...part, corner: `${vertical}-${horizontal}` as const}
    : part;
}
