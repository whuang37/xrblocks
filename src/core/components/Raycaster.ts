import * as THREE from 'three';

function defaultSortFunction(
  a: THREE.Intersection,
  b: THREE.Intersection
): number {
  const distance = a.distance - b.distance;
  if (Math.abs(distance) > 0.00001) return distance;
  if (a.object.renderOrder !== b.object.renderOrder) {
    return b.object.renderOrder - a.object.renderOrder;
  }
  return b.object.id - a.object.id;
}

function intersect(
  object: THREE.Object3D,
  raycaster: THREE.Raycaster,
  intersections: THREE.Intersection[],
  recursive: boolean
): void {
  let propagate = true;
  if (object.layers.test(raycaster.layers)) {
    const result = object.raycast(raycaster, intersections);
    if ((result as unknown) === false) propagate = false;
  }
  if (!propagate || !recursive) return;
  for (const child of object.children) {
    intersect(child, raycaster, intersections, true);
  }
}

/**
 * Internal Three.js raycaster adapter that supports subtree ownership through
 * a literal false return from Object3D.raycast().
 */
export class Raycaster extends THREE.Raycaster {
  sortFunction: (a: THREE.Intersection, b: THREE.Intersection) => number =
    defaultSortFunction;

  override intersectObject<TIntersected extends THREE.Object3D>(
    object: THREE.Object3D,
    recursive = true,
    intersections: Array<THREE.Intersection<TIntersected>> = []
  ): Array<THREE.Intersection<TIntersected>> {
    intersect(object, this, intersections, recursive);
    intersections.sort(this.sortFunction);
    return intersections;
  }

  override intersectObjects<TIntersected extends THREE.Object3D>(
    objects: THREE.Object3D[],
    recursive = true,
    intersections: Array<THREE.Intersection<TIntersected>> = []
  ): Array<THREE.Intersection<TIntersected>> {
    for (const object of objects) {
      intersect(object, this, intersections, recursive);
    }
    intersections.sort(this.sortFunction);
    return intersections;
  }
}
