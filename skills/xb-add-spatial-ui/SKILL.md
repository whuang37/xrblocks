---
name: xb-add-spatial-ui
description: >-
  Add a spatial interface to an XR Blocks app. Use for menus,
  HUDs, cards, dashboards, dialogs, labels, buttons, controls, or object-attached
  interfaces, including fixing their layout, styling, placement, or interaction.
---

# Add spatial UI

Build a **usable surface**: information and controls that remain legible,
targetable, and observable in their intended spatial pose.

## 1. Specify the surface contract

Record:

- the values the surface presents and the actions it exposes;
- whether it is world-fixed, object-anchored, head-leashed, or billboarded;
- when it appears, moves, updates, and disappears;
- the desktop and XR input paths that must operate it.

The contract is complete when every displayed value and control has a user
purpose, state source, spatial anchor, and observable result.

## 2. Establish the flex UI foundation

Use the core flex UI for app surfaces. Its flexbox layout, rich styling,
semantic buttons, placement scripts, and shared manipulation make it the
default even for a simple first surface.

Before implementation, read
[references/uiblocks.md](references/uiblocks.md) completely. Copy its verified
import map or bundler setup. Confirm imported symbols exist in `src/ui/index.ts`
and are re-exported from `src/xrblocks.ts`.

The foundation is complete when the app resolves `xrblocks`, `three`, and the
UIKit peers from one dependency graph, adds each `UICard` to an owning script,
and uses the shared interaction configuration for controls and manipulation.

## 3. Compose one coherent surface

Create one `UICard` per spatial pivot and partition it with nested `UIPanel`
flex layouts. Establish a small density, type, spacing, shape, and color scale;
then add `UIText`, `UIImage`, and `UIIcon` in reading order. Use `UIButton` for
actions. Use transform scripts for leash, billboard, anchoring, and show/hide
motion, and use `xb.manipulation` for movement and scaling.

The surface is complete when every required value is visible, the layout fits
inside the card at its intended physical dimensions, and every state-changing
control has hover feedback plus an observable click result.

## 4. Prepare the spatial UI handoff

Build or type-check the app and load its initial surface when browser access is
available. Confirm imports, layout construction, interaction capture,
control handlers, feedback states, and cleanup are present
without relevant startup errors.

Give the user the exact simulator/XR URL, intended viewing pose, input path, and
one short instruction per control. State the expected idle, hover, active,
disabled, and result visuals that apply. Hand off spatial judgments—legibility
over the real background, target size, occlusion, reach, head motion, and
repositioning—as an explicit checklist.

Finish when the surface implementation is complete and the user can evaluate
every control and spatial state without inferring expected behavior from code.
