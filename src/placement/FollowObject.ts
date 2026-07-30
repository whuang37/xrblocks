import * as THREE from 'three';

import {TransformScript} from './TransformScript';

export type FollowObjectMode = 'position' | 'rotation' | 'pose';

export interface FollowObjectOptions {
  target: THREE.Object3D;
  mode?: FollowObjectMode;
  positionOffset?: THREE.Vector3;
  rotationOffset?: THREE.Quaternion;
}

/** Copies position, rotation, or both from another object to its parent. */
export class FollowObject extends TransformScript {
  private readonly target: THREE.Object3D;
  private readonly mode: FollowObjectMode;
  private readonly positionOffset: THREE.Vector3;
  private readonly rotationOffset: THREE.Quaternion;

  constructor(options: FollowObjectOptions) {
    super();
    this.target = options.target;
    this.mode = options.mode ?? 'position';
    this.positionOffset =
      options.positionOffset?.clone() ?? new THREE.Vector3();
    this.rotationOffset =
      options.rotationOffset?.clone() ?? new THREE.Quaternion();
  }

  update() {
    const object = this.parent;
    if (!this.canUpdate || !object) return;
    if (this.mode === 'position' || this.mode === 'pose') {
      object.position.copy(this.target.position).add(this.positionOffset);
    }
    if (this.mode === 'rotation' || this.mode === 'pose') {
      object.quaternion
        .copy(this.target.quaternion)
        .multiply(this.rotationOffset);
    }
  }

  protected rebase() {
    const object = this.parent;
    if (!object) return;
    if (this.mode === 'position' || this.mode === 'pose') {
      this.positionOffset.copy(object.position).sub(this.target.position);
    }
    if (this.mode === 'rotation' || this.mode === 'pose') {
      this.rotationOffset
        .copy(this.target.quaternion)
        .invert()
        .multiply(object.quaternion);
    }
  }
}
