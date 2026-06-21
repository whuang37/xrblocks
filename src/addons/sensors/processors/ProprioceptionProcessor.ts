import * as THREE from 'three';
import { Core, Input, HAND_JOINT_NAMES } from 'xrblocks';
import { type HandObservation, type Vec3Tuple } from '../SensorsTypes';

export function captureProprioception(
  core: Core,
  camera: THREE.Camera,
  input: Input
) {
  const createHandObs = (handIndex: number): HandObservation => {
    const controller = input.controllers[handIndex];
    const userHand = core.user?.hands?.hands?.[handIndex];
    
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    let visible = false;
    let selected = false;
    let squeezing = false;

    if (controller) {
      controller.getWorldPosition(pos);
      controller.getWorldQuaternion(quat);
      visible = controller.visible;
      selected = !!controller.userData.selected;
      squeezing = !!controller.userData.squeezing;
    }

    const jointKeypoints: Record<string, Vec3Tuple> = {};
    if (userHand && userHand.joints) {
      const jointPos = new THREE.Vector3();
      for (const jointName of HAND_JOINT_NAMES) {
        const jointObj = userHand.joints[jointName as keyof typeof userHand.joints];
        if (jointObj) {
          jointObj.getWorldPosition(jointPos);
          jointKeypoints[jointName] = jointPos.toArray() as [number, number, number];
        }
      }
    }

    return {
      position: pos.toArray() as [number, number, number],
      quaternion: quat.toArray() as [number, number, number, number],
      selected,
      squeezing,
      visible,
      jointKeypoints,
    };
  };

  const torsoPos = new THREE.Vector3();
  camera.getWorldPosition(torsoPos);
  torsoPos.y = 0;

  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  euler.x = 0;
  euler.z = 0;
  const torsoQuat = new THREE.Quaternion().setFromEuler(euler);

  return {
    camera: {
      position: camera.position.toArray() as [number, number, number],
      quaternion: camera.quaternion.toArray() as [number, number, number, number],
    },
    leftHand: createHandObs(0),
    rightHand: createHandObs(1),
    torso: {
      position: torsoPos.toArray() as [number, number, number],
      quaternion: torsoQuat.toArray() as [number, number, number, number],
    },
  };
}
