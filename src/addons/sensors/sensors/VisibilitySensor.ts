import * as THREE from 'three';
import {objectIsDescendantOf} from 'xrblocks';
import {Sensor, type SensorContext, type SensorsOptions} from '../SensorsTypes';
import {isInternalHelper} from '../utils/SensorsUtils';

export interface VisibilityItem {
  object: THREE.Object3D;
  worldPosition: THREE.Vector3;
  distance: number;
}

export class VisibilitySensor extends Sensor<VisibilityItem[]> {
  readonly key = 'rawVisibleObjects';

  constructor(options: SensorsOptions & {verifyLineOfSight?: boolean} = {}) {
    super(options);
  }

  update(context: SensorContext): VisibilityItem[] {
    const {core, camera} = context;
    const verify =
      (this.options as {verifyLineOfSight?: boolean})?.verifyLineOfSight ??
      true;
    const scene = core.scene;
    const list: VisibilityItem[] = [];
    if (!scene || !camera) return list;

    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(projScreenMatrix);

    const box = new THREE.Box3();
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);

    const interactiveObjects = new Set<THREE.Object3D>();

    scene.traverse((obj) => {
      if (isInternalHelper(obj) || obj === scene) return;

      let parent = obj.parent;
      while (parent) {
        if (interactiveObjects.has(parent)) {
          return;
        }
        parent = parent.parent;
      }

      let isValid = false;
      if (obj instanceof THREE.Mesh) {
        isValid = true;
      } else if ((obj as {isXRScript?: boolean}).isXRScript) {
        const customType = obj.type;
        const isGenericContainer =
          customType === 'Object3D' || customType === 'Group';
        if (!isGenericContainer) {
          let hasMesh = false;
          obj.traverse((child) => {
            if (child instanceof THREE.Mesh && !isInternalHelper(child)) {
              hasMesh = true;
            }
          });
          isValid = hasMesh;
        }
      }

      if (!isValid || !obj.visible) return;

      box.setFromObject(obj);
      if (frustum.intersectsBox(box)) {
        const objPos = new THREE.Vector3();
        const boxCenter = box.getCenter(new THREE.Vector3());

        // Project the geometric center of the box to screen space (-1 to 1)
        const screenPos = boxCenter
          .clone()
          .applyMatrix4(camera.matrixWorldInverse)
          .applyMatrix4(camera.projectionMatrix);

        // Check if the center is off-screen or too close to the edges
        const margin = 0.85; // 15% margin for clean UX
        const isOffScreen =
          Math.abs(screenPos.x) > margin ||
          Math.abs(screenPos.y) > margin ||
          screenPos.z > 1 ||
          screenPos.z < -1;

        if (isOffScreen) {
          // Clamp to safe screen coordinates
          const clampedX = Math.max(-margin, Math.min(margin, screenPos.x));
          const clampedY = Math.max(-margin, Math.min(margin, screenPos.y));

          // Unproject the safe screen point back to world space rays
          const rayOrigin = new THREE.Vector3(clampedX, clampedY, -1).unproject(
            camera
          );
          const rayTarget = new THREE.Vector3(clampedX, clampedY, 1).unproject(
            camera
          );
          const direction = new THREE.Vector3()
            .subVectors(rayTarget, rayOrigin)
            .normalize();

          const ray = new THREE.Ray(rayOrigin, direction);
          const intersectionPoint = new THREE.Vector3();

          if (ray.intersectBox(box, intersectionPoint)) {
            objPos.copy(intersectionPoint);
          } else {
            // Fallback to clamping the center point to the box boundaries
            box.clampPoint(boxCenter, objPos);
          }
        } else {
          // Center is in-bounds and on-screen, use it!
          objPos.copy(boxCenter);
        }

        const distance = camPos.distanceTo(objPos);

        if (verify) {
          const direction = new THREE.Vector3()
            .subVectors(objPos, camPos)
            .normalize();
          const raycaster = new THREE.Raycaster(camPos, direction);
          const intersects = raycaster.intersectObjects(scene.children, true);
          const firstHit = intersects.find((i) => !isInternalHelper(i.object));

          if (
            firstHit &&
            (firstHit.object === obj ||
              objectIsDescendantOf(firstHit.object, obj) ||
              firstHit.distance >= distance - 0.05)
          ) {
            interactiveObjects.add(obj);
            list.push({
              object: obj,
              worldPosition: objPos,
              distance,
            });
          }
        } else {
          // Add directly without raycast checking if line-of-sight verification is disabled
          interactiveObjects.add(obj);
          list.push({
            object: obj,
            worldPosition: objPos,
            distance,
          });
        }
      }
    });

    return list;
  }
}
