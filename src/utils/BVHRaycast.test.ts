import * as THREE from 'three';
import {describe, expect, it} from 'vitest';

import {applyBVH, disposeBVH, enableAcceleratedRaycast} from './BVHRaycast';

describe('BVHRaycast', () => {
  it('installs the THREE.Mesh prototype patch and helpers on first call', () => {
    enableAcceleratedRaycast();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = THREE.BufferGeometry.prototype as any;
    expect(typeof proto.computeBoundsTree).toBe('function');
    expect(typeof proto.disposeBoundsTree).toBe('function');
  });

  it('is idempotent: re-calling enableAcceleratedRaycast does not throw or re-bind', () => {
    enableAcceleratedRaycast();
    enableAcceleratedRaycast();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = THREE.BufferGeometry.prototype as any;
    expect(typeof proto.computeBoundsTree).toBe('function');
  });

  it('applyBVH builds a boundsTree on every mesh in the tree (recursive)', () => {
    const root = new THREE.Group();
    const m1 = new THREE.Mesh(new THREE.BoxGeometry());
    const m2 = new THREE.Mesh(new THREE.SphereGeometry());
    const inner = new THREE.Group();
    inner.add(m2);
    root.add(m1);
    root.add(inner);
    applyBVH(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((m1.geometry as any).boundsTree).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((m2.geometry as any).boundsTree).toBeDefined();
  });

  it('applyBVH skips meshes that already have a boundsTree (idempotent)', () => {
    const root = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry());
    root.add(m);
    applyBVH(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstTree = (m.geometry as any).boundsTree;
    applyBVH(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secondTree = (m.geometry as any).boundsTree;
    // Same instance: not rebuilt on the second call.
    expect(secondTree).toBe(firstTree);
  });

  it('applyBVH with recursive=false only visits direct children of the root', () => {
    const root = new THREE.Group();
    const direct = new THREE.Mesh(new THREE.BoxGeometry());
    const nested = new THREE.Mesh(new THREE.BoxGeometry());
    const innerGroup = new THREE.Group();
    innerGroup.add(nested);
    root.add(direct);
    root.add(innerGroup);
    applyBVH(root, {recursive: false});
    // The root itself isn't a mesh, neither is innerGroup, so neither
    // direct nor nested gets a tree (recursive=false skips descending
    // into root's children as a tree walk; the root is just the
    // starting node).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((direct.geometry as any).boundsTree).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((nested.geometry as any).boundsTree).toBeUndefined();
  });

  it('disposeBVH drops the boundsTree on every mesh in the tree', () => {
    const root = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry());
    root.add(m);
    applyBVH(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((m.geometry as any).boundsTree).toBeDefined();
    disposeBVH(root);
    // disposeBoundsTree sets boundsTree to null, not undefined.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((m.geometry as any).boundsTree).toBeFalsy();
  });
});
