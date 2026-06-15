import * as THREE from 'three';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';

// Tracks whether the THREE.Mesh prototype patch has already been
// installed so callers can ping `enableAcceleratedRaycast()` from
// multiple subsystems without paying for redundant overwrites.
let bvhProtoPatched = false;

/**
 * Install the three-mesh-bvh prototype patches that switch
 * `THREE.Mesh.raycast` over to the BVH-accelerated implementation
 * when the target mesh has a computed bounds tree, and add
 * `computeBoundsTree` / `disposeBoundsTree` helpers to
 * `THREE.BufferGeometry`.
 *
 * Safe to call multiple times. Meshes without a bounds tree continue
 * to use three.js's stock raycaster, so flipping this switch on
 * globally does not affect callers that never call
 * `computeBoundsTree()`.
 */
export function enableAcceleratedRaycast() {
  if (bvhProtoPatched) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (THREE.Mesh.prototype as any).raycast = acceleratedRaycast;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
  bvhProtoPatched = true;
}

/**
 * Walk the given object3D (recursively) and build a bounds tree on
 * every mesh's geometry that doesn't already have one. After this
 * call any `raycaster.intersectObject(root, true)` against the tree
 * goes through the BVH-accelerated path instead of walking every
 * triangle per ray.
 *
 * Use this on the root of a scene (or sub-tree) that the SDK's
 * interaction raycaster walks every frame. The build cost is
 * proportional to total triangle count and happens once per geometry.
 *
 * Geometries that already have a `boundsTree` are left alone so
 * repeat calls are idempotent.
 */
export function applyBVH(
  root: THREE.Object3D,
  {recursive = true}: {recursive?: boolean} = {}
) {
  enableAcceleratedRaycast();
  const visit = (obj: THREE.Object3D) => {
    if (obj instanceof THREE.Mesh && obj.geometry) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geom = obj.geometry as any;
      if (!geom.boundsTree && typeof geom.computeBoundsTree === 'function') {
        geom.computeBoundsTree();
      }
    }
    if (recursive) {
      for (const child of obj.children) visit(child);
    }
  };
  visit(root);
}

/**
 * Walk the given object3D (recursively) and dispose any bounds trees
 * previously built by `applyBVH`. Use before tearing down a scene so
 * the underlying typed arrays drop their refs.
 */
export function disposeBVH(
  root: THREE.Object3D,
  {recursive = true}: {recursive?: boolean} = {}
) {
  const visit = (obj: THREE.Object3D) => {
    if (obj instanceof THREE.Mesh && obj.geometry) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geom = obj.geometry as any;
      if (geom.boundsTree && typeof geom.disposeBoundsTree === 'function') {
        geom.disposeBoundsTree();
      }
    }
    if (recursive) {
      for (const child of obj.children) visit(child);
    }
  };
  visit(root);
}
