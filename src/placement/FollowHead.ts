import * as THREE from 'three';

import {TransformScript} from './TransformScript';

export interface FollowHeadOptions {
  offset: THREE.Vector3;
  smoothing?: number;
}

/** Moves its parent toward an offset in camera space. */
export class FollowHead extends TransformScript {
  static dependencies = {camera: THREE.Camera, timer: THREE.Timer};

  private camera?: THREE.Camera;
  private timer?: THREE.Timer;
  private readonly offset: THREE.Vector3;
  private readonly target = new THREE.Vector3();
  private readonly smoothing: number;

  constructor(options: FollowHeadOptions) {
    super();
    this.offset = options.offset.clone();
    this.smoothing = options.smoothing ?? 0.1;
  }

  init({camera, timer}: {camera: THREE.Camera; timer: THREE.Timer}) {
    this.camera = camera;
    this.timer = timer;
  }

  update() {
    const object = this.parent;
    if (!this.canUpdate || !object || !this.camera || !this.timer) return;

    this.target
      .copy(this.offset)
      .applyQuaternion(this.camera.quaternion)
      .add(this.camera.position);
    const alpha = 1 - Math.exp(-this.smoothing * this.timer.getDelta() * 60);
    object.position.lerp(this.target, alpha);
  }

  protected rebase() {
    const object = this.parent;
    if (!object || !this.camera) return;
    this.offset
      .copy(object.position)
      .sub(this.camera.position)
      .applyQuaternion(this.camera.quaternion.clone().invert());
  }
}
