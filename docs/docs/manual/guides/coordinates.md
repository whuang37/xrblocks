---
title: Coordinates, units, and transforms
slug: /sdk/coordinates
sidebar_position: 3
---

# Coordinates, units, and transforms

Three.js object transforms describe a scene hierarchy. XR Blocks uses meters
for physical world dimensions. A child position is relative to its parent;
use `getWorldPosition()` or `getWorldQuaternion()` for world-space values.

## Keep the unit systems separate

| Value                                                       | Unit                   |
| ----------------------------------------------------------- | ---------------------- |
| Geometry dimensions and scene positions                     | Meters                 |
| Fixed `UICard.size` dimensions                              | Meters                 |
| UI descendant padding, gap, font size, numeric width/height | UI layout units        |
| Three.js Euler rotations                                    | Radians                |
| Rapier cuboid dimensions                                    | Half-extents in meters |
| Frame delta from `xb.getDeltaTime()`                        | Seconds                |

A `BoxGeometry(0.2, 0.2, 0.2)` matches a Rapier cuboid with half-extents
`(0.1, 0.1, 0.1)`. A UI `fontSize: 24` does not mean 24 meters.

The default reference space is `local-floor`: the origin is at floor level.
The usual forward direction is negative Z, with Y up. Place an object relative
to the user or a sensed surface rather than assuming every session has the
same origin or user height.

## Give each transform one owner

A follower, manipulation action, physics body, and anchor can all update a
pose. Choose which owns each part of an object's transform. Two position
writers on the same object produce jumps or oscillation.

A position-only `FollowObject` can combine with `FaceCamera`, because they own
different transform parts. A following object should not also receive an
unrelated per-frame position assignment. Place UI and a mesh beneath a shared
Group when both should move as one assembly.

See [placement](/sdk/placement) for supported combinations and manipulation
rebasing, [models](/sdk/models) for scale/origin handling, and
[physics](/sdk/physics) for body ownership.

[Coordinate inspector source](https://github.com/google/xrblocks/tree/main/demos/coordinate_inspector) ·
[Run the inspector](https://xrblocks.github.io/demos/coordinate_inspector/)
