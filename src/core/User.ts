import * as THREE from 'three';

import {Controller} from '../input/Controller';
import {Hands} from '../input/Hands';
import {Input} from '../input/Input';
import {Interaction} from '../interaction/Interaction';

import {ObjectGrabEvent, Script} from './Script';

type MaybeXRScript = THREE.Object3D & {isXRScript?: boolean};

const tempBox = new THREE.Box3();
const tempCenter = new THREE.Vector3();

/**
 * User is an embodied instance to manage hands, controllers, speech, and
 * avatars. It extends Script to update human-world interaction.
 *
 * In the long run, User is to manages avatars, hands, and everything of Human
 * I/O. In third-person view simulation, it should come with an low-poly avatar.
 * To support multi-user social XR planned for future iterations.
 */
export class User extends Script {
  static dependencies = {
    input: Input,
    interaction: Interaction,
    scene: THREE.Scene,
  };

  /**
   * Whether to represent a local user, or another user in a multi-user session.
   */
  local = true;

  /**
   * The number of hands associated with the XR user.
   */
  numHands = 2;

  /**
   * The height of the user in meters.
   */
  height = 1.6;

  /**
   * The default distance of a UI panel from the user in meters.
   */
  panelDistance = 1.75;

  /**
   * The handedness (primary hand) of the user (0 for left, 1 for right, 2 for
   * both).
   */
  handedness = 1;

  /**
   * The radius of the safe space around the user in meters.
   */
  safeSpaceRadius = 0.2;

  /**
   * The distance of a newly spawned object from the user in meters.
   */
  objectDistance = 1.5;

  /**
   * The angle of a newly spawned object from the user in radians.
   */
  objectAngle = (-18.0 / 180.0) * Math.PI;

  /**
   * An array of pivot objects. Pivot are sphere at the **starting** tip of
   * user's hand / controller / mouse rays for debugging / drawing applications.
   */
  pivots: THREE.Object3D[] = [];

  /**
   * Public data for user interactions, typically holding references to XRHand.
   */
  hands?: Hands;

  /**
   * Maps a hand index (0 or 1) to a set of meshes it is currently touching.
   */
  touchedObjects = new Map<number, Set<THREE.Mesh>>();

  /**
   * Maps a hand index to another map that associates a grabbed mesh with its
   * initial grab event data.
   */
  grabbedObjects = new Map<number, Map<THREE.Mesh, ObjectGrabEvent>>();

  input!: Input;
  private interaction!: Interaction;
  scene!: THREE.Scene;
  controllers!: Controller[];

  /**
   * Constructs a new User.
   */
  constructor() {
    super();
  }

  /**
   * Initializes the User.
   */
  init({
    input,
    interaction,
    scene,
  }: {
    input: Input;
    interaction: Interaction;
    scene: THREE.Scene;
  }) {
    this.input = input;
    this.interaction = interaction;
    this.controllers = input.controllers;
    this.scene = scene;
  }

  /**
   * Sets the user's height on the first frame.
   * @param camera -
   */
  setHeight(camera: THREE.Camera) {
    this.height = camera.position.y;
  }

  /**
   * Adds pivots at the starting tip of user's hand / controller / mouse rays.
   */
  enablePivots() {
    this.input.enablePivots();
  }

  /**
   * Gets the pivot object for a given controller id.
   * @param id - The controller id.
   * @returns The pivot object.
   */
  getPivot(id: number) {
    return this.controllers[id].getObjectByName('pivot');
  }

  /**
   * Gets the world position of the pivot for a given controller id.
   * @param id - The controller id.
   * @returns The world position of the pivot.
   */
  getPivotPosition(id: number) {
    return this.getPivot(id)?.getWorldPosition(new THREE.Vector3());
  }

  getRay(controllerId: number, target = new THREE.Ray()) {
    const ray = this.interaction.getSourceSnapshot(
      this.controllers[controllerId]
    )?.ray;
    return ray ? target.copy(ray) : target;
  }

  getRayIntersection(controllerId: number) {
    const controller = this.controllers[controllerId];
    const resolved = this.interaction.getResolvedRay(controller);
    return resolved
      ? this.interaction.getIntersectionAt(resolved.surface, controller)
      : null;
  }

