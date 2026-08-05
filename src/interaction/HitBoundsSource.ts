import type * as THREE from 'three';

/** Internal marker used by scene objects that provide their own hit bounds. */
export const HIT_BOUNDS_SOURCE = Symbol('xrblocks.hitBoundsSource');

/**
 * Supplies conservative world-space bounds for a custom hit surface.
 *
 * Use this when `Object3D.raycast()` can hit outside the object's standard
 * `BufferGeometry` bounds, or when another layout system owns its transform.
 * The written box must contain every point that `raycast()` can return. It may
 * be larger than the exact hit shape because the exact raycast runs afterward.
 * This collider-style seam keeps interaction bounds separate from rendering
 * when the AABB broad phase cannot infer them safely.
 */
export interface HitBoundsSource {
  /** Writes current bounds and returns false while no valid bounds are ready. */
  writeWorldBounds(target: THREE.Box3): boolean;
}

/** Internal shape for scene objects that opt into intrinsic hit bounds. */
export type IntrinsicHitBoundsSource = THREE.Object3D & {
  readonly [HIT_BOUNDS_SOURCE]?: HitBoundsSource;
};
