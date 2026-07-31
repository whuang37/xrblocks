import * as THREE from 'three';
import {XRControllerModelFactory} from 'three/addons/webxr/XRControllerModelFactory.js';
import {XRHandModelFactory} from 'three/addons/webxr/XRHandModelFactory.js';

import {NUM_HANDS, UI_OVERLAY_LAYER} from '../constants';
import {Options} from '../core/Options.js';
import {KeyEvent} from '../core/Script';
import {Raycaster} from '../core/components/Raycaster';
import type {
  DirectTouchInput,
  InteractionFrameInput,
  RaySourceInput,
} from '../interaction/InteractionTypes.js';
import {Reticle} from '../interaction/reticle/Reticle.js';

import {ControllerRayVisual} from './components/ControllerRayVisual';
import type {
  Controller,
  ControllerEvent,
  ControllerEventMap,
} from './Controller';
import {GamepadController} from './GamepadController';
import {GazeController} from './GazeController';
import {HeadGestureRecognition} from './headGestures/HeadGestureRecognition';
import {MouseController} from './MouseController';
import {XRSystems} from '../core/components/XRSystems';
import {PinchFilter} from './PinchFilter';

export class ActiveControllers extends THREE.Group {
  type = 'ActiveControllers';
  name = 'Active Controllers';
}

export class Reticles extends THREE.Group {
  type = 'Reticles';
  name = 'Reticles';
}

// Reusable objects for performance.
const MATRIX4 = new THREE.Matrix4();
/**
 * The XRInput class holds all the controllers and performs raycasts through the
 * scene each frame.
 */
export class Input {
  options!: Options;
  controllers: Controller[] = [];
  controllerGrips: THREE.Group[] = [];
  hands: THREE.XRHandSpace[] = [];
  /** Completed head gestures, when enabled before initialization. */
  headGestures?: HeadGestureRecognition;
  raycaster = new Raycaster();
  initialized = false;
  pivotsEnabled = false;
  gazeController = new GazeController();
  mouseController = new MouseController();
  gamepadController = new GamepadController();
  controllersEnabled = true;
  listeners = new Map();
  private pinchFilter = new PinchFilter((event) => this.dispatchEvent(event));
  private intersectionsForController = new Map<
    Controller,
    THREE.Intersection[]
  >();
  private selectedControllers = new Set<Controller>();
  private releasedControllers = new Set<Controller>();
  activeControllers = new ActiveControllers();
  leftController?: Controller;
  rightController?: Controller;
  reticles = new Reticles();
  private directTouchInputs: DirectTouchInput[] = [];
  scene?: THREE.Scene;

