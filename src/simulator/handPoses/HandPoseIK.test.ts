import {describe, expect, it} from 'vitest';
import * as THREE from 'three';

import {Handedness} from '../../input/Hands';
import {HAND_JOINT_NAMES} from '../../input/components/HandJointNames';
import {SimulatorHandPose} from './HandPoses';
import {SIMULATOR_HAND_POSE_ROTATIONS} from './HandPoseRotations';
import {
  resolveSimulatorHandPoseRotations,
  resolveSimulatorRotationsFromKeypoints,
} from './HandPoseFK';

describe('HandPose Inverse Kinematics (IK)', () => {
  const poses = [
    SimulatorHandPose.NEUTRAL,
    SimulatorHandPose.RELAXED,
    SimulatorHandPose.PINCHING,
    SimulatorHandPose.FIST,
    SimulatorHandPose.THUMBS_UP,
    SimulatorHandPose.POINTING,
    SimulatorHandPose.ROCK,
    SimulatorHandPose.THUMBS_DOWN,
    SimulatorHandPose.VICTORY,
  ];

  const handednesses = [Handedness.LEFT, Handedness.RIGHT];

  for (const handedness of handednesses) {
    describe(`${handedness} hand poses`, () => {
      for (const pose of poses) {
        for (const applyConstraints of [false, true]) {
          it(`should accurately roundtrip ${pose} pose (applyConstraints: ${applyConstraints})`, () => {
            const originalRotations = SIMULATOR_HAND_POSE_ROTATIONS[pose];

            // 1. Forward Kinematics to get joint positions/orientations
            const joints = resolveSimulatorHandPoseRotations(
              handedness,
              originalRotations,
              applyConstraints
            );

            // 2. Inverse Kinematics to get rotations back from the keypoints (mathematical fit, no clamping)
            const computedRotations = resolveSimulatorRotationsFromKeypoints(
              handedness,
              joints,
              false
            );

            // 3. Forward Kinematics again using the computed rotations (no clamping)
            const recomputedJoints = resolveSimulatorHandPoseRotations(
              handedness,
              computedRotations,
              false
            );

            // 4. Assert that the recomputed joint positions match the original positions
            for (let i = 0; i < HAND_JOINT_NAMES.length; i++) {
              const jointName = HAND_JOINT_NAMES[i];
              const originalPos = new THREE.Vector3().fromArray(joints[i].t);
              const recomputedPos = new THREE.Vector3().fromArray(
                recomputedJoints[i].t
              );

              const distance = originalPos.distanceTo(recomputedPos);
              expect(
                distance,
                `Joint ${jointName} in pose ${pose} for ${handedness} hand should match original position (diff: ${distance}m)`
              ).toBeLessThan(1e-4);
            }
          });
        }
      }
    });
  }

  it('should enforce biomechanical constraints when applyConstraints = true', () => {
    // Let's create keypoints where the index finger PIP joint is hyperextended to -45 degrees (constraint is [0, 110] degrees).
    const rotations = {
      ...SIMULATOR_HAND_POSE_ROTATIONS[SimulatorHandPose.NEUTRAL],
      'index-finger-phalanx-intermediate': [-45 * (Math.PI / 180), 0, 0] as [
        number,
        number,
        number,
      ],
    };

    // Forward Kinematics (without constraints to force the hyperextension in position)
    const joints = resolveSimulatorHandPoseRotations(
      Handedness.LEFT,
      rotations,
      false
    );

    // Inverse Kinematics with constraints enabled
    const computedRotations = resolveSimulatorRotationsFromKeypoints(
      Handedness.LEFT,
      joints,
      true
    );

    // PIP intermediate joint should be clamped to its minimum constraint (0 degrees)
    const computedPipRot =
      computedRotations['index-finger-phalanx-intermediate']!;
    expect(computedPipRot[0]).toBeCloseTo(0, 1e-4);
  });
});
