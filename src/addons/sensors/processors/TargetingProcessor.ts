import * as THREE from 'three';
import { Input } from 'xrblocks';
import { type TargetingMetrics } from '../SensorsTypes';
import { isInternalHelper } from '../utils/SensorsUtils';

export function captureTargeting(input: Input): {
  leftHand?: TargetingMetrics;
  rightHand?: TargetingMetrics;
  gaze?: TargetingMetrics;
} {
  const getTargetingForController = (controller: THREE.Object3D): TargetingMetrics => {
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const matrix = new THREE.Matrix4();

    controller.getWorldPosition(origin);
    matrix.identity().extractRotation(controller.matrixWorld);
    direction.set(0, 0, -1).applyMatrix4(matrix).normalize();

    const intersections = input.intersectionsForController.get(controller) || [];
    const firstHit = intersections.find((i) => !isInternalHelper(i.object));

    return {
      hoveredObjectId: firstHit ? firstHit.object.id : null,
      distanceToHoveredObject: firstHit ? firstHit.distance : null,
      pointerOrigin: origin.toArray() as [number, number, number],
      pointerDirection: direction.toArray() as [number, number, number],
      isSelecting: !!controller?.userData.selected,
      intersectionPoint: firstHit ? firstHit.point.toArray() as [number, number, number] : null,
      surfaceNormal: firstHit ? firstHit.face?.normal.clone().applyQuaternion(firstHit.object.quaternion).toArray() as [number, number, number] : null,
    };
  };

  return {
    leftHand: input.leftController ? getTargetingForController(input.leftController) : undefined,
    rightHand: input.rightController ? getTargetingForController(input.rightController) : undefined,
    gaze: getTargetingForController(input.gazeController),
  };
}
