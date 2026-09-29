import type * as THREE from 'three';

/** All image coordinates use normalized, top-left-origin UVs. */
export interface TrackedFeature {
  id: number;
  u: number;
  v: number;
}

export interface TangibleObservation {
  targetId: number;
  label: string;
  features: TrackedFeature[];
}

/** Latest detector result, before registration and feature checks. */
export interface TangibleRecognition {
  candidates: {label: string; score: number}[];
  selectedLabel: string | null;
  featureCount: number;
  reason: string;
}

export type TangibleState =
  | 'loading'
  | 'searching'
  | 'registering'
  | 'tracked'
  | 'lost'
  | 'error'
  | 'disposed';

/** One locally recognized object type and its attached content. */
export interface TangibleWidget {
  /** Returns fresh content. The tracker owns and disposes it. Local +Z faces the user at registration. */
  create(label: string): THREE.Object3D;
}

export interface TangibleWidgetsOptions {
  /** Model category names, for example `book`, `cup`, or `bottle`. */
  widgets: Record<string, TangibleWidget>;
  /** Maximum processing rate. Rendering remains independent. @defaultValue 15 */
  trackingFps?: number;
  /** Recognition interval while searching. @defaultValue 1500 */
  recognitionIntervalMs?: number;
  /** Maximum usable observation age, including worker time. @defaultValue 500 */
  maxPoseAgeMs?: number;
  /** Maximum rigid-fit residual, in metres. @defaultValue 0.025 */
  maxResidualMeters?: number;
  /** Optional device camera profile; uses SDK device detection by default. */
  cameraProfile?: string;
  /** Optional synchronous preview hook. Copy pixels here; their buffer is transferred afterwards. */
  onCameraFrame?: (image: ImageData) => void;
  /** Runtime assets. Override with same-origin URLs for offline deployment. */
  assets?: Partial<TangibleAssets>;
}

export interface TangibleAssets {
  openCvUrl: string;
  visionModuleUrl: string;
  visionWasmUrl: string;
  modelUrl: string;
}

export const DEFAULT_TANGIBLE_ASSETS: Readonly<TangibleAssets> = {
  openCvUrl:
    'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js',
  visionModuleUrl:
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/vision_bundle.mjs',
  visionWasmUrl:
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm',
  modelUrl:
    'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite',
};

export type TangibleWorkerRequest =
  | {
      type: 'initialize';
      assets: TangibleAssets;
      labels: string[];
      recognitionIntervalMs: number;
    }
  | {
      type: 'frame';
      requestId: number;
      timeMs: number;
      width: number;
      height: number;
      pixels: ArrayBuffer;
    }
  | {type: 'reset'}
  | {type: 'dispose'};

export type TangibleWorkerReply =
  | {type: 'ready'}
  | {type: 'disposed'}
  | {type: 'error'; message: string}
  | {
      type: 'result';
      requestId: number;
      observation: TangibleObservation | null;
      processingMs: number;
      opticalFlowMs: number;
      recognitionMs: number;
      recognition: TangibleRecognition;
    };
