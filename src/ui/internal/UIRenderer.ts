import * as THREE from 'three';

import type {Interaction} from '../../interaction/Interaction';
import {ui} from '../UI';
import {
  getUIElementKind,
  getUIRevision,
  isUIElement,
  type UIElement,
} from '../UIElement';
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

const PRIVATE_NODES = new WeakSet<THREE.Object3D>();
const WARNED_OVERLAY_TRANSFORMS = new WeakSet<UIElement>();
const IDENTITY_MATRIX = new THREE.Matrix4();

/** Owns all private UI rendering state for one Core lifecycle. */
export class UIRenderer {
  private readonly privateRoot = new THREE.Group();
  private readonly mounts = new Map<UIElement, MountRecord>();
  private backend?: UIBackend;
  private loadPromise?: Promise<UIBackend>;
  private failed = false;
  private readonly failedRoots = new Set<UIElement>();
  private initialized = false;
  private renderer?: THREE.WebGLRenderer;
  private camera?: THREE.Camera;
  private scene?: THREE.Scene;
  private themeRevision = -1;
  private nextMountOrder = 0;

  constructor(
    private readonly interaction: Interaction,
    private readonly loader: UIBackendLoader = defaultLoader,
    private readonly reportError?: (error: unknown, root: UIElement) => void
  ) {
    this.privateRoot.name = 'XR Blocks private UI';
    markPrivateUI(this.privateRoot);
  }

  /** Mounts UI roots already connected when Core initializes. */
  async initialize(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera
  ): Promise<void> {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.initialized = true;
    const roots = this.findAndValidateRoots(scene);
    if (roots.length === 0) return;
    scene.add(this.privateRoot);
    let backend: UIBackend;
    try {
      backend = await this.loadBackend();
    } catch (cause) {
      this.backend?.dispose();
      this.backend = undefined;
      this.privateRoot.removeFromParent();
      this.loadPromise = undefined;
      this.initialized = false;
      this.scene = undefined;
      this.renderer = undefined;
      this.camera = undefined;
      throw new Error(
        'XR Blocks could not load the UI renderer during initialization.',
        {cause}
      );
    }
    for (const root of roots) this.mount(root, backend);
    this.flush();
  }

  /** Reconciles roots and flushes changed public state once for this frame. */
  update(): void {
    if (!this.initialized || !this.scene) return;
    const roots = this.findAndValidateRoots(this.scene);
    const connected = new Set(roots);
    for (const root of this.failedRoots) {
      if (!connected.has(root)) this.failedRoots.delete(root);
    }
    for (const root of this.mounts.keys()) {
      if (!connected.has(root)) this.disconnect(root);
    }
    if (roots.length === 0) return;

    if (this.failed && roots.some((root) => !this.failedRoots.has(root))) {
      this.failed = false;
      this.loadPromise = undefined;
    }

    if (!this.privateRoot.parent) this.scene.add(this.privateRoot);
    const backend = this.backend;
    if (!backend && !this.failed) {
      void this.loadBackend().catch((error) => {
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
    this.flush();
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
    for (const root of [...this.mounts.keys()]) this.unmount(root);
    this.backend?.dispose();
    this.backend = undefined;
    this.loadPromise = undefined;
    this.failed = false;
    this.failedRoots.clear();
    this.themeRevision = -1;
    this.nextMountOrder = 0;
    this.privateRoot.removeFromParent();
    this.initialized = false;
    this.scene = undefined;
    this.renderer = undefined;
    this.camera = undefined;
  }

  private async loadBackend(): Promise<UIBackend> {
    if (this.backend) return this.backend;
    this.loadPromise ??= this.loader().then((module) => {
      const backend = module.createUIBackend();
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
  }

  private disconnect(root: UIElement): void {
    const record = this.mounts.get(root);
    if (!record || !record.connected) return;
    record.connected = false;
    record.mount.object.visible = false;
    this.interaction.cancelObject(root, 'removed');
    for (const unregister of record.unregisterHits) unregister();
    record.unregisterHits = [];
  }

  private unmount(root: UIElement): void {
    const record = this.mounts.get(root);
    if (!record) return;
    for (const unregister of record.unregisterHits) unregister();
    record.mount.object.removeFromParent();
    record.mount.dispose();
    this.mounts.delete(root);
  }

  private flush(): void {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
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
      syncRootTransform(record.root, record.mount.object, this.camera);
      const viewportSignature =
        getUIElementKind(record.root) === 'overlay'
          ? `:${viewport.width}x${viewport.height}`
          : '';
      const signature =
        treeSignature(record.root, this.interaction) + viewportSignature;
      if (signature === record.signature && !themeChanged) continue;
      record.signature = signature;
      for (const unregister of record.unregisterHits) unregister();
      const mappings = record.mount.sync(
        ui.theme,
        viewport,
        (element) => ({
          hovered: this.interaction.isPointingAt(element),
          active: this.interaction.isSelectingAt(element),
          disabled: getSemanticControl(element)?.isDisabled() ?? false,
          cursorUVs: this.interaction
            .getIntersectionsAt(element)
            .flatMap((intersection) =>
              intersection.uv ? [intersection.uv] : []
            ),
        }),
        record.order
      );
      record.unregisterHits = mappings.map((mapping) =>
        this.registerHit(mapping)
      );
    }
  }

  private registerHit(mapping: UIHitMapping): () => void {
    mapping.physical.traverse(markPrivateUI);
    mapping.physical.userData.xrblocksHitOrder = mapping.physical.renderOrder;
    return this.interaction.registerHitSurface(
      mapping.physical,
      mapping.logical,
      mapping.part
    );
  }

  private findAndValidateRoots(scene: THREE.Scene): UIElement[] {
    const roots: UIElement[] = [];
    scene.traverse((object) => {
      if (isPrivateUI(object) || !isUIElement(object)) return;
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

export function isPrivateUI(object: THREE.Object3D): boolean {
  return PRIVATE_NODES.has(object);
}

export function markPrivateUI(object: THREE.Object3D): void {
  PRIVATE_NODES.add(object);
  object.userData.xrblocksPrivate = true;
}

function validateTree(root: UIElement): void {
  const visit = (object: THREE.Object3D, underNonUI: boolean): void => {
    for (const child of object.children) {
      if (isPrivateUI(child)) continue;
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

function treeSignature(root: UIElement, interaction: Interaction): string {
  const values: string[] = [];
  root.traverse((object) => {
    if (!isUIElement(object)) return;
    const cursorSignature = interaction
      .getIntersectionsAt(object)
      .map((intersection) =>
        intersection.uv ? `${intersection.uv.x},${intersection.uv.y}` : '-'
      )
      .join(';');
    values.push(
      `${object.uuid}:${getUIRevision(object)}:${object.visible}:${object.xb?.pointerEvents}:${object.xb?.interactionEnabled}:${interaction.isPointingAt(object)}:${interaction.isSelectingAt(object)}:${cursorSignature}`
    );
  });
  return values.join('|');
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
        new THREE.Vector3(0, 0, -1).applyQuaternion(renderRoot.quaternion)
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
