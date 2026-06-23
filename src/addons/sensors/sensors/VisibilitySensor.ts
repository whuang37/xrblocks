import * as THREE from 'three';
import {objectIsDescendantOf} from 'xrblocks';
import {Sensor, type SensorContext, type SensorsOptions} from '../SensorsTypes';
import {
  isInternalHelper,
  getUIBoundingBox,
  getUIInteractables,
  isUICard,
} from '../utils/SensorsUtils';

const MARGIN = 0.85; // 15% margin for clean UX

export interface VisibilityItem {
  object: THREE.Object3D;
  worldPosition: THREE.Vector3;
  distance: number;
}

export class VisibilitySensor extends Sensor<VisibilityItem[]> {
  readonly key = 'visibility';

  constructor(options?: SensorsOptions) {
    super(options);
  }

  /**
   * Evaluates the visibility of a root UICard. If it has direct line of sight,
   * gathers and adds all active, visible, and interactable UI elements (including the card itself)
   * using the getUIInteractables utility.
   */
  private processUICard(
    card: THREE.Object3D,
    camera: THREE.Camera,
    frustum: THREE.Frustum,
    verify: boolean,
    scene: THREE.Scene,
    addedUIObjects: Set<THREE.Object3D>,
    visibleItems: VisibilityItem[]
  ) {
    if (!card.visible) return;

    const cardBox = new THREE.Box3();

    // 1. Evaluate visibility of the card container itself first
    let isCardVisible = false;
    if (getUIBoundingBox(card, cardBox) && frustum.intersectsBox(cardBox)) {
      const boxCenter = cardBox.getCenter(new THREE.Vector3());
      const screenPos = boxCenter
        .clone()
        .applyMatrix4(camera.matrixWorldInverse)
        .applyMatrix4(camera.projectionMatrix);

      const isOffScreen =
        Math.abs(screenPos.x) > MARGIN ||
        Math.abs(screenPos.y) > MARGIN ||
        screenPos.z < -1 ||
        screenPos.z > 1;

      if (!isOffScreen) {
        if (verify) {
          const raycaster = new THREE.Raycaster();
          raycaster.set(
            camera.position,
            boxCenter.clone().sub(camera.position).normalize()
          );
          const intersections = raycaster.intersectObjects(
            scene.children,
            true
          );
          const firstHit = intersections.find(
            (i) => !isInternalHelper(i.object)
          );
          if (
            !firstHit ||
            firstHit.object === card ||
            objectIsDescendantOf(firstHit.object, card)
          ) {
            isCardVisible = true;
          }
        } else {
          isCardVisible = true;
        }
      }
    }

    // 2. If the card itself is visible, gather and add all of its interactables
    if (isCardVisible) {
      const interactables = getUIInteractables(card);
      for (const item of interactables) {
        if (!addedUIObjects.has(item)) {
          const itemBox = new THREE.Box3();
          if (getUIBoundingBox(item, itemBox)) {
            addedUIObjects.add(item);
            const itemPos = new THREE.Vector3();
            const itemCenter = itemBox.getCenter(new THREE.Vector3());
            item.getWorldPosition(itemPos);
            visibleItems.push({
              object: item,
              worldPosition: itemCenter,
              distance: camera.position.distanceTo(itemPos),
            });
          }
        }
      }
    }
  }

  async update(context: SensorContext): Promise<VisibilityItem[]> {
    const {core} = context;
    const camera = core.camera;
    const scene = core.scene;

    if (!camera || !scene) {
      return [];
    }

    const frustum = new THREE.Frustum();
    const cameraViewProjectionMatrix = new THREE.Matrix4();
    cameraViewProjectionMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(cameraViewProjectionMatrix);

    const verify =
      (this.options as {verifyLineOfSight?: boolean})?.verifyLineOfSight !==
      false;

    const visibleItems: VisibilityItem[] = [];
    const addedUIObjects = new Set<THREE.Object3D>();

    try {
      scene.traverse((obj) => {
        // A. Avoid duplicate processing: skip descendants of cards we handle hierarchically
        let currentParent = obj.parent;
        while (currentParent) {
          if (isUICard(currentParent)) {
            return;
          }
          currentParent = currentParent.parent;
        }

        // B. Process UI Cards hierarchically
        if (isUICard(obj)) {
          this.processUICard(
            obj,
            camera,
            frustum,
            verify,
            scene,
            addedUIObjects,
            visibleItems
          );
          return;
        }

        // C. Process non-UI general meshes
        let isValid = false;
        if (obj instanceof THREE.Mesh && !isInternalHelper(obj)) {
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

        if (!isValid || !obj.visible || addedUIObjects.has(obj)) return;

        const box = new THREE.Box3();
        try {
          box.setFromObject(obj);
        } catch (_err) {
          return;
        }

        if (frustum.intersectsBox(box)) {
          const objPos = new THREE.Vector3();
          const boxCenter = box.getCenter(new THREE.Vector3());
          const screenPos = boxCenter
            .clone()
            .applyMatrix4(camera.matrixWorldInverse)
            .applyMatrix4(camera.projectionMatrix);

          const isOffScreen =
            Math.abs(screenPos.x) > MARGIN ||
            Math.abs(screenPos.y) > MARGIN ||
            screenPos.z < -1 ||
            screenPos.z > 1;

          if (isOffScreen) return;

          if (verify) {
            const raycaster = new THREE.Raycaster();
            raycaster.set(
              camera.position,
              boxCenter.clone().sub(camera.position).normalize()
            );
            const intersections = raycaster.intersectObjects(
              scene.children,
              true
            );

            const firstHit = intersections.find(
              (i) => !isInternalHelper(i.object)
            );
            if (
              firstHit &&
              firstHit.object !== obj &&
              !objectIsDescendantOf(firstHit.object, obj)
            ) {
              return;
            }
          }

          addedUIObjects.add(obj);
          obj.getWorldPosition(objPos);
          visibleItems.push({
            object: obj,
            worldPosition: boxCenter,
            distance: camera.position.distanceTo(objPos),
          });
        }
      });
    } catch (err) {
      console.error('Sensor Debugger Capture Error (Visibility):', err);
    }

    return visibleItems;
  }
}
