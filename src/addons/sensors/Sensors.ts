import * as THREE from 'three';
import { Core, Input, Script } from 'xrblocks';
import {
  DEFAULT_SENSORS_OPTIONS,
  type SensorsOptions,
  type SensorsObservation,
  type SensorsFrameRecord,
} from './SensorsTypes';

import * as ProprioceptionProcessor from './processors/ProprioceptionProcessor';
import { captureSceneGraph } from './processors/SceneGraphProcessor';
import { captureTargeting } from './processors/TargetingProcessor';
import * as DepthProcessor from './processors/DepthProcessor';
import { getVisibleInteractiveObjects } from './processors/VisibilityProcessor';
import { renderAnnotatedScreenshot } from './processors/ScreenshotProcessor';
import { generateSemanticMap } from './processors/SemanticMapProcessor';

export class Sensors extends Script {
  static dependencies = {
    core: Core,
    input: Input,
    camera: THREE.Camera,
  };

  editorIcon = 'sensors';
  private defaultOptions: Required<SensorsOptions>;

  core!: Core;
  input!: Input;
  camera!: THREE.Camera;

  private isRecording = false;
  private frameHistory: SensorsFrameRecord[] = [];
  private recordingOptions: SensorsOptions = {};
  private lastObservationTime_ = 0;
  private cachedObservation_: SensorsObservation | null = null;

  onFrameRecord: ((record: SensorsFrameRecord) => void) | null = null;

  constructor(options: SensorsOptions = {}) {
    super();
    this.defaultOptions = {
      ...DEFAULT_SENSORS_OPTIONS,
      ...options,
    };
  }

  override init(dependencies: {
    core: Core;
    input: Input;
    camera: THREE.Camera;
  }) {
    this.core = dependencies.core;
    this.input = dependencies.input;
    this.camera = dependencies.camera;
  }

  startRecording(options: SensorsOptions = {}) {
    this.frameHistory = [];
    this.recordingOptions = {
      ...this.defaultOptions,
      ...options,
    };
    this.isRecording = true;
  }

  stopRecording(): SensorsFrameRecord[] {
    this.isRecording = false;
    const history = this.frameHistory;
    this.frameHistory = [];
    return history;
  }

  override update(time: number) {
    if (this.isRecording) {
      const record: SensorsFrameRecord = {
        timestamp: time,
      };
      if (this.recordingOptions.includeProprioception) {
        record.state = ProprioceptionProcessor.captureProprioception(
          this.core,
          this.camera,
          this.input
        );
      }
      if (this.recordingOptions.includeSceneGraph) {
        record.sceneGraph = captureSceneGraph(this.core);
      }
      if (this.recordingOptions.includeTargeting) {
        record.targeting = captureTargeting(this.input);
      }
      this.frameHistory.push(record);
      if (this.onFrameRecord) {
        this.onFrameRecord(record);
      }
    }
  }

  async captureObservation(
    customOptions?: SensorsOptions
  ): Promise<SensorsObservation> {
    const options = {
      ...this.defaultOptions,
      ...customOptions,
    };

    const now = performance.now();

    // 1. Frame Lifecycle Management: Reset cache if time has advanced beyond the configurable window
    if (
      this.cachedObservation_ === null ||
      now - this.lastObservationTime_ >= options.cacheWindowMs
    ) {
      this.cachedObservation_ = {};
      this.lastObservationTime_ = now;
    }

    const observation = this.cachedObservation_;

    // Self-caching lazy evaluator for visible interactive objects (scene raycasting)
    let cachedVisibleObjects: ReturnType<typeof getVisibleInteractiveObjects> | null = null;
    const getVisibleObjects = () => {
      if (cachedVisibleObjects === null) {
        cachedVisibleObjects = getVisibleInteractiveObjects(this.core, this.camera);
      }
      return cachedVisibleObjects;
    };

    // 3. Progressive Screenshot Generation
    const getXRScreenshot = async (): Promise<string | undefined> => {
      if (observation.screenshotXR) return observation.screenshotXR;
      const synth = this.core.screenshotSynthesizer;
      if (synth) {
        observation.screenshotXR = (await synth.getScreenshot(true)) || undefined;
      }
      return observation.screenshotXR;
    };

    // Raw Camera
    if (options.includeScreenshotCamera && !observation.screenshotCamera) {
      const camera = this.core.deviceCamera;
      if (camera) {
        observation.screenshotCamera = (await camera.getSnapshot({
          outputFormat: 'base64',
          cacheWindowMs: options.cacheWindowMs,
        })) || undefined;
      }
    }

    // Blended XR
    if (options.includeScreenshotXR && !observation.screenshotXR) {
      observation.screenshotXR = await getXRScreenshot();
    }

    // Set-of-Mark (SOM)
    if (options.includeScreenshotSOM && !observation.screenshotSOM) {
      const xr = observation.screenshotXR || (await getXRScreenshot());
      if (xr) {
        observation.screenshotSOM = await renderAnnotatedScreenshot(
          this.camera,
          xr,
          getVisibleObjects()
        );
        observation.screenshotXR = xr;
      }
    }

    // Progressive Semantic Map Generation
    if (options.includeSemanticMap && !observation.visibleObjects) {
      observation.visibleObjects = generateSemanticMap(getVisibleObjects());
    }

    // Progressive Proprioception Capture
    if (options.includeProprioception && !observation.state) {
      observation.state = ProprioceptionProcessor.captureProprioception(
        this.core,
        this.camera,
        this.input
      );
    }

    // Progressive Scene Graph Capture
    if (options.includeSceneGraph && !observation.sceneGraph) {
      observation.sceneGraph = captureSceneGraph(this.core);
    }

    // Progressive Depth Capture
    if (options.includeDepth && !observation.depth) {
      observation.depth = DepthProcessor.captureDepth(
        this.core,
        this.camera,
        options.depthGridSize ?? 16
      );
    }

    // Progressive Targeting Capture
    if (options.includeTargeting && !observation.targeting) {
      observation.targeting = captureTargeting(this.input);
    }

    return observation;
  }
}
