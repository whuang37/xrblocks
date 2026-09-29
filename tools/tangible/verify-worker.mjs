/** Exercise the emitted classic worker with real OpenCV WASM, without a detector.
 * Usage: node tools/tangible/verify-worker.mjs /path/to/opencv.js
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
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
let closed = false;
let imports = 0;
const scope = {
  cv,
  importScripts() {
    imports++;
  },
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
assert.doesNotMatch(
  script,
  /mediapipe|efficientdet|ObjectDetector|visionModuleUrl/i
);
const sandbox = vm.createContext({
  OffscreenCanvas: class {
    constructor(width, height) {
      Object.assign(this, {width, height});
    }
    getContext() {
      return {
        drawImage: (bitmap) => {
          this.image = bitmap.image;
        },
        getImageData: () => this.image,
      };
    }
  },
  self: scope,
  ImageData: TestImageData,
  Uint8ClampedArray,
  performance,
});
vm.runInContext(script, sandbox);
const send = (data) => scope.onmessage({data});
try {
  send({
    type: 'initialize',
    assets: {openCvUrl: 'injected'},
    maxReprojectionErrorPx: 3,
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
  assert.equal(imports, 1, 'Only OpenCV should load');
  const image = (dx, dy, blank = false) => {
    const data = new Uint8ClampedArray(320 * 240 * 4);
    for (let y = 0; y < 240; y++)
      for (let x = 0; x < 320; x++) {
        const sx = x - dx,
          sy = y - dy;
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
  const region = {u: 0.305, v: 0.24, width: 0.39, height: 0.52};
  const frame = (
    id,
    dx,
    dy,
    {register = false, blank = false, timeMs = 1000 + id * 67} = {}
  ) => {
    send({
      type: 'frame',
      requestId: id,
      timeMs,
      width: 320,
      height: 240,
      pixels: image(dx, dy, blank),
      intrinsics: [300, 300, 160, 120],
      preview: false,
      previewOnly: false,
      registration: register ? region : undefined,
    });
    const reply = replies.at(-1);
    assert.equal(reply.type, 'result', JSON.stringify(reply));
    return reply.observation;
  };
  assert.equal(frame(1, 0, 0), null, 'Never register without a request');
  const first = frame(2, 0, 0, {register: true});
  assert.ok(first.features.length >= 12);
  assert.ok(
    first.features.every(
      ({u, v}) =>
        u >= region.u &&
        u <= region.u + region.width &&
        v >= region.v &&
        v <= region.v + region.height
    )
  );
  const next = frame(3, 6, 4);
  assert.equal(next.targetId, first.targetId);
  assert.ok(next.features.length >= 12);
  const byId = new Map(first.features.map((p) => [p.id, p]));
  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  const dx = mean(next.features.map((p) => (p.u - byId.get(p.id).u) * 320));
  const dy = mean(next.features.map((p) => (p.v - byId.get(p.id).v) * 240));
  assert.ok(Math.abs(dx - 6) < 0.4 && Math.abs(dy - 4) < 0.4);
  assert.equal(frame(4, 0, 0, {blank: true}), null);
  assert.equal(frame(5, 0, 0), null, 'Loss must not switch to a new surface');
  const recovered = frame(6, 0, 0, {register: true});
  assert.notEqual(recovered.targetId, first.targetId);
  assert.equal(frame(30, 0, 0), null, 'A long gap invalidates the patch');
  assert.equal(frame(31, 0, 0, {register: true, blank: true}), null);
  assert.match(replies.at(-1).status, /Only 0 image features/);
  assert.ok(frame(32, 0, 0, {register: true}));
  send({type: 'reset'});
  assert.equal(frame(33, 0, 0), null);
  let bitmapClosed = false;
  const previewImage = new TestImageData(
    new Uint8ClampedArray(image(0, 0)),
    320,
    240
  );
  send({
    type: 'frame',
    requestId: 34,
    timeMs: 3400,
    width: 320,
    height: 240,
    bitmap: {
      image: previewImage,
      close() {
        bitmapClosed = true;
      },
    },
    intrinsics: [300, 300, 160, 120],
    preview: true,
    previewOnly: true,
  });
  assert.equal(bitmapClosed, true, 'Worker must release the bitmap');
  assert.equal(replies.at(-1).preview.pixels, previewImage.data.buffer);
  assert.equal(replies.at(-1).observation, null, 'Preview must skip tracking');
  // Exercise the emitted PnP solver on calibrated planar and curved surfaces.
  const seed = frame(100, 0, 0, {register: true});
  for (const curved of [false, true]) {
    const model = seed.features.map(({id, u, v}) => {
      const depth = curved
        ? 1 + 0.12 * Math.cos((u - 0.5) * 12) * Math.cos((v - 0.5) * 9)
        : 1;
      return {
        id,
        x: ((u * 320 - 160) * depth) / 300,
        y: (-(v * 240 - 120) * depth) / 300,
        z: 1 - depth,
      };
    });
    send({type: 'reference', targetId: seed.targetId, points: model});
    const expected = new THREE.Matrix4().compose(
      new THREE.Vector3(0.04, -0.025, -0.95),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, -0.18, 0.07)),
      new THREE.Vector3(1, 1, 1)
    );
    const pixels = model.flatMap((p, i) => {
      const point = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(expected);
      return [
        (300 * point.x) / -point.z + 160 + (i % 5 === 0 ? 40 : 0),
        (-300 * point.y) / -point.z + 120,
      ];
    });
    vm.runInContext(
      `points.delete(); points = cv.matFromArray(${model.length}, 1, cv.CV_32FC2, ${JSON.stringify(pixels)});`,
      sandbox
    );
    const pose = vm.runInContext('estimatePose([300, 300, 160, 120])', sandbox);
    assert.ok(pose, `Missing ${curved ? 'curved' : 'planar'} pose`);
    const actual = new THREE.Matrix4().fromArray(pose.cameraFromObject);
    const a = new THREE.Vector3(),
      q = new THREE.Quaternion();
    const b = new THREE.Vector3(),
      r = new THREE.Quaternion();
    actual.decompose(a, q, new THREE.Vector3());
    expected.decompose(b, r, new THREE.Vector3());
    assert.ok(a.distanceTo(b) < 0.003, `Position error ${a.distanceTo(b)}`);
    assert.ok(q.angleTo(r) < 0.02, `Rotation error ${q.angleTo(r)}`);
    assert.ok(pose.inliers >= model.length * 0.5);
    // Destroy correspondence: no arbitrary pose should be accepted.
    vm.runInContext(`points.data32F.fill(0);`, sandbox);
    assert.equal(
      vm.runInContext('estimatePose([300, 300, 160, 120])', sandbox),
      null
    );
  }
  console.log(
    `WASM passed: central registration, ${next.features.length} features, shift ${dx.toFixed(2)}, ${dy.toFixed(2)} pixels, loss, explicit re-registration, gap, blank frame, reset, and planar/curved PnP with 20% outliers.`
  );
} finally {
  send({type: 'dispose'});
  assert.equal(closed, true);
}
