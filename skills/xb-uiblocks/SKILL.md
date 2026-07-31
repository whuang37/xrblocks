---
name: xb-uiblocks
description: >-
  Build rich spatial UI with the core XR Blocks flex UI: UICard, UIPanel,
  UIButton, UIText, UIImage, and UIIcon. Use for menus, HUDs, cards, controls,
  gradients, strokes, shadows, flex layout, placement, and manipulation.
---

# xb-uiblocks — core flex spatial UI

The former `uiblocks` addon now lives in `src/ui` and is exported from
`xrblocks`. Do not import a bare `uiblocks` module, create `UICore`, register a
raycast sorter, or call `options.uikit.enable()`.

Browser import maps still need the `@pmndrs/uikit`, `@pmndrs/*`,
`@preact/signals-core`, and Yoga peer entries used by `build/xrblocks.js`. Copy
them from `samples/uiblocks/index.html`.

## Quick start

```js
import * as THREE from 'three';
import * as xb from 'xrblocks';

class Menu extends xb.Script {
  init() {
    const card = new xb.UICard({
      sizeX: 0.8,
      sizeY: 0.5,
      position: new THREE.Vector3(0, 1.5, -1.2),
      manipulation: true,
    });
    this.add(card);

    const panel = new xb.UIPanel({
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
      padding: 24,
      fillColor: '#16181dee',
      cornerRadius: 24,
      strokeWidth: 2,
      strokeColor: '#ffffff44',
    });
    card.add(panel);
    panel.add(new xb.UIText('Main menu', {fontSize: 32, color: '#ffffff'}));
    panel.add(
      new xb.UIButton({
        label: 'Continue',
        ariaLabel: 'Continue',
        width: 220,
        height: 72,
        onClick: () => console.log('Continue'),
      })
    );
  }
}
```

## Rules

- Add each `UICard` directly to an owning `xb.Script`.
- Use `UIButton` for actions. It activates only after a valid captured release
  and exposes shared disabled and semantic state.
- Use `strokeWidth` and `strokeColor` with `cornerRadius` for panel outlines.
- Use one `pixelSize` and a small spacing/type scale per surface.
- Configure movement through `card.xb.manipulation` or the constructor's
  `manipulation` option.
- Add `FaceCamera`, `FollowHead`, `FollowObject`, and `VisibilityTransition` as
  card children. They suspend and rebase during manipulation.

See `docs/docs/manual/UIBlocks.mdx` and `samples/uiblocks/index.html`.
