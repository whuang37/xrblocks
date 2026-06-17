import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {Core, Input, Script, Simulator} from 'xrblocks';

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

export interface HandGlowOptions {
  enabled?: boolean;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  thicknessPx?: number;
}

const DEFAULT_HAND_GLOW_OPTIONS = {
  enabled: true,
  color: 0xffffff,
  opacity: 0.8,
  thicknessPx: 7,
} satisfies Required<HandGlowOptions>;

export class HandGlow extends Script {
  static dependencies = {
    core: Core,
    input: Input,
    simulator: Simulator,
  };

  editorIcon = 'back_hand';

  private core!: Core;
  private input!: Input;
  private simulator!: Simulator;
  private options: Required<HandGlowOptions>;
  private maskRenderTarget?: THREE.WebGLRenderTarget;
  private maskMaterial = new THREE.MeshBasicMaterial({color: 0xffffff});
  private glowQuad = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {
        tHandMask: {value: null as THREE.Texture | null},
        uTexelSize: {value: new THREE.Vector2(1, 1)},
        uColor: {value: new THREE.Color(DEFAULT_HAND_GLOW_OPTIONS.color)},
        uOpacity: {value: DEFAULT_HAND_GLOW_OPTIONS.opacity},
        uThicknessPx: {value: DEFAULT_HAND_GLOW_OPTIONS.thicknessPx},
      },
      vertexShader: HAND_GLOW_VERTEX_SHADER,
      fragmentShader: HAND_GLOW_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
  );
  private clearColor = new THREE.Color();
  private drawingBufferSize = new THREE.Vector2();

  constructor(options: HandGlowOptions = {}) {
    super();
    this.options = {
      ...DEFAULT_HAND_GLOW_OPTIONS,
      ...options,
    };
  }

  init({
    core,
    input,
    simulator,
  }: {
    core: Core;
    input: Input;
    simulator: Simulator;
  }) {
    this.core = core;
    this.input = input;
    this.simulator = simulator;
  }

  afterRender(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (!this.options.enabled || !this.visible) return;
    const handRoots = this.getVisibleHandRoots();
    if (handRoots.length === 0) return;

    this.ensureRenderTarget(renderer);
    if (!this.maskRenderTarget) return;

    this.renderHandMask(renderer, camera, handRoots);
    this.updateGlowUniforms(renderer);
    this.glowQuad.render(renderer);
  }

  dispose() {
    this.maskRenderTarget?.dispose();
    this.maskMaterial.dispose();
    this.glowQuad.dispose();
  }

  private getVisibleHandRoots() {
    const roots = this.core.simulatorRunning
      ? [
          this.simulator.hands.leftController,
          this.simulator.hands.rightController,
        ]
      : this.input.hands;
    return roots.filter((root) => root.visible);
  }

  private ensureRenderTarget(renderer: THREE.WebGLRenderer) {
    renderer.getDrawingBufferSize(this.drawingBufferSize);
    const width = this.drawingBufferSize.x;
    const height = this.drawingBufferSize.y;
    if (
      this.maskRenderTarget?.width === width &&
      this.maskRenderTarget.height === height
    ) {
      return;
    }

    this.maskRenderTarget?.dispose();
    this.maskRenderTarget = new THREE.WebGLRenderTarget(width, height);
  }

  private renderHandMask(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    handRoots: THREE.Object3D[]
  ) {
    const renderTarget = this.maskRenderTarget;
    if (!renderTarget) return;

    const originalRenderTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();

    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();

    try {
      for (const root of handRoots) {
        this.renderHandRootWithMaterial(renderer, root, camera);
      }
    } finally {
      renderer.setClearColor(this.clearColor, clearAlpha);
      renderer.setRenderTarget(originalRenderTarget);
    }
  }

  private updateGlowUniforms(renderer: THREE.WebGLRenderer) {
    if (!this.maskRenderTarget) return;
    const material = this.glowQuad.material as THREE.ShaderMaterial;
    renderer.getDrawingBufferSize(this.drawingBufferSize);
    material.uniforms.tHandMask.value = this.maskRenderTarget.texture;
    material.uniforms.uTexelSize.value.set(
      1 / this.drawingBufferSize.x,
      1 / this.drawingBufferSize.y
    );
    material.uniforms.uColor.value.set(this.options.color);
    material.uniforms.uOpacity.value = this.options.opacity;
    material.uniforms.uThicknessPx.value = this.options.thicknessPx;
  }

  private renderHandRootWithMaterial(
    renderer: THREE.WebGLRenderer,
    root: THREE.Object3D,
    camera: THREE.Camera
  ) {
    const originalMaterials: Array<{
      mesh: THREE.Mesh;
      material: THREE.Mesh['material'];
    }> = [];

    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      originalMaterials.push({mesh, material: mesh.material});
      mesh.material = this.maskMaterial;
    });

    try {
      renderer.render(root, camera);
    } finally {
      for (const original of originalMaterials) {
        original.mesh.material = original.material;
      }
    }
  }
}
