import * as THREE from 'three';
import {describe, expect, it} from 'vitest';

import {
  applyBVH,
  disposeBVH,
  enableAcceleratedRaycast,
  isBVHReady,
} from './BVHRaycast';

describe('BVHRaycast', () => {
  it('installs the THREE.Mesh prototype patch and helpers after enableAcceleratedRaycast resolves', async () => {
    const ok = await enableAcceleratedRaycast();
    expect(ok).toBe(true);
    expect(isBVHReady()).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = THREE.BufferGeometry.prototype as any;
    expect(typeof proto.computeBoundsTree).toBe('function');
    expect(typeof proto.disposeBoundsTree).toBe('function');
  });

  it('is idempotent: re-calling enableAcceleratedRaycast returns same result and does not re-patch', async () => {
    const first = await enableAcceleratedRaycast();
    const second = await enableAcceleratedRaycast();
    expect(first).toBe(true);
    expect(second).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = THREE.BufferGeometry.prototype as any;
    expect(typeof proto.computeBoundsTree).toBe('function');
  });

  it('applyBVH builds a boundsTree on every mesh in the tree (recursive)', async () => {
    const root = new THREE.Group();
    const m1 = new THREE.Mesh(new THREE.BoxGeometry());
    const m2 = new THREE.Mesh(new THREE.SphereGeometry());
    const inner = new THREE.Group();
    inner.add(m2);
    root.add(m1);
    root.add(inner);
    await applyBVH(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((m1.geometry as any).boundsTree).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((m2.geometry as any).boundsTree).toBeDefined();
  });

  it('applyBVH skips meshes that already have a boundsTree (idempotent)', async () => {
    const root = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry());
    root.add(m);
    await applyBVH(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstTree = (m.geometry as any).boundsTree;
    await applyBVH(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secondTree = (m.geometry as any).boundsTree;
    expect(secondTree).toBe(firstTree);
  });

  it('applyBVH with recursive=false only visits the root itself', async () => {
    const root = new THREE.Group();
    const direct = new THREE.Mesh(new THREE.BoxGeometry());
    const nested = new THREE.Mesh(new THREE.BoxGeometry());
    const innerGroup = new THREE.Group();
    innerGroup.add(nested);
    root.add(direct);
    root.add(innerGroup);
    await applyBVH(root, {recursive: false});
    // The root is a Group (not a Mesh), so nothing gets a tree when
    // recursive=false: we only visit the root itself.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((direct.geometry as any).boundsTree).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((nested.geometry as any).boundsTree).toBeUndefined();
  });

  it('disposeBVH drops the boundsTree on every mesh in the tree', async () => {
    const root = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry());
    root.add(m);
    await applyBVH(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((m.geometry as any).boundsTree).toBeDefined();
    disposeBVH(root);
    // disposeBoundsTree sets boundsTree to null.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((m.geometry as any).boundsTree).toBeFalsy();
  });
});
