import * as THREE from 'three';
import {Core, Input, Script, Simulator} from 'xrblocks';
import {
  EmbodiedControl,
  type EmbodiedControlOptions,
  type EmbodiedControlStep,
  type EmbodiedControlStepResult,
} from '../embodied-control';

import {
  WebSocketRemoteControlTransport,
  type WebSocketRemoteControlTransportOptions,
} from './WebSocketRemoteControlTransport';

export type RemoteControlOptions = WebSocketRemoteControlTransportOptions & {
  embodiedControl?: EmbodiedControl;
  embodiedOptions?: EmbodiedControlOptions;
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
  transport?: WebSocketRemoteControlTransport;

  constructor(private options: RemoteControlOptions = {}) {
    super();
    this.embodiedControl =
      options.embodiedControl ?? new EmbodiedControl(options.embodiedOptions);
  }

  init(dependencies: {
    core: Core;
    simulator: Simulator;
    input: Input;
    camera: THREE.Camera;
  }) {
    if (!this.embodiedControl.executor) {
      this.embodiedControl.init(dependencies);
    }

    this.transport = new WebSocketRemoteControlTransport(
      {
        url: this.options.url,
        reconnect: this.options.reconnect,
        reconnectDelayMs: this.options.reconnectDelayMs,
      },
      (step) => this.step(step)
    );
    this.transport.connect();
  }

  dispose() {
    this.transport?.disconnect();
  }

  step(step: EmbodiedControlStep): Promise<EmbodiedControlStepResult> {
    return this.embodiedControl.step(step);
  }
}
