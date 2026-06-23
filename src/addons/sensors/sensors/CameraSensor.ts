import * as THREE from 'three';
import {Sensor, type SensorContext, type SensorsOptions} from '../SensorsTypes';
import {VisibilitySensor, type VisibilityItem} from './VisibilitySensor';

export type UserViewOverlayMode = boolean;

export type DeviceCameraViewSensorOptions = SensorsOptions & {
  mimeType?: string;
  quality?: number;
  width?: number;
  height?: number;
};

export class DeviceCameraViewSensor extends Sensor<string> {
  static readonly optionKeys = ['mimeType', 'quality', 'width', 'height'];
  readonly key: string = 'deviceCameraView';

  constructor(options: DeviceCameraViewSensorOptions = {}) {
    super({updateMode: 'background', ...options});
  }

  async update(context: SensorContext): Promise<string> {
    const {core} = context;
    const deviceCamera = core.deviceCamera;
    if (!deviceCamera?.loaded) {
      throw new Error(
        'DeviceCameraViewSensor requires an initialized XRDeviceCamera.'
      );
    }

    const options = this.options as DeviceCameraViewSensorOptions;
    const snapshot = await deviceCamera.getSnapshot({
      outputFormat: 'base64',
      mimeType: options.mimeType ?? 'image/jpeg',
      quality: options.quality ?? 0.8,
      ...(options.width ? {width: options.width} : {}),
      ...(options.height ? {height: options.height} : {}),
    });
    if (!snapshot) {
      throw new Error('DeviceCameraViewSensor failed to capture a frame.');
    }
    return snapshot;
  }
}

export class UserViewSensor extends Sensor<string> {
  static readonly optionKeys = ['overlayOnCamera'];
  readonly key: string = 'userView';

  constructor(
    options: SensorsOptions & {overlayOnCamera?: UserViewOverlayMode} = {}
  ) {
    super({updateMode: 'background', overlayOnCamera: true, ...options});
  }

  async update(context: SensorContext): Promise<string> {
    const {core} = context;
    const synth = core.screenshotSynthesizer;
    if (synth) {
      return (await synth.getScreenshot(this.resolveOverlayOnCamera())) || '';
    }
    return '';
  }

  private resolveOverlayOnCamera(): boolean {
    const mode =
      (this.options as {overlayOnCamera?: UserViewOverlayMode})
        ?.overlayOnCamera ?? true;
    return mode;
  }
}

export class SOMViewSensor extends Sensor<string> {
  readonly key: string = 'somView';

  constructor(options?: SensorsOptions) {
    super({updateMode: 'background', ...options});
  }

  async update(context: SensorContext): Promise<string> {
    const {camera} = context;

    const projectionMatrix = camera.projectionMatrix.clone();
    const matrixWorldInverse = camera.matrixWorldInverse.clone();

    const [userView, visibleObjects] = await Promise.all([
      context.get(UserViewSensor, {updateMode: 'sync'}) as Promise<string>,
      context.get(VisibilitySensor, {updateMode: 'sync'}) as Promise<
        VisibilityItem[]
      >,
    ]);

    if (!userView || !visibleObjects) return userView || '';

    return renderAnnotatedScreenshot(
      projectionMatrix,
      matrixWorldInverse,
      userView,
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
