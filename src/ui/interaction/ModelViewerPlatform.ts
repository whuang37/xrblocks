import * as THREE from 'three';

import type {XBObjectOptions} from '../../interaction/InteractionTypes';
import {ManipulationAction} from '../../interaction/manipulation/ManipulationTypes';

import {AnimatableNumber} from './AnimatableNumber.js';
import {createPlatformGeometry} from './ModelViewerPlatformGeometry.js';

/**
 * A specialized `THREE.Mesh` that serves as the interactive base for
 * a `ModelViewer`. It has a distinct visual appearance and handles the logic
 * for fading in and out on hover. It is the translation handle for its viewer.
 */
export class ModelViewerPlatform extends THREE.Mesh<
  THREE.BufferGeometry,
  THREE.Material[]
> {
  xb: XBObjectOptions = {
    manipulationHandle: {action: ManipulationAction.Translate},
  };
  opacity: AnimatableNumber;

  constructor(width: number, depth: number, thickness: number) {
    const geometry = createPlatformGeometry(width, depth, thickness);
    super(geometry, [
      new THREE.MeshLambertMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.0,
      }),
      new THREE.MeshLambertMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.0,
      }),
    ]);
    this.userData.xrblocksPrivateSelf = true;
    this.opacity = new AnimatableNumber(0, 0, 0.5, 0);
  }

  update(deltaTime: number) {
    this.opacity.update(deltaTime);
    this.material[0].opacity = this.opacity.value;
    this.material[1].opacity = 0.5 * this.opacity.value;
  }
}
