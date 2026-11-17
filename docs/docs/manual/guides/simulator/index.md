---
title: Simulator controls
slug: /sdk/simulator
---

# Simulator controls

The simulator runs the same application Scripts and interaction pipeline in a
desktop browser. Start it through the SDK's entry flow or the desktop preset;
see [Run](/get-started/run). The default mode is User.

## Interface and instructions

Settings, instructions, and hand-pose panels register automatically when Lit is
available. Browser-module apps that use these panels need `lit` and `lit/`
mappings; see [dependencies](/integrations/dependencies). There is no separate
simulator addon to import.

The instruction overlay can appear after a delay. To open the full instructions
automatically, set `options.simulator.instructions.showAutomatically = true`
before initialization. The settings interface exposes environment and control
choices. To hide it for a clean capture, disable the relevant panels explicitly
or use the [automation preset](/sdk/verification).

## Choose an input mode

These are the current exported enum names and interface labels:

| Public value                 | Label       | Purpose                                     |
| ---------------------------- | ----------- | ------------------------------------------- |
| `SimulatorMode.USER`         | User        | User movement and mouse selection           |
| `SimulatorMode.POSE`         | Navigation  | Navigation with virtual hand-pose controls  |
| `SimulatorMode.CONTROLLER`   | Hands       | Control an active simulated hand/controller |
| `SimulatorMode.POINTER_LOCK` | PointerLock | Pointer-lock first-person navigation        |
| `SimulatorMode.EDITOR`       | Editor      | Inspect and edit the simulator scene        |

```js
options.simulator.defaultMode = xb.SimulatorMode.USER;
options.simulator.modeToggle.enabled = true;
```

When enabled, mode cycling uses `modeToggle.toggleKey` and `toggleOrder`; the
current default key is Left Shift. Read the on-screen instructions for the
active mode's movement, pose, and selection controls. Do not replace them with
a second app-owned keyboard handler.

## Move and select

In User mode, use W/A/S/D to move forward/left/back/right and right-drag to
look around. Q moves up and E moves down when navigation is unconstrained.
A navigation mesh keeps the user grounded and disables that free vertical move.
Left-click and release to select; dragging a manipulable target moves it.

In Hands mode, W/A/S/D and Q/E move the active virtual hand. T switches hands.
Space toggles its pinch state; press it again to release. Left-drag rotates
the active hand, while right-drag rotates the view. Left Shift can move the
camera only when it is not assigned to mode cycling.

Keyboard navigation pauses while an input, textarea, select, or editable region
has focus, including controls in open shadow roots. Focus clears held movement
keys. Leaving the field needs a new navigation press; IME input does not trigger
shortcuts.

## Hand visuals and debug tools

Simulator hand meshes and pose controls are separate from native WebXR hand
visualization. Use keypoints/rays to inspect a pose or hit, then test with debug
visuals hidden. A displayed hand is not proof of a valid native tracking pose.

[Run simulator setup](https://xrblocks.github.io/templates/14_simulator_setup/) ·
[Source](https://github.com/google/xrblocks/blob/main/templates/14_simulator_setup/main.js) ·
[SimulatorOptions reference](/api/classes/SimulatorOptions) ·
[Environments](/sdk/simulator/environments)
