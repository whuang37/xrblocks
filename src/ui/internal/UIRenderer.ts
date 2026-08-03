import * as THREE from 'three';

import {UI_OVERLAY_LAYER} from '../../constants';
import type {Interaction} from '../../interaction/Interaction';
import {getSemanticControl} from '../../interaction/SemanticControl';
import {ui} from '../UI';
import {
  collectUIRoots,
  getUIElementKind,
  getUIRevision,
  type UIElement,
} from '../UIElement';
import type {
  UIBackend,
  UIBackendModule,
  UIHitMapping,
  UIMount,
} from './UIBackend';

interface MountRecord {
  readonly root: UIElement;
  readonly mount: UIMount;
  rootRevision: number;
  unregisterHits: (() => void)[];
  visible: boolean;
  connected: boolean;
  needsSync: boolean;
  order: number;
}

export type UIBackendLoader = () => Promise<UIBackendModule>;

const WARNED_OVERLAY_TRANSFORMS = new WeakSet<UIElement>();
const IDENTITY_MATRIX = new THREE.Matrix4();
const OVERLAY_FORWARD = new THREE.Vector3();
const STALE_UI_LOAD = new Error('Stale UI backend load.');

/** Owns all private UI rendering state for one Core lifecycle. */
export class UIRenderer {
  private readonly privateRoot = new THREE.Group();
  private readonly mounts = new Map<UIElement, MountRecord>();
  private readonly roots: UIElement[] = [];
  private readonly connectedRoots = new Set<UIElement>();
  private readonly viewport = {width: 0, height: 0};
  private backend?: UIBackend;
  private loadPromise?: Promise<UIBackend>;
  private failed = false;
  private readonly failedRoots = new Set<UIElement>();
  private initialized = false;
  private renderer?: THREE.WebGLRenderer;
  private publicScene?: THREE.Scene;
  private themeRevision = -1;
  private connectedOverlayCount = 0;
  private generation = 0;

  constructor(
    private readonly interaction: Interaction,
    private readonly loader: UIBackendLoader = defaultLoader,
    private readonly reportError?: (error: unknown, root: UIElement) => void
  ) {
    this.privateRoot.name = 'XR Blocks private UI';
    this.privateRoot.userData.xrblocksPrivate = true;
  }

  /** Mounts UI roots already connected when Core initializes. */
  async initialize(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer
  ): Promise<void> {
    this.generation++;
    this.publicScene = scene;
    this.renderer = renderer;
    this.initialized = true;
    scene.add(this.privateRoot);
    const roots = this.collectConnectedRoots();
    if (roots.length === 0) return;
    let backend: UIBackend;
    try {
      backend = await this.loadBackend();
    } catch (cause) {
      if (cause === STALE_UI_LOAD) return;
      this.backend?.dispose();
      this.backend = undefined;
      this.privateRoot.removeFromParent();
      this.loadPromise = undefined;
      this.initialized = false;
      this.publicScene = undefined;
      this.renderer = undefined;
      throw new Error(
        'XR Blocks could not load the UI renderer during initialization.',
        {cause}
      );
    }
    for (let order = 0; order < roots.length; order++) {
      this.mount(roots[order], backend, order);
    }
  }

  /** Reconciles public UI and updates current hit geometry. */
  reconcile(deltaSeconds: number, camera: THREE.Camera): void {
    if (!this.initialized) return;
    const roots = this.collectConnectedRoots();
    this.connectedRoots.clear();
    for (const root of roots) this.connectedRoots.add(root);
    for (const root of this.failedRoots) {
      if (!this.connectedRoots.has(root)) this.failedRoots.delete(root);
    }
    for (const root of this.mounts.keys()) {
      if (!this.connectedRoots.has(root)) this.disconnect(root);
    }
    for (let order = 0; order < roots.length; order++) {
      const root = roots[order];
      const record = this.mounts.get(root);
      if (record && !record.connected) {
        record.connected = true;
        record.needsSync = true;
        if (getUIElementKind(root) === 'overlay') {
          this.connectedOverlayCount++;
        }
      }
      if (record && record.order !== order) {
        record.order = order;
        record.needsSync = true;
      }
    }
    if (roots.length === 0) return;

    if (this.failed && roots.some((root) => !this.failedRoots.has(root))) {
      this.failed = false;
      this.loadPromise = undefined;
    }

    const backend = this.backend;
    if (!backend && !this.failed) {
      const loadingRoots = [...roots];
      void this.loadBackend().catch((error) => {
        if (error === STALE_UI_LOAD) return;
        this.failed = true;
        for (const root of loadingRoots) this.failedRoots.add(root);
        if (this.reportError) {
          for (const root of loadingRoots) this.reportError(error, root);
        } else {
          console.error('XR Blocks UI backend failed to load.', error);
        }
      });
      return;
    }
    if (!backend) return;
    for (let order = 0; order < roots.length; order++) {
      const root = roots[order];
      if (!this.mounts.has(root)) this.mount(root, backend, order);
    }
    this.reconcileMounts(deltaSeconds, camera);
  }

