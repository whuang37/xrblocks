import * as THREE from 'three';

export interface PointPair {
  source: THREE.Vector3;
  target: THREE.Vector3;
}

export interface RigidPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  inliers: number;
  residualMeters: number;
}

// Largest eigenvector of a symmetric 4x4 matrix, by Jacobi rotations. Unlike
// power iteration, this selects the largest algebraic (not absolute) eigenvalue.
function largestEigenvector(a: number[]): number[] {
  const v = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let iteration = 0; iteration < 48; iteration++) {
    let p = 0;
    let q = 1;
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        if (Math.abs(a[i * 4 + j]) > Math.abs(a[p * 4 + q])) {
          p = i;
          q = j;
        }
      }
    }
    if (Math.abs(a[p * 4 + q]) < 1e-12) break;
    const angle =
      0.5 * Math.atan2(2 * a[p * 4 + q], a[q * 4 + q] - a[p * 4 + p]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (let k = 0; k < 4; k++) {
      const ap = a[k * 4 + p];
      const aq = a[k * 4 + q];
      a[k * 4 + p] = c * ap - s * aq;
      a[k * 4 + q] = s * ap + c * aq;
      const vp = v[k * 4 + p];
      const vq = v[k * 4 + q];
      v[k * 4 + p] = c * vp - s * vq;
      v[k * 4 + q] = s * vp + c * vq;
    }
    for (let k = 0; k < 4; k++) {
      const ap = a[p * 4 + k];
      const aq = a[q * 4 + k];
      a[p * 4 + k] = c * ap - s * aq;
      a[q * 4 + k] = s * ap + c * aq;
    }
  }
  let index = 0;
  for (let i = 1; i < 4; i++) {
    if (a[i * 4 + i] > a[index * 4 + index]) index = i;
  }
  return [v[index], v[4 + index], v[8 + index], v[12 + index]];
}

function fit(pairs: readonly PointPair[]): RigidPose | null {
  if (pairs.length < 3) return null;
  const sourceCenter = new THREE.Vector3();
  const targetCenter = new THREE.Vector3();
  for (const pair of pairs) {
    sourceCenter.add(pair.source);
    targetCenter.add(pair.target);
  }
  sourceCenter.divideScalar(pairs.length);
  targetCenter.divideScalar(pairs.length);
  const s = new Array<number>(9).fill(0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let spread = 0;
  const first = new THREE.Vector3();
  for (const pair of pairs) {
    a.subVectors(pair.source, sourceCenter);
    if (a.lengthSq() > first.lengthSq()) first.copy(a);
  }
  let area = 0;
  for (const pair of pairs) {
    a.subVectors(pair.source, sourceCenter);
    b.subVectors(pair.target, targetCenter);
    spread += a.lengthSq();
    area = Math.max(area, cross.crossVectors(a, first).lengthSq());
    s[0] += a.x * b.x;
    s[1] += a.x * b.y;
    s[2] += a.x * b.z;
    s[3] += a.y * b.x;
    s[4] += a.y * b.y;
    s[5] += a.y * b.z;
    s[6] += a.z * b.x;
    s[7] += a.z * b.y;
    s[8] += a.z * b.z;
  }
  // Coincident or nearly collinear features cannot constrain all rotations.
  if (spread / pairs.length < 0.000025 || area < 1e-10) return null;
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = s;
  const [w, x, y, z] = largestEigenvector([
    xx + yy + zz,
    yz - zy,
    zx - xz,
    xy - yx,
    yz - zy,
    xx - yy - zz,
    xy + yx,
    zx + xz,
    zx - xz,
    xy + yx,
    -xx + yy - zz,
    yz + zy,
    xy - yx,
    zx + xz,
    yz + zy,
    -xx - yy + zz,
  ]);
  const quaternion = new THREE.Quaternion(x, y, z, w).normalize();
  const position = targetCenter.sub(sourceCenter.applyQuaternion(quaternion));
  let error = 0;
  for (const pair of pairs) {
    error += a
      .copy(pair.source)
      .applyQuaternion(quaternion)
      .add(position)
      .distanceToSquared(pair.target);
  }
  return {
    position,
    quaternion,
    inliers: pairs.length,
    residualMeters: Math.sqrt(error / pairs.length),
  };
}

/** Robust rigid registration of matching metric depth points; no plane assumption. */
export function estimateRigidPose(
  pairs: readonly PointPair[],
  threshold = 0.025
): RigidPose | null {
  const valid = pairs.filter(
    ({source, target}) =>
      Number.isFinite(source.x) &&
      Number.isFinite(source.y) &&
      Number.isFinite(source.z) &&
      Number.isFinite(target.x) &&
      Number.isFinite(target.y) &&
      Number.isFinite(target.z)
  );
  if (valid.length < 6) return null;
  const point = new THREE.Vector3();
  const thresholdSquared = threshold * threshold;
  let best: PointPair[] = [];
  let seed = 2029;
  const randomIndex = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % valid.length;
  };
  for (let trial = 0; trial < 48; trial++) {
    const sample =
      trial === 0
        ? valid
        : [valid[randomIndex()], valid[randomIndex()], valid[randomIndex()]];
    const pose = fit(sample);
    if (!pose) continue;
    const inliers = valid.filter(
      (pair) =>
        point
          .copy(pair.source)
          .applyQuaternion(pose.quaternion)
          .add(pose.position)
          .distanceToSquared(pair.target) <= thresholdSquared
    );
    // Ordinary frames usually agree without outlier sampling. The all-point
    // fit is already the least-squares result; do not solve it another 48 times.
    if (inliers.length === valid.length) return trial === 0 ? pose : fit(valid);
    if (inliers.length > best.length) best = inliers;
  }
  if (best.length < Math.max(6, Math.ceil(valid.length * 0.6))) return null;
  const pose = fit(best);
  return pose && pose.residualMeters <= threshold ? pose : null;
}
