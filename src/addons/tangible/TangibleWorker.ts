// Classic worker: OpenCV's WASM loader uses importScripts.
import type {CvMat, OpenCv} from './OpenCvTypes';
import type {
  TangibleRegion,
  TangibleWorkerReply,
  TangibleWorkerRequest,
} from './TangibleTypes';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TangibleWorkerRequest>) => void) | null;
  postMessage(message: TangibleWorkerReply): void;
  importScripts(url: string): void;
  cv: OpenCv & {then?: (callback: (cv: OpenCv) => void) => void};
  close(): void;
};
let cv: OpenCv;
let previousGray: CvMat | null = null;
let points: CvMat | null = null;
let pointIds: number[] = [];
let targetId = 0;
let lastFrameEndTime = -Infinity;
let disposed = false;
let featureCount = 0;
let messageStatus = 'Aim at a textured surface and press Register.';

function reset() {
  previousGray?.delete();
  points?.delete();
  previousGray = null;
  points = null;
  pointIds = [];
  featureCount = 0;
  lastFrameEndTime = -Infinity;
}

async function initialize(assets: {openCvUrl: string}) {
  scope.importScripts(assets.openCvUrl);
  // OpenCV exposes a self-resolving thenable; resolve void instead of awaiting cv.
  await new Promise<void>((resolve) => {
    if (scope.cv.then)
      scope.cv.then((value) => {
        cv = value;
        resolve();
      });
    else {
      cv = scope.cv;
      resolve();
    }
  });
  if (!disposed) scope.postMessage({type: 'ready'});
}

function register(gray: CvMat, region: TangibleRegion) {
  reset();
  const mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
  const found = new cv.Mat();
  try {
    const x0 = Math.max(0, Math.ceil(region.u * gray.cols));
    const x1 = Math.min(
      gray.cols,
      Math.floor((region.u + region.width) * gray.cols)
    );
    const y0 = Math.max(0, Math.ceil(region.v * gray.rows));
    const y1 = Math.min(
      gray.rows,
      Math.floor((region.v + region.height) * gray.rows)
    );
    for (let y = y0; y < y1; y++)
      mask.data.fill(255, y * gray.cols + x0, y * gray.cols + x1);
    cv.goodFeaturesToTrack(gray, found, 100, 0.015, 6, mask);
    featureCount = found.rows;
    if (found.rows < 12) {
      messageStatus = `Only ${found.rows} image features in the box; need 12. Aim at more texture and register again.`;
      return;
    }
    points = found.clone();
    pointIds = Array.from({length: found.rows}, (_, i) => i);
    targetId++;
    messageStatus = 'Image patch registered.';
  } finally {
    mask.delete();
    found.delete();
  }
}

function track(gray: CvMat) {
  if (!previousGray || !points) return;
  const next = new cv.Mat();
  const back = new cv.Mat();
  const status = new cv.Mat();
  const backStatus = new cv.Mat();
  const errors = new cv.Mat();
  const backErrors = new cv.Mat();
  try {
    const size = new cv.Size(21, 21);
    cv.calcOpticalFlowPyrLK(
      previousGray,
      gray,
      points,
      next,
      status,
      errors,
      size,
      3
    );
    cv.calcOpticalFlowPyrLK(
      gray,
      previousGray,
      next,
      back,
      backStatus,
      backErrors,
      size,
      3
    );
    const values: number[] = [];
    const ids: number[] = [];
    for (let i = 0; i < points.rows; i++) {
      const x = next.data32F[i * 2];
      const y = next.data32F[i * 2 + 1];
      const error = Math.hypot(
        back.data32F[i * 2] - points.data32F[i * 2],
        back.data32F[i * 2 + 1] - points.data32F[i * 2 + 1]
      );
      if (
        !status.data[i] ||
        !backStatus.data[i] ||
        !Number.isFinite(error) ||
        error > 1.5 ||
        errors.data32F[i] > 30 ||
        x < 0 ||
        y < 0 ||
        x >= gray.cols ||
        y >= gray.rows
      )
        continue;
      values.push(x, y);
      ids.push(pointIds[i]);
    }
    if (ids.length < 12) {
      reset();
      messageStatus =
        'Image tracking lost. Aim at the surface and register again.';
      return;
    }
    points.delete();
    points = cv.matFromArray(ids.length, 1, cv.CV_32FC2, values);
    pointIds = ids;
    featureCount = ids.length;
  } finally {
    for (const mat of [next, back, status, backStatus, errors, backErrors])
      mat.delete();
  }
}

function processFrame(
  message: Extract<TangibleWorkerRequest, {type: 'frame'}>
) {
  if (!cv || disposed) return;
  const started = performance.now();
  if (
    previousGray &&
    (message.timeMs - lastFrameEndTime > 600 ||
      previousGray.cols !== message.width ||
      previousGray.rows !== message.height)
  ) {
    reset();
    messageStatus =
      'Camera frames changed or paused. Register the surface again.';
  }
  const rgba = cv.matFromImageData(
    new ImageData(
      new Uint8ClampedArray(message.pixels),
      message.width,
      message.height
    )
  );
  let gray: CvMat | null = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    if (message.registration) register(gray, message.registration);
    else track(gray);
    previousGray?.delete();
    previousGray = points ? gray : null;
    if (points) gray = null;
    const observation = points
      ? {
          targetId,
          features: pointIds.map((id, i) => ({
            id,
            u: points!.data32F[i * 2] / message.width,
            v: points!.data32F[i * 2 + 1] / message.height,
          })),
        }
      : null;
    const processingMs = performance.now() - started;
    lastFrameEndTime = message.timeMs + processingMs;
    scope.postMessage({
      type: 'result',
      requestId: message.requestId,
      observation,
      processingMs,
      featureCount,
      status: messageStatus,
    });
  } finally {
    rgba.delete();
    gray?.delete();
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    if (message.type === 'initialize') {
      void initialize(message.assets).catch((error) => {
        if (!disposed)
          scope.postMessage({type: 'error', message: String(error)});
      });
    } else if (message.type === 'frame') processFrame(message);
    else if (message.type === 'reset') reset();
    else if (message.type === 'dispose') {
      disposed = true;
      reset();
      scope.postMessage({type: 'disposed'});
      scope.close();
    }
  } catch (error) {
    reset();
    scope.postMessage({type: 'error', message: String(error)});
  }
};
