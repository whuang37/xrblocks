---
title: Build spatial UI
slug: /sdk/ui
---

# Build spatial UI

Create spatial UI with components exported by `xrblocks`. Add a root to the
scene and initialize the SDK; the UI renderer starts when that root mounts.
Input, rendering, and scene context use the same public components.

## Choose a root

| Root        | Use                                                                         |
| ----------- | --------------------------------------------------------------------------- |
| `UICard`    | A world-space panel sized in meters. Move it with normal object transforms. |
| `UIOverlay` | View-space status or instructions. Position it through UI layout.           |
| `UIPanel`   | A nested row, column, or section within a root.                             |

A panel needs a UI parent. Nested cards/overlays are not supported. Place a
mesh beside a card under a common Group, rather than inside its UI layout.

## Build a working card

This module is complete application code after [installation](/get-started/installation):

```js
import * as xb from 'xrblocks';

const status = new xb.UIText({text: 'Ready'});
const card = new xb.UICard({
  size: {width: 0.5, height: 'auto'},
  manipulation: true,
  edge: true,
  style: {padding: 24, gap: 16},
  children: [
    status,
    new xb.UIButton({
      label: 'Hello',
      onClick: () => {
        status.text = 'Hello!';
      },
    }),
  ],
});
card.position.set(0, 1.4, -1);

const options = new xb.Options();
options.xrButton.showEnterSimulatorButton = true;
xb.add(card);
await xb.init(options);
```

Enter the simulator and press **Hello**. The existing text changes; the app
keeps the same mounted card and control. Update public properties instead of
rebuilding the tree every frame.

## Layout and resizing

Fixed card dimensions use meters. An omitted dimension defaults to `'auto'`
and fits its content. Give long text a fixed width or `maxWidth` so it can wrap.
Child padding, gaps, and font sizes use [UI layout units](/sdk/coordinates).

`manipulation: true` gives a card its standard move/scale/corner-resize behavior.
The edge band provides move and resize targets. Corner resizing changes the
physical `size` and reflows text; scaling changes the whole object. A user
resize converts automatic dimensions to fixed dimensions. Use a scroll view
when content must fit within a finite panel.

A card's move defaults include facing the viewer, pointer smoothing,
distance-aware scale, and controller push/pull. See
[manipulation](/sdk/interaction) for ownership and overrides.

## View-space status

Use `UIOverlay` with layout properties such as `position: 'absolute'`, `bottom`,
and `left` for view-fixed status. Its Three.js world position does not determine
its rendered placement. Use a card with `FollowHead` when content must follow
the user while remaining a world-space object.

[Run spatial UI](https://xrblocks.github.io/templates/01_spatial_ui/) ·
[Complete source](https://github.com/google/xrblocks/blob/main/templates/01_spatial_ui/main.js) ·
[UICard reference](/api/classes/UICard)

Continue with [forms](/sdk/ui/forms), [styling](/sdk/ui/styling), and
[placement](/sdk/placement).
