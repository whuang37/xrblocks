import * as THREE from 'three';
import * as xb from 'xrblocks';

// Indices for the canonical face mesh tesselation that ships with the
// MediaPipe FaceLandmarker model. We render a subset of triangles as line
// segments so the wireframe reads clearly without overwhelming the scene.
// These are the standard MediaPipe FACEMESH_TESSELATION index pairs for the
// face mesh perimeter + key feature contours (lips, eyes, eyebrows). Source:
// https://github.com/google-ai-edge/mediapipe-samples (face_landmarker)
const FACE_OVAL_PAIRS = [
  [10, 338],
  [338, 297],
  [297, 332],
  [332, 284],
  [284, 251],
  [251, 389],
  [389, 356],
  [356, 454],
  [454, 323],
  [323, 361],
  [361, 288],
  [288, 397],
  [397, 365],
  [365, 379],
  [379, 378],
  [378, 400],
  [400, 377],
  [377, 152],
  [152, 148],
  [148, 176],
  [176, 149],
  [149, 150],
  [150, 136],
  [136, 172],
  [172, 58],
  [58, 132],
  [132, 93],
  [93, 234],
  [234, 127],
  [127, 162],
  [162, 21],
  [21, 54],
  [54, 103],
  [103, 67],
  [67, 109],
  [109, 10],
];
const LIPS_OUTER = [
  [61, 146],
  [146, 91],
  [91, 181],
  [181, 84],
  [84, 17],
  [17, 314],
  [314, 405],
  [405, 321],
  [321, 375],
  [375, 291],
  [61, 185],
  [185, 40],
  [40, 39],
  [39, 37],
  [37, 0],
  [0, 267],
  [267, 269],
  [269, 270],
  [270, 409],
  [409, 291],
];
const LIPS_INNER = [
  [78, 95],
  [95, 88],
  [88, 178],
  [178, 87],
  [87, 14],
  [14, 317],
  [317, 402],
  [402, 318],
  [318, 324],
  [324, 308],
  [78, 191],
  [191, 80],
  [80, 81],
  [81, 82],
  [82, 13],
  [13, 312],
  [312, 311],
  [311, 310],
  [310, 415],
  [415, 308],
];
const LEFT_EYE = [
  [263, 249],
  [249, 390],
  [390, 373],
  [373, 374],
  [374, 380],
  [380, 381],
  [381, 382],
  [382, 362],
  [263, 466],
  [466, 388],
  [388, 387],
  [387, 386],
  [386, 385],
  [385, 384],
  [384, 398],
  [398, 362],
];
const RIGHT_EYE = [
  [33, 7],
  [7, 163],
  [163, 144],
  [144, 145],
  [145, 153],
  [153, 154],
  [154, 155],
  [155, 133],
  [33, 246],
  [246, 161],
  [161, 160],
  [160, 159],
  [159, 158],
  [158, 157],
  [157, 173],
  [173, 133],
];
const LEFT_EYEBROW = [
  [276, 283],
  [283, 282],
  [282, 295],
  [295, 285],
  [300, 293],
  [293, 334],
  [334, 296],
  [296, 336],
];
const RIGHT_EYEBROW = [
  [46, 53],
  [53, 52],
  [52, 65],
  [65, 55],
  [70, 63],
  [63, 105],
  [105, 66],
  [66, 107],
];

const ALL_EDGES = [
  ...FACE_OVAL_PAIRS,
  ...LIPS_OUTER,
  ...LIPS_INNER,
  ...LEFT_EYE,
  ...RIGHT_EYE,
  ...LEFT_EYEBROW,
  ...RIGHT_EYEBROW,
];

// Blendshapes to surface on the HUD. Picked for high-signal expressions
// that a user can easily trigger on camera and see respond. The full list
// is 52 entries; rendering all of them would be a wall of bars.
const FEATURED_BLENDSHAPES = [
  'jawOpen',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthPucker',
  'mouthFunnel',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'browInnerUp',
  'browDownLeft',
  'browDownRight',
  'cheekPuff',
  'tongueOut',
];

export class FaceMirror extends xb.Script {
  static dependencies = {
    camera: THREE.Camera,
    world: xb.World,
  };

  init({camera, world}) {
    this.camera = camera;
    this.world = world;
    this.detecting = false;
    this.framesSinceLastDetect = 0;
    // Throttle to roughly every other rendered frame so we don't peg the
    // GPU when the camera + MediaPipe + landmark-rendering loop costs
    // ~30 ms per pass on a desktop iGPU.
    this.detectEveryNFrames = 2;
    this.initWireframe();
    this.initStatusOverlay();
  }

