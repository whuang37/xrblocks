import * as THREE from 'three';
import {Core, Input, Script, HAND_JOINT_NAMES, objectIsDescendantOf} from 'xrblocks';
import {
  DEFAULT_SENSORS_OPTIONS,
  type SensorsOptions,
  type SensorsObservation,
  type HandObservation,
  type SensorsFrameRecord,
  type VisibleObjectReference,
  type TargetingMetrics,
  type Vec3Tuple,
  type SerializableSceneNode,
} from './SensorsTypes';

export class Sensors extends Script {
  static dependencies = {
    core: Core,
    input: Input,
    camera: THREE.Camera,
  };

  editorIcon = 'sensors';
  private defaultOptions: Required<SensorsOptions>;

  core!: Core;
  input!: Input;
  camera!: THREE.Camera;

  private isRecording = false;
  private frameHistory: SensorsFrameRecord[] = [];
  private recordingOptions: SensorsOptions = {};
  private lastFrameTime = 0; // Simulated frame time in seconds

  onFrameRecord: ((record: SensorsFrameRecord) => void) | null = null;

  constructor(options: SensorsOptions = {}) {
    super();
    this.defaultOptions = {
      ...DEFAULT_SENSORS_OPTIONS,
      ...options,
    };
  }

  override init(dependencies: {
    core: Core;
    input: Input;
    camera: THREE.Camera;
  }) {
    this.core = dependencies.core;
    this.input = dependencies.input;
    this.camera = dependencies.camera;
  }

  startRecording(options: SensorsOptions = {}) {
    this.frameHistory = [];
    this.recordingOptions = {
      ...this.defaultOptions,
      ...options,
    };
    this.isRecording = true;
  }

  stopRecording(): SensorsFrameRecord[] {
    this.isRecording = false;
    const history = this.frameHistory;
    this.frameHistory = [];
    return history;
  }

  clearRecording() {
    this.frameHistory = [];
  }

  override update(time?: number) {
    if (time !== undefined) {
      // Store simulated frame time in seconds (time is in ms)
      this.lastFrameTime = time / 1000;
    }

    if (!this.isRecording) return;
    
    const record = this.captureFrameRecord(this.recordingOptions);
    
    if (this.onFrameRecord) {
      this.onFrameRecord(record);
    }

    if (this.recordingOptions.recordHistory) {
      this.frameHistory.push(record);
    }
  }

  private captureFrameRecord(options: SensorsOptions): SensorsFrameRecord {
    const record: SensorsFrameRecord = {
      timestamp: this.lastFrameTime,
    };

    if (options.includeUserTransforms) {
      record.state = this.captureProprioception();
    }

    if (options.includeSceneGraph) {
      record.sceneGraph = this.captureSceneGraph();
    }

    if (options.includeTargeting) {
      record.targeting = this.captureTargeting(this.input);
    }

    return record;
  }

