import type {SplatMesh} from '@sparkjsdev/spark';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

import {OCCLUDABLE_ITEMS_LAYER} from '../../constants';
import {Script, type HoverEvent} from '../../core/Script';
import {Registry} from '../../core/components/Registry';
import {Depth} from '../../depth/Depth';
import {OcclusionUtils} from '../../depth/occlusion/OcclusionUtils';
import type {XBObjectOptions} from '../../interaction/InteractionTypes';
import {ManipulationAction} from '../../interaction/manipulation/ManipulationTypes';
import {normalizeManipulationConfig} from '../../interaction/manipulation/ManipulationConfig';
import {ModelLoader} from '../../utils/ModelLoader';
import {getGroupBoundingBox} from '../../utils/ModelUtils';
import {SparkRendererHolder} from '../../utils/SparkRendererHolder';
import type {Shader} from '../../utils/Types';

import {ModelViewerPlatform} from './ModelViewerPlatform';

const defaultPlatformMargin = new THREE.Vector2(0.2, 0.2);
function createRaycastProxyMaterial() {
  return new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
  });
}

export interface GLTFData {
  model: string;
  path?: string;
  scale?: THREE.Vector3Like;
  rotation?: THREE.Vector3Like;
  position?: THREE.Vector3Like;
  verticallyAlignObject?: boolean;
  horizontallyAlignObject?: boolean;
}

export interface SplatData {
  model: string;
  scale?: THREE.Vector3Like;
  rotation?: THREE.Vector3Like;
  position?: THREE.Vector3Like;
  verticallyAlignObject?: boolean;
  horizontallyAlignObject?: boolean;
}

export interface ModelViewerOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  raycastToChildren?: boolean;
}

class SplatAnchor extends THREE.Object3D {
  xb: XBObjectOptions = {
    manipulationHandle: {action: ManipulationAction.Rotate},
  };

  constructor() {
    super();
    this.userData.xrblocksPrivateSelf = true;
  }
}

class RotationRaycastMesh extends THREE.Mesh<
  THREE.BufferGeometry,
  THREE.Material
> {
  constructor(geometry: THREE.BufferGeometry, material: THREE.Material) {
    super(geometry, material);
    this.userData.xrblocksPrivateSelf = true;
  }
  xb: XBObjectOptions = {
    manipulationHandle: {action: ManipulationAction.Rotate},
  };
}

/**
 * A comprehensive UI component for loading, displaying, and
 * interacting with 3D models (GLTF and Splats) in an XR scene. It
 * automatically creates an interactive platform for translation and provides
 * mechanisms for rotation and scaling in both desktop and XR.
 */
export class ModelViewer extends Script {
  static dependencies = {
    depth: Depth,
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    registry: Registry,
    timer: THREE.Timer,
  };

  platformAnimationSpeed = 2;
  platformThickness = 0.02;
  startAnimationOnLoad = true;
  clipActions: THREE.AnimationAction[] = [];
  bbox = new THREE.Box3();

  protected data?: GLTFData | SplatData;
  protected timer!: THREE.Timer;
  protected animationMixer?: THREE.AnimationMixer;
  protected gltfMesh?: GLTF;

  protected splatMesh?: SplatMesh;
  // Anchor to act as a proxy for the splat mesh
  protected splatAnchor?: SplatAnchor;
  protected hoveringControllers = new Set();
  protected raycastToChildren: boolean;
  protected occludableShaders = new Set<Shader>();
  protected depth?: Depth;
  protected scene?: THREE.Scene;
  protected renderer?: THREE.WebGLRenderer;
  protected platform?: ModelViewerPlatform;
  protected rotationRaycastMesh?: RotationRaycastMesh;
  protected registry?: Registry;

  constructor({
    castShadow = true,
    receiveShadow = true,
    raycastToChildren = false,
  }: ModelViewerOptions = {}) {
    super();
    this.xb = {
      manipulation: {
        actions: {translate: true, rotate: true, scale: true},
        handle: {action: ManipulationAction.Rotate},
      },
    };
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.raycastToChildren = raycastToChildren;
  }

  async init({
    depth,
    scene,
    renderer,
    registry,
    timer,
  }: {
    depth: Depth;
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    registry: Registry;
    timer: THREE.Timer;
  }) {
    this.depth = depth;
    this.scene = scene;
    this.renderer = renderer;
    this.registry = registry;
    this.timer = timer;

    for (const shader of this.occludableShaders) {
      this.depth!.occludableShaders.add(shader);
    }

    if (this.splatMesh) {
      await this.createSparkRendererIfNeeded();
    }
  }

