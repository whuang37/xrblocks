import * as THREE from 'three';
import {
  Sensor,
  type TargetingMetrics,
  type SensorContext,
  type SensorsOptions,
} from '../SensorsTypes';
import {isInternalHelper} from '../utils/SensorsUtils';

const HAND_COLLISION_OFFSET = 0.12; // 12cm forward from wrist to middle-finger MCP knuckle
const HAND_COLLISION_RADIUS = 0.08; // 8cm bounding radius around the knuckle

export interface TargetingSnapshot {
  leftHand?: TargetingMetrics;
  rightHand?: TargetingMetrics;
  gaze?: TargetingMetrics;
}

export class TargetingSensor extends Sensor<TargetingSnapshot> {
  readonly key = 'targeting';

  constructor(options?: SensorsOptions) {
    super(options);
  }

  update(context: SensorContext): TargetingSnapshot {
    const {input} = context;

    const getTargetingForController = (
      controller: THREE.Object3D
    ): TargetingMetrics => {
      const origin = new THREE.Vector3();
      const direction = new THREE.Vector3();
      const matrix = new THREE.Matrix4();

      controller.getWorldPosition(origin);
      matrix.identity().extractRotation(controller.matrixWorld);
      direction.set(0, 0, -1).applyMatrix4(matrix).normalize();

      const intersections =
        input.intersectionsForController.get(controller) || [];
      const firstHit = intersections.find((i) => !isInternalHelper(i.object));

      // Calculate colliding object (what object the hand/pointer is within/overlapping)
      let collidingObjectId: number | null = null;
      if (context.core.scene) {
        // Find the center of the hand (offset forward from the wrist pivot along the pointer direction, centering around the middle-finger MCP knuckle)
        const handCenter = origin
          .clone()
          .addScaledVector(direction, HAND_COLLISION_OFFSET);
        // Create a bounding sphere representing the physical volume of the hand around the MCP knuckle
        const handSphere = new THREE.Sphere(handCenter, HAND_COLLISION_RADIUS);

        let minVolume = Infinity;
        const box = new THREE.Box3();
        const size = new THREE.Vector3();

        context.core.scene.traverse((obj) => {
          if (isInternalHelper(obj) || obj === context.core.scene) return;
          if (!(obj instanceof THREE.Mesh)) return;
          if (!obj.visible) return;

          box.setFromObject(obj);
          if (box.intersectsSphere(handSphere)) {
            box.getSize(size);
            const volume = size.x * size.y * size.z;
            if (volume < minVolume) {
              minVolume = volume;
              collidingObjectId = obj.id;
            }
          }
        });
      }

      return {
        hoveredObjectId: firstHit ? firstHit.object.id : null,
        distanceToHoveredObject: firstHit ? firstHit.distance : null,
        pointerOrigin: origin.toArray() as [number, number, number],
        pointerDirection: direction.toArray() as [number, number, number],
        isSelecting: !!controller?.userData.selected,
        intersectionPoint: firstHit
          ? (firstHit.point.toArray() as [number, number, number])
          : null,
        surfaceNormal: firstHit
          ? (firstHit.face?.normal
              .clone()
              .applyQuaternion(firstHit.object.quaternion)
              .toArray() as [number, number, number])
          : null,
        collidingObjectId,
      };
    };

    return {
      leftHand: input.leftController
        ? getTargetingForController(input.leftController)
        : undefined,
      rightHand: input.rightController
        ? getTargetingForController(input.rightController)
        : undefined,
      gaze: getTargetingForController(input.gazeController),
    };
  }
}
