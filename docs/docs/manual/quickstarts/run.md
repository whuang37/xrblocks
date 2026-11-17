---
title: Run in the simulator and XR
slug: /get-started/run
sidebar_position: 5
---

# Run in the simulator and XR

Use the desktop simulator for the first interaction check, then run the same
app on the target device for hardware-dependent behavior.

## Desktop startup

To offer simulator entry explicitly:

```js
const options = new xb.Options();
options.xrButton.showEnterSimulatorButton = true;
await xb.init(options);
```

Choose **Enter Simulator**. The button stays visible and disabled while startup
runs; a failure leaves an error and a retry path. To autostart on desktop,
set `options.formFactor = 'desktop'` before initialization, or use
`?formFactor=desktop` on a page that constructs `Options`.

The simulator loads on demand. On the autostart path, `await xb.init(options)`
waits for that load. `xb.core.simulator` is unavailable before startup finishes.
For an explicit start after engine initialization:

```js
await xb.init(options);
const simulator = await xb.core.startSimulator();
```

See [controls](/sdk/simulator) for movement and input modes. Browser settings
and instruction panels require Lit, which the quickstart installs.

## Device startup

1. Serve the app from a secure origin reachable by the device.
2. Open it in the device browser and choose **Enter XR**.
3. Grant the permissions the app requests before entering the immersive session.
4. Test a complete interaction, exit, and enter again.

The default requested session is `immersive-ar`. The SDK can fall back to VR
when AR is unavailable and required sensing features permit it. Use
[session configuration](/sdk/configuration) for explicit session requirements.

## What to check

The app should show its initial content at a useful physical size and position.
Input should produce the same application result on each path. Camera, depth,
hand tracking, persistence, and display readability still need device checks.
See [capabilities](/get-started/capabilities) and
[troubleshooting](/sdk/troubleshooting) for missing features or failed entry.
