import * as THREE from 'three';
import {
  Core,
  Depth,
  Script,
  detectDeviceCameraTarget,
  disposeObjectChildren,
  getCameraParametersSnapshot,
  type CameraParametersSnapshot,
} from 'xrblocks';
import {DepthFrame} from './DepthFrame';
import {estimateRigidPose, type PointPair} from './RigidPose';
import {
  DEFAULT_TANGIBLE_ASSETS,
  type TangibleObservation,
  type TangibleRegion,
  type TangibleState,
  type TangibleWidgetsOptions,
  type TangibleWorkerReply,
  type TangibleWorkerRequest,
} from './TangibleTypes';

/** Registers a central image patch with depth and attaches selected content. */
export class TangibleWidgets extends Script {
  static dependencies = {engine: Core, depth: Depth};

  /** Content frame: metres, X right/Y up/+Z toward the viewer at registration. */
  readonly target = new THREE.Group();
  /** Tilt from the neutral pose, normalized to [-1, 1] at 30 degrees. Zero on loss. */
  readonly tilt = new THREE.Vector2();
  /** Twist from the neutral pose, in radians. Zero on loss. */
  twist = 0;
  state: TangibleState = 'loading';
  status = 'Loading OpenCV tracking.';
  widgetId: string | null = null;
  /** Extent of registered visible features; not the full physical object size. */
  readonly patchSize = new THREE.Vector3();
  readonly diagnostics = {
    imageFeatureCount: 0,
    captureMs: 0,
    depthIndexMs: 0,
    observationAgeMs: 0,
    lastFailure: 'none',
    featureCount: 0,
    inliers: 0,
    residualMeters: 0,
    processingMs: 0,
    poseAgeMs: Infinity,
    depthAgeMs: Infinity,
    timing: 'estimated' as 'estimated' | 'xr-frame',
  };

  private engine?: Core;
  private depth?: Depth;
  private depthAcquired = false;
  private worker: Worker | null = null;
  private ready = false;
  private stopped = false;
  private epoch = 0;
  private requestId = 0;
  private inFlight: {
    id: number;
    epoch: number;
    depth: DepthFrame;
    startedAt: number;
  } | null = null;
  private capturing = false;
  private rawCaptureFrame: DepthFrame | null = null;
  private lastRequestAt = -Infinity;
  private lastPoseAt = -Infinity;
  private lastDepthVersion = -1;
  private lastDepthAt = -Infinity;
  private targetId: number | null = null;
  private readonly reference = new Map<number, THREE.Vector3>();
  private readonly neutral = new THREE.Quaternion();
  private readonly smoothingPosition = new THREE.Vector3();
  private readonly smoothingQuaternion = new THREE.Quaternion();
  private workerTimeout: ReturnType<typeof setTimeout> | null = null;
  private tracking = false;
  private registrationPending = false;
  private lastVideoTime = NaN;
  private readonly trackingInterval: number;
  private readonly poseSmoothingMs: number;
  private readonly maxAge: number;
  private readonly maxResidual: number;
  private readonly cameraProfile: string;

  constructor(private readonly options: TangibleWidgetsOptions) {
    super();
    const ids = Object.keys(options.widgets);
    if (
      !ids.length ||
      ids.some(
        (id) => !id.trim() || typeof options.widgets[id].create !== 'function'
      )
    ) {
      throw new Error(
        'TangibleWidgets requires at least one widget ID and factory.'
      );
    }
    const fps = options.trackingFps ?? 15;
    this.poseSmoothingMs = options.poseSmoothingMs ?? 100;
    if (!Number.isFinite(this.poseSmoothingMs) || this.poseSmoothingMs < 0)
      throw new RangeError('poseSmoothingMs must be finite and non-negative.');
    this.maxAge = options.maxPoseAgeMs ?? 500;
    this.maxResidual = options.maxResidualMeters ?? 0.025;
    for (const value of [fps, this.maxAge, this.maxResidual]) {
      if (!Number.isFinite(value) || value <= 0)
        throw new RangeError(
          'Tangible tracking options must be positive finite numbers.'
        );
    }
    this.trackingInterval = 1000 / Math.min(fps, 60);
    this.cameraProfile = options.cameraProfile ?? detectDeviceCameraTarget();
    this.target.name = 'TangibleWidget';
    this.target.visible = false;
    this.target.xb = {interactionEnabled: false};
    this.add(this.target);
  }

