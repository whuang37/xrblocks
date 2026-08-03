import * as THREE from 'three';

import {Script} from '../core/Script';
import type {PointerEvents, ReticleMode} from '../interaction/InteractionTypes';
import {MAX_GRADIENT_STOPS} from './constants/GradientPanelConstants';
import type {GradientPaint, Paint} from './types/ShaderTypes';

export type UIUnit = number | `${number}%` | 'auto';
export type UIColor = Paint;

export interface UIStateStyle {
  backgroundColor?: UIColor;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  borderColor?: Paint;
  borderWidth?: number;
  borderRadius?: number;
}

export interface UIStyle extends UIStateStyle {
  width?: UIUnit;
  height?: UIUnit;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  flexDirection?: 'row' | 'column';
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between';
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
  alignSelf?: 'auto' | 'flex-start' | 'center' | 'flex-end' | 'stretch';
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | 'auto';
  positionType?: 'relative' | 'absolute';
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  zIndex?: number;
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  padding?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  margin?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  fontSize?: number;
  fontWeight?: number | 'normal' | 'medium' | 'bold';
  lineHeight?: number;
  textAlign?: 'left' | 'center' | 'right';
  innerShadowColor?: Paint;
  innerShadowBlur?: number;
  dropShadowColor?: Paint;
  dropShadowBlur?: number;
  dropShadowSpread?: number;
  overflow?: 'visible' | 'hidden';
  objectFit?: 'contain' | 'cover' | 'fill';
  whiteSpace?: 'normal' | 'nowrap';
  textOverflow?: 'clip' | 'ellipsis';
  ':hover'?: UIStateStyle;
  ':active'?: UIStateStyle;
  ':disabled'?: UIStateStyle;
}

export interface UIElementOptions {
  style?: UIStyle;
  children?: THREE.Object3D[];
  visible?: boolean;
  pointerEvents?: PointerEvents;
  interactionEnabled?: boolean;
  reticleMode?: ReticleMode;
}

export type UIElementKind =
  | 'card'
  | 'overlay'
  | 'panel'
  | 'text'
  | 'button'
  | 'slider'
  | 'image'
  | 'icon';

interface UIElementState {
  readonly kind: UIElementKind;
  revision: number;
}

const STYLE_KEYS = new Set<keyof UIStyle>([
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'flexDirection',
  'justifyContent',
  'alignItems',
  'alignSelf',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'positionType',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'gap',
  'rowGap',
  'columnGap',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'backgroundColor',
  'color',
  'opacity',
  'borderColor',
  'borderWidth',
  'borderRadius',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'textAlign',
  'innerShadowColor',
  'innerShadowBlur',
  'dropShadowColor',
  'dropShadowBlur',
  'dropShadowSpread',
  'overflow',
  'objectFit',
  'whiteSpace',
  'textOverflow',
  ':hover',
  ':active',
  ':disabled',
]);

const STATE_STYLE_KEYS = new Set<keyof UIStateStyle>([
  'backgroundColor',
  'color',
  'opacity',
  'borderColor',
  'borderWidth',
  'borderRadius',
]);

const NUMBER_KEYS = new Set<keyof UIStyle>([
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'flexGrow',
  'flexShrink',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'gap',
  'rowGap',
  'columnGap',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'opacity',
  'borderWidth',
  'borderRadius',
  'fontSize',
  'lineHeight',
  'innerShadowBlur',
  'dropShadowBlur',
  'dropShadowSpread',
]);

const PAINT_KEYS = new Set<keyof UIStyle>([
  'backgroundColor',
  'borderColor',
  'innerShadowColor',
  'dropShadowColor',
]);

const COLOR_KEYS = new Set<keyof UIStyle>(['color']);

const NONNEGATIVE_KEYS = new Set<keyof UIStyle>([
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'gap',
  'rowGap',
  'columnGap',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderWidth',
  'borderRadius',
  'fontSize',
  'lineHeight',
  'innerShadowBlur',
  'dropShadowBlur',
]);

