import type * as THREE from 'three';

/** Image coordinates use normalized, top-left-origin UVs. */
export interface TangibleRegion {
  u: number;
  v: number;
  width: number;
  height: number;
}

export interface TrackedFeature {
  id: number;
  u: number;
  v: number;
}

export interface TangibleObservation {
  targetId: number;
  features: TrackedFeature[];
}

export type TangibleState =
  | 'loading'
  | 'idle'
  | 'registering'
  | 'tracked'
  | 'lost'
  | 'error'
  | 'disposed';

/** Content selected by the application, independent of the physical object. */
export interface TangibleWidget {
  /** Returns fresh content owned by the tracker. Local +Z faces the user at registration. */
  create(widgetId: string): THREE.Object3D;
}

export interface TangibleWidgetsOptions {
  /** Application-defined widget IDs, for example `reading`, `timer`, or `tilt`. */
  widgets: Record<string, TangibleWidget>;
  /** Maximum processing rate. Rendering remains independent. @defaultValue 15 */
  trackingFps?: number;
  /** Pose low-pass time constant in milliseconds. Higher values smooth more but add lag; 0 disables filtering. @defaultValue 100 */
  poseSmoothingMs?: number;
  /** Maximum usable observation age, including worker time. @defaultValue 500 */
  maxPoseAgeMs?: number;
  /** Maximum rigid-fit residual, in metres. @defaultValue 0.025 */
  maxResidualMeters?: number;
  /** Optional device camera profile; uses SDK device detection by default. */
  cameraProfile?: string;
  /** Optional synchronous preview hook. Copy pixels here; their buffer can be transferred afterwards. */
  onCameraFrame?: (image: ImageData, region: TangibleRegion) => void;
  /** OpenCV runtime URL. Override for same-origin or offline deployment. */
  assets?: Partial<TangibleAssets>;
}

export interface TangibleAssets {
  openCvUrl: string;
}

export const DEFAULT_TANGIBLE_ASSETS: Readonly<TangibleAssets> = {
  openCvUrl:
    'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js',
};

export type TangibleWorkerRequest =
  | {type: 'initialize'; assets: TangibleAssets}
  | {
      type: 'frame';
      requestId: number;
      timeMs: number;
      width: number;
      height: number;
      pixels: ArrayBuffer;
      /** Explicit registration only. Loss never selects a new surface automatically. */
      registration?: TangibleRegion;
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
      featureCount: number;
      status: string;
    };
