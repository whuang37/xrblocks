# Virtual Keyboard (keyboard.ts) — Summary & API

This file implements an on-screen keyboard component for xrblocks with a few small helper classes and a fixed layout.

## Exports

- `Keyboard` — main keyboard component (exported).
- `KeyboardButton` — internal button class (extends `xb.TextButton`).

## Key classes & interfaces

- `SpecialKey`
  - position: 'left' | 'right' | 'center'
  - type: 'tab' | 'backspace' | 'shift_lock' | 'enter' | 'shift' | 'space'
  - iconName: string
  - weight?: number
  - backgroundColor?: string

- `LayoutRow`
  - textKeys?: string (sequence of non-special keys)
  - shiftKeys?: string (shift variants aligned with textKeys)
  - specialKeys: SpecialKey[]

- `KeyboardButtonOptions`
  - text: string
  - fontSize: number
  - backgroundColor: string
  - originalKey: string
  - shiftKey?: string | null

- `KeyboardButton` extends `xb.TextButton`
  - properties: `originalKey`, `shiftKey`

## Key constants (defaults)

- KEY_WIDTH = 0.068
- KEY_HEIGHT = 0.10
- FONT_SIZE = 0.45
- KEYBOARD_COLOR = '#5149ae'
- DEFAULT_KEY_COLOR = '#aa3939'
- SPECIAL_KEY_COLOR = '#3cb436'
- COL_SPACER = 0.01
- ROW_SPACER = 0.015
- TOTAL_KEYBOARD_WIDTH = 1.0
- TOTAL_KEYBOARD_HEIGHT = computed from number of rows, key height and ROW_SPACER

## Default layout (KEY_LAYOUT)

- Row 1: number row with textKeys "`1234567890-+" and shiftKeys "~!@#$%^&\*()\_+"
- Row 2: `qwertyuiop` with left `tab` key and right `backspace`
- Row 3: `asdfghjkl` with left `shift_lock` and right `enter`
- Row 4: `zxcvbnm,.` with left and right `shift` keys
- Row 5: center `space` key (wide, weighted)

Special keys may set `weight` to span multiple columns; space is centered using side padding.

## Behavior & state

- Internal state:
  - `keyText: string` — current buffer
  - `isShifted: boolean` — transient shift state
  - `isCapsLockOn: boolean` — caps lock state
  - `textButtons: KeyboardButton[]` — all text buttons for updates

- Shift vs CapsLock:
  - `produceUpper = isShifted !== isCapsLockOn` (XOR)
  - Pressing a character while `isShifted` will reset `isShifted` (transient shift).
  - `shift_lock` toggles `isCapsLockOn`.

- Special key handling:
  - `backspace` removes last char
  - `space` inserts `' '`
  - `tab` inserts `'\t'`
  - `enter` triggers enter callback
  - `shift` toggles transient shift
  - `shift_lock` toggles caps lock

- `refreshKeyboard()` updates visible labels for all text buttons (letters and shifted symbols).

## UI construction

- Uses `xb.SpatialPanel` as a root `subspace` with background color and size.
- Uses `xb.Grid` to build rows and columns for keys.
- Text keys are created as `KeyboardButton` instances; special keys use `xb.IconButton`.
- Buttons are added into panel cells; layout weights control key widths.

## Callbacks / Public API

- Properties:
  - `onTextChanged: ((text: string) => void) | null` — called whenever the buffer changes
  - `onEnterPressed: ((text: string) => void) | null` — called when Enter is pressed

- Methods:
  - `setText(text: string): void` — externally set the buffer (and emits onTextChanged)
  - Component lifecycle: `init()` positions the keyboard (sets `subspace.position`)

## Notes / implementation details

- Each key stores `originalKey` and optional `shiftKey` used to compute displayed text when shift/caps are toggled.
- Special keys may supply `backgroundColor` and `weight` to control appearance/size.
- The keyboard logs state changes to console (`console.log`) for key presses and enter/backspace events.
- `subspace.updateLayouts()` is called after construction so the grid layout is applied.

If you want the full file contents pasted instead of this summary, let me know and I will paste the keyboard.ts source.