const ENUM_VALUES: Partial<Record<keyof UIStyle, readonly unknown[]>> = {
  flexDirection: ['row', 'column'],
  justifyContent: ['flex-start', 'center', 'flex-end', 'space-between'],
  alignItems: ['flex-start', 'center', 'flex-end', 'stretch'],
  alignSelf: ['auto', 'flex-start', 'center', 'flex-end', 'stretch'],
  positionType: ['relative', 'absolute'],
  fontWeight: ['normal', 'medium', 'bold'],
  textAlign: ['left', 'center', 'right'],
  overflow: ['visible', 'hidden'],
  objectFit: ['contain', 'cover', 'fill'],
  whiteSpace: ['normal', 'nowrap'],
  textOverflow: ['clip', 'ellipsis'],
};

const states = new WeakMap<UIElement, UIElementState>();

export abstract class UIElement extends Script {
  readonly isUI = true;
  private readonly styleTarget: UIStyle = {};
  private readonly styleProxy: UIStyle;

  protected constructor(kind: UIElementKind, options: UIElementOptions = {}) {
    super();
    states.set(this, {kind, revision: 0});
    this.styleProxy = createStyleProxy(
      this.styleTarget,
      false,
      this.markUIDirty
    );
    this.style = options.style ?? {};
    this.visible = options.visible ?? true;
    this.xb = {
      pointerEvents: options.pointerEvents ?? 'auto',
      interactionEnabled: options.interactionEnabled ?? true,
    };
    if (options.reticleMode !== undefined) {
      this.xb.reticleMode = options.reticleMode;
    }
    if (options.children) this.add(...options.children);
  }

  get style(): UIStyle {
    return this.styleProxy;
  }

  set style(style: UIStyle) {
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
      throw new Error('UI style must be an object.');
    }
    for (const [key, value] of Object.entries(style)) {
      validateStyle(key, value, false);
    }
    const entries = Object.entries(style).map(
      ([key, value]) => [key, cloneStyleValue(value)] as const
    );
    for (const key of Object.keys(this.styleTarget) as (keyof UIStyle)[]) {
      Reflect.deleteProperty(this.styleProxy, key);
    }
    for (const [key, value] of entries) {
      Reflect.set(this.styleProxy, key, value);
    }
  }

  protected markUIDirty = (): void => {
    const state = states.get(this);
    if (state) state.revision++;
  };
}

export function isUIElement(object: THREE.Object3D): object is UIElement {
  return states.has(object as UIElement);
}

export function getUIElementKind(element: UIElement): UIElementKind {
  return states.get(element)!.kind;
}

export function getUIRevision(element: UIElement): number {
  return states.get(element)!.revision;
}

/** Invalidates one public wrapper after private asynchronous resource work. */
export function invalidateUIElement(element: UIElement): void {
  const state = states.get(element);
  if (state) state.revision++;
}

function createStyleProxy<T extends UIStyle | UIStateStyle>(
  target: T,
  stateOnly: boolean,
  onChange: () => void
): T {
  return new Proxy(target, {
    set(object, property, value) {
      if (typeof property !== 'string') return false;
      validateStyle(property, value, stateOnly);
      if (value === undefined) {
        if (!Reflect.has(object, property)) return true;
        Reflect.deleteProperty(object, property);
        onChange();
        return true;
      }
      const next =
        isStateStyleKey(property) && value && typeof value === 'object'
          ? createStyleProxy(
              cloneStyleValue(value) as UIStateStyle,
              true,
              onChange
            )
          : value;
      if (Reflect.get(object, property) === next) return true;
      Reflect.set(object, property, next);
      onChange();
      return true;
    },
    deleteProperty(object, property) {
      if (!Reflect.has(object, property)) return true;
      Reflect.deleteProperty(object, property);
      onChange();
      return true;
    },
  });
}

