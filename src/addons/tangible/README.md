# Tangible object widgets

An experimental, depth-assisted object tracker. Show a supported object type,
register its visible textured patch automatically, and attach an ordinary
XR Blocks widget to it. No physical dimensions, printed marker, or AI key are
needed. Both flat and curved **rigid** objects can supply the tracked points.

Recognition chooses the widget while searching. It stops while image features
are tracked and resumes after loss or manual reset. OpenCV
WASM tracks image features in a worker. The SDK pairs those features with XR
depth points and fits a rigid transform in metres. This version requires fresh
depth throughout tracking. It does not implement the paper's depth-free IPPE
mode or claim native performance parity.

## Setup

```js
import * as xb from 'xrblocks';
import {TangibleWidgets} from 'xrblocks/addons/tangible/index.js';

const tracker = new TangibleWidgets({
  widgets: {
    book: {
      create() {
        const panel = new xb.UICard({
          size: {width: 0.25, height: 0.2},
          manipulation: false,
          style: {padding: 12, backgroundColor: '#142230'},
        });
        panel.add(new xb.UIText({text: 'Reading companion'}));
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
```

This addon owns its recognizer; do not enable a second continuous object detector
just for it. Nothing is loaded until the script initializes. Dependencies are
injected through the engine registry. The base SDK has no new default workload.

## Registration and attachment

The default EfficientDet Lite0 model supplies category names such as `book`,
`cup`, and `bottle`. `widgets` maps supported category names to factories. The
tracker selects one supported object near the image centre and captures features
inside an inset detection box. Hold a printed or textured face steady during
registration. At least 12 usable image/depth features must span a surface.

`target` is the content parent. At registration its origin is the centroid of
the measured visible patch, with X right, Y up, and +Z toward the viewer. Content
then follows the estimated object translation and rotation. Put a flat panel at
local Z = 0.025 to float it just above the registered patch, including on a cup
or bottle. The widget does not wrap around the object, and the frame does not
claim to be the object's exact geometric centre or top.

`patchSize` measures the extent of the registered visible features. It is not
an estimate of the hidden back of the object or its full bounding box. Widget
size is an application choice. The example uses a fixed readable panel size.

The factory returns fresh content owned by the tracker. It is called on the
first accepted registration or when the category changes. It is not called on
every frame. `reset()` removes and disposes the content and restarts recognition.
If content has application resources such as timers or textures, release them
in its idempotent `dispose()` method. Do not share owned geometry/materials with
unrelated scene objects.

This is category recognition, not persistent recognition of a specific cup or
book. After full loss, a newly recognized object receives a new registration.
There is no saved object identity or front/back template library.

## Interaction and validity

- Use ordinary child `UIButton`, slider, and other spatial UI controls. They use
  the existing interaction system. Do not enable grab manipulation on the
  tracked attachment: tracking owns that transform.
- `tilt` provides normalized yaw/pitch from a neutral orientation, clamped at
  30 degrees with a small central dead zone. `twist` is the local roll angle in
  radians; it is not an unwrapped multi-turn dial.
- `recenter()` makes the current measured orientation the neutral pose.
- `state`, `status`, `label`, and `diagnostics` expose registration, validity,
  point count, fit residual, worker duration, and observation/depth age.
- On stale, missing, or inconsistent evidence, the attachment is hidden,
  interaction is disabled, and motion controls return to zero. Timer widgets
  can retain application state while hidden. Tracking never silently holds a
  stale pose as a current observation.

The tracker uses rigid point registration, not a planar homography, so a
textured bottle can be used as a 6DoF control. Plain, reflective, transparent,
symmetric, small, or heavily occluded objects can fail. A category bounding box
is not a segmentation mask: background or fingers can contaminate registration.
Use a clear view of the object's textured face. Rotation that hides all registered
features requires a new registration; uninterrupted 360-degree tracking is not
supported.

## Camera and depth alignment

Use an Android XR browser that exposes both the environment camera and XR depth.
The demo must be served in a secure context, normally HTTPS on a headset.
WebAssembly support alone does not establish camera/depth availability.

The raw WebXR camera path saves the matching XRView projection and pose with the
capture-frame depth. The media-stream path uses the SDK's device camera profile
and current depth; its timing is estimated. Diagnostics distinguish these paths.
Camera/depth exposure times can differ and the media-stream profile is approximate,
so fast object/head motion can cause misalignment. Hardware validation is still
required. An ordinary webcam without depth cannot run this mode.

