import * as THREE from 'three';

/**
 * Consolidated filter to determine if a node or any of its ancestors
 * is an internal framework helper (Simulator rig, grids, reticles, lines, etc.).
 */
export function isInternalHelper(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;

  while (current) {
    const name = current.name || '';
    if (
      name.includes('Simulator') ||
      name.includes('Helper') ||
      name.includes('Reticle') ||
      name.includes('Controller') ||
      name.includes('Hand') ||
      name.includes('Pointer') ||
      name.includes('pointer') ||
      name.includes('joint') ||
      name.includes('Joint') ||
      name.includes('user') ||
      name.includes('User') ||
      name.includes('Floor') ||
      name.includes('floor') ||
      name.includes('Grid') ||
      name.includes('grid') ||
      name.includes('Environment') ||
      name.includes('environment') ||
      name.includes('pivot') ||
      current.type === 'Line' ||
      (current as {ignoreReticleRaycast?: boolean}).ignoreReticleRaycast === true ||
      current.userData.isInternalHelper === true
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}
