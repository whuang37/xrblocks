import * as THREE from 'three';

import {
  HIT_BOUNDS_SOURCE,
  type HitBoundsSource,
  type IntrinsicHitBoundsSource,
} from './HitBoundsSource.js';
import {type BoundedHitProxy, HitSpatialIndex} from './HitSpatialIndex.js';

export interface RegisteredHitSurface {
  readonly physical: THREE.Object3D;
  readonly logical: THREE.Object3D;
}

interface RayHitProxy extends BoundedHitProxy {
  readonly physical: THREE.Object3D;
  logical: THREE.Object3D;
  readonly localBounds: THREE.Box3;
  readonly worldBounds: THREE.Box3;
  readonly previousMatrixWorld: THREE.Matrix4;
  previousMatrixValid: boolean;
  geometry?: THREE.BufferGeometry;
  geometryVersion: number;
  inScene: boolean;
  registration?: RegisteredHitSurface;
  boundsSource?: HitBoundsSource;
  bounded: boolean;
}

interface TouchHitProxy extends BoundedHitProxy {
  readonly physical: THREE.Object3D;
  logical: THREE.Object3D;
  readonly worldBounds: THREE.Box3;
  registered: boolean;
  worldCandidate: boolean;
}

type ChildAddedEvent = THREE.Object3DEventMap['childadded'];
type ChildRemovedEvent = THREE.Object3DEventMap['childremoved'];

/** Owns scene membership, broad-phase queries, and physical-to-logical hits. */
export class HitRegistry {
  private readonly raycaster = new THREE.Raycaster();
  private readonly mappings = new WeakMap<
    THREE.Object3D,
    RegisteredHitSurface
  >();
  private readonly rayProxies = new Map<THREE.Object3D, RayHitProxy>();
  private readonly touchProxies = new Map<THREE.Object3D, TouchHitProxy>();
  private readonly rayIndex = new HitSpatialIndex<RayHitProxy>();
  private readonly touchIndex = new HitSpatialIndex<TouchHitProxy>();
  private readonly unboundedRayProxies = new Set<RayHitProxy>();
  private readonly observedObjects = new Set<THREE.Object3D>();
  private readonly rayCandidates: RayHitProxy[] = [];
  private readonly touchCandidates: TouchHitProxy[] = [];
  private readonly touchCenter = new THREE.Vector3();
  private readonly expandedTouchBounds = new THREE.Box3();
  private readonly nextRayBounds = new THREE.Box3();
  private readonly nextTouchBounds = new THREE.Box3();
  private scene?: THREE.Scene;
  private disposed = false;

  constructor(scene?: THREE.Scene) {
    if (scene) this.attachScene(scene);
  }

  register(
    physical: THREE.Object3D,
    logical: THREE.Object3D,
    boundsSource?: HitBoundsSource
  ): () => void {
    const entry = {physical, logical};
    this.mappings.set(physical, entry);
    const proxy = this.ensureRayProxy(physical);
    proxy.registration = entry;
    proxy.logical = logical;
    proxy.boundsSource = boundsSource ?? intrinsicBoundsSource(physical);
    this.invalidateAutomaticBounds(proxy);
    this.setRayProxyBounded(proxy, false);
    this.ensureTouchProxy(physical).registered = true;
    this.touchProxies.get(physical)!.logical = logical;
    return () => {
      if (this.mappings.get(physical) !== entry) return;
      this.mappings.delete(physical);
      const current = this.rayProxies.get(physical);
      if (current?.registration === entry) {
        current.registration = undefined;
        current.logical = physical;
        current.boundsSource = intrinsicBoundsSource(physical);
        this.invalidateAutomaticBounds(current);
        this.setRayProxyBounded(current, false);
        if (!current.inScene) this.removeRayProxy(current);
      }
      const touch = this.touchProxies.get(physical);
      if (touch) {
        touch.registered = false;
        touch.logical = physical;
        if (!touch.worldCandidate) this.removeTouchProxy(touch);
      }
    };
  }

