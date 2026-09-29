// Classic worker: OpenCV's WASM loader uses importScripts.
import type {CvMat, OpenCv} from './OpenCvTypes';
import type {
  TangibleRegion,
  TangiblePose,
  TangibleWorkerReply,
  TangibleWorkerRequest,
} from './TangibleTypes';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TangibleWorkerRequest>) => void) | null;
  postMessage(message: TangibleWorkerReply, transfer?: Transferable[]): void;
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
let maxReprojectionErrorPx = 3;
const reference = new Map<number, {x: number; y: number; z: number}>();
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let messageStatus = 'Aim at a textured surface and press Register.';

function reset() {
  reference.clear();
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
    if (ids.length < (reference.size ? 6 : 12)) {
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

/** Solve a fixed 3D feature map against current pixels; no fresh depth required. */
function estimatePose(intrinsics: number[]): TangiblePose | null {
  if (!points || reference.size < 6) return null;
  const object: number[] = [],
    image: number[] = [];
  for (let i = 0; i < pointIds.length; i++) {
    const point = reference.get(pointIds[i]);
    if (!point) continue;
    object.push(point.x, point.y, point.z);
    image.push(points.data32F[i * 2], points.data32F[i * 2 + 1]);
  }
  const xs = image.filter((_, i) => i % 2 === 0);
  const ys = image.filter((_, i) => i % 2 === 1);
  if (
    Math.max(...xs) - Math.min(...xs) < 6 ||
    Math.max(...ys) - Math.min(...ys) < 6
  )
    return null;
  const count = image.length / 2;
  if (count < 6) return null;
  const [fx, fy, cx, cy] = intrinsics;
  if (![fx, fy, cx, cy].every(Number.isFinite) || fx <= 0 || fy <= 0)
    return null;
  const objectMat = cv.matFromArray(count, 1, cv.CV_64FC3, object);
  const imageMat = cv.matFromArray(count, 1, cv.CV_64FC2, image);
  const camera = cv.matFromArray(3, 3, cv.CV_64FC1, [
    fx,
    0,
    cx,
    0,
    fy,
    cy,
    0,
    0,
    1,
  ]);
  const distortion = new cv.Mat(),
    rvec = new cv.Mat(),
    tvec = new cv.Mat();
  const inliers = new cv.Mat(),
    rotation = new cv.Mat();
  try {
    // ITERATIVE refits the RANSAC consensus and supports both planar and curved maps.
    if (
      !cv.solvePnPRansac(
        objectMat,
        imageMat,
        camera,
        distortion,
        rvec,
        tvec,
        false,
        60,
        maxReprojectionErrorPx,
        0.99,
        inliers,
        cv.SOLVEPNP_ITERATIVE
      )
    )
      return null;
    if (inliers.rows < Math.max(6, Math.floor(count * 0.5) + 1)) return null;
    cv.Rodrigues(rvec, rotation);
    const r = rotation.data64F,
      t = tvec.data64F;
    if (![...r, ...t].every(Number.isFinite)) return null;
    let error = 0;
    for (const i of inliers.data32S) {
      const x = object[i * 3],
        y = object[i * 3 + 1],
        z = object[i * 3 + 2];
      const px = r[0] * x + r[1] * y + r[2] * z + t[0];
      const py = r[3] * x + r[4] * y + r[5] * z + t[1];
      const pz = r[6] * x + r[7] * y + r[8] * z + t[2];
      if (pz <= 0.05) return null;
      error +=
        ((fx * px) / pz + cx - image[i * 2]) ** 2 +
        ((fy * py) / pz + cy - image[i * 2 + 1]) ** 2;
    }
    const reprojectionErrorPx = Math.sqrt(error / inliers.rows);
    if (reprojectionErrorPx > maxReprojectionErrorPx) return null;
    // OpenCV camera axes: +Y down, +Z forward. Convert to Three.js once here.
    return {
      cameraFromObject: [
        r[0],
        -r[3],
        -r[6],
        0,
        r[1],
        -r[4],
        -r[7],
        0,
        r[2],
        -r[5],
        -r[8],
        0,
        t[0],
        -t[1],
        -t[2],
        1,
      ],
      inliers: inliers.rows,
      reprojectionErrorPx,
    };
  } catch {
    // Degenerate correspondences can make OpenCV reject the solve.
    return null;
  } finally {
    for (const mat of [
      objectMat,
      imageMat,
      camera,
      distortion,
      rvec,
      tvec,
      inliers,
      rotation,
    ])
      mat.delete();
  }
}

function setReference(
  message: Extract<TangibleWorkerRequest, {type: 'reference'}>
) {
  if (message.targetId !== targetId || !points) return;
  reference.clear();
  for (const point of message.points) reference.set(point.id, point);
  // Track only features with registered depth, not surrounding background.
  const ids: number[] = [],
    values: number[] = [];
  for (let i = 0; i < pointIds.length; i++)
    if (reference.has(pointIds[i])) {
      ids.push(pointIds[i]);
      values.push(points.data32F[i * 2], points.data32F[i * 2 + 1]);
    }
  points.delete();
  points = cv.matFromArray(ids.length, 1, cv.CV_32FC2, values);
  pointIds = ids;
}

function processFrame(
  message: Extract<TangibleWorkerRequest, {type: 'frame'}>
) {
  if (!cv || disposed) {
    message.bitmap?.close();
    return;
  }
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
  let image: ImageData;
  if (message.bitmap) {
    try {
      if (
        !canvas ||
        canvas.width !== message.width ||
        canvas.height !== message.height
      ) {
        canvas = new OffscreenCanvas(message.width, message.height);
        context = canvas.getContext('2d', {willReadFrequently: true});
      }
      if (!context) throw new Error('Worker image conversion is unavailable.');
      context.drawImage(message.bitmap, 0, 0, message.width, message.height);
      image = context.getImageData(0, 0, message.width, message.height);
    } finally {
      message.bitmap.close();
    }
  } else {
    image = new ImageData(
      new Uint8ClampedArray(message.pixels!),
      message.width,
      message.height
    );
  }
  const preview = message.preview
    ? {
        pixels: image.data.buffer as ArrayBuffer,
        width: image.width,
        height: image.height,
      }
    : undefined;
  if (message.previewOnly) {
    scope.postMessage(
      {
        type: 'result',
        requestId: message.requestId,
        observation: null,
        processingMs: performance.now() - started,
        featureCount: 0,
        status: messageStatus,
        preview,
      },
      preview ? [preview.pixels] : []
    );
    return;
  }
  const rgba = cv.matFromImageData(image);
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
          pose: reference.size ? estimatePose(message.intrinsics) : null,
          features: pointIds.map((id, i) => ({
            id,
            u: points!.data32F[i * 2] / message.width,
            v: points!.data32F[i * 2 + 1] / message.height,
          })),
        }
      : null;
    const processingMs = performance.now() - started;
    lastFrameEndTime = message.timeMs + processingMs;
    scope.postMessage(
      {
        type: 'result',
        requestId: message.requestId,
        observation,
        processingMs,
        featureCount,
        status: messageStatus,
        preview,
      },
      preview ? [preview.pixels] : []
    );
  } finally {
    rgba.delete();
    gray?.delete();
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    if (message.type === 'initialize') {
      maxReprojectionErrorPx = message.maxReprojectionErrorPx;
      void initialize(message.assets).catch((error) => {
        if (!disposed)
          scope.postMessage({type: 'error', message: String(error)});
      });
    } else if (message.type === 'reference') setReference(message);
    else if (message.type === 'frame') processFrame(message);
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
