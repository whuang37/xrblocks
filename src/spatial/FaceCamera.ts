import * as THREE from 'three';

import {TransformScript} from './TransformScript';

export type FaceCameraMode = 'cylindrical' | 'spherical';

export interface FaceCameraOptions {
  mode?: FaceCameraMode;
  smoothing?: number;
}

/** Rotates its parent to face the active camera. */
export class FaceCamera extends TransformScript {
  static dependencies = {camera: THREE.Camera, timer: THREE.Timer};

  private camera?: THREE.Camera;
  private timer?: THREE.Timer;
  private readonly target = new THREE.Vector3();
  private readonly helper = new THREE.Object3D();
  private readonly mode: FaceCameraMode;
  private readonly smoothing: number;

  constructor(options: FaceCameraOptions = {}) {
    super();
    this.mode = options.mode ?? 'cylindrical';
    this.smoothing = options.smoothing ?? 0.1;
  }

  init({camera, timer}: {camera: THREE.Camera; timer: THREE.Timer}) {
    this.camera = camera;
    this.timer = timer;
  }

  update() {
    const object = this.parent;
    if (!this.canUpdate || !object || !this.camera || !this.timer) return;

    this.helper.position.copy(object.position);
    this.target.copy(this.camera.position);
    if (this.mode === 'cylindrical') this.target.y = object.position.y;
    this.helper.lookAt(this.target);

    const alpha = 1 - Math.exp(-this.smoothing * this.timer.getDelta() * 60);
    object.quaternion.slerp(this.helper.quaternion, alpha);
  }
}
