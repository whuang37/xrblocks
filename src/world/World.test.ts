import * as THREE from 'three';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {AI} from '../ai/AI';
import {XRDeviceCamera} from '../camera/XRDeviceCamera';
import {Registry} from '../core/components/Registry';
import {User} from '../core/User';
import {CoreSound} from '../sound/CoreSound';

import {World} from './World';
import {WorldOptions} from './WorldOptions';

async function makeWorld() {
  const world = new World();
  const options = new WorldOptions();
  const registry = new Registry();
  registry.register(registry);
  await world.init({
    options,
    camera: new THREE.PerspectiveCamera(),
    registry,
  });
  return {world, registry};
}

function fakeAi(overrides: Partial<AI> = {}) {
  const ai = Object.create(AI.prototype) as AI;
  Object.assign(ai, {
    isAvailable: () => true,
    isLiveAvailable: () => true,
    startLiveSession: vi.fn().mockResolvedValue(undefined),
    stopLiveSession: vi.fn().mockResolvedValue(undefined),
    setLiveCallbacks: vi.fn(),
    sendRealtimeInput: vi.fn(),
    sendToolResponse: vi.fn(),
    ...overrides,
  });
  return ai;
}

function fakeCamera(snapshot: string | null = 'data:image/jpeg;base64,FRAME') {
  const camera = Object.create(XRDeviceCamera.prototype) as XRDeviceCamera;
  Object.assign(camera, {
    getSnapshot: vi.fn().mockResolvedValue(snapshot),
  });
  return camera;
}

