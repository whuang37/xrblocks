import * as THREE from 'three';

import {UI_OVERLAY_LAYER} from '../../constants';
import type {Interaction} from '../../interaction/Interaction';
import {ui} from '../UI';
import type {UIButton} from '../components/UIButton';
import type {UICard} from '../components/UICard';
import {getUIElementKind, isUIElement, type UIElement} from '../UIElement';
import type {
  UIBackend,
  UIBackendModule,
  UIHitMapping,
  UIMount,
} from './UIBackend';
import {getSemanticControl} from '../../interaction/SemanticControl';

interface MountRecord {
  readonly root: UIElement;
  readonly mount: UIMount;
  signature: string;
  unregisterHits: (() => void)[];
  visible: boolean;
  connected: boolean;
  readonly order: number;
}

export type UIBackendLoader = () => Promise<UIBackendModule>;

const WARNED_OVERLAY_TRANSFORMS = new WeakSet<UIElement>();
const IDENTITY_MATRIX = new THREE.Matrix4();
const OVERLAY_FORWARD = new THREE.Vector3();
const STALE_UI_LOAD = new Error('Stale UI backend load.');

/** Owns all private UI rendering state for one Core lifecycle. */
export class UIRenderer {
  private readonly privateScene = new THREE.Scene();
  private readonly privateRoot = new THREE.Group();
  private readonly mounts = new Map<UIElement, MountRecord>();
  private backend?: UIBackend;
  private loadPromise?: Promise<UIBackend>;
  private failed = false;
  private readonly failedRoots = new Set<UIElement>();
  private initialized = false;
  private renderer?: THREE.WebGLRenderer;
  private publicScene?: THREE.Scene;
  private themeRevision = -1;
  private presentationThemeChanged = false;
  private connectedOverlayCount = 0;
  private nextMountOrder = 0;
  private generation = 0;

  constructor(
    private readonly interaction: Interaction,
    private readonly loader: UIBackendLoader = defaultLoader,
    private readonly reportError?: (error: unknown, root: UIElement) => void
  ) {
    this.privateRoot.name = 'XR Blocks private UI';
    markPrivateUI(this.privateRoot);
    this.privateScene.add(this.privateRoot);
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
    const roots = this.findAndValidateRoots(scene);
    if (roots.length === 0) return;
    let backend: UIBackend;
    try {
      backend = await this.loadBackend();
    } catch (cause) {
      if (cause === STALE_UI_LOAD) return;
      this.backend?.dispose();
      this.backend = undefined;
      this.loadPromise = undefined;
      this.initialized = false;
      this.publicScene = undefined;
      this.renderer = undefined;
      throw new Error(
        'XR Blocks could not load the UI renderer during initialization.',
        {cause}
      );
    }
    for (const root of roots) this.mount(root, backend);
  }

  /** Reconciles public UI and updates current hit geometry. */
  reconcile(deltaSeconds: number, camera: THREE.Camera): void {
    if (!this.initialized || !this.publicScene) return;
    const roots = this.findAndValidateRoots(this.publicScene);
    const connected = new Set(roots);
    for (const root of this.failedRoots) {
      if (!connected.has(root)) this.failedRoots.delete(root);
    }
    for (const root of this.mounts.keys()) {
      if (!connected.has(root)) this.disconnect(root);
    }
    for (const root of roots) {
      const record = this.mounts.get(root);
      if (record && !record.connected) {
        record.connected = true;
        record.signature = '';
        if (getUIElementKind(root) === 'overlay') {
          this.connectedOverlayCount++;
        }
      }
    }
    if (roots.length === 0) return;

    if (this.failed && roots.some((root) => !this.failedRoots.has(root))) {
      this.failed = false;
      this.loadPromise = undefined;
    }

    const backend = this.backend;
    if (!backend && !this.failed) {
      void this.loadBackend().catch((error) => {
        if (error === STALE_UI_LOAD) return;
        this.failed = true;
        for (const root of roots) this.failedRoots.add(root);
        if (this.reportError) {
          for (const root of roots) this.reportError(error, root);
        } else {
          console.error('XR Blocks UI backend failed to load.', error);
        }
      });
      return;
    }
    if (!backend) return;
    for (const root of roots) {
      if (!this.mounts.has(root)) this.mount(root, backend);
    }
    this.reconcileMounts(deltaSeconds, camera);
  }

  /** Presents Interaction state resolved from the current hit geometry. */
  present(): void {
    for (const record of this.mounts.values()) {
      if (!record.connected) continue;
      record.mount.present(
        this.presentationStateFor,
        this.presentationThemeChanged
      );
    }
    this.presentationThemeChanged = false;
  }

  /** Renders connected world UI into the current spatial render target. */
  renderWorld(camera: THREE.Camera): void {
    if (this.mounts.size === 0 || !this.renderer) return;
    this.privateRoot.updateWorldMatrix(true, true);

    const originalLayers = camera.layers.mask;
    const originalAutoClear = this.renderer.autoClear;
    try {
      camera.layers.disable(UI_OVERLAY_LAYER);
      this.renderer.autoClear = false;
      this.renderer.render(this.privateScene, camera);
    } finally {
      camera.layers.mask = originalLayers;
      this.renderer.autoClear = originalAutoClear;
    }
  }

