import * as THREE from 'three';
import {Sensor, type SensorContext, type SensorsOptions} from '../SensorsTypes';
import {VisibilitySensor, type VisibilityItem} from './VisibilitySensor';

export type ScreenshotXROverlayMode = boolean | 'auto';

export class ScreenshotCameraSensor extends Sensor<string> {
  readonly key = 'screenshotCamera';

  constructor(options: SensorsOptions = {}) {
    // Default to background update mode for slow screenshot captures
    super({updateMode: 'background', ...options});
  }

  async update(context: SensorContext): Promise<string> {
    const {core} = context;
    const deviceCamera = core.deviceCamera;
    if (!deviceCamera?.loaded) {
      throw new Error(
        'ScreenshotCameraSensor requires an initialized XRDeviceCamera.'
      );
    }
    return (
      (await deviceCamera.getSnapshot({
        outputFormat: 'base64',
        cacheWindowMs: 0.0,
      })) || ''
    );
  }
}

export class ScreenshotXRSensor extends Sensor<string> {
  readonly key = 'screenshotXR';

  constructor(
    options: SensorsOptions & {overlayOnCamera?: ScreenshotXROverlayMode} = {}
  ) {
    super({updateMode: 'background', overlayOnCamera: 'auto', ...options});
  }

  async update(context: SensorContext): Promise<string> {
    const {core} = context;
    const synth = core.screenshotSynthesizer;
    if (synth) {
      return (
        (await synth.getScreenshot(this.resolveOverlayOnCamera(core))) || ''
      );
    }
    return '';
  }

  private resolveOverlayOnCamera(core: SensorContext['core']): boolean {
    const mode =
      (this.options as {overlayOnCamera?: ScreenshotXROverlayMode})
        ?.overlayOnCamera ?? 'auto';
    if (mode !== 'auto') return mode;
    return !!core.deviceCamera?.loaded;
  }
}

export class ScreenshotSOMSensor extends Sensor<string> {
  readonly key = 'screenshotSOM';

  constructor(
    private deps: {
      xr?: ScreenshotXRSensor;
      visibility?: VisibilitySensor;
    } = {},
    options?: SensorsOptions
  ) {
    super({updateMode: 'background', ...options});
  }

  async update(context: SensorContext): Promise<string> {
    const {camera} = context;

    // Freeze camera matrices synchronously at the start of the frame tick to prevent temporal drift
    const projectionMatrix = camera.projectionMatrix.clone();
    const matrixWorldInverse = camera.matrixWorldInverse.clone();

    // Fetch dependencies concurrently
    const xrSensor = this.deps.xr ?? ScreenshotXRSensor;
    const visibilitySensor = this.deps.visibility ?? VisibilitySensor;

    const [xr, visibleObjects] = await Promise.all([
      context.get(xrSensor, {updateMode: 'sync'}) as Promise<string>,
      context.get(visibilitySensor, {updateMode: 'sync'}) as Promise<
        VisibilityItem[]
      >,
    ]);

    if (!xr || !visibleObjects) return xr || '';

    // Render the annotated screenshot using the frozen camera matrices
    return renderAnnotatedScreenshot(
      projectionMatrix,
      matrixWorldInverse,
      xr,
      visibleObjects
    );
  }
}

async function renderAnnotatedScreenshot(
  projectionMatrix: THREE.Matrix4,
  matrixWorldInverse: THREE.Matrix4,
  rawScreenshot: string,
  visibleObjects: VisibilityItem[]
): Promise<string> {
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
    // Project using frozen matrices
    const screenPos = worldPosition
      .clone()
      .applyMatrix4(matrixWorldInverse)
      .applyMatrix4(projectionMatrix);

    const x = ((screenPos.x + 1) * canvas.width) / 2;
    const y = ((-screenPos.y + 1) * canvas.height) / 2;

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
