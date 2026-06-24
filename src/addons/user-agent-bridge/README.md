# user-agent-bridge

Externally injected bridge for agent runners.

`user-agent-bridge` is not imported by normal XR Blocks apps. A runner opens an
existing page, waits for `globalThis.__XRBLOCKS__.simulatorReady`, imports this
addon, and calls `installUserAgentBridge()`. The addon installs
`globalThis.userAgentBridge` with methods for observation, deterministic
stepping, semantic commands, inspection, and disposal.

The bridge reuses the active XR Blocks runtime and does not create a second app
instance. It composes `EmbodiedControl` for actions and `SensorsManager` for
observations.

```js
const mod = await import('/build/addons/user-agent-bridge/index.js');
await mod.installUserAgentBridge({
  dtMs: 50,
  sensors: ['state', 'visibility', 'targeting', 'sceneGraph', 'userView'],
});

const observation = await globalThis.userAgentBridge.observe();
await globalThis.userAgentBridge.step({
  camera: {move: [0, 0, -0.05], rotate: [0, 2, 0]},
  rightHand: {move: [0, 0, -0.01]},
});
```

Sensor observations are backed by the `xrblocks/addons/sensors` facade and
`SensorsManager`, so bridge keys map to the current sensor classes:

- `state` -> `ProprioceptionSensor`
- `visibility` / `visibleObjects` -> `VisibilitySensor`
- `targeting` -> `TargetingSensor`
- `sceneGraph` -> `SceneGraphSensor`
- `deviceCameraView` / `screenshotCamera` -> `DeviceCameraViewSensor`
- `userView` / `screenshotXR` -> `UserViewSensor`
- `somView` / `screenshotSOM` -> `SOMViewSensor`
- `depth` -> `DepthSensor`

The public addon entrypoint remains `index.js`; the implementation lives in
`UserAgentBridge.ts`.
