import * as THREE from 'three';
import {Core, Input, Script, core, Constructor} from 'xrblocks';
import {
  DEFAULT_SENSORS_OPTIONS,
  type SensorsOptions,
  type SensorFrameRecord,
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

  private isRecording = false;
  private frameHistory: SensorFrameRecord[] = [];
  private recordingSubscription: {unsubscribe: () => void} | null = null;
  private subscriptions = new Map<
    string,
    {
      id: string;
      sensors: Sensor<unknown>[];
      options: SensorsOptions;
      frequency: number;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback?: (values: any[]) => void;
      lastTriggeredTime: number;
    }
  >();

  private sensors = new Set<Sensor<unknown>>();
  private sensorStates = new Map<Sensor<unknown>, SensorState>();

  private activePromises = new Map<Sensor<unknown>, Promise<unknown>>();
  private results = new Map<Sensor<unknown>, unknown>();
  private lastObservationTime = 0;
  private cacheWindowMs = 8.0;

  private currentFrameTime = 0;
  onFrameRecord: ((record: SensorFrameRecord) => void) | null = null;

  get recording(): boolean {
    return this.isRecording;
  }

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
      const instance = this.getOrCreateInstance(s);
      this.enabledSensors.add(instance);
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

  private enabledSensors = new Set<Sensor<unknown>>();

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

  // Alias for backward compatibility
  getSensorInstance<T extends Sensor<unknown>>(target: T | Constructor<T>): T {
    return this.getOrCreateInstance(target);
  }

  enable(sensor: Sensor<unknown> | Constructor<Sensor<unknown>>) {
    const instance = this.getOrCreateInstance(sensor);
    this.enabledSensors.add(instance);
  }

  disable(sensor: Sensor<unknown> | Constructor<Sensor<unknown>>) {
    const instance = this.getOrCreateInstance(sensor);
    this.enabledSensors.delete(instance);
  }

  async updateSensors(): Promise<Record<string, unknown>> {
    this.clearCache();
    const promises = Array.from(this.enabledSensors).map((s) => this.get(s));
    await Promise.all(promises);

    const output: Record<string, unknown> = {};
    for (const s of this.enabledSensors) {
      output[s.key] = this.results.get(s);
    }
    return output;
  }

  async get<T>(target: Sensor<T> | Constructor<Sensor<T>>): Promise<T> {
    this.checkAndClearCache();
    const instance = this.getOrCreateInstance(target);
    const mode = instance.options?.updateMode ?? 'sync';

    // 1. Background Mode: returns lastCompletedValue immediately, runs update in background
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
            this.notifySubscriptions(new Set([instance]));
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

    // 2. Idle Mode: defers execution to requestIdleCallback
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

    // 3. Sync Mode (Default): executes inline on the frame tick
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

  // --- Recording & Subscription API ---

  subscribe<T extends (Sensor<unknown> | Constructor<Sensor<unknown>>)[]>(
    sensors: [...T],
    frequency = 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback?: (values: any[]) => void,
    options?: SensorsOptions
  ) {
    const id = Math.random().toString(36).substring(2, 11);
    const resolvedInstances = sensors.map((s) => this.getOrCreateInstance(s));

    const sub = {
      id,
      sensors: resolvedInstances,
      options: options || {},
      frequency,
      callback,
      lastTriggeredTime: 0,
    };
    this.subscriptions.set(id, sub);

    return {
      id,
      sensors: resolvedInstances,
      options: sub.options,
      frequency,
      unsubscribe: () => this.unsubscribe(id),
    };
  }

  unsubscribe(id: string) {
    this.subscriptions.delete(id);
  }

  startRecording(
    sensors: (Sensor<unknown> | Constructor<Sensor<unknown>>)[] = [],
    options: SensorsOptions = {}
  ) {
    this.frameHistory = [];
    this.isRecording = true;

    const resolvedSensors = sensors.map((s) => this.getOrCreateInstance(s));

    this.recordingSubscription = this.subscribe(
      resolvedSensors,
      60,
      (values) => {
        const valuesMap = new Map<Sensor<unknown>, unknown>();
        resolvedSensors.forEach((sensor, index) => {
          valuesMap.set(sensor, values[index]);
        });

        const record: SensorFrameRecord = {
          timestamp: this.currentFrameTime || performance.now(),
          values: valuesMap,
        };

        this.frameHistory.push(record);
        if (this.onFrameRecord) {
          this.onFrameRecord(record);
        }
      },
      options
    );
  }

  stopRecording(): SensorFrameRecord[] {
    this.isRecording = false;
    if (this.recordingSubscription) {
      this.recordingSubscription.unsubscribe();
      this.recordingSubscription = null;
    }
    const history = this.frameHistory;
    this.frameHistory = [];
    return history;
  }

  clearRecording() {
    this.frameHistory = [];
  }

  override update(time: number) {
    this.currentFrameTime = time;
    const now = time; // Use simulation time instead of performance.now()
    const sensorsToTrigger = new Set<Sensor<unknown>>();

    // Check subscriptions
    for (const sub of this.subscriptions.values()) {
      const intervalMs = sub.frequency > 0 ? 1000 / sub.frequency : 0;
      if (intervalMs > 0 && now - sub.lastTriggeredTime >= intervalMs) {
        sub.lastTriggeredTime = now;
        for (const sensor of sub.sensors) {
          sensorsToTrigger.add(sensor);
        }
      }
    }

    if (sensorsToTrigger.size > 0) {
      this.capture(Array.from(sensorsToTrigger)).then(() => {
        this.notifySubscriptions(sensorsToTrigger);
      });
    }
  }

  private notifySubscriptions(updatedSensors: Set<Sensor<unknown>>) {
    for (const sub of this.subscriptions.values()) {
      if (!sub.callback) continue;

      const matches = sub.sensors.some((sensor) => updatedSensors.has(sensor));
      if (matches) {
        const values = sub.sensors.map((sensor) => this.results.get(sensor));
        sub.callback(values);
      }
    }
  }

  // --- Backward Compatible capture API ---

  async capture<T extends Sensor<unknown> | Constructor<Sensor<unknown>>>(
    target: T,
    options?: SensorsOptions
  ): Promise<
    T extends Sensor<infer S>
      ? S
      : T extends Constructor<Sensor<infer S>>
        ? S
        : never
  >;

  async capture<T extends (Sensor<unknown> | Constructor<Sensor<unknown>>)[]>(
    targets: [...T],
    options?: SensorsOptions
  ): Promise<{
    [K in keyof T]: T[K] extends Sensor<infer S>
      ? S
      : T[K] extends Constructor<Sensor<infer S>>
        ? S
        : never;
  }>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async capture(target: any, customOptions?: SensorsOptions): Promise<any> {
    if (customOptions?.cacheWindowMs !== undefined) {
      this.cacheWindowMs = customOptions.cacheWindowMs;
    }
    const isArray = Array.isArray(target);
    const targets = isArray ? target : [target];

    const promises = targets.map((t) => this.get(t));
    const results = await Promise.all(promises);

    return isArray ? results : results[0];
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

  static subscribe<
    T extends (Sensor<unknown> | Constructor<Sensor<unknown>>)[],
  >(
    sensors: [...T],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (values: any[]) => void,
    frequency = 0,
    options?: SensorsOptions
  ): () => void {
    let unsubscribed = false;
    let innerUnsubscribe: (() => void) | null = null;

    SensorsManager.resolve().then((manager) => {
      if (unsubscribed) return;
      const sub = manager.subscribe(sensors, frequency, callback, options);
      innerUnsubscribe = () => sub.unsubscribe();
    });

    return () => {
      unsubscribed = true;
      if (innerUnsubscribe) {
        innerUnsubscribe();
      }
    };
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