  override init({engine, depth}: {engine: Core; depth: Depth}) {
    if (this.stopped) return;
    this.engine = engine;
    this.depth = depth;
    if (!engine.deviceCamera || !depth.options.enabled || !depth.depthMesh) {
      this.fail(
        'Enable the environment camera and depth before initializing TangibleWidgets.'
      );
      return;
    }
    if (!depth.options.depthMesh.updateFullResolutionGeometry) {
      this.fail(
        'Enable depth.depthMesh.updateFullResolutionGeometry for tangible tracking.'
      );
      return;
    }
    depth.resumeDepth(this);
    this.depthAcquired = true;
    try {
      this.worker = new Worker(new URL('./TangibleWorker.js', import.meta.url));
      this.worker.onmessage = (event: MessageEvent<TangibleWorkerReply>) =>
        this.handleReply(event.data);
      this.worker.onerror = (event) =>
        this.fail(event.message || 'The tracking worker failed.');
      this.worker.onmessageerror = () =>
        this.fail('Could not read a tracking result.');
      this.workerTimeout = setTimeout(
        () =>
          this.fail(
            'Tracking assets did not load. Check the network and asset URLs.'
          ),
        60000
      );
      this.send({
        type: 'initialize',
        assets: {...DEFAULT_TANGIBLE_ASSETS, ...optionsAssets(this.options)},
      });
    } catch (error) {
      this.fail(String(error));
    }
  }

  /** Capture the next camera frame's central patch and attach the selected widget. */
  register(widgetId: string): boolean {
    if (!this.options.widgets[widgetId])
      throw new Error(`Unknown widget: ${widgetId}`);
    if (!this.ready || this.stopped || this.state === 'error') return false;
    this.reset();
    this.widgetId = widgetId;
    this.tracking = true;
    this.registrationPending = true;
    this.hide('registering', 'Hold the surface inside the preview box still.');
    return true;
  }

  /** Clear the attachment. Registration always requires an explicit request. */
  reset() {
    if (this.stopped || this.state === 'error') return;
    this.epoch++;
    this.reference.clear();
    this.targetId = null;
    this.lastPoseAt = -Infinity;
    this.tracking = false;
    this.registrationPending = false;
    this.lastRequestAt = -Infinity;
    this.widgetId = null;
    this.patchSize.set(0, 0, 0);
    disposeObjectChildren(this.target);
    this.hide('idle', 'Choose a widget, aim at a surface, and press Register.');
    this.send({type: 'reset'});
  }

  /** Set the current measured orientation as the controls' neutral pose. */
  recenter() {
    if (this.state !== 'tracked') return;
    this.neutral.copy(this.smoothingQuaternion);
    this.tilt.set(0, 0);
    this.twist = 0;
  }

  override onXRSessionEnded() {
    this.reset();
  }
  override onXRSessionStarted() {
    this.reset();
  }

