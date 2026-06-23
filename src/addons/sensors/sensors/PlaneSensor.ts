import {DetectedPlane} from 'xrblocks';
import {Sensor, type SensorContext} from '../SensorsTypes';

export class PlaneSensor extends Sensor<DetectedPlane[]> {
  readonly key = 'planes';

  update(context: SensorContext): DetectedPlane[] {
    return context.core.world.planes?.get() ?? [];
  }
}
