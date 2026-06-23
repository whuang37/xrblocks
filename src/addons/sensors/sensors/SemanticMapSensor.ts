import {
  Sensor,
  type VisibleObjectReference,
  type SensorContext,
  type SensorsOptions,
} from '../SensorsTypes';
import {VisibilitySensor, type VisibilityItem} from './VisibilitySensor';

export class SemanticMapSensor extends Sensor<VisibleObjectReference[]> {
  readonly key = 'visibleObjects';

  constructor(
    private deps: {
      visibility?: VisibilitySensor;
    } = {},
    options?: SensorsOptions
  ) {
    super(options);
  }

  async update(context: SensorContext): Promise<VisibleObjectReference[]> {
    const visibilitySensor = this.deps.visibility ?? VisibilitySensor;
    const visibleObjects = (await context.get(
      visibilitySensor
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