  async loadSplatModel({
    data,
    onSceneLoaded = (_) => {},
    platformMargin = defaultPlatformMargin,
    setupRaycastCylinder = true,
    setupRaycastBox = false,
    setupPlatform = true,
  }: {
    data: SplatData;
    onSceneLoaded?: (scene: THREE.Object3D) => void;
    platformMargin?: THREE.Vector2;
    setupRaycastCylinder?: boolean;
    setupRaycastBox?: boolean;
    setupPlatform?: boolean;
  }) {
    this.data = data;

    const splatMesh = await new ModelLoader().loadSplat({url: data.model});
    this.splatMesh = splatMesh;
    splatMesh.raycast = () => {};
    this.splatAnchor = new SplatAnchor();
    this.splatAnchor.add(splatMesh);

    if (data.scale) {
      this.splatAnchor.scale.copy(data.scale);
    }
    if (data.rotation) {
      this.splatAnchor.rotation.set(
        THREE.MathUtils.degToRad(data.rotation.x),
        THREE.MathUtils.degToRad(data.rotation.y),
        THREE.MathUtils.degToRad(data.rotation.z)
      );
    }
    if (data.position) {
      this.splatAnchor.position.copy(data.position);
    }

    this.add(this.splatAnchor);

    await this.createSparkRendererIfNeeded();

    await this.setupBoundingBox(
      data.verticallyAlignObject !== false,
      data.horizontallyAlignObject !== false
    );

    if (setupRaycastCylinder) {
      this.setupRaycastCylinder();
    } else if (setupRaycastBox) {
      this.setupRaycastBox();
    }
    if (setupPlatform) {
      this.setupPlatform(platformMargin);
    }

    this.setCastShadow(this.castShadow);
    this.setReceiveShadow(this.receiveShadow);

    // Return the anchor, as it's the interactive object in the scene graph
    return onSceneLoaded ? onSceneLoaded(this.splatAnchor) : this.splatAnchor;
  }

  async loadGLTFModel({
    data,
    onSceneLoaded = () => {},
    platformMargin = defaultPlatformMargin,
    setupRaycastCylinder = true,
    setupRaycastBox = false,
    setupPlatform = true,
    renderer = undefined,
    addOcclusionToShader = false,
  }: {
    data: GLTFData;
    onSceneLoaded?: (scene: THREE.Object3D) => void;
    platformMargin?: THREE.Vector2;
    setupRaycastCylinder?: boolean;
    setupRaycastBox?: boolean;
    setupPlatform?: boolean;
    renderer?: THREE.WebGLRenderer;
    addOcclusionToShader?: boolean;
  }) {
    this.data = data;
    const gltf = await new ModelLoader().loadGLTF({
      path: data.path,
      url: data.model,
      renderer: renderer,
    });
    const animationMixer = new THREE.AnimationMixer(gltf.scene);
    gltf.animations.forEach((clip) => {
      if (this.startAnimationOnLoad) {
        animationMixer.clipAction(clip).play();
      } else {
        this.clipActions.push(animationMixer.clipAction(clip));
      }
    });
    gltf.scene.xb = {
      manipulationHandle: {action: ManipulationAction.Rotate},
    };
    this.gltfMesh = gltf;
    this.animationMixer = animationMixer;
    // Set the initial scale
    if (data.scale) {
      this.gltfMesh.scene.scale.copy(data.scale);
    }
    if (data.rotation) {
      gltf.scene.rotation.set(
        THREE.MathUtils.degToRad(data.rotation.x),
        THREE.MathUtils.degToRad(data.rotation.y),
        THREE.MathUtils.degToRad(data.rotation.z)
      );
    }
    if (data.position) {
      gltf.scene.position.copy(data.position);
    }
    this.add(gltf.scene);
    await this.setupBoundingBox(
      data.verticallyAlignObject !== false,
      data.horizontallyAlignObject !== false
    );
    if (setupRaycastCylinder) {
      this.setupRaycastCylinder();
    } else if (setupRaycastBox) {
      this.setupRaycastBox();
    }
    if (setupPlatform) {
      this.setupPlatform(platformMargin);
    }
    this.setCastShadow(this.castShadow);
    this.setReceiveShadow(this.receiveShadow);
    if (addOcclusionToShader) {
      for (const material of this.platform?.material || []) {
        material.onBeforeCompile = (shader: Shader) => {
          OcclusionUtils.addOcclusionToShader(shader);
          shader.uniforms.occlusionEnabled.value = true;
          material.userData.shader = shader;
          this.occludableShaders.add(shader);
          this.depth?.occludableShaders.add(shader);
        };
      }
      this.platform?.layers.enable(OCCLUDABLE_ITEMS_LAYER);
      gltf.scene.traverse((child) => {
        if ((child as Partial<THREE.Mesh>).isMesh) {
          const mesh = child as THREE.Mesh;
          (mesh.material instanceof Array
            ? mesh.material
            : [mesh.material]
          ).forEach((material) => {
            material.transparent = true;
            material.onBeforeCompile = (shader) => {
              OcclusionUtils.addOcclusionToShader(shader);
              shader.uniforms.occlusionEnabled.value = true;
              this.occludableShaders.add(shader);
              this.depth?.occludableShaders.add(shader);
            };
          });
          child.layers.enable(OCCLUDABLE_ITEMS_LAYER);
        }
      });
    }
    return onSceneLoaded ? onSceneLoaded(gltf.scene) : gltf.scene;
  }

