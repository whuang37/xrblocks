import * as THREE from 'three';
import {Core, Input, Script, Simulator} from 'xrblocks';

import {EmbodiedControlExecutor} from './EmbodiedControlExecutor';
import {
  DEFAULT_EMBODIED_CONTROL_OPTIONS,
  type EmbodiedControlOptions,
  type EmbodiedControlStep,
  type EmbodiedControlStepResult,
  type XRCompoundControl,
} from './EmbodiedControlTypes';

export class EmbodiedControl extends Script {
  static dependencies = {
    core: Core,
    simulator: Simulator,
    input: Input,
    camera: THREE.Camera,
  };

  editorIcon = 'sports_martial_arts';
  executor?: EmbodiedControlExecutor;
  private options: Required<EmbodiedControlOptions>;

  constructor(options: EmbodiedControlOptions = {}) {
    super();
    this.options = {
      ...DEFAULT_EMBODIED_CONTROL_OPTIONS,
      ...options,
    };
  }

  init(dependencies: {
    core: Core;
    simulator: Simulator;
    input: Input;
    camera: THREE.Camera;
  }) {
    this.executor = new EmbodiedControlExecutor(
      {
        ...dependencies,
        screenshotSynthesizer: dependencies.core.screenshotSynthesizer,
      },
      this.options
    );
    if (this.options.autoPause) {
      dependencies.core.pause();
    }
  }

  step(step: EmbodiedControlStep): Promise<EmbodiedControlStepResult> {
    if (!this.executor) {
      throw new Error('EmbodiedControl is not initialized.');
    }
    return this.executor.step(step);
  }

  applyControl(control: XRCompoundControl) {
    if (!this.executor) {
      throw new Error('EmbodiedControl is not initialized.');
    }
    this.executor.applyControl(control);
  }

  get busy() {
    return this.executor?.busy ?? false;
  }
}
