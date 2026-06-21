import * as THREE from 'three';
import {Core, Input, Script, Simulator} from 'xrblocks';
import {
  EmbodiedControl,
  type EmbodiedControlOptions,
} from '../embodied-control';
import {Sensors, type SensorsOptions} from '../sensors';

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
  sensors?: Sensors;
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
  sensors: Sensors;
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
    this.sensors = options.sensors ?? new Sensors(options.sensorsOptions);
  }

  init(dependencies: {
    core: Core;
    simulator: Simulator;
    input: Input;
    camera: THREE.Camera;
  }) {
    this.dependencies = dependencies;

    // 1. Initialize EmbodiedControl
    if (!this.embodiedControl.executor) {
      this.embodiedControl.init(dependencies);
      dependencies.core.registry.register(this.embodiedControl, EmbodiedControl);
      dependencies.core.scene.add(this.embodiedControl);
    }

    // 2. Initialize Sensors (and register as core singleton)
    const registrySensors = dependencies.core.registry.get(Sensors) as Sensors;
    if (!registrySensors) {
      this.sensors.init(dependencies);
      dependencies.core.registry.register(this.sensors, Sensors);
      dependencies.core.scene.add(this.sensors);
    } else {
      this.sensors = registrySensors;
    }

    // 3. Connect transport
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

  dispose() {
    this.transport?.disconnect();
  }

  async handleCommand(
    message: RemoteControlMessage
  ): Promise<RemoteControlStepResult> {
    const sensorOpts = message.sensors;

    // A. Start recording telemetry
    if (sensorOpts?.recordHistory) {
      this.sensors.startRecording(sensorOpts);
    }

    // B. Actuate the command
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

    // C. Stop recording telemetry
    let history = undefined;
    if (sensorOpts?.recordHistory) {
      history = this.sensors.stopRecording();
    }

    // D. Capture final observation
    const observation = await this.sensors.captureObservation(sensorOpts);
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
