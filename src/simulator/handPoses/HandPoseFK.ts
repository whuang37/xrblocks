import * as THREE from 'three';

/**
 * SimulatorHandPoseRotations are authored as standardized biomechanical hand angles
 *
 * Long fingers:
 * - x: flexion toward the palm; negative x extends away from the palm.
 * - y: abduction away from the middle-finger axis; negative y adducts toward it.
 * - z: axial radial roll toward the thumb; negative z rolls away from the thumb.
 *
 * Middle finger:
 * - y: radial deviation toward index/thumb; negative y is ulnar deviation.
 *
 * Thumb:
 * - x: flexion across the palm; negative x extends/repositions.
 * - y: palmar abduction away from the palm; negative y adducts back.
 * - z: opposition/internal roll into the hand; negative z repositions away.
 */

import {HAND_JOINT_NAMES} from '../../input/components/HandJointNames';
import {Handedness, type JointName} from '../../input/Hands';
import type {
  SimulatorHandJointRotationArray,
  SimulatorHandPoseJoints,
  SimulatorHandPoseRotations,
} from './HandPoseJoints';
import {LEFT_HAND_NEUTRAL, RIGHT_HAND_NEUTRAL} from './NeutralHandPose';

const HAND_JOINT_PARENT: Partial<Record<JointName, JointName>> = {
  'thumb-metacarpal': 'wrist',
  'thumb-phalanx-proximal': 'thumb-metacarpal',
  'thumb-phalanx-distal': 'thumb-phalanx-proximal',
  'thumb-tip': 'thumb-phalanx-distal',
  'index-finger-metacarpal': 'wrist',
  'index-finger-phalanx-proximal': 'index-finger-metacarpal',
  'index-finger-phalanx-intermediate': 'index-finger-phalanx-proximal',
  'index-finger-phalanx-distal': 'index-finger-phalanx-intermediate',
  'index-finger-tip': 'index-finger-phalanx-distal',
  'middle-finger-metacarpal': 'wrist',
  'middle-finger-phalanx-proximal': 'middle-finger-metacarpal',
  'middle-finger-phalanx-intermediate': 'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-distal': 'middle-finger-phalanx-intermediate',
  'middle-finger-tip': 'middle-finger-phalanx-distal',
  'ring-finger-metacarpal': 'wrist',
  'ring-finger-phalanx-proximal': 'ring-finger-metacarpal',
  'ring-finger-phalanx-intermediate': 'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-distal': 'ring-finger-phalanx-intermediate',
  'ring-finger-tip': 'ring-finger-phalanx-distal',
  'pinky-finger-metacarpal': 'wrist',
  'pinky-finger-phalanx-proximal': 'pinky-finger-metacarpal',
  'pinky-finger-phalanx-intermediate': 'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-distal': 'pinky-finger-phalanx-intermediate',
  'pinky-finger-tip': 'pinky-finger-phalanx-distal',
};

type RestJoint = {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  localOffset: THREE.Vector3;
  localRotation: THREE.Quaternion;
};

function createRestJoints(
  joints: typeof LEFT_HAND_NEUTRAL | typeof RIGHT_HAND_NEUTRAL
) {
  const restJoints = new Map<JointName, RestJoint>();
  HAND_JOINT_NAMES.forEach((jointName, index) => {
    const joint = joints[index];
    const position = new THREE.Vector3(joint.t[0], joint.t[1], joint.t[2]);
    const rotation = new THREE.Quaternion(
      joint.r[0],
      joint.r[1],
      joint.r[2],
      joint.r[3]
    );
    const parentName = HAND_JOINT_PARENT[jointName];

    if (!parentName) {
      restJoints.set(jointName, {
        position,
        rotation,
        localOffset: position.clone(),
        localRotation: rotation.clone(),
      });
      return;
    }

    const parentRestJoint = restJoints.get(parentName)!;
    const inverseParentRotation = parentRestJoint.rotation.clone().invert();
    const localOffset = position
      .clone()
      .sub(parentRestJoint.position)
      .applyQuaternion(inverseParentRotation);
    const localRotation = parentRestJoint.rotation
      .clone()
      .invert()
      .multiply(rotation);

    restJoints.set(jointName, {
      position,
      rotation,
      localOffset,
      localRotation,
    });
  });
  return restJoints;
}

const LEFT_REST_JOINTS = createRestJoints(LEFT_HAND_NEUTRAL);
const RIGHT_REST_JOINTS = createRestJoints(RIGHT_HAND_NEUTRAL);

function getRawFKRotation(
  jointName: JointName,
  rotation: SimulatorHandPoseRotations[JointName] = [0, 0, 0]
): SimulatorHandJointRotationArray {
  const [x, y, z] = rotation;

  if (jointName.startsWith('thumb-')) {
    return [-x, -y, -z];
  }

  if (
    jointName.startsWith('index-finger-') ||
    jointName.startsWith('middle-finger-')
  ) {
    return [-x, -y, z];
  }

  return [-x, y, z];
}

function getHandednessRotation(
  handedness: Handedness,
  rotation: SimulatorHandJointRotationArray
) {
  if (handedness !== Handedness.RIGHT) {
    return rotation;
  }
  return [rotation[0], -rotation[1], -rotation[2]] as const;
}

function resolveHandPoseRotations(
  handedness: Handedness,
  restJoints: Map<JointName, RestJoint>,
  rotations: SimulatorHandPoseRotations
): SimulatorHandPoseJoints {
  const finalPositions = new Map<JointName, THREE.Vector3>();
  const finalRotations = new Map<JointName, THREE.Quaternion>();
  const resolvedJoints: SimulatorHandPoseJoints = [];

  for (const jointName of HAND_JOINT_NAMES) {
    const restJoint = restJoints.get(jointName)!;
    const rawRotation = getRawFKRotation(jointName, rotations[jointName]);
    const rotation = getHandednessRotation(handedness, rawRotation);
    const offsetRotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ')
    );
    const parentName = HAND_JOINT_PARENT[jointName];

    if (!parentName) {
      const finalPosition = restJoint.position.clone();
      const finalRotation = restJoint.rotation.clone().multiply(offsetRotation);
      finalPositions.set(jointName, finalPosition);
      finalRotations.set(jointName, finalRotation);
      resolvedJoints.push({
        t: finalPosition.toArray(),
        r: finalRotation.toArray(),
        s: [1, 1, 1],
      });
      continue;
    }

    const parentPosition = finalPositions.get(parentName)!;
    const parentRotation = finalRotations.get(parentName)!;
    const finalPosition = restJoint.localOffset
      .clone()
      .applyQuaternion(parentRotation)
      .add(parentPosition);
    const finalRotation = parentRotation
      .clone()
      .multiply(restJoint.localRotation)
      .multiply(offsetRotation);
    finalPositions.set(jointName, finalPosition);
    finalRotations.set(jointName, finalRotation);
    resolvedJoints.push({
      t: finalPosition.toArray(),
      r: finalRotation.toArray(),
      s: [1, 1, 1],
    });
  }

  return resolvedJoints;
}

export function resolveSimulatorHandPoseRotations(
  handedness: Handedness,
  rotations: SimulatorHandPoseRotations
) {
  return resolveHandPoseRotations(
    handedness,
    handedness === Handedness.LEFT ? LEFT_REST_JOINTS : RIGHT_REST_JOINTS,
    rotations
  );
}