  override update(time = performance.now(), frame?: XRFrame) {
    if (this.stopped || this.state === 'error' || !this.engine || !this.depth)
      return;
    const now = performance.now();
    this.diagnostics.poseAgeMs = Math.max(0, now - this.lastPoseAt);
    if (this.state === 'tracked' && this.diagnostics.poseAgeMs > this.maxAge)
      this.hide('lost', 'Tracking is stale. Hold the object in view.');
    if (this.inFlight && now - this.inFlight.startedAt > 10000) {
      this.fail('The tracking worker stopped responding. Reload to try again.');
      return;
    }
    const camera = this.engine.deviceCamera!;
    const mesh = this.depth.depthMesh;
    const attribute = mesh?.geometry.getAttribute('position') as
      | THREE.BufferAttribute
      | undefined;
    if (attribute && attribute.version !== this.lastDepthVersion) {
      this.lastDepthVersion = attribute.version;
      this.lastDepthAt = now;
    }
    this.diagnostics.depthAgeMs = now - this.lastDepthAt;
    if (camera.isUsingXRCameraAccess && this.capturing) {
      // Raw capture resolves after this animation frame. Save the depth and
      // XRView from that frame before its pixels reach the worker.
      this.rawCaptureFrame = this.freezeDepth(time, frame);
    }
    if (
      !this.ready ||
      this.inFlight ||
      this.capturing ||
      now - this.lastRequestAt < (this.tracking ? this.trackingInterval : 250)
    )
      return;
    if (
      !camera.loaded ||
      !camera.width ||
      !camera.height ||
      !mesh ||
      this.diagnostics.depthAgeMs > this.maxAge
    ) {
      this.hide(
        this.tracking ? (this.reference.size ? 'lost' : 'registering') : 'idle',
        'Waiting for camera and fresh XR depth.'
      );
      return;
    }
    this.lastRequestAt = now;
    const width = Math.min(480, camera.width);
    const height = Math.max(
      1,
      Math.round((camera.height * width) / camera.width)
    );
    const snapshotOptions = {width, height, outputFormat: 'imageData' as const};
    if (camera.isUsingXRCameraAccess) {
      const captureStarted = performance.now();
      this.capturing = true;
      this.rawCaptureFrame = null;
      const epoch = this.epoch;
      void camera
        .captureSnapshot(snapshotOptions)
        .then((image) => {
          this.diagnostics.captureMs = performance.now() - captureStarted;
          if (
            !this.stopped &&
            epoch === this.epoch &&
            image &&
            this.rawCaptureFrame
          ) {
            this.submit(image, this.rawCaptureFrame);
          }
        })
        .catch((error) => this.fail(String(error)))
        .finally(() => {
          this.capturing = false;
          this.rawCaptureFrame = null;
        });
    } else {
      try {
        if (camera.video.currentTime === this.lastVideoTime) return;
        const depth = this.freezeDepth(now, frame);
        if (!depth) return;
        this.lastVideoTime = camera.video.currentTime;
        const captureStarted = performance.now();
        const image = camera.getSnapshot(snapshotOptions);
        this.diagnostics.captureMs = performance.now() - captureStarted;
        if (image) this.submit(image, depth);
      } catch (error) {
        this.fail(String(error));
      }
    }
  }

  private cameraParameters(frame?: XRFrame): CameraParametersSnapshot | null {
    const engine = this.engine!;
    const camera = engine.deviceCamera!;
    if (camera.isUsingXRCameraAccess) {
      const referenceSpace = engine.renderer.xr.getReferenceSpace();
      if (!frame || !referenceSpace) return null;
      const view = frame
        .getViewerPose(referenceSpace)
        ?.views.find((view) => !!(view as XRView & {camera?: unknown}).camera);
      if (!view) return null;
      const worldFromView = new THREE.Matrix4().fromArray(
        view.transform.matrix
      );
      const clipFromView = new THREE.Matrix4().fromArray(view.projectionMatrix);
      const viewFromClip = clipFromView.clone().invert();
      this.diagnostics.timing = 'xr-frame';
      return {
        worldFromView,
        clipFromView,
        viewFromClip,
        worldFromClip: worldFromView.clone().multiply(viewFromClip),
      };
    }
    this.diagnostics.timing = 'estimated';
    return getCameraParametersSnapshot(
      engine.camera,
      engine.renderer.xr.isPresenting
        ? (engine.renderer.xr.getCamera() as THREE.WebXRArrayCamera)
        : null,
      camera,
      this.cameraProfile
    );
  }

  private freezeDepth(timeMs: number, frame?: XRFrame): DepthFrame | null {
    const mesh = this.depth?.depthMesh;
    const params = this.cameraParameters(frame);
    if (!mesh || !params || this.diagnostics.depthAgeMs > this.maxAge)
      return null;
    const started = performance.now();
    const snapshot = new DepthFrame(
      mesh,
      params.worldFromView,
      params.clipFromView,
      timeMs
    );
    this.diagnostics.depthIndexMs = performance.now() - started;
    return snapshot;
  }

  private submit(image: ImageData, depth: DepthFrame) {
    if (!this.worker || this.inFlight || this.state === 'error') return;
    const side = Math.min(image.width, image.height) * 0.52;
    const region: TangibleRegion = {
      u: (image.width - side) / (2 * image.width),
      v: (image.height - side) / (2 * image.height),
      width: side / image.width,
      height: side / image.height,
    };
    try {
      this.options.onCameraFrame?.(image, region);
      if (!this.tracking) return; // Preview only; no worker work while idle.
      if (this.registrationPending && !depth.sample(0.5, 0.5)) {
        this.stopTracking(
          'No depth at the box centre. Aim at an opaque surface and register again.'
        );
        return;
      }
      const id = ++this.requestId;
      this.inFlight = {
        id,
        depth,
        epoch: this.epoch,
        startedAt: performance.now(),
      };
      const registration = this.registrationPending ? region : undefined;
      this.registrationPending = false;
      const pixels = image.data.buffer as ArrayBuffer;
      this.worker.postMessage(
        {
          type: 'frame',
          requestId: id,
          timeMs: depth.timeMs,
          width: image.width,
          height: image.height,
          pixels,
          registration,
        } satisfies TangibleWorkerRequest,
        [pixels]
      );
    } catch (error) {
      this.fail(String(error));
    }
  }

