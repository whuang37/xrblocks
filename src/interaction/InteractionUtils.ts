import * as THREE from 'three';

import type {
  InteractionCallbackDispatch,
  SelectionCapture,
  TargetedInteractionHook,
} from './InteractionTypes.js';

export function dispatchInteractionPath(
  callbacks: InteractionCallbackDispatch,
  path: readonly THREE.Object3D[],
  hook: TargetedInteractionHook,
  argument: unknown
): void {
  for (const script of path) {
    if (callbacks.invokeTarget(script, hook, argument) === true) return;
  }
}

export function isSelectionValid(
  selection: SelectionCapture,
  ancestry: readonly THREE.Object3D[]
): boolean {
  const ownerIndex = ancestry.indexOf(selection.owner);
  if (ownerIndex < 0) return false;
  for (let index = 0; index < ancestry.length; index++) {
    const object = ancestry[index];
    if (object.visible === false || object.xb?.pointerEvents === 'none')
      return false;
    if (index <= ownerIndex && object.xb?.interactionEnabled === false)
      return false;
    if (index + 1 < ancestry.length && object.parent !== ancestry[index + 1]) {
      return false;
    }
  }
  return true;
}
