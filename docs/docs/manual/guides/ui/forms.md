---
title: Forms and text input
slug: /sdk/ui/forms
---

# Forms and text input

Use semantic controls for fields, choices, scrolling, and submission. They
participate in the SDK's input routing and expose their state to scene context.
Start with a [mounted UI root](/sdk/ui).

## Edit and submit text

```js
const status = new xb.UIText({text: 'Enter a name.'});
const name = new xb.UITextInput({
  ariaLabel: 'Name',
  placeholder: 'Your name',
  onSubmit: (value) => {
    status.text = value.trim() ? `Hello, ${value}!` : 'Enter a name.';
  },
});
card.add(name, status);
```

This fragment assumes `card` is a `UICard`. `onInput` reports live edits;
`onChange` reports a changed editing session when focus ends; `onSubmit` is an
explicit action. Programmatic `value` changes do not emit user-input callbacks.
Submission does not clear the field or send an AI request automatically.

Single-line Enter submits. With `multiline: true`, Enter inserts a newline and
Ctrl/Meta+Enter submits. IME composition must finish first. Escape blurs without
reverting text. Read-only fields allow selection/copy; disabled fields reject
focus and edits. Call `focus()` only after `ready` is true.

Native editing owns clipboard, selection, and composition. Software keyboard
availability depends on the browser and headset. Text editing suspends simulator
navigation so typing does not move the camera.

## Choices and live values

`UIToggle` reports a boolean through `onChange`. `UIDropdown` takes
`{value, label, disabled?}` options and reports a selected value. `UISlider`
uses `onInput` for a live value and `onChange` for a completed change; cancellation
restores its starting value. Give unlabeled controls an `ariaLabel` and visible
text explaining the setting. `UIProgress` displays a value without accepting input.

Dropdown lists open above or below their control without changing card layout.
Outside presses close the list. A dropdown inside a scroll viewport is clipped
by it; put it outside that viewport when the menu needs more space.

## Scroll long content

```js
const history = new xb.UIScrollView({
  ariaLabel: 'History',
  style: {height: 240, gap: 12},
  children: [new xb.UIText({text: 'First entry', style: {flexShrink: 0}})],
});
card.add(history);
```

Use a finite viewport height, or an automatic height with `maxHeight`.
`scrollTop`, `clientHeight`, and `scrollHeight` use layout units.
`scrollTo()`, `scrollBy()`, and `reveal(child)` work with measured layout;
check `ready` before requesting measured operations.

Dragging scrollable content can cancel a pending click. A captured slider or
text selection keeps its own interaction. UI controls suppress ancestor/global
selection so submitting a form does not also trigger a scene action.

## Verify a form

Check empty submission, edited submission, cancellation, scrolling, focus, and
removal while editing. Test the intended headset's keyboard separately.
The optional [keyboard addon documentation](https://github.com/google/xrblocks/blob/main/src/addons/virtualkeyboard/README.md)
explains binding an in-scene keyboard; it is not required for native text input.

[UITextInput reference](/api/classes/UITextInput) · [UIScrollView reference](/api/classes/UIScrollView) ·
[Complete form example](/examples/spatial-form)
