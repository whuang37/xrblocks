---
title: Configuration and startup
slug: /sdk/configuration
sidebar_position: 2
---

# Configuration and startup

Configure one `Options` instance before calling `xb.init()`. Helpers enable
common feature combinations; nested options tune a specific subsystem.

```js
const options = new xb.Options();
options.enableHands();
options.enablePlaneDetection();
options.xrButton.showEnterSimulatorButton = true;
await xb.init(options);
```

Changing an options object later does not reconstruct the running subsystem.
Use a documented runtime method when a setting must change during a session.
Exact fields and defaults belong to the [Options reference](/api/classes/Options).

## Choose the runtime

| Setting                                            | Startup effect                                    |
| -------------------------------------------------- | ------------------------------------------------- |
| Default `formFactor: 'auto'`                       | Allows the SDK's XR/simulator entry flow.         |
| `options.formFactor = 'desktop'`                   | Enables and autostarts the simulator.             |
| `options.xrButton.showEnterSimulatorButton = true` | Offers simulator entry explicitly.                |
| `await xb.core.startSimulator()`                   | Starts the simulator after engine initialization. |
| `options.enableSimulator = false`                  | Disables the simulator path.                      |

`formFactor` is a preset, not physical-device detection. Its setter changes
simulator flags; assigning it after related fields can overwrite those fields.
`?formFactor=desktop` is useful for testing without editing application code.

## Choose an XR session

The default request is `immersive-ar`. `fallbackToVR` allows `immersive-vr`
when AR is unavailable, unless required camera-access or depth-sensing features
prevent that fallback. To request VR deliberately:

```js
const options = new xb.Options();
options.enableVR();
await xb.init(options);
```

Set `webxrRequiredFeatures` for capabilities the app must have and
`webxrOptionalFeatures` for enhancements. Feature helpers supply their own
requirements. Declare [permissions](/get-started/capabilities) before entry.

## Let the SDK own startup

The engine creates its canvas unless `options.canvas` supplies one. It owns
entry buttons, renderer setup, and the animation loop. Built-in UI mounts
when a UI root enters the scene; there is no separate UI startup call.

Keep [simulator environment settings](/sdk/simulator/environments) separate
from app behavior. Configure [physics](/sdk/physics) by supplying Rapier;
configure [rendering](/sdk/rendering) only for a stated image-output need.

[Simulator setup source](https://github.com/google/xrblocks/blob/main/templates/14_simulator_setup/main.js) ·
[Run the app](/get-started/run) · [Startup troubleshooting](/sdk/troubleshooting)
