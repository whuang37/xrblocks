---
name: xb-testing
description: >-
  Write sequential asynchronous functional, integration, or simulator tests for xrblocks apps using
  the testing addon. Use this when you need to mock WebGL/WebAudio in headless environments (like JSDOM / Vitest),
  simulate user locomotion, trigger controller pointing, raycasts, and select/squeeze hand inputs.
  Covers `TestRunner` and `TestRunnerConfig`.
---

# xb-testing: functional & simulator testing

The testing addon (`import { TestRunner } from 'xrblocks/addons/testing'`) provides a headless functional test framework designed to test scripts, locomotion, interaction, and engine lifecycle sequentially under environments like Vitest/JSDOM.

## Bootstrapping a test

Use `TestRunner.create` to spin up a core instance with a spied canvas/WebGL context:

```ts
import {describe, it, expect} from 'vitest';
import {TestRunner} from 'xrblocks/addons/testing';
import {MyScript} from './MyScript';

describe('My Functional Test', () => {
  it('verifies script interaction', async () => {
    const script = new MyScript();

    // Create the runner and load scripts
    const runner = await TestRunner.create({
      scripts: [script],
    });

    // Step the frame loop forward (in milliseconds)
    await runner.step(100);

    // Check script states
    expect(script.someValue).toBe(true);

    // Always clean up to prevent memory/state leaks
    await runner.destroy();
  });
});
```

## Locomotion (movement)

Simulate user camera translation (in strafe, rise, forward offsets relative to camera orientation):

```ts
// Move user forward by 1 meter
await runner.move([0, 0, -1], {durationMs: 200});

// Verify camera position changed
expect(runner.camera.position.z).toBeLessThan(0);
```

## Pointer & click interactions

Simulate hands or controllers pointing at objects and performing selections (pinches/clicks):

```ts
// Point right hand (index 1) directly at the target object
await runner.pointTo(1, targetMesh);

// Perform a pinch/click with the right hand
await runner.click(1);

// Step time in ms to allow the select start and select end callbacks to fire
await runner.step(250);

expect(targetMesh.clicked).toBe(true);
```

## Error handling

Any error or exception thrown during script lifecycle (`init`, `update`, `onSelectEnd`, etc.) is caught by the test runner. Call `step()` or check for errors explicitly:

```ts
// Script crash verification
const crasher = new CrashingScript();
const runner = await TestRunner.create({scripts: [crasher]});

// Advancing the frame loop throws the exception caught in the script
await expect(runner.step(16.67)).rejects.toThrow(
  'Script crash inside update loop'
);
```

## Notes

- **Auto-mocking:** `TestRunner` automatically stubs `AudioContext`, `AudioListener` parameter curves, and `WebGLRenderer` capabilities transparently.
- **Teardown:** Always call `await runner.destroy()` in your tests to reset the core singleton, otherwise subsequent tests will share state and leak listeners.
