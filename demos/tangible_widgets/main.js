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
  constructor(widgetId, tracker) {
    super();
    this.widgetId = widgetId;
    this.tracker = tracker;
    this.page = 0;
    this.remaining = 180;
    this.running = false;
    this.lastTime = 0;
    this.lastDisplay = '';
    this.panel = card(0.27, widgetId === 'reading' ? 0.31 : 0.25);
    // In front of the registered visible patch, including on a curved object.
    this.panel.position.z = 0.025;
    this.add(this.panel);
    this.panel.add(
      text(
        widgetId === 'reading'
          ? 'READING COMPANION'
          : widgetId === 'timer'
            ? 'TEA TIMER'
            : 'TILT CONTROL',
        18,
        ACCENT
      )
    );
    this.body = text('', 17);
    this.panel.add(this.body);
    if (widgetId === 'reading') {
      this.body.text = pages[0];
      this.panel.add(
        button('Next page', () => {
          this.page = (this.page + 1) % pages.length;
          this.body.text = pages[this.page];
        })
      );
    } else if (widgetId === 'timer') {
      this.body.text = '03:00\n\nA timer attached to this surface.';
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
        'Tilt the object to move the dot.\nUse Neutral tilt to set its centre.';
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
    if (this.widgetId === 'timer') {
      if (this.running) this.remaining = Math.max(0, this.remaining - elapsed);
      if (!this.remaining) this.running = false;
      const seconds = Math.ceil(this.remaining);
      const value = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}\n\n${seconds ? 'A timer attached to this surface.' : 'Your tea is ready.'}`;
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
    this.previewCanvas = document.createElement('canvas');
    this.previewTexture = new THREE.CanvasTexture(this.previewCanvas);
    this.previewTexture.colorSpace = THREE.SRGBColorSpace;
    this.lastPreview = -Infinity;
    this.widgetIds = ['reading', 'timer', 'tilt'];
    this.selection = 0;
    this.registrationImage = null;
    this.labelWorker = null;
    this.labelTimeout = null;
    this.labelStatus = 'Object label: available after registration';
    this.labelAttempted = false;
    this.pixelStats = 'Waiting for camera pixels';
    this.tracker = new TangibleWidgets({
      onCameraFrame: (image, region) => {
        // Preserve only registration input, before the addon's transfer.
        if (this.tracker.state === 'registering') {
          this.registrationImage = {
            pixels: image.data.slice().buffer,
            width: image.width,
            height: image.height,
          };
        }
        if (performance.now() - this.lastPreview < 250) return;
        this.lastPreview = performance.now();
        if (
          this.previewCanvas.width !== image.width ||
          this.previewCanvas.height !== image.height
        ) {
          // GPU texture storage cannot change size after its first upload.
          this.previewTexture.dispose();
          this.previewCanvas.width = image.width;
          this.previewCanvas.height = image.height;
          this.previewTexture = new THREE.CanvasTexture(this.previewCanvas);
          this.previewTexture.colorSpace = THREE.SRGBColorSpace;
          this.preview.material.map = this.previewTexture;
        }
        const context = this.previewCanvas.getContext('2d');
        context.putImageData(image, 0, 0);
        context.strokeStyle = ACCENT;
        context.lineWidth = 3;
        context.strokeRect(
          region.u * image.width,
          region.v * image.height,
          region.width * image.width,
          region.height * image.height
        );
        this.previewTexture.needsUpdate = true;
        this.preview.scale.y = image.height / image.width;
        this.preview.visible = true;
        let min = 255,
          max = 0,
          sum = 0,
          count = 0;
        // Sample the input before its buffer is transferred to the worker.
        for (let i = 0; i < image.data.length; i += 256) {
          const value =
            (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3;
          min = Math.min(min, value);
          max = Math.max(max, value);
          sum += value;
          count++;
        }
        this.pixelStats = `${image.width}×${image.height}: brightness ${Math.round(min)}–${Math.round(max)}, mean ${Math.round(sum / count)} / 255`;
      },
      widgets: Object.fromEntries(
        this.widgetIds.map((id) => [
          id,
          {create: () => new ObjectWidget(id, this.tracker)},
        ])
      ),
    });
    this.preview = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.48),
      new THREE.MeshBasicMaterial({map: this.previewTexture, toneMapped: false})
    );
    this.preview.position.set(-0.42, 1.4, -1.05);
    this.preview.name = 'TrackingCameraPreview';
    this.preview.visible = false;
    this.add(this.tracker, this.preview);
    this.lastDashboard = 0;
  }
  init() {
    const panel = card(0.57, 1.08);
    panel.name = 'ObjectWidgetsDashboard';
    panel.position.set(0.44, 1.45, -1.05);
    panel.add(text('OBJECT WIDGETS', 25, ACCENT));
    panel.add(
      text(
        'Fill the green box with a textured surface.\nChoose a widget, then press Register.\nMove and tilt the object after attachment.',
        19
      )
    );
    panel.add(
      text(
        'Keep the box on one rigid surface, roughly 0.4–1.2 m away. Curved surfaces work too.',
        16,
        MUTED
      )
    );
    this.statusText = text('Loading OpenCV…', 18);
    this.diagnosticText = text(' ', 14, MUTED);
    panel.add(this.statusText, this.diagnosticText);
    this.choiceText = text('Widget: reading', 18, ACCENT);
    this.labelText = text(this.labelStatus, 15, MUTED);
    panel.add(this.choiceText, this.labelText);
    panel.add(
      button('Change widget', () => {
        this.selection = (this.selection + 1) % this.widgetIds.length;
        this.choiceText.text = `Widget: ${this.widgetIds[this.selection]}`;
      })
    );
    panel.add(
      button('Register centre patch', () => {
        if (!this.tracker.register(this.widgetIds[this.selection])) return;
        this.stopLabelWorker();
        this.registrationImage = null;
        this.labelAttempted = false;
        this.labelStatus = 'Object label: waiting for registration';
      })
    );
    panel.add(
      button('Clear attachment', () => {
        this.tracker.reset();
        this.stopLabelWorker();
        this.registrationImage = null;
        this.labelStatus = 'Object label: available after registration';
      })
    );
    panel.add(button('Neutral tilt', () => this.tracker.recenter()));
    panel.add(
      text(
        'On Android XR, enter AR and allow camera + depth. Depth sets the initial scale; image features track motion.',
        15,
        MUTED
      )
    );
    this.add(panel);
  }
  stopLabelWorker() {
    clearTimeout(this.labelTimeout);
    this.labelTimeout = null;
    this.labelWorker?.terminate();
    this.labelWorker = null;
  }
  labelRegisteredObject() {
    this.labelAttempted = true;
    const image = this.registrationImage;
    this.registrationImage = null;
    if (!image) return;
    this.labelStatus = 'Object label: checking once…';
    // This optional demo worker never supplies data to the tracker.
    try {
      const worker = new Worker(new URL('./LabelWorker.js', import.meta.url));
      this.labelWorker = worker;
      const finish = (message) => {
        if (this.labelWorker !== worker) return;
        this.labelStatus = message;
        this.stopLabelWorker();
      };
      worker.onmessage = ({data}) =>
        finish(`Object label (estimate): ${data.label}`);
      worker.onerror = () =>
        finish('Object label unavailable; tracking continues.');
      this.labelTimeout = setTimeout(
        () => finish('Object label timed out; tracking continues.'),
        30000
      );
      worker.postMessage(image, [image.pixels]);
    } catch {
      this.labelStatus = 'Object label unavailable; tracking continues.';
      this.stopLabelWorker();
    }
  }
  onXRSessionEnded() {
    this.stopLabelWorker();
    this.registrationImage = null;
  }
  dispose() {
    this.stopLabelWorker();
    this.registrationImage = null;
    this.previewTexture.dispose();
    this.preview.geometry.dispose();
    this.preview.material.dispose();
  }
  update() {
    if (this.tracker.state === 'tracked' && !this.labelAttempted)
      this.labelRegisteredObject();
    if (!this.statusText || performance.now() - this.lastDashboard < 250)
      return;
    this.lastDashboard = performance.now();
    this.statusText.text = this.tracker.status;
    this.statusText.style.color =
      this.tracker.state === 'tracked' ? ACCENT : MUTED;
    this.labelText.text = this.labelStatus;
    const d = this.tracker.diagnostics;
    this.diagnosticText.text = `${this.tracker.state.toUpperCase()} · ${this.tracker.widgetId ?? 'no attachment'}
${d.imageFeatureCount} image / ${d.featureCount} depth / ${d.inliers} fit points
Capture ${d.captureMs.toFixed(0)} ms · depth index ${d.depthIndexMs.toFixed(0)} ms
Tracking worker ${d.processingMs.toFixed(0)} ms
Image age ${d.observationAgeMs.toFixed(0)} ms
Depth: registration only · fit ${d.reprojectionErrorPx.toFixed(1)} px
Camera timing: ${d.timing}
Pixels: ${this.pixelStats}
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
