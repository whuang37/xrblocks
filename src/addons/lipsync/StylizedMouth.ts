import * as THREE from 'three';

import type {VisemeWeights} from './BlendshapeReducer';

export interface StylizedMouthOptions {
  /**
   * Approximate radius (metres) of the host head this mouth attaches to.
   * Used to scale the mouth quad and place it at the head surface.
   * Defaults to 0.1, matching netblocks `RemoteUserAvatar`'s head sphere.
   */
  headRadius?: number;
  /** Square canvas dimension in pixels. Defaults to 256. */
  textureSize?: number;
  /**
   * Draw a pair of static eyes above the mouth on the same canvas, so a
   * bare avatar head sphere reads as a face. Defaults to true. Set false
   * when the host avatar already provides its own eye geometry (e.g. the
   * puppet sample) to avoid doubled-up eyes.
   */
  showEyes?: boolean;
}

export interface LipMetrics {
  /** Horizontal mouth width, normalised. Wider for /ee/, narrower for /oo/. */
  width: number;
  /** Vertical mouth opening, 0 (closed line) to ~1 (fully agape). */
  openHeight: number;
}

/**
 * StylizedMouth: a flat quad textured with a single soft-edged dark
 * ellipse that morphs from a thin "closed" line into a wider oval as
 * the host speaks. Deliberately minimal: the quad sits flush with the
 * front of the host head sphere and is anchored to the head's local
 * forward (-Z) so the mouth follows head orientation like a real face.
 *
 * The quad is positioned at local z = -headRadius * 1.001 so it lands
 * just outside the head sphere on the face side and never z-fights.
 */
export class StylizedMouth extends THREE.Object3D {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly headRadius: number;
  private readonly showEyes: boolean;

  /** Last viseme weights applied; useful for testing and debugging. */
  visemes: VisemeWeights = {
    jawOpen: 0,
    aa: 0,
    oo: 0,
    oh: 0,
    ee: 0,
    consonant: 0,
  };

  /** Computed lip metrics from the most recent setVisemes call. */
  metrics: LipMetrics = {width: 1, openHeight: 0};

  // Cached state from the last actual redraw, used to short-circuit
  // setVisemes when neither the lip shape nor the blink frame would
  // produce a visually different texture. Avoids 256x256 canvas
  // redraws and CanvasTexture re-uploads while the mouth is at rest.
  private lastDrawnWidth = NaN;
  private lastDrawnOpenHeight = NaN;
  private lastDrawnBlinkScale = NaN;

  // Schedule for the next blink (wall-clock ms via performance.now). The
  // initial value is set in the constructor so the very first blink
  // happens a few seconds after the avatar appears, not instantly.
  private nextBlinkAt = 0;
  // Wall-clock ms when the current blink started. -Infinity means "no
  // blink in progress".
  private blinkStartAt = -Infinity;
  // Total duration of one blink (eyelid down + back up).
  private static readonly BLINK_MS = 140;

  constructor(opts: StylizedMouthOptions = {}) {
    super();
    this.headRadius = opts.headRadius ?? 0.1;
    this.showEyes = opts.showEyes ?? true;
    const size = opts.textureSize ?? 256;

    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    // Quad covers roughly the lower half of the host face.
    const planeSize = this.headRadius * 1.4;
    const geom = new THREE.PlaneGeometry(planeSize, planeSize);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    // Flush with the head sphere on the face (-Z) side.
    this.mesh.position.z = -this.headRadius * 1.001;
    // PlaneGeometry's normal is +Z; rotate so it faces -Z (out the
    // front of the head) instead of into the sphere.
    this.mesh.rotation.y = Math.PI;
    this.add(this.mesh);

    this.nextBlinkAt = performance.now() + 2000 + Math.random() * 3000;
    this.setVisemes(this.visemes);
  }

  /**
   * Drive the mouth drawing from a viseme weight set. Cheap enough to
   * call every frame; redraws and re-uploads the canvas texture only
   * when the lip shape or blink frame would actually change pixels.
   */
  setVisemes(v: VisemeWeights): void {
    this.visemes = v;
    this.metrics = computeMetrics(v);
    const blinkScale = this.showEyes
      ? this.currentBlinkScale(performance.now())
      : 1;
    const EPS = 0.005;
    if (
      Math.abs(this.metrics.width - this.lastDrawnWidth) < EPS &&
      Math.abs(this.metrics.openHeight - this.lastDrawnOpenHeight) < EPS &&
      Math.abs(blinkScale - this.lastDrawnBlinkScale) < EPS
    ) {
      return;
    }
    this.lastDrawnWidth = this.metrics.width;
    this.lastDrawnOpenHeight = this.metrics.openHeight;
    this.lastDrawnBlinkScale = blinkScale;
    this.drawMouth(blinkScale);
    this.texture.needsUpdate = true;
  }

  /** Free the texture, geometry, and material. */
  dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  private drawMouth(blinkScale: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const m = this.metrics;
    const cx = w / 2;
    // Mouth sits slightly below canvas centre so eyes have room above
    // it; if eyes are off, keep the mouth dead-centre.
    const mouthY = this.showEyes ? h * 0.6 : h * 0.5;
    const halfW = w * 0.22 * m.width;
    // Small base height so the closed mouth is a thin line, growing
    // into an oval as the speaker opens up.
    const halfH = h * 0.012 + h * 0.13 * m.openHeight;

    ctx.fillStyle = '#1a0808';
    ctx.beginPath();
    ctx.ellipse(cx, mouthY, halfW, halfH, 0, 0, Math.PI * 2);
    ctx.fill();

    if (this.showEyes) {
      // Two static dark eye dots above the mouth so the host head sphere
      // reads as a face. Eyes occasionally blink (eyelid squish on the
      // Y axis) at a random interval; otherwise they're fixed so they
      // don't compete with the mouth's motion signal.
      const eyeY = h * 0.36;
      const eyeOffset = w * 0.16;
      const eyeR = w * 0.07;
      for (const ex of [cx - eyeOffset, cx + eyeOffset]) {
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, eyeR, eyeR * blinkScale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * Returns the vertical scale (0..1) for the eyes at the given wall
   * clock time. 1 = fully open; near 0 = mid-blink. Also advances the
   * blink schedule as a side effect (starts a new blink when due).
   *
   * Exposed (`private` in TS but exported for testing via `__test_*`
   * helpers in the test file) for deterministic time-injection tests.
   */
  private currentBlinkScale(now: number): number {
    const t = (now - this.blinkStartAt) / StylizedMouth.BLINK_MS;
    if (t >= 0 && t < 1) {
      // Triangle wave 0..1..0 across the blink; scale 1 - 0.95 * tri
      // means eyelid drops to ~5% open at midpoint, never fully zero so
      // the eye doesn't visually disappear.
      const tri = 4 * t * (1 - t);
      return 1 - 0.95 * tri;
    }
    if (now >= this.nextBlinkAt) {
      this.blinkStartAt = now;
      // Random interval between blinks: 2.5–6.5 seconds, in the
      // ballpark of natural human blink rate (15–20 per minute).
      this.nextBlinkAt = now + 2500 + Math.random() * 4000;
    }
    return 1;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function computeMetrics(v: VisemeWeights): LipMetrics {
  const openHeight = clamp(v.jawOpen * 0.9 + v.aa * 0.5 + v.oh * 0.5, 0, 1);
  const width = clamp(1 + v.ee * 0.45 - v.oo * 0.55 - v.oh * 0.2, 0.35, 1.4);
  return {width, openHeight};
}
