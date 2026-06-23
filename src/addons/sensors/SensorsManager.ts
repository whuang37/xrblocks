import * as THREE from 'three';
import {Core, Input, Script, core, Constructor} from 'xrblocks';
import {
  DEFAULT_SENSORS_OPTIONS,
  type Sensor,
  type SensorsOptions,
} from './SensorsTypes';

type SensorValue<T> =
  T extends Sensor<infer S>
    ? S
    : T extends Constructor<Sensor<infer S>>
      ? S
      : never;

type NullableSensorValues<
  T extends (Sensor<unknown> | Constructor<Sensor<unknown>>)[],
> = {
  [K in keyof T]: SensorValue<T[K]> | null;
};

export class SensorsManager extends Script {
  static dependencies = {
    core: Core,
    input: Input,
    camera: THREE.Camera,
  };

  editorIcon = 'sensors';

  core!: Core;
  input!: Input;
  camera!: THREE.Camera;

  private sensors = new Set<Sensor<unknown>>();
  private lastCaptureErrors: Record<string, string> = {};
  private defaultOptions: SensorsOptions;

  constructor(
    initialSensors: (Sensor<unknown> | Constructor<Sensor<unknown>>)[] = [],
    options: SensorsOptions = {}
  ) {
    super();
    this.defaultOptions = {...options};

    for (const sensor of initialSensors) {
      this.getOrCreateInstance(sensor);
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

    this.core.registry.register(this, SensorsManager);
  }

  clearCache() {
    for (const sensor of this.sensors) {
      sensor.clearCache();
    }
    this.lastCaptureErrors = {};
  }

  getOrCreateInstance<T extends Sensor<unknown>>(
    target: T | Constructor<T>
  ): T {
    if (typeof target === 'function') {
      for (const sensor of this.sensors) {
        if (sensor.constructor === target) {
          return sensor as T;
        }
      }

      const instance = new target();
      this.sensors.add(instance);
      return instance;
    }

    for (const sensor of this.sensors) {
      if (
        sensor.constructor === target.constructor &&
        sensorOptionsSignature(sensor.options) ===
          sensorOptionsSignature(target.options)
      ) {
        sensor.mergeOptions(target.options);
        return sensor as T;
      }
    }

    this.sensors.add(target);
    return target;
  }

  async get<T>(
    target: Sensor<T> | Constructor<Sensor<T>>,
    options?: SensorsOptions
  ): Promise<T> {
    const instance = this.getOrCreateInstance(target);
    const effectiveOptions = {
      ...DEFAULT_SENSORS_OPTIONS,
      ...instance.options,
      ...this.defaultOptions,
      ...options,
    };
    const cacheWindowMs = effectiveOptions.cacheWindowMs ?? 0.0;
    const forceRefresh = effectiveOptions.forceRefresh === true;
    const updateMode = effectiveOptions.updateMode ?? 'sync';

    const activePromise = instance.getActivePromise();
    if (activePromise) {
      return activePromise;
    }

    if (updateMode === 'background') {
      const latest = instance.getLatest();
      if (!forceRefresh && !effectiveOptions.strict && latest !== undefined) {
        const promise = Promise.resolve(
          instance.update(contextFor(this, effectiveOptions))
        ).then((value) => {
          instance.cacheValue(value);
          return value;
        });
        instance.setActivePromise(
          promise.finally(() => {
            instance.setActivePromise(null);
          })
        );
        promise.catch(() => {});
        return latest;
      }
    }

    if (!forceRefresh) {
      const cached = instance.getFreshCachedValue(cacheWindowMs);
      if (cached !== undefined) {
        return cached;
      }
    }

    const context = contextFor(this, effectiveOptions);

    const runUpdate = () =>
      Promise.resolve(instance.update(context)).then((value) => {
        instance.cacheValue(value);
        return value;
      });

    if (updateMode === 'background') {
      const promise = runUpdate().finally(() => {
        instance.setActivePromise(null);
      });
      instance.setActivePromise(promise);
      promise.catch(() => {});

      const latest = instance.getLatest();
      if (!forceRefresh && latest !== undefined) {
        return latest;
      }
      return promise;
    }

    const promise =
      updateMode === 'idle'
        ? this.defer(runUpdate).finally(() => {
            instance.setActivePromise(null);
          })
        : runUpdate().finally(() => {
            instance.setActivePromise(null);
          });
    instance.setActivePromise(promise);
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
  ): Promise<NullableSensorValues<T>> {
    const instances = targets.map((target) => this.getOrCreateInstance(target));
    const results = await Promise.allSettled(
      instances.map((instance) => this.get(instance, options))
    );
    this.lastCaptureErrors = {};
    const values = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      const sensor = instances[index];
      this.lastCaptureErrors[sensor.key] =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      return null;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return values as any;
  }

  getLastCaptureErrors() {
    return {...this.lastCaptureErrors};
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
    return instance.getLatest() as
      | (T extends Sensor<infer S>
          ? S
          : T extends Constructor<Sensor<infer S>>
            ? S
            : never)
      | undefined;
  }

  // --- Static Helpers ---

  static async capture<
    T extends (Sensor<unknown> | Constructor<Sensor<unknown>>)[],
  >(
    sensors: [...T],
    options?: SensorsOptions
  ): Promise<NullableSensorValues<T>> {
    const manager = await SensorsManager.resolve();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return manager.capture(sensors, options) as any;
  }

  static async get<T>(
    sensor: Sensor<T> | Constructor<Sensor<T>>,
    options?: SensorsOptions
  ): Promise<T> {
    const manager = await SensorsManager.resolve();
    return manager.get(sensor, options);
  }

  static async resolve(targetCore: Core = core): Promise<SensorsManager> {
    let manager = targetCore.registry.get(SensorsManager);
    if (!manager) {
      manager = new SensorsManager();
      targetCore.registry.register(manager, SensorsManager);
      targetCore.scene.add(manager);
      await targetCore.scriptsManager.initScript(manager);
    }
    return manager;
  }
}

function contextFor(
  manager: SensorsManager,
  effectiveOptions?: SensorsOptions
) {
  return {
    core: manager.core,
    camera: manager.camera,
    input: manager.input,
    get: <S>(
      sensor: Sensor<S> | Constructor<Sensor<S>>,
      opts?: SensorsOptions
    ) => manager.get(sensor, opts ?? effectiveOptions),
    defer: <R>(fn: () => Promise<R> | R) => manager.defer(fn),
  };
}

function sensorOptionsSignature(options: SensorsOptions): string {
  const entries = Object.entries(options)
    .filter(
      ([key]) =>
        key !== 'cacheWindowMs' &&
        key !== 'updateMode' &&
        key !== 'forceRefresh'
    )
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}
