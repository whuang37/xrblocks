---
title: Build a scene-aware assistant
slug: /examples/live-assistant
sidebar_position: 3
---

# Build a scene-aware assistant

Connect a live conversation to bounded actions in the scene. The complete
[World Companion example](https://xrblocks.github.io/demos/world_companion/) uses camera/depth
and object detection to place labels through registered tools.
Its [single-file source](https://github.com/google/xrblocks/blob/main/demos/world_companion/index.html) includes the
UI, dependency map, tools, capture selection, and session cleanup.

## Configure and start

1. Complete [provider setup](/integrations/ai-providers) and declare the media
   permissions the app needs. Use a local key only for a prototype.
2. Enable camera/depth and the chosen detector before SDK initialization.
3. Add `GeminiManager` as a Script so it receives initialized services.
4. Start from a visible user action, with a lock while connection is pending.
5. Register narrow tools and validate targets/arguments before changing the scene.

For the existing manager, tool registration is part of startup:

```js
await manager.startGeminiLive({
  tools: [sceneTool],
  captureMode: 'screenshot',
  overlayOnCamera: true,
});
```

This fragment assumes an initialized manager and an application-owned tool.
Camera mode sends the environment view. Screenshot mode includes virtual app
content; choose the source that answers the task rather than sending both by default.

## Add semantic application context

Enable `options.enableContext()` before initialization. A tool can return the
current semantic/visible snapshot to the model:

```js
const sceneTool = new xb.Tool({
  name: 'inspect_application',
  description:
    'Read the current named application objects and visible controls.',
  parameters: {type: 'OBJECT', properties: {}},
  onTriggered: async () =>
    xb.context.scene.runContextDetection({
      semanticTree: true,
      visibleObjects: true,
      setOfMark: false,
    }),
});
```

Add it to the manager's tools alongside the example's actions. Name application
objects, use semantic UI, and resolve any action's IDs through an allowlist.
The model can request an action; application code decides whether it is valid.

## Stop and check

Route Stop, remote close, failure, and removal through cleanup that releases
capture, playback, frame timers, and connection state. Verify connection failure,
repeated Start, invalid tool arguments, missing targets, and a normal Stop/restart.
A provider response alone does not prove a scene action occurred: inspect the
resulting label or application state.

[Live AI](/sdk/ai/live) · [Scene context](/sdk/context) ·
[Detection](/sdk/world/detection) · [Resource ownership](/sdk/resources)
