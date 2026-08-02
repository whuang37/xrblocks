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
});

describe('Input direct touch', () => {
  it('reports the contact point, selection, and wrist without scanning the scene', () => {
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

    input.scene = new THREE.Scene();
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
    expect(frame.directTouches[0].point.toArray()).toEqual([0, 0, 0]);
    expect(frame.directTouches[0]).not.toHaveProperty('intersections');
  });
});

describe('Input raycast modes', () => {
  function setupRayInput(mode: 'continuous' | 'select') {
    const input = new Input();
    const controller = new THREE.Object3D() as Controller;
    controller.userData.connected = true;
    const target = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial()
    );
    target.position.z = -2;
    const scene = new THREE.Scene();
    scene.add(target);
    scene.updateMatrixWorld(true);

    input.options = new Options();
    input.options.interaction.raycastMode = mode;
    input.scene = scene;
    input.controllers = [controller];

    return {input, controller, target};
  }

  it('applies continuous, select/release, and gaze raycast policy', () => {
    const continuous = setupRayInput('continuous');
    continuous.input.update();
    const continuousIntersections =
      continuous.input.getInteractionFrame().raySources[0].intersections;
    expect(continuousIntersections.length).toBeGreaterThan(0);
    expect(
      continuousIntersections.every(({object}) => object === continuous.target)
    ).toBe(true);

    const {input, controller} = setupRayInput('select');

    input.update();
    expect(
      input.getInteractionFrame().raySources[0].intersections
    ).toHaveLength(0);

    controller.userData.selected = true;
    input.update();
    expect(
      input.getInteractionFrame().raySources[0].intersections.length
    ).toBeGreaterThan(0);

    controller.userData.selected = false;
    input.update();
    expect(
      input.getInteractionFrame().raySources[0].intersections.length
    ).toBeGreaterThan(0);

    input.update();
    expect(
      input.getInteractionFrame().raySources[0].intersections
    ).toHaveLength(0);

    const gazeInput = new Input();
    const camera = new THREE.PerspectiveCamera();
    const target = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial()
    );
    target.position.z = -2;
    const scene = new THREE.Scene();
    scene.add(target);
    scene.updateMatrixWorld(true);

    gazeInput.options = new Options();
    gazeInput.options.interaction.raycastMode = 'select';
    gazeInput.scene = scene;
    gazeInput.gazeController.camera = camera;
    gazeInput.gazeController.userData.connected = true;
    gazeInput.controllers = [gazeInput.gazeController];
    gazeInput.update();

    expect(
      gazeInput.getInteractionFrame().raySources[0].intersections.length
    ).toBeGreaterThan(0);
  });
});

describe('Input events', () => {
  it('reports disconnection and stops forwarding controller events after dispose', () => {
    const input = new Input();
    const mockController = new THREE.Object3D() as unknown as Controller;
    mockController.userData = {connected: true, selected: true};

    const selectEndSpy = vi.fn();
    input.controllers.push(mockController);
    input.bindListener('selectend', selectEndSpy);

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

    input.dispose();

    mockController.dispatchEvent({
      type: 'selectend',
      target: mockController,
    });
    expect(selectEndSpy).toHaveBeenCalledOnce();
  });
});
