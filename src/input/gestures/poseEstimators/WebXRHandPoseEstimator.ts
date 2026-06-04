import * as THREE from 'three';

import {Handedness, JointName} from '../../Hands';
import {HAND_JOINT_NAMES} from '../../components/HandJointNames';
import {User} from '../../../core/User';
import {
  HandContext,
  HandLabel,
  JointPositions,
  PoseEstimator,
} from '../GestureTypes';

const HAND_INDEX_TO_LABEL: Record<number, HandLabel> = {
  [Handedness.LEFT]: 'left',
  [Handedness.RIGHT]: 'right',
};

class WebXRHandContext implements HandContext {
  joints: JointPositions;
  private localPositions: JointPositions;
  private globalPositions: JointPositions;

  constructor(
    public handedness: Handedness,
    public handLabel: HandLabel,
    public globalTransform: THREE.Matrix4,
    localPositions: JointPositions,
    globalPositions: JointPositions
  ) {
    this.localPositions = localPositions;
    this.globalPositions = globalPositions;
    this.joints = this.globalPositions;
  }

  getLocalJointPositions() {
    return jointMapToArray(this.localPositions);
  }

  getGlobalJointPositions() {
    return jointMapToArray(this.globalPositions);
  }

  getJoint(jointName: JointName, global = true) {
    return global
      ? this.globalPositions.get(jointName)
      : this.localPositions.get(jointName);
  }
}

export class WebXRHandPoseEstimator implements PoseEstimator {
  private user?: User;

  constructor(user?: User) {
    this.user = user;
  }

  init({user}: {user?: User} = {}) {
    if (user) this.user = user;
    return Promise.resolve();
  }

  getHandContext(handedness: Handedness) {
    if (!this.user?.hands) return null;
    const hand = this.user.hands.hands[handedness];
    const handLabel = HAND_INDEX_TO_LABEL[handedness];
    if (!hand?.joints || !handLabel) return null;

    const localPositions: JointPositions = new Map();
    const globalPositions: JointPositions = new Map();
    const globalTransform = new THREE.Matrix4();

    for (const jointName of HAND_JOINT_NAMES) {
      const joint = hand.joints[jointName];
      if (!joint) continue;

      localPositions.set(jointName, joint.position.clone());
      globalPositions.set(
        jointName,
        new THREE.Vector3().setFromMatrixPosition(joint.matrixWorld)
      );
    }

    if (!globalPositions.size) return null;
    const wrist = hand.joints.wrist;
    if (wrist) globalTransform.copy(wrist.matrixWorld);

    return new WebXRHandContext(
      handedness,
      handLabel,
      globalTransform,
      localPositions,
      globalPositions
    );
  }

  getHandContexts() {
    return {
      left: this.getHandContext(Handedness.LEFT) ?? undefined,
      right: this.getHandContext(Handedness.RIGHT) ?? undefined,
    };
  }
}

function jointMapToArray(joints: JointPositions) {
  const positions = new Float32Array(HAND_JOINT_NAMES.length * 3);
  HAND_JOINT_NAMES.forEach((jointName, index) => {
    const joint = joints.get(jointName);
    if (!joint) return;
    const offset = index * 3;
    positions[offset] = joint.x;
    positions[offset + 1] = joint.y;
    positions[offset + 2] = joint.z;
  });
  return positions;
}
