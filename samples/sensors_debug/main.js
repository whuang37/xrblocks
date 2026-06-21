import 'xrblocks/addons/simulator/SimulatorAddons.js';

import * as THREE from 'three';
import * as xb from 'xrblocks';
import {
  SensorsManager,
  ProprioceptionSensor,
  SceneGraphSensor,
  TargetingSensor,
  DepthSensor,
  ScreenshotSOMSensor,
  SemanticMapSensor,
} from 'xrblocks/addons/sensors/index.js';

// 1. Configure the engine options
const options = new xb.Options();
options.formFactor = 'desktop';
options.xrButton.enabled = false;
options.enableHands();
options.enableCamera();

// Enable direct 3D visual hand rendering in the simulator/WebGL view
options.hands.visualization = true;
options.hands.visualizeJoints = true;
options.hands.visualizeMeshes = true;

// Enable core environmental depth mapping
options.depth = new xb.DepthOptions();
options.depth.enabled = true;
options.depth.depthMesh.enabled = true;
options.depth.depthTexture.enabled = true;
options.setAppTitle('Sensors Debugger');

// 2. Create the floating debugger sidebar panel in the DOM
function createDebuggerSidebar() {
  const style = document.createElement('style');
  style.textContent = `
    #sensors-debugger-sidebar {
      position: fixed;
      top: 12px;
      right: 12px;
      width: 380px;
      max-height: calc(100vh - 24px);
      overflow-y: auto;
      padding: 16px;
      border-radius: 12px;
      background: rgba(10, 12, 16, 0.88);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #f0f0f0;
      font-family: 'Google Sans', 'Segoe UI', Roboto, Arial, sans-serif;
      font-size: 13px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
      z-index: 9999;
      box-sizing: border-box;
    }
    #sensors-debugger-sidebar h1 {
      margin: 0 0 12px;
      font-size: 18px;
      font-weight: 700;
      color: #fff;
      border-bottom: 1px solid rgba(255, 255, 255, 0.15);
      padding-bottom: 8px;
    }
    #sensors-debugger-sidebar section {
      margin-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 12px;
    }
    #sensors-debugger-sidebar h2 {
      margin: 0 0 8px;
      color: #ff0055;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .preview-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .preview-box {
      width: 100%;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: center;
      box-sizing: border-box;
    }
    .preview-box img {
      width: 100%;
      height: auto;
      display: block;
    }
    .preview-box canvas {
      width: 100%;
      height: 180px;
      display: block;
      background: #000;
    }
    .subtitles-list {
      max-height: 150px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 11px;
      background: rgba(0, 0, 0, 0.25);
      padding: 8px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .subtitles-list div {
      margin-bottom: 4px;
      color: #a0ffb0;
    }
    .telemetry-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
      font-family: monospace;
      font-size: 11px;
    }
    .telemetry-item {
      background: rgba(255, 255, 255, 0.03);
      padding: 6px 8px;
      border-radius: 4px;
      border-left: 3px solid #69d2e7;
    }
    .telemetry-item span {
      color: #ffc857;
      font-weight: bold;
    }
  `;
  document.head.appendChild(style);

  const sidebar = document.createElement('aside');
  sidebar.id = 'sensors-debugger-sidebar';
  sidebar.innerHTML = `
    <h1>Sensors Debugger</h1>
    
    <section>
      <h2>Set-of-Mark Viewport (Screenshot)</h2>
      <div class="preview-container">
        <div class="preview-box">
          <img id="som-image" alt="Waiting for screenshot..." src="" />
        </div>
      </div>
    </section>

    <section>
      <h2>Environmental Depth Heatmap</h2>
      <div class="preview-container">
        <div class="preview-box">
          <canvas id="depth-canvas" width="320" height="180"></canvas>
        </div>
      </div>
    </section>

    <section>
      <h2>Plaintext Subtitles (SOM Index)</h2>
      <div id="subtitles-container" class="subtitles-list">
        <div>Loading visible entities...</div>
      </div>
    </section>

    <section>
      <h2>Skeletal Proprioception</h2>
      <div class="telemetry-grid">
        <div class="telemetry-item" id="tel-head">Head Position: <span>-</span></div>
        <div class="telemetry-item" id="tel-lhand">Left Hand: <span>-</span></div>
        <div class="telemetry-item" id="tel-rhand">Right Hand: <span>-</span></div>
      </div>
    </section>

    <section>
      <h2>Targeting & Pointer Normals</h2>
      <div class="telemetry-grid">
        <div class="telemetry-item" id="target-left">Left Ray: <span>-</span></div>
        <div class="telemetry-item" id="target-right">Right Ray: <span>-</span></div>
        <div class="telemetry-item" id="target-gaze">Gaze Ray: <span>-</span></div>
      </div>
    </section>
  `;
  document.body.appendChild(sidebar);
  return sidebar;
}

