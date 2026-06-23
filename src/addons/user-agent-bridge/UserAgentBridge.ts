import * as THREE from 'three';
import {Core} from 'xrblocks';
import {
  EmbodiedControl,
  type EmbodiedControlOptions,
  type XRCompoundControl,
} from '../embodied-control/index.js';
import {
  DepthSensor,
  ProprioceptionSensor,
  SceneGraphSensor,
  ScreenshotSOMSensor,
  ScreenshotCameraSensor,
  ScreenshotXRSensor,
  SemanticMapSensor,
  SensorsManager,
  TargetingSensor,
  VisibilitySensor,
  type Sensor,
  type SensorsOptions,
} from '../sensors/index.js';

export type UserAgentSensorKey =
  | 'state'
  | 'targeting'
  | 'visibleObjects'
  | 'sceneGraph'
  | 'screenshotCamera'
  | 'screenshotXR'
  | 'screenshotSOM'
  | 'depth';

export type UserAgentBridgeConfig = {
  dtMs?: number;
  autoPause?: boolean;
  sensorTimeoutMs?: number;
  sensors?: UserAgentSensorKey[];
  sensorOptions?: SensorsOptions & {
    depthGridSize?: number;
    verifyLineOfSight?: boolean;
  };
  embodiedOptions?: EmbodiedControlOptions;
};

export type UserAgentObserveOptions = {
  sensors?: UserAgentSensorKey[];
  sensorOptions?: UserAgentBridgeConfig['sensorOptions'];
};

export type UserAgentAction = {
  camera?: {
    move?: [number, number, number];
    rotate?: [number, number, number];
  };
  leftHand?: XRCompoundControl['leftHand'];
  rightHand?: XRCompoundControl['rightHand'];
};

export type UserAgentHand = 'left' | 'right' | number;

export type UserAgentCommand =
  | {
      kind: 'lookAt';
      target: string | [number, number, number];
      velocity?: number;
    }
  | {
      kind: 'reachTo';
      hand?: UserAgentHand;
      target: string | [number, number, number];
      velocity?: number;
    }
  | {
      kind: 'pointTo';
      hand?: UserAgentHand;
      target: string | [number, number, number];
      velocity?: number;
    }
  | {
      kind: 'click';
      hand?: UserAgentHand;
      durationMs?: number;
    }
  | {
      kind: 'teleportTo';
      target: string | [number, number, number];
      distance?: number;
      faceTarget?: boolean;
      snapToGround?: boolean;
    };

export type UserAgentBridge = {
  observe(options?: UserAgentObserveOptions): Promise<Record<string, unknown>>;
  step(
    action?: UserAgentAction,
    options?: UserAgentObserveOptions
  ): Promise<Record<string, unknown>>;
  command(
    command: UserAgentCommand,
    options?: UserAgentObserveOptions
  ): Promise<Record<string, unknown>>;
  inspect(options?: UserAgentObserveOptions): Promise<Record<string, unknown>>;
  dispose(): Promise<void>;
};

const DEFAULT_SENSORS: UserAgentSensorKey[] = [
  'state',
  'targeting',
  'visibleObjects',
  'sceneGraph',
  'screenshotXR',
];

export async function installUserAgentBridge(
  config: UserAgentBridgeConfig = {}
): Promise<UserAgentBridge> {
  const runtime = (
    globalThis as unknown as {__XRBLOCKS__?: {core: Core; ready: Promise<Core>}}
  ).__XRBLOCKS__;
  if (!runtime?.core) {
    throw new Error('XR Blocks runtime handle was not found.');
  }

  await runtime.ready;
  const core = runtime.core;

  let embodiedControl = core.registry.get(EmbodiedControl);
  if (!embodiedControl) {
    embodiedControl = new EmbodiedControl({
      autoPause: config.autoPause ?? true,
      realTime: false,
      tickMs: config.dtMs ?? 50,
      ...config.embodiedOptions,
    });
    core.scene.add(embodiedControl);
    await core.scriptsManager.initScript(embodiedControl);
    core.registry.register(embodiedControl, EmbodiedControl);
  }

  let sensors = core.registry.get(SensorsManager);
  if (!sensors) {
    sensors = new SensorsManager(undefined, config.sensorOptions);
    core.scene.add(sensors);
    await core.scriptsManager.initScript(sensors);
    core.registry.register(sensors, SensorsManager);
  }

  if (config.autoPause ?? true) {
    core.pause();
  }

  const bridge = new UserAgentBridgeImpl(
    core,
    embodiedControl,
    sensors,
    config
  );
  (
    globalThis as unknown as {userAgentBridge?: UserAgentBridge}
  ).userAgentBridge = bridge;
  return bridge;
}

class UserAgentBridgeImpl implements UserAgentBridge {
  constructor(
    private core: Core,
    private embodiedControl: EmbodiedControl,
    private sensors: SensorsManager,
    private config: UserAgentBridgeConfig
  ) {}

  async observe(
    options: UserAgentObserveOptions = {}
  ): Promise<Record<string, unknown>> {
    return this.capture(options);
  }

  async step(
    action: UserAgentAction = {},
    options: UserAgentObserveOptions = {}
  ): Promise<Record<string, unknown>> {
    await this.embodiedControl.step({
      durationMs: this.config.dtMs ?? 50,
      control: normalizeAction(action),
    });
    return this.capture(options);
  }

