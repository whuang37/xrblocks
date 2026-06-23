import * as THREE from 'three';
import {Core, Input, Script, core, Constructor} from 'xrblocks';
import {type Sensor, type SensorsOptions} from './SensorsTypes';

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

    // Self-register in the core registry
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
      if (sensor.constructor === target.constructor) {
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
      ...this.defaultOptions,
      ...options,
    };
    return instance.get(
      {
        core: this.core,
        camera: this.camera,
        input: this.input,
        get: (sensor, opts) => this.get(sensor, opts ?? effectiveOptions),
        defer: (fn) => this.defer(fn),
      },
      effectiveOptions
    );
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
