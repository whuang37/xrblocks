---
title: Select and manipulate objects
slug: /sdk/interaction
---

# Select and manipulate objects

Add object-specific callbacks to a Script or `MeshScript`. Let the interaction
system own targeting and automatic manipulation.

## Make a target

```js
class ColorBox extends xb.MeshScript {
  constructor() {
    super(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshBasicMaterial({color: 0x4285f4})
    );
    this.xb = {manipulation: true};
  }

  onObjectSelectEnd(event) {
    if (event.completed) this.material.color.setHex(0xfbbc04);
    event.stopPropagation();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
```

This fragment requires `THREE` and `xb` imports from the
[quickstart](/get-started/developer-quickstart). Add a `ColorBox` to the scene.
A completed selection changes its color. Grabbing preserves the initial
hand-to-object offset instead of snapping it to the wrist.

## Configure actions on the owner

```js
object.xb = {
  manipulation: {
    actions: {
      translate: {faceCamera: true},
      rotate: {axis: 'y', space: 'world'},
      scale: {minScale: 0.5, maxScale: 2},
    },
  },
};
```

A plain object's `manipulation: true` enables translation and scale.
`UICard` adds its panel move defaults and corner resize. `ModelViewer` provides
move, Y-axis rotation, and scale through its own interaction surfaces.

For cards, resize changes physical dimensions and reflows layout; scale changes
the whole object. Card translation supports viewer-facing orientation,
distance-based scale, ray smoothing, and controller thumbstick push/pull.
Override only the action properties the app needs. See
[ManipulationOptions](/api/interfaces/ManipulationOptions) for constraints and units.

Use a child handle to select one action:

```js
rotateHandle.xb = {manipulationHandle: {action: 'rotate'}};
object.add(rotateHandle);
```

## Observe ownership changes

`onObjectManipulate` reports `start`, `update`, `end`, and `cancel` with its owner,
action, primary source, and active sources. `preventDefault()` can replace the
proposed automatic transform. Do not also assign the same pose every frame.

Different sources can manipulate different owners. A second source can join a
scale-enabled owner; releasing it returns control to the primary action.
Hiding, removing, disabling, or reparenting an active owner cancels manipulation.
Store manipulation state per object when simultaneous actions are possible.

Direct `TransformScript` children suspend during manipulation and rebase when
it ends. Read [placement](/sdk/placement) before combining followers and grabbing.
Physics bodies need a separate ownership policy; see [physics](/sdk/physics).

Opacity, depth writes, and pointer participation are separate. Set
`object.xb.pointerEvents` for pointer behavior; `visible = false` removes the
branch from rendering and interaction.

[Run object interaction](https://xrblocks.github.io/templates/02_object_interaction/) ·
[Complete source](https://github.com/google/xrblocks/blob/main/templates/02_object_interaction/main.js) ·
[Event lifecycle](/sdk/input)
