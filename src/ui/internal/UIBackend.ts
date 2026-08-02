import type * as THREE from 'three';

import type {InteractionHitPart} from '../../interaction/InteractionTypes';
import type {UIElement} from '../UIElement';
import type {UITheme} from '../UITheme';

export interface UIHitMapping {
  readonly physical: THREE.Object3D;
  readonly logical: UIElement;
  readonly part: InteractionHitPart;
}

export interface UIPresentationState {
  readonly hovered: boolean;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly cursorPoints: readonly THREE.Vector3[];
}

export interface UIMount {
  readonly object: THREE.Object3D;
  sync(
    theme: UITheme,
    viewport: {width: number; height: number},
    stateFor: (element: UIElement) => UIPresentationState,
    rootOrder: number
  ): UIHitMapping[];
  present(
    stateFor: (element: UIElement) => UIPresentationState,
    themeChanged: boolean
  ): void;
  update(deltaSeconds: number): void;
  dispose(): void;
}

export interface UIBackend {
  configureRenderer?(renderer: THREE.WebGLRenderer): void;
  createMount(root: UIElement): UIMount;
  dispose(): void;
}

export interface UIBackendModule {
  createUIBackend(): UIBackend;
}
