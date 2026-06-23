import {DetectedObject} from 'xrblocks';
import {Sensor, type SensorContext} from '../SensorsTypes';

export class WorldObjectsSensor extends Sensor<DetectedObject<unknown>[]> {
  readonly key = 'worldObjects';

  async update(context: SensorContext): Promise<DetectedObject<unknown>[]> {
    return (await context.core.world.objects?.runDetection()) ?? [];
  }
}
