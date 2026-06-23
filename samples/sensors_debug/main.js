import 'xrblocks/addons/simulator/SimulatorAddons.js';

import * as THREE from 'three';
import * as xb from 'xrblocks';
import * as uikit from '@pmndrs/uikit';
import {
  UICore,
  UIPanel,
  UIText,
  UIImage,
  UIIcon,
  BillboardBehavior,
  ManipulationBehavior,
  raycastSortFunction,
} from 'uiblocks';
import {
  sensors,
  ProprioceptionSensor,
  SceneGraphSensor,
  TargetingSensor,
  VisibilitySensor,
  DepthSensor,
  DeviceCameraViewSensor,
  UserViewSensor,
  SOMViewSensor,
} from 'xrblocks/addons/sensors/index.js';

// --- Safe Formatting Helpers ---

/** Gracefully formats any 3D vector representation (Array tuple, Vector3, or plain {x,y,z} object) */
function formatVec3(v) {
  if (!v) return '[-]';
  if (Array.isArray(v)) {
    return `[${v.map((n) => (typeof n === 'number' ? n.toFixed(3) : String(n))).join(', ')}]`;
  }
  if (typeof v === 'object') {
    const x = typeof v.x === 'number' ? v.x : 0;
    const y = typeof v.y === 'number' ? v.y : 0;
    const z = typeof v.z === 'number' ? v.z : 0;
    return `[${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}]`;
  }
  return String(v);
}

/** Safely extracts a THREE.Quaternion from any valid representation */
function toQuaternion(q) {
  if (!q) return new THREE.Quaternion();
  if (q instanceof THREE.Quaternion) return q;
  if (Array.isArray(q)) {
    return new THREE.Quaternion(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1);
  }
  if (typeof q === 'object') {
    return new THREE.Quaternion(q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 1);
  }
  return new THREE.Quaternion();
}

// 1. Configure the engine options for XR
const options = new xb.Options();
options.formFactor = 'auto'; // Detects XR device, supports ?formFactor=desktop simulator
options.xrButton.enabled = true; // Show standard Enter XR button
options.enableHands();
options.enableCamera();
options.enableUI();
options.uikit.enable(uikit);

// Enable core environmental depth mapping
options.depth = new xb.DepthOptions();
options.depth.enabled = true;
options.depth.depthMesh.enabled = true;
options.depth.depthTexture.enabled = true;
options.setAppTitle('Sensors Debugger');

// List of all sensors for the dropdown
const SENSOR_LIST = [
  {name: 'Proprioception', sensorClass: ProprioceptionSensor, type: 'text'},
  {name: 'Scene Graph', sensorClass: SceneGraphSensor, type: 'text'},
  {name: 'Targeting / Raycasts', sensorClass: TargetingSensor, type: 'text'},
  {name: 'Visibility', sensorClass: VisibilitySensor, type: 'text'},
  {name: 'Depth Heatmap', sensorClass: DepthSensor, type: 'depth'},
  {
    name: 'Device Camera View',
    sensorClass: DeviceCameraViewSensor,
    type: 'image',
  },
  {name: 'User View', sensorClass: UserViewSensor, type: 'image'},
  {name: 'SOM View', sensorClass: SOMViewSensor, type: 'image'},
];

