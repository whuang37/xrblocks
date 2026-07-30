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
  private readonly parentWorldQuaternion = new THREE.Quaternion();
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

    object.getWorldPosition(this.helper.position);
    this.camera.getWorldPosition(this.target);
    if (this.mode === 'cylindrical') this.target.y = this.helper.position.y;
    this.helper.lookAt(this.target);

    if (object.parent) {
      object.parent.getWorldQuaternion(this.parentWorldQuaternion);
      this.helper.quaternion.premultiply(this.parentWorldQuaternion.invert());
    }

    const alpha = 1 - Math.exp(-this.smoothing * this.timer.getDelta() * 60);
    object.quaternion.slerp(this.helper.quaternion, alpha);
  }
}
