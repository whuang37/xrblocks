import type {JointName} from '../../input/Hands';
import {HAND_JOINT_NAMES} from '../../input/components/HandJointNames';

export type SimulatorHandPoseJoints = {
  t: number[];
  r: number[];
  s?: number[];
}[];

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
