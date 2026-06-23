import {
  Sensor,
  type VisibleObjectReference,
  type SensorContext,
  type SensorsOptions,
} from '../SensorsTypes';
import {VisibilitySensor, type VisibilityItem} from './VisibilitySensor';

export class SemanticMapSensor extends Sensor<VisibleObjectReference[]> {
  readonly key = 'visibleObjects';

  constructor(options?: SensorsOptions) {
    super(options);
  }

  async update(context: SensorContext): Promise<VisibleObjectReference[]> {
    const visibleObjects = (await context.get(
      VisibilitySensor
    )) as VisibilityItem[];

    if (!visibleObjects) return [];

    return visibleObjects.map(
      ({
        label,
        objectId,
        object,
        name,
        type,
        distanceToCamera,
        description,
      }) => ({
        label,
        objectId,
        name,
        type: type || object.type,
        distanceToCamera,
        description,
      })
    );
  }
}
