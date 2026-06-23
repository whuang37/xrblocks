import {Sensor, type SensorContext, type SensorsOptions} from '../SensorsTypes';
import {
  createVisibleObjectReferences,
  type VisualObjectReference,
} from '../utils/VisualObjectResolver';

export type VisibilityItem = VisualObjectReference;

export class VisibilitySensor extends Sensor<VisibilityItem[]> {
  static readonly optionKeys = ['verifyLineOfSight'];
  readonly key = 'visibility';

  constructor(options?: SensorsOptions) {
    super(options);
  }

  update(context: SensorContext): VisibilityItem[] {
    const {core} = context;
    const camera = core.camera;
    const scene = core.scene;

    if (!camera || !scene) {
      return [];
    }

    const verifyLineOfSight =
      (this.options as {verifyLineOfSight?: boolean})?.verifyLineOfSight !==
      false;

    return createVisibleObjectReferences({
      scene,
      camera,
      verifyLineOfSight,
    });
  }
}
