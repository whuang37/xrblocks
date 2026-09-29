// @vitest-environment jsdom
import * as THREE from 'three';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Core, Depth} from 'xrblocks';
import type {DepthFrame} from './DepthFrame';
import {TangibleWidgets} from './TangibleWidgets';
import type {TangibleWorkerReply, TangibleWorkerRequest} from './TangibleTypes';

vi.mock('xrblocks', async () => {
  const {Object3D} = await import('three');
  return {
    Core: class {},
    Depth: class {},
    Script: Object3D,
    detectDeviceCameraTarget: () => 'galaxyxr',
    disposeObjectChildren: (object: THREE.Object3D) => object.clear(),
    getCameraParametersSnapshot: vi.fn(),
  };
});

class TestWorker {
  static latest: TestWorker;
  onmessage?: (event: {data: TangibleWorkerReply}) => void;
  postMessage = vi.fn<(message: TangibleWorkerRequest) => void>();
  terminate = vi.fn();
  constructor() {
    TestWorker.latest = this;
  }
  reply(data: TangibleWorkerReply) {
    this.onmessage?.({data});
  }
}

const trackers: TangibleWidgets[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => {
  for (const tracker of trackers.splice(0)) tracker.dispose();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(
  sample = (u: number, v: number): THREE.Vector3 | null =>
    new THREE.Vector3((u - 0.5) * 0.3, (0.5 - v) * 0.3, -1)
) {
  const create = vi.fn(() => new THREE.Group());
  const preview = vi.fn();
  const tracker = new TangibleWidgets({
    widgets: {timer: {create}},
    onCameraFrame: preview,
  });
  trackers.push(tracker);
  const pauseDepth = vi.fn();
  tracker.init({
    engine: {deviceCamera: {}} as Core,
    depth: {
      options: {enabled: true, depthMesh: {updateFullResolutionGeometry: true}},
      depthMesh: {},
      resumeDepth: vi.fn(),
      pauseDepth,
    } as unknown as Depth,
  });
  const worker = TestWorker.latest;
  worker.reply({type: 'ready'});
  const submit = () => {
    const image = {
      width: 320,
      height: 240,
      data: new Uint8ClampedArray(320 * 240 * 4),
    } as ImageData;
    const depth = {
      timeMs: performance.now(),
      cameraPosition: new THREE.Vector3(),
      cameraQuaternion: new THREE.Quaternion(),
      sample,
    } as DepthFrame;
    const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 10);
    Reflect.get(tracker, 'submit').call(tracker, image, {
      timeMs: performance.now(),
      depth,
      camera: {
        worldFromView: camera.matrixWorld,
        clipFromView: camera.projectionMatrix,
      },
    });
    return worker.postMessage.mock.calls
      .map(([m]) => m)
      .filter((m) => m.type === 'frame')
      .at(-1);
  };
  const reply = (requestId: number, hasFeatures = true) =>
    worker.reply({
      type: 'result',
      requestId,
      processingMs: 4,
      featureCount: hasFeatures ? 16 : 0,
      status: 'Image tracking lost. Register again.',
      observation: hasFeatures
        ? {
            targetId: 1,
            pose: {
              cameraFromObject: new THREE.Matrix4()
                .makeTranslation(0, 0, -1)
                .toArray(),
              inliers: 16,
              reprojectionErrorPx: 0,
            },
            features: Array.from({length: 16}, (_, id) => ({
              id,
              u: 0.35 + (id % 4) * 0.1,
              v: 0.35 + Math.floor(id / 4) * 0.1,
            })),
          }
        : null,
    });
  return {tracker, worker, create, preview, submit, reply, pauseDepth};
}

describe('manual surface registration', () => {
  it('previews without tracking, then attaches only the explicitly chosen widget', () => {
    const {tracker, worker, create, preview, submit, reply, pauseDepth} =
      setup();
    const idle = submit()!;
    expect(idle.previewOnly).toBe(true);
    reply(idle.requestId, false);
    expect(preview).not.toHaveBeenCalled();
    expect(tracker.register('timer')).toBe(true);
    const first = submit()!;
    expect(first.registration).toEqual({
      u: 0.305,
      v: expect.closeTo(0.24),
      width: 0.39,
      height: 0.52,
    });
    reply(first.requestId);
    expect(tracker.state).toBe('tracked');
    expect(tracker.widgetId).toBe('timer');
    expect(pauseDepth).toHaveBeenCalledOnce();
    expect(
      worker.postMessage.mock.calls.some(([m]) => m.type === 'reference')
    ).toBe(true);
    expect(create).toHaveBeenCalledExactlyOnceWith('timer');
    expect(tracker.target.visible).toBe(true);
    const next = submit()!;
    expect(next.registration).toBeUndefined();
    reply(next.requestId, false);
    expect(tracker.state).toBe('lost');
    expect(tracker.target.visible).toBe(false);
    expect(tracker.target.xb?.interactionEnabled).toBe(false);
    const count = worker.postMessage.mock.calls.length;
    submit();
    expect(worker.postMessage).toHaveBeenCalledTimes(count + 1);
    tracker.dispose();
    worker.reply({type: 'disposed'});
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(pauseDepth).toHaveBeenCalledOnce();
  });

  it('rejects missing centre depth before sending registration pixels', () => {
    const {tracker, submit, create} = setup(() => null);
    tracker.register('timer');
    expect(submit()).toBeUndefined();
    expect(tracker.state).toBe('lost');
    expect(tracker.status).toMatch(/No depth at the box centre/);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not register background points behind the selected centre', () => {
    const {tracker, submit, reply, create} = setup(
      (u, v) =>
        new THREE.Vector3(
          (u - 0.5) * 0.3,
          (v - 0.5) * 0.3,
          u === 0.5 && v === 0.5 ? -0.7 : -2
        )
    );
    tracker.register('timer');
    reply(submit()!.requestId);
    expect(tracker.state).toBe('lost');
    expect(tracker.status).toMatch(/0 depth points agree/);
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores a result from a cleared registration', () => {
    const {tracker, submit, reply, create} = setup();
    expect(() => tracker.register('missing')).toThrow(/Unknown widget/);
    tracker.register('timer');
    const old = submit()!;
    tracker.reset();
    reply(old.requestId);
    expect(tracker.state).toBe('idle');
    expect(create).not.toHaveBeenCalled();
    tracker.register('timer');
    const fresh = submit()!;
    expect(fresh.registration).toBeDefined();
    reply(fresh.requestId);
    expect(tracker.state).toBe('tracked');
  });
});
