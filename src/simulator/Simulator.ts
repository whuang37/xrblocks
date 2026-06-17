import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import type {SparkRenderer} from '@sparkjsdev/spark';

import {XRDeviceCamera} from '../camera/XRDeviceCamera.js';
import {Registry} from '../core/components/Registry';
import {XREffects} from '../core/components/XREffects';
import {Options} from '../core/Options';
import {Script} from '../core/Script';
import {Depth} from '../depth/Depth';
import {Input} from '../input/Input';

import {SimulatorCamera} from './SimulatorCamera';
import {AVERAGE_IPD_METERS, SimulatorRenderMode} from './SimulatorConstants';
import {SimulatorControllerState} from './SimulatorControllerState';
import {SimulatorControls} from './SimulatorControls';
import {SimulatorDepth} from './SimulatorDepth';
import {SimulatorHands} from './SimulatorHands';
import {SimulatorInterface} from './SimulatorInterface';
import {SimulatorOptions} from './SimulatorOptions';
import {SimulatorScene} from './SimulatorScene';
import {SimulatorUser} from './SimulatorUser';
import {SimulatorWorld} from './SimulatorWorld';
import {SparkRendererHolder} from '../utils/SparkRendererHolder';
import {World} from '../world/World';

const HAND_GLOW_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const HAND_GLOW_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tHandMask;
  uniform vec2 uTexelSize;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uThicknessPx;

  varying vec2 vUv;

  float maskAt(vec2 uv) {
    return texture2D(tHandMask, uv).r;
  }

  float ringAt(float radiusPx) {
    vec2 offset = uTexelSize * radiusPx;
    float total = 0.0;

    total += maskAt(vUv + vec2(-offset.x, 0.0));
    total += maskAt(vUv + vec2(offset.x, 0.0));
    total += maskAt(vUv + vec2(0.0, -offset.y));
    total += maskAt(vUv + vec2(0.0, offset.y));
    total += maskAt(vUv + vec2(-offset.x, -offset.y));
    total += maskAt(vUv + vec2(offset.x, -offset.y));
    total += maskAt(vUv + vec2(-offset.x, offset.y));
    total += maskAt(vUv + vec2(offset.x, offset.y));

    return total * 0.125;
  }

  void main() {
    if (maskAt(vUv) > 0.5) {
      discard;
    }

    float thickness = max(uThicknessPx, 1.0);
    float glow = 0.0;
    glow += ringAt(thickness * 0.20) * 0.22;
    glow += ringAt(thickness * 0.40) * 0.20;
    glow += ringAt(thickness * 0.65) * 0.18;
    glow += ringAt(thickness * 0.95) * 0.15;
    glow += ringAt(thickness * 1.30) * 0.11;
    glow += ringAt(thickness * 1.70) * 0.08;
    glow += ringAt(thickness * 2.15) * 0.04;
    glow += ringAt(thickness * 2.65) * 0.02;

    float alpha = smoothstep(0.02, 0.22, glow) * uOpacity;
    if (alpha <= 0.0) {
      discard;
    }

    gl_FragColor = vec4(uColor, alpha);
  }
