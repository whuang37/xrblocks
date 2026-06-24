import * as THREE from 'three';
import {Core, Input, Script, Simulator} from 'xrblocks';
import {
  EmbodiedControl,
  type EmbodiedControlOptions,
} from '../embodied-control';
import {
  SensorsManager,
  type SensorsOptions,
  type SensorRequest,
  ProprioceptionSensor,
  SceneGraphSensor,
  TargetingSensor,
  DepthSensor,
  VisibilitySensor,
  DeviceCameraViewSensor,
  UserViewSensor,
  SOMViewSensor,
} from '../sensors';

function getSensorsForKeys(
  keys?: string[],
  options?: SensorsOptions
): Record<string, SensorRequest<unknown>> {
  if (!keys || keys.length === 0) {
    return {state: ProprioceptionSensor};
  }
  const sensors: Record<string, SensorRequest<unknown>> = {};
  for (const key of keys) {
    switch (key) {
      case 'state':
        sensors.state = ProprioceptionSensor;
        break;
      case 'sceneGraph':
        sensors.sceneGraph = SceneGraphSensor;
        break;
      case 'targeting':
        sensors.targeting = TargetingSensor;
        break;
      case 'depth':
        sensors.depth = DepthSensor;
        break;
      case 'deviceCameraView':
        sensors.deviceCameraView = DeviceCameraViewSensor;
        break;
      case 'userView':
        sensors.userView = UserViewSensor;
        break;
      case 'somView':
        sensors.somView = [
          SOMViewSensor,
          {verifyLineOfSight: options?.verifyLineOfSight as boolean},
        ];
        break;
      case 'visibleObjects':
        sensors.visibleObjects = [
          VisibilitySensor,
          {verifyLineOfSight: options?.verifyLineOfSight as boolean},
        ];
        break;
    }
  }
  return sensors;
}

import {
  WebSocketRemoteControlTransport,
  type WebSocketRemoteControlTransportOptions,
} from './WebSocketRemoteControlTransport';
import {
  type RemoteControlMessage,
  type RemoteControlStepResult,
} from './RemoteControlProtocol';

export type RemoteControlOptions = WebSocketRemoteControlTransportOptions & {
  embodiedControl?: EmbodiedControl;
  embodiedOptions?: EmbodiedControlOptions;
  sensors?: SensorsManager;
  sensorsOptions?: SensorsOptions;
};

export class RemoteControl extends Script {
  static dependencies = {
    core: Core,
    simulator: Simulator,
    input: Input,
    camera: THREE.Camera,
  };

  editorIcon = 'settings_remote';
  embodiedControl: EmbodiedControl;
  sensors: SensorsManager;
  transport?: WebSocketRemoteControlTransport;

  dependencies!: {
    core: Core;
    simulator: Simulator;
    input: Input;
    camera: THREE.Camera;
  };

  constructor(private options: RemoteControlOptions = {}) {
    super();
    this.embodiedControl =
      options.embodiedControl ?? new EmbodiedControl(options.embodiedOptions);
    this.sensors =
      options.sensors ?? new SensorsManager(undefined, options.sensorsOptions);
  }

  init(dependencies: {
    core: Core;
    simulator: Simulator;
    input: Input;
    camera: THREE.Camera;
  }) {
    this.dependencies = dependencies;

    // Initialize EmbodiedControl
    if (!this.embodiedControl.executor) {
      this.embodiedControl.init(dependencies);
      dependencies.core.registry.register(
        this.embodiedControl,
        EmbodiedControl
      );
      dependencies.core.scene.add(this.embodiedControl);
    }

    // Initialize Sensors (and register as core singleton)
    const registrySensors = dependencies.core.registry.get(
      SensorsManager
    ) as SensorsManager;
    if (!registrySensors) {
      this.sensors.init(dependencies);
      dependencies.core.registry.register(this.sensors, SensorsManager);
      dependencies.core.scene.add(this.sensors);
    } else {
      this.sensors = registrySensors;
    }

    // Connect transport
    this.transport = new WebSocketRemoteControlTransport(
      {
        url: this.options.url,
        reconnect: this.options.reconnect,
        reconnectDelayMs: this.options.reconnectDelayMs,
      },
      (cmd) => this.handleCommand(cmd)
    );
    this.transport.connect();
  }