  private handleReply(reply: TangibleWorkerReply) {
    if (this.stopped || this.state === 'error') return;
    if (reply.type === 'disposed') return;
    if (reply.type === 'ready') {
      if (this.workerTimeout) clearTimeout(this.workerTimeout);
      this.workerTimeout = null;
      this.ready = true;
      this.hide(
        'idle',
        'Choose a widget, aim at a surface, and press Register.'
      );
      return;
    }
    if (reply.type === 'error') {
      this.fail(reply.message);
      return;
    }
    const request = this.inFlight;
    if (!request || request.id !== reply.requestId) return;
    this.inFlight = null;
    if (request.epoch !== this.epoch) return;
    this.diagnostics.processingMs = reply.processingMs;
    this.diagnostics.imageFeatureCount = reply.featureCount;
    this.diagnostics.featureCount = 0;
    this.diagnostics.inliers = 0;
    this.diagnostics.residualMeters = 0;
    this.diagnostics.observationAgeMs =
      performance.now() - request.depth.timeMs;
    if (performance.now() - request.depth.timeMs > this.maxAge) {
      this.hide(
        'lost',
        `Image is ${Math.round(this.diagnostics.observationAgeMs)} ms old (limit ${this.maxAge} ms). Waiting for tracking.`
      );
      return;
    }
    try {
      if (!reply.observation) this.stopTracking(reply.status);
      else this.applyObservation(reply.observation, request.depth);
    } catch (error) {
      this.fail(String(error));
    }
  }

  private applyObservation(
    observation: TangibleObservation,
    depth: DepthFrame
  ) {
    if (!this.widgetId || !this.tracking) return;
    const samples = observation.features.flatMap((feature) => {
      const point = depth.sample(feature.u, feature.v);
      return point ? [{id: feature.id, point}] : [];
    });
    this.diagnostics.featureCount = samples.length;
    if (this.targetId !== observation.targetId) {
      this.reference.clear();
      this.targetId = observation.targetId;
      this.hide(
        'registering',
        'Hold the object still while its depth is registered.'
      );
    }
    if (!this.reference.size) {
      if (samples.length < 12)
        return this.stopTracking(
          `${samples.length}/${observation.features.length} image features have depth; need 12.`
        );
      const centreDepth = depth.sample(0.5, 0.5);
      if (!centreDepth)
        return this.stopTracking(
          'No depth at the registration centre. Register again.'
        );
      const range = centreDepth.distanceTo(depth.cameraPosition);
      // Register the surface at the box centre, excluding depth far behind it.
      const foreground = samples.filter(
        (item) =>
          Math.abs(item.point.distanceTo(depth.cameraPosition) - range) < 0.15
      );
      if (foreground.length < 12)
        return this.stopTracking(
          `${foreground.length} depth points agree on object distance; need 12.`
        );
      const center = new THREE.Vector3();
      for (const sample of foreground) center.add(sample.point);
      center.divideScalar(foreground.length);
      const inverse = depth.cameraQuaternion.clone().invert();
      for (const sample of foreground)
        this.reference.set(
          sample.id,
          sample.point.clone().sub(center).applyQuaternion(inverse)
        );
      // Reject registrations that cannot constrain a full rigid transform.
      const proof = estimateRigidPose(
        foreground.map((sample) => ({
          source: this.reference.get(sample.id)!,
          target: sample.point,
        })),
        this.maxResidual
      );
      if (!proof) {
        this.reference.clear();
        return this.stopTracking('Depth points do not span a stable surface.');
      }
      this.neutral.copy(depth.cameraQuaternion);
      this.smoothingPosition.copy(center);
      this.smoothingQuaternion.copy(depth.cameraQuaternion);
      this.patchSize.copy(
        new THREE.Box3()
          .setFromPoints([...this.reference.values()])
          .getSize(new THREE.Vector3())
      );
      if (!this.target.children.length) {
        const widget = this.options.widgets[this.widgetId].create(
          this.widgetId
        );
        this.target.add(widget);
      }
    }
    const pairs: PointPair[] = samples.flatMap((sample) => {
      const source = this.reference.get(sample.id);
      return source ? [{source, target: sample.point}] : [];
    });
    const pose = estimateRigidPose(pairs, this.maxResidual);
    if (!pose) {
      this.hide(
        'lost',
        'Depth and image motion disagree. Hold the textured surface in view.'
      );
      if (performance.now() - this.lastPoseAt > this.maxAge)
        this.stopTracking(
          'Depth and image motion disagree. Register the surface again.'
        );
      return;
    }
    const dt = Math.max(0, depth.timeMs - this.lastPoseAt);
    // Time-based exponential LPF: translation lerp and shortest-path quaternion
    // slerp. The first pose snaps into place instead of blending from an old target.
    const alpha =
      this.poseSmoothingMs === 0 || !Number.isFinite(this.lastPoseAt)
        ? 1
        : 1 - Math.exp(-dt / this.poseSmoothingMs);
    this.smoothingPosition.lerp(pose.position, alpha);
    this.smoothingQuaternion.slerp(pose.quaternion, alpha);
    const world = new THREE.Matrix4().compose(
      this.smoothingPosition,
      this.smoothingQuaternion,
      new THREE.Vector3(1, 1, 1)
    );
    this.updateWorldMatrix(true, false);
    world.premultiply(this.matrixWorld.clone().invert());
    world.decompose(
      this.target.position,
      this.target.quaternion,
      this.target.scale
    );
    const relative = this.neutral
      .clone()
      .invert()
      .multiply(this.smoothingQuaternion);
    const angles = new THREE.Euler().setFromQuaternion(relative, 'YXZ');
    this.tilt.set(
      THREE.MathUtils.clamp(angles.y / (Math.PI / 6), -1, 1),
      THREE.MathUtils.clamp(angles.x / (Math.PI / 6), -1, 1)
    );
    if (this.tilt.length() < 0.08) this.tilt.set(0, 0);
    this.twist = angles.z;
    this.lastPoseAt = depth.timeMs;
    this.diagnostics.inliers = pose.inliers;
    this.diagnostics.residualMeters = pose.residualMeters;
    this.diagnostics.poseAgeMs = Math.max(0, performance.now() - depth.timeMs);
    this.target.visible = true;
    this.target.xb!.interactionEnabled = true;
    this.state = 'tracked';
    this.status = `${this.widgetId}: attached and tracking`;
  }

