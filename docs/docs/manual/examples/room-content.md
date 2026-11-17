---
title: Place and restore room content
slug: /examples/room-content
sidebar_position: 2
---

# Place and restore room content

Create content at a physical location and restore it in another session when
the platform supports persistent anchors. Keep placement, anchoring, and app
content storage as separate steps.

## Start from a complete example

[Run anchor notes](https://xrblocks.github.io/demos/anchors_notes/). Its
[HTML](https://github.com/google/xrblocks/blob/main/demos/anchors_notes/index.html) and
[application source](https://github.com/google/xrblocks/blob/main/demos/anchors_notes/main.js) include the controls,
spatial UI, persistence, and visible capability state.

The notes example pins a location in front of the viewer. To place on room
geometry instead, first enable [planes/depth](/sdk/world/surfaces) and await
`xb.world.placeOnHorizontalSurface(object, {seconds: 15})`. Keep the object
hidden or present a retry if placement fails; anchor only after placement succeeds.

## Wire the lifecycle

1. Enable `options.world.enableAnchorPersistence()` before initialization.
2. Check `xb.world.anchors.capability` in the active runtime. For desktop
   development, opt into `simulatorFallback` and display that it is simulated.
3. Create the object, choose its world pose, then create an anchor and attach it.
4. Refresh its pose each frame through the anchor manager or `AnchoredObjects`.
5. Restore saved handles and rebuild only the content each result can support.

An `AnchoredObjects` factory can map a saved label to application content:

```js
const count = await anchored.restore((label) => {
  const card = new xb.UICard({children: [new xb.UIText({text: label})]});
  return card;
});
console.log(`Restored ${count} items`);
```

This fragment assumes `anchored` is the helper initialized as shown in
[anchors](/sdk/anchors). A real app should store content separately when labels
are insufficient. A persistent handle identifies a location, not an arbitrary
serialized scene.

## Verify restoration

Pin two different notes, reload, and check text and pose restoration. Test a
missing handle and unsupported/session-only capability. Provide an explicit
forget/reset action; ordinary disposal must not erase saved records.

Desktop fallback proves the app's storage and reconstruction path. Native
acceptance requires leaving/re-entering a session and relocalizing on the target
device. A note appearing at a stored desktop coordinate is not that evidence.

[Anchor reference](/api/classes/AnchorManager) · [Placement](/sdk/placement) ·
[Capabilities](/get-started/capabilities)
