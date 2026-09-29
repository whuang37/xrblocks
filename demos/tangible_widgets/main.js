import * as THREE from 'three';
import * as xb from 'xrblocks';
import {TangibleWidgets} from 'xrblocks/addons/tangible/index.js';

const INK = '#eef5ff';
const MUTED = '#9eafc7';
const ACCENT = '#79e0bf';
const pages = [
  'Small steps\n\nChoose one thing to read. Give it your full attention for five minutes.',
  'Make a note\n\nWhat is the one idea you want to remember from this page?',
  'Try it\n\nTurn that idea into one small action you can take today.',
];

function text(value, fontSize = 17, color = INK) {
  return new xb.UIText({
    text: value,
    style: {fontSize, color, width: '100%', flexShrink: 0},
  });
}
function button(label, onClick) {
  return new xb.UIButton({
    label,
    onClick,
    style: {
      height: 42,
      backgroundColor: '#294054',
      color: INK,
      borderRadius: 8,
      flexShrink: 0,
    },
  });
}
function card(width, height) {
  return new xb.UICard({
    size: {width, height},
    manipulation: false,
    style: {
      width: '100%',
      height: '100%',
      backgroundColor: '#142230',
      borderColor: '#3b596f',
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
      gap: 10,
      flexDirection: 'column',
      alignItems: 'stretch',
    },
  });
}

class ObjectWidget extends xb.Script {
  constructor(label, tracker) {
    super();
    this.label = label;
    this.tracker = tracker;
    this.page = 0;
    this.remaining = 180;
    this.running = false;
    this.lastTime = 0;
    this.lastDisplay = '';
    this.panel = card(0.27, label === 'book' ? 0.31 : 0.25);
    // In front of the registered visible patch, including on a curved object.
    this.panel.position.z = 0.025;
    this.add(this.panel);
    this.panel.add(
      text(
        label === 'book'
          ? 'READING COMPANION'
          : label === 'cup'
            ? 'TEA TIMER'
            : 'TILT CONTROL',
        18,
        ACCENT
      )
    );
    this.body = text('', 17);
    this.panel.add(this.body);
    if (label === 'book') {
      this.body.text = pages[0];
      this.panel.add(
        button('Next page', () => {
          this.page = (this.page + 1) % pages.length;
          this.body.text = pages[this.page];
        })
      );
    } else if (label === 'cup') {
      this.body.text = '03:00\n\nA timer attached to your cup.';
      this.toggle = button('Start / pause', () => {
        this.running = !this.running;
      });
      this.panel.add(
        this.toggle,
        button('Reset timer', () => {
          this.remaining = 180;
          this.running = false;
        })
      );
    } else {
      this.body.text =
        'Tilt the bottle to move the dot.\nUse Neutral tilt to set its centre.';
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, 0.08),
        new THREE.MeshBasicMaterial({color: '#09151f'})
      );
      board.position.set(0, -0.055, 0.03);
      this.dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.008, 24),
        new THREE.MeshBasicMaterial({color: ACCENT})
      );
      this.dot.position.z = 0.001;
      board.add(this.dot);
      this.add(board);
    }
  }
  update() {
    const now = performance.now();
    const elapsed = this.lastTime ? (now - this.lastTime) / 1000 : 0;
    this.lastTime = now;
    if (this.label === 'cup') {
      if (this.running) this.remaining = Math.max(0, this.remaining - elapsed);
      if (!this.remaining) this.running = false;
      const seconds = Math.ceil(this.remaining);
      const value = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}\n\n${seconds ? 'A timer attached to your cup.' : 'Your tea is ready.'}`;
      if (value !== this.lastDisplay) {
        this.body.text = value;
        this.lastDisplay = value;
      }
    }
    if (this.dot) {
      this.dot.position.x = this.tracker.tilt.x * 0.08;
      this.dot.position.y = -this.tracker.tilt.y * 0.028;
    }
  }
}

class ObjectWidgetsDemo extends xb.Script {
  constructor() {
    super();
    this.tracker = new TangibleWidgets({
      widgets: Object.fromEntries(
        ['book', 'cup', 'bottle'].map((label) => [
          label,
          {create: () => new ObjectWidget(label, this.tracker)},
        ])
      ),
    });
    this.add(this.tracker);
    this.lastDashboard = 0;
  }
  init() {
    const panel = card(0.52, 0.82);
    panel.name = 'ObjectWidgetsDashboard';
    panel.position.set(0.44, 1.45, -1.05);
    panel.add(text('OBJECT WIDGETS', 25, ACCENT));
    panel.add(
      text(
        'Show a book, cup, or bottle.\nHold it still to register. Then move it.',
        19
      )
    );
    panel.add(
      text(
        'Use a printed or textured surface, roughly 0.4–1.2 m away. No measurements or API key needed.',
        16,
        MUTED
      )
    );
    this.statusText = text('Loading local models…', 18);
    this.diagnosticText = text(' ', 14, MUTED);
    panel.add(this.statusText, this.diagnosticText);
    panel.add(button('Find / register again', () => this.tracker.reset()));
    panel.add(button('Neutral tilt', () => this.tracker.recenter()));
    panel.add(
      text(
        'On Android XR, enter AR and allow camera + depth. Missing depth pauses tracking.',
        15,
        MUTED
      )
    );
    this.add(panel);
  }
  update() {
    if (!this.statusText || performance.now() - this.lastDashboard < 250)
      return;
    this.lastDashboard = performance.now();
    this.statusText.text = this.tracker.status;
    this.statusText.style.color =
      this.tracker.state === 'tracked' ? ACCENT : MUTED;
    const d = this.tracker.diagnostics;
    this.diagnosticText.text = `${this.tracker.state.toUpperCase()} · sees ${d.detectedLabel}
${d.imageFeatureCount} image / ${d.featureCount} depth / ${d.inliers} fit points
Capture ${d.captureMs.toFixed(0)} ms · depth index ${d.depthIndexMs.toFixed(0)} ms
Worker ${d.processingMs.toFixed(0)} ms: detect ${d.recognitionMs.toFixed(0)} / flow ${d.opticalFlowMs.toFixed(0)}
Image age ${d.observationAgeMs.toFixed(0)} ms
Depth age ${Number.isFinite(d.depthAgeMs) ? d.depthAgeMs.toFixed(0) : '—'} ms · fit ${(d.residualMeters * 1000).toFixed(0)} mm
Camera timing: ${d.timing}
Last issue: ${d.lastFailure}`;
  }
}

const options = new xb.Options();
options.enableCamera('environment');
options.deviceCamera.willCaptureFrequently = true;
options.enableDepth();
// Do not invent depth at holes; tracking must reject missing samples.
options.depth.depthMesh.patchHoles = false;
options.depth.depthMesh.updateFullResolutionGeometry = true;
options.depth.depthMesh.depthMeshUpdateFps = 30;
options.enableReticles();
options.xrButton.showEnterSimulatorButton = true;
options.setAppTitle('Object widgets');
const demo = new ObjectWidgetsDemo();
xb.add(demo);
await xb.init(options);
// Inspect from the console when diagnosing camera alignment on a device.
if (new URLSearchParams(location.search).has('debug'))
  window.tangibleDemo = demo;
