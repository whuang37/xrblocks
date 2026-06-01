import type {JointName} from '../../input/Hands';
import {HAND_JOINT_NAMES} from '../../input/components/HandJointNames';

export type SimulatorHandPoseJoints = {
  t: number[];
  r: number[];
  s?: number[];
}[];

/**
 * Semantic biomechanical hand angles in radians, ordered as [x, y, z].
 *
 * Long fingers:
 * - x: positive flexes toward the palm; negative extends away.
 * - y: positive abducts away from the middle-finger axis; negative adducts.
 * - z: positive axial roll toward the thumb; negative rolls away.
 *
 * Middle finger:
 * - y: positive radial deviation toward index/thumb; negative ulnar deviation.
 *
 * Thumb:
 * - x: positive flexes across the palm; negative extends/repositions.
 * - y: positive palmar abduction away from the palm; negative adducts back.
 * - z: positive opposition/internal roll into the hand; negative repositions away.
 */
export type SimulatorHandJointRotationArray = [number, number, number];

export type SimulatorHandPoseRotations = Partial<
  Record<JointName, SimulatorHandJointRotationArray>
>;

const HAND_JOINT_NAME_SET = new Set<string>(HAND_JOINT_NAMES);

export function parseSimulatorHandPoseRotations(
  json: unknown
): SimulatorHandPoseRotations {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return {};
  }

  const rotations: SimulatorHandPoseRotations = {};
  for (const [jointName, value] of Object.entries(json)) {
    if (!HAND_JOINT_NAME_SET.has(jointName)) continue;
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      !value.every((axisValue) => typeof axisValue === 'number')
    ) {
      continue;
    }

    rotations[jointName as JointName] = [value[0], value[1], value[2]];
  }

  return rotations;
}