The depth index projects real depth-mesh vertices into RGB coordinates and keeps
nearest visible points. It searches a small neighbourhood to accommodate coarse
depth resolution. It does not fill large holes with an invented plane. Configure
`patchHoles: false`; the example does this. A depth residual measures internal fit
consistency, not absolute camera calibration accuracy.

Enable `updateFullResolutionGeometry: true`. The usual 40 by 40 collision mesh
is too coarse for small handheld patches; this addon uses the full depth geometry
and reports a setup error when full updates are disabled.

## Runtime assets and performance

The default assets are version-pinned URLs for MediaPipe 0.10.34, EfficientDet
Lite0 model version 1, and OpenCV 4.12.0. They download on first use, then recognition
and tracking execute locally. No images are sent to a cloud inference service.
Asset hosts still receive ordinary file requests.

OpenCV uses a separate classic worker because the WASM loaders use
`importScripts`. Deploy `build/addons/tangible/` together with the rest of the SDK
build. No import-map entries are required inside the worker. The default OpenCV
build is a general-purpose, approximately 10 MB JS/WASM asset, **not a custom SIMD
build**. It is external to the SDK bundle. Override `assets` with self-hosted
compatible runtime/model files, or an optimized OpenCV classic build exposing
`Mat`, `goodFeaturesToTrack`, `cvtColor`, and `calcOpticalFlowPyrLK`.

```js
const tracker = new TangibleWidgets({
  widgets,
  assets: {
    openCvUrl: '/vendor/opencv.js',
    visionModuleUrl: '/vendor/vision_bundle.mjs',
    visionWasmUrl: '/vendor/wasm',
    modelUrl: '/vendor/efficientdet_lite0.tflite',
  },
});
```

One worker handles recognition and optical flow. There is at most one frame in
flight; camera snapshots are capped at 480 pixels wide and 15 updates/second by
default. While searching, captures run at the recognition interval (1.5 seconds
by default). Duplicate media frames are skipped. Camera matrices are computed
only for captures, and the worker retains the grayscale frame without copying it.
Rigid pose fitting accepts an all-point fit immediately when every point agrees;
outlier sampling is reserved for inconsistent measurements. Raw XR camera images
are resized on the GPU before readback. Camera readback still occurs on the render
thread, and depth indexing/rigid fitting run in TypeScript. Measure
end-to-end latency and sustained frame rate on the target headset; this is a
working first implementation, not a certified performance result.

Disposal requests worker shutdown, forces termination after a 250 ms grace period,
and releases the addon's depth lease and content. It does not stop the shared
camera or other depth clients.

## Demo and verification

Run `npm run build:sdk`, then `npm run serve`. Open
`/demos/tangible_widgets/` through your HTTPS development host on Android XR.
The demo provides a book reading widget, cup timer, and bottle tilt control.
It also exposes a diagnostics panel and registration/neutral buttons.
See [demo instructions](../../../demos/tangible_widgets/README.md).

For an actual WASM optical-flow check, download the pinned `openCvUrl` to a local file, build the SDK,
and run:

```sh
node tools/tangible/verify-worker.mjs /path/to/opencv.js
```

That check runs the emitted worker and real OpenCV WASM on translated textured
images, tests tracking loss, and closes the worker runtime. It injects category
recognition and is not evidence of real-camera recognition or headset accuracy.

## Device diagnosis

The demo keeps the last tracking failure visible. Compare image features with
depth features: image features with few depth matches point to depth coverage
or camera alignment; no image features points to detection or texture.
`captureMs` measures snapshot latency (including the XR-frame wait on the raw
camera path), `depthIndexMs` measures depth indexing, and `processingMs` measures
worker time. `recognitionMs` and `opticalFlowMs` separate detection from tracking
inside that worker time. These are not a complete rendering profile. `observationAgeMs`
shows why a result was rejected by the unchanged 500 ms freshness limit.

Slow first recognition can be rejected as stale; the next frame can still use
its image features to start fresh tracking. Worker processing time does not
count toward the 600 ms idle-gap reset. Depth and rigid-fit checks still apply.
