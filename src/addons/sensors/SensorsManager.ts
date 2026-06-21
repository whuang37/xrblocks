import * as THREE from 'three';
import {Core, Input, Script, core, Constructor} from 'xrblocks';
import {
  DEFAULT_SENSORS_OPTIONS,
  type SensorsOptions,
  type Sensor,
} from './SensorsTypes';

interface SensorState {
  lastCompletedValue: unknown;
  activePromise: Promise<unknown> | null;
}

export class SensorsManager extends Script {
  static dependencies = {
    core: Core,
    input: Input,
    camera: THREE.Camera,
  };

  editorIcon = 'sensors';
  private defaultOptions: Required<Pick<SensorsOptions, 'cacheWindowMs'>>;

  core!: Core;
  input!: Input;
  camera!: THREE.Camera;

  private sensors = new Set<Sensor<unknown>>();
  private sensorStates = new Map<Sensor<unknown>, SensorState>();

  private activePromises = new Map<Sensor<unknown>, Promise<unknown>>();
  private results = new Map<Sensor<unknown>, unknown>();
  private lastObservationTime = 0;
  private cacheWindowMs = 8.0;

  constructor(
    initialSensors: (Sensor<unknown> | Constructor<Sensor<unknown>>)[] = [],
    options: SensorsOptions = {}
  ) {
    super();
    this.defaultOptions = {
      cacheWindowMs:
        options.cacheWindowMs ?? DEFAULT_SENSORS_OPTIONS.cacheWindowMs,
    };
    this.cacheWindowMs = this.defaultOptions.cacheWindowMs;

    for (const s of initialSensors) {
      this.getOrCreateInstance(s);
    }
  }

  override init(dependencies: {
    core: Core;
    input: Input;
    camera: THREE.Camera;
  }) {
    this.core = dependencies.core;
    this.input = dependencies.input;
    this.camera = dependencies.camera;

    // Self-register in the core registry
    this.core.registry.register(this, SensorsManager);
  }

  clearCache() {
    this.activePromises.clear();
    this.results.clear();
    this.lastObservationTime = 0;
  }

  private checkAndClearCache() {
    const now = performance.now();
    if (now - this.lastObservationTime >= this.cacheWindowMs) {
      this.activePromises.clear();
      this.results.clear();
      this.lastObservationTime = now;
    }
  }

  getOrCreateInstance<T extends Sensor<unknown>>(
    target: T | Constructor<T>
  ): T {
    if (typeof target === 'function') {
      for (const s of this.sensors) {
        if (s.constructor === target) {
          return s as T;
        }
      }
      const instance = new target();
      this.sensors.add(instance);
      this.sensorStates.set(instance, {
        lastCompletedValue: undefined,
        activePromise: null,
      });
      return instance;
    }

    if (!this.sensors.has(target)) {
      this.sensors.add(target);
      if (!this.sensorStates.has(target)) {
        this.sensorStates.set(target, {
          lastCompletedValue: undefined,
          activePromise: null,
        });
      }
    }
    return target;
  }

  async get<T>(
    target: Sensor<T> | Constructor<Sensor<T>>,
    options?: SensorsOptions
  ): Promise<T> {
    if (options?.cacheWindowMs !== undefined) {
      this.cacheWindowMs = options.cacheWindowMs;
    }
    this.checkAndClearCache();
    const instance = this.getOrCreateInstance(target);
    const mode = instance.options?.updateMode ?? 'sync';

    // Returns lastCompletedValue immediately, runs update in background.
    if (mode === 'background') {
      const state = this.sensorStates.get(instance)!;
      if (!state.activePromise) {
        state.activePromise = (async () => {
          try {
            const val = await instance.update({
              core: this.core,
              camera: this.camera,
              input: this.input,
              get: (t) => this.get(t),
              defer: (fn) => this.defer(fn),
            });
            state.lastCompletedValue = val;
            this.results.set(instance, val);
            return val;
          } finally {
            state.activePromise = null;
          }
        })();
      }
      const value =
        state.lastCompletedValue !== undefined
          ? state.lastCompletedValue
          : state.activePromise;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return value as any;
    }

    // Defers execution to requestIdleCallback
    if (mode === 'idle') {
      if (this.results.has(instance)) {
        return this.results.get(instance) as T;
      }
      if (this.activePromises.has(instance)) {
        return this.activePromises.get(instance) as Promise<T>;
      }

      const promise = this.defer(async () => {
        const val = await instance.update({
          core: this.core,
          camera: this.camera,
          input: this.input,
          get: (t) => this.get(t),
          defer: (fn) => this.defer(fn),
        });
        this.results.set(instance, val);
        return val;
      });

      this.activePromises.set(instance, promise);
      return promise;
    }

    // Executes inline on the frame tick
    if (this.results.has(instance)) {
      return this.results.get(instance) as T;
    }
    if (this.activePromises.has(instance)) {
      return this.activePromises.get(instance) as Promise<T>;
    }

    const promise = (async () => {
      const val = await instance.update({
        core: this.core,
        camera: this.camera,
        input: this.input,
        get: (t) => this.get(t),
        defer: (fn) => this.defer(fn),
      });
      this.results.set(instance, val);
      return val;
    })();

    this.activePromises.set(instance, promise);
    return promise;
  }

  defer<R>(fn: () => Promise<R> | R): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const execute = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => execute());
      } else {
        setTimeout(() => execute(), 0);
      }
    });
  }

  // --- Batch Capture API ---

  async capture<T extends (Sensor<unknown> | Constructor<Sensor<unknown>>)[]>(
    targets: [...T],
    options?: SensorsOptions
  ): Promise<{
    [K in keyof T]: T[K] extends Sensor<infer S>
      ? S
      : T[K] extends Constructor<Sensor<infer S>>
        ? S
        : never;
  }> {
    const promises = targets.map((t) => this.get(t, options));
    const results = await Promise.all(promises);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return results as any;
  }

  getLatest<T extends Sensor<unknown> | Constructor<Sensor<unknown>>>(
    target: T
  ):
    | (T extends Sensor<infer S>
        ? S
        : T extends Constructor<Sensor<infer S>>
          ? S
          : never)
    | undefined {
    const instance = this.getOrCreateInstance(target);
    const state = this.sensorStates.get(instance);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return state ? (state.lastCompletedValue as any) : undefined;
  }

  // --- Static Helpers ---

  static async capture<
    T extends (Sensor<unknown> | Constructor<Sensor<unknown>>)[],
  >(
    sensors: [...T],
    options?: SensorsOptions
  ): Promise<{
    [K in keyof T]: T[K] extends Sensor<infer S>
      ? S
      : T[K] extends Constructor<Sensor<infer S>>
        ? S
        : never;
  }> {
    const manager = await SensorsManager.resolve();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return manager.capture(sensors, options) as any;
  }

  private static async resolve(): Promise<SensorsManager> {
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
