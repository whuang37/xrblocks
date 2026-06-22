import * as THREE from 'three';

/**
 * Consolidated filter to determine if a node or any of its ancestors
 * is an internal framework helper (Simulator rig, grids, reticles, lines, etc.).
 */
export function isInternalHelper(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (
      current.type === 'XRSystems' ||
      (current.constructor as {isDepthMesh?: boolean}).isDepthMesh === true ||
      current.type === 'Line' ||
      (current as {ignoreReticleRaycast?: boolean}).ignoreReticleRaycast ===
        true
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}
