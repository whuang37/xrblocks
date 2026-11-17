---
title: Style and validate UI
slug: /sdk/ui/styling
---

# Style and validate UI

Start with the built-in theme, then change the properties your app needs.
Cards and overlays receive the theme's surface appearance; a neutral panel
organizes children. Use `appearance: 'none'` for a transparent layout root.

## Set a theme

```js
xb.ui.theme = 'highContrast';
xb.ui.setTheme({colors: {primary: '#8ab4f8'}});
```

A theme supplies colors, border radius, and role styles. An element's `style`
can override its appearance. Use state selectors such as `':hover'`, `':active'`,
`':disabled'`, and `':checked'` where supported. Give enabled, selected, disabled,
and pending states distinct text or control state as well as color.

For role-style changes, preserve other role styles when needed:

```js
xb.ui.setTheme({
  styles: {
    ...xb.ui.theme.styles,
    button: {height: 64, borderRadius: 24},
  },
});
```

Use [UITheme reference](/api/interfaces/UITheme) for supported roles and
[UIStyle reference](/api/interfaces/UIStyle) for style fields.

## Keep content readable

Card size and viewing distance affect the apparent size of text and targets.
Use a fixed width for wrapped paragraphs, enough padding between controls, and
short visible labels. Prefer an explicit status message over an unlabeled color
change. Test long labels, Unicode text, and increased content length.

`UIText` can render glyphs missing from the default atlas through a system-font
canvas. Numeric `lineHeight` is a font-size multiplier; `'32px'` is a layout-unit
height. `whiteSpace: 'pre-line'` preserves explicit line breaks.

The SDK supplies panel styling and manipulation behavior. It does not prove
that an application's text is readable, its motion is comfortable, or its
contrast works on the target display. Check those in the intended environment.
An additive-display simulation is a preview, not an optics test.

## Inspect layout

After a completed layout, run:

```js
const report = xb.ui.validate(card);
console.log(report);
```

Validation can report not-ready or layout problems; wait for mounted content
before treating it as layout evidence. Inspect the reported elements, then test
pointer interaction and visible text. A clean report alone does not prove a
working form.

[UI validation reference](/api/interfaces/UIValidationReport) ·
[Run the UI lab](https://xrblocks.github.io/demos/spatial_ui_lab/) ·
[Forms](/sdk/ui/forms) · [Troubleshooting](/sdk/troubleshooting)
