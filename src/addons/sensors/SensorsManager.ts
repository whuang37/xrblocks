import * as THREE from 'three';
import {Core, Input, Script, core} from 'xrblocks';
import {
  DEFAULT_SENSORS_OPTIONS,
  type Sensor,
  type SensorConstructor,
  type SensorsOptions,
} from './SensorsTypes';

export type SensorRequest<T = unknown> =
  | SensorConstructor<T>
  | readonly [SensorConstructor<T>, SensorsOptions?];

type SensorValue<T> =
  T extends SensorConstructor<infer S>
    ? S
    : T extends readonly [SensorConstructor<infer S>, SensorsOptions?]
      ? S
      : never;

type SensorRequestRecord = Record<string, SensorRequest<unknown>>;

export type CaptureAllValues<T extends SensorRequestRecord> = {
  [K in keyof T]: SensorValue<T[K]>;
};

export type TryCaptureAllValues<T extends SensorRequestRecord> = {
  [K in keyof T]: SensorValue<T[K]> | null;
};

export type TryCaptureAllResult<T extends SensorRequestRecord> = {
  values: TryCaptureAllValues<T>;
  errors: Partial<Record<keyof T, string>>;
};

type PreparedSensor<T = unknown> = {
  sensorClass: SensorConstructor<T>;
  instance: Sensor<T>;
  effectiveOptions: SensorsOptions;
};

