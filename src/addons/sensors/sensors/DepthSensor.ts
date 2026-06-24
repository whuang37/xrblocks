import {Sensor, type SensorContext, type SensorsOptions} from '../SensorsTypes';

export type DepthSensorData = Float32Array | Uint16Array;

export interface DepthSensorViewSnapshot {
  viewId: number;
  width: number;
  height: number;
  data: DepthSensorData;
  rawValueToMeters: number;
  depthDataFormat?: XRDepthDataFormat;
  source: 'cpu' | 'gpu';
  projectionMatrix: number[];
  projectionInverseMatrix: number[];
  viewMatrix: number[];
  viewProjectionMatrix: number[];
  normDepthBufferFromNormView: number[];
  cameraPosition: [number, number, number];
  cameraQuaternion: [number, number, number, number];
}

export interface DepthSensorSnapshot {
  views: DepthSensorViewSnapshot[];
}

export class DepthSensor extends Sensor<DepthSensorSnapshot> {
  readonly key = 'depth';

  constructor(options: SensorsOptions = {}) {
    super(options);
  }

  update(context: SensorContext): DepthSensorSnapshot {
    const {core} = context;
    const depthSubsystem = core.depth;

    if (
      depthSubsystem &&
      depthSubsystem.enabled &&
      depthSubsystem.rawValueToMeters > 0 &&
      depthSubsystem.depthArray[0]
    ) {
      const views: DepthSensorViewSnapshot[] = [];

      for (let viewId = 0; viewId < depthSubsystem.depthArray.length; viewId++) {
        const data = depthSubsystem.depthArray[viewId];
        if (!data) {
          continue;
        }

        views.push({
          viewId,
          width: depthSubsystem.width,
          height: depthSubsystem.height,
          data,
          rawValueToMeters: depthSubsystem.rawValueToMeters,
          depthDataFormat: depthSubsystem.depthDataFormat,
          source: depthSubsystem.gpuDepthData[viewId] ? 'gpu' : 'cpu',
          projectionMatrix:
            depthSubsystem.depthProjectionMatrices[viewId]?.toArray() ?? [],
          projectionInverseMatrix:
            depthSubsystem.depthProjectionInverseMatrices[viewId]?.toArray() ??
            [],
          viewMatrix: depthSubsystem.depthViewMatrices[viewId]?.toArray() ?? [],
          viewProjectionMatrix:
            depthSubsystem.depthViewProjectionMatrices[viewId]?.toArray() ?? [],
          normDepthBufferFromNormView:
            depthSubsystem.normDepthBufferFromNormViewMatrices[
              viewId
            ]?.toArray() ?? [],
          cameraPosition: (depthSubsystem.depthCameraPositions[
            viewId
          ]?.toArray() as [number, number, number]) ?? [0, 0, 0],
          cameraQuaternion: (depthSubsystem.depthCameraRotations[
            viewId
          ]?.toArray() as [number, number, number, number]) ?? [0, 0, 0, 1],
        });
      }

      return {
        views,
      };
    }

    console.warn('DepthSensor requires enabled depth data.');
    return {views: []};
  }
}
