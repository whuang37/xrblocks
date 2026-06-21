
export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export interface SensorsOptions {
  /** Capture a screenshot in the final observation. */
  includeScreenshot?: boolean;
  /** Serialize the Three.js scene graph structural topology. */
  includeSceneGraph?: boolean;
  /** Return a downsampled 2D depth grid. */
  includeDepth?: boolean;
  /** Return head (camera), hand, and torso transforms. */
  includeUserTransforms?: boolean;
  /** Return raw pointer targeting/hover metrics. */
  includeTargeting?: boolean;
  /** Enable Set-of-Mark alphanumeric overlays on the screenshot (default: false). */
  annotateScreenshot?: boolean;
  /** Enable generating the semantic visible objects list mapping (default: false). */
  includeSemanticMap?: boolean;
  /** Size of the downsampled depth grid (e.g. 16 for 16x16, default 16). */
  depthGridSize?: number;
  /** Perform line-of-sight raycasts to verify object visibility (default: true). */
  verifyLineOfSight?: boolean;
  /** Enable recording of lightweight per-frame data in the memory buffer (default: false). */
  recordHistory?: boolean;
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
  screenshot?: string; // Raw or Set-of-Mark annotated
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
}

export const DEFAULT_SENSORS_OPTIONS: Required<SensorsOptions> = {
  includeScreenshot: false,
  includeSceneGraph: false,
  includeDepth: false,
  includeUserTransforms: true,
  includeTargeting: false,
  annotateScreenshot: false,
  includeSemanticMap: false,
  depthGridSize: 16,
  verifyLineOfSight: true,
  recordHistory: false,
};
