# Flex UI implementation reference

Read this file before authoring or repairing an XR Blocks spatial surface.
The flex UI is implemented in `src/ui`, exported from `src/xrblocks.ts`, and
rendered as part of the main SDK. It is not an addon.

## Browser setup

Copy the complete import map from `samples/uiblocks/index.html`. Keep `three`
aligned with `package.json`, keep the UIKit-family packages on one version, and
map `xrblocks` to `build/xrblocks.js`. Do not add a bare `uiblocks` mapping.

Import public elements from the main package:

```js
import * as THREE from 'three';
import {UIButton, UICard, UIIcon, UIImage, UIPanel, UIText} from 'xrblocks';
import * as xb from 'xrblocks';
```

Core configures UIKit clipping and transparent painter order. No UIKit option
registration or custom raycast sort is required.

## Surface construction

Create one `UICard` per world pose and add it directly to its owning script.
Use `sizeX` and `sizeY` for meters and `pixelSize` for layout-unit density.
Partition the card with nested `UIPanel` flex layouts.

Use `UIButton` for an action. Give icon-only buttons an `ariaLabel`. Update
`button.disabled` to block interaction and expose the disabled semantic state.
Use `UIPanel` hover hooks for visual feedback.

## Shared interaction

Cards use the same manipulation system as every other `Object3D`:

```js
const card = new UICard({
  sizeX: 0.8,
  sizeY: 0.5,
  manipulation: {
    actions: {translate: {faceCamera: true}, scale: true},
    handle: {action: xb.ManipulationAction.Translate},
  },
});
```

Add `FaceCamera`, `FollowHead`, `FollowObject`, or `VisibilityTransition` as
children. The manipulation manager suspends these transform scripts during a
session and rebases them when the session ends.

## Diagnostic order

1. Confirm all import-map peers resolve and that `xrblocks` points to the same
   build as the app.
2. Confirm the `UICard` is added to an initialized script and has nonzero
   `sizeX`, `sizeY`, and `pixelSize`.
3. Confirm the target is a `UIButton` or a `UIPanel` with interaction hooks and
   that no ancestor has `pointerEvents = 'none'` or
   `interactionEnabled = false`.
4. Confirm the manipulation owner has a valid `xb.manipulation` config and that
   child handles request an enabled action.
5. Check the surface in mouse simulation and the intended XR input path.

Use `samples/uiblocks/index.html` as executable truth.
