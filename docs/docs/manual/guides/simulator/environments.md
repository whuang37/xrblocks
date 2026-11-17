---
title: Simulator environments
slug: /sdk/simulator/environments
---

# Simulator environments

A simulator environment describes the room around the application. Keep room
geometry, navigation, reach limits, and synthetic evidence in simulator options
rather than rebuilding those features in app initialization.

## Load a manifest

```js
options.simulator.environments = [
  {name: 'My room', manifestPath: './room.json'},
];
options.simulator.activeEnvironmentIndex = 0;
```

A minimal `room.json` can be:

```json
{
  "scenePath": "./room.glb",
  "position": [0, 0, 0],
  "locations": {
    "wall": {"description": "Interaction target", "position": [0, 1.4, -2]}
  },
  "objects": [
    {
      "id": "chair",
      "assetPath": "./chair.glb",
      "position": [0.5, 0, -1.5],
      "physics": "fixed",
      "detectObject": true,
      "label": "chair"
    }
  ]
}
```

Supply actual asset URLs. Paths resolve relative to the manifest unless rooted
or absolute. Choose `scenePath` or `videoPath`, not both. Optional
`scenePlanesPath` and `navMeshPath` supply additional evidence and navigation.
Object physics can be `false`, `fixed`, or `dynamic`.

After startup, use `await simulator.setEnvironment(name, manifestPath)` to
change rooms and `simulator.getLocations()` to read named world-space targets.
`simulator.objects` can add, retrieve, and remove physical scene objects;
see [SimulatorObjects](/api/interfaces/SimulatorObjects).

## Constrain the simulated user

`navMesh.enabled` constrains and grounds user movement; it does not constrain
hands. It needs the pathfinding dependency and a usable navigation mesh.
`reachDistance` and `reachAngle` limit simulated hands relative to camera-local
shoulder origins. Distances are meters and angles are radians.

Optional `handPhysics` needs Rapier. `simulator.physics.enabled` controls
simulator-owned collision separately from the application's physics world.
Changing these constraints is a development choice, not proof that the app
works for every physical user's reach.

## Synthetic sensing and display

Simulated depth/planes/meshes come from the environment. With
`options.world.objects.simulatorOverride = true`, object detection uses defined
ground truth rather than camera inference. Missing detectable objects can
produce an empty result even when room geometry is visible.

`displayDiagonalFov` and `blendingMode: 'screen'` can preview a narrow additive
display. They do not model optics, brightness, or native sensor accuracy.

[SimulatorSceneManifest reference](/api/interfaces/SimulatorSceneManifest) ·
[Setup source](https://github.com/google/xrblocks/blob/main/templates/14_simulator_setup/main.js) ·
[Capabilities](/get-started/capabilities) · [Verification](/sdk/verification)
