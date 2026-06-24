import '../testing/setup';
import {describe, it, expect, vi} from 'vitest';
import * as THREE from 'three';
import {
  Script,
  core,
  Options,
  ScreenshotSynthesizer,
  HAND_JOINT_NAMES,
  Input,
} from 'xrblocks';
import {TestRunner} from '../testing/TestRunner';
import {
  SensorsManager,
  sensors,
  ProprioceptionSensor,
  DepthSensor,
  TargetingSensor,
  VisibilitySensor,
  DeviceCameraViewSensor,
  UserViewSensor,
  SOMViewSensor,
  SceneGraphSensor,
  PlaneSensor,
  WorldObjectsSensor,
  BodyPoseSensor,
  SoundSensor,
  Sensor,
  type SensorContext,
} from './index';

vi.mock('./sensors/CameraSensor', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SOMViewSensor: class extends (actual.SOMViewSensor as any) {
      override async update(context: SensorContext) {
        const userView = await context.get(UserViewSensor);
        return `annotated:${userView || 'mock-user-view'}`;
      }
    },
  };
});

class TestObjectScript extends Script {
  constructor() {
    super();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    this.add(mesh);
    this.position.set(0, core.user.height, -1);
    this.name = 'Trigger System';
    this.type = 'TextButton';
  }
}