// 2. Define the main prototyping scene containing testable entities (same as original)
class PrototypingScene extends xb.Script {
  init() {
    this.add(new THREE.HemisphereLight(0xffffff, 0x606060, 3.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(1.5, 3.0, 1.5);
    this.add(keyLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial({color: 0x222428, roughness: 0.8})
    );
    floor.name = 'Environment Floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    this.add(floor);

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

// 3. Custom Script to manage the spatial UI blocks panel and query the selected sensor
class DebuggerScript extends xb.Script {
  constructor() {
    super();
    this.uiCore = new UICore(this);
  }

  lastCaptureTime = 0;
  isCapturing = false;

  // Selected sensor tracking
  activeSensorIndex = 0;
  isDropdownExpanded = false;

  // Offscreen canvas for depth rendering
  depthCanvas = null;
  depthTexture = null;

  // UI Components references
  uiText = null;
  uiImage = null;
  dropdownText = null;
  dropdownArrow = null;
  optionsContainer = null;

  init() {
    // Set sort function for raycasting against uiblocks
    if (xb.core.input.raycaster) {
      xb.core.input.raycaster.sortFunction = raycastSortFunction;
    }

    // Setup offscreen canvas for depth heatmap
    this.depthCanvas = document.createElement('canvas');
    this.depthCanvas.width = 320;
    this.depthCanvas.height = 180;
    this.depthTexture = new THREE.CanvasTexture(this.depthCanvas);

    // Build the beautiful spatial UI card
    this.buildSpatialUI();
  }

  buildSpatialUI() {
    const card = this.uiCore.createCard({
      name: 'SensorsDebuggerCard',
      sizeX: 0.8,
      sizeY: 0.65,
      pixelSize: 0.0016, // crisp text at arm's length
      position: new THREE.Vector3(0, 1.5, -1.5), // Placed higher and further back to avoid shape occlusion
      alignItems: 'center',
      behaviors: [
        new BillboardBehavior({mode: 'cylindrical'}),
        new ManipulationBehavior({
          draggable: true,
          faceCamera: true,
          manipulationMargin: 20,
          manipulationCornerRadius: 24,
        }),
      ],
    });

    const root = new UIPanel({
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      fillColor: '#111318',
      cornerRadius: 24,
      padding: 24,
      gap: 12,
      strokeWidth: 1,
      strokeColor: '#2d313e',
      strokeAlign: 'inside',
      dropShadowColor: '#000000',
      dropShadowBlur: 20,
      dropShadowSpread: 1,
    });
    card.add(root);

    // Title Bar
    const titleBar = new UIPanel({
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    });
    titleBar.add(
      new UIIcon('sensors', {color: '#ff0055', width: 24, height: 24})
    );
    titleBar.add(
      new UIText('Sensors Debugger', {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#ffffff',
      })
    );
    root.add(titleBar);

    // Dropdown Container
    const dropdownContainer = new UIPanel({
      width: '100%',
      flexDirection: 'column',
      gap: 4,
      zIndex: 100, // Make sure dropdown options render on top of the output panel
    });
    root.add(dropdownContainer);

    // Dropdown Selector Button (Header)
    this.dropdownText = new UIText(SENSOR_LIST[this.activeSensorIndex].name, {
      fontSize: 14,
      fontWeight: 'bold',
      color: '#ffffff',
    });
    this.dropdownArrow = new UIIcon('keyboard_arrow_down', {
      color: '#ffffff',
      width: 20,
      height: 20,
    });

    const dropdownHeader = new UIPanel({
      width: '100%',
      height: 40,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingLeft: 16,
      paddingRight: 16,
      fillColor: '#1f232e',
      cornerRadius: 8,
      strokeWidth: 1,
      strokeColor: '#3a3f50',
      onClick: () => this.toggleDropdown(),
      onHoverEnter: () => dropdownHeader.setFillColor('#2c3242'),
      onHoverExit: () => dropdownHeader.setFillColor('#1f232e'),
    });
    dropdownHeader.add(this.dropdownText);
    dropdownHeader.add(this.dropdownArrow);
    dropdownContainer.add(dropdownHeader);

    // Dropdown Options List Container (hidden by default)
    this.optionsContainer = new UIPanel({
      width: '100%',
      flexDirection: 'column',
      fillColor: '#1a1d26',
      cornerRadius: 8,
      strokeWidth: 1,
      strokeColor: '#2e3342',
      display: 'none',
      padding: 4,
      gap: 2,
    });
    dropdownContainer.add(this.optionsContainer);

    // Add options to dropdown list
    SENSOR_LIST.forEach((item, index) => {
      const optionBtn = new UIPanel({
        width: '100%',
        height: 32,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 12,
        cornerRadius: 6,
        fillColor: '#00000000',
        onClick: () => this.selectSensor(index),
        onHoverEnter: () => optionBtn.setFillColor('#2c3242'),
        onHoverExit: () => optionBtn.setFillColor('#00000000'),
      });
      optionBtn.add(new UIText(item.name, {fontSize: 13, color: '#e0e0e0'}));
      this.optionsContainer.add(optionBtn);
    });

    // Output Display Box (Recessed area)
    const outputWrapper = new UIPanel({
      width: '100%',
      flexGrow: 1,
      fillColor: '#090b0e',
      cornerRadius: 12,
      padding: 16,
      strokeWidth: 1,
      strokeColor: '#1c1f26',
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    });
    root.add(outputWrapper);

    // Text Display Component
    this.uiText = new UIText('Loading sensor telemetry...', {
      fontSize: 12,
      color: '#d8f3dc',
      width: '100%',
      lineHeight: 1.4,
    });
    outputWrapper.add(this.uiText);

    // Image Display Component (hidden initially)
    // Pass undefined as first argument (src) and properties as second argument (style properties)
    this.uiImage = new UIImage(undefined, {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      display: 'none',
      borderRadius: 8,
    });
    outputWrapper.add(this.uiImage);

    // Initial load setup
    this.selectSensor(0);
  }

  toggleDropdown() {
    this.isDropdownExpanded = !this.isDropdownExpanded;
    this.optionsContainer.setProperties({
      display: this.isDropdownExpanded ? 'flex' : 'none',
    });
    this.dropdownArrow.setProperties({
      icon: this.isDropdownExpanded
        ? 'keyboard_arrow_up'
        : 'keyboard_arrow_down',
    });
  }

  selectSensor(index) {
    this.activeSensorIndex = index;
    this.dropdownText.setText(SENSOR_LIST[index].name);

    if (this.isDropdownExpanded) {
      this.toggleDropdown();
    }

    // Reset visual display elements
    const activeInfo = SENSOR_LIST[index];
    if (activeInfo.type === 'text') {
      this.uiText.setProperties({display: 'flex'});
      this.uiImage.setProperties({display: 'none'});
      this.uiText.setText(`Initializing capture for ${activeInfo.name}...`);
    } else {
      this.uiText.setProperties({display: 'none'});
      this.uiImage.setProperties({display: 'flex'});
      // Pass undefined to cleanly clear the texture without triggering browser load errors
      this.uiImage.setSrc(undefined);
    }
  }

  update(time) {
    // Throttle sensor captures to 300ms to maintain great performance in XR
    if (this.isCapturing || time - this.lastCaptureTime < 300) return;
    this.lastCaptureTime = time;

    this.captureActiveSensor();
  }

  async captureActiveSensor() {
    this.isCapturing = true;
    const sensorInfo = SENSOR_LIST[this.activeSensorIndex];
    try {
      // Perform dynamic single-sensor query
      const data = await sensors.capture(sensorInfo.sensorClass);

      if (this.activeSensorIndex !== SENSOR_LIST.indexOf(sensorInfo)) {
        // Selected sensor changed during the async capture, ignore result
        return;
      }

      if (sensorInfo.type === 'text') {
        let formattedText = '';
        switch (sensorInfo.sensorClass) {
          case ProprioceptionSensor:
            formattedText = this.formatProprioception(data);
            break;
          case SceneGraphSensor:
            formattedText = this.formatSceneGraph(data);
            break;
          case TargetingSensor:
            formattedText = this.formatTargeting(data);
            break;
          case VisibilitySensor:
            formattedText = this.formatVisibility(data);
            break;
          default:
            formattedText = JSON.stringify(data, null, 2);
        }
        this.uiText.setText(formattedText);
      } else if (sensorInfo.type === 'depth') {
        if (data) {
          this.drawDepthHeatmap(data);
          this.depthTexture.needsUpdate = true;
          this.uiImage.setSrc(this.depthTexture);
        }
      } else if (sensorInfo.type === 'image') {
        if (data) {
          this.uiImage.setSrc(data);
        } else {
          this.uiImage.setSrc(undefined);
        }
      }
    } catch (e) {
      console.error(`Sensor Debugger Capture Error (${sensorInfo.name}):`, e);
      if (sensorInfo.type === 'text') {
        this.uiText.setText(
          `Capture Error:\n${e instanceof Error ? e.message : String(e)}`
        );
      }
    } finally {
      this.isCapturing = false;
    }
  }

  formatProprioception(state) {
    if (!state) return 'No proprioception data available.';
    const head = state.camera;
    const left = state.leftHand;
    const right = state.rightHand;

    const q = toQuaternion(head.quaternion);
    const euler = new THREE.Euler().setFromQuaternion(q);
    const rotDeg = [euler.x, euler.y, euler.z].map((r) =>
      ((r * 180) / Math.PI).toFixed(1)
    );

    return [
      `[Head Position]`,
      `Pos: ${formatVec3(head.position)}`,
      `Rot: [Pitch: ${rotDeg[0]}°, Yaw: ${rotDeg[1]}°, Roll: ${rotDeg[2]}°]`,
      ``,
      `[Left Hand]`,
      `Pos: ${formatVec3(left.position)}`,
      `Visible: ${left.visible}  |  Pinching: ${left.selected}`,
      ``,
      `[Right Hand]`,
      `Pos: ${formatVec3(right.position)}`,
      `Visible: ${right.visible}  |  Pinching: ${right.selected}`,
    ].join('\n');
  }

  formatSceneGraph(graph) {
    if (!graph || !Array.isArray(graph) || graph.length === 0) {
      return 'No scene graph data.';
    }

    // Build map of ID -> Node for fast O(1) resolution
    const nodeMap = new Map(graph.map((node) => [node.id, node]));
    const childIds = new Set(graph.flatMap((node) => node.children || []));
    // Root nodes are those not referenced as children of any other node
    const roots = graph.filter((node) => !childIds.has(node.id));

    const formatNode = (node, depth = 0) => {
      const indent = '  '.repeat(depth);
      let line = `${indent}• [${node.type}] ${node.name || 'unnamed'}`;
      if (node.position) {
        line += ` (pos: ${formatVec3(node.position)})`;
      }
      let lines = [line];
      if (node.children && node.children.length > 0) {
        if (depth < 3) {
          node.children.forEach((childId) => {
            const childNode = nodeMap.get(childId);
            if (childNode) {
              lines = lines.concat(formatNode(childNode, depth + 1));
            }
          });
        } else {
          lines.push(`${indent}  ... (max depth)`);
        }
      }
      return lines;
    };

    // Format all roots, falling back to first node if roots list is empty
    const targetRoots = roots.length > 0 ? roots : [graph[0]];
    const lines = targetRoots
      .filter((root) => root !== undefined)
      .flatMap((root) => formatNode(root, 0));
    return lines.slice(0, 32).join('\n');
  }

  formatTargeting(targeting) {
    if (!targeting) return 'No targeting data available.';

    const formatRay = (handName, target) => {
      if (!target) return `${handName} Ray: Inactive`;
      if (target.hoveredObjectId === null) {
        return `${handName} Ray:\n  - No intersection\n  - Colliding: ${target.collidingObjectId !== null ? target.collidingObjectId : 'None'}`;
      }
      return [
        `${handName} Ray:`,
        `  - Hover Obj ID: ${target.hoveredObjectId}`,
        `  - Distance: ${target.distanceToHoveredObject.toFixed(2)}m`,
        `  - Hit Pos: ${formatVec3(target.intersectionPoint)}`,
        `  - Normal: ${formatVec3(target.surfaceNormal)}`,
        `  - Colliding: ${target.collidingObjectId !== null ? target.collidingObjectId : 'None'}`,
      ].join('\n');
    };

    return [
      formatRay('Left Hand', targeting.leftHand),
      ``,
      formatRay('Right Hand', targeting.rightHand),
    ].join('\n');
  }

  formatVisibility(visibleObjects) {
    if (!visibleObjects || visibleObjects.length === 0) {
      return 'No visible labeled entities.';
    }
    return [
      `[Visible Entities in Viewport]`,
      ...visibleObjects.map(
        (obj) =>
          `• ${obj.label}: ${obj.name || obj.type || 'unnamed'} [ID ${obj.objectId}]\n  ${obj.description}`
      ),
    ].join('\n');
  }

  drawDepthHeatmap(depthGrid) {
    const canvas = this.depthCanvas;
    const ctx = canvas.getContext('2d');
    const rows = depthGrid.length;
    const cols = depthGrid[0]?.length || 0;
    if (!rows || !cols) return;

    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

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

// 4. Start and initialize the engine
async function start() {
  // Register scripts
  xb.add(new PrototypingScene());
  xb.add(new xb.DragManager());
  xb.add(new DebuggerScript());

  await xb.init(options);

  // Pre-activate both left and right simulated hands when running in the simulator
  if (xb.core.simulator) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    xb.core.simulator.hands.leftController.visible = true;
    xb.core.simulator.hands.rightController.visible = true;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  start();
});
