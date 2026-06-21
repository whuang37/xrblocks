import * as THREE from 'three';
import { type VisibleObjectReference } from '../SensorsTypes';

export function generateSemanticMap(
  visibleObjects: Array<{object: THREE.Object3D; worldPosition: THREE.Vector3; distance: number}>
): VisibleObjectReference[] {
  const refs: VisibleObjectReference[] = [];
  let labelCounter = 1;

  for (const {object, distance} of visibleObjects) {
    const label = labelCounter.toString();
    const textLabel = (object as {text?: string}).text || object.name || object.type;
    const description = `[${label}]: ${object.type} '${textLabel}' ${distance.toFixed(2)}m away`;

    refs.push({
      label,
      objectId: object.id,
      name: object.name || `${object.type}_${object.id}`,
      type: object.type,
      distanceToCamera: distance,
      description,
    });

    labelCounter++;
  }

  return refs;
}
