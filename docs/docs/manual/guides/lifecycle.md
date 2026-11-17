---
title: Engine and Script lifecycle
slug: /sdk/lifecycle
sidebar_position: 1
---

# Engine and Script lifecycle

XR Blocks runs one engine. Add application objects, then initialize it once.
The engine owns the scene, camera, renderer, frame loop, input routing, and
subsystem startup. Ordinary apps do not construct a second `Core`.

## Put behavior in a Script

```js
import * as xb from 'xrblocks';

class Spinner extends xb.Script {
  update() {
    this.rotation.y += xb.getDeltaTime();
  }
}

xb.add(new Spinner());
await xb.init(new xb.Options());
```

A Script is a Three.js object: attach meshes or other Scripts beneath it.
The example rotates its children; add visible geometry to see the rotation.
Engine-created services can be unavailable in a constructor, so use them in
`init()` or later.

| Hook                                     | Use                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `init()`                                 | Create app objects and subscribe to services. An async initializer delays that Script's later hooks until it resolves. |
| `update(time, frame)`                    | Update frame-dependent behavior. Use elapsed seconds or delta time rather than frame counts.                           |
| `initPhysics(physics)` / `physicsStep()` | Create physics resources and copy simulated state.                                                                     |
| `dispose()`                              | Release resources and subscriptions the Script owns when removed.                                                      |

Keep startup work bounded. A promise that never resolves prevents its Script
from becoming ready. Surface loading failures instead of leaving hidden content.

## Access services

Use public facades such as `xb.user`, `xb.input`, `xb.world`, `xb.ai`, and
`xb.context`. An exported service does not mean that its feature is enabled.
For reusable Scripts, declare dependencies:

```js
class WorldAware extends xb.Script {
  static dependencies = {world: xb.World};

  init({world}) {
    this.world = world;
  }
}
```

The registry resolves declared dependencies during initialization. `ScriptMixin`
lets a class based on another Three.js type participate in the lifecycle;
`MeshScript` is the ready-made mesh form.

[Basic source](https://github.com/google/xrblocks/blob/main/templates/00_basic/main.js) ·
[Script reference](/api/classes/Script) · [Registry reference](/api/classes/Registry)

Continue with [configuration](/sdk/configuration),
[input callbacks](/sdk/input), and [cleanup](/sdk/resources).
