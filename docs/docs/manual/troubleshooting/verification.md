---
title: Automate, replay, and verify
slug: /sdk/verification
---

# Automate, replay, and verify

Choose checks for the behavior you changed. Build/type checks catch unresolved
imports and incompatible calls. Interaction checks show what a user can do.
Hardware checks cover what the simulator cannot supply.

## Start a repeatable desktop run

```js
const options = new xb.Options().enableAutomationMode({hideSimulatorUi: true});
await xb.init(options);
```

The preset autostarts the simulator, enables hands/camera/context by default,
and hides simulator panels when requested. It selects its own control mode;
this differs from ordinary User-mode startup. Tune only the options the run needs.
`?xrAutomation=1` applies the default preset to pages that construct `Options`.

`?debug=1` separately exposes `window.xb` and `window.xbReady` for an in-page
browser driver. Await readiness before reading services. This is a development
inspection path, not an app requirement or a separate SDK renderer.

## Exercise an outcome

For a form, submit valid and empty input, scroll, and verify the resulting state.
For manipulation, grab/move/release, cancel, and try tracking loss or removal.
For sensing, test waiting and empty results before using a successful result.

Read [scene context](/sdk/context) and `xb.ui.validate()` when relevant. Combine
those outputs with the actual action/result. A clean console or static screenshot
does not establish interaction behavior.

## Record and replay

The existing [session replay addon](https://github.com/google/xrblocks/blob/main/src/addons/session-replay/README.md)
records head, controller, selection, and hand-joint input. Add its player before
application Scripts that consume replayed poses. Replay drives simulator input,
not complete app state; restore application objects separately.

Headset recordings do not capture the real room. Replayed sensing comes from
the simulator environment. A replay passing on desktop does not prove native
depth, anchors, or device timing. See the
[replay source](https://github.com/google/xrblocks/tree/main/demos/session_replay) for format and environment behavior.

## Device acceptance

Check native entry and permissions, available input sources, text/target
readability, sensor loss, tracking quality, output cost, exit/re-entry, and cleanup
for the features the app uses. Report the device/browser/backend used and the
observed outcome. Label checks not run as remaining work.

[Automation options](/api/type-aliases/AutomationModeOptions) ·
[Agent workflow](/agents/workflow) · [Troubleshooting](/sdk/troubleshooting)
