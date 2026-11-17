---
title: Reticles and interaction feedback
slug: /sdk/interaction/feedback
---

# Reticles and interaction feedback

A reticle shows the interaction system's resolved hit. Read target data from
interaction events or `xb.user` queries; the reticle is a visual indicator.

## Use the built-in feedback

Reticles are enabled by default. The disc has a dark border, scales with distance,
and shrinks with a more opaque fill during selection. An optional hover ring
marks interactive targets:

```js
const options = new xb.Options();
options.reticles.hoverRing = true;
```

Use `scaleWithDistance = false` for a fixed world size, or `enabled = false` to
hide the indicator. `maxDistance` limits drawing distance, not targeting range.
`defaultRenderDistance` controls placement on a miss; its default of zero hides
the reticle when there is no valid hit.

## Project onto the environment

```js
options.enableDepth();
options.reticles.projectOnDepthMesh = true;
```

This adds depth geometry as a reticle surface when data is available. It does
not turn a wall into a logical app target or create another hit-data API.
Inside an event, use `event.intersection`; outside it, use
`xb.user.getRayIntersection(controllerId)`.

## Pair feedback with state

Use control labels and visible status for operations that wait or fail. A
hover cursor alone does not explain whether an AI session connected or a
placement was saved. Hand keypoints and ray debug lines help inspect tracking;
they are separate from user-facing target feedback.

Check a hit, a miss, selection, disabled/hidden targets, and tracking loss. On a
device, check visibility over bright and dark real backgrounds.

[ReticleOptions reference](/api/classes/ReticleOptions) ·
[Run the reticle sample](https://xrblocks.github.io/samples/xr_realism/reticle/) ·
[Input events](/sdk/input) · [Depth](/sdk/world/depth)