describe('SensorsManager & Sensor API integration tests', () => {
  const getScreenshotSpy = vi
    .spyOn(ScreenshotSynthesizer.prototype, 'getScreenshot')
    .mockResolvedValue(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    );

  it('should support facade capture with automatic lazy self-bootstrapping', async () => {
    const options = new Options();
    options.hands.enabled = true;

    const runner = await TestRunner.create({
      scripts: [],
      options,
    });

    const rightHand = runner.core.user.hands.hands[1];
    if (rightHand) {
      const joints = rightHand.joints as Record<string, THREE.Object3D>;
      for (const jointName of HAND_JOINT_NAMES) {
        const jointObj = new THREE.Group();
        jointObj.position.set(0.1, 0.2, 0.3);
        joints[jointName] = jointObj;
      }
    }

    const state = await sensors.capture(ProprioceptionSensor);

    expect(state).toBeDefined();
    expect(state.camera.position).toBeDefined();
    expect(state.leftHand).toBeDefined();
    expect(state.rightHand.jointKeypoints).toBeDefined();

    const manager = runner.core.registry.get(SensorsManager);
    expect(manager).toBeDefined();

    await runner.destroy();
  });

  it('should support retrieving from the central SensorsManager using class constructors', async () => {
    const manager = new SensorsManager([ProprioceptionSensor]);

    const runner = await TestRunner.create({
      scripts: [manager],
    });

    const state = await manager.capture(ProprioceptionSensor);
    expect(state).toBeDefined();
    expect(state.camera.position).toBeDefined();

    await runner.destroy();
  });

  it('should perform 3D raycast targeting and return surface intersection metrics', async () => {
    const targetScript = new Script();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    targetScript.add(mesh);
    targetScript.position.set(0, core.user.height, -2);
    targetScript.name = 'PointingTargetBox';

    const runner = await TestRunner.create({
      scripts: [targetScript],
    });

    await runner.actions.pointTo(1, targetScript);
    await runner.actions.step({durationMs: 100});

    const targeting = await sensors.capture(TargetingSensor);

    const rightHandTargeting = targeting.rightHand;
    expect(rightHandTargeting).toBeDefined();
    expect(rightHandTargeting?.hoveredObjectId).toBe(mesh.id);
    expect(rightHandTargeting?.distanceToHoveredObject).toBeGreaterThan(0);
    expect(rightHandTargeting?.intersectionPoint).toBeDefined();
    expect(rightHandTargeting?.surfaceNormal).toBeDefined();

    await runner.destroy();
  });

  it('should detect when hand is colliding/overlapping with an object volume', () => {
    const targetingSensor = new TargetingSensor();

    // 1. Create a simple scene with a target mesh
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.position.set(0, 0, 0);
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    // 2. Create a mock controller positioned inside the 1x1x1 mesh box
    const rightController = new THREE.Object3D();
    rightController.position.set(0.2, 0.1, -0.2);
    rightController.updateMatrixWorld(true);

    // 3. Mock the SensorContext
    const mockInput = {
      leftController: undefined,
      rightController,
      gazeController: new THREE.Object3D(),
      intersectionsForController: new Map(),
    } as unknown as Input;

    const mockCore = {
      scene,
    } as unknown as Core;

    const mockContext = {
      core: mockCore,
      camera: new THREE.PerspectiveCamera(),
      input: mockInput,
    } as unknown as SensorContext;

    // 4. Update the sensor and assert the collision is detected
    const targeting = targetingSensor.update(mockContext);
    expect(targeting.rightHand).toBeDefined();
    expect(targeting.rightHand?.collidingObjectId).toBe(mesh.id);

    // 5. If we move the controller outside the box, it should be null
    rightController.position.set(5, 5, 5);
    rightController.updateMatrixWorld(true);

    const targeting2 = targetingSensor.update(mockContext);
    expect(targeting2.rightHand?.collidingObjectId).toBeNull();
  });

  it('should resolve sensor dependencies and capture Set-of-Mark camera overlays', async () => {
    const button = new TestObjectScript();

    const runner = await TestRunner.create({
      scripts: [button],
    });

    runner.camera.aspect = 1.0;
    runner.camera.position.set(0, 1.6, 0);
    runner.camera.lookAt(0, 1.6, -1);
    runner.camera.updateMatrixWorld(true);
    runner.camera.matrixWorldInverse.copy(runner.camera.matrixWorld).invert();

    await runner.actions.step({durationMs: 100});

    const {somCamera, visibleObjects} = await sensors.captureAll({
      somCamera: SOMViewSensor,
      visibleObjects: VisibilitySensor,
    });

    expect(somCamera).toBeDefined();
    expect(typeof somCamera).toBe('string');
    expect(somCamera.startsWith('annotated:')).toBe(true);

    expect(visibleObjects).toBeDefined();
    expect(visibleObjects.length).toBeGreaterThan(0);

    const btnRef = visibleObjects.find((ref) => ref.type === 'TextButton');
    expect(btnRef).toBeDefined();
    expect(btnRef?.label).toBe('1');
    expect(btnRef?.description).toContain("TextButton 'Trigger System'");

    await runner.destroy();
  });

  it('should return visible labeled entities for embodied actions', async () => {
    const button = new TestObjectScript();

    const runner = await TestRunner.create({
      scripts: [button],
    });

    runner.camera.aspect = 1.0;
    runner.camera.position.set(0, 1.6, 0);
    runner.camera.lookAt(0, 1.6, -1);
    runner.camera.updateMatrixWorld(true);
    runner.camera.matrixWorldInverse.copy(runner.camera.matrixWorld).invert();

    await runner.actions.step({durationMs: 100});

    const visibleObjects = await sensors.capture(VisibilitySensor);
    const btnRef = visibleObjects.find((ref) => ref.type === 'TextButton');

    expect(btnRef).toBeDefined();
    expect(btnRef?.label).toBe('1');
    expect(btnRef?.name).toBe('Trigger System');
    expect(btnRef?.description).toContain("TextButton 'Trigger System'");

    await runner.destroy();
  });

  it('should capture user view images with camera overlay by default', async () => {
    getScreenshotSpy.mockClear();
    const runner = await TestRunner.create({scripts: []});
    const userView = await sensors.capture(UserViewSensor);

    expect(userView).toContain('data:image/png;base64');
    expect(getScreenshotSpy).toHaveBeenCalledWith(true);

    await runner.destroy();
  });

  it('should let user view callers disable camera overlay behavior', async () => {
    getScreenshotSpy.mockClear();
    const runner = await TestRunner.create({scripts: []});

    await sensors.capture(UserViewSensor, {overlayOnCamera: false});

    expect(getScreenshotSpy).toHaveBeenCalledWith(false);

    await runner.destroy();
  });

  it('should throw when raw device camera data is unavailable', async () => {
    const runner = await TestRunner.create({scripts: []});
    (runner.core as unknown as {deviceCamera: unknown}).deviceCamera =
      undefined;

    await expect(sensors.capture(DeviceCameraViewSensor)).rejects.toThrow(
      'DeviceCameraViewSensor requires an initialized XRDeviceCamera.'
    );

    (runner.core as unknown as {deviceCamera: unknown}).deviceCamera = {
      loaded: false,
    };
    await expect(sensors.capture(DeviceCameraViewSensor)).rejects.toThrow(
      'DeviceCameraViewSensor requires an initialized XRDeviceCamera.'
    );

    (runner.core as unknown as {deviceCamera: unknown}).deviceCamera = {
      loaded: true,
      getSnapshot: vi.fn().mockResolvedValue(null),
    };
    await expect(sensors.capture(DeviceCameraViewSensor)).rejects.toThrow(
      'DeviceCameraViewSensor failed to capture a frame.'
    );

    await runner.destroy();
  });

  it('should capture raw device camera data with Gemini-equivalent defaults and overrides', async () => {
    const runner = await TestRunner.create({scripts: []});
    const mockCameraSnapshot = 'data:image/jpeg;base64,cameraSnapshotData';
    const getSnapshot = vi.fn().mockResolvedValue(mockCameraSnapshot);
    (runner.core as unknown as {deviceCamera: unknown}).deviceCamera = {
      loaded: true,
      getSnapshot,
    };

    const defaultSnapshot = await sensors.capture(DeviceCameraViewSensor);
    expect(defaultSnapshot).toBe(mockCameraSnapshot);
    expect(getSnapshot).toHaveBeenCalledWith({
      outputFormat: 'base64',
      mimeType: 'image/jpeg',
      quality: 0.8,
    });

    getSnapshot.mockClear();
    await sensors.capture(DeviceCameraViewSensor, {
      mimeType: 'image/png',
      quality: 0.5,
      width: 320,
      height: 180,
    });
    expect(getSnapshot).toHaveBeenCalledWith({
      outputFormat: 'base64',
      mimeType: 'image/png',
      quality: 0.5,
      width: 320,
      height: 180,
    });

    await runner.destroy();
  });

  it('should serialize scene graph nodes without internal userData payloads', async () => {
    const runner = await TestRunner.create({scripts: []});
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.name = 'Public Object';
    mesh.userData = {
      selected: true,
      connected: true,
      nestedInternalState: {veryLarge: ['payload']},
    };
    runner.core.scene.add(mesh);

    const graph = await sensors.capture(SceneGraphSensor);
    const node = graph.find((entry) => entry.id === mesh.id);

    expect(node).toBeDefined();
    expect(node).toMatchObject({
      id: mesh.id,
      name: 'Public Object',
      type: 'Mesh',
    });
    expect(node).not.toHaveProperty('userData');

    await runner.destroy();
  });

  it('should cull internal mesh descendants from scene graph output', async () => {
    class CompositeScript extends Script {
      constructor() {
        super();
        this.name = 'Composite';
        this.type = 'CompositeWidget';
        for (let i = 0; i < 8; i++) {
          const child = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
          child.name = `InternalMesh${i}`;
          this.add(child);
        }
      }
    }

    const composite = new CompositeScript();
    const runner = await TestRunner.create({scripts: [composite]});

    const graph = await sensors.capture(SceneGraphSensor);

    expect(graph).toHaveLength(1);
    expect(graph[0]).toMatchObject({
      id: composite.id,
      name: 'Composite',
      type: 'CompositeWidget',
      children: [],
    });

    await runner.destroy();
  });

  it('should keep semantic UI children when culling scene graph internals', async () => {
    const panel = new Script();
    panel.name = 'Actions Panel';
    (panel as unknown as {isView: boolean}).isView = true;

    const button = new Script();
    button.name = 'Launch Button';
    button.type = 'TextButton';
    (button as unknown as {isView: boolean}).isView = true;
    button.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1)));
    panel.add(button);

    const runner = await TestRunner.create({scripts: [panel]});

    const graph = await sensors.capture(SceneGraphSensor);
    const panelNode = graph.find((entry) => entry.id === panel.id);
    const buttonNode = graph.find((entry) => entry.id === button.id);

    expect(panelNode).toBeDefined();
    expect(buttonNode).toBeDefined();
    expect(panelNode?.children).toContain(button.id);
    expect(graph.some((entry) => entry.name === 'Launch Button')).toBe(true);

    await runner.destroy();
  });

  it('should return native depth data and skip CPU fallback when depth is unavailable', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context = {
      core: {
        depth: {
          enabled: true,
          rawValueToMeters: 0.5,
          width: 2,
          height: 2,
          depthArray: [new Uint16Array([2, 4, 6, 8])],
        },
      },
      camera: new THREE.PerspectiveCamera(),
      input: {},
      get: vi.fn(),
      defer: vi.fn(),
    } as unknown as SensorContext;

    expect(new DepthSensor().update(context)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(warnSpy).not.toHaveBeenCalled();

    (context.core as unknown as {depth: unknown}).depth = {
      enabled: false,
      depthArray: [],
    };
    expect(new DepthSensor().update(context)).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'DepthSensor requires enabled depth data.'
    );

    warnSpy.mockRestore();
  });

  it('should keep behavior option variants separate while sharing runtime cache policy', async () => {
    const counts: Record<string, number> = {};
    class VariantSensor extends Sensor<{variant: string; count: number}> {
      static readonly optionKeys = ['variant'];
      readonly key = 'variant';
      update() {
        const variant =
          (this.options as {variant?: string}).variant ?? 'default';
        counts[variant] = (counts[variant] ?? 0) + 1;
        return {variant, count: counts[variant]};
      }
    }

    const runner = await TestRunner.create({scripts: []});

    const firstA = await sensors.capture(VariantSensor, {
      variant: 'a',
      cacheWindowMs: 1000,
    });
    const secondA = await sensors.capture(VariantSensor, {
      variant: 'a',
      cacheWindowMs: 500,
    });
    const firstB = await sensors.capture(VariantSensor, {
      variant: 'b',
      cacheWindowMs: 1000,
    });

    expect(firstA).toEqual({variant: 'a', count: 1});
    expect(secondA).toBe(firstA);
    expect(firstB).toEqual({variant: 'b', count: 1});
    expect(counts).toEqual({a: 1, b: 1});

    await runner.destroy();
  });

  it('should cache observations requested within the cacheWindowMs and invalidate them afterwards', async () => {
    let count = 0;
    class CountingSensor extends Sensor<number> {
      readonly key = 'counting';
      update() {
        count++;
        return count;
      }
    }

    const runner = await TestRunner.create({
      scripts: [],
    });

    const val1 = await sensors.capture(CountingSensor, {cacheWindowMs: 20});
    expect(val1).toBeDefined();
    expect(count).toBe(1);

    const val2 = await sensors.capture(CountingSensor, {cacheWindowMs: 20});
    expect(val2).toBe(val1);
    expect(count).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const val3 = await sensors.capture(CountingSensor, {cacheWindowMs: 20});
    expect(val3).toBeDefined();
    expect(val3).not.toBe(val1);
    expect(count).toBe(2);

    await runner.destroy();
  });

  it('should support progressive enrichment of cached observations on the same frame', async () => {
    let count = 0;
    class CountingSensor extends Sensor<number> {
      readonly key = 'counting';
      update() {
        count++;
        return count;
      }
    }

    const runner = await TestRunner.create({
      scripts: [],
    });

    const val1 = await sensors.capture(CountingSensor, {cacheWindowMs: 20});
    expect(val1).toBeDefined();
    expect(count).toBe(1);

    const {counting, depth} = await sensors.captureAll(
      {
        counting: CountingSensor,
        depth: DepthSensor,
      },
      {cacheWindowMs: 20}
    );

    expect(counting).toBe(val1);
    expect(depth).toBeDefined();

    expect(count).toBe(1);

    await runner.destroy();
  });

  it('should throw from captureAll and return null for failed sensors during tryCaptureAll', async () => {
    class FailingSensor extends Sensor<string> {
      readonly key = 'failing';
      update() {
        throw new Error('Intentional sensor failure');
      }
    }

    const manager = new SensorsManager();
    const runner = await TestRunner.create({
      scripts: [manager],
    });

    await expect(
      manager.captureAll({
        state: ProprioceptionSensor,
        failed: FailingSensor,
      })
    ).rejects.toThrow('Intentional sensor failure');

    const {values, errors} = await manager.tryCaptureAll({
      state: ProprioceptionSensor,
      failed: FailingSensor,
    });

    expect(values.state).toBeDefined();
    expect(values.failed).toBeNull();
    expect(errors).toEqual({
      failed: 'Intentional sensor failure',
    });
    expect(manager.getLastCaptureErrors()).toEqual({
      failing: 'Intentional sensor failure',
    });

    await runner.destroy();
  });

  it('should return empty world perception observations when subsystems are missing', async () => {
    const context = {
      core: {world: {}},
      camera: new THREE.PerspectiveCamera(),
      input: {},
      get: vi.fn(),
      defer: vi.fn(),
    } as unknown as SensorContext;

    expect(new PlaneSensor().update(context)).toEqual([]);
    await expect(new WorldObjectsSensor().update(context)).resolves.toEqual([]);
    await expect(new BodyPoseSensor().update(context)).resolves.toEqual([]);
    await expect(new SoundSensor().update(context)).resolves.toEqual({
      isListening: false,
      latest: null,
      history: [],
    });
  });

  it('should return native detected planes from the current world state', () => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 3));
    plane.position.set(1, 2, 3);
    plane.scale.set(1, 2, 1);
    Object.assign(plane, {
      label: 'floor',
      orientation: 'Horizontal',
    });

    const context = {
      core: {
        world: {
          planes: {
            get: vi.fn().mockReturnValue([plane]),
          },
        },
      },
      camera: new THREE.PerspectiveCamera(),
      input: {},
      get: vi.fn(),
      defer: vi.fn(),
    } as unknown as SensorContext;

    const observations = new PlaneSensor().update(context);

    expect(observations).toBe(
      (context.core.world.planes as {get(): unknown[]}).get()
    );
    expect(observations[0]).toBe(plane);
  });

  it('should run object detection and return native detected objects', async () => {
    const object = new THREE.Object3D() as THREE.Object3D & {
      label: string;
      detection2DBoundingBox: THREE.Box2;
      data: Record<string, unknown>;
    };
    object.position.set(1, 2, 3);
    object.label = 'cup';
    object.detection2DBoundingBox = new THREE.Box2(
      new THREE.Vector2(0.1, 0.2),
      new THREE.Vector2(0.4, 0.6)
    );
    object.data = {color: 'white'};

    const runDetection = vi.fn().mockResolvedValue([object]);
    const context = {
      core: {
        world: {
          objects: {runDetection},
        },
      },
      camera: new THREE.PerspectiveCamera(),
      input: {},
      get: vi.fn(),
      defer: vi.fn(),
    } as unknown as SensorContext;

    const observations = await new WorldObjectsSensor().update(context);

    expect(runDetection).toHaveBeenCalledTimes(1);
    expect(observations).toEqual([object]);
    expect(observations[0]).toBe(object);
  });

  it('should run body pose detection and return native detected poses', async () => {
    const pose = new THREE.Object3D() as THREE.Object3D & {
      poseId: number;
      detection2DBoundingBox: THREE.Box2;
      landmarks: {
        x: number;
        y: number;
        z: number;
        visibility?: number;
        worldPosition?: THREE.Vector3;
      }[];
    };
    pose.poseId = 7;
    pose.position.set(0.5, 1, -2);
    pose.detection2DBoundingBox = new THREE.Box2(
      new THREE.Vector2(0.2, 0.3),
      new THREE.Vector2(0.8, 0.9)
    );
    pose.landmarks = [
      {
        x: 0.25,
        y: 0.35,
        z: -0.1,
        visibility: 0.95,
        worldPosition: new THREE.Vector3(1, 2, 3),
      },
    ];

    const runDetection = vi.fn().mockResolvedValue([pose]);
    const context = {
      core: {
        world: {
          humans: {runDetection},
        },
      },
      camera: new THREE.PerspectiveCamera(),
      input: {},
      get: vi.fn(),
      defer: vi.fn(),
    } as unknown as SensorContext;

    const observations = await new BodyPoseSensor().update(context);

    expect(runDetection).toHaveBeenCalledTimes(1);
    expect(observations).toEqual([pose]);
    expect(observations[0]).toBe(pose);
  });

  it('should start sound listening once and return latest sound history', async () => {
    let soundListener:
      | ((event: {
          audioClassifierResult: {
            items: {
              classifications: {
                categories: {categoryName: string; score: number}[];
              }[];
            }[];
          };
        }) => void)
      | undefined;
    const soundDetector = {
      isListening: false,
      startListening: vi.fn().mockImplementation(async () => {
        soundDetector.isListening = true;
      }),
      addEventListener: vi.fn().mockImplementation((_type, listener) => {
        soundListener = listener;
      }),
    };
    const context = {
      core: {
        world: {
          sounds: soundDetector,
        },
      },
      camera: new THREE.PerspectiveCamera(),
      input: {},
      get: vi.fn(),
      defer: vi.fn(),
    } as unknown as SensorContext;

    const sensor = new SoundSensor();
    const initial = await sensor.update(context);

    expect(soundDetector.startListening).toHaveBeenCalledTimes(1);
    expect(soundDetector.addEventListener).toHaveBeenCalledTimes(1);
    expect(initial).toEqual({
      isListening: true,
      latest: null,
      history: [],
    });

    const result = {
      items: [
        {
          classifications: [
            {
              categories: [{categoryName: 'Speech', score: 0.9}],
            },
          ],
        },
      ],
    };
    soundListener?.({audioClassifierResult: result});

    const next = await sensor.update(context);

    expect(soundDetector.startListening).toHaveBeenCalledTimes(1);
    expect(soundDetector.addEventListener).toHaveBeenCalledTimes(1);
    expect(next).toEqual({
      isListening: true,
      latest: result,
      history: [result],
    });
  });

  it('should protect slow async sensors with the Single-Flight Concurrency Guard', async () => {
    const runner = await TestRunner.create({
      scripts: [],
    });

    const mockCameraSnapshot = 'data:image/jpeg;base64,cameraSnapshotData';
    let snapshotCount = 0;
    const mockCamera = {
      loaded: true,
      getSnapshot: vi.fn().mockImplementation(async () => {
        snapshotCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return mockCameraSnapshot;
      }),
    };
    (runner.core as unknown as {deviceCamera: unknown}).deviceCamera =
      mockCamera;

    const [cam1, cam2] = await Promise.all([
      sensors.capture(DeviceCameraViewSensor),
      sensors.capture(DeviceCameraViewSensor),
    ]);

    expect(cam1).toBe(mockCameraSnapshot);
    expect(cam2).toBe(cam1);
    expect(snapshotCount).toBe(1);

    await runner.destroy();
  });

  it('should bypass completed cache when forceRefresh is set', async () => {
    let count = 0;
    class CountingSensor extends Sensor<number> {
      readonly key = 'counting';
      update() {
        count++;
        return count;
      }
    }
    const runner = await TestRunner.create({scripts: []});

    const first = await sensors.capture(CountingSensor, {cacheWindowMs: 1000});
    const cached = await sensors.capture(CountingSensor, {cacheWindowMs: 1000});
    const refreshed = await sensors.capture(CountingSensor, {
      cacheWindowMs: 1000,
      forceRefresh: true,
    });

    expect(first).toBe(1);
    expect(cached).toBe(1);
    expect(refreshed).toBe(2);
    expect(count).toBe(2);

    await runner.destroy();
  });

  it('should apply forceRefresh to every sensor in batch capture', async () => {
    const counts = {a: 0, b: 0};
    class SensorA extends Sensor<number> {
      readonly key = 'a';
      update() {
        counts.a++;
        return counts.a;
      }
    }
    class SensorB extends Sensor<number> {
      readonly key = 'b';
      update() {
        counts.b++;
        return counts.b;
      }
    }

    const manager = new SensorsManager();
    const runner = await TestRunner.create({scripts: [manager]});

    expect(
      await manager.captureAll(
        {
          a: SensorA,
          b: SensorB,
        },
        {cacheWindowMs: 1000}
      )
    ).toEqual({a: 1, b: 1});
    expect(
      await manager.captureAll(
        {
          a: SensorA,
          b: SensorB,
        },
        {cacheWindowMs: 1000}
      )
    ).toEqual({a: 1, b: 1});
    expect(
      await manager.captureAll(
        {
          a: SensorA,
          b: SensorB,
        },
        {cacheWindowMs: 1000, forceRefresh: true}
      )
    ).toEqual({a: 2, b: 2});

    expect(counts).toEqual({a: 2, b: 2});

    await runner.destroy();
  });

  it('should expose sensor cache info and clear cache through the manager', async () => {
    class CountingSensor extends Sensor<number> {
      readonly key = 'counting';
      update() {
        return 1;
      }
    }
    const manager = new SensorsManager([
      [CountingSensor, {cacheWindowMs: 1000}],
    ]);
    const runner = await TestRunner.create({scripts: [manager]});
    const sensor = manager.getOrCreateInstance(CountingSensor, {
      cacheWindowMs: 1000,
    });

    expect(sensor.getCacheInfo()).toMatchObject({
      hasValue: false,
      capturedAt: null,
      ageMs: null,
      active: false,
    });

    await manager.capture(CountingSensor, {cacheWindowMs: 1000});

    const info = sensor.getCacheInfo();
    expect(info.hasValue).toBe(true);
    expect(info.capturedAt).toEqual(expect.any(Number));
    expect(info.ageMs).toEqual(expect.any(Number));
    expect(info.active).toBe(false);
    expect(manager.getLatest(CountingSensor, {cacheWindowMs: 1000})).toBe(1);

    manager.clearCache();

    expect(sensor.getLatest()).toBeUndefined();
    expect(sensor.getCacheInfo()).toMatchObject({
      hasValue: false,
      capturedAt: null,
      ageMs: null,
      active: false,
    });

    await runner.destroy();
  });

  it('should merge duplicate sensor registrations using stricter cache policy', async () => {
    class CountingSensor extends Sensor<number> {
      readonly key = 'counting';
      update() {
        return 1;
      }
    }

    const manager = new SensorsManager([
      [CountingSensor, {cacheWindowMs: 1000}],
      [CountingSensor, {cacheWindowMs: 4}],
    ]);
    const runner = await TestRunner.create({scripts: [manager]});

    const canonical = manager.getOrCreateInstance(CountingSensor);

    expect(canonical.options.cacheWindowMs).toBe(4);

    await runner.destroy();
  });

  it('should support sync, background, and idle update modes', async () => {
    const val1 = await sensors.capture(ProprioceptionSensor, {
      updateMode: 'sync',
    });
    expect(val1).toBeDefined();

    const runner = await TestRunner.create({
      scripts: [],
    });
    const depthVal = await sensors.capture(DepthSensor, {updateMode: 'idle'});
    expect(depthVal).toBeDefined();

    const manager = runner.core.registry.get(SensorsManager)!;

    let count = 0;
    class SlowBackgroundSensor extends Sensor<number> {
      readonly key = 'slow';
      constructor() {
        super({updateMode: 'background'});
      }
      async update() {
        count++;
        await new Promise((r) => setTimeout(r, 20));
        return count;
      }
    }
    const slow = manager.getOrCreateInstance(SlowBackgroundSensor);

    // First call triggers background run, registers the sensor and sets up its state
    const p1 = manager.capture(SlowBackgroundSensor);
    expect(slow.getCacheInfo().active).toBe(true);

    // Immediate second call reuses the same active work (deduplication)
    const _p2 = manager.capture(SlowBackgroundSensor);
    expect(count).toBe(1);
    expect(slow.getCacheInfo().active).toBe(true);

    const val = await p1;
    expect(val).toBe(1);
    expect(slow.getCacheInfo().active).toBe(false);

    // Now that p1 has completed, a third call will instantly return 1 (synchronously!)
    // and kick off a new background update for count = 2 in the background
    const valImmediate = await manager.capture(SlowBackgroundSensor);
    expect(valImmediate).toBe(1);

    // Wait for the background update to finish
    await new Promise((r) => setTimeout(r, 30));

    // The next call will return the new completed value (2)
    const valNext = await manager.capture(SlowBackgroundSensor);
    expect(valNext).toBe(2);

    await runner.destroy();
  });
});
