---
title: Anchors and persistence
slug: /sdk/anchors
sidebar_position: 10
---

# Anchors and persistence

Anchors let the platform maintain content at a physical location as tracking
changes. Persistence stores an opaque handle so the platform can try to find
that location in a later session. A saved position alone cannot do this.

## Enable anchors

```js
const options = new xb.Options();
options.world.enableAnchorPersistence();
await xb.init(options);
```

Use `options.world.enableAnchors()` for session-only use. The runtime manager
is `xb.world.anchors`. Its `capability` is `unsupported`, `session-only`,
`persistent`, or `simulated`. Check it after the runtime has started.

Desktop development can opt into
`options.world.anchors.simulatorFallback = true`. That fallback holds poses
locally; it does not prove native tracking or relocalization and can also be
used on unsupported hardware if explicitly enabled.

## Attach objects

After initialization, create an application-owned `AnchoredObjects` helper.
Call `anchor()` from a placement action after simulator startup or XR entry,
once frames have refreshed the manager's capability:

```js
const anchored = new xb.AnchoredObjects(xb.world.anchors, xb.scene);
const tracked = await anchored.anchor(object, 'marker');
if (!tracked) console.log('Anchoring is unavailable');
```

This fragment assumes the branch is enabled, an active runtime has reported a
supported capability, and `object` already has its intended world transform.
Engine initialization alone does not imply native XR entry or anchor readiness.
Call `anchored.update()` from the owning Script's
`update()` to apply current anchor poses. Use an identity scene parent; an
additional transformed parent requires explicit coordinate handling.

`anchor()` also attempts persistence. A returned anchor can still be
session-only: use the manager's capability and persistence result when the UI
must promise cross-session restoration. `AnchorManager.create()` and
`persist()` expose those lower-level operations separately.

## Restore and remove

`anchored.restore(factory)` rebuilds content for successfully restored handles.
The factory receives the saved label and record and can return an object or
`null`. Store application content separately when a label is insufficient.
Keep `unsupported` and `not-found` outcomes visible with
`AnchorManager.restoreAll()` when users need to diagnose restoration.

`anchored.remove(id)` detaches an object and deletes its anchor.
`anchored.clear()` also forgets saved records; it is a destructive reset, not
ordinary page cleanup. Dispose app-owned geometry/materials separately.
Storage defaults to a page-directory key. Set an explicit key only when pages
are intended to share the same records.

[AnchorManager reference](/api/classes/AnchorManager) ·
[AnchoredObjects reference](/api/classes/AnchoredObjects) ·
[Room-content example](/examples/room-content) ·
[Anchor notes source](https://github.com/google/xrblocks/blob/main/demos/anchors_notes/main.js)
