---
title: Scene context
slug: /sdk/context
sidebar_position: 13
---

# Scene context

The context subsystem converts the live application scene into a semantic tree,
visible-object state, and Set-of-Mark imagery. An external agent can inspect
these outputs without guessing from object names or screenshots alone.

## Capture a consistent snapshot

Enable context before initialization:

```js
const options = new xb.Options();
options.enableContext();
await xb.init(options);

const snapshot = await xb.context.scene.runContextDetection({
  semanticTree: true,
  visibleObjects: true,
  setOfMark: true,
});
console.log(snapshot.semanticTree.nodes);
console.log(snapshot.visibleObjects.nodes);
console.log(snapshot.setOfMark.marks);
```

Use `enableSceneContext()`, `enableVisibleObjectsContext()`, or
`enableSetOfMarkContext()` for a narrower setup. Inspect the output of a mounted,
rendered scene; startup alone does not prove that layout or visibility is ready.

## Make app state readable

Nodes have stable `ctx_*` identifiers, names, roles, relationships, visibility,
and interaction state. Set-of-Mark labels reuse the identifiers. Give scene
objects meaningful names and use semantic UI components such as `UIButton`,
`UIToggle`, and `UITextInput`.

Mark app helper geometry with `object.userData.xrblocksPrivate = true` when it
must stay out of context. Keep actual status in mounted UI so a human and an
agent can inspect the same state. Hidden or clipped content differs from
visible, actionable content.

## Continuous work

```js
const client = {};
xb.context.scene.start(client);
// Later, release this client's polling request:
xb.context.scene.stop(client);
```

Keep that client identity on the owning Script. Configure polling cadence with
`options.context.scene.pollingIntervalMs`. Request image context only when the
task needs it; screenshots and detection add work beyond a semantic tree.

Capturing context and transmitting it to AI are separate application decisions.
Choose what to send and disclose the selected media. The
[agent context starter](https://github.com/google/xrblocks/blob/main/templates/11_agent_context/main.js) combines the
steps explicitly.

[Run the starter](https://xrblocks.github.io/templates/11_agent_context/) ·
[SceneDetector reference](/api/classes/SceneDetector) ·
[Agent verification](/agents/workflow) · [Live tools](/sdk/ai/live)
