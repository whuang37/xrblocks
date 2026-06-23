import * as THREE from 'three';
import {Core, Input, Constructor} from 'xrblocks';

export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export type SensorUpdateMode = 'sync' | 'background' | 'idle';

export interface SensorsOptions {
  /** The time window in milliseconds to reuse this sensor's latest completed value. Set to 0 to disable completed-value caching. */
  cacheWindowMs?: number;
  /** The execution mode of the sensor (sync, background, or idle) */
  updateMode?: SensorUpdateMode;
  /** Bypass completed cache for this call. Active in-flight updates are still reused. */
  forceRefresh?: boolean;
  /** Throw when a sensor cannot read from an optional subsystem. */
  strict?: boolean;
  /** Allow arbitrary sensor-specific options */
  [key: string]: unknown;
}

export const DEFAULT_SENSORS_OPTIONS: Required<
  Pick<SensorsOptions, 'cacheWindowMs' | 'updateMode'>
> = {
  cacheWindowMs: 8.0,
  updateMode: 'sync',
};

export interface SensorCacheInfo {
  hasValue: boolean;
  capturedAt: number | null;
  ageMs: number | null;
  active: boolean;
}

export interface SensorContext {
  core: Core;
  camera: THREE.Camera;
  input: Input;
  get<S>(
    sensor: Sensor<S> | Constructor<Sensor<S>>,
    options?: SensorsOptions
  ): Promise<S>;
  defer<R>(fn: () => Promise<R> | R): Promise<R>;
}

export abstract class Sensor<T = unknown> {
  /** Internal unique key used for debugging and logging */
  abstract readonly key: string;

  options: SensorsOptions;
  private cachedValue: T | undefined;
  private capturedAt: number | null = null;
  private activePromise: Promise<T> | null = null;

  constructor(options?: SensorsOptions) {
    this.options = {
      cacheWindowMs: DEFAULT_SENSORS_OPTIONS.cacheWindowMs,
      updateMode: DEFAULT_SENSORS_OPTIONS.updateMode,
      ...options,
    };
  }

  /**
   * Primary execution endpoint for the sensor.
   */
  abstract update(context: SensorContext): Promise<T> | T;

  /**
   * Backwards-compatible direct execution path. New code should prefer
   * SensorsManager.get(), which owns cache orchestration for shared captures.
   */
  async get(context: SensorContext, options?: SensorsOptions): Promise<T> {
    const effectiveOptions = this.getEffectiveOptions(options);
    const cacheWindowMs = effectiveOptions.cacheWindowMs ?? 0.0;
    const forceRefresh = effectiveOptions.forceRefresh === true;
    const updateMode = effectiveOptions.updateMode ?? 'sync';

    if (!forceRefresh && this.hasFreshCache(cacheWindowMs)) {
      return this.cachedValue!;
    }

    if (this.activePromise) {
      return this.activePromise;
    }

    if (updateMode === 'background') {
      const promise = this.runUpdate(context);
      // Background callers may receive cached values while this refresh runs;
      // attach a rejection handler so an unobserved refresh cannot produce an
      // unhandled rejection.
      promise.catch(() => {});

      if (!forceRefresh && this.cachedValue !== undefined) {
        return this.cachedValue;
      }
      return promise;
    }

    if (updateMode === 'idle') {
      return this.runIdleUpdate(context);
    }

    return this.runUpdate(context);
  }

  getLatest(): T | undefined {
    return this.cachedValue;
  }

  getCacheInfo(): SensorCacheInfo {
    const now = performance.now();
    return {
      hasValue: this.cachedValue !== undefined,
      capturedAt: this.capturedAt,
      ageMs: this.capturedAt === null ? null : now - this.capturedAt,
      active: this.activePromise !== null,
    };
  }

  clearCache(): void {
    this.cachedValue = undefined;
    this.capturedAt = null;
    this.activePromise = null;
  }

  mergeOptions(options?: SensorsOptions): void {
    if (!options) {
      return;
    }

    const existingCacheWindow = this.options.cacheWindowMs;
    const nextCacheWindow = options.cacheWindowMs;
    const existingUpdateMode = this.options.updateMode;
    const nextUpdateMode = options.updateMode;

    this.options = {
      ...this.options,
      ...options,
    };

    if (existingCacheWindow !== undefined || nextCacheWindow !== undefined) {
      this.options.cacheWindowMs = Math.min(
        existingCacheWindow ?? Number.POSITIVE_INFINITY,
        nextCacheWindow ?? Number.POSITIVE_INFINITY
      );
    }

    if (existingUpdateMode || nextUpdateMode) {
      this.options.updateMode = Sensor.fresherUpdateMode(
        existingUpdateMode,
        nextUpdateMode
      );
    }

    delete this.options.forceRefresh;
  }

  /**
   * Direct, strongly-typed capture. Self-bootstraps SensorsManager if needed.
   */
  async capture(options?: SensorsOptions): Promise<T> {
    const {SensorsManager} = await import('./SensorsManager');
    const manager = await SensorsManager.resolve();
    return manager.get(this, options);
  }

  getEffectiveOptions(options?: SensorsOptions): SensorsOptions {
    return {
      ...this.options,
      ...options,
    };
  }

  getFreshCachedValue(cacheWindowMs: number): T | undefined {
    return this.hasFreshCache(cacheWindowMs) ? this.cachedValue : undefined;
  }

  getActivePromise(): Promise<T> | null {
    return this.activePromise;
  }

  setActivePromise(promise: Promise<T> | null): void {
    this.activePromise = promise;
  }

  cacheValue(value: T): void {
    this.cachedValue = value;
    this.capturedAt = performance.now();
  }

  private hasFreshCache(cacheWindowMs: number): boolean {
    return (
      this.cachedValue !== undefined &&
      this.capturedAt !== null &&
      cacheWindowMs > 0 &&
      performance.now() - this.capturedAt < cacheWindowMs
    );
  }

  private runUpdate(context: SensorContext): Promise<T> {
    this.activePromise = Promise.resolve(this.update(context))
      .then((value) => {
        this.cachedValue = value;
        this.capturedAt = performance.now();
        return value;
      })
      .finally(() => {
        this.activePromise = null;
      });
    return this.activePromise;
  }

  private runIdleUpdate(context: SensorContext): Promise<T> {
    this.activePromise = context
      .defer(() => this.update(context))
      .then((value) => {
        this.cachedValue = value;
        this.capturedAt = performance.now();
        return value;
      });
    this.activePromise = this.activePromise.finally(() => {
      this.activePromise = null;
    });
    return this.activePromise;
  }

  private static fresherUpdateMode(
    a?: SensorUpdateMode,
    b?: SensorUpdateMode
  ): SensorUpdateMode {
    const rank: Record<SensorUpdateMode, number> = {
      idle: 0,
      background: 1,
      sync: 2,
    };
    const first = a ?? DEFAULT_SENSORS_OPTIONS.updateMode;
    const second = b ?? DEFAULT_SENSORS_OPTIONS.updateMode;
    return rank[first] >= rank[second] ? first : second;
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
  collidingObjectId: number | null;
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