  /**
   * Consolidated filter to determine if a node or any of its ancestors
   * is an internal framework helper (Simulator rig, grids, reticles, lines, etc.).
   */
  private isInternalHelper(object: THREE.Object3D): boolean {
    const scene = this.core.scene;
    let current: THREE.Object3D | null = object;

    while (current) {
      if (current === scene) return false;
      const name = current.name || '';
      if (
        name.includes('Simulator') ||
        name.includes('Helper') ||
        name.includes('Reticle') ||
        name.includes('Controller') ||
        name.includes('Hand') ||
        name.includes('Pointer') ||
        name.includes('pointer') ||
        name.includes('joint') ||
        name.includes('Joint') ||
        name.includes('user') ||
        name.includes('User') ||
        name.includes('Floor') ||
        name.includes('floor') ||
        name.includes('Grid') ||
        name.includes('grid') ||
        name.includes('Environment') ||
        name.includes('environment') ||
        name.includes('pivot') ||
        current.type === 'Line' ||
        (current as {ignoreReticleRaycast?: boolean}).ignoreReticleRaycast === true
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  private captureProprioception() {
    const camera = this.camera;
    const input = this.input;

    const createHandObs = (handIndex: number): HandObservation => {
      const controller = input.controllers[handIndex];
      const userHand = this.core.user?.hands?.hands?.[handIndex];
      
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      let visible = false;
      let selected = false;
      let squeezing = false;

      // Extract real-time hand/controller transform in world space
      if (controller) {
        controller.getWorldPosition(pos);
        controller.getWorldQuaternion(quat);
        visible = controller.visible;
        selected = !!controller.userData.selected;
        squeezing = !!controller.userData.squeezing;
      }

      // Extract skeletal joint world positions [x, y, z] using core.user.hands
      const jointKeypoints: Record<string, Vec3Tuple> = {};
      if (userHand && userHand.joints) {
        const jointPos = new THREE.Vector3();
        for (const jointName of HAND_JOINT_NAMES) {
          const jointObj = userHand.joints[jointName as keyof typeof userHand.joints];
          if (jointObj) {
            jointObj.getWorldPosition(jointPos);
            jointKeypoints[jointName] = jointPos.toArray() as [number, number, number];
          }
        }
      }

      return {
        position: pos.toArray() as [number, number, number],
        quaternion: quat.toArray() as [number, number, number, number],
        selected,
        squeezing,
        visible,
        jointKeypoints,
      };
    };

    const torsoPos = new THREE.Vector3();
    camera.getWorldPosition(torsoPos);
    torsoPos.y = 0; // project to floor

    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    euler.x = 0;
    euler.z = 0;
    const torsoQuat = new THREE.Quaternion().setFromEuler(euler);

    return {
      camera: {
        position: camera.position.toArray() as [number, number, number],
        quaternion: camera.quaternion.toArray() as [number, number, number, number],
      },
      leftHand: createHandObs(0),
      rightHand: createHandObs(1),
      torso: {
        position: torsoPos.toArray() as [number, number, number],
        quaternion: torsoQuat.toArray() as [number, number, number, number],
      },
    };
  }

  private captureSceneGraph(): SerializableSceneNode[] {
    const scene = this.core.scene;
    if (!scene) return [];

    const nodes: SerializableSceneNode[] = [];

    const getValidChildren = (object: THREE.Object3D): number[] => {
      const validIds: number[] = [];
      const visit = (node: THREE.Object3D) => {
        for (const child of node.children) {
          if (this.isInternalHelper(child)) continue;
          if (child instanceof THREE.Mesh || (child as {isXRScript?: boolean}).isXRScript) {
            validIds.push(child.id);
          } else {
            visit(child); // recurse to find valid grandchildren
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
      if (this.isInternalHelper(obj) || obj === scene) return;
      
      const isValid = obj instanceof THREE.Mesh || (obj as {isXRScript?: boolean}).isXRScript;
      if (!isValid) return;

      // Extract world transform
      obj.updateMatrixWorld(true);
      obj.getWorldPosition(worldPos);
      obj.getWorldQuaternion(worldQuat);
      obj.getWorldScale(worldScale);

      // Compute bounding box
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

  private captureTargeting(input: Input): {
    leftHand?: TargetingMetrics;
    rightHand?: TargetingMetrics;
    gaze?: TargetingMetrics;
  } {
    const getTargetingForController = (controller: THREE.Object3D): TargetingMetrics => {
      const origin = new THREE.Vector3();
      const direction = new THREE.Vector3();
      const matrix = new THREE.Matrix4();

      controller.getWorldPosition(origin);
      matrix.identity().extractRotation(controller.matrixWorld);
      direction.set(0, 0, -1).applyMatrix4(matrix).normalize();

      const intersections = input.intersectionsForController.get(controller) || [];
      const firstHit = intersections.find((i) => !this.isInternalHelper(i.object));

      return {
        hoveredObjectId: firstHit ? firstHit.object.id : null,
        distanceToHoveredObject: firstHit ? firstHit.distance : null,
        pointerOrigin: origin.toArray() as [number, number, number],
        pointerDirection: direction.toArray() as [number, number, number],
        isSelecting: !!controller?.userData.selected,
        intersectionPoint: firstHit ? firstHit.point.toArray() as [number, number, number] : null,
        surfaceNormal: firstHit ? firstHit.face?.normal.clone().applyQuaternion(firstHit.object.quaternion).toArray() as [number, number, number] : null,
      };
    };

    return {
      leftHand: input.leftController ? getTargetingForController(input.leftController) : undefined,
      rightHand: input.rightController ? getTargetingForController(input.rightController) : undefined,
      gaze: getTargetingForController(input.gazeController),
    };
  }

  /**
   * Extracts a list of all application objects that are currently inside the
   * camera's view frustum and have a clear line-of-sight (unoccluded).
   */
  private getVisibleInteractiveObjects(): Array<{
    object: THREE.Object3D;
    worldPosition: THREE.Vector3;
    distance: number;
  }> {
    const camera = this.camera;
    const scene = this.core.scene;
    const list: Array<{object: THREE.Object3D; worldPosition: THREE.Vector3; distance: number}> = [];
    if (!scene || !camera) return list;

    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);

    const box = new THREE.Box3();
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);

    const interactiveObjects = new Set<THREE.Object3D>();

    scene.traverse((obj) => {
      if (this.isInternalHelper(obj) || obj === scene) return;

      // 1. If any ancestor is already in our interactive set, skip this node to prevent double-counting
      let parent = obj.parent;
      while (parent) {
        if (interactiveObjects.has(parent)) {
          return;
        }
        parent = parent.parent;
      }

      // 2. An object is a valid interactive candidate if it is a Mesh, or a Script containing meshes
      let isValid = false;
      if (obj instanceof THREE.Mesh) {
        isValid = true;
      } else if ((obj as {isXRScript?: boolean}).isXRScript) {
        const customType = obj.type;
        const isGenericContainer = customType === 'Object3D' || customType === 'Group';
        if (!isGenericContainer) {
          let hasMesh = false;
          obj.traverse((child) => {
            if (child instanceof THREE.Mesh && !this.isInternalHelper(child)) {
              hasMesh = true;
            }
          });
          isValid = hasMesh;
        }
      }

      if (!isValid || !obj.visible) return;

      // 3. Perform view frustum check
      box.setFromObject(obj);
      if (frustum.intersectsBox(box)) {
        const objPos = new THREE.Vector3();
        obj.getWorldPosition(objPos);
        
        // 4. Distance-aware line-of-sight occlusion check
        const direction = new THREE.Vector3().subVectors(objPos, camPos).normalize();
        const raycaster = new THREE.Raycaster(camPos, direction);
        const intersects = raycaster.intersectObjects(scene.children, true);
        const firstHit = intersects.find((i) => !this.isInternalHelper(i.object));

        const distance = camPos.distanceTo(objPos);
        if (firstHit && (
          firstHit.object === obj ||
          objectIsDescendantOf(firstHit.object, obj) ||
          firstHit.distance >= distance - 0.05
        )) {
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

  /**
   * Generates a 2D grid of depth values in screen space.
   * Leverages the hardware-level WebXR Depth Sensing API if active (returning the raw
   * un-downscaled depth buffer), falling back to virtual scene graph raycasts if unavailable.
   */
  private captureDepth(gridSize: number): number[][] {
    const depthSubsystem = this.core.depth;

    // Use WebXR Depth Sensing if available.
    if (depthSubsystem && depthSubsystem.enabled && depthSubsystem.rawValueToMeters > 0 && depthSubsystem.depthArray[0]) {
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

    // Fall back to virtual scene graph raycasting if hardware depth is unavailable
    const camera = this.camera;
    const scene = this.core.scene;
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
        const firstHit = intersects.find((i) => !this.isInternalHelper(i.object));
        row.push(firstHit ? firstHit.distance : (camera as THREE.PerspectiveCamera).far || 2000);
      }
      depthGrid.push(row);
    }
    return depthGrid;
  }

  async captureObservation(
    customOptions?: SensorsOptions
  ): Promise<SensorsObservation> {
    const options = {
      ...this.defaultOptions,
      ...customOptions,
    };

    const observation: SensorsObservation = {};

    // Cache visible unoccluded objects if we need screenshots or semantic maps
    const visibleObjects = (options.includeScreenshot && options.annotateScreenshot) || options.includeSemanticMap
      ? this.getVisibleInteractiveObjects()
      : null;

    // 1. Screenshot & Set-of-Mark Overlay
    if (options.includeScreenshot) {
      const synth = this.core.screenshotSynthesizer;
      if (synth) {
        const rawScreenshot = await synth.getScreenshot(true);
        if (options.annotateScreenshot && visibleObjects) {
          observation.screenshot = await this.renderAnnotatedScreenshot(rawScreenshot, visibleObjects);
        } else {
          observation.screenshot = rawScreenshot;
        }
      }
    }

    // 2. Semantic Map & Plaintext Subtitles List (Rosetta Stone)
    if (options.includeSemanticMap && visibleObjects) {
      observation.visibleObjects = this.generateSemanticMap(visibleObjects);
    }

    // 3. Proprioception
    if (options.includeUserTransforms) {
      observation.state = this.captureProprioception();
    }

    // 4. Scene Graph
    if (options.includeSceneGraph) {
      observation.sceneGraph = this.captureSceneGraph();
    }

    // 5. Downsampled Depth
    if (options.includeDepth) {
      observation.depth = this.captureDepth(options.depthGridSize ?? 16);
    }

    // 6. Targeting
    if (options.includeTargeting) {
      observation.targeting = this.captureTargeting(this.input);
    }

    return observation;
  }

  /** Renders Set-of-Mark visual label overlays on top of the screenshot image. */
  private async renderAnnotatedScreenshot(
    rawScreenshot: string,
    visibleObjects: Array<{object: THREE.Object3D; worldPosition: THREE.Vector3}>
  ): Promise<string> {
    const camera = this.camera;
    if (!camera) return rawScreenshot;

    const img = new Image();
    img.src = rawScreenshot;
    await new Promise((resolve) => (img.onload = resolve));

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    let labelCounter = 1;

    for (const {worldPosition} of visibleObjects) {
      const screenPos = worldPosition.clone().project(camera);
      const x = ((screenPos.x + 1) * canvas.width) / 2;
      const y = ((-screenPos.y + 1) * canvas.height) / 2;

      // Draw Set-of-Mark Badge [labelCounter]
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, 2 * Math.PI);
      ctx.fillStyle = '#ff0055';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelCounter.toString(), x, y);

      labelCounter++;
    }

    return canvas.toDataURL('image/png');
  }

  /** Constructs the plaintext visible objects mapping list from pre-calculated visible objects. */
  private generateSemanticMap(
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
}
