import * as THREE from 'three';
import {Core, Input, core, Constructor} from 'xrblocks';
import type {SensorsManager} from './SensorsManager';

export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export type SensorUpdateMode = 'sync' | 'background' | 'idle';

export interface SensorsOptions {
  /** The time window in milliseconds to cache observations within the same frame (default: 8.0). Set to 0 to disable caching. */
  cacheWindowMs?: number;
  /** The execution mode of the sensor (sync, background, or idle) */
  updateMode?: SensorUpdateMode;
  /** Allow arbitrary sensor-specific options */
  [key: string]: unknown;
}

export const DEFAULT_SENSORS_OPTIONS: Required<
  Pick<SensorsOptions, 'cacheWindowMs'>
> = {
  cacheWindowMs: 8.0,
};

export interface SensorContext {
  core: Core;
  camera: THREE.Camera;
  input: Input;
  get<S>(sensor: Sensor<S> | Constructor<Sensor<S>>): Promise<S>;
  defer<R>(fn: () => Promise<R> | R): Promise<R>;
}

export abstract class Sensor<T = unknown> {
  /** Internal unique key used for debugging and logging */
  abstract readonly key: string;

  readonly options?: SensorsOptions;

  constructor(options?: SensorsOptions) {
    this.options = options;
  }

  /**
   * Primary execution endpoint for the sensor.
   */
  abstract update(context: SensorContext): Promise<T> | T;

  /**
   * Direct, strongly-typed capture. Self-bootstraps SensorsManager if needed.
   */
  async capture(options?: SensorsOptions): Promise<T> {
    const manager = await Sensor.resolveManager();
    return manager.capture(this, options);
  }

  /**
   * Direct, strongly-typed subscription. Self-bootstraps SensorsManager if needed.
   */
  subscribe(
    callback: (value: T) => void,
    frequency = 0,
    options?: SensorsOptions
  ): () => void {
    let unsubscribed = false;
    let innerUnsubscribe: (() => void) | null = null;

    Sensor.resolveManager().then((manager) => {
      if (unsubscribed) return;
      const sub = manager.subscribe(
        [this],
        frequency,
        ([val]) => callback(val as T),
        options
      );
      innerUnsubscribe = () => sub.unsubscribe();
    });

    return () => {
      unsubscribed = true;
      if (innerUnsubscribe) {
        innerUnsubscribe();
      }
    };
  }

  private static async resolveManager(): Promise<SensorsManager> {
    const {SensorsManager} = await import('./SensorsManager');
    let manager = core.registry.get(SensorsManager);
    if (!manager) {
      manager = new SensorsManager();
      core.registry.register(manager, SensorsManager);
      core.scene.add(manager);
      await core.scriptsManager.initScript(manager);
    }
    return manager;
  }
}

export interface SerializableSceneNode {
  id: number;
  name: string;
  type: string;
  position: Vec3Tuple;
  quaternion: QuatTuple;
  scale: Vec3Tuple;
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
  label: string;
  objectId: number;
  name: string;
  type: string;
  distanceToCamera: number;
  description: string; // e.g. "[1]: TextButton 'Submit' at 0.85m"
}

/** Lightweight per-frame trajectory record. */
export interface SensorFrameRecord {
  timestamp: number;
  values: Map<Sensor<unknown>, unknown>;
}