  private stopTracking(reason: string) {
    this.tracking = false;
    this.registrationPending = false;
    this.hide('lost', reason);
    this.send({type: 'reset'});
  }

  private hide(state: TangibleState, status: string) {
    if (state === 'lost' || state === 'error')
      this.diagnostics.lastFailure = status;
    this.target.visible = false;
    this.target.xb!.interactionEnabled = false;
    this.tilt.set(0, 0);
    this.twist = 0;
    this.state = state;
    this.status = status;
  }

  private send(message: TangibleWorkerRequest) {
    this.worker?.postMessage(message);
  }

  private fail(message: string) {
    if (this.stopped) return;
    this.hide('error', message);
    this.stopWorker();
    this.releaseDepth();
  }

  private stopWorker() {
    if (this.workerTimeout) clearTimeout(this.workerTimeout);
    this.workerTimeout = null;
    if (this.worker) {
      const worker = this.worker;
      this.worker = null;
      // Give WASM a bounded opportunity to release their data.
      const timeout = setTimeout(() => worker.terminate(), 250);
      worker.onmessage = (event: MessageEvent<TangibleWorkerReply>) => {
        if (event.data.type !== 'disposed') return;
        clearTimeout(timeout);
        worker.terminate();
      };
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.postMessage({type: 'dispose'} satisfies TangibleWorkerRequest);
    }
    this.inFlight = null;
    this.rawCaptureFrame = null;
    this.ready = false;
  }

  override dispose() {
    if (this.stopped) return;
    this.stopped = true;
    this.epoch++;
    this.hide('disposed', 'Tracking stopped.');
    this.stopWorker();
    this.releaseDepth();
    this.reference.clear();
    disposeObjectChildren(this.target);
  }

  private releaseDepth() {
    if (!this.depthAcquired) return;
    this.depthAcquired = false;
    this.depth!.pauseDepth(this);
  }
}

function optionsAssets(options: TangibleWidgetsOptions) {
  return Object.fromEntries(
    Object.entries(options.assets ?? {}).map(([key, value]) => [
      key,
      new URL(value, document.baseURI).href,
    ])
  );
}
