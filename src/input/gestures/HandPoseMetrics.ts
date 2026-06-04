import * as THREE from 'three';

import {
  HAND_BONE_IDX_CONNECTION_MAP,
  HAND_JOINT_IDX_CONNECTION_MAP,
} from '../../constants';
import type {JointName} from '../Hands';
import {HAND_JOINT_NAMES} from '../components/HandJointNames';
import type {HandContext} from './GestureTypes';

export type FingerName = 'index' | 'middle' | 'ring' | 'pinky';

export type FingerMetrics = {
  tip: THREE.Vector3;
  metacarpal?: THREE.Vector3;
  referenceDistance: number;
  tipDistance: number;
  curlRatio: number;
};

export type ThumbMetrics = {
  tip: THREE.Vector3;
  metacarpal?: THREE.Vector3;
  referenceDistance: number;
  tipDistance: number;
};

export const FINGER_ORDER: FingerName[] = [
  'index',
  'middle',
  'ring',
  'pinky',
];

const FINGER_PREFIX: Record<FingerName, string> = {
  index: 'index-finger',
  middle: 'middle-finger',
  ring: 'ring-finger',
  pinky: 'pinky-finger',
};

const EPSILON = 1e-6;

export function getJoint(context: HandContext, jointName: JointName) {
  return context.getJoint(jointName) ?? context.joints.get(jointName);
}

export function getFingerJoint(
  context: HandContext,
  finger: FingerName,
  suffix: string
) {
  const prefix = FINGER_PREFIX[finger];
  return getJoint(context, `${prefix}-${suffix}` as JointName);
}

export function getFingerMetrics(context: HandContext) {
  return FINGER_ORDER.map((finger) =>
    getFingerMetric(context, finger)
  ).filter(Boolean) as FingerMetrics[];
}

export function getFingerMetric(
  context: HandContext,
  finger: FingerName
): FingerMetrics | null {
  const tip = getFingerJoint(context, finger, 'tip');
  const proximal = getFingerJoint(context, finger, 'phalanx-proximal');
  const metacarpal = getFingerJoint(context, finger, 'metacarpal');
  const wrist = getJoint(context, 'wrist');
  if (!tip || !wrist) return null;

  const reference = proximal ?? metacarpal;
  if (!reference) return null;

  const referenceDistance = reference.distanceTo(wrist);
  const tipDistance = tip.distanceTo(wrist);
  const curlRatio =
    referenceDistance > EPSILON ? tipDistance / referenceDistance : 0;

  return {
    tip,
    metacarpal,
    referenceDistance,
    tipDistance,
    curlRatio,
  };
}

export function getThumbMetrics(context: HandContext): ThumbMetrics | undefined {
  const tip = getJoint(context, 'thumb-tip');
  const wrist = getJoint(context, 'wrist');
  if (!tip || !wrist) return undefined;

  const metacarpal =
    getJoint(context, 'thumb-metacarpal') ??
    getJoint(context, 'thumb-phalanx-proximal');
  if (!metacarpal) return undefined;

  const referenceDistance = metacarpal.distanceTo(wrist);
  const tipDistance = tip.distanceTo(wrist);

  return {
    tip,
    metacarpal,
    referenceDistance,
    tipDistance,
  };
}

export function estimateHandScale(context: HandContext) {
  const wrist = getJoint(context, 'wrist');
  const middleTip = getJoint(context, 'middle-finger-tip');
  const middleBase = getJoint(context, 'middle-finger-metacarpal');
  const palmWidth = getPalmWidth(context);

  const measurements: number[] = [];
  if (wrist && middleTip) measurements.push(middleTip.distanceTo(wrist));
  if (palmWidth) measurements.push(palmWidth);
  if (wrist && middleBase) measurements.push(middleBase.distanceTo(wrist) * 2);

  if (!measurements.length) return 0.08;
  return average(measurements);
}