  /**
   * Checks if any controller is pointing at the given object or its children.
   * @param obj - The object to check against.
   * @returns True if a controller is pointing at the object.
   */
  isPointingAt(obj: THREE.Object3D) {
    return this.interaction.isPointingAt(obj);
  }

  /**
   * Checks if any controller is selecting the given object or its children.
   * @param obj - The object to check against.
   * @returns True if a controller is selecting the object.
   */
  isSelectingAt(obj: THREE.Object3D) {
    return this.interaction.isSelectingAt(obj);
  }

  isManipulating(obj: THREE.Object3D) {
    return this.interaction.isManipulating(obj);
  }

  /**
   * Gets the intersection point on a specific object.
   * Not recommended for general use, since a View / ModelView's
   * ux.positions contains the intersected points.
   * @param obj - The object to check for intersection.
   * @param id - The controller ID, or -1 for any controller.
   * @returns The intersection details, or null if no intersection.
   */
  getIntersectionAt(obj: THREE.Object3D, id = -1) {
    return this.interaction.getIntersectionAt(
      obj,
      id < 0 ? undefined : this.controllers[id]
    );
  }

  /**
   * Gets the world position of a controller.
   * @param id - The controller id.
   * @param target - The target vector to
   * store the result.
   * @returns The world position of the controller.
   */
  getControllerPosition(id: number, target = new THREE.Vector3()) {
    this.controllers[id].getWorldPosition(target);
    return target;
  }

  /**
   * Calculates the distance between a controller and an object.
   * @param id - The controller id.
   * @param object - The object to measure the distance to.
   * @returns The distance between the controller and the object.
   */
  getControllerObjectDistance(id: number, object: THREE.Object3D) {
    const controllerPos = this.getControllerPosition(id);
    const objPos = new THREE.Vector3();
    object.getWorldPosition(objPos);
    return controllerPos.distanceTo(objPos);
  }

  /**
   * Checks if either controller is selecting.
   * @param id - The controller id. If -1, check both controllers.
   * @returns True if selecting, false otherwise.
   */
  isSelecting(id = -1) {
    if (id == -1) {
      return this.input.controllers.some((controller) => {
        return controller.userData.selected;
      });
    }
    return this.input.controllers[id].userData.selected;
  }

  /**
   * Checks if either controller is squeezing.
   * @param id - The controller id. If -1, check both controllers.
   * @returns True if squeezing, false otherwise.
   */
  isSqueezing(id = -1) {
    if (id == -1) {
      return this.input.controllers.some((controller) => {
        return controller.userData.squeezing;
      });
    }
    return this.input.controllers[id].userData.squeezing;
  }

  /**
   * The main update loop called each frame.
   */
  update() {
    // Direct touch detection.
    this.updateTouchState();
    // Direct grab detection.
    this.updateGrabState();
  }

  /**
   * Checks for and handles grab events (touching + pinching).
   */
  updateGrabState() {
    if (!this.hands) {
      return;
    }

    for (let i = 0; i < this.numHands; i++) {
      const isPinching = this.isSelecting(i);
      const touchedMeshes = this.touchedObjects.get(i) || new Set<THREE.Mesh>();

      const currentlyGrabbedMeshes = isPinching
        ? touchedMeshes
        : new Set<THREE.Mesh>();
      const previouslyGrabbedMeshesMap =
        this.grabbedObjects.get(i) || new Map();

      const newlyGrabbedMeshes = [...currentlyGrabbedMeshes].filter(
        (mesh) => !previouslyGrabbedMeshesMap.has(mesh)
      );

      const releasedMeshes = [...previouslyGrabbedMeshesMap.keys()].filter(
        (mesh) => !currentlyGrabbedMeshes.has(mesh)
      );

      for (const mesh of newlyGrabbedMeshes) {
        const hand = this.hands.getWrist(i);
        if (!hand) continue;

        const grabEvent = {handIndex: i, hand: hand};

        if (!this.grabbedObjects.has(i)) {
          this.grabbedObjects.set(i, new Map());
        }
        this.grabbedObjects.get(i)!.set(mesh, grabEvent);
        this.callObjectGrabStart(grabEvent, mesh);
      }

      for (const mesh of releasedMeshes) {
        const grabEvent = previouslyGrabbedMeshesMap.get(mesh);
        this.callObjectGrabEnd(grabEvent, mesh);
        previouslyGrabbedMeshesMap.delete(mesh);
      }

      for (const mesh of currentlyGrabbedMeshes) {
        if (previouslyGrabbedMeshesMap.has(mesh)) {
          const grabEvent = previouslyGrabbedMeshesMap.get(mesh);
          this.callObjectGrabbing(grabEvent, mesh);
        }
      }
    }
  }