  /** Renders connected overlays through the camera used for the world pass. */
  renderOverlay(camera: THREE.Camera): void {
    if (this.connectedOverlayCount === 0 || !this.renderer) {
      return;
    }
    for (const record of this.mounts.values()) {
      if (record.connected && getUIElementKind(record.root) === 'overlay') {
        syncRootTransform(record.root, record.mount.object, camera);
      }
    }
    this.privateRoot.updateWorldMatrix(true, true);

    const originalLayers = camera.layers.mask;
    const originalAutoClear = this.renderer.autoClear;
    try {
      camera.layers.set(UI_OVERLAY_LAYER);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.privateScene, camera);
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
    this.themeRevision = -1;
    this.presentationThemeChanged = false;
    this.connectedOverlayCount = 0;
    this.nextMountOrder = 0;
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

  private mount(root: UIElement, backend: UIBackend): void {
    const mount = backend.createMount(root);
    markPrivateUI(mount.object);
    this.privateRoot.add(mount.object);
    this.mounts.set(root, {
      root,
      mount,
      signature: '',
      unregisterHits: [],
      visible: effectiveVisible(root),
      connected: true,
      order: this.nextMountOrder++,
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
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    this.presentationThemeChanged = this.themeRevision !== ui.revision;
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
      const viewportSignature =
        getUIElementKind(record.root) === 'overlay'
          ? `:${viewport.width}x${viewport.height}`
          : '';
      const signature = treeSignature(record.root) + viewportSignature;
      if (signature !== record.signature) {
        record.signature = signature;
        for (const unregister of record.unregisterHits) unregister();
        const mappings = record.mount.sync(
          ui.theme,
          viewport,
          this.presentationStateFor,
          record.order
        );
        record.unregisterHits = mappings.map((mapping) =>
          this.registerHit(mapping)
        );
      }
      record.mount.update(deltaSeconds);
    }
  }

  private presentationStateFor = (element: UIElement) => ({
    hovered: this.interaction.isPointingAt(element),
    active: this.interaction.isSelectingAt(element),
    disabled: getSemanticControl(element)?.isDisabled() ?? false,
    cursorPoints: this.interaction
      .getIntersectionsAt(element)
      .map((intersection) => intersection.point),
  });

  private registerHit(mapping: UIHitMapping): () => void {
    mapping.physical.traverse(markPrivateUI);
    mapping.physical.userData.xrblocksHitOrder = mapping.physical.renderOrder;
    return this.interaction.registerHitSurface(
      mapping.physical,
      mapping.logical
    );
  }

  private findAndValidateRoots(scene: THREE.Scene): UIElement[] {
    const roots: UIElement[] = [];
    scene.traverse((object) => {
      if (!isUIElement(object)) return;
      const kind = getUIElementKind(object);
      if (kind === 'card' || kind === 'overlay') {
        roots.push(object);
        validateTree(object);
        return;
      }
      if (!findUIRoot(object)) {
        throw new Error(
          'Every UI element must be below one UICard or UIOverlay root.'
        );
      }
    });
    return roots;
  }
}

export function markPrivateUI(object: THREE.Object3D): void {
  object.userData.xrblocksPrivate = true;
}

function validateTree(root: UIElement): void {
  const visit = (object: THREE.Object3D, underNonUI: boolean): void => {
    for (const child of object.children) {
      if (isUIElement(child)) {
        const kind = getUIElementKind(child);
        if (kind === 'card' || kind === 'overlay') {
          throw new Error('Nested UICard and UIOverlay roots are not allowed.');
        }
        if (underNonUI) {
          throw new Error(
            'A UI element cannot be placed below a non-rendering Script.'
          );
        }
        visit(child, false);
        continue;
      }
      const isScript =
        child.userData.isXRScript === true ||
        (child as THREE.Object3D & {isXRScript?: boolean}).isXRScript === true;
      const isRenderable =
        (child as THREE.Mesh).isMesh === true ||
        (child as THREE.Line).isLine === true ||
        (child as THREE.Points).isPoints === true;
      if (isRenderable || !isScript) {
        throw new Error(
          'UI trees accept UI elements and non-rendering Scripts only.'
        );
      }
      visit(child, true);
    }
  };
  visit(root, false);
}

function findUIRoot(object: THREE.Object3D): UIElement | undefined {
  let current = object.parent;
  while (current) {
    if (isUIElement(current)) {
      const kind = getUIElementKind(current);
      if (kind === 'card' || kind === 'overlay') return current;
    }
    current = current.parent;
  }
  return undefined;
}

function treeSignature(root: UIElement): string {
  const values: string[] = [];
  root.traverse((object) => {
    if (!isUIElement(object)) return;
    const kind = getUIElementKind(object);
    const backgroundColor =
      object.style.backgroundColor ?? ui.theme.styles?.[kind]?.backgroundColor;
    const shape =
      kind === 'card'
        ? `edge:${Boolean((object as UICard).edge)}:hit:${backgroundColor === undefined || !isTransparentColor(backgroundColor)}`
        : kind === 'button'
          ? buttonContentShape(object as UIButton)
          : kind === 'panel' || kind === 'overlay'
            ? `hit:${!isTransparentColor(backgroundColor)}`
            : '';
    values.push(
      `${object.parent?.uuid ?? ''}:${object.uuid}:${kind}:${shape}:${object.style.zIndex ?? 0}`
    );
  });
  return values.join('|');
}

function buttonContentShape(button: UIButton): string {
  return `icon:${button.icon !== undefined}:label:${button.label !== undefined}`;
}

function isTransparentColor(color: unknown): boolean {
  if (color === undefined || color === 'transparent') return true;
  if (typeof color !== 'string') return false;
  const compact = color.replace(/\s/g, '').toLowerCase();
  return (
    /^#[0-9a-f]{3}0$/u.test(compact) ||
    /^#[0-9a-f]{6}00$/u.test(compact) ||
    /^(?:rgba|hsla)\([^)]*,0(?:\.0+)?\)$/u.test(compact)
  );
}

function effectiveVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
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
