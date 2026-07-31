import {
  type InProperties,
  type RenderContext,
  type WithSignal,
} from '@pmndrs/uikit';
import {effect} from '@preact/signals-core';
import * as THREE from 'three';

import {ScriptMixin} from '../../core/Script';
import {ManipulationAction} from '../../interaction/manipulation/ManipulationTypes';
import {User} from '../../core/User';
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
  spotlightColor: 'rgba(255, 255, 255, 1)',
  spotlightRadius: 20,
  spotlightBlur: 40,
  debug: false,
} as const;

/** Visual and hit-area settings for a card manipulation edge. */
export interface UIManipulationHandleProperties {
  /** Width of the manipulation band extending outward from the card edge. */
  margin?: number;
  /** Outer edge corner radius in layout pixels. */
  cornerRadius?: number;
  /** Visible shader edge width in layout pixels. */
  edgeWidth?: number;
  /** Color shared by the cursor spotlight and illuminated outline. */
  spotlightColor?: THREE.ColorRepresentation;
  /** Cursor spotlight radius in layout pixels. */
  spotlightRadius?: number;
  /** Cursor spotlight blur in layout pixels. */
  spotlightBlur?: number;
  /** Shows the complete hit surface for diagnostics. */
  debug?: boolean;
}

type HandleLayerProperties = PanelLayerProperties & {
  u_manipulation_margin?: number;
  u_manipulation_corner_radius?: number;
  u_manipulation_edge_width?: number;
  u_cursor_spotlight_color?: THREE.ColorRepresentation;
  u_cursor_radius?: number;
  u_cursor_spotlight_blur?: number;
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
        'u_manipulation_margin',
        signals.u_manipulation_margin?.value
      );
      setNumber(
        this.material,
        'u_manipulation_corner_radius',
        signals.u_manipulation_corner_radius?.value
      );
      setNumber(
        this.material,
        'u_manipulation_edge_width',
        signals.u_manipulation_edge_width?.value
      );
      setColor(
        this.material,
        'u_cursor_spotlight_color',
        signals.u_cursor_spotlight_color?.value
      );
      setNumber(
        this.material,
        'u_cursor_radius',
        signals.u_cursor_radius?.value
      );
      setNumber(
        this.material,
        'u_cursor_spotlight_blur',
        signals.u_cursor_spotlight_blur?.value
      );
      setVector2(this.material, 'u_cursor_uv', signals.u_cursor_uv?.value);
      setNumber(this.material, 'u_show_glow', signals.u_show_glow?.value);
      setVector2(this.material, 'u_cursor_uv_2', signals.u_cursor_uv_2?.value);
      setNumber(this.material, 'u_show_glow_2', signals.u_show_glow_2?.value);
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

const ManipulationHandleScript = ScriptMixin(UIManipulationHandleLayer);

/** Shader-backed edge that requests translation from its manipulation owner. */
export class UIManipulationHandle extends ManipulationHandleScript {
  static dependencies = {user: User};

  name = 'UIManipulationHandle';
  readonly margin: number;
  readonly cornerRadius: number;
  private user?: User;
  private readonly cursorSlots = new Map<THREE.Object3D, 0 | 1>();

  constructor(properties: UIManipulationHandleProperties = {}) {
    const resolved = {...DEFAULT_HANDLE_PROPERTIES, ...properties};
    const margin = Math.max(0, resolved.margin);
    const cornerRadius = Math.max(0, resolved.cornerRadius);
    super({
      positionType: 'absolute',
      positionTop: -margin,
      positionRight: -margin,
      positionBottom: -margin,
      positionLeft: -margin,
      width: 'auto',
      height: 'auto',
      pointerEvents: 'auto',
      zIndexOffset: -20,
      u_manipulation_margin: margin,
      u_manipulation_corner_radius: cornerRadius,
      u_manipulation_edge_width: resolved.edgeWidth,
      u_cursor_spotlight_color: resolved.spotlightColor,
      u_cursor_radius: resolved.spotlightRadius,
      u_cursor_spotlight_blur: resolved.spotlightBlur,
      u_cursor_uv: new THREE.Vector2(0.5, 0.5),
      u_show_glow: 0,
      u_cursor_uv_2: new THREE.Vector2(0.5, 0.5),
      u_show_glow_2: 0,
      u_debug: resolved.debug ? 1 : 0,
    });
    this.margin = margin;
    this.cornerRadius = cornerRadius;
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
        if (
          !size ||
          !uv ||
          !isOuterEdgeHit(uv, size, this.margin, this.cornerRadius)
        ) {
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
    UIManipulationHandleLayer.prototype.dispose.call(this);
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
    u_manipulation_margin: {value: 0},
    u_manipulation_corner_radius: {value: 0},
    u_manipulation_edge_width: {value: 0},
    u_cursor_spotlight_color: {value: new THREE.Vector4(1, 1, 1, 1)},
    u_cursor_radius: {value: 0},
    u_cursor_spotlight_blur: {value: 0},
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

function setVector2(
  material: THREE.ShaderMaterial,
  name: string,
  value: THREE.Vector2 | undefined
): void {
  if (value !== undefined) material.uniforms[name].value.copy(value);
}

function isOuterEdgeHit(
  uv: THREE.Vector2,
  size: readonly [number, number],
  margin: number,
  cornerRadius: number
): boolean {
  const halfWidth = size[0] / 2;
  const halfHeight = size[1] / 2;
  const x = uv.x * size[0] - halfWidth;
  const y = uv.y * size[1] - halfHeight;
  const innerHalfWidth = Math.max(0, halfWidth - margin);
  const innerHalfHeight = Math.max(0, halfHeight - margin);
  const outerRadius = Math.min(cornerRadius, halfWidth, halfHeight);
  const innerRadius = Math.min(
    Math.max(0, outerRadius - margin),
    innerHalfWidth,
    innerHalfHeight
  );
  return (
    roundedBoxDistance(x, y, halfWidth, halfHeight, outerRadius) <= 0 &&
    roundedBoxDistance(x, y, innerHalfWidth, innerHalfHeight, innerRadius) >= 0
  );
}

function roundedBoxDistance(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  radius: number
): number {
  const qx = Math.abs(x) - halfWidth + radius;
  const qy = Math.abs(y) - halfHeight + radius;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  );
}
