---
title: Input sources and events
slug: /sdk/input
sidebar_position: 6
---

# Input sources and events

Mouse, gaze, hand rays, tracked controllers, direct touch, and simulator inputs
use one interaction pipeline. It resolves a physical hit surface and a logical
target, then dispatches events through the target's Script ancestors.
Built-in UI uses this same path.

## Use the event's resolved hit

| Field           | Meaning                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| `source`        | Input source; `source.controller` identifies its controller.              |
| `target`        | Logical behavior owner captured for the action.                           |
| `surface`       | Public hit surface, which can differ from the logical target.             |
| `currentTarget` | Script currently receiving the bubbled callback.                          |
| `intersection`  | Current ray hit on the captured surface; can be absent after moving away. |
| `touchPosition` | World-space contact point for direct touch/grab.                          |

A private render mesh is normalized to its public owner. Use the event fields
inside a callback rather than repeating a raycast with another frame or capture
state. Outside events, `xb.user.getRayIntersection(controllerId)` reads the
current resolved ray hit.

## Choose targeted or global callbacks

`onObjectSelectStart` and `onObjectSelectEnd` handle a captured object selection.
Global `onSelectStart`, `onSelecting`, `onLongSelect`, `onSelect`, and
`onSelectEnd` observe selection across the scene unless suppressed.
`onSelect` runs for a completed selection; an end callback also runs for
cancellation, so inspect `completed` and `reason`.

End reasons include `released`, `released-outside`, `source-lost`,
`pointer-cancel`, `removed`, `hidden`, and `disabled`.

## Capture and propagation

| Control                   | Effect                                                                     |
| ------------------------- | -------------------------------------------------------------------------- |
| `stopPropagation()`       | Stops later ancestor callbacks.                                            |
| `stopGlobalPropagation()` | Suppresses remaining global selection callbacks.                           |
| `preventDefault()`        | Suppresses the proposed default touch/manipulation action where supported. |

These controls are independent. Stopping propagation does not stop an automatic
transform. UI controls suppress scene selection while they operate. If you
override their handlers, call the corresponding superclass handler to preserve
that behavior.

## Direct-contact lifecycle

| Action       | Begins                            | Ends                                         |
| ------------ | --------------------------------- | -------------------------------------------- |
| Touch        | Tracked index tip enters a target | Tip leaves or tracking is lost               |
| Selection    | Press, or touch unless prevented  | Release, contact end, or cancellation        |
| Grab         | Touching hand pinches             | Pinch ends or contact is lost                |
| Manipulation | Source claims an enabled action   | Release, cancellation, or owner invalidation |

A pinch release can end grab while contact and selection continue. Tracking loss
ends contact as `source-lost`, without completing a click. Use
`preventDefault()` in touch start when contact must not start selection.

`controllers.enabledMouse` means desktop mouse input acts as an input source.
It is not a setting for the simulator's walking or hand reach constraints.
Optional phone input is described in its
[existing addon documentation](https://github.com/google/xrblocks/blob/main/src/addons/phone-companion/README.md).

[Script reference](/api/classes/Script) · [Interaction reference](/api/classes/Interaction) ·
[Manipulate objects](/sdk/interaction) · [Reticles](/sdk/interaction/feedback)
