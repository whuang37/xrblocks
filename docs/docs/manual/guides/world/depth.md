---
title: Depth and occlusion
slug: /sdk/world/depth
---

# Depth and occlusion

Depth supplies distances from the current view. XR Blocks can turn that evidence
into raycast geometry, occlusion data, and optional environment colliders.
The simulator produces synthetic depth from its room.

## Enable depth

```js
const options = new xb.Options();
options.enableDepth();
await xb.init(options);
```

The helper installs the normal live-mesh preset. It affects session setup, so
configure it before initialization. The SDK owns sensor acquisition and mesh
updates; application Scripts do not manage internal sensor pause/resume calls.

## Read current data

`xb.depth.depthData` holds available per-view data. `depthArray` contains decoded
values, and `rawValueToMeters` converts raw values. `getDepth(u, v)` reads the
left view at normalized UVs with a bottom-left origin. `depthMesh` is the
reconstructed geometry; `depthTextures` supplies supported GPU paths.

Guard missing data at startup and after sensor loss. Clear an old measurement
rather than presenting it as current evidence.

## Occlude virtual content

After enabling depth:

```js
const viewer = new xb.ModelViewer({occlusion: true});
this.add(viewer);
await viewer.load('./model.glb');
```

This fragment belongs in a Script. Supported loaded glTF materials receive the
occlusion integration. A transparent material alone does not implement depth
occlusion or change pointer participation. Custom materials need their own
shader integration and cleanup; follow the
[occlusion sample](https://github.com/google/xrblocks/blob/main/samples/xr_realism/occlusion/main.js).

## Geometry cost and collision

The normal preset uses downsampled raycast/collision geometry. Full-resolution
updates cost more CPU/GPU time. Tune `depthMeshUpdateFps`, geometry resolution,
and `colliderUpdateFps` only for a measured requirement, then test on device.

Depth does not enable physics. Supply Rapier separately through
`options.physics.RAPIER`. `xrDepthMeshPhysicsOptions` selects geometry/rendering
choices; it is not the physics switch. Native noise and incomplete coverage can
make collisions unstable, so provide a reset for trapped objects.

Use [reticle projection](/sdk/interaction/feedback) for surface feedback.
See [DepthOptions](/api/classes/DepthOptions) for presets and exact settings.

## Lifetime and checks

Depth resources remain alive for XR re-entry. Terminal `xb.core.dispose()`
releases them before physics and renderer shutdown. Do not dispose the service
on ordinary session exit.

Check warming-up, missing-data, and loss states. Device acceptance also needs
sensor accuracy, occlusion edges, and frame-cost checks.

[Depth map](https://xrblocks.github.io/samples/xr_realism/depthmap/) ·
[Depth mesh](https://xrblocks.github.io/samples/xr_realism/depthmesh/) ·
[Occlusion](https://xrblocks.github.io/samples/xr_realism/occlusion/) · [Physics](/sdk/physics)
