---
title: Resources and cleanup
slug: /sdk/resources
sidebar_position: 4
---

# Resources and cleanup

Dispose resources at the level that created them. Removing an object from the
scene does not automatically free every geometry, material, texture, stream,
or listener that application code created.

## Script-owned work

Store subscriptions and resources on the Script so `dispose()` can release them:

```js
class StatusListener extends xb.Script {
  init() {
    this.onResize = () => console.log(window.innerWidth);
    window.addEventListener('resize', this.onResize);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
  }
}
```

Dispose owned geometries/materials/textures, stop polling with the same client
used to start it, clear timers, and stop owned media tracks. Do not dispose a
shared model or texture while another object still uses it. Ignore late async
results after the owning Script has been removed; cancel the operation when
its API supports cancellation.

## Engine-owned work

The engine owns its renderer, enabled services, depth resources, and built-in
input/UI infrastructure. Use `await xb.core.dispose()` for terminal application
shutdown. The singleton cannot be initialized again after disposal.

Leaving an immersive session is different from shutting down the engine:
resources needed for XR re-entry remain alive. Do not dispose `xb.depth` or
other engine services when a user merely exits XR.

## Media and live sessions

Route local stop, remote disconnect, error, and Script removal through one
cleanup path. Release the app's microphone/camera work and playback as well as
the remote AI session. Guard duplicate starts while initialization is pending.

[Live AI](/sdk/ai/live), [camera](/sdk/camera), and [audio](/sdk/audio) describe
which resources their APIs own. [Depth](/sdk/world/depth) describes sensor
ownership. Check repeated entry, exit, and removal in
[verification](/sdk/verification).

[Core reference](/api/classes/Core) · [Basic cleanup example](https://github.com/google/xrblocks/blob/main/templates/00_basic/main.js)
