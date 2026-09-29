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
  type TangibleState,
  type TangibleWidgetsOptions,
  type TangibleWorkerReply,
  type TangibleWorkerRequest,
} from './TangibleTypes';

/** Recognizes one object, registers it with depth, and attaches its widget. */
export class TangibleWidgets extends Script {
  static dependencies = {engine: Core, depth: Depth};

  /** Content frame: metres, X right/Y up/+Z toward the viewer at registration. */
  readonly target = new THREE.Group();
  /** Tilt from the neutral pose, normalized to [-1, 1] at 30 degrees. Zero on loss. */
  readonly tilt = new THREE.Vector2();
  /** Twist from the neutral pose, in radians. Zero on loss. */
  twist = 0;
  state: TangibleState = 'loading';
  status = 'Loading local recognition and tracking.';
  label: string | null = null;
  /** Extent of registered visible features; not the full physical object size. */
  readonly patchSize = new THREE.Vector3();
  readonly diagnostics = {
    imageFeatureCount: 0,
    detectedLabel: 'none',
    captureMs: 0,
    depthIndexMs: 0,
    observationAgeMs: 0,
    lastFailure: 'none',
    featureCount: 0,
    inliers: 0,
    residualMeters: 0,
    processingMs: 0,
    opticalFlowMs: 0,
    recognitionMs: 0,
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
  private readonly worldQuaternion = new THREE.Quaternion();
  private readonly smoothingPosition = new THREE.Vector3();
  private readonly smoothingQuaternion = new THREE.Quaternion();
  private workerTimeout: ReturnType<typeof setTimeout> | null = null;
  private registrationStartedAt = -Infinity;
  private lastVideoTime = NaN;
  private readonly trackingInterval: number;
  private readonly recognitionInterval: number;
  private readonly maxAge: number;
  private readonly maxResidual: number;
  private readonly cameraProfile: string;

  constructor(private readonly options: TangibleWidgetsOptions) {
    super();
    const labels = Object.keys(options.widgets);
    if (
      !labels.length ||
      labels.some(
        (label) =>
          !label.trim() || typeof options.widgets[label].create !== 'function'
      )
    ) {
      throw new Error(
        'TangibleWidgets requires at least one category and widget factory.'
      );
    }
    const fps = options.trackingFps ?? 15;
    this.recognitionInterval = options.recognitionIntervalMs ?? 1500;
    this.maxAge = options.maxPoseAgeMs ?? 500;
    this.maxResidual = options.maxResidualMeters ?? 0.025;
    for (const value of [
      fps,
      this.recognitionInterval,
      this.maxAge,
      this.maxResidual,
    ]) {
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
        labels: Object.keys(this.options.widgets),
        recognitionIntervalMs: this.recognitionInterval,
      });
    } catch (error) {
      this.fail(String(error));
    }
  }

  /** Discard the registration and find a supported object again. */
  reset() {
    if (this.stopped || this.state === 'error') return;
    this.epoch++;
    this.reference.clear();
    this.targetId = null;
    this.lastPoseAt = -Infinity;
    this.registrationStartedAt = -Infinity;
    this.lastRequestAt = -Infinity;
    this.label = null;
    this.patchSize.set(0, 0, 0);
    disposeObjectChildren(this.target);
    this.hide('searching', 'Show a configured object.');
    this.send({type: 'reset'});
  }

  /** Set the current measured orientation as the controls' neutral pose. */
  recenter() {
    if (this.state !== 'tracked') return;
    this.neutral.copy(this.worldQuaternion);
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
      now - this.lastRequestAt <
        (this.state === 'searching'
          ? this.recognitionInterval
          : this.trackingInterval)
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
        this.reference.size ? 'lost' : 'searching',
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
    const id = ++this.requestId;
    this.inFlight = {
      id,
      depth,
      epoch: this.epoch,
      startedAt: performance.now(),
    };
    try {
      const pixels = image.data.buffer as ArrayBuffer;
      this.worker.postMessage(
        {
          type: 'frame',
          requestId: id,
          timeMs: depth.timeMs,
          width: image.width,
          height: image.height,
          pixels,
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
        'searching',
        'Show a configured object. Registration is automatic.'
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
    this.diagnostics.opticalFlowMs = reply.opticalFlowMs;
    this.diagnostics.recognitionMs = reply.recognitionMs;
    this.diagnostics.detectedLabel = reply.observation?.label ?? 'none';
    this.diagnostics.imageFeatureCount =
      reply.observation?.features.length ?? 0;
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
      this.applyObservation(reply.observation, request.depth);
    } catch (error) {
      this.fail(String(error));
    }
  }

  private applyObservation(
    observation: TangibleObservation | null,
    depth: DepthFrame
  ) {
    if (!observation) {
      this.hide(
        'searching',
        'No textured object found. Show its printed surface.'
      );
      return;
    }
    if (!this.options.widgets[observation.label]) return;
    const samples = observation.features.flatMap((feature) => {
      const point = depth.sample(feature.u, feature.v);
      return point ? [{id: feature.id, point}] : [];
    });
    this.diagnostics.featureCount = samples.length;
    if (this.targetId !== observation.targetId) {
      this.reference.clear();
      this.targetId = observation.targetId;
      this.registrationStartedAt = performance.now();
      this.hide(
        'registering',
        'Hold the object still while its depth is registered.'
      );
    }
    if (!this.reference.size) {
      if (samples.length < 12)
        return this.registrationFailed(
          `${samples.length}/${observation.features.length} image features have depth; need 12.`
        );
      const ranges = samples
        .map((item) => item.point.distanceTo(depth.cameraPosition))
        .sort((a, b) => a - b);
      const median = ranges[Math.floor(ranges.length / 2)];
      const foreground = samples.filter(
        (item) =>
          Math.abs(item.point.distanceTo(depth.cameraPosition) - median) < 0.15
      );
      if (foreground.length < 12)
        return this.registrationFailed(
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
        return this.registrationFailed(
          'Depth points do not span a stable surface.'
        );
      }
      this.worldQuaternion.copy(depth.cameraQuaternion);
      this.neutral.copy(depth.cameraQuaternion);
      this.smoothingPosition.copy(center);
      this.smoothingQuaternion.copy(depth.cameraQuaternion);
      this.patchSize.copy(
        new THREE.Box3()
          .setFromPoints([...this.reference.values()])
          .getSize(new THREE.Vector3())
      );
      if (this.label !== observation.label || !this.target.children.length) {
        disposeObjectChildren(this.target);
        const widget = this.options.widgets[observation.label].create(
          observation.label
        );
        this.target.add(widget);
      }
      this.label = observation.label;
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
      if (performance.now() - this.lastPoseAt > this.maxAge) this.reset();
      return;
    }
    this.worldQuaternion.copy(pose.quaternion);
    const dt = Math.max(0, depth.timeMs - this.lastPoseAt);
    const alpha = 1 - Math.exp(-dt / 45);
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
    const relative = this.neutral.clone().invert().multiply(pose.quaternion);
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
    this.status = `${observation.label}: attached and tracking`;
  }

  private registrationFailed(reason: string) {
    this.diagnostics.lastFailure = reason;
    this.hide('registering', reason);
    if (performance.now() - this.registrationStartedAt > 2500) this.reset();
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
      // Give WASM and the model a bounded opportunity to release their data.
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
