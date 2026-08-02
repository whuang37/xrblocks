import * as THREE from 'three';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {Script} from '../Script';
import {ScriptsManager} from './ScriptsManager';

describe('ScriptsManager lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disposes active and pending generations once', async () => {
    let finishInitialization: (() => void) | undefined;
    const manager = new ScriptsManager(
      () =>
        new Promise<void>((resolve) => {
          finishInitialization = resolve;
        })
    );
    const active = new Script();
    const pending = new Script();
    const disposeActive = vi.spyOn(active, 'dispose');
    const disposePending = vi.spyOn(pending, 'dispose');
    manager.scripts.add(active);
    const initialization = manager.initScript(pending);
    await vi.waitFor(() => expect(finishInitialization).toBeDefined());

    const disposal = manager.dispose();

    expect(manager.dispose()).toBe(disposal);
    expect(manager.scripts.size).toBe(0);
    await vi.waitFor(() => expect(disposeActive).toHaveBeenCalledOnce());
    expect(disposePending).not.toHaveBeenCalled();

    finishInitialization?.();
    await Promise.all([initialization, disposal]);

    expect(disposePending).toHaveBeenCalledOnce();
    await expect(manager.initScript(new Script())).rejects.toThrow(
      'ScriptsManager has been disposed.'
    );
  });

  it('attempts every disposal phase before propagating an error', () => {
    const manager = new ScriptsManager(async () => {});
    const script = new Script();
    const dispose = vi
      .spyOn(script, 'dispose')
      .mockImplementation(() => void 0);
    manager.beforeDispose = vi.fn(() => {
      throw new Error('cancel failed');
    });
    manager.afterDispose = vi.fn();
    manager.catchExceptions = false;
    manager.scripts.add(script);

    expect(() => manager.uninitScript(script)).toThrow('cancel failed');

    expect(dispose).toHaveBeenCalledOnce();
    expect(manager.afterDispose).toHaveBeenCalledOnce();
    expect(manager.scripts.has(script)).toBe(false);
  });

  it('disposes a stale initialization and starts a new generation after reconnect', async () => {
    const resolvers: Array<() => void> = [];
    const initialize = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const manager = new ScriptsManager(initialize);
    const scene = new THREE.Scene();
    const script = new Script();
    const dispose = vi.spyOn(script, 'dispose');

    scene.add(script);
    const firstSync = manager.syncScriptsWithScene(scene);
    await vi.waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    scene.remove(script);
    const removalSync = manager.syncScriptsWithScene(scene);
    scene.add(script);
    const reconnectSync = manager.syncScriptsWithScene(scene);

    resolvers[0]();
    await vi.waitFor(() => expect(initialize).toHaveBeenCalledTimes(2));
    expect(dispose).toHaveBeenCalledOnce();
    expect(manager.scripts.has(script)).toBe(false);

    resolvers[1]();
    await Promise.all([firstSync, removalSync, reconnectSync]);

    expect(manager.scripts.has(script)).toBe(true);
  });

  it('catches callback errors by default and propagates them when disabled', () => {
    const manager = new ScriptsManager(async () => {});
    const first = new Script();
    const second = new Script();
    const visited: Script[] = [];
    const events: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    manager.addEventListener('exception', (event) => {
      events.push(event.context);
    });

    expect(
      manager.callTargeted([first, second], 'update', (script) => {
        if (script === first) throw new Error('callback failed');
        visited.push(script);
      })
    ).toBe(false);
    expect(visited).toEqual([second]);
    expect(events).toEqual(['update']);

    manager.catchExceptions = false;
    expect(() =>
      manager.callTargeted([first], 'update', () => {
        throw new Error('callback failed again');
      })
    ).toThrow('callback failed again');
    expect(events).toEqual(['update']);
  });
});
