
export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export type SensorsScreenshotMode = 'off' | 'camera' | 'xr' | 'som';

export interface SensorsOptions {
  /** The primary screenshot capture mode (default: 'off'). */
  screenshotMode?: SensorsScreenshotMode;
  /** The time window in milliseconds to cache observations within the same frame (default: 8.0). Set to 0 to disable caching. */
  cacheWindowMs?: number;
  /** Serialize the Three.js scene graph structural topology. */
  includeSceneGraph?: boolean;
  /** Return a downsampled 2D depth grid. */
  includeDepth?: boolean;
  /** Return head (camera), hand, and torso transforms. */
  includeUserTransforms?: boolean;
  /** Return raw pointer targeting/hover metrics. */
  includeTargeting?: boolean;
  /** Capture the raw physical camera feed only (no virtual objects). */
  includeScreenshotCamera?: boolean;
  /** Capture the blended augmented reality screenshot (camera + virtual meshes). */
  includeScreenshotXR?: boolean;
  /** Capture the Set-of-Mark annotated augmented reality screenshot (camera + meshes + badges). */
  includeScreenshotSOM?: boolean;
  /** Enable generating the semantic visible objects list mapping (default: false). */
  includeSemanticMap?: boolean;
  /** Size of the downsampled depth grid (e.g. 16 for 16x16, default 16). */
  depthGridSize?: number;
  /** Perform line-of-sight raycasts to verify object visibility (default: true). */
  verifyLineOfSight?: boolean;
  /** Enable recording of lightweight per-frame data in the memory buffer (default: false). */
  recordHistory?: boolean;
  /** Capture real-world surfaces and planes (TODO). */
  includePlanes?: boolean;
  /** Capture high-level hand gestures (TODO). */
  includeGestures?: boolean;
  /** Capture user facial blendshapes and expressions (TODO). */
  includeFaces?: boolean;
  /** Capture environmental audio events (TODO). */
  includeSounds?: boolean;
  /** [TODO] Capture 3D drawing stroke/sketch paths drawn by the user. */
  includeStrokes?: boolean;
  /** [TODO] Capture physical Bluetooth gamepad triggers and analog stick inputs. */
  includeGamepad?: boolean;
  /** [TODO] Capture real-world lighting direction and light estimation coefficients. */
  includeLighting?: boolean;
}

export interface SerializableSceneNode {
  id: number;
  name: string;
  type: string;
  position: Vec3Tuple; // World position
  quaternion: QuatTuple; // World rotation
  scale: Vec3Tuple; // World scale
  boundingBox?: {
    min: Vec3Tuple;
    max: Vec3Tuple;
    size: Vec3Tuple;
  };
  userData: Record<string, unknown>;
  children: number[]; // Child node IDs
}


export interface HandObservation {
  position: Vec3Tuple;
  quaternion: QuatTuple;
  selected: boolean;
  squeezing: boolean;
  visible: boolean;
  /** Skeletal joint world positions [x, y, z] in meters. */
  jointKeypoints?: Record<string, Vec3Tuple>;
}

export interface TorsoObservation {
  position: Vec3Tuple;
  quaternion: QuatTuple;
}

export interface TargetingMetrics {
  hoveredObjectId: number | null;
  distanceToHoveredObject: number | null;
  pointerOrigin: Vec3Tuple;
  pointerDirection: Vec3Tuple;
  isSelecting: boolean;
  intersectionPoint: Vec3Tuple | null;
  surfaceNormal: Vec3Tuple | null;
}

/** Plaintext description mapping for Set-of-Mark visual references. */
export interface VisibleObjectReference {
  label: string; // "1", "2", "3", etc.
  objectId: number;
  name: string;
  type: string;
  distanceToCamera: number;
  description: string; // e.g. "[1]: TextButton 'Submit' at 0.85m"
}

/** Lightweight per-frame trajectory record. */
export interface SensorsFrameRecord {
  timestamp: number;
  state?: {
    camera: {
      position: Vec3Tuple;
      quaternion: QuatTuple;
    };
    leftHand?: HandObservation;
    rightHand?: HandObservation;
    torso?: TorsoObservation;
  };
  sceneGraph?: SerializableSceneNode[];
  targeting?: {
    leftHand?: TargetingMetrics;
    rightHand?: TargetingMetrics;
    gaze?: TargetingMetrics;
  };
}

export interface SensorsObservation {
  screenshot?: string; // Legacy primary screenshot
  /** Capture the raw physical camera feed only (no virtual objects). */
  screenshotCamera?: string;
  /** Capture the blended augmented reality screenshot (camera + virtual meshes). */
  screenshotXR?: string;
  /** Capture the Set-of-Mark annotated augmented reality screenshot (camera + meshes + badges). */
  screenshotSOM?: string;
  /** Plaintext screen-reader descriptions for the VLM agent. */
  visibleObjects?: VisibleObjectReference[];
  state?: {
    camera: {
      position: Vec3Tuple;
      quaternion: QuatTuple;
    };
    leftHand: HandObservation;
    rightHand: HandObservation;
    torso?: TorsoObservation;
  };
  sceneGraph?: SerializableSceneNode[];
  depth?: number[][];
  targeting?: {
    leftHand?: TargetingMetrics;
    rightHand?: TargetingMetrics;
    gaze?: TargetingMetrics;
  };
  /** Captured high-frequency per-frame trajectory history (if recordHistory was enabled). */
  history?: SensorsFrameRecord[];
  /** Scanned physical planes and surfaces (TODO). */
  planes?: unknown[];
  /** Active hand gestures (TODO). */
  gestures?: {
    leftHandGesture?: string;
    rightHandGesture?: string;
  };
  /** Facial expressions and blendshapes (TODO). */
  faces?: unknown[];
  /** Classified environmental audio sound events (TODO). */
  sounds?: unknown[];
  /** [TODO] 3D drawing stroke and sketch paths. */
  strokes?: unknown[];
  /** [TODO] Tactile gamepad trigger and joystick analog vectors. */
  gamepad?: unknown[];
  /** [TODO] Physical environmental lighting parameters. */
  lighting?: unknown;
}

export const DEFAULT_SENSORS_OPTIONS: Required<SensorsOptions> = {
  screenshotMode: 'off',
  cacheWindowMs: 8.0,
  includeScreenshotCamera: false,
  includeScreenshotXR: false,
  includeScreenshotSOM: false,
  includeSceneGraph: false,
  includeDepth: false,
  includeUserTransforms: true,
  includeTargeting: false,
  includeSemanticMap: false,
  depthGridSize: 16,
  verifyLineOfSight: true,
  recordHistory: false,
  includePlanes: false,
  includeGestures: false,
  includeFaces: false,
  includeSounds: false,
  includeStrokes: false,
  includeGamepad: false,
  includeLighting: false,
};
