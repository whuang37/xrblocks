import {describe, it, expect} from 'vitest';
import {TestRunner} from './TestRunner';
import * as THREE from 'three';
import {
  Script,
  type SelectEvent,
  TextButton,
  Options,
  core,
  HeuristicGestureRecognizer,
  WebXRHandPoseEstimator,
} from 'xrblocks';

class SimpleRotationScript extends Script {
  speed = 1.0;
  override update() {
    this.rotation.y += this.speed * 0.01;
  }
}

class HoverScript extends Script {
  isHovered = false;

  override onHoverEnter(_controller: THREE.Object3D) {
    this.isHovered = true;
  }

  override onHoverExit(_controller: THREE.Object3D) {
    this.isHovered = false;
  }
}

class GrabbableScript extends Script {
  grabbedByHand: number | null = null;

  override onObjectSelectStart(event: SelectEvent) {
    // Determine which controller triggered the selection
    const controller = event.target as unknown as {userData: {id: number}};
    const index = controller.userData.id;
    this.grabbedByHand = index;
    return true; // Mark as handled
  }

  override onObjectSelectEnd(_event: SelectEvent) {
    this.grabbedByHand = null;
    return true;
  }
}

class GameController extends Script {
  score = 0;
  spawnedItems = new Set<THREE.Object3D>();

  spawnItem() {
    const item = new THREE.Object3D();
    this.spawnedItems.add(item);
    this.add(item);
    this.score++;
  }
}

describe('TestRunner functional examples', () => {
  it('should run Example 1: State and Lifecycle Testing', async () => {
    const script = new SimpleRotationScript();
    const runner = await TestRunner.create({
      scripts: [script],
    });

    expect(script.rotation.y).toBe(0);

    // Step 1 frame (~16ms)
    await runner.step(16.67);
    expect(script.rotation.y).toBeGreaterThan(0);

    await runner.destroy();
  });

  it('should run Example 2: Raycasting & Hover Check', async () => {
    const hoverScript = new HoverScript();
    hoverScript.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5)));
    hoverScript.position.set(1, 0, -2); // 1m right, 2m in front of user

    const runner = await TestRunner.create({
      scripts: [hoverScript],
    });

    // Initially pointing down/away, not hovered
    await runner.step(100);
    expect(hoverScript.isHovered).toBe(false);

    // Point right hand (index 1) directly at the target object
    await runner.pointTo(1, hoverScript);
    await runner.step(100);

    expect(hoverScript.isHovered).toBe(true);

    await runner.destroy();
  });

  it('should run Example 3: Correct Hand & Grab Verification', async () => {
    const grabbable = new GrabbableScript();
    grabbable.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)));
    grabbable.position.set(0, 0, -1); // 1 meter in front of user

    const runner = await TestRunner.create({
      scripts: [grabbable],
    });

    // Point and pinch (grab) with the right hand (index 1)
    await runner.pointTo(1, grabbable);
    await runner.pinch(1, true);
    await runner.step(100);

    expect(grabbable.grabbedByHand).toBe(1);

    // Release pinch
    await runner.pinch(1, false);
    await runner.step(100);

    expect(grabbable.grabbedByHand).toBeNull();

    await runner.destroy();
  });

  it('should run Example 4: UI Button Clicking & Game Logic', async () => {
    const game = new GameController();

    // Create button that triggers spawning on game controller
    const button = new TextButton({
      text: 'Spawn Item',
    });
    button.onTriggered = () => {
      game.spawnItem();
    };
    button.position.set(0, 1.2, -1.2); // Positioned in front of camera

    const runner = await TestRunner.create({
      scripts: [game, button],
    });

    expect(game.score).toBe(0);

    // Point right hand (index 1) at button and click it
    await runner.pointTo(1, button);
    expect(game.score).toBe(0);
    await runner.click(1); // Click does pinch and release over time

    // Step virtual time to process click frames
    await runner.step(250);

    expect(game.score).toBe(1);
    expect(game.spawnedItems.size).toBe(1);

    await runner.destroy();
  });

  it('should run Example 5: End-to-End Heuristic Gesture Recognition', async () => {
    class TestGestureScript extends Script {
      pinchDetected = false;
      confidence = 0;

      private recognizer = new HeuristicGestureRecognizer();
      private estimator = new WebXRHandPoseEstimator(core.user);

      override update() {
        const context = this.estimator.getHandContext(1); // 1 is right hand
        if (!context) return;

        const scores = this.recognizer.recognize(context);
        const pinch = scores['pinch'];
        if (pinch) {
          this.pinchDetected = pinch.confidence > 0.6;
          this.confidence = pinch.confidence;
        } else {
          this.pinchDetected = false;
          this.confidence = 0;
        }
      }
    }

    const script = new TestGestureScript();
    const options = new Options();
    options.hands.enabled = true;

    const runner = await TestRunner.create({
      scripts: [script],
      options,
    });

    expect(script.pinchDetected).toBe(false);

    // Trigger a pinch using simulated embodied motions
    await runner.pinch(1, true);
    await runner.step(400); // Wait for the simulator hand to lerp and trigger the gesture

    // Expect the pinch to be detected by the gesture logger
    expect(script.pinchDetected).toBe(true);
    expect(script.confidence).toBeGreaterThan(0.6);

    // Release pinch
    await runner.pinch(1, false);
    await runner.step(250);

    expect(script.pinchDetected).toBe(false);

    await runner.destroy();
  });
});
