---
sidebar_position: 12
title: Object Manipulation
---

XR Blocks provides automatic translation, rotation, and scaling through one
optional `Object3D.xb` configuration. Applications do not create or register a
manager.

```js
object.xb = {
  manipulation: {
    actions: {
      translate: true,
      rotate: {axis: 'y', space: 'world'},
      scale: {minScale: 0.25, maxScale: 4},
    },
    handle: {action: xb.ManipulationAction.Translate},
  },
};
```

`object.xb.manipulation = true` enables the default Translate and Scale
actions. A selected owner translates until a second free spatial source starts
Scale.

## Child handles

A child surface can select an action for the nearest manipulation owner:

```js
platform.xb = {
  manipulationHandle: {action: xb.ManipulationAction.Translate},
};

modelSurface.xb = {
  manipulationHandle: {action: xb.ManipulationAction.Rotate},
};
```

Use `manipulationHandle: 'none'` when a child must allow selection but block
ancestor manipulation.

## Custom behavior

`onObjectManipulate(event)` receives balanced `start`, `update`, `end`, and
`cancel` phases. Call `event.preventDefault()` during `start` to keep capture
and callbacks while replacing the automatic transform.

```js
onObjectManipulate(event) {
  if (event.phase === 'start') event.preventDefault();
  if (event.phase === 'update' && event.action === xb.ManipulationAction.Translate) {
    this.position.x = event.position.x;
  }
}
```
