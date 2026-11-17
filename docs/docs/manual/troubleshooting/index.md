---
title: Inspect and troubleshoot
slug: /sdk/troubleshooting
---

# Inspect and troubleshoot

Start with the first failing boundary: module load, engine initialization,
runtime entry, feature readiness, or application behavior. Keep the original
error and inspect its network request or stack before changing unrelated setup.

## Imports or startup fail

Check failed module requests and bare imports. Align Three.js versions and
provide dependencies for enabled features. Deploy all private chunks with the
SDK. [Dependencies](/integrations/dependencies) and
[build output](/integrations/build-and-deploy) describe the required files.

For simulator startup, await the SDK path instead of reading `core.simulator`
before it exists. Keep the entry error/retry UI available. For native XR,
check secure context, requested session/features, and permission denial.
[Configuration](/sdk/configuration) owns those choices.

## UI is invisible, clipped, or unresponsive

Check that the root is a `UICard` or `UIOverlay`, is mounted and visible, and
uses the correct coordinate space. A panel alone is not a root. Inspect physical
card size versus child layout units, finite scroll height, and long text.
Run `xb.ui.validate()` after layout, then exercise the control.

Check whether an occluding or transparent object still blocks input. Opacity,
depth writing, visibility, and pointer participation are independent. A UI root
uses the built-in resolver; adding a second raycaster can produce conflicting hits.
See [styling](/sdk/ui/styling) and [input](/sdk/input).

## Objects jump or stop responding

Look for two transform owners: app updates, physics, anchors, followers, or
manipulation. Inspect event `completed` and `reason` on release. Tracking loss,
hiding, removal, and disabled state can cancel a capture normally.
See [coordinates](/sdk/coordinates) and [interaction](/sdk/interaction).

## Sensing is empty or stale

Confirm the branch is enabled and current data exists. Check selected camera,
model assets, depth prerequisites, and detector backend. An environment camera
in the simulator sees a room, not a person at the webcam. Clear previous results
when a run returns empty. See [detection](/sdk/world/detection).

## AI connects incorrectly or repeats requests

Check provider selection, credentials, model capability, and network errors.
Use Live `onopen` for readiness. Keep one start/request in flight where appropriate.
Stop app-owned media and timers on remote close and errors as well as local Stop.
See [provider setup](/integrations/ai-providers) and [Live AI](/sdk/ai/live).

## Capture evidence

Record the SDK version, runtime/backend, exact action, visible result, and first
error. Use [scene context](/sdk/context) to inspect semantic/visible state and
[verification](/sdk/verification) for a repeatable interaction check. A screenshot
alone cannot prove that a button, capture, or cleanup path works.
