---
title: Physics
slug: /sdk/physics
sidebar_position: 18
---

# Physics

Supply one compatible Rapier module before initialization. XR Blocks creates and
steps its physics world; the application creates and owns its bodies/colliders.

## Configure Rapier

```js
import RAPIER from '@dimforge/rapier3d-simd-compat';
import * as xb from 'xrblocks';

const options = new xb.Options();
options.physics.RAPIER = RAPIER;
await xb.init(options);
```

Map or install that same package. The structural SDK contract also accepts the
standard and compat Rapier variants; choose one runtime, not multiple variants.
See the [environment physics import map](https://github.com/google/xrblocks/blob/main/templates/10_environment_physics/index.html).

## Create bodies in the lifecycle

In `initPhysics(physics)`, use `physics.RAPIER` and `physics.blendedWorld`:

```js
initPhysics(physics) {
  this.physics = physics;
  this.body = physics.blendedWorld.createRigidBody(
    physics.RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.5, -1)
  );
  physics.blendedWorld.createCollider(
    physics.RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1),
    this.body
  );
}

physicsStep() {
  if (!this.body) return;
  this.mesh.position.copy(this.body.translation());
  this.mesh.quaternion.copy(this.body.rotation());
}
```

This Script fragment assumes `init()` created `this.mesh`. The cuboid's dimensions
are half-extents, matching a 0.2-meter cube. Remove the rigid body from the world
and dispose owned graphics resources in `dispose()`. A collider has no visible
mesh unless the application adds one.

## Choose transform ownership

Automatic manipulation writes a Three.js transform; Rapier writes a body pose.
Choose a policy: move a kinematic body while held, apply forces from interaction
events, or use hand-collision behavior. A grab callback alone does not synchronize
a body. Avoid two systems continuously overwriting the same transform.

Enabled depth/scene geometry can provide environment colliders once physics is
configured. Depth does not switch physics on. Tune collider cadence against
measured cost and provide a reset for bodies trapped by incomplete/noisy geometry.

[Run environment physics](https://xrblocks.github.io/templates/10_environment_physics/) ·
[Source](https://github.com/google/xrblocks/blob/main/templates/10_environment_physics/main.js) ·
[Physics reference](/api/classes/Physics) · [Depth](/sdk/world/depth) ·
[Manipulation](/sdk/interaction)
