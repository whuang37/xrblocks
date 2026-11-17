---
title: Place, follow, and show content
slug: /sdk/placement
sidebar_position: 9
---

# Place, follow, and show content

Choose between placing an object once and updating its relationship to a target.
Placement scripts update their parent. They are not native spatial anchors.

## Choose a behavior

| Behavior                                            | Helper                                |
| --------------------------------------------------- | ------------------------------------- |
| Place on an available horizontal surface once       | `xb.world.placeOnHorizontalSurface()` |
| Follow an offset relative to the viewer             | `FollowHead`                          |
| Follow another object's position, rotation, or pose | `FollowObject`                        |
| Turn toward the viewer                              | `FaceCamera`                          |
| Orbit a separate target                             | `Orbit`                               |
| Animate scale and visibility                        | `VisibilityTransition`                |

## Keep a card near the viewer

This fragment assumes `card` is a `UICard` and imports `THREE` and `xb`:

```js
const follow = new xb.FollowHead({offset: new THREE.Vector3(0, -0.15, -0.9)});
card.add(follow, new xb.FaceCamera({mode: 'capsule'}));
```

`FollowHead` updates position with smoothing. `FaceCamera` owns orientation.
Its default capsule mode stays upright near eye height, then tilts toward the
viewer above or below that region. Cylindrical mode stays upright; spherical
mode faces the camera in all directions. Put these Scripts on the card root,
not inside a nested `UIPanel`.

Use a `UIOverlay` for fixed view-space content. A following card remains a
world-space object and can move through the scene. Test motion and occlusion
when the user turns or walks.

## Show and hide content

```js
const visibility = new xb.VisibilityTransition({duration: 0.3});
card.visible = false;
card.add(visibility);
// Later, after initialization:
visibility.show();
```

The helper animates its parent's scale and visible state. Duration is seconds.
Do not assign the same scale from another updater while it runs. Following
position alone does not define a visibility policy; use an explicit transition
or `visible` state when the app must hide content.

## Combine behaviors

A position-only `FollowObject` plus `FaceCamera` can make a tracking label.
`Orbit` plus `FaceCamera` can keep orbiting content readable. A position Script
can combine with a visibility transition. Avoid two position or rotation writers
on the same object. Orbit targets must be separate scene branches.

Automatic manipulation suspends direct `TransformScript` children, then resumes
them from the manipulated pose. For an application-controlled move:

```js
follow.suspend();
card.position.set(0.4, 1.4, -1);
follow.resume();
```

`resume()` rebases the follow offset. This preserves the new relationship
instead of snapping back to the original offset.

## Place once

Enable planes, meshes, or depth as needed before initialization. Then:

```js
const placed = await xb.world.placeOnHorizontalSurface(object, {seconds: 15});
object.visible = placed;
```

A `false` result means no suitable surface was found. This sets a transform;
use [anchors](/sdk/anchors) when the platform should maintain a physical location.

[Placement starter](https://xrblocks.github.io/templates/03_spatial_placement/) ·
[FollowHead reference](/api/classes/FollowHead) · [TransformScript reference](/api/classes/TransformScript) ·
[Manipulation](/sdk/interaction)
