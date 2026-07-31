import {
  type InProperties,
  type RenderContext,
  type WithSignal,
} from '@pmndrs/uikit';
import {effect} from '@preact/signals-core';
import * as THREE from 'three';

import {ManipulationAction} from '../../interaction/manipulation/ManipulationTypes';
import {User} from '../../core/User';
import {XRUI} from '../mixins/XRUI';
import {UIManipulationHandleFragmentShader} from '../shaders/UIManipulationHandle.frag';
import {parseColorWithAlpha} from '../utils/ColorUtils';
import {
  PanelLayer,
  type PanelLayerProperties,
  PanelShaderMaterial,
  type SignalProperties,
  type WritableSignalProperties,
} from '../primitives/layers/PanelLayer';

const DEFAULT_HANDLE_PROPERTIES = {
  margin: 50,
  cornerRadius: 40,
  edgeWidth: 2,
  edgeColor: 'rgba(255, 255, 255, 1)',
  spotlightColor: 'rgba(255, 255, 255, 1)',
  spotlightRadius: 20,
  spotlightBlur: 40,
  debug: false,
} as const;

/** Visual and hit-area settings for a card manipulation edge. */
export interface UIManipulationHandleProperties {
  /** Distance in layout pixels between the card content and outer edge. */
  margin?: number;
  /** Outer edge corner radius in layout pixels. */
  cornerRadius?: number;
  /** Visible shader edge width in layout pixels. */
  edgeWidth?: number;
  /** Visible shader edge color. */
  edgeColor?: THREE.ColorRepresentation;
  /** Cursor spotlight color. */
  spotlightColor?: THREE.ColorRepresentation;
  /** Cursor spotlight radius in layout pixels. */
  spotlightRadius?: number;
  /** Cursor spotlight blur in layout pixels. */
  spotlightBlur?: number;
  /** Shows the complete hit surface for diagnostics. */
  debug?: boolean;
}

type HandleLayerProperties = PanelLayerProperties & {
  u_corner_radius?: number;
  u_edge_width?: number;
  u_edge_color?: THREE.ColorRepresentation;
  u_spotlight_color?: THREE.ColorRepresentation;
  u_spotlight_radius?: number;
  u_spotlight_blur?: number;
  u_cursor_uv?: THREE.Vector2;
  u_show_glow?: number;
  u_cursor_uv_2?: THREE.Vector2;
  u_show_glow_2?: number;
  u_debug?: number;
};

class UIManipulationHandleLayer extends PanelLayer<HandleLayerProperties> {
  constructor(
    inputProperties?: InProperties<HandleLayerProperties>,
    initialClasses?: Array<InProperties<HandleLayerProperties> | string>,
    config: {
      renderContext?: RenderContext;
      defaultOverrides?: InProperties<HandleLayerProperties>;
      defaults?: WithSignal<HandleLayerProperties>;
    } = {}
  ) {
    super(
      new PanelShaderMaterial({
        fragmentShader: UIManipulationHandleFragmentShader,
        depthWrite: false,
        uniforms: createUniforms(),
      }),
      inputProperties,
      initialClasses,
      config
    );

    effect(() => {
      const signals = (
        this.properties as unknown as {
          signal: SignalProperties<HandleLayerProperties>;
        }
      ).signal;
      setNumber(
        this.material,
        'u_corner_radius',
        signals.u_corner_radius?.value
      );
      setNumber(this.material, 'u_edge_width', signals.u_edge_width?.value);
      setColor(this.material, 'u_edge_color', signals.u_edge_color?.value);
      setColor(
        this.material,
        'u_spotlight_color',
        signals.u_spotlight_color?.value
      );
      setNumber(
        this.material,
        'u_spotlight_radius',
        signals.u_spotlight_radius?.value
      );
      setNumber(
        this.material,
        'u_spotlight_blur',
        signals.u_spotlight_blur?.value
      );
      setNumber(this.material, 'u_debug', signals.u_debug?.value);
    });
  }

  setCursor(uv: THREE.Vector2 | undefined, index: 0 | 1): void {
    const signals = (
      this.properties as unknown as {
        signal: WritableSignalProperties<HandleLayerProperties>;
      }
    ).signal;
    const cursor = index === 0 ? signals.u_cursor_uv : signals.u_cursor_uv_2;
    const visible = index === 0 ? signals.u_show_glow : signals.u_show_glow_2;
    if (cursor) cursor.value = uv;
    if (visible) visible.value = uv ? 1 : 0;
  }
}

const ManipulationHandleScript = XRUI(UIManipulationHandleLayer);

/** Shader-backed edge that requests translation from its manipulation owner. */
export class UIManipulationHandle extends ManipulationHandleScript {
  static dependencies = {user: User};

  name = 'UIManipulationHandle';
  readonly margin: number;
  private user?: User;
  private readonly cursorSlots = new Map<THREE.Object3D, 0 | 1>();