  setWorldTouchCandidates(objects: Iterable<THREE.Object3D>): void {
    const next = new Set(objects);
    for (const object of next) {
      const proxy = this.ensureTouchProxy(object);
      proxy.worldCandidate = true;
      proxy.logical = this.mappings.get(object)?.logical ?? object;
    }
    for (const proxy of [...this.touchProxies.values()]) {
      if (!proxy.worldCandidate || next.has(proxy.physical)) continue;
      proxy.worldCandidate = false;
      if (!proxy.registered) this.removeTouchProxy(proxy);
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

  /** Refreshes bounds once after world matrices are current for this frame. */
  prepareFrame(): void {
    if (this.disposed) return;
    for (const proxy of this.rayProxies.values()) {
      const object = proxy.physical;
      if (proxy.boundsSource) {
        this.refreshProvidedBounds(proxy);
        continue;
      }
      if (!this.scene || !isDescendantOf(object, this.scene)) {
        object.updateWorldMatrix(true, false);
      }
      const geometryChanged = this.refreshLocalBounds(proxy);
      if (
        !geometryChanged &&
        proxy.previousMatrixValid &&
        matrixEquals(proxy.previousMatrixWorld, object.matrixWorld)
      ) {
        continue;
      }
      proxy.previousMatrixWorld.copy(object.matrixWorld);
      proxy.previousMatrixValid = true;
      if (proxy.bounded) {
        proxy.worldBounds
          .copy(proxy.localBounds)
          .applyMatrix4(object.matrixWorld);
        this.rayIndex.refit(proxy);
      }
    }

    for (const proxy of this.touchProxies.values()) {
      const rayProxy = this.rayProxies.get(proxy.physical);
      const nextBounds = this.nextTouchBounds;
      if (rayProxy?.bounded) {
        nextBounds.copy(rayProxy.worldBounds);
      } else {
        try {
          nextBounds.setFromObject(proxy.physical);
        } catch {
          nextBounds.makeEmpty();
        }
      }
      if (proxy.worldBounds.equals(nextBounds)) continue;
      proxy.worldBounds.copy(nextBounds);
      this.touchIndex.refit(proxy);
    }
    this.rayIndex.prepare();
    this.touchIndex.prepare();
  }

  /** Collects ordered raw hits from indexed public and registered surfaces. */
  raycast(
    scene: THREE.Scene,
    ray: THREE.Ray,
    intersections: THREE.Intersection[]
  ): readonly THREE.Intersection[] {
    if (scene !== this.scene) {
      this.attachScene(scene);
      this.prepareFrame();
    }
    intersections.length = 0;
    this.raycaster.ray.copy(ray);
    const candidates = this.rayCandidates;
    candidates.length = 0;
    this.rayIndex.queryRay(ray, candidates);
    for (const proxy of candidates) {
      this.exactRaycast(proxy, intersections);
    }
    for (const proxy of this.unboundedRayProxies) {
      this.exactRaycast(proxy, intersections);
    }
    intersections.sort(compareRayIntersections);
    return intersections;
  }

  intersectionsAt(
    point: THREE.Vector3,
    padding = 0,
    preferred?: THREE.Object3D
  ): THREE.Intersection[] {
    const intersections: THREE.Intersection[] = [];
    const candidates = this.touchCandidates;
    candidates.length = 0;
    this.touchIndex.querySphere(point, padding, candidates);
    for (const proxy of candidates) {
      if (!effectiveHitEnabled(proxy.physical, proxy.logical)) continue;
      const box = proxy.worldBounds;
      if (box.isEmpty()) continue;
      const expanded =
        padding > 0
          ? this.expandedTouchBounds.copy(box).expandByScalar(padding)
          : box;
      if (!expanded.containsPoint(point)) continue;
      intersections.push({
        distance: expanded.getCenter(this.touchCenter).distanceTo(point),
        object: proxy.physical,
        point: point.clone(),
      });
    }
    intersections.sort((a, b) => compareTouchIntersections(a, b, preferred));
    return intersections;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.scene) this.unobserveSubtree(this.scene);
    this.scene = undefined;
    this.rayIndex.clear();
    this.touchIndex.clear();
    this.rayProxies.clear();
    this.touchProxies.clear();
    this.unboundedRayProxies.clear();
    this.rayCandidates.length = 0;
    this.touchCandidates.length = 0;
  }

  private attachScene(scene: THREE.Scene): void {
    if (this.scene === scene || this.disposed) return;
    if (this.scene) this.unobserveSubtree(this.scene);
    for (const proxy of [...this.rayProxies.values()]) {
      proxy.inScene = false;
      if (!proxy.registration) this.removeRayProxy(proxy);
    }
    this.scene = scene;
    this.observeSubtree(scene);
  }

  private observeSubtree(object: THREE.Object3D): void {
    if (
      this.observedObjects.has(object) ||
      object.userData.xrblocksPrivate === true
    ) {
      return;
    }
    this.observedObjects.add(object);
    object.addEventListener('childadded', this.onChildAdded);
    object.addEventListener('childremoved', this.onChildRemoved);
    if (hasRaycastImplementation(object)) {
      this.ensureRayProxy(object).inScene = true;
    }
    for (const child of object.children) this.observeSubtree(child);
  }

  private unobserveSubtree(object: THREE.Object3D): void {
    if (!this.observedObjects.delete(object)) return;
    object.removeEventListener('childadded', this.onChildAdded);
    object.removeEventListener('childremoved', this.onChildRemoved);
    const proxy = this.rayProxies.get(object);
    if (proxy) {
      proxy.inScene = false;
      if (!proxy.registration) this.removeRayProxy(proxy);
    }
    for (const child of object.children) this.unobserveSubtree(child);
  }

  private readonly onChildAdded = (event: ChildAddedEvent): void => {
    this.observeSubtree(event.child);
  };

  private readonly onChildRemoved = (event: ChildRemovedEvent): void => {
    this.unobserveSubtree(event.child);
  };

  private ensureRayProxy(object: THREE.Object3D): RayHitProxy {
    const existing = this.rayProxies.get(object);
    if (existing) return existing;
    const proxy: RayHitProxy = {
      physical: object,
      logical: this.mappings.get(object)?.logical ?? object,
      localBounds: new THREE.Box3(),
      worldBounds: new THREE.Box3(),
      previousMatrixWorld: new THREE.Matrix4(),
      previousMatrixValid: false,
      geometryVersion: -1,
      inScene: false,
      boundsSource: intrinsicBoundsSource(object),
      bounded: false,
    };
    this.rayProxies.set(object, proxy);
    if (!proxy.boundsSource) this.refreshLocalBounds(proxy);
    if (proxy.bounded) this.rayIndex.add(proxy);
    else this.unboundedRayProxies.add(proxy);
    return proxy;
  }

  private removeRayProxy(proxy: RayHitProxy): void {
    this.rayProxies.delete(proxy.physical);
    this.rayIndex.remove(proxy);
    this.unboundedRayProxies.delete(proxy);
  }

  private ensureTouchProxy(object: THREE.Object3D): TouchHitProxy {
    const existing = this.touchProxies.get(object);
    if (existing) return existing;
    const proxy: TouchHitProxy = {
      physical: object,
      logical: this.mappings.get(object)?.logical ?? object,
      worldBounds: new THREE.Box3(),
      registered: false,
      worldCandidate: false,
    };
    this.touchProxies.set(object, proxy);
    this.touchIndex.add(proxy);
    return proxy;
  }

  private removeTouchProxy(proxy: TouchHitProxy): void {
    this.touchProxies.delete(proxy.physical);
    this.touchIndex.remove(proxy);
  }

  private refreshLocalBounds(proxy: RayHitProxy): boolean {
    const object = proxy.physical;
    const geometry = getGeometry(object);
    const version = objectGeometryVersion(object, geometry);
    if (proxy.geometry === geometry && proxy.geometryVersion === version) {
      return false;
    }
    proxy.geometry = geometry;
    proxy.geometryVersion = version;
    this.setRayProxyBounded(
      proxy,
      writeLocalBounds(object, geometry, proxy.localBounds)
    );
    return true;
  }

  private refreshProvidedBounds(proxy: RayHitProxy): void {
    const nextBounds = this.nextRayBounds;
    nextBounds.makeEmpty();
    if (
      !proxy.boundsSource!.writeWorldBounds(nextBounds) ||
      nextBounds.isEmpty()
    ) {
      proxy.worldBounds.makeEmpty();
      this.setRayProxyBounded(proxy, false);
      return;
    }
    const changed = !proxy.worldBounds.equals(nextBounds);
    proxy.worldBounds.copy(nextBounds);
    if (!proxy.bounded) {
      this.setRayProxyBounded(proxy, true);
    } else if (changed) {
      this.rayIndex.refit(proxy);
    }
  }

  private invalidateAutomaticBounds(proxy: RayHitProxy): void {
    proxy.geometry = undefined;
    proxy.geometryVersion = -1;
    proxy.previousMatrixValid = false;
    proxy.localBounds.makeEmpty();
    proxy.worldBounds.makeEmpty();
  }

  private setRayProxyBounded(proxy: RayHitProxy, bounded: boolean): void {
    if (proxy.bounded === bounded) return;
    proxy.bounded = bounded;
    if (bounded) {
      this.unboundedRayProxies.delete(proxy);
      this.rayIndex.add(proxy);
    } else {
      this.rayIndex.remove(proxy);
      this.unboundedRayProxies.add(proxy);
    }
  }

  private exactRaycast(
    proxy: RayHitProxy,
    intersections: THREE.Intersection[]
  ): void {
    const physical = proxy.physical;
    if (!effectiveHitEnabled(physical, proxy.logical)) return;
    if (!physical.layers.test(this.raycaster.layers)) return;
    physical.raycast(this.raycaster, intersections);
  }
}

function getGeometry(object: THREE.Object3D): THREE.BufferGeometry | undefined {
  if (!hasStandardMeshRaycast(object)) return undefined;
  const geometry = (object as THREE.Object3D & {geometry?: unknown}).geometry;
  return geometry instanceof THREE.BufferGeometry ? geometry : undefined;
}

function intrinsicBoundsSource(
  object: THREE.Object3D
): HitBoundsSource | undefined {
  return (object as IntrinsicHitBoundsSource)[HIT_BOUNDS_SOURCE];
}

function hasStandardMeshRaycast(object: THREE.Object3D): boolean {
  if (object instanceof THREE.SkinnedMesh) return false;
  if (object instanceof THREE.InstancedMesh) {
    return object.raycast === THREE.InstancedMesh.prototype.raycast;
  }
  return (
    object instanceof THREE.Mesh &&
    object.raycast === THREE.Mesh.prototype.raycast
  );
}

function geometryVersion(geometry?: THREE.BufferGeometry): number {
  if (!geometry) return -1;
  const position = geometry.attributes.position;
  const positionVersion =
    position instanceof THREE.InterleavedBufferAttribute
      ? position.data.version
      : (position?.version ?? 0);
  return positionVersion * 65_537 + (geometry.index?.version ?? 0);
}

function objectGeometryVersion(
  object: THREE.Object3D,
  geometry?: THREE.BufferGeometry
): number {
  const geometryValue = geometryVersion(geometry);
  if (object instanceof THREE.InstancedMesh) {
    return geometryValue * 65_537 + object.instanceMatrix.version;
  }
  return geometryValue;
}

function writeLocalBounds(
  object: THREE.Object3D,
  geometry: THREE.BufferGeometry | undefined,
  target: THREE.Box3
): boolean {
  if (!geometry) {
    target.makeEmpty();
    return false;
  }
  if (object instanceof THREE.InstancedMesh) {
    object.computeBoundingBox();
    if (object.boundingBox) {
      target.copy(object.boundingBox);
      return !target.isEmpty();
    }
  }
  geometry.computeBoundingBox();
  if (!geometry.boundingBox) {
    target.makeEmpty();
    return false;
  }
  target.copy(geometry.boundingBox);
  return !target.isEmpty();
}

function hasRaycastImplementation(object: THREE.Object3D): boolean {
  return object.raycast !== THREE.Object3D.prototype.raycast;
}

function matrixEquals(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  for (let index = 0; index < 16; index++) {
    if (a.elements[index] !== b.elements[index]) return false;
  }
  return true;
}

function isDescendantOf(
  object: THREE.Object3D,
  ancestor: THREE.Object3D
): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function effectiveHitEnabled(
  physical: THREE.Object3D,
  logical: THREE.Object3D
): boolean {
  return effectiveVisible(physical) && effectivePointerEvents(logical);
}

function effectiveVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function effectivePointerEvents(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.xb?.pointerEvents === 'none') return false;
    current = current.parent;
  }
  return true;
}

