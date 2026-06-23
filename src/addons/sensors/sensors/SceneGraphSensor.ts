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

    const hasRenderableMesh = (object: THREE.Object3D): boolean => {
      let hasMesh = false;
      object.traverse((child) => {
        if (child instanceof THREE.Mesh && !isInternalHelper(child)) {
          hasMesh = true;
        }
      });
      return hasMesh;
    };

    const hasChildView = (object: THREE.Object3D): boolean =>
      object.children.some((child) => (child as {isView?: boolean}).isView);

    const isSceneGraphContainer = (object: THREE.Object3D): boolean =>
      !!(object as {isView?: boolean}).isView && hasChildView(object);

    const isSceneGraphNode = (object: THREE.Object3D): boolean => {
      if (object instanceof THREE.Mesh) return true;

      if ((object as {isXRScript?: boolean}).isXRScript) {
        if ((object as {isView?: boolean}).isView) {
          return hasRenderableMesh(object) || hasChildView(object);
        }

        const isGenericContainer =
          object.type === 'Object3D' || object.type === 'Group';
        return !isGenericContainer && hasRenderableMesh(object);
      }

      return false;
    };

    const selectedObjects: THREE.Object3D[] = [];
    const selectedObjectSet = new Set<THREE.Object3D>();

    scene.traverse((obj) => {
      if (isInternalHelper(obj) || obj === scene || !obj.visible) return;

      let selectedAncestor: THREE.Object3D | null = null;
      let parent = obj.parent;
      while (parent) {
        if (selectedObjectSet.has(parent)) {
          selectedAncestor = parent;
          break;
        }
        parent = parent.parent;
      }

      if (selectedAncestor) {
        if (obj instanceof THREE.Mesh) return;
        if (!isSceneGraphContainer(selectedAncestor)) return;
      }

      if (!isSceneGraphNode(obj)) return;

      selectedObjects.push(obj);
      selectedObjectSet.add(obj);
    });

    const getSelectedChildren = (object: THREE.Object3D): number[] => {
      const childIds: number[] = [];

      for (const candidate of selectedObjects) {
        if (candidate === object) continue;

        let parent = candidate.parent;
        while (parent) {
          if (selectedObjectSet.has(parent)) {
            if (parent === object) childIds.push(candidate.id);
            break;
          }
          parent = parent.parent;
        }
      }

      return childIds;
    };

    const box = new THREE.Box3();
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();

    for (const obj of selectedObjects) {
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
        children: getSelectedChildren(obj),
      });
    }

    return nodes;
  }
}
