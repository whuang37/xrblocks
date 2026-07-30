import type * as THREE from 'three';

interface SemanticControlState {
  isDisabled(): boolean;
  activate(): void;
}

const CONTROLS = new WeakMap<THREE.Object3D, SemanticControlState>();

/** Registers one built-in semantic control without exposing UI internals. */
export function registerSemanticControl(
  object: THREE.Object3D,
  state: SemanticControlState
): void {
  CONTROLS.set(object, state);
}

export function isSemanticControl(object: THREE.Object3D): boolean {
  return CONTROLS.has(object);
}

export function isSemanticControlDisabled(object: THREE.Object3D): boolean {
  return CONTROLS.get(object)?.isDisabled() ?? true;
}

export function activateSemanticControl(object: THREE.Object3D): boolean {
  const state = CONTROLS.get(object);
  if (!state || state.isDisabled()) return false;
  state.activate();
  return true;
}