// 3. Define the main prototyping scene containing testable entities
class PrototypingScene extends xb.Script {
  init() {
    // Basic room lights
    this.add(new THREE.HemisphereLight(0xffffff, 0x606060, 3.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(1.5, 3.0, 1.5);
    this.add(keyLight);

    // Ground plane (so the depth sensing has a flat floor to collide with)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial({color: 0x222428, roughness: 0.8})
    );
    floor.name = 'Environment Floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    this.add(floor);

    // A colorful green Torus
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.05, 12, 48),
      new THREE.MeshStandardMaterial({
        color: 0x2ecc71,
        roughness: 0.3,
        metalness: 0.1,
      })
    );
    torus.name = 'Green Torus';
    torus.position.set(-0.5, 1.35, -1.2);
    torus.draggable = true;
    torus.draggingMode = xb.DragMode.TRANSLATING;
    this.add(torus);

    // A colorful orange Box
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0xe67e22,
        roughness: 0.5,
        metalness: 0.2,
      })
    );
    box.name = 'Orange Box';
    box.position.set(0, 1.35, -1.2);
    box.draggable = true;
    box.draggingMode = xb.DragMode.TRANSLATING;
    this.add(box);

    // A colorful blue Sphere
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0x3498db,
        roughness: 0.4,
        metalness: 0.1,
      })
    );
    sphere.name = 'Blue Sphere';
    sphere.position.set(0.5, 1.35, -1.2);
    sphere.draggable = true;
    sphere.draggingMode = xb.DragMode.TRANSLATING;
    this.add(sphere);
  }
}

// 4. Implement a custom script to tick, capture, and render sensor observations
class DebuggerScript extends xb.Script {
  static dependencies = {
    sensors: SensorsManager,
  };

  sensors = null;
  lastCaptureTime = 0;

  init(dependencies) {
    this.sensors = dependencies.sensors;
  }

  update(time) {
    // Throttle capture to 100ms (10Hz) to keep DOM updates extremely smooth
    if (time - this.lastCaptureTime < 100) return;
    this.lastCaptureTime = time;

    this.updateDebuggerUI();
  }

