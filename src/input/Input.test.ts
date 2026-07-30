import * as THREE from 'three';
import {describe, expect, it, vi} from 'vitest';

import {Options} from '../core/Options';
import {XRSystems} from '../core/components/XRSystems';
import {Input} from './Input';
import {Controller} from './Controller';

describe('Input head gestures', () => {
  it('creates head gestures without enabling controllers', () => {
    const input = new Input();
    const options = new Options().enableHeadGestures();
    options.controllers.enabled = false;
    const systemsGroup = new XRSystems();

    input.init({
      scene: new THREE.Scene(),
      systemsGroup,
      options,
      renderer: {} as THREE.WebGLRenderer,
    });

    expect(input.controllers).toHaveLength(0);
    expect(input.headGestures).toBeDefined();
    expect(systemsGroup.children).toContain(input.headGestures);
  });

  it('leaves the optional child undefined when disabled', () => {
    const input = new Input();
    const options = new Options();
    options.controllers.enabled = false;

    input.init({
      scene: new THREE.Scene(),
      systemsGroup: new XRSystems(),
      options,
      renderer: {} as THREE.WebGLRenderer,
    });

    expect(input.headGestures).toBeUndefined();
  });
});

describe('Input direct touch', () => {
  it('reports contact, selection, and the wrist through one frame input', () => {
    const input = new Input();
    const controller = new THREE.Object3D() as Controller;
    controller.userData.selected = true;
    const indexTip = new THREE.Object3D();
    const wrist = new THREE.Object3D();
    input.controllers = [controller];
    input.hands = [
      {
        joints: {'index-finger-tip': indexTip, wrist},
      } as unknown as THREE.XRHandSpace,
    ];
    input.controllersEnabled = false;

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    input.scene = new THREE.Scene();
    input.scene.add(mesh);
    input.scene.updateMatrixWorld(true);

    input.update();

    const frame = input.getInteractionFrame();

    expect(frame.directTouches).toHaveLength(1);
    expect(frame.directTouches[0]).toMatchObject({
      controller,
      handIndex: 0,
      hand: wrist,
      selected: true,
    });
    expect(frame.directTouches[0].intersections[0].object).toBe(mesh);
  });
});

describe('Input events', () => {
  it('dispatches selectend and resets selected state upon disconnection', () => {
    const input = new Input();
    const mockController = new THREE.Object3D() as unknown as Controller;
    mockController.userData = {connected: true, selected: true};

    const selectEndSpy = vi.fn();
    input.bindListener('selectend', selectEndSpy);
    input.controllers.push(mockController);

    input.defaultOnDisconnected({
      type: 'disconnected',
      target: mockController,
    });

    expect(mockController.userData.selected).toBe(false);
    expect(selectEndSpy).toHaveBeenCalledTimes(1);
    expect(selectEndSpy.mock.calls[0][0]).toMatchObject({
      type: 'selectend',
      target: mockController,
    });
  });

  it('removes event listeners from controllers on dispose', () => {
    const input = new Input();
    const mockController = new THREE.Object3D() as unknown as Controller;
    mockController.userData = {connected: true};

    const addSpy = vi.spyOn(mockController, 'addEventListener');
    const removeSpy = vi.spyOn(mockController, 'removeEventListener');

    input.controllers.push(mockController);
    input.bindListener('selectstart', vi.fn());

    expect(addSpy).toHaveBeenCalled();
    const listenerAdded = addSpy.mock.calls[0][1];

    input.dispose();

    expect(removeSpy).toHaveBeenCalledWith('selectstart', listenerAdded);
  });
});