  constructor(properties: UIManipulationHandleProperties = {}) {
    const resolved = {...DEFAULT_HANDLE_PROPERTIES, ...properties};
    const margin = Math.max(0, resolved.margin);
    super({
      positionType: 'absolute',
      positionTop: -margin,
      positionRight: -margin,
      positionBottom: -margin,
      positionLeft: -margin,
      pointerEvents: 'auto',
      zIndexOffset: -20,
      u_corner_radius: resolved.cornerRadius,
      u_edge_width: resolved.edgeWidth,
      u_edge_color: resolved.edgeColor,
      u_spotlight_color: resolved.spotlightColor,
      u_spotlight_radius: resolved.spotlightRadius,
      u_spotlight_blur: resolved.spotlightBlur,
      u_cursor_uv: new THREE.Vector2(0.5, 0.5),
      u_show_glow: 0,
      u_cursor_uv_2: new THREE.Vector2(0.5, 0.5),
      u_show_glow_2: 0,
      u_debug: resolved.debug ? 1 : 0,
    });
    this.margin = margin;
    this.xb = {
      manipulationHandle: {action: ManipulationAction.Translate},
    };
    this.reticleMode = 'surface';

    const baseRaycast = this.raycast.bind(this);
    this.raycast = (raycaster, intersections) => {
      const firstNewIntersection = intersections.length;
      baseRaycast(raycaster, intersections);
      const size = this.size.value;
      for (
        let index = intersections.length - 1;
        index >= firstNewIntersection;
        index--
      ) {
        const uv = intersections[index].uv;
        if (!size || !uv || !isEdgeHit(uv, size, this.margin)) {
          intersections.splice(index, 1);
        }
      }
    };
  }

  init({user}: {user: User}): void {
    this.user = user;
  }

  onHoverEnter(controller: THREE.Object3D): true {
    this.assignCursorSlot(controller);
    this.updateCursor(controller);
    return true;
  }

  onHovering(controller: THREE.Object3D): true {
    this.updateCursor(controller);
    return true;
  }

  onHoverExit(controller: THREE.Object3D): true {
    const slot = this.cursorSlots.get(controller);
    if (slot !== undefined) this.setCursor(undefined, slot);
    this.cursorSlots.delete(controller);
    return true;
  }

  override dispose(): void {
    this.cursorSlots.clear();
    super.dispose();
  }

  private assignCursorSlot(controller: THREE.Object3D): 0 | 1 | undefined {
    const existing = this.cursorSlots.get(controller);
    if (existing !== undefined) return existing;
    const used = new Set(this.cursorSlots.values());
    const slot = !used.has(0) ? 0 : !used.has(1) ? 1 : undefined;
    if (slot !== undefined) this.cursorSlots.set(controller, slot);
    return slot;
  }

  private updateCursor(controller: THREE.Object3D): void {
    const slot = this.assignCursorSlot(controller);
    if (slot === undefined) return;
    const id = controller.userData.id;
    const intersection = this.user?.getIntersectionAt(
      this,
      typeof id === 'number' ? id : -1
    );
    this.setCursor(intersection?.uv?.clone(), slot);
  }
}

function createUniforms(): Record<string, THREE.IUniform> {
  return {
    u_corner_radius: {value: 0},
    u_edge_width: {value: 0},
    u_edge_color: {value: new THREE.Vector4(1, 1, 1, 1)},
    u_spotlight_color: {value: new THREE.Vector4(1, 1, 1, 1)},
    u_spotlight_radius: {value: 0},
    u_spotlight_blur: {value: 0},
    u_cursor_uv: {value: new THREE.Vector2(0.5, 0.5)},
    u_show_glow: {value: 0},
    u_cursor_uv_2: {value: new THREE.Vector2(0.5, 0.5)},
    u_show_glow_2: {value: 0},
    u_debug: {value: 0},
  };
}

function setNumber(
  material: THREE.ShaderMaterial,
  name: string,
  value: number | undefined
): void {
  if (value !== undefined) material.uniforms[name].value = value;
}

function setColor(
  material: THREE.ShaderMaterial,
  name: string,
  value: THREE.ColorRepresentation | undefined
): void {
  if (value === undefined) return;
  const {color, opacity} = parseColorWithAlpha(value);
  material.uniforms[name].value.set(color.r, color.g, color.b, opacity);
}

function isEdgeHit(
  uv: THREE.Vector2,
  size: readonly [number, number],
  margin: number
): boolean {
  const x = uv.x * size[0];
  const y = uv.y * size[1];
  const edgeX = Math.min(margin, size[0] / 2);
  const edgeY = Math.min(margin, size[1] / 2);
  return (
    x <= edgeX || x >= size[0] - edgeX || y <= edgeY || y >= size[1] - edgeY
  );
}
