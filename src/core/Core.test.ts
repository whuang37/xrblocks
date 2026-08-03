import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

// Stub AudioContext globally before importing any modules that rely on THREE.AudioListener.
// Use plain JS functions rather than vi.fn() to prevent vi.restoreAllMocks() from clearing the mock implementation.
vi.hoisted(() => {
  vi.stubGlobal('AudioContext', function () {
    return {
      createGain: function () {
        return {
          connect: function () {},
        };
      },
      destination: {},
    };
  });
});

import * as THREE from 'three';
import {Core} from './Core';
import {Options} from './Options';
import {Script} from './Script';
import {ScriptsManager} from './components/ScriptsManager';

function scripts(core: Core): ScriptsManager {
  return (core as unknown as {scriptsManager: ScriptsManager}).scriptsManager;
}

describe('Core frame and simulator lifecycle', () => {
  let core: Core;

  beforeEach(async () => {
    await Core.instance?.dispose();
    Core.instance = undefined;
    core = new Core();
    core.options = new Options();

    core.renderer = {
      render: vi.fn(),
      xr: {
        enabled: false,
        getDepthSensingMesh: vi.fn(),
        setReferenceSpaceType: vi.fn(),
      },
    } as unknown as THREE.WebGLRenderer;
    core.depth.update = vi.fn();
    core.input.sampleSources = vi.fn();
    scripts(core).syncScriptsWithScene = vi.fn();
    core.waitFrame.onFrame = vi.fn();
    core.screenshotSynthesizer.onAfterRender = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs script callbacks and renders through one Core frame', async () => {
    const script = new Script();
    const update = vi.spyOn(script, 'update');
    await scripts(core).initScript(script);

    (
      core as unknown as {update: (time: number, frame: XRFrame) => void}
    ).update(1000, {} as XRFrame);

    expect(update).toHaveBeenCalledWith(1000, expect.anything());
    expect(core.renderer.render).toHaveBeenCalledWith(core.scene, core.camera);
  });

  it('shares one in-flight simulator start and ignores later starts once running', async () => {
    vi.spyOn(
      core as unknown as {initialize(options: Options): Promise<void>},
      'initialize'
    ).mockResolvedValue();
    await core.init(core.options);

    let finishInit: (() => void) | undefined;
    scripts(core).initScript = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishInit = resolve;
        })
    );
    scripts(core).onSimulatorStarted = vi.fn();

    const startSimulator = (
      core as unknown as {startSimulator: () => Promise<void>}
    ).startSimulator;

    const firstStart = startSimulator();
    const secondStart = startSimulator();

    expect(scripts(core).initScript).toHaveBeenCalledOnce();
    expect(core.simulatorRunning).toBe(false);

    finishInit?.();
    await Promise.all([firstStart, secondStart]);

    expect(core.simulatorRunning).toBe(true);
    expect(scripts(core).onSimulatorStarted).toHaveBeenCalledOnce();

    await startSimulator();

    expect(scripts(core).initScript).toHaveBeenCalledOnce();
    expect(scripts(core).onSimulatorStarted).toHaveBeenCalledOnce();
  });
});