const RUNTIME_OPTION_KEYS = new Set([
  'cacheWindowMs',
  'updateMode',
  'forceRefresh',
]);

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

  private sensors = new Map<string, Sensor<unknown>>();
  private lastCaptureErrors: Record<string, string> = {};
  private defaultOptions: SensorsOptions;

  constructor(
    initialSensors: SensorRequest<unknown>[] = [],
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
    for (const sensor of this.sensors.values()) {
      sensor.clearCache();
    }
    this.lastCaptureErrors = {};
  }

  getOrCreateInstance<T>(
    request: SensorRequest<T>,
    options?: SensorsOptions
  ): Sensor<T> {
    return this.prepare(request, options).instance;
  }

  async capture<T>(
    request: SensorRequest<T>,
    options?: SensorsOptions
  ): Promise<T> {
    const prepared = this.prepare(request, options);
    return this.capturePrepared(prepared);
  }

  async captureAll<T extends SensorRequestRecord>(
    requests: T,
    options?: SensorsOptions
  ): Promise<CaptureAllValues<T>> {
    const preparedEntries = Object.entries(requests).map(
      ([key, request]) =>
        [key, this.prepare(request, options)] as const
    );
    const results = await Promise.all(
      preparedEntries.map(([, prepared]) => this.capturePrepared(prepared))
    );
    const values: Record<string, unknown> = {};
    preparedEntries.forEach(([key], index) => {
      values[key] = results[index];
    });
    this.lastCaptureErrors = {};
    return values as CaptureAllValues<T>;
  }

  async tryCaptureAll<T extends SensorRequestRecord>(
    requests: T,
    options?: SensorsOptions
  ): Promise<TryCaptureAllResult<T>> {
    const preparedEntries = Object.entries(requests).map(
      ([key, request]) =>
        [key, this.prepare(request, options)] as const
    );
    const results = await Promise.allSettled(
      preparedEntries.map(([, prepared]) => this.capturePrepared(prepared))
    );
    const values: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    this.lastCaptureErrors = {};

    results.forEach((result, index) => {
      const [key, prepared] = preparedEntries[index];
      if (result.status === 'fulfilled') {
        values[key] = result.value;
        return;
      }

      values[key] = null;
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      errors[key] = message;
      this.lastCaptureErrors[prepared.instance.key] = message;
    });

    return {
      values: values as TryCaptureAllValues<T>,
      errors: errors as Partial<Record<keyof T, string>>,
    };
  }

  getLastCaptureErrors() {
    return {...this.lastCaptureErrors};
  }

  getLatest<T>(
    request: SensorRequest<T>,
    options?: SensorsOptions
  ): T | undefined {
    const instance = this.getOrCreateInstance(request, options);
    return instance.getLatest();
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

  private prepare<T>(
    request: SensorRequest<T>,
    options?: SensorsOptions
  ): PreparedSensor<T> {
    const [sensorClass, requestOptions] = normalizeRequest(request);
    const callOptions = {...requestOptions, ...options};
    const identityOptions = identityOptionsFor(sensorClass, callOptions);
    const instanceKey = sensorInstanceKey(sensorClass, identityOptions);
    let instance = this.sensors.get(instanceKey) as Sensor<T> | undefined;

    if (!instance) {
      instance = new sensorClass(identityOptions);
      this.sensors.set(instanceKey, instance);
    }

    const runtimeOptions = runtimeOptionsFor(callOptions);
    if (Object.keys(runtimeOptions).length > 0) {
      instance.mergeOptions(runtimeOptions);
    }

    return {
      sensorClass,
      instance,
      effectiveOptions: {
        ...DEFAULT_SENSORS_OPTIONS,
        ...instance.options,
        ...this.defaultOptions,
        ...callOptions,
      },
    };
  }

  private async capturePrepared<T>({
    instance,
    effectiveOptions,
  }: PreparedSensor<T>): Promise<T> {
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

  // --- Static Helpers ---

  static async capture<T>(
    request: SensorRequest<T>,
    options?: SensorsOptions
  ): Promise<T> {
    const manager = await SensorsManager.resolve();
    return manager.capture(request, options);
  }

  static async captureAll<T extends SensorRequestRecord>(
    requests: T,
    options?: SensorsOptions
  ): Promise<CaptureAllValues<T>> {
    const manager = await SensorsManager.resolve();
    return manager.captureAll(requests, options);
  }

  static async tryCaptureAll<T extends SensorRequestRecord>(
    requests: T,
    options?: SensorsOptions
  ): Promise<TryCaptureAllResult<T>> {
    const manager = await SensorsManager.resolve();
    return manager.tryCaptureAll(requests, options);
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

export const sensors = {
  resolve: SensorsManager.resolve,
  capture: SensorsManager.capture,
  captureAll: SensorsManager.captureAll,
  tryCaptureAll: SensorsManager.tryCaptureAll,
};

function contextFor(
  manager: SensorsManager,
  effectiveOptions?: SensorsOptions
) {
  return {
    core: manager.core,
    camera: manager.camera,
    input: manager.input,
    get: <S>(
      sensor: SensorConstructor<S>,
      opts?: SensorsOptions
    ) => manager.capture(sensor, {...effectiveOptions, ...opts}),
    defer: <R>(fn: () => Promise<R> | R) => manager.defer(fn),
  };
}

function normalizeRequest<T>(
  request: SensorRequest<T>
): [SensorConstructor<T>, SensorsOptions?] {
  if (Array.isArray(request)) {
    return [request[0], request[1]];
  }
  return [request as SensorConstructor<T>, undefined];
}

function identityOptionsFor<T>(
  sensorClass: SensorConstructor<T>,
  options?: SensorsOptions
): SensorsOptions {
  const identityOptions: SensorsOptions = {};
  for (const key of sensorClass.optionKeys ?? []) {
    if (options && Object.prototype.hasOwnProperty.call(options, key)) {
      identityOptions[key] = options[key];
    }
  }
  return identityOptions;
}

function runtimeOptionsFor(options?: SensorsOptions): SensorsOptions {
  const runtimeOptions: SensorsOptions = {};
  if (!options) {
    return runtimeOptions;
  }

  for (const key of RUNTIME_OPTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      runtimeOptions[key] = options[key];
    }
  }
  return runtimeOptions;
}

function sensorInstanceKey<T>(
  sensorClass: SensorConstructor<T>,
  identityOptions: SensorsOptions
): string {
  return `${sensorClass.name}:${stableOptionsSignature(identityOptions)}`;
}

function stableOptionsSignature(options: SensorsOptions): string {
  const entries = Object.entries(options).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return JSON.stringify(entries);
}
