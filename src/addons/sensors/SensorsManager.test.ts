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
  ProprioceptionSensor,
  DepthSensor,
  TargetingSensor,
  ScreenshotCameraSensor,
  ScreenshotXRSensor,
  ScreenshotSOMSensor,
  SemanticMapSensor,
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
  vi.spyOn(ScreenshotSynthesizer.prototype, 'getScreenshot').mockResolvedValue(
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

    const val1 = await proprioception.capture();
    expect(val1).toBeDefined();
    expect(proprioceptionSpy).toHaveBeenCalledTimes(1);
    expect(depthSpy).toHaveBeenCalledTimes(0);

    const [val1_again, val2] = await SensorsManager.capture([
      proprioception,
      depth,
    ]);

    expect(val1_again).toBe(val1);
    expect(val2).toBeDefined();

    expect(proprioceptionSpy).toHaveBeenCalledTimes(1);
    expect(depthSpy).toHaveBeenCalledTimes(1);

    proprioceptionSpy.mockRestore();
    depthSpy.mockRestore();
    await runner.destroy();
  });

  it('should protect slow async sensors with the Single-Flight Concurrency Guard', async () => {
    const cameraSensor = new ScreenshotCameraSensor();
    const runner = await TestRunner.create({
      scripts: [],
    });

    const mockCameraSnapshot = 'data:image/jpeg;base64,cameraSnapshotData';
    let snapshotCount = 0;
    const mockCamera = {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = (manager as any).sensorStates.get(slow);
    expect(state).toBeDefined();
    const activeP1 = state.activePromise;
    expect(activeP1).toBeDefined();

    // Immediate second call returns the same active promise (deduplication)
    const _p2 = manager.get(slow);
    const activeP2 = state.activePromise;
    expect(activeP2).toBe(activeP1);

    const val = await p1;
    expect(val).toBe(1);

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