  /** Presents Interaction state resolved from the current hit geometry. */
  present(): void {
    for (const record of this.mounts.values()) {
      if (!record.connected) continue;
      record.mount.present(this.presentationStateFor);
    }
  }

  /** Renders connected overlays through the camera used for the world pass. */
  renderOverlay(camera: THREE.Camera): void {
    if (
      this.connectedOverlayCount === 0 ||
      !this.renderer ||
      !this.publicScene
    ) {
      return;
    }
    for (const record of this.mounts.values()) {
      if (record.connected && getUIElementKind(record.root) === 'overlay') {
        syncRootTransform(record.root, record.mount.object, camera);
      }
    }
    const originalLayers = camera.layers.mask;
    const originalAutoClear = this.renderer.autoClear;
    try {
      camera.layers.set(UI_OVERLAY_LAYER);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.publicScene, camera);
    } finally {
      camera.layers.mask = originalLayers;
      this.renderer.autoClear = originalAutoClear;
    }
  }

  /** Cancels hit mappings and releases one disconnected public root. */
  release(root: UIElement): void {
    this.unmount(root);
    if (this.mounts.size === 0 && this.failed) {
      this.failed = false;
      this.loadPromise = undefined;
    }
  }

  dispose(): void {
    this.generation++;
    for (const root of [...this.mounts.keys()]) this.unmount(root);
    this.backend?.dispose();
    this.backend = undefined;
    this.loadPromise = undefined;
    this.failed = false;
    this.failedRoots.clear();
    this.roots.length = 0;
    this.connectedRoots.clear();
    this.themeRevision = -1;
    this.viewport.width = 0;
    this.viewport.height = 0;
    this.connectedOverlayCount = 0;
    this.privateRoot.removeFromParent();
    this.initialized = false;
    this.publicScene = undefined;
    this.renderer = undefined;
  }

  private async loadBackend(): Promise<UIBackend> {
    if (this.backend) return this.backend;
    const generation = this.generation;
    this.loadPromise ??= this.loader().then((module) => {
      const backend = module.createUIBackend();
      if (generation !== this.generation || !this.initialized) {
        backend.dispose();
        throw STALE_UI_LOAD;
      }
      this.backend = backend;
      if (this.renderer) {
        backend.configureRenderer?.(this.renderer);
      }
      return backend;
    });
    return this.loadPromise;
  }

  private mount(root: UIElement, backend: UIBackend, order: number): void {
    const mount = backend.createMount(root);
    this.privateRoot.add(mount.object);
    this.mounts.set(root, {
      root,
      mount,
      rootRevision: -1,
      unregisterHits: [],
      visible: effectiveVisible(root),
      connected: true,
      needsSync: true,
      order,
    });
    if (getUIElementKind(root) === 'overlay') this.connectedOverlayCount++;
  }

  private disconnect(root: UIElement): void {
    const record = this.mounts.get(root);
    if (!record || !record.connected) return;
    record.connected = false;
    if (getUIElementKind(root) === 'overlay') this.connectedOverlayCount--;
    record.mount.object.visible = false;
    this.interaction.cancelObject(root, 'removed');
    for (const unregister of record.unregisterHits) unregister();
    record.unregisterHits = [];
  }

  private unmount(root: UIElement): void {
    const record = this.mounts.get(root);
    if (!record) return;
    if (record.connected && getUIElementKind(root) === 'overlay') {
      this.connectedOverlayCount--;
    }
    for (const unregister of record.unregisterHits) unregister();
    record.mount.object.removeFromParent();
    record.mount.dispose();
    this.mounts.delete(root);
  }

  private reconcileMounts(deltaSeconds: number, camera: THREE.Camera): void {
    const viewportChanged =
      this.viewport.width !== window.innerWidth ||
      this.viewport.height !== window.innerHeight;
    this.viewport.width = window.innerWidth;
    this.viewport.height = window.innerHeight;
    const themeChanged = this.themeRevision !== ui.revision;
    this.themeRevision = ui.revision;
    for (const record of this.mounts.values()) {
      if (!record.connected) continue;
      const visible = effectiveVisible(record.root);
      if (record.visible && !visible) {
        this.interaction.cancelObject(record.root, 'hidden');
      }
      record.visible = visible;
      record.mount.object.visible = visible;
      syncRootTransform(record.root, record.mount.object, camera);
      const rootRevision = getUIRevision(record.root);
      if (
        record.needsSync ||
        record.rootRevision !== rootRevision ||
        themeChanged ||
        (viewportChanged && getUIElementKind(record.root) === 'overlay')
      ) {
        record.needsSync = false;
        record.rootRevision = rootRevision;
        for (const unregister of record.unregisterHits) unregister();
        const mappings = record.mount.sync(
          ui.theme,
          this.viewport,
          this.presentationStateFor,
          record.order
        );
        record.unregisterHits.length = 0;
        for (const mapping of mappings) {
          record.unregisterHits.push(this.registerHit(mapping));
        }
      }
      record.mount.update(deltaSeconds);
    }
  }

  private presentationStateFor = (
    element: UIElement,
    cursorPoints?: readonly [THREE.Vector3, THREE.Vector3]
  ) => ({
    hovered: this.interaction.isPointingAt(element),
    active: this.interaction.isSelectingAt(element),
    disabled: getSemanticControl(element)?.isDisabled() ?? false,
    cursorPointCount: cursorPoints
      ? this.interaction.writeCursorPointsAt(
          element,
          cursorPoints[0],
          cursorPoints[1]
        )
      : (0 as const),
  });

  private registerHit(mapping: UIHitMapping): () => void {
    mapping.physical.userData.xrblocksHitOrder = mapping.physical.renderOrder;
    return this.interaction.registerHitSurface(mapping.physical, mapping.logical);
  }

  private collectConnectedRoots(): readonly UIElement[] {
    collectUIRoots(this.roots);
    const scene = this.publicScene;
    if (!scene) {
      this.roots.length = 0;
      return this.roots;
    }
    let connectedCount = 0;
    for (const root of this.roots) {
      if (isDescendantOf(root, scene)) {
        this.roots[connectedCount++] = root;
      }
    }
    this.roots.length = connectedCount;
    return this.roots;
  }
}

function effectiveVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function syncRootTransform(
  root: UIElement,
  renderRoot: THREE.Object3D,
  camera?: THREE.Camera
): void {
  if (getUIElementKind(root) === 'overlay') {
    root.updateWorldMatrix(true, false);
    if (!root.matrixWorld.equals(IDENTITY_MATRIX)) {
      if (!WARNED_OVERLAY_TRANSFORMS.has(root)) {
        WARNED_OVERLAY_TRANSFORMS.add(root);
        console.warn('UIOverlay ignores Object3D transforms.');
      }
    }
    if (camera) {
      camera.getWorldPosition(renderRoot.position);
      camera.getWorldQuaternion(renderRoot.quaternion);
      renderRoot.position.add(
        OVERLAY_FORWARD.set(0, 0, -1).applyQuaternion(renderRoot.quaternion)
      );
    }
    renderRoot.scale.setScalar(0.001);
    return;
  }
  root.updateWorldMatrix(true, false);
  renderRoot.matrix.copy(root.matrixWorld);
  renderRoot.matrixAutoUpdate = false;
}

async function defaultLoader(): Promise<UIBackendModule> {
  return import('./UIKitBackend.js');
}
