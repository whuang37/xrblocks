// This entry must remain a classic worker: both WASM loaders use importScripts.
// All imports are types. The SDK build emits a standalone script for this entry.
import type {ObjectDetector, FilesetResolver} from '@mediapipe/tasks-vision';
import type {CvMat, OpenCv} from './OpenCvTypes';
import type {
  TangibleObservation,
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
let detector: ObjectDetector | null = null;
let previousGray: CvMat | null = null;
let points: CvMat | null = null;
let pointIds: number[] = [];
let target: Omit<TangibleObservation, 'features'> | null = null;
let nextTargetId = 0;
let labels: string[] = [];
let lastRecognition = -Infinity;
let recognitionIntervalMs = 1500;
let lastFrameTime = -Infinity;
let disposed = false;

function reset() {
  previousGray?.delete();
  points?.delete();
  previousGray = null;
  points = null;
  pointIds = [];
  target = null;
  lastRecognition = -Infinity;
  lastFrameTime = -Infinity;
}

function initialize(
  message: Extract<TangibleWorkerRequest, {type: 'initialize'}>
) {
  labels = message.labels;
  recognitionIntervalMs = message.recognitionIntervalMs;
  // This pinned build is a classic UMD script with a self-resolving thenable.
  // Resolve a void promise instead of awaiting cv, which would recurse forever.
  scope.importScripts(message.assets.openCvUrl);
  const ready = new Promise<void>((resolve) => {
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
  return ready.then(async () => {
    const vision = (await import(
      /* @vite-ignore */ message.assets.visionModuleUrl
    )) as {
      ObjectDetector: typeof ObjectDetector;
      FilesetResolver: typeof FilesetResolver;
    };
    const files = await vision.FilesetResolver.forVisionTasks(
      message.assets.visionWasmUrl
    );
    const created = await vision.ObjectDetector.createFromOptions(files, {
      baseOptions: {modelAssetPath: message.assets.modelUrl, delegate: 'CPU'},
      runningMode: 'IMAGE',
      scoreThreshold: 0.55,
      maxResults: 8,
      categoryAllowlist: labels,
    });
    if (disposed) {
      created.close();
      return;
    }
    detector = created;
    scope.postMessage({type: 'ready'});
  });
}

function recognize(image: ImageData, gray: CvMat, timeMs: number) {
  if (timeMs - lastRecognition < recognitionIntervalMs) return;
  lastRecognition = timeMs;
  const detections = detector!
    .detect(image)
    .detections.filter(
      (item) =>
        item.boundingBox && labels.includes(item.categories[0]?.categoryName)
    );
  if (target && points) {
    // Validate the current category and region, never silently switch identities.
    const current = target;
    const matching = detections.some((item) => {
      if (item.categories[0].categoryName !== current.label) return false;
      const box = item.boundingBox!;
      let inside = 0;
      for (let i = 0; i < points!.rows; i++) {
        const x = points!.data32F[2 * i];
        const y = points!.data32F[2 * i + 1];
        if (
          x >= box.originX &&
          x <= box.originX + box.width &&
          y >= box.originY &&
          y <= box.originY + box.height
        )
          inside++;
      }
      return inside >= points!.rows * 0.65;
    });
    if (!matching) reset();
    return;
  }
  // Prefer a supported object near the centre, with a useful image footprint.
  detections.sort((a, b) => {
    const rank = (item: typeof a) => {
      const box = item.boundingBox!;
      const dx = (box.originX + box.width / 2) / image.width - 0.5;
      const dy = (box.originY + box.height / 2) / image.height - 0.5;
      return item.categories[0].score - 0.5 * (dx * dx + dy * dy);
    };
    return rank(b) - rank(a);
  });
  const detection = detections.find(
    (item) => item.boundingBox!.width >= 50 && item.boundingBox!.height >= 50
  );
  if (!detection) return;
  const box = detection.boundingBox!;
  const mask = cv.Mat.zeros(image.height, image.width, cv.CV_8UC1);
  const found = new cv.Mat();
  try {
    const x0 = Math.max(0, Math.ceil(box.originX + box.width * 0.15));
    const x1 = Math.min(
      image.width,
      Math.floor(box.originX + box.width * 0.85)
    );
    const y0 = Math.max(0, Math.ceil(box.originY + box.height * 0.15));
    const y1 = Math.min(
      image.height,
      Math.floor(box.originY + box.height * 0.85)
    );
    for (let y = y0; y < y1; y++)
      mask.data.fill(255, y * image.width + x0, y * image.width + x1);
    cv.goodFeaturesToTrack(gray, found, 100, 0.015, 6, mask);
    if (found.rows < 12) return;
    points?.delete();
    points = found.clone();
    pointIds = Array.from({length: found.rows}, (_, i) => i);
    target = {
      targetId: ++nextTargetId,
      label: detection.categories[0].categoryName,
    };
  } finally {
    mask.delete();
    found.delete();
  }
}

function track(gray: CvMat) {
  if (!previousGray || !points || !target) return;
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
      return;
    }
    points.delete();
    points = cv.matFromArray(ids.length, 1, cv.CV_32FC2, values);
    pointIds = ids;
  } finally {
    for (const mat of [next, back, status, backStatus, errors, backErrors])
      mat.delete();
  }
}

function processFrame(
  message: Extract<TangibleWorkerRequest, {type: 'frame'}>
) {
  const started = performance.now();
  if (!cv || !detector || disposed) return;
  if (
    previousGray &&
    (message.timeMs - lastFrameTime > 600 ||
      previousGray.cols !== message.width ||
      previousGray.rows !== message.height)
  )
    reset();
  const reply = (observation: TangibleObservation | null) =>
    scope.postMessage({
      type: 'result',
      requestId: message.requestId,
      observation,
      processingMs: performance.now() - started,
    });
  if (!target && message.timeMs - lastRecognition < recognitionIntervalMs) {
    reply(null);
    return;
  }
  const image = new ImageData(
    new Uint8ClampedArray(message.pixels),
    message.width,
    message.height
  );
  const rgba = cv.matFromImageData(image);
  let gray: CvMat | null = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    track(gray);
    recognize(image, gray, message.timeMs);
    lastFrameTime = message.timeMs;
    previousGray?.delete();
    previousGray = target ? gray : null;
    if (target) gray = null; // Transfer ownership; avoid copying the full image.
    const observation =
      target && points
        ? {
            ...target,
            features: pointIds.map((id, i) => ({
              id,
              u: points!.data32F[i * 2] / message.width,
              v: points!.data32F[i * 2 + 1] / message.height,
            })),
          }
        : null;
    reply(observation);
  } finally {
    rgba.delete();
    gray?.delete();
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    if (message.type === 'initialize') {
      void initialize(message).catch((error) => {
        if (!disposed)
          scope.postMessage({type: 'error', message: String(error)});
      });
    } else if (message.type === 'frame') processFrame(message);
    else if (message.type === 'reset') reset();
    else if (message.type === 'dispose') {
      disposed = true;
      reset();
      detector?.close();
      detector = null;
      scope.postMessage({type: 'disposed'});
      scope.close();
    }
  } catch (error) {
    reset();
    scope.postMessage({type: 'error', message: String(error)});
  }
};
