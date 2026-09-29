# Tangible surface widgets

Register a textured surface at the camera centre, then attach any XR Blocks
widget to it. This follows the central-image registration and KLT tracking
approach in [AhUI, section 3.1](https://duruofei.com/papers/Du_OpportunisticInterfacesForAugmentedReality-TransformingEverydayObjectsIntoTangible6DoFInterfacesUsingAdHocUI_CHI2022.pdf),
with an XR depth feature map and a 3D-to-2D pose solver.

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
tries camera/depth frames for up to 10 seconds. Hold the object still until
`tracked`; missing samples retry without another button press.

## Registration and tracking

The registration square spans 52% of the shorter image dimension, matching the
paper's approximate central region. Fill that square with one textured surface.
The demo has no camera preview. It is not a segmentation
mask and does not find the nearest object across the whole scene.

OpenCV extracts up to 100 features inside the square. Registration requires at
least 12 features with valid depth, within 15 cm of the depth at the square's
centre. Missing centre depth or insufficient features reports the retry reason.
Nearby depth samples are projected onto each feature’s camera ray, so depth
resolution does not introduce a fixed image-coordinate mismatch.
Background beyond that depth band is excluded. Points on fingers or nearby
background can still contaminate a registration; keep them outside the square.

Depth creates a fixed 3D feature map during registration. Later frames track the
same image features and solve their pose with OpenCV PnP-RANSAC in the worker.
This supports flat and curved rigid surfaces without fitting a plane. At least
six matches and a majority of inliers must pass the reprojection check (default
`maxReprojectionErrorPx: 3`). Keep the registered texture visible.

Full depth geometry is required for registration; the coarse collision mesh is
insufficient. The tracker releases its depth lease after registration and does
not rebuild the map or sample depth during motion. Other depth consumers can
still keep depth active. Re-register to refresh the map. Initial depth errors
remain in the map; this does not provide tracking through occlusion or a full
360-degree object model.

`target` is the widget's parent in metres. Its initial origin is the centroid of
the registered points, with X right, Y up, and +Z toward the viewer. Put content
at local Z = 0.025 for a flat panel above the patch, including on curved objects.
`patchSize` measures the visible registered features, not the whole object.

The final position and quaternion use a time-based exponential low-pass filter,
with a default `poseSmoothingMs: 40` time constant. Larger values reduce jitter
but add response lag; set it to `0` to disable filtering. Tilt, twist, and recenter
use that same filtered orientation. A new registration starts at its measured
pose without blending from the old attachment. Pose fitting, reprojection checks,
and observation freshness use the original measurements, not filtered values.

`tilt` reports yaw/pitch relative to the neutral orientation, normalized to ±1 at
30 degrees. `twist` reports local roll in radians. `recenter()` sets the current
tracked orientation as neutral. Ordinary child buttons use XR Blocks ray/pinch
input. The addon does not detect fingertip contact.

Brief rejected poses keep the last valid attachment until its age limit.
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

Camera input is capped at 480 pixels wide and tracking at 30 updates/second.
There is at most one worker request in flight. Where ImageBitmap and
OffscreenCanvas are available, the video path transfers a resized bitmap and
converts pixels inside the worker. Raw XR capture and unsupported video paths
still use main-thread pixel readback. Pose solving uses CPU WASM, not the GPU.

Inactive tracking does not capture camera frames. No preview is rendered.
`onRegistrationImage(image)` optionally receives the successful registration
image once, for uses such as the demo label. Tracking frames return only feature
and pose data. Diagnostics report
registered depth features, current image features, inliers, reprojection error
in pixels, capture latency, depth indexing time, worker time, and image age.
Depth age grows after registration by design. These timings are not a complete
headset rendering profile, and the frame-rate cap is not a speed guarantee.

The version-pinned OpenCV 4.12.0 general-purpose runtime is about 10 MB and is
external to the SDK bundle. Override `assets.openCvUrl` to self-host it. No
MediaPipe or model assets are loaded by this addon. Disposal requests worker
shutdown, forces termination after 250 ms, and releases its depth lease.

## Demo

Build with `npm run build:sdk`. Serve over HTTPS and open
`/demos/tangible_widgets/?debug=1`. See [device steps](../../../demos/tangible_widgets/README.md).
The demo may label an object once after registration in a separate worker. That
optional code belongs to the demo; it cannot select, reject, or move an attachment.

Device testing is required for camera/depth alignment and sustained speed.