  private isRecording = false;
  private localHistory: {
    timestamp: number;
    values: Record<string, unknown>;
  }[] = [];
  private recordingSensors: Record<string, SensorRequest<unknown>> = {};

  override update(time: number) {
    if (this.isRecording && Object.keys(this.recordingSensors).length > 0) {
      // Capture the sensors on this frame tick asynchronously and buffer the results
      // (forcing 'sync' updateMode to guarantee that every history frame is perfectly aligned)
      this.sensors
        .tryCaptureAll(this.recordingSensors, {updateMode: 'sync'})
        .then(({values}) => {
          this.localHistory.push({
            timestamp: time,
            values,
          });
        });
    }
  }

  dispose() {
    this.transport?.disconnect();
  }

  async handleCommand(
    message: RemoteControlMessage
  ): Promise<RemoteControlStepResult> {
    const sensorOpts = message.sensors;

    // Start recording telemetry locally
    if (sensorOpts?.recordHistory) {
      this.localHistory = [];
      this.recordingSensors = getSensorsForKeys(
        sensorOpts.keys,
        sensorOpts.options
      );
      this.isRecording = true;
    }

    // Execute the command
    let elapsedMs = 0;
    switch (message.type) {
      case 'STEP': {
        const res = await this.embodiedControl.step(message);
        elapsedMs = res.elapsedMs;
        break;
      }
      case 'TELEPORT_TO': {
        const target = this.resolveTarget(message.target);
        const res = await this.embodiedControl.teleportTo(
          target,
          message.options
        );
        elapsedMs = res.elapsedMs;
        break;
      }
      case 'LOOK_AT_TARGET': {
        const target = this.resolveTarget(message.target);
        const res = await this.embodiedControl.lookAtTarget(
          target,
          message.options
        );
        elapsedMs = res.elapsedMs;
        break;
      }
      case 'POINT_TO': {
        const target = this.resolveTarget(message.target);
        const res = await this.embodiedControl.pointTo(
          message.handIndex,
          target,
          message.options
        );
        elapsedMs = res.elapsedMs;
        break;
      }
      case 'REACH_TO': {
        const target = this.resolveTarget(message.target);
        const res = await this.embodiedControl.reachTo(
          message.handIndex,
          target,
          message.options
        );
        elapsedMs = res.elapsedMs;
        break;
      }
      case 'CLICK': {
        const res = await this.embodiedControl.click(
          message.handIndex,
          message.options
        );
        elapsedMs = res.elapsedMs;
        break;
      }
      default:
        throw new Error(
          `Unsupported command type: ${(message as {type: string}).type}`
        );
    }

    // Stop recording telemetry and map the local history buffer
    let history = undefined;
    if (sensorOpts?.recordHistory) {
      this.isRecording = false;
      history = this.localHistory.map((rec) => {
        return {
          timestamp: rec.timestamp,
          ...rec.values,
        };
      });
      this.localHistory = [];
    }

    // Capture final observation (forcing 'sync' updateMode for absolute temporal alignment)
    const targetSensors = getSensorsForKeys(
      sensorOpts?.keys,
      sensorOpts?.options
    );
    const {values} = await this.sensors.tryCaptureAll(targetSensors, {
      ...sensorOpts?.options,
      updateMode: 'sync',
    });

    const observation: Record<string, unknown> = {};
    Object.assign(observation, values);

    if (history) {
      observation.history = history;
    }

    return {
      id: message.id,
      elapsedMs,
      observation,
    };
  }

  private resolveTarget(
    target: [number, number, number] | string
  ): THREE.Vector3 | THREE.Object3D {
    if (typeof target === 'string') {
      const obj = this.dependencies.core.scene.getObjectByName(target);
      if (!obj) {
        throw new Error(`Object target not found in scene: ${target}`);
      }
      return obj;
    }
    return new THREE.Vector3().fromArray(target);
  }
}