  async setupBoundingBox(
    verticallyAlignObject = true,
    horizontallyAlignObject = true
  ) {
    if (this.splatMesh) {
      const localBbox = await this.splatMesh.getBoundingBox(false);
      if (localBbox.isEmpty()) {
        this.bbox = localBbox;
        return;
      }
      this.splatAnchor!.updateMatrix();
      const localBboxOfTransformedMesh = localBbox
        .clone()
        .applyMatrix4(this.splatAnchor!.matrix);

      const translationAmount = new THREE.Vector3();
      localBboxOfTransformedMesh
        .getCenter(translationAmount)
        .multiplyScalar(-1);
      if (verticallyAlignObject) {
        translationAmount.y = -localBboxOfTransformedMesh.min.y;
      } else {
        translationAmount.y = 0;
      }
      if (!horizontallyAlignObject) {
        translationAmount.x = 0;
        translationAmount.z = 0;
      }
      this.splatAnchor!.position.add(translationAmount);
      this.bbox = localBboxOfTransformedMesh.translate(translationAmount);
    } else {
      const contentChildren = this.children.filter(
        (c) => c !== this.platform && c !== this.rotationRaycastMesh
      );
      this.bbox = getGroupBoundingBox(contentChildren);
      if (this.bbox.isEmpty()) {
        return;
      }

      const translationAmount = new THREE.Vector3();
      this.bbox.getCenter(translationAmount).multiplyScalar(-1);
      if (verticallyAlignObject) {
        translationAmount.y = -this.bbox.min.y;
      } else {
        translationAmount.y = 0;
      }
      if (!horizontallyAlignObject) {
        translationAmount.x = 0;
        translationAmount.z = 0;
      }
      for (const child of contentChildren) {
        child.position.add(translationAmount);
      }
      this.bbox.translate(translationAmount);
    }
  }

  setupRaycastCylinder() {
    const bboxSize = new THREE.Vector3();
    this.bbox.getSize(bboxSize);

    const radius = 0.05 + 0.5 * Math.min(bboxSize.x, bboxSize.z);
    const rotationRaycastMesh = new RotationRaycastMesh(
      new THREE.CylinderGeometry(radius, radius, bboxSize.y),
      createRaycastProxyMaterial()
    );
    this.bbox.getCenter(rotationRaycastMesh.position);
    this.rotationRaycastMesh = rotationRaycastMesh;
    this.add(this.rotationRaycastMesh);
  }

  setupRaycastBox() {
    if (this.rotationRaycastMesh) {
      this.rotationRaycastMesh.removeFromParent();
      this.rotationRaycastMesh.geometry.dispose();
      this.rotationRaycastMesh.material.dispose();
    }
    const bboxSize = new THREE.Vector3();
    this.bbox.getSize(bboxSize);

    const rotationRaycastMesh = new RotationRaycastMesh(
      new THREE.BoxGeometry(bboxSize.x, bboxSize.y, bboxSize.z),
      createRaycastProxyMaterial()
    );
    this.bbox.getCenter(rotationRaycastMesh.position);
    this.rotationRaycastMesh = rotationRaycastMesh;
    this.add(this.rotationRaycastMesh);
  }

  setupPlatform(platformMargin = defaultPlatformMargin) {
    const bboxSize = new THREE.Vector3();
    this.bbox.getSize(bboxSize);
    const width = bboxSize.x + platformMargin.x;
    const depth = bboxSize.z + platformMargin.y;
    this.platform = new ModelViewerPlatform(
      width,
      depth,
      this.platformThickness
    );
    const center = new THREE.Vector3();
    this.bbox.getCenter(center);
    this.platform.position.set(center.x, -this.platformThickness / 2, center.z);
    this.add(this.platform);
  }

  update() {
    const delta = this.timer.getDelta();
    if (this.animationMixer) {
      this.animationMixer.update(delta);
    }
    if (this.platform) {
      this.platform.update(delta);
    }
  }

  onHoverEnter(event: HoverEvent) {
    this.hoveringControllers.add(event.source.controller);
    if (this.platform) {
      this.platform.opacity.speed = this.platformAnimationSpeed;
    }
  }