  async updateDebuggerUI() {
    try {
      // Capture the full, high-fidelity observation from all telemetry streams by reference
      const [
        state,
        sceneGraph,
        targeting,
        depth,
        screenshotSOM,
        visibleObjects,
      ] = await this.sensors.capture([
        ProprioceptionSensor,
        SceneGraphSensor,
        TargetingSensor,
        DepthSensor,
        ScreenshotSOMSensor,
        SemanticMapSensor,
      ]);

      // 1. Update Set-of-Mark annotated screenshot
      const somImg = document.getElementById('som-image');
      if (somImg && screenshotSOM) {
        somImg.src = screenshotSOM;
      }

      // 2. Render environmental depth heatmap on canvas
      const depthCanvas = document.getElementById('depth-canvas');
      if (depthCanvas && depth) {
        this.drawDepthHeatmap(depthCanvas, depth);
      }

      // 3. Update plaintext visible objects (Set-of-Mark index subtitles)
      const subContainer = document.getElementById('subtitles-container');
      if (subContainer) {
        if (visibleObjects && visibleObjects.length > 0) {
          subContainer.innerHTML = visibleObjects
            .map((ref) => `<div>${ref.description}</div>`)
            .join('');
        } else {
          subContainer.innerHTML =
            '<div style="color: #888;">No unoccluded entities visible</div>';
        }
      }

      // 4. Update Proprioception coordinates
      if (state) {
        const head = state.camera;
        const left = state.leftHand;
        const right = state.rightHand;

        const q = new THREE.Quaternion(...head.quaternion);
        const euler = new THREE.Euler().setFromQuaternion(q);
        const degX = ((euler.x * 180) / Math.PI).toFixed(1);
        const degY = ((euler.y * 180) / Math.PI).toFixed(1);
        const degZ = ((euler.z * 180) / Math.PI).toFixed(1);

        document.getElementById('tel-head').innerHTML =
          `Head Pos: <span>[${head.position.map((n) => n.toFixed(2)).join(', ')}]</span><br/>` +
          `Head Rot: <span>[P: ${degX}°, Y: ${degY}°, R: ${degZ}°]</span>`;

        document.getElementById('tel-lhand').innerHTML =
          `Left Hand: <span>[${left.position.map((n) => n.toFixed(2)).join(', ')}]</span> | Vis: <span>${left.visible}</span> | Pinch: <span>${left.selected}</span>`;

        document.getElementById('tel-rhand').innerHTML =
          `Right Hand: <span>[${right.position.map((n) => n.toFixed(2)).join(', ')}]</span> | Vis: <span>${right.visible}</span> | Pinch: <span>${right.selected}</span>`;
      }

      // 5. Update Pointer Targeting intersections and normals
      if (targeting) {
        const getTargetString = (target) => {
          if (!target) return 'Inactive';
          if (target.hoveredObjectId === null) return 'No intersection';
          return `Hit Obj ID: <span>${target.hoveredObjectId}</span> | Dist: <span>${target.distanceToHoveredObject?.toFixed(2)}m</span><br/>Pos: <span>[${target.intersectionPoint?.map((n) => n.toFixed(2)).join(', ')}]</span><br/>Normal: <span>[${target.surfaceNormal?.map((n) => n.toFixed(2)).join(', ')}]</span>`;
        };

        document.getElementById('target-left').innerHTML =
          `Left: ${getTargetString(targeting.leftHand)}`;
        document.getElementById('target-right').innerHTML =
          `Right: ${getTargetString(targeting.rightHand)}`;
        document.getElementById('target-gaze').innerHTML =
          `Gaze: ${getTargetString(targeting.gaze)}`;
      }
    } catch (e) {
      console.error('Sensor Debugger Capture Error:', e);
    }
  }

  /** Draws depth grid on a 2D canvas using a smooth blue-to-red color heatmap */
  drawDepthHeatmap(canvas, depthGrid) {
    const ctx = canvas.getContext('2d');
    const rows = depthGrid.length;
    const cols = depthGrid[0]?.length || 0;
    if (!rows || !cols) return;

    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const distance = depthGrid[y][x];

        // Map distance in meters (0m to 4m) to a normalized value [0, 1]
        const t = Math.min(distance / 4.0, 1.0);

        // Compute blue (close) to red (far) color ramp
        const r = Math.round(t * 255);
        const g = Math.round((1 - Math.abs(t - 0.5) * 2) * 255);
        const b = Math.round((1 - t) * 255);

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
      }
    }
  }
}

// 5. Start and initialize the engine
async function start() {
  createDebuggerSidebar();

  const sensors = new SensorsManager([
    ProprioceptionSensor,
    SceneGraphSensor,
    TargetingSensor,
    DepthSensor,
    ScreenshotSOMSensor,
    SemanticMapSensor,
  ]);

  // Register the sensors instance in the dependency injection container
  // so that DebuggerScript can successfully inject it!
  xb.core.registry.register(sensors);

  // Register the debugging and scenario scripts
  xb.add(new PrototypingScene());
  xb.add(new xb.DragManager());
  xb.add(sensors);
  xb.add(new DebuggerScript());

  await xb.init(options);

  // Pre-activate both left and right simulated hands
  if (xb.core.simulator) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    xb.core.simulator.hands.leftController.visible = true;
    xb.core.simulator.hands.rightController.visible = true;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  start();
});
