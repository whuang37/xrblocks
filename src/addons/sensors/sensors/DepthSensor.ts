import {Sensor, type SensorContext, type SensorsOptions} from '../SensorsTypes';

export class DepthSensor extends Sensor<number[][]> {
  readonly key = 'depth';

  constructor(options: SensorsOptions = {}) {
    super(options);
  }

  update(context: SensorContext): number[][] {
    const {core} = context;
    const depthSubsystem = core.depth;

    if (
      depthSubsystem &&
      depthSubsystem.enabled &&
      depthSubsystem.rawValueToMeters > 0 &&
      depthSubsystem.depthArray[0]
    ) {
      const width = depthSubsystem.width;
      const height = depthSubsystem.height;
      const rawArray = depthSubsystem.depthArray[0];
      const scale = depthSubsystem.rawValueToMeters;
      const depthGrid: number[][] = [];

      for (let y = 0; y < height; y++) {
        const row: number[] = [];
        for (let x = 0; x < width; x++) {
          row.push(rawArray[y * width + x] * scale);
        }
        depthGrid.push(row);
      }
      return depthGrid;
    }

    console.warn('DepthSensor requires enabled depth data.');
    return [];
  }
}
