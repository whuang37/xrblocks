import * as THREE from 'three';

import type {InteractionHitPart} from './InteractionTypes';

export interface RegisteredHitSurface {
  readonly physical: THREE.Object3D;
  readonly logical: THREE.Object3D;
  readonly part?: InteractionHitPart;
}

/** Maps private physical hit nodes to public logical objects. */
export class HitRegistry {
  private readonly mappings = new WeakMap<
    THREE.Object3D,
    RegisteredHitSurface
  >();
  private readonly registered = new Set<RegisteredHitSurface>();
  private readonly touchCandidates = new Map<
    THREE.Object3D,
    RegisteredHitSurface
  >();

  register(
    physical: THREE.Object3D,
    logical: THREE.Object3D,
    part?: InteractionHitPart
  ): () => void {
    const entry = {physical, logical, part};
    this.mappings.set(physical, entry);
    this.registered.add(entry);
    this.touchCandidates.set(physical, entry);
    return () => {
      if (this.mappings.get(physical) === entry) {
        this.mappings.delete(physical);
      }
      this.registered.delete(entry);
      if (this.touchCandidates.get(physical) === entry) {
        this.touchCandidates.delete(physical);
      }
    };
  }

  setWorldTouchCandidates(objects: Iterable<THREE.Object3D>): void {
    const next = new Set(objects);
    for (const [physical, entry] of this.touchCandidates) {
      if (!this.registered.has(entry)) this.touchCandidates.delete(physical);
    }
    for (const object of next) {
      if (this.touchCandidates.has(object)) continue;
      this.touchCandidates.set(object, {
        physical: object,
        logical: object,
      });
    }
    for (const [physical, entry] of this.touchCandidates) {
      if (this.registered.has(entry)) continue;
      if (!next.has(physical)) this.touchCandidates.delete(physical);
    }
  }

  resolve(object: THREE.Object3D): RegisteredHitSurface {
    let current: THREE.Object3D | null = object;
    while (current) {
      const mapping = this.mappings.get(current);
      if (mapping) return mapping;
      current = current.parent;
    }
    return {physical: object, logical: object};
  }

  intersectionsAt(
    point: THREE.Vector3,
    padding = 0,
    preferred?: THREE.Object3D
  ): THREE.Intersection[] {
    const intersections: THREE.Intersection[] = [];
    const box = new THREE.Box3();
    const center = new THREE.Vector3();
    for (const {physical} of this.touchCandidates.values()) {
      if (!effectiveVisible(physical)) continue;
      try {
        box.setFromObject(physical);
      } catch {
        continue;
      }
      if (padding > 0) box.expandByScalar(padding);
      if (box.isEmpty() || !box.containsPoint(point)) continue;
      intersections.push({
        distance: box.getCenter(center).distanceTo(point),
        object: physical,
        point: point.clone(),
      });
    }
    intersections.sort((a, b) => {
      if (a.object === preferred) return -1;
      if (b.object === preferred) return 1;
      return a.distance - b.distance;
    });
    return intersections;
  }
}

function effectiveVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}
