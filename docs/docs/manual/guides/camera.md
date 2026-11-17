---
title: Cameras, video, and snapshots
slug: /sdk/camera
sidebar_position: 15
---

# Cameras, video, and snapshots

Enable the device camera before initialization, then read the engine-owned
`xb.core.deviceCamera`. Camera permission, frame availability, and world-space
camera pose are separate runtime conditions.

```js
const options = new xb.Options();
options.enableCamera('environment');
await xb.init(options);
```

The helper declares camera permission and preserves other camera settings.
Use `'user'` for a desktop webcam or a user-facing camera path.

## Select and capture

Use `getAvailableDevices()`, `getCurrentDevice()`, `setDeviceId()`, and
`setFacingMode()` for the camera selection supported by the active path.
Native raw XR camera access and ordinary media-device streams have different
availability and backend restrictions.

For a current image in an async flow:

```js
const camera = xb.core.deviceCamera;
const image = await camera.captureSnapshot({outputFormat: 'imageData'});
if (image) console.log(image.width, image.height);
```

Use the [XRDeviceCamera reference](/api/classes/XRDeviceCamera) for output overloads.
`getSnapshot()` is also available for an already-readable source. Native XR
capture can need the next frame; prefer `captureSnapshot()` when waiting for
that frame is required. Handle missing or failed capture explicitly.

A camera snapshot captures the camera/environment view. Use
`xb.core.screenshotSynthesizer.getScreenshot()` for virtual content, or
`getScreenshot(true)` to composite with a configured camera. A missing camera
rejects overlay requests. See [rendering](/sdk/rendering).

## Camera profiles

World-space vision uses estimated intrinsics and camera-to-eye pose from
`DEVICE_CAMERA_PARAMETERS`. Profiles include `galaxyxr`, `aura`, and `quest3`.
Set `options.deviceCamera.targetDevice = 'aura'` when the runtime cannot choose
the needed profile. A valid `?camera=<profile>` overrides that setting.

The active camera's `targetDevice` can change at runtime. Detector-specific
`targetDevice` overrides follow their own contract; `undefined` resumes following
the camera. The simulator uses its own camera model and ignores hardware profiles.
Calibration estimates do not guarantee pixel-accurate world alignment.

## Desktop evidence and lifetime

An environment camera in the simulator normally sees the rendered room, not
virtual app objects or a real person. Select the user camera after a people/face
helper to inspect a person at the webcam. Do not disable simulator camera
registration: detection still needs its pose.

The SDK owns its configured stream. Release any separate stream the app creates.
Check permission denial, camera switching, lost frames, and session re-entry.

[Run camera view](https://xrblocks.github.io/templates/05_camera_view/) ·
[Complete source](https://github.com/google/xrblocks/blob/main/templates/05_camera_view/main.js) ·
[Detection](/sdk/world/detection) · [Media](/sdk/media)
