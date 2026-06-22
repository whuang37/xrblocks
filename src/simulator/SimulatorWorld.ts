import * as THREE from 'three';
import {Options} from '../core/Options';
import {SimulatorMesh} from '../world/mesh/SimulatorMesh';
import {
  SimulatorPlane,
  SimulatorPlaneType,
} from '../world/planes/SimulatorPlane';
import {World} from '../world/World';

import {SimulatorScene} from './SimulatorScene';

// World sensing for the simulator.
// Injects planes and meshes extracted from the simulated environment.
export class SimulatorWorld {
  private options!: Options;
  private world!: World;

  async init(options: Options, world: World, simulatorScene?: SimulatorScene) {
    this.options = options;
    this.world = world;
    // Wait for World script initialization to complete first
    await world.initializedPromise;
    const activeEnv =
      options.simulator.environments[options.simulator.activeEnvironmentIndex];
    if (options.world.planes.enabled && activeEnv?.scenePlanesPath) {
      await this.loadPlanes(activeEnv.scenePlanesPath);
    }
    // Unlike planes (loaded from a prebuilt JSON), the scene mesh is extracted
    // from the ground-truth geometry of the loaded environment GLTF.
    if (options.world.meshes.enabled && simulatorScene?.gltf?.scene) {
      this.loadMeshesFromScene(simulatorScene.gltf.scene);
    }
  }

  /**
   * Bakes every sub-mesh of the environment into world-space
   * {@link SimulatorMesh} objects and injects them into the MeshDetector.
   */
  private loadMeshesFromScene(root: THREE.Object3D) {
    if (!this.world.meshes) return;
    root.updateMatrixWorld(true);

    const simMeshes: SimulatorMesh[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;

      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      const positionAttribute = geometry.attributes.position;
      if (!positionAttribute) {
        geometry.dispose();
        return;
      }

      const vertices = new Float32Array(
        positionAttribute.array as ArrayLike<number>
      );
      let indices: Uint32Array;
      if (geometry.index) {
        indices = new Uint32Array(geometry.index.array as ArrayLike<number>);
      } else {
        indices = new Uint32Array(positionAttribute.count);
        for (let i = 0; i < indices.length; i++) {
          indices[i] = i;
        }
      }
      simMeshes.push({vertices, indices, lastChangedTime: 0});
      geometry.dispose();
    });

    if (simMeshes.length > 0) {
      this.world.meshes.setSimulatorMeshes(simMeshes);
    }
  }

  private async loadPlanes(path: string) {
    const offsetPosition = new THREE.Vector3().copy(
      this.options.simulator.initialScenePosition
    );
    try {
      const planesData = (await fetch(path).then((response) =>
        response.json()
      )) as {
        planes: {
          type: SimulatorPlaneType;
          label?: string;
          area: number;
          position: {
            x: number;
            y: number;
            z: number;
          };
          quaternion: number[];
          polygon: {
            x: number;
            y: number;
          }[];
        }[];
      };
      const planes: SimulatorPlane[] = planesData.planes.map((plane) => {
        return {
          type: plane.type,
          area: plane.area,
          position: new THREE.Vector3(
            plane.position.x,
            plane.position.y,
            plane.position.z
          ).add(offsetPosition),
          quaternion: new THREE.Quaternion(
            plane.quaternion[0],
            plane.quaternion[1],
            plane.quaternion[2],
            plane.quaternion[3]
          ),
          polygon: plane.polygon.map((p) => new THREE.Vector2(p.x, p.y)),
          label: plane.label,
        };
      });
      this.world.planes!.setSimulatorPlanes(planes);
    } catch (error) {
      console.error('Failed to load planes:', error);
    }
  }
}