  onHoverExit(event: HoverEvent) {
    this.hoveringControllers.delete(event.source.controller);
    if (this.platform && this.hoveringControllers.size == 0) {
      this.platform.opacity.speed = -this.platformAnimationSpeed;
    }
  }

  /**
   * {@inheritDoc}
   */
  raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    const content = this.gltfMesh?.scene ?? this.splatMesh;
    if (this.raycastToChildren && content) {
      const childRaycasts: THREE.Intersection[] = [];
      for (const child of this.children) {
        if (child != this.rotationRaycastMesh && child != this.platform) {
          raycaster.intersectObject(child, true, childRaycasts);
        }
      }
      intersects.push(...childRaycasts);
    }

    if (this.rotationRaycastMesh) {
      const rotationIntersects: THREE.Intersection[] = [];
      this.rotationRaycastMesh.raycast(raycaster, rotationIntersects);
      for (const intersect of rotationIntersects) {
        intersects.push(intersect);
      }
    }

    if (this.platform) {
      const platformIntersects: THREE.Intersection[] = [];
      this.platform.raycast(raycaster, platformIntersects);
      for (const intersect of platformIntersects) {
        intersects.push(intersect);
      }
    }

    return false;
  }

  get draggable(): boolean {
    return this.capabilityEnabled('translate');
  }

  set draggable(value: boolean) {
    this.setCapability('translate', value);
  }

  get rotatable(): boolean {
    return this.capabilityEnabled('rotate');
  }

  set rotatable(value: boolean) {
    this.setCapability('rotate', value);
  }

  get scalable(): boolean {
    return this.capabilityEnabled('scale');
  }

  set scalable(value: boolean) {
    this.setCapability('scale', value);
  }

  setCastShadow(castShadow: boolean) {
    this.castShadow = castShadow;
    if (this.gltfMesh) {
      this.gltfMesh.scene.traverse(function (child) {
        child.castShadow = castShadow;
      });
    }
    if (this.platform) {
      this.platform.castShadow = false;
    }
  }

  setReceiveShadow(receiveShadow: boolean) {
    this.receiveShadow = receiveShadow;
    if (this.gltfMesh) {
      this.gltfMesh.scene.traverse(function (child) {
        child.receiveShadow = receiveShadow;
      });
    }
    if (this.platform) {
      this.platform.receiveShadow = receiveShadow;
    }
  }

  getOcclusionEnabled() {
    for (const shader of this.occludableShaders) {
      return shader.uniforms.occlusionEnabled.value;
    }
    return false;
  }

  setOcclusionEnabled(enabled: boolean) {
    for (const shader of this.occludableShaders) {
      shader.uniforms.occlusionEnabled.value = enabled;
    }
  }

  playClipAnimationOnce() {
    if (this.startAnimationOnLoad || this.clipActions.length === 0) {
      return;
    }

    this.clipActions.forEach((clip) => {
      clip.reset();
      clip.clampWhenFinished = true;
      clip.loop = THREE.LoopOnce;
      clip.play();
    });
  }

  async createSparkRendererIfNeeded() {
    // Loading can start from a parent Script's init before this child receives
    // its injected dependencies. ModelViewer.init will retry after injection.
    if (!this.scene || !this.renderer || !this.registry) return;

    // We insert our own SparkRenderer configured to show Gaussians up to
    // Math.sqrt(4) standard deviations from the center, recommended for XR.
    const {SparkRenderer} = await import('@sparkjsdev/spark');
    let sparkRenderer: InstanceType<typeof SparkRenderer> | undefined;
    this.scene.traverse((child) => {
      if (child instanceof SparkRenderer) sparkRenderer = child;
    });
    if (!sparkRenderer) {
      sparkRenderer = new SparkRenderer({
        renderer: this.renderer,
        maxStdDev: Math.sqrt(4),
      });
      this.scene.add(sparkRenderer);
    }
    if (!this.registry.get(SparkRendererHolder)) {
      this.registry.register(new SparkRendererHolder(sparkRenderer));
    }
  }

  private capabilityEnabled(action: 'translate' | 'rotate' | 'scale'): boolean {
    return !!normalizeManipulationConfig(this.xb?.manipulation)?.[action];
  }

  private setCapability(
    action: 'translate' | 'rotate' | 'scale',
    enabled: boolean
  ): void {
    const current = this.xb?.manipulation;
    const options =
      current && current !== true
        ? {
            ...current,
            actions: {...current.actions},
            handle: current.handle ? {...current.handle} : undefined,
          }
        : {
            actions: {
              translate: current === true,
              rotate: current === true,
              scale: current === true,
            },
            handle: {action: ManipulationAction.Rotate},
          };
    options.actions[action] = enabled;
    this.xb ??= {};
    this.xb.manipulation = options;
  }
}
