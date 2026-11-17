---
title: Planes and scene meshes
slug: /sdk/world/surfaces
---

# Planes and scene meshes

Use planes for coarse surfaces such as floors and tables. Use scene meshes for
reconstructed room geometry. Both depend on the active runtime's evidence and
can remain empty.

## Enable the needed geometry

```js
const options = new xb.Options();
options.enablePlaneDetection();
options.world.enableMeshDetection();
await xb.init(options);
```

Enable only the branches the app uses. A scene mesh is not the same as the
live mesh reconstructed from depth; see [depth](/sdk/world/depth).

## Place on a surface

```js
const placed = await xb.world.placeOnHorizontalSurface(model, {seconds: 15});
model.visible = placed;
```

The helper searches available geometry for a suitable horizontal placement.
Handle `false` as a normal unavailable result. It places once: it does not
anchor content or keep it facing the viewer. Add [placement behavior](/sdk/placement)
or an [anchor](/sdk/anchors) deliberately.

## Inspect geometry

Read scene meshes through `xb.world.meshes?.xrMeshToThreeMesh`. Debug views
help distinguish missing geometry from a misplaced app object:

```js
options.world.meshes.showDebugVisualizations = true;
```

Configure this before initialization. The simulator supplies geometry from its
environment. It cannot prove that a device will reconstruct the same surfaces,
semantics, or coverage. Use current evidence and handle removal or refinement.

When Rapier is configured, enabled scene meshes can create environment
colliders. Mesh detection does not enable physics on its own.

[Run Planes](https://xrblocks.github.io/templates/15_planes/) ·
[Planes source](https://github.com/google/xrblocks/blob/main/templates/15_planes/main.js) ·
[PlaneDetector reference](/api/classes/PlaneDetector) · [MeshDetector reference](/api/classes/MeshDetector) ·
[Physics](/sdk/physics)
