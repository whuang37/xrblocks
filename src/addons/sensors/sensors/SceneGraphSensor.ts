import * as THREE from 'three';
import {
  Sensor,
  type SerializableSceneNode,
  type SensorContext,
  type SensorsOptions,
} from '../SensorsTypes';
import {isInternalHelper} from '../utils/SensorsUtils';

export class SceneGraphSensor extends Sensor<SerializableSceneNode[]> {
  readonly key = 'sceneGraph';

  constructor(options?: SensorsOptions) {
    super(options);
  }

  update(context: SensorContext): SerializableSceneNode[] {
    const {core} = context;
    const scene = core.scene;
    if (!scene) return [];

    const nodes: SerializableSceneNode[] = [];

    const getValidChildren = (object: THREE.Object3D): number[] => {
      const validIds: number[] = [];
      const visit = (node: THREE.Object3D) => {
        for (const child of node.children) {
          if (isInternalHelper(child)) continue;
          if (
            child instanceof THREE.Mesh ||
            (child as {isXRScript?: boolean}).isXRScript
          ) {
            validIds.push(child.id);
          } else {
            visit(child);
          }
        }
      };
      visit(object);
      return validIds;
    };

    const box = new THREE.Box3();
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();

    scene.traverse((obj) => {
      if (isInternalHelper(obj) || obj === scene) return;

      const isValid =
        obj instanceof THREE.Mesh || (obj as {isXRScript?: boolean}).isXRScript;
      if (!isValid) return;

      obj.updateMatrixWorld(true);
      obj.getWorldPosition(worldPos);
      obj.getWorldQuaternion(worldQuat);
      obj.getWorldScale(worldScale);

      box.setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);

      nodes.push({
        id: obj.id,
        name: obj.name || `${obj.type}_${obj.id}`,
        type: obj.type,
        position: worldPos.toArray() as [number, number, number],
        quaternion: worldQuat.toArray() as [number, number, number, number],
        scale: worldScale.toArray() as [number, number, number],
        boundingBox: {
          min: box.min.toArray() as [number, number, number],
          max: box.max.toArray() as [number, number, number],
          size: size.toArray() as [number, number, number],
        },
        userData: {...obj.userData},
        children: getValidChildren(obj),
      });
    });

    return nodes;
  }
}