function compareRayIntersections(
  a: THREE.Intersection,
  b: THREE.Intersection
): number {
  const aOverlay = isOverlayHit(a.object);
  const bOverlay = isOverlayHit(b.object);
  if (aOverlay !== bOverlay) return aOverlay ? -1 : 1;
  const distance = a.distance - b.distance;
  if (distance !== 0) return distance;
  if (a.object.renderOrder !== b.object.renderOrder) {
    return b.object.renderOrder - a.object.renderOrder;
  }
  return b.object.id - a.object.id;
}

function compareTouchIntersections(
  a: THREE.Intersection,
  b: THREE.Intersection,
  preferred?: THREE.Object3D
): number {
  if (a.object === b.object) return 0;
  if (a.object === preferred) return -1;
  if (b.object === preferred) return 1;

  const aOverlay = isOverlayHit(a.object);
  const bOverlay = isOverlayHit(b.object);
  if (aOverlay !== bOverlay) return aOverlay ? -1 : 1;

  const aOrder = getInteractionHitOrder(a.object);
  const bOrder = getInteractionHitOrder(b.object);
  if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) {
    return bOrder - aOrder;
  }

  return a.distance - b.distance;
}

function getInteractionHitOrder(object: THREE.Object3D): number | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    const order = current.userData.xrblocksHitOrder;
    if (typeof order === 'number') return order;
    current = current.parent;
  }
  return undefined;
}

function isOverlayHit(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.xrblocksOverlay === true) return true;
    current = current.parent;
  }
  return false;
}