  async command(
    command: UserAgentCommand,
    options: UserAgentObserveOptions = {}
  ): Promise<Record<string, unknown>> {
    const target =
      'target' in command && command.target !== undefined
        ? this.resolveTarget(command.target)
        : undefined;

    switch (command.kind) {
      case 'lookAt':
        await this.embodiedControl.lookAtTarget(target!, {
          velocity: command.velocity,
        });
        break;
      case 'reachTo':
        await this.embodiedControl.reachTo(handToIndex(command.hand), target!, {
          velocity: command.velocity,
        });
        break;
      case 'pointTo':
        await this.embodiedControl.pointTo(handToIndex(command.hand), target!, {
          velocity: command.velocity,
        });
        break;
      case 'click':
        await this.embodiedControl.click(handToIndex(command.hand), {
          durationMs: command.durationMs,
        });
        break;
      case 'teleportTo':
        await this.embodiedControl.teleportTo(target!, {
          distance: command.distance,
          faceTarget: command.faceTarget,
          snapToGround: command.snapToGround,
        });
        break;
      default:
        throw new Error(
          `Unsupported command: ${(command as {kind?: string}).kind}`
        );
    }

    return this.capture(options);
  }

  async inspect(
    options: UserAgentObserveOptions = {}
  ): Promise<Record<string, unknown>> {
    const observation = await this.capture(options);
    return toPlainJson({
      loaded: true,
      simulatorRunning: this.core.simulatorRunning,
      paused: this.core.isPaused,
      observation,
    }) as Record<string, unknown>;
  }

  async dispose(): Promise<void> {
    const globalBridge = globalThis as unknown as {
      userAgentBridge?: UserAgentBridge;
    };
    if (globalBridge.userAgentBridge === this) {
      globalBridge.userAgentBridge = undefined;
    }
  }

  private async capture(options: UserAgentObserveOptions) {
    const sensorOptions = {
      ...this.config.sensorOptions,
      ...options.sensorOptions,
      updateMode: 'sync' as const,
    };
    const instances = getSensorsForKeys(
      options.sensors ?? this.config.sensors ?? DEFAULT_SENSORS,
      sensorOptions
    );
    const sensorTimeoutMs = this.config.sensorTimeoutMs ?? 2000;
    const promises = instances.map((sensor) =>
      withTimeout(this.sensors.get(sensor, sensorOptions), sensorTimeoutMs)
    );
    if (instances.some((sensor) => isScreenshotSensorKey(sensor.key))) {
      this.core.stepFrame(this.config.dtMs ?? 50);
    }
    const results = await Promise.all(promises);
    const observation: Record<string, unknown> = {};
    const sensorErrors: Record<string, string> = {};
    instances.forEach((sensor, index) => {
      const result = results[index];
      if (result.ok) {
        observation[sensor.key] = result.value;
      } else {
        observation[sensor.key] = null;
        sensorErrors[sensor.key] = result.error;
      }
    });
    if (Object.keys(sensorErrors).length > 0) {
      observation.sensorErrors = sensorErrors;
    }
    return toPlainJson(observation) as Record<string, unknown>;
  }

  private resolveTarget(
    target: string | [number, number, number]
  ): THREE.Object3D | THREE.Vector3 {
    if (typeof target !== 'string') {
      return new THREE.Vector3().fromArray(target);
    }
    const object = this.core.scene.getObjectByName(target);
    if (!object) {
      throw new Error(`Object target not found in scene: ${target}`);
    }
    return object;
  }
}

type SensorCaptureResult<T> = {ok: true; value: T} | {ok: false; error: string};

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<SensorCaptureResult<T>> {
  return new Promise<SensorCaptureResult<T>>((resolve) => {
    const timeout = setTimeout(
      () =>
        resolve({
          ok: false,
          error: `Sensor capture timed out after ${timeoutMs}ms.`,
        }),
      timeoutMs
    );
    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve({ok: true, value});
      })
      .catch((error) => {
        clearTimeout(timeout);
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
}

function normalizeAction(action: UserAgentAction): XRCompoundControl {
  return {
    locomotion: action.camera,
    leftHand: action.leftHand,
    rightHand: action.rightHand,
  };
}

function handToIndex(hand: UserAgentHand = 'right'): number {
  if (hand === 'left') return 0;
  if (hand === 'right') return 1;
  return hand ?? 1;
}

function getSensorsForKeys(
  keys: UserAgentSensorKey[],
  options?: UserAgentBridgeConfig['sensorOptions']
): Sensor<unknown>[] {
  return keys.map((key) => {
    switch (key) {
      case 'state':
        return new ProprioceptionSensor();
      case 'targeting':
        return new TargetingSensor();
      case 'visibleObjects':
        return new SemanticMapSensor({
          visibility: new VisibilitySensor({
            verifyLineOfSight: options?.verifyLineOfSight,
          }),
        });
      case 'sceneGraph':
        return new SceneGraphSensor();
      case 'screenshotCamera':
        return new ScreenshotCameraSensor();
      case 'screenshotXR':
        return new ScreenshotXRSensor();
      case 'screenshotSOM':
        return new ScreenshotSOMSensor({
          visibility: new VisibilitySensor({
            verifyLineOfSight: options?.verifyLineOfSight,
          }),
        });
      case 'depth':
        return new DepthSensor({gridSize: options?.depthGridSize});
      default:
        throw new Error(`Unknown sensor key: ${key}`);
    }
  });
}

function isScreenshotSensorKey(key: string): boolean {
  return (
    key === 'screenshotCamera' ||
    key === 'screenshotXR' ||
    key === 'screenshotSOM'
  );
}

function toPlainJson(value: unknown): unknown {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue) => {
      if (typeof nestedValue === 'function') return undefined;
      if (typeof nestedValue === 'number' && !Number.isFinite(nestedValue)) {
        return null;
      }
      if (nestedValue && typeof nestedValue === 'object') {
        if (seen.has(nestedValue)) return undefined;
        seen.add(nestedValue);
      }
      return nestedValue;
    })
  );
}