export function getPalmWidth(context: HandContext) {
  const indexBase = getFingerJoint(context, 'index', 'metacarpal');
  const pinkyBase = getFingerJoint(context, 'pinky', 'metacarpal');
  if (!indexBase || !pinkyBase) return null;
  return indexBase.distanceTo(pinkyBase);
}

export function getPalmNormal(context: HandContext) {
  const wrist = getJoint(context, 'wrist');
  const indexBase = getFingerJoint(context, 'index', 'metacarpal');
  const pinkyBase = getFingerJoint(context, 'pinky', 'metacarpal');
  if (!wrist || !indexBase || !pinkyBase) return null;

  const u = new THREE.Vector3().subVectors(indexBase, wrist);
  const v = new THREE.Vector3().subVectors(pinkyBase, wrist);
  if (u.lengthSq() === 0 || v.lengthSq() === 0) return null;

  const normal = new THREE.Vector3().crossVectors(u, v);
  if (normal.lengthSq() === 0) return null;
  if (context.handLabel === 'left') normal.multiplyScalar(-1);
  return normal.normalize();
}

export function getPalmRight(context: HandContext) {
  const indexBase = getFingerJoint(context, 'index', 'metacarpal');
  const pinkyBase = getFingerJoint(context, 'pinky', 'metacarpal');
  if (!indexBase || !pinkyBase) return null;
  const right = new THREE.Vector3().subVectors(indexBase, pinkyBase);
  if (context.handLabel === 'left') right.multiplyScalar(-1);
  if (right.lengthSq() === 0) return null;
  return right.normalize();
}

export function getPalmUp(context: HandContext) {
  const normal = getPalmNormal(context);
  const right = getPalmRight(context);
  if (!normal || !right) return null;

  const up = new THREE.Vector3().copy(right).cross(normal);
  if (up.lengthSq() === 0) return null;
  return up.normalize();
}

export function getAdjacentFingerDistances(context: HandContext) {
  const tips = FINGER_ORDER.map((finger) =>
    getFingerJoint(context, finger, 'tip')
  );
  if (tips.some((tip) => !tip)) {
    return {average: Infinity};
  }
  const distances = [
    tips[0]!.distanceTo(tips[1]!),
    tips[1]!.distanceTo(tips[2]!),
    tips[2]!.distanceTo(tips[3]!),
  ];
  return {average: average(distances)};
}

export function getFingerAlignmentScore(
  context: HandContext,
  metrics: FingerMetrics,
  palmUp: THREE.Vector3
) {
  const base = metrics.metacarpal ?? getJoint(context, 'wrist');
  if (!base) return 0;
  const direction = new THREE.Vector3().subVectors(metrics.tip, base);
  if (direction.lengthSq() === 0) return 0;
  direction.normalize();
  return clamp01((direction.dot(palmUp) - 0.35) / 0.5);
}

export function getBoneVectors(context: HandContext, global = false) {
  return HAND_JOINT_IDX_CONNECTION_MAP.map(([joint1, joint2]) => {
    const start = context.getJoint(HAND_JOINT_NAMES[joint1], global);
    const end = context.getJoint(HAND_JOINT_NAMES[joint2], global);
    if (!start || !end) return new THREE.Vector3();

    const boneVector = new THREE.Vector3().subVectors(end, start);
    if (boneVector.lengthSq() === 0) return boneVector;
    return boneVector.normalize();
  });
}

export function getRelativeBoneAngles(context: HandContext, global = false) {
  const boneVectors = getBoneVectors(context, global);
  const angles = new Float32Array(HAND_BONE_IDX_CONNECTION_MAP.length);
  HAND_BONE_IDX_CONNECTION_MAP.forEach(([bone1, bone2], index) => {
    angles[index] = boneVectors[bone1].dot(boneVectors[bone2]);
  });
  return angles;
}

export function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function clamp01(value: number) {
  return THREE.MathUtils.clamp(value, 0, 1);
}
