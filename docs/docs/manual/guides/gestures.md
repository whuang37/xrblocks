---
title: Hands and gestures
slug: /sdk/gestures
sidebar_position: 8
---

# Hands and gestures

Hand tracking supplies poses and direct touch. Gesture recognition classifies
those poses. Basic selection and manipulation do not require a custom gesture
recognizer.

## Track hands

```js
const options = new xb.Options();
options.enableHands();
```

This requests optional WebXR hand tracking. Keep a controller or other input
path when hands are unavailable. Add `hand-tracking` to required features only
when the app cannot work without it.

Read a joint after tracking is active:

```js
const tip = xb.user.hands?.getIndexTip(0);
if (tip) tip.getWorldPosition(worldPosition);
```

Here `worldPosition` is an application-owned `THREE.Vector3`. Joint objects
live in a reference hierarchy, so read world coordinates explicitly. Joint names
come from `xb.HAND_JOINT_NAMES`. Never reuse the last joint position as fresh
input after tracking loss.

`options.hands.visualization`, `visualizeJoints`, and `visualizeMeshes` control
native hand debug visuals. Simulator hand rendering has its own controls.
Joint spheres are tracking diagnostics, not a requirement for hand interaction.

## Recognize hand poses

```js
options.enableGestures();
options.gestures.setGestureEnabled('point', true);
options.gestures.setGestureEnabled('spread', true);
```

In a Script's `init()`, subscribe to the enabled service:

```js
this.gestures = xb.core.gestureRecognition;
this.onGesture = (event) => console.log(event.detail.hand, event.detail.name);
this.gestures?.addEventListener('gesturestart', this.onGesture);
```

Remove that listener in `dispose()`. `gesturestart`, `gestureupdate`, and
`gestureend` describe recognized poses. Confidence thresholds and update cadence
belong to [GestureRecognitionOptions](/api/classes/GestureRecognitionOptions).

## Recognize head motions

Enable `options.enableHeadGestures()` and listen to
`xb.input.headGestures` for `gesture`. Built-in completed motions include `nod`,
`shake`, and directional variants. A completed motion can emit both generic and
directional names; subscribe to the intended one to avoid duplicate actions.
Head gestures need camera pose, not tracked hands.

## Extend recognition

A `PoseEstimator` supplies canonical hand contexts; a `GestureRecognizer`
returns named confidence scores. Select them before initialization with
`setPoseEstimator()` and `setGestureRecognizer()`. Use consistent joint names,
units, handedness, and local/world coordinates. The SDK supplies timing and event
lifecycle. See [PoseEstimator](/api/interfaces/PoseEstimator) and
[GestureRecognizer](/api/interfaces/GestureRecognizer) for the contracts.

[Run the gesture inspector](https://xrblocks.github.io/templates/12_hand_gestures/) ·
[Source](https://github.com/google/xrblocks/blob/main/templates/12_hand_gestures/GestureInspector.js) ·
[Head gesture sample](https://xrblocks.github.io/samples/xr_interaction/head_gestures/) ·
[Direct interaction](/sdk/input)