  /**
   * Checks for and handles touch events for the hands' index fingers.
   */
  updateTouchState() {
    if (!this.hands) {
      return;
    }
    for (let i = 0; i < this.numHands; i++) {
      const indexTip = this.hands.getIndexTip(i);
      const controller = this.controllers[i];
      if (!indexTip) {
        if (controller) this.interaction.removeDirectTouch(controller);
        this.touchedObjects.delete(i);
        continue;
      }

      const indexTipPosition = new THREE.Vector3();
      indexTip.getWorldPosition(indexTipPosition);

      const contacts: THREE.Intersection[] = [];
      this.scene.traverse((object) => {
        if ((object as Partial<THREE.Mesh>).isMesh && object.visible) {
          try {
            tempBox.setFromObject(object);
          } catch (_) {
            return;
          }
          if (tempBox.containsPoint(indexTipPosition)) {
            contacts.push({
              distance: tempBox
                .getCenter(tempCenter)
                .distanceTo(indexTipPosition),
              object,
              point: indexTipPosition,
            });
          }
        }
      });
      contacts.sort((a, b) => a.distance - b.distance);

      const surface = controller
        ? this.interaction.updateDirectTouch({
            controller,
            handIndex: i,
            point: indexTipPosition,
            intersections: contacts,
          })
        : undefined;
      if ((surface as Partial<THREE.Mesh> | undefined)?.isMesh) {
        this.touchedObjects.set(i, new Set([surface as THREE.Mesh]));
      } else {
        this.touchedObjects.delete(i);
      }
    }
  }

  /**
   * Recursively calls onObjectGrabStart on a target and its ancestors.
   * @param event - The original grab start event.
   * @param target - The object being grabbed.
   */
  callObjectGrabStart(event: ObjectGrabEvent, target: THREE.Object3D | null) {
    if (target == null) return;
    if ((target as MaybeXRScript).isXRScript) {
      (target as Script).onObjectGrabStart(event);
    }
    this.callObjectGrabStart(event, target.parent);
  }

  /**
   * Recursively calls onObjectGrabbing on a target and its ancestors.
   * @param event - The original grabbing event.
   * @param target - The object being grabbed.
   */
  callObjectGrabbing(event: ObjectGrabEvent, target: THREE.Object3D | null) {
    if (target == null) return;
    if ((target as MaybeXRScript).isXRScript) {
      (target as Script).onObjectGrabbing(event);
    }
    this.callObjectGrabbing(event, target.parent);
  }

  /**
   * Recursively calls onObjectGrabEnd on a target and its ancestors.
   * @param event - The original grab end event.
   * @param target - The object being released.
   */
  callObjectGrabEnd(event: ObjectGrabEvent, target: THREE.Object3D | null) {
    if (target == null) return;
    if ((target as MaybeXRScript).isXRScript) {
      (target as Script).onObjectGrabEnd(event);
    }
    this.callObjectGrabEnd(event, target.parent);
  }

  /**
   * Checks if a controller is selecting a specific object. Returns the
   * intersection details if true.
   * @param obj - The object to check for selection.
   * @param controller - The controller performing the select.
   * @returns The intersection object if a match is found, else null.
   */
  select(obj: THREE.Object3D, controller: THREE.Object3D) {
    return this.interaction.getIntersectionAt(obj, controller as Controller);
  }
}