describe('World', () => {
  describe('lookingAt', () => {
    it('throws when no User is registered', async () => {
      const {world} = await makeWorld();
      expect(() => world.lookingAt()).toThrow(/User/i);
    });

    it('returns the targeted object from User.getReticleTarget', async () => {
      const {world, registry} = await makeWorld();
      const target = new THREE.Object3D();
      const user = Object.create(User.prototype) as User;
      Object.assign(user, {
        getReticleTarget: vi.fn().mockReturnValue(target),
      });
      registry.register(user, User);
      expect(world.lookingAt()).toBe(target);
      expect(world.lookingAt(1)).toBe(target);
      expect(
        (user.getReticleTarget as ReturnType<typeof vi.fn>).mock.calls
      ).toEqual([[0], [1]]);
    });
  });

  describe('streamScene', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('throws when no AI is registered', async () => {
      const {world} = await makeWorld();
      await expect(world.streamScene('hi')).rejects.toThrow(/AI/i);
    });

    it('throws when AI is not Live-capable', async () => {
      const {world, registry} = await makeWorld();
      registry.register(fakeAi({isLiveAvailable: () => false}), AI);
      await expect(world.streamScene('hi')).rejects.toThrow(/Live/i);
    });

    it('throws when no XRDeviceCamera is registered', async () => {
      const {world, registry} = await makeWorld();
      registry.register(fakeAi(), AI);
      await expect(world.streamScene('hi')).rejects.toThrow(/Camera/i);
    });

    it('opens a Live session and starts streaming camera frames', async () => {
      const {world, registry} = await makeWorld();
      const ai = fakeAi();
      const camera = fakeCamera();
      registry.register(ai, AI);
      registry.register(camera, XRDeviceCamera);

      const session = await world.streamScene('be a companion', {fps: 2});

      expect(ai.startLiveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: {parts: [{text: 'be a companion'}]},
        })
      );
      expect(ai.setLiveCallbacks).toHaveBeenCalled();
      expect(session.isActive()).toBe(true);

      // First frame fires immediately.
      await vi.waitFor(() =>
        expect(camera.getSnapshot).toHaveBeenCalledTimes(1)
      );
      await vi.waitFor(() =>
        expect(ai.sendRealtimeInput).toHaveBeenCalledWith({
          video: {data: 'FRAME', mimeType: 'image/jpeg'},
        })
      );

      // Tick once at fps=2 -> +500ms -> one more frame.
      await vi.advanceTimersByTimeAsync(500);
      expect(camera.getSnapshot).toHaveBeenCalledTimes(2);

      await session.stop();
      expect(ai.stopLiveSession).toHaveBeenCalled();
      expect(session.isActive()).toBe(false);

      // After stop, no more frames sent.
      const sentBefore = (
        ai.sendRealtimeInput as ReturnType<typeof vi.fn>
      ).mock.calls.length;
      await vi.advanceTimersByTimeAsync(2000);
      expect(
        (ai.sendRealtimeInput as ReturnType<typeof vi.fn>).mock.calls.length
      ).toBe(sentBefore);
    });

    it('forwards model text to onText and audio to sound.playAIAudio when no onAudio', async () => {
      const {world, registry} = await makeWorld();
      const ai = fakeAi();
      registry.register(ai, AI);
      registry.register(fakeCamera(), XRDeviceCamera);
      const playAIAudio = vi.fn().mockResolvedValue(undefined);
      const sound = Object.create(CoreSound.prototype) as CoreSound;
      Object.assign(sound, {playAIAudio});
      registry.register(sound, CoreSound);

      const onText = vi.fn();
      await world.streamScene('hi', {onText});

      const callbacks = (
        ai.setLiveCallbacks as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      callbacks.onmessage({
        serverContent: {
          modelTurn: {
            parts: [
              {text: 'hello '},
              {text: 'world'},
              {inlineData: {mimeType: 'audio/pcm', data: 'AUDIO'}},
            ],
          },
        },
      });

      expect(onText).toHaveBeenCalledWith('hello world');
      expect(playAIAudio).toHaveBeenCalledWith('AUDIO');
    });

    it('routes audio to onAudio when supplied (skipping sound.playAIAudio)', async () => {
      const {world, registry} = await makeWorld();
      const ai = fakeAi();
      registry.register(ai, AI);
      registry.register(fakeCamera(), XRDeviceCamera);
      const playAIAudio = vi.fn();
      const sound = Object.create(CoreSound.prototype) as CoreSound;
      Object.assign(sound, {playAIAudio});
      registry.register(sound, CoreSound);

      const onAudio = vi.fn();
      await world.streamScene('hi', {onAudio});

      const callbacks = (
        ai.setLiveCallbacks as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      callbacks.onmessage({
        serverContent: {
          modelTurn: {
            parts: [{inlineData: {mimeType: 'audio/pcm', data: 'X'}}],
          },
        },
      });

      expect(onAudio).toHaveBeenCalledWith('X');
      expect(playAIAudio).not.toHaveBeenCalled();
    });

    it('dispatches tool calls to provided tools and sends responses back', async () => {
      const {world, registry} = await makeWorld();
      const ai = fakeAi();
      registry.register(ai, AI);
      registry.register(fakeCamera(), XRDeviceCamera);

      const fakeTool = {
        name: 'placeLabel',
        toJSON: () => ({name: 'placeLabel', description: 'place a label'}),
        execute: vi.fn().mockResolvedValue({success: true, data: {ok: true}}),
      };

      await world.streamScene('hi', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [fakeTool as any],
      });

      expect(ai.startLiveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              functionDeclarations: [
                {name: 'placeLabel', description: 'place a label'},
              ],
            },
          ],
        })
      );

      const callbacks = (
        ai.setLiveCallbacks as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      await callbacks.onmessage({
        toolCall: {
          functionCalls: [
            {id: 'c1', name: 'placeLabel', args: {text: 'hello'}},
          ],
        },
      });

      // execute called with args; response sent back.
      await vi.waitFor(() =>
        expect(fakeTool.execute).toHaveBeenCalledWith({text: 'hello'})
      );
      await vi.waitFor(() =>
        expect(ai.sendToolResponse).toHaveBeenCalledWith({
          functionResponses: [
            {id: 'c1', name: 'placeLabel', response: {result: {ok: true}}},
          ],
        })
      );
    });

    it('reports unknown tool calls as errors back to the model', async () => {
      const {world, registry} = await makeWorld();
      const ai = fakeAi();
      registry.register(ai, AI);
      registry.register(fakeCamera(), XRDeviceCamera);

      await world.streamScene('hi');
      const callbacks = (
        ai.setLiveCallbacks as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      await callbacks.onmessage({
        toolCall: {functionCalls: [{id: 'c2', name: 'mystery', args: {}}]},
      });

      await vi.waitFor(() =>
        expect(ai.sendToolResponse).toHaveBeenCalledWith({
          functionResponses: [
            {
              id: 'c2',
              name: 'mystery',
              response: {error: 'unknown tool: mystery'},
            },
          ],
        })
      );
    });

    it('lets the caller intercept tool calls via onToolCall', async () => {
      const {world, registry} = await makeWorld();
      const ai = fakeAi();
      registry.register(ai, AI);
      registry.register(fakeCamera(), XRDeviceCamera);

      const onToolCall = vi.fn().mockResolvedValue(undefined);
      await world.streamScene('hi', {onToolCall});
      const callbacks = (
        ai.setLiveCallbacks as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      const toolCall = {
        functionCalls: [{id: 'c3', name: 'whatever', args: {}}],
      };
      await callbacks.onmessage({toolCall});

      expect(onToolCall).toHaveBeenCalledWith(toolCall);
      // Auto-dispatch suppressed when caller intercepts.
      expect(ai.sendToolResponse).not.toHaveBeenCalled();
    });
  });
});
