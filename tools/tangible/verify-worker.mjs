/** Run against the built classic worker and a downloaded pinned OpenCV runtime.
 * Usage: node tools/tangible/verify-worker.mjs /path/to/opencv.js
 * Recognition is injected; optical flow runs the actual WASM implementation.
 */
import assert from 'node:assert/strict';
import console from 'node:console';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import process from 'node:process';
import {setTimeout} from 'node:timers';
import {URL} from 'node:url';
import vm from 'node:vm';

const runtime = process.argv[2];
if (!runtime) throw new Error('Pass a local OpenCV.js runtime path.');
const cv = createRequire(import.meta.url)(resolve(runtime));
const replies = [];
let simulatedWorkMs = 0;
let clockCalls = 0;
let closed = false;
const scope = {
  cv,
  importScripts() {},
  postMessage(message) {
    replies.push(message);
  },
  close() {
    closed = true;
  },
};
class TestImageData {
  constructor(data, width, height) {
    Object.assign(this, {data, width, height});
  }
}
const script = await readFile(
  new URL('../../build/addons/tangible/TangibleWorker.js', import.meta.url),
  'utf8'
);
vm.runInNewContext(
  script,
  {
    self: scope,
    ImageData: TestImageData,
    Uint8ClampedArray,
    performance: {
      now: () => performance.now() + (clockCalls++ ? simulatedWorkMs : 0),
    },
  },
  {
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  }
);
const visionModuleUrl =
  'data:text/javascript,' +
  encodeURIComponent(`
  export let calls = 0;
  export const FilesetResolver = {forVisionTasks: async () => ({})};
  export const ObjectDetector = {createFromOptions: async () => ({
    detect: () => { calls++; return ({detections: [{boundingBox: {originX: 30, originY: 30, width: 240, height: 180}, categories: [{categoryName: 'book', score: 0.95}]}]}); }, close() {}
  })};
`);
const vision = await import(visionModuleUrl);
const send = (data) => scope.onmessage({data});
try {
  send({
    type: 'initialize',
    labels: ['book'],
    recognitionIntervalMs: 1500,
    assets: {
      openCvUrl: 'injected',
      visionModuleUrl,
      visionWasmUrl: 'injected',
      modelUrl: 'injected',
    },
  });
  await new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      if (replies.some((r) => r.type === 'ready')) return resolve();
      const error = replies.find((r) => r.type === 'error');
      if (error || performance.now() - started > 10000)
        return reject(new Error(error?.message ?? 'Initialization timeout'));
      setTimeout(poll, 10);
    };
    poll();
  });
  const image = (dx, dy, blank = false) => {
    const data = new Uint8ClampedArray(320 * 240 * 4);
    for (let y = 0; y < 240; y++)
      for (let x = 0; x < 320; x++) {
        const sx = x - dx;
        const sy = y - dy;
        let seed =
          (Math.imul(sx >> 2, 374761393) + Math.imul(sy >> 2, 668265263)) | 0;
        seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
        const value = blank ? 100 : seed >>> 24;
        const i = (y * 320 + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = value;
        data[i + 3] = 255;
      }
    return data.buffer;
  };
  const frame = (
    id,
    dx,
    dy,
    blank = false,
    timeMs = 1000 + id * 33,
    workMs = 0
  ) => {
    simulatedWorkMs = workMs;
    clockCalls = 0;
    send({
      type: 'frame',
      requestId: id,
      timeMs,
      width: 320,
      height: 240,
      pixels: image(dx, dy, blank),
    });
    const reply = replies.at(-1);
    assert.equal(reply.type, 'result', JSON.stringify(reply));
    return reply.observation;
  };
  const first = frame(1, 0, 0);
  assert.ok(first.features.length >= 12);
  const next = frame(2, 6, 4);
  assert.equal(next.targetId, first.targetId);
  assert.ok(next.features.length >= 12);
  const byId = new Map(first.features.map((p) => [p.id, p]));
  const dx = next.features.map((p) => (p.u - byId.get(p.id).u) * 320);
  const dy = next.features.map((p) => (p.v - byId.get(p.id).v) * 240);
  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(Math.abs(mean(dx) - 6) < 0.4, `Measured x shift: ${mean(dx)}`);
  assert.ok(Math.abs(mean(dy) - 4) < 0.4, `Measured y shift: ${mean(dy)}`);
  assert.equal(frame(3, 0, 0, true), null);
  assert.equal(frame(4, 0, 0), null); // Wait for the next recognition interval.
  assert.equal(frame(30, 0, 0), null); // A frame gap must not bypass that limit.
  const recovered = frame(60, 0, 0);
  assert.ok(recovered.features.length >= 12);
  assert.notEqual(recovered.targetId, first.targetId);
  send({type: 'reset'});
  const callsBefore = vision.calls;
  const slow = frame(100, 0, 0, false, 4300, 900);
  assert.ok(replies.at(-1).processingMs >= 900);
  const fresh = frame(101, 6, 4, false, 5233);
  assert.equal(
    fresh.targetId,
    slow.targetId,
    'Inference time must not reset tracking'
  );
  frame(102, 6, 4, false, 5600);
  assert.equal(frame(103, 6, 4, false, 6000).targetId, slow.targetId);
  assert.equal(
    vision.calls - callsBefore,
    1,
    'Do not rerun recognition during tracking'
  );
  console.log(
    `Actual WASM optical flow passed: ${next.features.length} features, shift ${mean(dx).toFixed(2)}, ${mean(dy).toFixed(2)} pixels; loss, idle throttling, reacquisition, slow recognition recovery, and detection-free tracking passed.`
  );
} finally {
  send({type: 'dispose'});
  assert.equal(closed, true);
}