  /**
   * Initializes an instance with XR controllers, grips, hands, raycaster, and
   * default options. Only called by Core.
   */
  init({
    scene,
    systemsGroup,
    options,
    renderer,
  }: {
    scene: THREE.Scene;
    systemsGroup: XRSystems;
    options: Options;
    renderer: THREE.WebGLRenderer;
  }) {
    this.scene = scene;
    this.raycaster.layers.enable(UI_OVERLAY_LAYER);
    systemsGroup.add(this.activeControllers, this.reticles);

    this.controllersEnabled = options.controllers.enabled;

    this.options = options;

    if (options.headGestures.enabled) {
      this.headGestures = new HeadGestureRecognition();
      systemsGroup.add(this.headGestures);
    }

    if (!options.controllers.enabled) {
      return;
    }

    const controllers = this.controllers;
    const controllerGrips = this.controllerGrips;

    for (let i = 0; i < NUM_HANDS; ++i) {
      controllers.push(renderer.xr.getController(i));
      controllers[i].userData.id = i;
      this.activeControllers.add(this.controllers[i]);
    }
    controllers.push(this.gazeController);
    controllers.push(this.mouseController);
    this.activeControllers.add(this.mouseController);
    controllers.push(this.gamepadController);
    this.activeControllers.add(this.gamepadController);

    for (const controller of controllers) {
      this.intersectionsForController.set(controller, []);
    }

    if (options.controllers.enabled) {
      if (options.controllers.visualization) {
        const controllerModelFactory = new XRControllerModelFactory();
        for (let i = 0; i < NUM_HANDS; ++i) {
          controllerGrips.push(renderer.xr.getControllerGrip(i));
          controllerGrips[i].add(
            controllerModelFactory.createControllerModel(controllerGrips[i])
          );
          this.activeControllers.add(controllerGrips[i]);
        }
      }

      // TODO: Separate logic to XR Hands.
      if (options.hands.enabled) {
        for (let i = 0; i < NUM_HANDS; ++i) {
          this.hands.push(renderer.xr.getHand(i));
          this.activeControllers.add(this.hands[i]);
        }

        if (options.hands.visualization) {
          if (options.hands.visualizeJoints) {
            console.log('Visualize hand joints.');
            const handModelFactory = new XRHandModelFactory();
            for (let i = 0; i < NUM_HANDS; ++i) {
              const handModel = handModelFactory.createHandModel(
                this.hands[i],
                'boxes'
              );
              handModel.pointerEvents = 'none';
              this.hands[i].add(handModel);
            }
          }
          if (options.hands.visualizeMeshes) {
            console.log('Visualize hand meshes.');
            const handModelFactory = new XRHandModelFactory();
            for (let i = 0; i < NUM_HANDS; ++i) {
              const handModel = handModelFactory.createHandModel(
                this.hands[i],
                'mesh'
              );
              handModel.pointerEvents = 'none';
              this.hands[i].add(handModel);
            }
          }
        }
      }
    }

    if (options.controllers.visualizeRays) {
      for (let i = 0; i < NUM_HANDS; ++i) {
        controllers[i].add(new ControllerRayVisual());
      }
    }

    this.bindSelectStart(this.defaultOnSelectStart.bind(this));
    this.bindSelectEnd(this.defaultOnSelectEnd.bind(this));
    this.bindSqueezeStart(this.defaultOnSqueezeStart.bind(this));
    this.bindSqueezeEnd(this.defaultOnSqueezeEnd.bind(this));
    this.bindListener('connected', this.defaultOnConnected.bind(this));
    this.bindListener('disconnected', this.defaultOnDisconnected.bind(this));
  }

  /**
   * Retrieves the controller object by its ID.
   * @param id - The ID of the controller.
   * @returns The controller with the specified ID.
   */
  get(id: number): THREE.Object3D {
    return this.controllers[id];
  }

  /**
   * Adds an object to both controllers by creating a new group and cloning it.
   * @param obj - The object to add to each controller.
   */
  addObject(obj: THREE.Object3D) {
    const group = new THREE.Group();
    group.add(obj);
    // Clones the group for each controller, adding it to the controller.
    for (let i = 0; i < this.controllers.length; ++i) {
      this.controllers[i].add(group.clone());
    }
  }

