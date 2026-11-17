---
title: Load and present models
slug: /sdk/models
sidebar_position: 14
---

# Load and present models

Use `ModelViewer` to load and present a model with standard move, rotate, and
scale behavior. Use a dedicated Script when the application needs to own the
asset hierarchy or animation system directly.

## Load a model

Add the viewer to a mounted Script before awaiting its load:

```js
const viewer = new xb.ModelViewer({
  origin: 'bottom-center',
  manipulation: true,
});
viewer.position.set(0, 0.7, -1.2);
this.add(viewer);
await viewer.load('./model.glb');
```

This fragment belongs in a Script's async `init()`. Add suitable lights for
lit materials and handle load failures in visible application state.
`load()` accepts a URL or `ModelSource`; supported formats include glTF/GLB and
Spark-backed splat formats. Splats need `@sparkjsdev/spark` and the WebGL path.

## Set physical size

Asset transforms are applied before local bounds and origin alignment. The
viewer transform then places and scales that result in its parent hierarchy.
Correct authored units through `ModelSource.scale`; set a physical presentation
size through the viewer:

```js
const size = viewer.boundingBox.getSize(new THREE.Vector3());
if (size.y > 0) viewer.scale.setScalar(0.8 / size.y);
```

This fits the captured local height to 0.8 meters before ancestor scaling.
There is no meter-based `fit()` method. Origin choices are `bottom-center`,
`center`, and `source`; alignment changes loaded content, not viewer placement.

Bounds can be empty for custom renderables without computable geometry.
Captured bounds do not expand automatically for later animation or hierarchy
changes. Do not assume the content is a single Mesh.

## Ownership and animation

Models loaded with `load()` are viewer-owned and disposed on replacement or
viewer disposal. Content passed through `setContent(object)` remains caller-owned;
the caller must release its geometry, materials, and textures.

`autoplay` and `playAnimation()` start the loaded glTF clips. Own the animation
in a separate Script when named-clip selection or independent mixers are needed.
The viewer's user manipulation and the asset's animation act on different layers.

Private hit meshes resolve to the public viewer in interaction events. Configure
its public manipulation property rather than traversing those meshes. Enable
depth and use `occlusion: true` for the supported
[occlusion path](/sdk/world/depth).

[ModelViewer reference](/api/classes/ModelViewer) ·
[Run the model sample](https://xrblocks.github.io/samples/spatial_ui/modelviewer/) ·
[Coordinates](/sdk/coordinates) · [Placement](/sdk/placement)