  initWireframe() {
    // One Line3 geometry per edge: easier than a single LineSegments with
    // index updates because we mutate positions every frame.
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x4796e3,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    this.lineMaterial = lineMaterial;
    this.lineGeometries = ALL_EDGES.map(() => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(6), 3)
      );
      const line = new THREE.Line(geom, lineMaterial);
      line.frustumCulled = false;
      line.renderOrder = 5;
      this.add(line);
      return geom;
    });
    // Point cloud of all 478 landmarks for the "data density" feel.
    const pointGeom = new THREE.BufferGeometry();
    pointGeom.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(478 * 3), 3)
    );
    this.pointGeometry = pointGeom;
    this.pointCloud = new THREE.Points(
      pointGeom,
      new THREE.PointsMaterial({
        color: 0x9b5de5,
        size: 0.004,
        transparent: true,
        opacity: 0.6,
        depthTest: false,
      })
    );
    this.pointCloud.frustumCulled = false;
    this.pointCloud.renderOrder = 4;
    this.add(this.pointCloud);
  }

  initStatusOverlay() {
    // Plain HTML overlay (cheaper than the UICore card from the pose demo
    // and avoids pulling uiblocks just for a status line). Bottom-left so
    // it doesn't clip the webcam preview in the bottom-right.
    const div = document.createElement('div');
    div.id = 'face_mirror_status';
    div.style.cssText = `
      position: fixed; bottom: 12px; left: 12px; min-width: 240px;
      padding: 14px 18px; background: rgba(15, 18, 25, 0.85);
      color: #f0f0f0; font: 14px/1.5 system-ui, sans-serif;
      border-radius: 10px; border: 1px solid rgba(71, 150, 227, 0.4);
      z-index: 50; max-height: 60vh; overflow: hidden;
    `;
    div.innerHTML = `
      <div style="font-weight: 600; color: #00f0ff; margin-bottom: 6px;">
        FACE LANDMARKER
      </div>
      <div id="face_mirror_state" style="color: #a0aec0; margin-bottom: 10px;">
        Loading model...
      </div>
      <div id="face_mirror_bars"></div>
    `;
    document.body.appendChild(div);
    this.stateEl = div.querySelector('#face_mirror_state');
    this.barsEl = div.querySelector('#face_mirror_bars');
    this.barEls = new Map();
    for (const name of FEATURED_BLENDSHAPES) {
      const row = document.createElement('div');
      row.style.cssText =
        'display: flex; align-items: center; gap: 8px; margin: 2px 0;';
      const label = document.createElement('div');
      label.textContent = name;
      label.style.cssText = 'width: 130px; font-size: 12px; color: #ccc;';
      const track = document.createElement('div');
      track.style.cssText =
        'flex: 1; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;';
      const fill = document.createElement('div');
      fill.style.cssText =
        'height: 100%; background: linear-gradient(90deg, #4796e3, #9b5de5); width: 0%;';
      track.appendChild(fill);
      row.appendChild(label);
      row.appendChild(track);
      this.barsEl.appendChild(row);
      this.barEls.set(name, fill);
    }
  }

  update() {
    this.framesSinceLastDetect++;
    if (!this.world.faces || this.detecting) return;
    if (this.framesSinceLastDetect < this.detectEveryNFrames) return;
    this.framesSinceLastDetect = 0;
    this.detecting = true;
    this.world.faces
      .runDetection()
      .then((faces) => {
        this.detecting = false;
        this.displayFaces(faces);
      })
      .catch((err) => {
        this.detecting = false;
        if (this.stateEl) {
          this.stateEl.textContent =
            'Detection error: ' + (err.message || String(err));
        }
        console.error('Face detection failed:', err);
      });
  }

  displayFaces(faces) {
    if (!faces || faces.length === 0) {
      if (this.stateEl) {
        this.stateEl.textContent = 'No face detected. Look at the camera.';
      }
      this.setWireframeVisible(false);
      this.resetBars();
      return;
    }
    const face = faces[0];
    if (this.stateEl) {
      this.stateEl.textContent =
        `${face.landmarks.length} landmarks tracked` +
        (face.blendshapes.length
          ? ` | ${face.blendshapes.length} blendshapes`
          : '');
    }
    this.setWireframeVisible(true);
    this.updateWireframe(face);
    this.updateBars(face);
  }

  setWireframeVisible(v) {
    this.pointCloud.visible = v;
    for (const g of this.lineGeometries) {
      g.boundingSphere = null;
    }
    for (const child of this.children) {
      if (child instanceof THREE.Line) child.visible = v;
    }
  }

  updateWireframe(face) {
    const positions = this.pointGeometry.attributes.position.array;
    for (let i = 0; i < face.landmarks.length; i++) {
      const wp = face.landmarks[i].worldPosition;
      if (!wp) continue;
      positions[i * 3] = wp.x;
      positions[i * 3 + 1] = wp.y;
      positions[i * 3 + 2] = wp.z;
    }
    this.pointGeometry.attributes.position.needsUpdate = true;
    for (let e = 0; e < ALL_EDGES.length; e++) {
      const [a, b] = ALL_EDGES[e];
      const wa = face.landmarks[a]?.worldPosition;
      const wb = face.landmarks[b]?.worldPosition;
      if (!wa || !wb) continue;
      const arr = this.lineGeometries[e].attributes.position.array;
      arr[0] = wa.x;
      arr[1] = wa.y;
      arr[2] = wa.z;
      arr[3] = wb.x;
      arr[4] = wb.y;
      arr[5] = wb.z;
      this.lineGeometries[e].attributes.position.needsUpdate = true;
    }
  }

  updateBars(face) {
    for (const name of FEATURED_BLENDSHAPES) {
      const v = face.getBlendshape(name);
      const fill = this.barEls.get(name);
      if (fill) fill.style.width = (v * 100).toFixed(0) + '%';
    }
  }

  resetBars() {
    for (const fill of this.barEls.values()) {
      fill.style.width = '0%';
    }
  }
}
