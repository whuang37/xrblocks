import * as THREE from 'three';
import {Sensor, type SensorContext, type SensorsOptions} from '../SensorsTypes';
import {VisibilitySensor, type VisibilityItem} from './VisibilitySensor';

export type XRCameraOverlayMode = boolean | 'auto';

export class DeviceCameraSensor extends Sensor<string> {
  readonly key: string = 'deviceCamera';

  constructor(options: SensorsOptions = {}) {
    super({updateMode: 'background', ...options});
  }

  async update(context: SensorContext): Promise<string> {
    const {core} = context;
    const deviceCamera = core.deviceCamera;
    if (!deviceCamera?.loaded) {
      if (this.options.strict) {
        throw new Error(
          'DeviceCameraSensor requires an initialized XRDeviceCamera.'
        );
      }
      return '';
    }
    return (
      (await deviceCamera.getSnapshot({
        outputFormat: 'base64',
      })) || ''
    );
  }
}

export class XRCameraSensor extends Sensor<string> {
  readonly key: string = 'xrCamera';

  constructor(
    options: SensorsOptions & {overlayOnCamera?: XRCameraOverlayMode} = {}
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
      (this.options as {overlayOnCamera?: XRCameraOverlayMode})
        ?.overlayOnCamera ?? 'auto';
    if (mode !== 'auto') return mode;
    return !!core.deviceCamera?.loaded;
  }
}

export class SOMCameraSensor extends Sensor<string> {
  readonly key: string = 'somCamera';

  constructor(
    private deps: {
      xr?: XRCameraSensor;
      visibility?: VisibilitySensor;
    } = {},
    options?: SensorsOptions
  ) {
    super({updateMode: 'background', ...options});
  }

  async update(context: SensorContext): Promise<string> {
    const {camera} = context;

    const projectionMatrix = camera.projectionMatrix.clone();
    const matrixWorldInverse = camera.matrixWorldInverse.clone();

    const xrSensor = this.deps.xr ?? XRCameraSensor;
    const visibilitySensor = this.deps.visibility ?? VisibilitySensor;

    const [xr, visibleObjects] = await Promise.all([
      context.get(xrSensor, {updateMode: 'sync'}) as Promise<string>,
      context.get(visibilitySensor, {updateMode: 'sync'}) as Promise<
        VisibilityItem[]
      >,
    ]);

    if (!xr || !visibleObjects) return xr || '';

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

  for (const item of visibleObjects) {
    const screenPos = item.worldPosition
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
    ctx.fillText(item.label, x, y);
  }

  return canvas.toDataURL('image/png');
}
