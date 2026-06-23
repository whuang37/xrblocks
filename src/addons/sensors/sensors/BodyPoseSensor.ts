import {DetectedBodyPose} from 'xrblocks';
import {Sensor, type SensorContext} from '../SensorsTypes';

export class BodyPoseSensor extends Sensor<DetectedBodyPose[]> {
  readonly key = 'bodyPose';

  async update(context: SensorContext): Promise<DetectedBodyPose[]> {
    return (await context.core.world.humans?.runDetection()) ?? [];
  }
}
