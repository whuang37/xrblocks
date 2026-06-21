import '../testing/setup';
import {describe, it, expect, vi} from 'vitest';
import * as THREE from 'three';
import {Script, core, Options, ScreenshotSynthesizer, HAND_JOINT_NAMES} from 'xrblocks';
import {TestRunner} from '../testing/TestRunner';
import {Sensors} from './Sensors';

// A simple mock object script representing a spatial entity.
// Bypasses TextButton's dependency on troika-three-text, which crashes JSDOM with WebGL SDF errors.
class TestObjectScript extends Script {
  constructor() {
    super();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    this.add(mesh);
    this.position.set(0, core.user.height, -1);
    this.name = 'Trigger System'; // Give it a name for the semantic map
    this.type = 'TextButton'; // Simulate button type for the test assert
  }
}

describe('Sensors Addon functional integration tests', () => {
  // Mock screenshot capture globally for this test file to prevent WebGL context crashes in JSDOM
  vi.spyOn(ScreenshotSynthesizer.prototype, 'getScreenshot').mockResolvedValue(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  );

  // Mock private renderAnnotatedScreenshot method to bypass JSDOM Image loading hangs
  vi.spyOn(Sensors.prototype as unknown as Record<string, (...args: unknown[]) => unknown>, 'renderAnnotatedScreenshot').mockImplementation(
    async (screenshot: string) => `annotated:${screenshot}`
  );

  it('should capture proprioception and 25 skeletal hand joint keypoints', async () => {
    const sensors = new Sensors();
    const options = new Options();
    options.hands.enabled = true;

    const runner = await TestRunner.create({
      scripts: [sensors],
      options,
    });

    // Populate JSDOM mock joints for the right hand (index 1) so it's not empty
    const rightHand = runner.core.user.hands.hands[1];
    if (rightHand) {
      const joints = rightHand.joints as Record<string, THREE.Object3D>;
      for (const jointName of HAND_JOINT_NAMES) {
        const jointObj = new THREE.Group();
        jointObj.position.set(0.1, 0.2, 0.3); // mock joint position
        joints[jointName] = jointObj;
      }
    }

    // Capture user state
    const obs = await sensors.captureObservation({
      includeUserTransforms: true,
    });

    expect(obs.state).toBeDefined();
    expect(obs.state?.camera.position).toBeDefined();
    expect(obs.state?.camera.quaternion).toBeDefined();

    // Verify left and right hand keypoints
    const leftHand = obs.state?.leftHand;
    const rightHandObs = obs.state?.rightHand;

    expect(leftHand).toBeDefined();
    expect(rightHandObs).toBeDefined();

    // Verify that standard joints (wrist, index tip, thumb tip) exist as [x, y, z] tuples
    expect(rightHandObs?.jointKeypoints).toBeDefined();

    const wristPos = rightHandObs?.jointKeypoints?.['wrist'];
    const indexTipPos = rightHandObs?.jointKeypoints?.['index-finger-tip'];
    const thumbTipPos = rightHandObs?.jointKeypoints?.['thumb-tip'];

    expect(wristPos).toBeDefined();
    expect(Array.isArray(wristPos)).toBe(true);
    expect(wristPos?.length).toBe(3);
    expect(typeof wristPos?.[0]).toBe('number');

    expect(indexTipPos).toBeDefined();
    expect(thumbTipPos).toBeDefined();

    await runner.destroy();
  });

  it('should perform 3D raycast targeting and return surface intersection metrics', async () => {
    const sensors = new Sensors();
    
    // Create a target mesh and place it 2 meters directly in front of the user
    const targetScript = new Script();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    targetScript.add(mesh);
    targetScript.position.set(0, core.user.height, -2);
    targetScript.name = 'PointingTargetBox';

    const runner = await TestRunner.create({
      scripts: [sensors, targetScript],
    });

    // Point the right hand (index 1) directly at the target box
    await runner.actions.pointTo(1, targetScript);
    await runner.actions.step({durationMs: 100});

    // Capture targeting observations
    const obs = await sensors.captureObservation({
      includeTargeting: true,
    });

    const rightHandTargeting = obs.targeting?.rightHand;
    expect(rightHandTargeting).toBeDefined();
    expect(rightHandTargeting?.hoveredObjectId).toBe(mesh.id);
    expect(rightHandTargeting?.distanceToHoveredObject).toBeGreaterThan(0);
    
    // Check hit coordinates and normals
    expect(rightHandTargeting?.intersectionPoint).toBeDefined();
    expect(rightHandTargeting?.intersectionPoint?.length).toBe(3);
    expect(rightHandTargeting?.surfaceNormal).toBeDefined();
    expect(rightHandTargeting?.surfaceNormal?.length).toBe(3);

    await runner.destroy();
  });

  it('should capture Set-of-Mark visual screenshot overlays and plaintext visible objects list', async () => {
    const sensors = new Sensors();
    
    // Spawn our custom test object (completely bypasses troika-three-text SDF generation errors)
    const button = new TestObjectScript();

    const runner = await TestRunner.create({
      scripts: [sensors, button],
    });

    // Manually position the camera at eye level and align it with the box to ensure it is in the view frustum
    runner.camera.aspect = 1.0;
    runner.camera.position.set(0, 1.6, 0);
    runner.camera.lookAt(0, 1.6, -1);
    runner.camera.updateMatrixWorld(true);
    runner.camera.matrixWorldInverse.copy(runner.camera.matrixWorld).invert();

    // Trigger frame tick so rendering completes
    await runner.actions.step({durationMs: 100});

    // Capture observation with Set-of-Mark visual badges and the plaintext subtitles map
    const obs = await sensors.captureObservation({
      includeScreenshot: true,
      annotateScreenshot: true,
      includeSemanticMap: true,
    });

    // 1. Verify screenshot is returned as a base64 Data URL (rendered by mock canvas)
    expect(obs.screenshot).toBeDefined();
    expect(typeof obs.screenshot).toBe('string');
    expect(obs.screenshot?.startsWith('annotated:data:image/png;base64,')).toBe(true);

    // 2. Verify plaintext screen-reader subtitles list (Rosetta Stone)
    expect(obs.visibleObjects).toBeDefined();
    expect(obs.visibleObjects?.length).toBeGreaterThan(0);

    const btnRef = obs.visibleObjects?.find((ref) => ref.type === 'TextButton' || ref.name?.includes('Trigger'));
    expect(btnRef).toBeDefined();
    expect(btnRef?.label).toBe('1'); // First visible item gets label "1"
    expect(btnRef?.distanceToCamera).toBeCloseTo(1.0, 1);
    expect(btnRef?.description).toContain("TextButton 'Trigger System'");

    await runner.destroy();
  });

  it('should capture a flat, LLM-friendly scene graph representation', async () => {
    const sensors = new Sensors();
    
    // Spawn a parent script with a nested child mesh
    const parent = new Script();
    parent.name = 'ParentContainer';
    parent.position.set(0, 1.6, -1);

    const child = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
    child.name = 'NestedBox';
    child.position.set(0, 0.5, 0); // local offset
    parent.add(child);

    const runner = await TestRunner.create({
      scripts: [sensors, parent],
    });

    // Capture scene graph observation
    const obs = await sensors.captureObservation({
      includeSceneGraph: true,
    });

    expect(obs.sceneGraph).toBeDefined();
    expect(obs.sceneGraph?.length).toBeGreaterThan(0);

    // Find serialized parent and child nodes in the flat list
    const parentNode = obs.sceneGraph?.find((n) => n.name === 'ParentContainer');
    const childNode = obs.sceneGraph?.find((n) => n.name === 'NestedBox');

    expect(parentNode).toBeDefined();
    expect(childNode).toBeDefined();

    // Verify transforms and parenting indices
    expect(parentNode?.type).toBe('Object3D'); // Scripts are Object3D in Three.js
    expect(childNode?.type).toBe('Mesh');
    
    expect(parentNode?.children).toContain(child.id);
    expect(childNode?.position).toBeDefined();
    expect(childNode?.boundingBox).toBeDefined();

    await runner.destroy();
  });

  it('should support real-time telemetry streaming and high-frequency history buffering', async () => {
    const sensors = new Sensors();
    const runner = await TestRunner.create({
      scripts: [sensors],
    });

    // Set up a streaming spy callback to receive per-frame records instantly
    const streamSpy = vi.fn();
    sensors.onFrameRecord = streamSpy;

    // Start recording trajectory history (60Hz / 16.67ms ticks)
    sensors.startRecording({
      recordHistory: true,
      includeUserTransforms: true,
      includeTargeting: true,
    });

    // Advance 5 frames (5 * 16.67ms = 83.35ms)
    await runner.actions.step({durationMs: 83.35});

    // Stop recording and retrieve buffer
    const history = sensors.stopRecording();

    // 1. Verify streaming callback was invoked on every frame tick (5 times)
    expect(streamSpy).toHaveBeenCalledTimes(5);

    // 2. Verify history buffer was populated with 5 synchronized frame records
    expect(history.length).toBe(5);
    
    const record = history[0];
    expect(record.timestamp).toBeGreaterThan(0);
    expect(record.state?.camera).toBeDefined();
    expect(record.targeting).toBeDefined();

    await runner.destroy();
  });
});
