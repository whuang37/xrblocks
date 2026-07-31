import * as THREE from 'three';

import {MouseController} from '../../input/MouseController';
import {clamp} from '../../utils/utils';

const positionDifference = new THREE.Vector3();
const rotationDifference = new THREE.Quaternion();
const euler = new THREE.Euler();

/** Converts controller motion into a bounded scalar value. */
export class FreestandingSlider {
  readonly initialPosition = new THREE.Vector3();
  readonly initialRotationInverse = new THREE.Quaternion();
  readonly rotationScale: number;

  constructor(
    public startingValue = 0,
    public minValue = 0,
    public maxValue = 1,
    public scale = 1,
    rotationScale = -scale
  ) {
    this.rotationScale = rotationScale;
  }

  /** Captures the input pose at the start of a slider gesture. */
  setInitialPose(position: THREE.Vector3, rotation: THREE.Quaternion): void {
    this.initialPosition.copy(position);
    this.initialRotationInverse.copy(rotation).invert();
  }

  /** Captures the current controller pose. */
  setInitialPoseFromController(controller: THREE.Object3D): void {
    this.setInitialPose(controller.position, controller.quaternion);
  }

  /** Gets a value from positional input. */
  getValue(position: THREE.Vector3): number {
    positionDifference
      .copy(position)
      .sub(this.initialPosition)
      .applyQuaternion(this.initialRotationInverse);
    return clamp(
      this.startingValue + this.scale * positionDifference.x,
      this.minValue,
      this.maxValue
    );
  }

  /** Gets a value from rotational input. */
  getValueFromRotation(rotation: THREE.Quaternion): number {
    rotationDifference.copy(rotation).multiply(this.initialRotationInverse);
    euler.setFromQuaternion(rotationDifference, 'YXZ');
    return clamp(
      this.startingValue + this.rotationScale * euler.y,
      this.minValue,
      this.maxValue
    );
  }

  /** Selects positional or rotational input for the controller type. */
  getValueFromController(controller: THREE.Object3D): number {
    return controller instanceof MouseController
      ? this.getValueFromRotation(controller.quaternion)
      : this.getValue(controller.position);
  }

  /** Stores the value used as the next gesture baseline. */
  updateValue(value: number): void {
    this.startingValue = value;
  }
}
