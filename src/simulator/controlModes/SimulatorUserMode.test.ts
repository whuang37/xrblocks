import * as THREE from 'three';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {Input} from '../../input/Input';
import {MouseController} from '../../input/MouseController';
import {Interaction} from '../../interaction/Interaction';
import {SimulatorControllerState} from '../SimulatorControllerState';
import {SimulatorHands} from '../SimulatorHands';
import {SimulatorNavMesh} from '../scene/SimulatorNavMesh';
import {SimulatorUserMode} from './SimulatorUserMode';

describe('SimulatorUserMode wheel scaling', () => {
  let canvas: HTMLCanvasElement;
  let input: Input;
  let interaction: Interaction;
  let mode: SimulatorUserMode;
  let mouseController: MouseController;
  let applyScaleIntent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    mouseController = {
      updateMousePositionFromEvent: vi.fn(),
      userData: {connected: true},
    } as unknown as MouseController;
    input = {
      gamepadController: {init: vi.fn()},
      mouseController,
      updateController: vi.fn(),
    } as unknown as Input;
    applyScaleIntent = vi.fn().mockReturnValue(true);
    interaction = {applyScaleIntent} as unknown as Interaction;
    mode = new SimulatorUserMode(
      {} as SimulatorControllerState,
      new Set(),
      {} as SimulatorHands,
      new SimulatorNavMesh(),
      vi.fn(),
      vi.fn()
    );
    mode.init({
      camera: new THREE.Camera(),
      input,
      interaction,
      timer: new THREE.Timer(),
      domElement: canvas,
    });
  });

  it('routes wheel scaling through Interaction', () => {
    const event = new WheelEvent('wheel', {deltaY: -100});

    expect(mode.onWheel(event)).toBe(true);

    expect(applyScaleIntent).toHaveBeenCalledWith(
      mouseController,
      Math.exp(0.1)
    );
    expect(mouseController.updateMousePositionFromEvent).toHaveBeenCalledWith(
      event
    );
    expect(input.updateController).toHaveBeenCalledWith(mouseController);
  });

  it('returns false when Interaction rejects the intent', () => {
    applyScaleIntent.mockReturnValue(false);

    expect(mode.onWheel(new WheelEvent('wheel', {deltaY: 100}))).toBe(false);
  });

  it('normalizes line-based wheel deltas', () => {
    mode.onWheel(
      new WheelEvent('wheel', {
        deltaY: -3,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
      })
    );

    expect(applyScaleIntent).toHaveBeenCalledWith(
      mouseController,
      Math.exp(0.048)
    );
  });

  it('normalizes page-based wheel deltas using the canvas height', () => {
    Object.defineProperty(canvas, 'clientHeight', {
      configurable: true,
      value: 600,
    });

    mode.onWheel(
      new WheelEvent('wheel', {
        deltaY: -1,
        deltaMode: WheelEvent.DOM_DELTA_PAGE,
      })
    );

    expect(applyScaleIntent).toHaveBeenCalledWith(
      mouseController,
      Math.exp(0.6)
    );
  });
});
