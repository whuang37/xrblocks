---
title: Rendering, lighting, and effects
slug: /sdk/rendering
sidebar_position: 19
---

# Rendering, lighting, and effects

The SDK creates the renderer and frame loop. Configure image-output requirements
before initialization; keep application effects within the supported backend.

## Select a backend

WebGL is the default. Use `new xb.Options().enableWebGPU()` to select the
WebGPU renderer path. Browser modules also need `three/webgpu` and `three/tsl`
mappings at the same Three.js version as `three`.

The [WebGPU UI example](https://github.com/google/xrblocks/blob/main/samples/spatial_ui/webgpu/index.html) contains
the complete dependency map and registration required by its UIKit fork.
Do not assume the ordinary WebGL UI dependency map supplies that path.
On XR devices without `XRGPUBinding`, the SDK can use WebGPURenderer's WebGL
backend. Read the active backend when checking device behavior.

Current integration limits include Spark splats on WebGL only, no immersive-XR
postprocessing on WebGPU, no raw XR camera-access path on WebGPU, and no
GPU-optimized XR depth on WebGPU. Use CPU depth there. Native WebGPU XR also
requires the browser to expose and grant its binding/session feature.

## Light the scene

Add explicit Three.js lights for predictable app lighting. Native light
estimation is optional under `options.lighting`; enable its directional and/or
ambient components deliberately. Missing estimates need a useful fallback.
WebGPU light estimation does not provide real-world reflection cube maps.

Framebuffer scale, supported target frame rate, and foveation affect output
cost. The SDK applies frame-rate requests only when the session advertises and
implements them. Do not use a requested rate as proof of the measured rate.
See [Options](/api/classes/Options) and [LightingOptions](/api/classes/LightingOptions).

## Postprocessing and capture

Set `options.usePostprocessing = true` only when registering a supported pass.
In a Script's `init()`, add it to `xb.core.effects`. Pass order is render order;
the effects owner disposes registered passes at terminal shutdown. A custom
pass releases its own GPU resources from `dispose()`. The immersive pipeline
needs a pass to copy/transform the offscreen result, so do not enable it with
an empty pass list.

`xb.core.screenshotSynthesizer.getScreenshot()` captures virtual content.
Pass `true` to overlay it on a configured device camera. Handle a rejected
capture, including a missing camera. See the
[depth visualization pass](https://github.com/google/xrblocks/blob/main/samples/xr_realism/depthmap/main.js).

## Background transitions

Configure `options.enableXRTransitions()` before initialization. At runtime,
`xb.core.transition?.toVR({color: 0x101828})` fades toward a virtual background;
`toAR()` fades back. `targetAlpha` controls the requested opacity.

These calls change the visual background inside the current session. Use
`options.enableVR()` before startup to request an actual immersive-VR session.
`VisibilityTransition` instead animates one object's scale/visibility.

[Run XR backgrounds](https://xrblocks.github.io/templates/09_xr_modes/) ·
[XREffects reference](/api/classes/XREffects) ·
[Media layers](/sdk/media) · [Startup](/sdk/configuration)
