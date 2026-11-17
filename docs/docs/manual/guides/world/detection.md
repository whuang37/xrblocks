---
title: Objects, people, and faces
slug: /sdk/world/detection
---

# Objects, people, and faces

Choose a detector by the evidence the application needs. Camera detections can
be empty while models load, when no subject is visible, or when the runtime
cannot supply usable frames or depth.

## Object detection

For local MediaPipe detection:

```js
const options = new xb.Options();
options.enableObjectDetection();
options.enableDepth();
options.world.objects.backendConfig.activeBackend = 'mediapipe';
await xb.init(options);

const objects = await xb.world.objects.runDetection();
for (const object of objects) console.log(object.name, object.position);
```

The helper enables camera access; depth supports world-space grounding.
Gemini detection instead needs `enableAI()`, provider credentials, and
`activeBackend = 'gemini'`; it sends captured images to the provider.
[Provider setup](/integrations/ai-providers) owns credentials and data handling.

Concurrent calls without overrides share the active detection. Results replace
previous detected-object nodes. Clear application labels when a run returns an
empty array. Use matching `start(client)` / `stop(client)` calls for continuous
ownership and configure polling cadence before initialization.

A per-call `snapshot` can supply `imageData` for MediaPipe or a base64 data URL
for Gemini. Include both representations of one frame when sharing it between
backends. A missing required representation rejects rather than capturing a
different image. Simulator ground-truth override takes precedence over per-call
inputs; disable it when testing camera inference.

## People and faces

`enableHumanDetection()` enables camera and depth. Read poses with
`xb.world.humans.runDetection()` and guard each requested joint, for example
`pose.getJointPosition(xb.PoseJointName.LeftWrist)`.

`enableFaceDetection()` also enables camera and depth. Read
`xb.world.faces.runDetection()`; results can include world landmarks,
blendshapes, and a facial transform. Each is optional. Human and face detectors
support `start(client)` / `stop(client)` for continuous work.

Human inference uses a worker by default with the CPU delegate. Its MediaPipe
`useWorker` option can select main-thread inference instead. Measure rendering
cost before changing that tradeoff.

## Segmentation

`enableSegmentation()` enables a 2D camera operation without requiring depth.
`await xb.world.segmentation.runSegmentation()` returns a mask or `null`;
`latestMask` exposes the newest completed mask. Use `xb.SegmentCategory` for
category values.

## Desktop camera and calibration

The detection helpers choose an environment camera. In the simulator this
normally means the rendered room. For a real person at a desktop, call
`options.enableCamera('user')` after the detection helper. Keep simulator camera
registration enabled so world-space detection still has a camera pose.

On hardware, grounding uses estimated camera calibration profiles. Set
`options.deviceCamera.targetDevice` when automatic selection is unsuitable;
see [camera profiles](/sdk/camera#camera-profiles). This is not measured
per-device calibration supplied by the browser.

[Detection starter](https://xrblocks.github.io/templates/08_scene_understanding/) ·
[ObjectDetector reference](/api/classes/ObjectDetector) · [HumanRecognizer reference](/api/classes/HumanRecognizer) ·
[FaceRecognizer reference](/api/classes/FaceRecognizer) · [Segmenter reference](/api/classes/Segmenter)