function validateStyle(
  property: string,
  value: unknown,
  stateOnly: boolean
): void {
  const valid = stateOnly ? STATE_STYLE_KEYS : STYLE_KEYS;
  if (!valid.has(property as never)) {
    throw new Error(`Unknown UI style property "${property}".`);
  }
  if (value === undefined) return;
  if (stateOnly && !STATE_STYLE_KEYS.has(property as keyof UIStateStyle)) {
    throw new Error(`UI state styles cannot change "${property}".`);
  }
  if (isStateStyleKey(property)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`UI style "${property}" must be an object.`);
    }
    for (const [key, nested] of Object.entries(value)) {
      validateStyle(key, nested, true);
    }
    return;
  }
  if (
    NUMBER_KEYS.has(property as keyof UIStyle) &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new Error(`UI style "${property}" must be a finite number.`);
  }
  if (PAINT_KEYS.has(property as keyof UIStyle) && !isPaint(value)) {
    throw new Error(`UI style "${property}" must be a valid paint.`);
  }
  if (COLOR_KEYS.has(property as keyof UIStyle)) {
    if (!isSolidColor(value) || value === 'transparent') {
      throw new Error(`UI style "${property}" must be a valid color.`);
    }
  }
  if (property === 'flexBasis' && value !== 'auto') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('UI style "flexBasis" must be finite or "auto".');
    }
  }
  if (property === 'fontWeight' && typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error('UI style "fontWeight" must be positive and finite.');
    }
  }
  const enumValues = ENUM_VALUES[property as keyof UIStyle];
  if (
    enumValues &&
    !(property === 'fontWeight' && typeof value === 'number') &&
    !enumValues.includes(value)
  ) {
    throw new Error(`Invalid value for UI style "${property}".`);
  }
  if ((property === 'width' || property === 'height') && !isUIUnit(value)) {
    throw new Error(
      `UI style "${property}" must be a finite number, percentage, or "auto".`
    );
  }
  if (
    NONNEGATIVE_KEYS.has(property as keyof UIStyle) &&
    typeof value === 'number' &&
    value < 0
  ) {
    throw new Error(`UI style "${property}" cannot be negative.`);
  }
  if (
    (property === 'width' || property === 'height') &&
    typeof value === 'string' &&
    value.startsWith('-')
  ) {
    throw new Error(`UI style "${property}" cannot be negative.`);
  }
  if (
    property === 'opacity' &&
    typeof value === 'number' &&
    (value < 0 || value > 1)
  ) {
    throw new Error('UI style "opacity" must be between 0 and 1.');
  }
}

function isStateStyleKey(
  property: string
): property is ':hover' | ':active' | ':disabled' {
  return (
    property === ':hover' || property === ':active' || property === ':disabled'
  );
}

function isUIUnit(value: unknown): value is UIUnit {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    value === 'auto' ||
    (typeof value === 'string' && /^-?\d+(?:\.\d+)?%$/.test(value))
  );
}

function isPaint(value: unknown): value is Paint {
  if (isSolidColor(value)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const gradient = value as Partial<GradientPaint>;
  if (
    !['linear', 'radial', 'angular', 'diamond'].includes(
      gradient.gradientType ?? ''
    ) ||
    !Array.isArray(gradient.stops) ||
    gradient.stops.length < 2 ||
    gradient.stops.length > MAX_GRADIENT_STOPS ||
    (gradient.rotation !== undefined &&
      (!Number.isFinite(gradient.rotation) ||
        typeof gradient.rotation !== 'number')) ||
    !isVector2Like(gradient.center) ||
    !isVector2Like(gradient.scale)
  ) {
    return false;
  }

  let previousPosition = -Infinity;
  return gradient.stops.every((stop) => {
    const valid =
      !!stop &&
      typeof stop === 'object' &&
      typeof stop.position === 'number' &&
      Number.isFinite(stop.position) &&
      stop.position >= 0 &&
      stop.position <= 1 &&
      stop.position >= previousPosition &&
      isSolidColor(stop.color);
    previousPosition = stop?.position ?? previousPosition;
    return valid;
  });
}

function isSolidColor(value: unknown): value is THREE.ColorRepresentation {
  return (
    value instanceof THREE.Color ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.trim().length > 0)
  );
}

function isVector2Like(value: unknown): boolean {
  if (value === undefined || value instanceof THREE.Vector2) return true;
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((component) =>
      typeof component === 'number' ? Number.isFinite(component) : false
    )
  );
}

function cloneStyleValue(value: unknown): unknown {
  if (value instanceof THREE.Color) return value.clone();
  if (value instanceof THREE.Vector2) return value.clone();
  if (Array.isArray(value)) return value.map(cloneStyleValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, cloneStyleValue(nested)])
  );
}