`;

export class Simulator extends Script {
  static dependencies = {
    simulatorOptions: SimulatorOptions,
    input: Input,
    timer: THREE.Timer,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    registry: Registry,
    options: Options,
    depth: Depth,
    world: World,
  };
  editorIcon = 'simulation';
  simulatorScene = new SimulatorScene();
  simulatorWorld = new SimulatorWorld();
  depth = new SimulatorDepth(this.simulatorScene);
  // Controller poses relative to the camera.
  simulatorControllerState = new SimulatorControllerState();
  hands = new SimulatorHands(
    this.simulatorControllerState,
    this.simulatorScene
  );
  simulatorUser = new SimulatorUser();
  userInterface = new SimulatorInterface();
  controls = new SimulatorControls(
    this.simulatorControllerState,
    this.hands,
    this.setStereoRenderMode.bind(this),
    this.userInterface
  );
  renderDepthPass = false;
  renderMode = SimulatorRenderMode.DEFAULT;
  stereoCameras: THREE.Camera[] = [];
  effects?: XREffects;

  // Render target for the virtual scene.
  virtualSceneRenderTarget?: THREE.WebGLRenderTarget;
  virtualSceneFullScreenQuad?: FullScreenQuad;
  backgroundVideoQuad?: FullScreenQuad;
  handGlowMaskRenderTarget?: THREE.WebGLRenderTarget;
  handGlowFullScreenQuad?: FullScreenQuad;
  videoElement?: HTMLVideoElement;

  simulatorCamera?: SimulatorCamera;
  options!: SimulatorOptions;
  renderer!: THREE.WebGLRenderer;
  mainCamera!: THREE.Camera;
  mainScene!: THREE.Scene;

  private initialized = false;
  private renderSimulatorSceneToCanvasBound =
    this.renderSimulatorSceneToCanvas.bind(this);
  private sparkRenderer?: SparkRenderer;
  private registry?: Registry;
  private handGlowMaskMaterial?: THREE.MeshBasicMaterial;
  private clearColor = new THREE.Color();

  constructor(
    private renderMainScene: (cameraOverride?: THREE.Camera) => void
  ) {
    super();
    this.add(this.simulatorUser);
  }

  async init({
    simulatorOptions,
    input,
    timer,
    camera,
    renderer,
    scene,
    registry,
    options,
    depth,
    world,
  }: {
    simulatorOptions: SimulatorOptions;
    input: Input;
    timer: THREE.Timer;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    registry: Registry;
    options: Options;
    depth: Depth;
    world: World;
  }) {
    if (this.initialized) return;
    // Get optional dependencies from the registry.
    const deviceCamera = registry.get(XRDeviceCamera);
    this.options = simulatorOptions;
    camera.position.copy(this.options.initialCameraPosition);
    this.userInterface.init(
      simulatorOptions,
      this.controls,
      this.hands,
      input,
      this.simulatorScene
    );
    renderer.autoClearColor = false;
    await this.simulatorScene.init(simulatorOptions);
    await this.simulatorWorld.init(options, world);
    this.hands.init({input});
    this.controls.init({camera, input, timer, renderer, simulatorOptions});
    if (
      deviceCamera &&
      !this.simulatorCamera &&
      this.options.deviceCamera.enabled
    ) {
      this.simulatorCamera = new SimulatorCamera(renderer);
      this.simulatorCamera.init();
      deviceCamera.registerSimulatorCamera(this.simulatorCamera);
    }
    deviceCamera?.init();

    if (options.depth.enabled) {
      this.renderDepthPass = true;
      this.depth.init(renderer, camera, depth);
    }
    scene.add(camera);

    if (this.options.stereo.enabled) {
      this.setupStereoCameras(camera);
    }

    const activeEnv =
      this.options.environments[this.options.activeEnvironmentIndex];
    if (activeEnv?.videoPath) {
      this.videoElement = document.createElement('video');
      this.videoElement.src = activeEnv.videoPath;
      this.videoElement.loop = true;
      this.videoElement.muted = true;
      this.videoElement.play().catch((e) => {
        console.error(
          `Simulator: Failed to play video at ${activeEnv.videoPath}`,
          e
        );
      });
      this.videoElement.addEventListener('error', () => {
        console.error(
          `Simulator: Error loading video at ${activeEnv.videoPath}`,
          this.videoElement?.error
        );
      });

      const videoTexture = new THREE.VideoTexture(this.videoElement);
      videoTexture.colorSpace = THREE.SRGBColorSpace;
      this.backgroundVideoQuad = new FullScreenQuad(
        new THREE.MeshBasicMaterial({map: videoTexture})
      );
    }

    this.virtualSceneRenderTarget = new THREE.WebGLRenderTarget(
      renderer.domElement.width,
      renderer.domElement.height,
      {stencilBuffer: options.stencil}
    );
    const virtualSceneMaterial = new THREE.MeshBasicMaterial({
      map: this.virtualSceneRenderTarget.texture,
      transparent: true,
    });
    if (this.options.blendingMode === 'screen') {
      virtualSceneMaterial.blending = THREE.CustomBlending;
      virtualSceneMaterial.blendSrc = THREE.OneFactor;
      virtualSceneMaterial.blendDst = THREE.OneMinusSrcColorFactor;
      virtualSceneMaterial.blendEquation = THREE.AddEquation;
    }
    this.virtualSceneFullScreenQuad = new FullScreenQuad(virtualSceneMaterial);
    this.handGlowMaskRenderTarget = new THREE.WebGLRenderTarget(
      renderer.domElement.width,
      renderer.domElement.height
    );
    this.handGlowFullScreenQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: {
          tHandMask: {value: this.handGlowMaskRenderTarget.texture},
          uTexelSize: {
            value: new THREE.Vector2(
              1 / renderer.domElement.width,
              1 / renderer.domElement.height
            ),
          },
          uColor: {value: new THREE.Color(this.options.handGlow.color)},
          uOpacity: {value: this.options.handGlow.opacity},
          uThicknessPx: {value: this.options.handGlow.thicknessPx},
        },
        vertexShader: HAND_GLOW_VERTEX_SHADER,
        fragmentShader: HAND_GLOW_FRAGMENT_SHADER,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
    );

    this.renderer = renderer;
    this.mainCamera = camera;
    this.mainScene = scene;
    this.registry = registry;
    this.initialized = true;
  }

  simulatorUpdate() {
    this.controls.update();
    this.hands.update();

    if (this.renderDepthPass) {
      this.depth.update();
    }
  }

  setStereoRenderMode(mode: SimulatorRenderMode) {
    if (!this.options.stereo.enabled) return;
    this.renderMode = mode;
  }

  setupStereoCameras(camera: THREE.Camera) {
    const leftCamera = camera.clone();
    const rightCamera = camera.clone();
    leftCamera.layers.disableAll();
    leftCamera.layers.enable(0);
    leftCamera.layers.enable(1);
    rightCamera.layers.disableAll();
    rightCamera.layers.enable(0);
    rightCamera.layers.enable(2);
    leftCamera.position.set(-AVERAGE_IPD_METERS / 2, 0, 0);
    rightCamera.position.set(AVERAGE_IPD_METERS / 2, 0, 0);
    leftCamera.updateWorldMatrix(true, false);
    rightCamera.updateWorldMatrix(true, false);
    this.stereoCameras.length = 0;
    this.stereoCameras.push(leftCamera, rightCamera);
    camera.add(leftCamera, rightCamera);
    this.setStereoRenderMode(SimulatorRenderMode.STEREO_LEFT);
  }

  onBeforeSimulatorSceneRender() {
    this.simulatorCamera?.onBeforeSimulatorSceneRender(
      this.mainCamera,
      this.renderSimulatorSceneToCanvasBound
    );
  }

  onSimulatorSceneRendered() {
    this.simulatorCamera?.onSimulatorSceneRendered();
  }

  getRenderCamera() {
    return {
      [SimulatorRenderMode.DEFAULT]: this.mainCamera,
      [SimulatorRenderMode.STEREO_LEFT]: this.stereoCameras[0],
      [SimulatorRenderMode.STEREO_RIGHT]: this.stereoCameras[1],
    }[this.renderMode];
  }

  // Called by core when the simulator is running.
  renderScene() {
    if (!this.renderer) return;
    if (!this.options.renderToRenderTexture) return;
    // Allocate a new render target if the resolution changes.
    if (
      this.virtualSceneRenderTarget!.width != this.renderer.domElement.width ||
      this.virtualSceneRenderTarget!.height != this.renderer.domElement.height
    ) {
      const stencilEnabled = !!this.virtualSceneRenderTarget?.stencilBuffer;
      this.virtualSceneRenderTarget!.dispose();
      this.handGlowMaskRenderTarget!.dispose();
      this.virtualSceneRenderTarget = new THREE.WebGLRenderTarget(
        this.renderer.domElement.width,
        this.renderer.domElement.height,
        {stencilBuffer: stencilEnabled}
      );
      this.handGlowMaskRenderTarget = new THREE.WebGLRenderTarget(
        this.renderer.domElement.width,
        this.renderer.domElement.height
      );
      (
        this.virtualSceneFullScreenQuad!.material as THREE.MeshBasicMaterial
      ).map = this.virtualSceneRenderTarget.texture;
      this.updateHandGlowUniforms();
    }
    this.sparkRenderer =
      this.sparkRenderer || this.registry!.get(SparkRendererHolder)?.renderer;
    if (this.sparkRenderer) {
      this.sparkRenderer.encodeLinear = true;
    }
    this.renderer.setRenderTarget(this.virtualSceneRenderTarget!);
    this.renderer.clear();
    this.renderMainScene(this.getRenderCamera());
  }

  // Renders the simulator scene onto the main canvas.
  // Then composites the virtual render with the simulator render.
  // Called by core after renderScene.
  renderSimulatorScene() {
    const camera = this.getRenderCamera();
    this.onBeforeSimulatorSceneRender();
    this.renderSimulatorSceneToCanvas(camera);
    this.onSimulatorSceneRendered();
    if (this.options.renderToRenderTexture) {
      if (this.shouldRenderHandGlow()) {
        this.renderHandGlowMask(camera);
      }
      this.virtualSceneFullScreenQuad!.render(this.renderer);
      if (this.shouldRenderHandGlow()) {
        this.renderHandGlow();
      }
    } else {
      // Temporary workaround since splats look faded when rendered to a render
      // texture.
      this.renderMainScene(camera);
    }
  }

  private shouldRenderHandGlow() {
    if (!this.options.handGlow.enabled) return false;
    return (
      this.hands.leftController.visible || this.hands.rightController.visible
    );
  }

  private getHandGlowMaskMaterial() {
    if (!this.handGlowMaskMaterial) {
      this.handGlowMaskMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
      });
    }
    return this.handGlowMaskMaterial;
  }

  private renderHandGlowMask(camera: THREE.Camera) {
    const renderTarget = this.handGlowMaskRenderTarget;
    if (!renderTarget) return;

    this.renderer.setRenderTarget(renderTarget);
    this.renderer.getClearColor(this.clearColor);
    const clearAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();

    try {
      const material = this.getHandGlowMaskMaterial();
      this.renderHandRootWithMaterial(
        this.hands.leftController,
        camera,
        material
      );
      this.renderHandRootWithMaterial(
        this.hands.rightController,
        camera,
        material
      );
    } finally {
      this.renderer.setClearColor(this.clearColor, clearAlpha);
      this.renderer.setRenderTarget(null);
    }
  }

  private renderHandGlow() {
    this.updateHandGlowUniforms();
    this.handGlowFullScreenQuad!.render(this.renderer);
  }

  private updateHandGlowUniforms() {
    const material = this.handGlowFullScreenQuad
      ?.material as THREE.ShaderMaterial;
    const renderTarget = this.handGlowMaskRenderTarget;
    if (!material || !renderTarget) return;
    const handGlow = this.options.handGlow;
    material.uniforms.tHandMask.value = renderTarget.texture;
    material.uniforms.uTexelSize.value.set(
      1 / this.renderer.domElement.width,
      1 / this.renderer.domElement.height
    );
    material.uniforms.uColor.value.set(handGlow.color);
    material.uniforms.uOpacity.value = handGlow.opacity;
    material.uniforms.uThicknessPx.value = handGlow.thicknessPx;
  }

  private renderHandRootWithMaterial(
    root: THREE.Object3D,
    camera: THREE.Camera,
    material: THREE.Material
  ) {
    if (!root.visible) return;
    const originalMaterials: Array<{
      mesh: THREE.Mesh;
      material: THREE.Mesh['material'];
    }> = [];

    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      originalMaterials.push({mesh, material: mesh.material});
      mesh.material = material;
    });

    try {
      this.renderer.render(root, camera);
    } finally {
      for (const original of originalMaterials) {
        original.mesh.material = original.material;
      }
    }
  }

  private renderSimulatorSceneToCanvas(camera: THREE.Camera) {
    if (this.sparkRenderer) {
      this.sparkRenderer.encodeLinear = false;
    }
    this.renderer.setRenderTarget(null);
    if (this.backgroundVideoQuad) {
      this.backgroundVideoQuad.render(this.renderer);
    }
    this.renderer.render(this.simulatorScene, camera);
    this.renderer.clearDepth();
  }
}