  /**
   * Creates a pivot point for each hand, primarily used as a reference
   * point.
   */
  enablePivots() {
    if (this.pivotsEnabled) return;
    this.pivotsEnabled = true;
    const pivot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.01, 3));
    pivot.name = 'pivot';
    pivot.position.z = -0.05;
    this.addObject(pivot);
  }

  /**
   * Adds reticles to the controllers and scene, with initial visibility set to
   * false.
   */
  addReticles() {
    let id = 0;
    for (const controller of this.controllers) {
      if (controller.reticle == null) {
        controller.reticle = new Reticle();
        controller.reticle.name = 'Reticle ' + id;
        ++id;
      }
      controller.reticle.visible = false;
      this.reticles.add(controller.reticle);
    }
  }

  /**
   * Default action to handle the start of a selection, setting the selecting
   * state to true.
   */
  defaultOnSelectStart(event: ControllerEvent) {
    const controller = event.target;
    controller.userData.selected = true;
  }

  /**
   * Default action to handle the end of a selection, setting the selecting
   * state to false.
   */
  defaultOnSelectEnd(event: ControllerEvent) {
    const controller = event.target;
    controller.userData.selected = false;
    this.releasedControllers.add(controller);
  }

  defaultOnSqueezeStart(event: ControllerEvent) {
    const controller = event.target;
    controller.userData.squeezing = true;
    this.defaultOnSelectStart(event);
  }

  defaultOnSqueezeEnd(event: ControllerEvent) {
    const controller = event.target;
    controller.userData.squeezing = false;
    this.defaultOnSelectEnd(event);
  }

  defaultOnConnected(event: ControllerEvent) {
    const controller = event.target;
    controller.userData.connected = true;
    controller.gamepad = event.data?.gamepad;
    controller.inputSource = event.data;
    switch (event.data?.handedness) {
      case 'left':
        this.leftController = controller;
        break;
      case 'right':
        this.rightController = controller;
        break;
    }
  }

  defaultOnDisconnected(event: ControllerEvent) {
    const controller = event.target;
    controller.userData.connected = false;
    if (controller.userData.selected) {
      controller.userData.selected = false;
      this.dispatchEvent({
        type: 'selectend',
        target: controller,
        data: event.data,
        isCustom: true,
      } as unknown as ControllerEvent);
    }
    if (controller.reticle) {
      controller.reticle.visible = false;
    }
    this.clearIntersections(controller);
    this.selectedControllers.delete(controller);
    this.releasedControllers.delete(controller);
    delete controller?.gamepad;
    switch (event.data?.handedness) {
      case 'left':
        this.leftController = undefined;
        break;
      case 'right':
        this.rightController = undefined;
        break;
    }
  }

  /**
   * Binds a listener to both controllers.
   * @param listenerName - Event name
   * @param listener - Function to call
   */
  bindListener(
    listenerName: keyof ControllerEventMap,
    listener: (event: ControllerEvent) => void
  ) {
    for (const controller of this.controllers) {
      this.pinchFilter.setupControllerForType(controller, listenerName);
    }
    if (!this.listeners.has(listenerName)) {
      this.listeners.set(listenerName, []);
    }
    this.listeners.get(listenerName).push(listener);
  }

  unbindListener(
    listenerName: keyof ControllerEventMap,
    listener: (event: ControllerEvent) => void
  ) {
    if (this.listeners.has(listenerName)) {
      const list = this.listeners.get(listenerName)!;
      const index = list.indexOf(listener);
      if (index !== -1) {
        list.splice(index, 1);
      }
      if (list.length === 0) {
        for (const controller of this.controllers) {
          this.pinchFilter.removeControllerForType(controller, listenerName);
        }
      }
    }
  }

  dispatchEvent(event: ControllerEvent) {
    if (this.pinchFilter.shouldFilterEvent(event)) {
      return;
    }
    if (this.listeners.has(event.type)) {
      for (const listener of this.listeners.get(event.type)) {
        listener(event);
      }
    }
  }

  /**
   * Binds an event listener to handle 'selectstart' events for both
   * controllers.
   * @param event - The event listener function.
   */
  bindSelectStart(event: (event: ControllerEvent) => void) {
    this.bindListener('selectstart', event);
  }

  /**
   * Binds an event listener to handle 'selectend' events for both controllers.
   * @param event - The event listener function.
   */
  bindSelectEnd(event: (event: ControllerEvent) => void) {
    this.bindListener('selectend', event);
  }

  /**
   * Binds an event listener to handle 'select' events for both controllers.
   * @param event - The event listener function.
   */
  bindSelect(event: (event: ControllerEvent) => void) {
    this.bindListener('select', event);
  }

  /**
   * Binds an event listener to handle 'squeezestart' events for both
   * controllers.
   * @param event - The event listener function.
   */
  bindSqueezeStart(event: (event: ControllerEvent) => void) {
    this.bindListener('squeezestart', event);
  }

  /**
   * Binds an event listener to handle 'squeezeend' events for both controllers.
   * @param event - The event listener function.
   */
  bindSqueezeEnd(event: (event: ControllerEvent) => void) {
    this.bindListener('squeezeend', event);
  }

  bindSqueeze(event: (event: ControllerEvent) => void) {
    this.bindListener('squeeze', event);
  }

  bindKeyDown(event: (event: KeyEvent) => void) {
    window.addEventListener('keydown', event);
  }

  bindKeyUp(event: (event: KeyEvent) => void) {
    window.addEventListener('keyup', event);
  }

  unbindKeyDown(event: (event: KeyEvent) => void) {
    window.removeEventListener('keydown', event);
  }

  unbindKeyUp(event: (event: KeyEvent) => void) {
    window.removeEventListener('keyup', event);
  }

  /**
   * Finds intersections between a controller's ray and a specified object.
   * @param controller - The controller casting the ray.
   * @param obj - The object to intersect.
   * @returns Array of intersection points, if any.
   */
  intersectObjectByController(
    controller: THREE.Object3D,
    obj: THREE.Object3D
  ): THREE.Intersection[] {
    controller.updateMatrixWorld();
    this.setRaycasterFromController(controller);
    return this.raycaster.intersectObject(obj, false);
  }

  /**
   * Finds intersections based on an event's target controller and a specified
   * object.
   * @param event - The event containing the controller reference.
   * @param obj - The object to intersect.
   * @returns Array of intersection points, if any.
   */
  intersectObjectByEvent(
    event: ControllerEvent,
    obj: THREE.Object3D
  ): THREE.Intersection[] {
    return this.intersectObjectByController(event.target, obj);
  }

  /**
   * Finds intersections with an object from either controller.
   * @param obj - The object to intersect.
   * @returns Array of intersection points, if any.
   */
  intersectObject(obj: THREE.Object3D): THREE.Intersection[] {
    // Checks for intersections from the first controller.
    const intersection = this.intersectObjectByController(
      this.controllers[0],
      obj
    );
    if (intersection.length > 0) {
      return intersection;
    }
    // Checks for intersections from the second controller if no intersection
    // found.
    return this.intersectObjectByController(this.controllers[1], obj);
  }

  update() {
    if (this.controllersEnabled) {
      for (const controller of this.controllers) {
        this.updateController(controller);
      }
    }
    this.updateDirectTouchInputs();
  }

  /** Returns the complete physical input sampled this frame. */
  getInteractionFrame(): InteractionFrameInput {
    const raySources: RaySourceInput[] = [];
    if (this.controllersEnabled) {
      for (const controller of this.controllers) {
        if (controller.userData.connected !== true) continue;
        const position = controller.getWorldPosition(new THREE.Vector3());
        const orientation = controller.getWorldQuaternion(
          new THREE.Quaternion()
        );
        raySources.push({
          controller,
          sourceType: this.getRaySourceType(controller),
          ray: new THREE.Ray(
            position,
            new THREE.Vector3(0, 0, -1).applyQuaternion(orientation).normalize()
          ),
          intersections: this.intersectionsForController.get(controller) ?? [],
          selected: controller.userData.selected === true,
          position,
          orientation,
        });
      }
    }
    return {raySources, directTouches: this.directTouchInputs};
  }

  private getRaySourceType(
    controller: Controller
  ): RaySourceInput['sourceType'] {
    if (controller === this.mouseController) return 'mouse';
    if (controller === this.gazeController) return 'gaze';
    if (controller.inputSource?.hand) return 'hand-ray';
    return 'controller-ray';
  }

  private updateDirectTouchInputs() {
    const inputs: DirectTouchInput[] = [];
    for (let handIndex = 0; handIndex < NUM_HANDS; handIndex++) {
      const controller = this.controllers[handIndex];
      const indexTip = this.hands[handIndex]?.joints?.['index-finger-tip'];
      if (!controller || !indexTip) continue;
      inputs.push({
        controller,
        handIndex,
        hand: this.hands[handIndex]?.joints?.wrist,
        point: indexTip.getWorldPosition(new THREE.Vector3()),
        selected: controller.userData.selected === true,
      });
    }
    this.directTouchInputs = inputs;
  }

  updateController(controller: Controller) {
    if (controller.userData.connected !== true) {
      this.clearIntersections(controller);
      this.selectedControllers.delete(controller);
      this.releasedControllers.delete(controller);
      return;
    }
    controller.updatePose?.();
    controller.updateMatrixWorld();
    this.pinchFilter.updateController(
      controller,
      this.dispatchEvent.bind(this)
    );
    const selected = controller.userData.selected === true;
    const wasSelected = this.selectedControllers.has(controller);
    const wasReleased = this.releasedControllers.delete(controller);
    if (selected) {
      this.selectedControllers.add(controller);
    } else {
      this.selectedControllers.delete(controller);
    }
    if (
      this.options.interaction.raycastMode === 'continuous' ||
      controller === this.gazeController ||
      selected ||
      wasSelected ||
      wasReleased
    ) {
      this.setRaycasterFromController(controller);
      this.performRaycastOnScene(controller);
    } else {
      this.clearIntersections(controller);
    }
  }

  /**
   * Sets the raycaster's origin and direction from any Object3D that
   * represents a controller. This replaces the non-standard
   * `setFromXRController`.
   * @param controller - The controller to cast a ray from.
   */
  setRaycasterFromController(controller: THREE.Object3D) {
    controller.getWorldPosition(this.raycaster.ray.origin);
    MATRIX4.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.direction
      .set(0, 0, -1)
      .applyMatrix4(MATRIX4)
      .normalize();
  }

  enableGazeController() {
    this.activeControllers.add(this.gazeController);
    this.gazeController.connect();
  }

  disableGazeController() {
    this.gazeController.disconnect();
    this.activeControllers.remove(this.gazeController);
  }

  private registerController(controller: Controller) {
    if (this.controllers.includes(controller)) return;
    this.controllers.push(controller);
    this.intersectionsForController.set(controller, []);

    if (controller.reticle) {
      controller.reticle.visible = false;
      this.reticles.add(controller.reticle);
    }

    this.pinchFilter.setupController(controller, this.listeners.keys());
  }

  enableController(controller: Controller) {
    this.registerController(controller);
    this.activeControllers.add(controller as unknown as THREE.Object3D);
    (controller as unknown as {connect?: () => void}).connect?.();
  }

  disableController(controller: Controller) {
    (controller as unknown as {disconnect?: () => void}).disconnect?.();
    this.activeControllers.remove(controller as unknown as THREE.Object3D);
  }

  disableControllers() {
    this.controllersEnabled = false;
    for (const controller of this.controllers) {
      controller.userData.selected = false;
      this.clearIntersections(controller);
      this.selectedControllers.delete(controller);
      this.releasedControllers.delete(controller);
      if (controller.reticle) {
        controller.reticle.visible = false;
        controller.reticle.targetObject = undefined;
      }
    }
  }

  enableControllers() {
    this.controllersEnabled = true;
  }

  dispose() {
    this.pinchFilter.dispose(this.controllers);
    this.listeners.clear();
  }

  // Performs the raycast assuming the raycaster is already set up.
  performRaycastOnScene(controller: Controller) {
    if (!this.scene) return;
    if (!this.intersectionsForController.has(controller)) {
      this.intersectionsForController.set(controller, []);
    }
    const intersections = this.intersectionsForController.get(controller)!;
    intersections.length = 0;
    this.raycaster.intersectObject(this.scene, true, intersections);
    intersections.sort(compareIntersections);
  }

  private clearIntersections(controller: Controller) {
    this.intersectionsForController.get(controller)?.splice(0);
  }
}

function compareIntersections(
  a: THREE.Intersection,
  b: THREE.Intersection
): number {
  const aOverlay = a.object.layers.isEnabled(UI_OVERLAY_LAYER);
  const bOverlay = b.object.layers.isEnabled(UI_OVERLAY_LAYER);
  if (aOverlay !== bOverlay) return aOverlay ? -1 : 1;
  if (aOverlay) {
    const order = interactionHitOrder(b.object) - interactionHitOrder(a.object);
    if (order !== 0) return order;
  }
  const distance = a.distance - b.distance;
  if (Math.abs(distance) > 0.00001) return distance;
  if (a.object.renderOrder !== b.object.renderOrder) {
    return b.object.renderOrder - a.object.renderOrder;
  }
  return b.object.id - a.object.id;
}

function interactionHitOrder(object: THREE.Object3D): number {
  let current: THREE.Object3D | null = object;
  while (current) {
    const order = current.userData.xrblocksHitOrder;
    if (typeof order === 'number') return order;
    current = current.parent;
  }
  return object.renderOrder;
}
