import * as THREE from 'three';
import {objectIsDescendantOf} from 'xrblocks';
import {
  getUIBoundingBox,
  getUIInteractables,
  isInternalHelper,
  isObjectVisible,
  isUICard,
  isUIInteractable,
} from './SensorsUtils';

const VIEWPORT_MARGIN = 0.85;

export interface VisualObjectReference {
  label: string;
  objectId: number;
  object: THREE.Object3D;
  name: string;
  type: string;
  worldPosition: THREE.Vector3;
  screenPosition: THREE.Vector2;
  distance: number;
  distanceToCamera: number;
  description: string;
  boundingBox?: THREE.Box3;
}

export function resolveSensorObject(object: THREE.Object3D): THREE.Object3D {
  let current: THREE.Object3D | null = object;
  let lastUI: THREE.Object3D | null = null;

  while (current) {
    if ((current as {isUI?: boolean}).isUI === true) {
      lastUI = current;
      if (isUIInteractable(current) || isUICard(current)) {
        return current;
      }
    }
    current = current.parent;
  }

  return lastUI ?? object;
}

export function getSensorObjectBox(
  object: THREE.Object3D,
  targetBox = new THREE.Box3()
): THREE.Box3 | null {
  if ((object as {isUI?: boolean}).isUI === true) {
    return getUIBoundingBox(object, targetBox) ? targetBox : null;
  }

  try {
    targetBox.setFromObject(object);
    return targetBox.isEmpty() ? null : targetBox;
  } catch (_err) {
    return null;
  }
}

export function isSensorInternalObject(object: THREE.Object3D): boolean {
  return isInternalHelper(object);
}

export function createVisibleObjectReferences({
  scene,
  camera,
  verifyLineOfSight = true,
}: {
  scene: THREE.Scene;
  camera: THREE.Camera;
  verifyLineOfSight?: boolean;
}): VisualObjectReference[] {
  camera.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);

  const frustum = new THREE.Frustum();
  const cameraViewProjectionMatrix = new THREE.Matrix4();
  cameraViewProjectionMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  frustum.setFromProjectionMatrix(cameraViewProjectionMatrix);

  const visibleObjects: THREE.Object3D[] = [];
  const visibleObjectSet = new Set<THREE.Object3D>();

  const addIfVisible = (object: THREE.Object3D) => {
    const resolved = resolveSensorObject(object);
    if (
      resolved === scene ||
      visibleObjectSet.has(resolved) ||
      !isObjectVisible(resolved)
    ) {
      return;
    }

    const box = getSensorObjectBox(resolved);
    if (!box || !frustum.intersectsBox(box)) {
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const projected = center
      .clone()
      .applyMatrix4(camera.matrixWorldInverse)
      .applyMatrix4(camera.projectionMatrix);

    const isOffScreen =
      Math.abs(projected.x) > VIEWPORT_MARGIN ||
      Math.abs(projected.y) > VIEWPORT_MARGIN ||
      projected.z < -1 ||
      projected.z > 1;
    if (isOffScreen) {
      return;
    }

    if (verifyLineOfSight && !hasLineOfSight(scene, camera, resolved, center)) {
      return;
    }

    visibleObjectSet.add(resolved);
    visibleObjects.push(resolved);
  };

  scene.traverse((object) => {
    if (object === scene || isSensorInternalObject(object) || !object.visible) {
      return;
    }

    if (isUICard(object)) {
      addIfVisible(object);
      for (const interactable of getUIInteractables(object)) {
        addIfVisible(interactable);
      }
      return;
    }

    let parent = object.parent;
    while (parent) {
      if (isUICard(parent)) {
        return;
      }
      parent = parent.parent;
    }

    if (isRenderableSensorObject(object)) {
      addIfVisible(object);
    }
  });

  return visibleObjects.map((object, index) => {
    const box = getSensorObjectBox(object);
    const worldPosition =
      box?.getCenter(new THREE.Vector3()) ??
      object.getWorldPosition(new THREE.Vector3());
    const screenPosition = worldPosition
      .clone()
      .applyMatrix4(camera.matrixWorldInverse)
      .applyMatrix4(camera.projectionMatrix);
    const distance = camera
      .getWorldPosition(new THREE.Vector3())
      .distanceTo(worldPosition);
    const label = String(index + 1);
    const name = object.name || `${object.type}_${object.id}`;
    const textLabel = (object as {text?: string}).text || name;

    return {
      label,
      objectId: object.id,
      object,
      name,
      type: object.type,
      worldPosition,
      screenPosition: new THREE.Vector2(screenPosition.x, screenPosition.y),
      distance,
      distanceToCamera: distance,
      description: `[${label}]: ${object.type} '${textLabel}' ${distance.toFixed(
        2
      )}m away`,
      boundingBox: box?.clone(),
    };
  });
}

function isRenderableSensorObject(object: THREE.Object3D): boolean {
  if (object instanceof THREE.Mesh) {
    return true;
  }

  if ((object as {isXRScript?: boolean}).isXRScript) {
    const isGenericContainer =
      object.type === 'Object3D' || object.type === 'Group';
    if (isGenericContainer) {
      return false;
    }

    let hasMesh = false;
    object.traverse((child) => {
      if (child instanceof THREE.Mesh && !isSensorInternalObject(child)) {
        hasMesh = true;
      }
    });
    return hasMesh;
  }

  return false;
}

function hasLineOfSight(
  scene: THREE.Scene,
  camera: THREE.Camera,
  object: THREE.Object3D,
  worldPosition: THREE.Vector3
): boolean {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const raycaster = new THREE.Raycaster(
    origin,
    worldPosition.clone().sub(origin).normalize()
  );
  const intersections = raycaster.intersectObjects(scene.children, true);
  const firstHit = intersections.find(
    (intersection) => !isSensorInternalObject(intersection.object)
  );

  if (!firstHit) {
    return true;
  }

  const hitObject = resolveSensorObject(firstHit.object);
  return hitObject === object || objectIsDescendantOf(hitObject, object);
}
