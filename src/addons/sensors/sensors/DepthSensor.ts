import * as THREE from 'three';
import {Sensor, type SensorContext, type SensorsOptions} from '../SensorsTypes';
import {isInternalHelper} from '../utils/SensorsUtils';

export class DepthSensor extends Sensor<number[][]> {
  readonly key = 'depth';

  constructor(options: SensorsOptions & {gridSize?: number} = {}) {
    super(options);
  }

  update(context: SensorContext): number[][] {
    const {core, camera} = context;
    const depthSubsystem = core.depth;
    const gridSize = (this.options as {gridSize?: number})?.gridSize ?? 16;

    // 1. Hardware-level depth sensing
    if (
      depthSubsystem &&
      depthSubsystem.enabled &&
      depthSubsystem.rawValueToMeters > 0 &&
      depthSubsystem.depthArray[0]
    ) {
      const width = depthSubsystem.width;
      const height = depthSubsystem.height;
      const rawArray = depthSubsystem.depthArray[0];
      const scale = depthSubsystem.rawValueToMeters;
      const depthGrid: number[][] = [];

      for (let y = 0; y < height; y++) {
        const row: number[] = [];
        for (let x = 0; x < width; x++) {
          row.push(rawArray[y * width + x] * scale);
        }
        depthGrid.push(row);
      }
      return depthGrid;
    }

    // 2. CPU-based scene graph raycasting fallback
    const scene = core.scene;
    const depthGrid: number[][] = [];
    if (!scene || !camera) return depthGrid;

    const raycaster = new THREE.Raycaster();
    const coords = new THREE.Vector2();

    for (let y = 0; y < gridSize; y++) {
      const row: number[] = [];
      const ndcY = 1 - (y / (gridSize - 1)) * 2;
      for (let x = 0; x < gridSize; x++) {
        const ndcX = -1 + (x / (gridSize - 1)) * 2;
        coords.set(ndcX, ndcY);
        raycaster.setFromCamera(coords, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        const firstHit = intersects.find((i) => !isInternalHelper(i.object));
        row.push(
          firstHit
            ? firstHit.distance
            : (camera as THREE.PerspectiveCamera).far || 2000
        );
      }
      depthGrid.push(row);
    }
    return depthGrid;
  }
}
