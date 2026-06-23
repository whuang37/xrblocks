import * as THREE from 'three';

/**
 * Mathematically computes the physical world bounding box of a high-level UI Blocks component
 * based on its layout dimensions, pixelSize, and world matrix, avoiding child mesh traversal.
 */
export function getUIBoundingBox(
  obj: THREE.Object3D,
  targetBox: THREE.Box3
): boolean {
  const ui = obj as {
    isUI?: boolean;
    width?: number | string;
    height?: number | string;
    cardPixelSize?: number;
    parent?: THREE.Object3D;
  };

  if (ui.isUI !== true) return false;

  // Traverse up to find the parent UICard containing the pixelSize scale
  let current: THREE.Object3D | null = obj;
  let pixelSize = 0.002; // Standard fallback
  while (current) {
    if ('cardPixelSize' in current) {
      pixelSize = (current as {cardPixelSize: number}).cardPixelSize;
      break;
    }
    current = current.parent;
  }

  // Retrieve layout dimensions in pixels (default to card boundaries or 100px)
  let w = typeof ui.width === 'number' ? ui.width : 100;
  let h = typeof ui.height === 'number' ? ui.height : 100;

  // UICard defines absolute dimensions sizeX and sizeY directly
  const card = obj as {sizeX?: number; sizeY?: number};
  if (card.sizeX !== undefined && card.sizeY !== undefined) {
    w = card.sizeX / pixelSize;
    h = card.sizeY / pixelSize;
  }

  const halfW = (w * pixelSize) / 2;
  const halfH = (h * pixelSize) / 2;

  // Construct local thin box aligned to the panel pivot
  targetBox.min.set(-halfW, -halfH, -0.001);
  targetBox.max.set(halfW, halfH, 0.001);

  // Project local box to world coordinates using the object's matrix
  targetBox.applyMatrix4(obj.matrixWorld);
  return true;
}

/**
 * Determines if a 3D object represents a root UICard container.
 */
export function isUICard(obj: THREE.Object3D): boolean {
  return (
    obj.name === 'SensorsDebuggerCard' ||
    obj.constructor.name === 'UICard' ||
    (obj as {isUICard?: boolean}).isUICard === true
  );
}

/**
 * Determines if a high-level UI component is interactable (e.g. is a grabbable card,
 * or has click/hover listeners).
 */
export function isUIInteractable(object: THREE.Object3D): boolean {
  if ((object as {isUI?: boolean}).isUI !== true) return false;
  const uiObj = object as {
    name?: string;
    onClick?: unknown;
    _onHoverEnter?: unknown; // Check the private backing field instead of the prototype method!
    behaviors?: unknown[];
  };
  const isCard =
    uiObj.name === 'SensorsDebuggerCard' ||
    object.constructor.name === 'UICard';
  const hasClick = typeof uiObj.onClick === 'function';
  const hasHover = typeof uiObj._onHoverEnter === 'function';
  const hasBehaviors =
    Array.isArray(uiObj.behaviors) && uiObj.behaviors.length > 0;

  return isCard || hasClick || hasHover || hasBehaviors;
}

/**
 * Determines if a 3D object and all of its parent ancestors are visible.
 */
export function isObjectVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

/**
 * Traverses the subtree of a UICard and retrieves all active, visible,
 * and interactable UI components (buttons, cards, etc., including the card itself).
 */
export function getUIInteractables(card: THREE.Object3D): THREE.Object3D[] {
  const interactables: THREE.Object3D[] = [];
  card.traverse((child) => {
    if (isUIInteractable(child) && isObjectVisible(child)) {
      interactables.push(child);
    }
  });
  return interactables;
}

/**
 * Consolidated filter to determine if a node or any of its ancestors
 * is an internal framework helper (Simulator rig, grids, reticles, lines, etc.).
 */
export function isInternalHelper(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;

  // High-level UI components themselves are not internal helpers
  if ((object as {isUI?: boolean}).isUI === true) {
    return false;
  }

  while (current) {
    if (
      current.type === 'XRSystems' ||
      (current.constructor as {isDepthMesh?: boolean}).isDepthMesh === true ||
      current.type === 'Line' ||
      (current as {ignoreReticleRaycast?: boolean}).ignoreReticleRaycast ===
        true ||
      // If an ancestor is a UI component, this low-level child is an internal rendering mesh
      (current as {isUI?: boolean}).isUI === true
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}
