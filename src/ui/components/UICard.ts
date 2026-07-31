import {Container} from '@pmndrs/uikit';
import * as THREE from 'three';

import {ScriptMixin} from '../../core/Script';
import type {ManipulationOptions} from '../../interaction/manipulation/ManipulationTypes';
import {DEFAULT_CARD_PROPS} from '../constants/UICardConstants';
import {
  GradientPanel,
  type GradientPanelProperties,
} from '../primitives/GradientPanel';
import {
  UIManipulationHandle,
  type UIManipulationHandleProperties,
} from './UIManipulationHandle';

const ScriptedGradientPanel = ScriptMixin(GradientPanel);

/** Properties for a world-space UI root. */
export type UICardOutProperties = Omit<
  GradientPanelProperties,
  'anchorX' | 'anchorY'
> & {
  name?: string;
  position?: THREE.Vector3;
  rotation?: THREE.Quaternion;
  visible?: boolean;
  sizeX?: number;
  sizeY?: number;
  anchorX?: 'left' | 'right' | 'center' | number;
  anchorY?: 'bottom' | 'top' | 'center' | number;
  pixelSize?: number;
  /** Enables card manipulation. Translation faces the camera unless explicitly disabled. */
  manipulation?: boolean | ManipulationOptions;
  /** Adds an outward shader edge that can act as a manipulation handle. */
  manipulationEdge?: boolean | UIManipulationHandleProperties;
};

/** A UIKit flex container anchored in world space. */
export class UICard extends ScriptedGradientPanel {
  static dependencies = {timer: THREE.Timer};

  name = 'UICard';
  readonly isUI = true;
  readonly cardPixelSize: number;
  readonly baseWidth?: number;
  readonly baseHeight?: number;
  readonly baseSizeX?: number;
  readonly baseSizeY?: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly basePosition: THREE.Vector3;
  readonly manipulationEdge?: UIManipulationHandle;
  private timer?: THREE.Timer;

  constructor(config: UICardOutProperties = {}) {
    const {
      name,
      position,
      rotation,
      visible,
      manipulation,
      manipulationEdge,
      pixelSize,
      sizeX,
      sizeY,
      anchorX,
      anchorY,
      ...properties
    } = config;

    const resolvedPixelSize = pixelSize ?? DEFAULT_CARD_PROPS.pixelSize;
    const resolvedSizeX = sizeX ?? DEFAULT_CARD_PROPS.sizeX;
    const resolvedSizeY = sizeY ?? DEFAULT_CARD_PROPS.sizeY;

    super({
      ...DEFAULT_CARD_PROPS,
      ...properties,
      pixelSize: resolvedPixelSize,
      sizeX: resolvedSizeX,
      sizeY: resolvedSizeY,
      pointerEvents: properties.pointerEvents ?? 'auto',
    });

    this.name = name ?? 'UICard';
    this.cardPixelSize = resolvedPixelSize;
    this.baseWidth = properties.width as number | undefined;
    this.baseHeight = properties.height as number | undefined;
    this.baseSizeX = resolvedSizeX;
    this.baseSizeY = resolvedSizeY;
    this.anchorX = resolveHorizontalAnchor(
      anchorX ?? DEFAULT_CARD_PROPS.anchorX
    );
    this.anchorY = resolveVerticalAnchor(anchorY ?? DEFAULT_CARD_PROPS.anchorY);
    this.basePosition = position?.clone() ?? new THREE.Vector3();

    this.position.copy(this.basePosition);
    if (rotation) this.quaternion.copy(rotation);
    if (visible !== undefined) this.visible = visible;
    if (manipulation !== undefined) {
      this.xb = {manipulation: resolveCardManipulation(manipulation)};
    }
    if (manipulationEdge) {
      this.manipulationEdge = new UIManipulationHandle(
        manipulationEdge === true ? {} : manipulationEdge
      );
      this.add(this.manipulationEdge);
    }

    // UIKit containers coordinate their own private hit surfaces. The public
    // card remains the logical interaction and manipulation owner.
    this.raycast = () => {};
  }

  show() {
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  toggle() {
    this.visible = !this.visible;
  }

  init({timer}: {timer: THREE.Timer}) {
    this.timer = timer;
  }

  update() {
    super.update();
    const update = Container.prototype['update'];
    if (update) update.call(this, this.timer?.getDelta() ?? 0);
  }

  override dispose(): void {
    GradientPanel.prototype.dispose.call(this);
  }
}

function resolveCardManipulation(
  value: boolean | ManipulationOptions
): boolean | ManipulationOptions {
  if (value === false) return false;
  if (value === true) {
    return {actions: defaultCardManipulationActions()};
  }

  return {
    ...value,
    actions: resolveCardManipulationActions(value.actions),
  };
}

function defaultCardManipulationActions(): NonNullable<
  ManipulationOptions['actions']
> {
  return {
    translate: {faceCamera: true},
    scale: true,
  };
}

function resolveCardManipulationActions(
  actions: ManipulationOptions['actions']
): NonNullable<ManipulationOptions['actions']> {
  if (!actions) return defaultCardManipulationActions();
  if (actions.translate === true) {
    return {...actions, translate: {faceCamera: true}};
  }
  if (actions.translate && typeof actions.translate === 'object') {
    return {
      ...actions,
      translate: {faceCamera: true, ...actions.translate},
    };
  }
  return actions;
}

function resolveHorizontalAnchor(
  value: 'left' | 'right' | 'center' | number
): number {
  if (typeof value === 'number') return value;
  if (value === 'left') return 0;
  if (value === 'right') return 1;
  return 0.5;
}

function resolveVerticalAnchor(
  value: 'bottom' | 'top' | 'center' | number
): number {
  if (typeof value === 'number') return value;
  if (value === 'bottom') return 0;
  if (value === 'top') return 1;
  return 0.5;
}
