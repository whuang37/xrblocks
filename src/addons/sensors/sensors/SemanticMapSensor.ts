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

    const refs: VisibleObjectReference[] = [];
    let labelCounter = 1;

    for (const {object, distance} of visibleObjects) {
      const label = labelCounter.toString();
      const textLabel =
        (object as {text?: string}).text || object.name || object.type;
      const description = `[${label}]: ${object.type} '${textLabel}' ${distance.toFixed(2)}m away`;

      refs.push({
        label,
        objectId: object.id,
        name: object.name || `${object.type}_${object.id}`,
        type: object.type,
        distanceToCamera: distance,
        description,
      });

      labelCounter++;
    }

    return refs;
  }
}
