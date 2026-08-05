import * as THREE from 'three';

/** Minimal shape stored by the internal broad-phase index. */
export interface BoundedHitProxy {
  readonly worldBounds: THREE.Box3;
}

interface HitSpatialNode<T extends BoundedHitProxy> {
  readonly bounds: THREE.Box3;
  parent?: HitSpatialNode<T>;
  left?: HitSpatialNode<T>;
  right?: HitSpatialNode<T>;
  proxy?: T;
}

const CENTERS = new WeakMap<object, THREE.Vector3>();

/** Refittable object-level AABB tree used by ray and direct-touch queries. */
export class HitSpatialIndex<T extends BoundedHitProxy> {
  private readonly proxies = new Set<T>();
  private readonly leaves = new Map<T, HitSpatialNode<T>>();
  private readonly queryStack: HitSpatialNode<T>[] = [];
  private root?: HitSpatialNode<T>;
  private topologyDirty = false;

  add(proxy: T): void {
    if (this.proxies.has(proxy)) return;
    this.proxies.add(proxy);
    this.topologyDirty = true;
  }

  remove(proxy: T): void {
    if (!this.proxies.delete(proxy)) return;
    this.leaves.delete(proxy);
    this.topologyDirty = true;
  }

  clear(): void {
    this.proxies.clear();
    this.leaves.clear();
    this.queryStack.length = 0;
    this.root = undefined;
    this.topologyDirty = false;
  }

  /** Updates one moved leaf and all of its ancestors. */
  refit(proxy: T): void {
    if (this.topologyDirty) return;
    let node = this.leaves.get(proxy);
    if (!node) {
      if (!proxy.worldBounds.isEmpty()) this.topologyDirty = true;
      return;
    }
    if (proxy.worldBounds.isEmpty()) {
      this.topologyDirty = true;
      return;
    }
    node.bounds.copy(proxy.worldBounds);
    node = node.parent;
    while (node) {
      node.bounds.copy(node.left!.bounds).union(node.right!.bounds);
      node = node.parent;
    }
  }

  /** Rebuilds tree topology only after membership changes. */
  prepare(): void {
    if (!this.topologyDirty) return;
    this.leaves.clear();
    const proxies = [...this.proxies].filter(
      (proxy) => !proxy.worldBounds.isEmpty()
    );
    this.root = this.build(proxies, undefined);
    this.topologyDirty = false;
  }

  queryRay(ray: THREE.Ray, output: T[]): void {
    this.prepare();
    const root = this.root;
    if (!root || !ray.intersectsBox(root.bounds)) return;
    const stack = this.queryStack;
    stack.length = 0;
    stack.push(root);
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (!ray.intersectsBox(node.bounds)) continue;
      if (node.proxy) {
        output.push(node.proxy);
        continue;
      }
      if (node.left) stack.push(node.left);
      if (node.right) stack.push(node.right);
    }
  }

  querySphere(center: THREE.Vector3, radius: number, output: T[]): void {
    this.prepare();
    const root = this.root;
    const radiusSquared = radius * radius;
    if (!root || distanceToBoxSquared(center, root.bounds) > radiusSquared) {
      return;
    }
    const stack = this.queryStack;
    stack.length = 0;
    stack.push(root);
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (distanceToBoxSquared(center, node.bounds) > radiusSquared) continue;
      if (node.proxy) {
        output.push(node.proxy);
        continue;
      }
      if (node.left) stack.push(node.left);
      if (node.right) stack.push(node.right);
    }
  }

  private build(
    proxies: T[],
    parent: HitSpatialNode<T> | undefined
  ): HitSpatialNode<T> | undefined {
    if (proxies.length === 0) return undefined;
    if (proxies.length === 1) {
      const proxy = proxies[0];
      const leaf = {
        bounds: proxy.worldBounds.clone(),
        parent,
        proxy,
      };
      this.leaves.set(proxy, leaf);
      return leaf;
    }

    const centroidBounds = new THREE.Box3();
    centroidBounds.makeEmpty();
    for (const proxy of proxies) {
      let center = CENTERS.get(proxy);
      if (!center) {
        center = new THREE.Vector3();
        CENTERS.set(proxy, center);
      }
      proxy.worldBounds.getCenter(center);
      centroidBounds.expandByPoint(center);
    }
    const size = centroidBounds.getSize(new THREE.Vector3());
    const axis =
      size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    proxies.sort((a, b) => CENTERS.get(a)![axis] - CENTERS.get(b)![axis]);

    const node: HitSpatialNode<T> = {
      bounds: new THREE.Box3(),
      parent,
    };
    const middle = Math.floor(proxies.length / 2);
    node.left = this.build(proxies.slice(0, middle), node);
    node.right = this.build(proxies.slice(middle), node);
    node.bounds.copy(node.left!.bounds).union(node.right!.bounds);
    return node;
  }
}

function distanceToBoxSquared(point: THREE.Vector3, box: THREE.Box3): number {
  const x = Math.max(box.min.x - point.x, 0, point.x - box.max.x);
  const y = Math.max(box.min.y - point.y, 0, point.y - box.max.y);
  const z = Math.max(box.min.z - point.z, 0, point.z - box.max.z);
  return x * x + y * y + z * z;
}
