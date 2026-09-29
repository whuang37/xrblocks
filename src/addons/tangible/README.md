# Tangible surface widgets

Register a textured surface at the camera centre, then attach any XR Blocks
widget to it. This follows the central-image registration and KLT tracking
approach in [AhUI, section 3.1](https://duruofei.com/papers/Du_OpportunisticInterfacesForAugmentedReality-TransformingEverydayObjectsIntoTangible6DoFInterfacesUsingAdHocUI_CHI2022.pdf),
with XR depth and rigid 3D fitting in place of its planar pose solver.

The addon has no object detector, category names, confidence threshold, or
recognition model. It loads only OpenCV JS/WASM. Flat and curved rigid surfaces
can work, provided they supply enough image features and valid depth.

## Setup

```js
import * as xb from 'xrblocks';
import {TangibleWidgets} from 'xrblocks/addons/tangible/index.js';

const tracker = new TangibleWidgets({
  widgets: {
    timer: {
      create() {
        const panel = new xb.UICard({
          size: {width: 0.25, height: 0.2},
          manipulation: false,
        });
        panel.add(new xb.UIText({text: 'My timer'}));
        panel.position.z = 0.025;
        return panel;
      },
    },
  },
});
xb.add(tracker);

const options = new xb.Options();
options.enableCamera('environment');
options.deviceCamera.willCaptureFrequently = true;
options.enableDepth();
options.depth.depthMesh.patchHoles = false;
options.depth.depthMesh.updateFullResolutionGeometry = true;
options.depth.depthMesh.depthMeshUpdateFps = 30;
options.enableReticles();
await xb.init(options);

// Call from a button or gesture when the tracker is ready and the surface is aimed.
tracker.register('timer');
```

Widget IDs belong to the application. They do not describe or restrict the
physical object. `register(id)` returns false while loading, after disposal, or
on a fatal error; it throws for an unknown widget ID. A successful request
captures the next available camera frame. Hold the object still until `tracked`.

## Registration and tracking

The registration square spans 52% of the shorter image dimension, matching the
paper's approximate central region. Fill that square with one textured surface.
The demo draws the exact square in its camera preview. It is not a segmentation
mask and does not find the nearest object across the whole scene.

OpenCV extracts up to 100 features inside the square. Registration requires at
least 12 features with valid depth, within 15 cm of the depth at the square's
centre. Missing centre depth or insufficient features reports a specific failure.
Background beyond that depth band is excluded. Points on fingers or nearby
background can still contaminate a registration; keep them outside the square.

The tracker follows matching image features and fits a rigid transform from their
3D depth positions. Its full depth geometry must be enabled; the default coarse
collision mesh is insufficient. It never fills missing depth with a guessed plane.
This version needs fresh depth throughout tracking. It is not pure-depth tracking
or an implementation of the paper's depth-free planar pose solver.

`target` is the widget's parent in metres. Its initial origin is the centroid of
the registered points, with X right, Y up, and +Z toward the viewer. Put content
at local Z = 0.025 for a flat panel above the patch, including on curved objects.
`patchSize` measures the visible registered features, not the whole object.

The final position and quaternion use a time-based exponential low-pass filter,
with a default `poseSmoothingMs: 100` time constant. Larger values reduce jitter
but add response lag; set it to `0` to disable filtering. Tilt, twist, and recenter
use that same filtered orientation. A new registration starts at its measured
pose without blending from the old attachment. Depth fitting, residual checks,
and observation freshness use the original measurements, not filtered values.

`tilt` reports yaw/pitch relative to the neutral orientation, normalized to ±1 at
30 degrees. `twist` reports local roll in radians. `recenter()` sets the current
tracked orientation as neutral. Ordinary child buttons use XR Blocks ray/pinch
input. The addon does not detect fingertip contact.

Loss hides content and disables interaction. Brief stale observations can recover
if feature tracking survives; full feature loss, a long camera gap, or failed
registration requires another explicit `register(id)`. It does not automatically
attach to a different surface. `reset()` clears content and returns to `idle`.
Widget content is owned and disposed by the tracker.

## Camera and performance

The raw XR camera path uses capture-frame pose and depth. The video-camera path
uses estimated timing and device calibration. That approximation can cause drift
or poor depth matches during motion. Clear camera pixels and accurate alignment
remain necessary; removing the detector does not solve camera calibration.

Camera input is capped at 480 pixels wide and tracking at 15 updates/second.
There is at most one worker request in flight. Idle/lost preview captures run at
4 fps with no worker tracking. `onCameraFrame(image, region)` can render a preview;
copy pixels synchronously because their buffer may be transferred afterwards.
The demo draws its preview at most four times per second.

Diagnostics report image/depth features, inliers, fit residual, capture latency,
depth indexing time, worker time, image/depth age, and the last failure.
These timings are not a complete headset rendering profile.

The version-pinned OpenCV 4.12.0 general-purpose runtime is about 10 MB and is
external to the SDK bundle. Override `assets.openCvUrl` to self-host it. No
MediaPipe or model assets are loaded by this addon. Disposal requests worker
shutdown, forces termination after 250 ms, and releases its depth lease.

## Demo and checks

Build with `npm run build:sdk`. Serve over HTTPS and open
`/demos/tangible_widgets/?debug=1`. See [device steps](../../../demos/tangible_widgets/README.md).
The demo may label an object once after registration in a separate worker. That
optional code belongs to the demo; it cannot select, reject, or move an attachment.

Run the focused lifecycle checks with `npx vitest run src/addons/tangible`.
To exercise the emitted worker with actual OpenCV WASM:

```sh
node tools/tangible/verify-worker.mjs /path/to/opencv.js
```

That check covers central-region feature extraction, image translation, tracking
loss, explicit re-registration, and disposal without any injected detector.
Device testing is still required for camera/depth alignment and sustained speed.
