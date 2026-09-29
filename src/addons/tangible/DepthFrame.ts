import * as THREE from 'three';

/** A frozen, RGB-aligned index of real depth vertices. Empty cells stay empty. */
export class DepthFrame {
  private readonly points: Float32Array;
  private readonly ranges: Float32Array;
  readonly cameraPosition = new THREE.Vector3();
  readonly cameraQuaternion = new THREE.Quaternion();

  constructor(
    mesh: THREE.Mesh,
    worldFromCamera: THREE.Matrix4,
    clipFromCamera: THREE.Matrix4,
    readonly timeMs: number,
    private readonly resolution = 160
  ) {
    this.points = new Float32Array(resolution * resolution * 3);
    this.ranges = new Float32Array(resolution * resolution).fill(Infinity);
    this.cameraPosition.setFromMatrixPosition(worldFromCamera);
    this.cameraQuaternion.setFromRotationMatrix(worldFromCamera);
    const clipFromWorld = clipFromCamera
      .clone()
      .multiply(worldFromCamera.clone().invert());
    const positions = mesh.geometry.getAttribute('position');
    const world = new THREE.Vector3();
    const clip = new THREE.Vector3();
    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < positions.count; i++) {
      world.fromBufferAttribute(positions, i);
      // Depth meshes encode missing depth at the depth-camera origin.
      if (world.lengthSq() < 0.000001) continue;
      world.applyMatrix4(mesh.matrixWorld);
      clip.copy(world).applyMatrix4(clipFromWorld);
      if (
        !Number.isFinite(clip.x + clip.y + clip.z) ||
        clip.z < -1 ||
        clip.z > 1
      )
        continue;
      const x = Math.floor((clip.x + 1) * 0.5 * resolution);
      const y = Math.floor((1 - clip.y) * 0.5 * resolution);
      if (x < 0 || y < 0 || x >= resolution || y >= resolution) continue;
      const distance = world.distanceToSquared(this.cameraPosition);
      if (distance < 0.15 ** 2 || distance > 4 ** 2) continue;
      const index = y * resolution + x;
      if (distance >= this.ranges[index]) continue;
      this.ranges[index] = distance;
      world.toArray(this.points, index * 3);
    }
  }

  sample(u: number, v: number): THREE.Vector3 | null {
    if (!Number.isFinite(u + v) || u < 0 || v < 0 || u >= 1 || v >= 1)
      return null;
    const x = Math.floor(u * this.resolution);
    const y = Math.floor(v * this.resolution);
    let nearest = -1;
    let best = Infinity;
    // A small search accounts for the coarser depth resolution. Never fill a
    // large hole or project through it to a guessed plane.
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= this.resolution || py >= this.resolution)
          continue;
        const index = py * this.resolution + px;
        const error =
          (px + 0.5 - u * this.resolution) ** 2 +
          (py + 0.5 - v * this.resolution) ** 2;
        if (Number.isFinite(this.ranges[index]) && error < best) {
          nearest = index;
          best = error;
        }
      }
    }
    return nearest < 0
      ? null
      : new THREE.Vector3().fromArray(this.points, nearest * 3);
  }
}
