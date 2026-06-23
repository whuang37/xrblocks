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
  SpatialPanel,
  TextButton,
} from 'xrblocks';
import {TestRunner} from '../testing/TestRunner';
import {
  SensorsManager,
  ProprioceptionSensor,
  DepthSensor,
  TargetingSensor,
  ScreenshotCameraSensor,
  ScreenshotXRSensor,
  ScreenshotSOMSensor,
  SemanticMapSensor,
  SceneGraphSensor,
  PlaneSensor,
  WorldObjectsSensor,
  BodyPoseSensor,
  SoundSensor,
  Sensor,
  type SensorContext,
} from './index';

vi.mock('./sensors/ScreenshotSensor', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ScreenshotSOMSensor: class extends (actual.ScreenshotSOMSensor as any) {
      override async update(context: SensorContext) {
        // Resolve the XR screenshot dependency using the new context.get() API
        const xr = await context.get(ScreenshotXRSensor);
        return `annotated:${xr || 'mock-xr-screenshot'}`;
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

  it('should support direct sensor capture with automatic lazy self-bootstrapping', async () => {
    const proprioception = new ProprioceptionSensor();
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

    const state = await proprioception.capture();

    expect(state).toBeDefined();
    expect(state.camera.position).toBeDefined();
    expect(state.leftHand).toBeDefined();
    expect(state.rightHand.jointKeypoints).toBeDefined();

    const manager = runner.core.registry.get(SensorsManager);
    expect(manager).toBeDefined();

    await runner.destroy();
  });

  it('should support retrieving from the central SensorsManager using class constructors', async () => {
    const proprioception = new ProprioceptionSensor();
    const sensors = new SensorsManager([proprioception]);

    const runner = await TestRunner.create({
      scripts: [sensors],
    });

    const state = await sensors.get(ProprioceptionSensor);
    expect(state).toBeDefined();
    expect(state.camera.position).toBeDefined();

    await runner.destroy();
  });

  it('should perform 3D raycast targeting and return surface intersection metrics', async () => {
    const targetingSensor = new TargetingSensor();
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

    const targeting = await targetingSensor.capture();

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

  it('should resolve sensor dependencies and capture Set-of-Mark visual screenshot overlays', async () => {
    const somSensor = new ScreenshotSOMSensor();
    const semanticSensor = new SemanticMapSensor();
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

    const [screenshotSOM, visibleObjects] = await SensorsManager.capture([
      somSensor,
      semanticSensor,
    ]);

    expect(screenshotSOM).toBeDefined();
    expect(typeof screenshotSOM).toBe('string');
    expect(screenshotSOM.startsWith('annotated:')).toBe(true);

    expect(visibleObjects).toBeDefined();
    expect(visibleObjects.length).toBeGreaterThan(0);

    const btnRef = visibleObjects.find((ref) => ref.type === 'TextButton');
    expect(btnRef).toBeDefined();
    expect(btnRef?.label).toBe('1');
    expect(btnRef?.description).toContain("TextButton 'Trigger System'");

    await runner.destroy();
  });

  it('should capture XR screenshots without camera overlay when no device camera is loaded', async () => {
    getScreenshotSpy.mockClear();
    const runner = await TestRunner.create({scripts: []});
    const screenshot = await new ScreenshotXRSensor().capture();

    expect(screenshot).toContain('data:image/png;base64');
    expect(getScreenshotSpy).toHaveBeenCalledWith(false);

    await runner.destroy();
  });

  it('should capture XR screenshots with camera overlay when a device camera is loaded', async () => {
    getScreenshotSpy.mockClear();
    const runner = await TestRunner.create({scripts: []});
    (runner.core as unknown as {deviceCamera: unknown}).deviceCamera = {
      loaded: true,
    };
    const screenshot = await new ScreenshotXRSensor().capture();

    expect(screenshot).toContain('data:image/png;base64');
    expect(getScreenshotSpy).toHaveBeenCalledWith(true);

    await runner.destroy();
  });

  it('should let XR screenshot callers override camera overlay behavior', async () => {
    getScreenshotSpy.mockClear();
    const runner = await TestRunner.create({scripts: []});

    await new ScreenshotXRSensor({overlayOnCamera: true}).capture();
    await new ScreenshotXRSensor({overlayOnCamera: false}).capture();

    expect(getScreenshotSpy).toHaveBeenNthCalledWith(1, true);
    expect(getScreenshotSpy).toHaveBeenNthCalledWith(2, false);

    await runner.destroy();
  });

  it('should throw a clear error when camera screenshots are requested without an active camera', async () => {
    const runner = await TestRunner.create({scripts: []});
    (runner.core as unknown as {deviceCamera: unknown}).deviceCamera =
      undefined;

    await expect(new ScreenshotCameraSensor().capture()).rejects.toThrow(
      'ScreenshotCameraSensor requires an initialized XRDeviceCamera.'
    );

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

    const graph = await new SceneGraphSensor().capture();
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

    const graph = await new SceneGraphSensor().capture();

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
    const panel = new SpatialPanel();
    panel.name = 'Actions Panel';
    const button = new TextButton({text: 'Launch'});
    button.name = 'Launch Button';
    panel.add(button);

    const runner = await TestRunner.create({scripts: [panel]});

    const graph = await new SceneGraphSensor().capture();
    const panelNode = graph.find((entry) => entry.id === panel.id);
    const buttonNode = graph.find((entry) => entry.id === button.id);

    expect(panelNode).toBeDefined();
    expect(buttonNode).toBeDefined();
    expect(panelNode?.children).toContain(button.id);
    expect(graph.some((entry) => entry.name === 'Launch Button')).toBe(true);

    await runner.destroy();
  });

  it('should support custom sensor parameters (like DepthSensor gridSize)', async () => {
    const depth8 = new DepthSensor({gridSize: 8});
    const depth16 = new DepthSensor({gridSize: 16});

    const runner = await TestRunner.create({
      scripts: [],
    });

    const grid8 = await depth8.capture();
    const grid16 = await depth16.capture();

    expect(grid8.length).toBe(8);
    expect(grid8[0].length).toBe(8);

    expect(grid16.length).toBe(16);
    expect(grid16[0].length).toBe(16);

    await runner.destroy();
  });

  it('should cache observations requested within the cacheWindowMs and invalidate them afterwards', async () => {
    const proprioception = new ProprioceptionSensor();
    const runner = await TestRunner.create({
      scripts: [],
    });

    const updateSpy = vi.spyOn(proprioception, 'update');

    const val1 = await proprioception.capture({cacheWindowMs: 20});
    expect(val1).toBeDefined();
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const val2 = await proprioception.capture({cacheWindowMs: 20});
    expect(val2).toBe(val1);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const val3 = await proprioception.capture({cacheWindowMs: 20});
    expect(val3).toBeDefined();
    expect(val3).not.toBe(val1);
    expect(updateSpy).toHaveBeenCalledTimes(2);

    updateSpy.mockRestore();
    await runner.destroy();
  });

  it('should support progressive enrichment of cached observations on the same frame', async () => {
    const proprioception = new ProprioceptionSensor();
    const depth = new DepthSensor();
    const runner = await TestRunner.create({
      scripts: [],
    });

    const proprioceptionSpy = vi.spyOn(proprioception, 'update');
    const depthSpy = vi.spyOn(depth, 'update');

    const val1 = await proprioception.capture({cacheWindowMs: 20});
    expect(val1).toBeDefined();
    expect(proprioceptionSpy).toHaveBeenCalledTimes(1);
    expect(depthSpy).toHaveBeenCalledTimes(0);

    const [val1_again, val2] = await SensorsManager.capture(
      [proprioception, depth],
      {cacheWindowMs: 20}
    );

    expect(val1_again).toBe(val1);
    expect(val2).toBeDefined();

    expect(proprioceptionSpy).toHaveBeenCalledTimes(1);
    expect(depthSpy).toHaveBeenCalledTimes(1);

    proprioceptionSpy.mockRestore();
    depthSpy.mockRestore();
    await runner.destroy();
  });

  it('should return null for failed sensors during batch capture', async () => {
    class FailingSensor extends Sensor<string> {
      readonly key = 'failing';
      update() {
        throw new Error('Intentional sensor failure');
      }
    }

    const proprioception = new ProprioceptionSensor();
    const failing = new FailingSensor();
    const sensors = new SensorsManager([proprioception, failing]);
    const runner = await TestRunner.create({
      scripts: [sensors],
    });

    const [state, failed] = await sensors.capture([proprioception, failing]);

    expect(state).toBeDefined();
    expect(failed).toBeNull();
    expect(sensors.getLastCaptureErrors()).toEqual({
      failing: 'Intentional sensor failure',
    });
    await expect(sensors.get(failing)).rejects.toThrow(
      'Intentional sensor failure'
    );

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
    const cameraSensor = new ScreenshotCameraSensor();
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
      cameraSensor.capture(),
      cameraSensor.capture(),
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
    const sensor = new CountingSensor({cacheWindowMs: 1000});
    const runner = await TestRunner.create({scripts: []});

    const first = await sensor.capture();
    const cached = await sensor.capture();
    const refreshed = await sensor.capture({forceRefresh: true});

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

    const sensorA = new SensorA({cacheWindowMs: 1000});
    const sensorB = new SensorB({cacheWindowMs: 1000});
    const manager = new SensorsManager([sensorA, sensorB]);
    const runner = await TestRunner.create({scripts: [manager]});

    expect(await manager.capture([sensorA, sensorB])).toEqual([1, 1]);
    expect(await manager.capture([sensorA, sensorB])).toEqual([1, 1]);
    expect(
      await manager.capture([sensorA, sensorB], {forceRefresh: true})
    ).toEqual([2, 2]);

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
    const sensor = new CountingSensor({cacheWindowMs: 1000});
    const manager = new SensorsManager([sensor]);
    const runner = await TestRunner.create({scripts: [manager]});

    expect(sensor.getCacheInfo()).toMatchObject({
      hasValue: false,
      capturedAt: null,
      ageMs: null,
      active: false,
    });

    await manager.get(sensor);

    const info = sensor.getCacheInfo();
    expect(info.hasValue).toBe(true);
    expect(info.capturedAt).toEqual(expect.any(Number));
    expect(info.ageMs).toEqual(expect.any(Number));
    expect(info.active).toBe(false);
    expect(manager.getLatest(sensor)).toBe(1);

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

    const loose = new CountingSensor({cacheWindowMs: 1000});
    const strict = new CountingSensor({cacheWindowMs: 10});
    const manager = new SensorsManager([loose, strict]);
    const runner = await TestRunner.create({scripts: [manager]});

    const canonical = manager.getOrCreateInstance(CountingSensor);

    expect(canonical).toBe(loose);
    expect(canonical.options.cacheWindowMs).toBe(10);

    await runner.destroy();
  });

  it('should support sync, background, and idle update modes', async () => {
    const proprio = new ProprioceptionSensor({updateMode: 'sync'});
    const val1 = await proprio.capture();
    expect(val1).toBeDefined();

    const depth = new DepthSensor({updateMode: 'idle'});
    const runner = await TestRunner.create({
      scripts: [],
    });
    const depthVal = await depth.capture();
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
    const slow = new SlowBackgroundSensor();

    // First call triggers background run, registers the sensor and sets up its state
    const p1 = manager.get(slow);
    expect(slow.getCacheInfo().active).toBe(true);

    // Immediate second call reuses the same active work (deduplication)
    const _p2 = manager.get(slow);
    expect(count).toBe(1);
    expect(slow.getCacheInfo().active).toBe(true);

    const val = await p1;
    expect(val).toBe(1);
    expect(slow.getCacheInfo().active).toBe(false);

    // Now that p1 has completed, a third call will instantly return 1 (synchronously!)
    // and kick off a new background update for count = 2 in the background
    const valImmediate = await slow.capture();
    expect(valImmediate).toBe(1);

    // Wait for the background update to finish
    await new Promise((r) => setTimeout(r, 30));

    // The next call will return the new completed value (2)
    const valNext = await slow.capture();
    expect(valNext).toBe(2);

    await runner.destroy();
  });
});
