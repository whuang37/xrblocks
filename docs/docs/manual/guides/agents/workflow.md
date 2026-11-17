---
title: Build and verify an app with an agent
slug: /agents/workflow
---

# Build and verify an app with an agent

Use a short edit/build/run loop, with evidence for the behavior the user requested.
An agent's explanation is not a substitute for running the available checks.

## Implement against a known example

1. Identify the installed SDK and [matching references](/agents/documentation).
2. Choose the closest [starter or example](/examples). Read its dependencies,
   initialization, and cleanup before copying a fragment.
3. Add the requested application behavior through public APIs. Keep one engine,
   one Three.js instance, and the SDK's UI/input ownership.
4. Build/type-check the project. Resolve the first failure before continuing.
5. Launch and exercise the requested interaction when browser tools are available.

## Inspect the result

Use the existing [automation preset and debug readiness](/sdk/verification) for
a repeatable simulator run. Inspect semantic/visible [scene context](/sdk/context)
and UI validation where they answer the task. Then perform the action: submit,
select, move, stop, or restore. Check the resulting application state.

For example, a notes task needs typed input, one submitted note in history, and
working scrolling. A rendered card with no errors does not prove those outcomes.
When browser tools are unavailable, report that limit and give exact manual
steps instead of claiming an interaction passed.

## Recover from failure

Use [troubleshooting](/sdk/troubleshooting) for startup, module loading, UI,
sensing, or connection symptoms. Do not replace simulator startup because an
asset failed to load or replace the input system because one target is disabled.
Inspect the failing boundary first.

## Handoff

Report what changed, the checks actually run, their results, and remaining
hardware/provider checks. Stop task-owned servers and child processes before
handoff. Explain how the user can start the project again.

Use [device acceptance](/sdk/verification#device-acceptance) for features the
simulator cannot establish. Keep a failed or unrun check visible in the report.
