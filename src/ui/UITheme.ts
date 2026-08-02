import type {UIElementKind, UIStyle} from './UIElement';

export interface UIThemeColors {
  surface: string;
  raisedSurface: string;
  primary: string;
  primaryText: string;
  text: string;
  secondaryText: string;
  outline: string;
  disabledSurface: string;
  disabledText: string;
}

/** UIKit-facing styles applied before an element's own style. */
export type UIThemeStyles = Partial<Record<UIElementKind, UIStyle>>;

export interface UITheme {
  colors: UIThemeColors;
  borderRadius: number;
  styles?: UIThemeStyles;
}

export interface UIThemeUpdate {
  colors?: Partial<UIThemeColors>;
  borderRadius?: number;
  styles?: UIThemeStyles;
}

export type UIThemePresetName = 'grayGlass' | 'colorful';

export const grayGlassTheme: UITheme = {
  colors: {
    surface: '#282c3488',
    raisedSurface: '#21252b88',
    primary: '#61dafb',
    primaryText: '#282c34',
    text: '#ffffff',
    secondaryText: '#abb2bf',
    outline: 'rgba(255, 255, 255, 0.22)',
    disabledSurface: '#282c3466',
    disabledText: '#abb2bf',
  },
  borderRadius: 20,
  styles: {
    card: {
      backgroundColor: '#282c3488',
      borderColor: 'rgba(255, 255, 255, 0.22)',
      borderWidth: 1,
      borderRadius: 20,
    },
    button: {
      backgroundColor: '#444444',
      color: '#ffffff',
      borderColor: 'rgba(255, 255, 255, 0.24)',
      borderWidth: 1,
      borderRadius: 12,
      ':hover': {backgroundColor: '#666666'},
      ':active': {backgroundColor: '#61dafb', color: '#282c34'},
      ':disabled': {
        backgroundColor: '#282c3466',
        color: '#abb2bf',
      },
    },
    text: {
      color: '#ffffff',
    },
  },
};

export const colorfulTheme: UITheme = {
  colors: {
    surface: 'rgba(10, 17, 31, 0.96)',
    raisedSurface: 'rgba(22, 35, 58, 0.96)',
    primary: '#22d3ee',
    primaryText: '#111827',
    text: '#f8fafc',
    secondaryText: '#cbd5e1',
    outline: '#8ff0df',
    disabledSurface: 'rgba(71, 85, 105, 0.45)',
    disabledText: '#94a3b8',
  },
  borderRadius: 32,
  styles: {
    card: {
      backgroundColor: 'rgba(10, 17, 31, 0.96)',
      borderColor: '#8ff0df',
      borderWidth: 3,
      borderRadius: 32,
    },
    button: {
      backgroundColor: '#233653',
      color: '#f8fafc',
      borderColor: '#8ff0df',
      borderWidth: 2,
      borderRadius: 22,
      ':hover': {backgroundColor: '#315274'},
      ':active': {backgroundColor: '#7c3aed'},
      ':disabled': {
        backgroundColor: 'rgba(71, 85, 105, 0.45)',
        color: '#94a3b8',
      },
    },
    text: {
      color: '#f8fafc',
    },
  },
};

export const uiThemePresets: Readonly<Record<UIThemePresetName, UITheme>> = {
  grayGlass: grayGlassTheme,
  colorful: colorfulTheme,
};

export const defaultTheme: UITheme = grayGlassTheme;

const UI_ELEMENT_KINDS = new Set<UIElementKind>([
  'card',
  'overlay',
  'panel',
  'text',
  'button',
  'slider',
  'image',
  'icon',
]);

function cloneStyles(styles: UIThemeStyles | undefined): UIThemeStyles {
  if (!styles) return {};
  return Object.fromEntries(
    Object.entries(styles).map(([kind, style]) => [
      kind,
      {
        ...style,
        ...(style[':hover'] ? {':hover': {...style[':hover']}} : undefined),
        ...(style[':active'] ? {':active': {...style[':active']}} : undefined),
        ...(style[':disabled']
          ? {':disabled': {...style[':disabled']}}
          : undefined),
      },
    ])
  ) as UIThemeStyles;
}

function validateStyles(value: unknown): asserts value is UIThemeStyles {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('UI theme styles must be an object.');
  }
  for (const [kind, style] of Object.entries(value)) {
    if (!UI_ELEMENT_KINDS.has(kind as UIElementKind)) {
      throw new Error(`Invalid UI theme style kind "${kind}".`);
    }
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
      throw new Error(`UI theme style "${kind}" must be an object.`);
    }
  }
}

function validateTheme(value: UITheme): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('UI theme must be an object.');
  }
  validateColorUpdate(value.colors, value.colors);
  if (
    typeof value.borderRadius !== 'number' ||
    !Number.isFinite(value.borderRadius) ||
    value.borderRadius < 0
  ) {
    throw new Error('Invalid UI theme property "borderRadius".');
  }
  if (value.styles !== undefined) validateStyles(value.styles);
}

export function createTheme(initial: UITheme): {
  proxy: UITheme;
  assign(value: UIThemeUpdate): void;
  replace(value: UITheme): void;
  revision(): number;
} {
  validateTheme(initial);
  let revision = 0;
  const colorsTarget = {...initial.colors};
  const colors = new Proxy(colorsTarget, {
    set(target, property, value) {
      if (!(property in target) || typeof value !== 'string') {
        throw new Error(`Invalid UI theme color "${String(property)}".`);
      }
      Reflect.set(target, property, value);
      revision++;
      return true;
    },
    deleteProperty(_target, property) {
      throw new Error(
        `UI theme color "${String(property)}" cannot be removed.`
      );
    },
  });
  const stylesTarget = cloneStyles(initial.styles);
  const target = {
    colors,
    borderRadius: initial.borderRadius,
    styles: stylesTarget,
  };
  const proxy = new Proxy(target, {
    set(theme, property, value) {
      if (property === 'colors') {
        validateColorUpdate(value, colorsTarget);
        Object.assign(colors, value);
        return true;
      }
      if (property === 'styles') {
        validateStyles(value);
        for (const kind of Object.keys(stylesTarget)) {
          delete stylesTarget[kind as UIElementKind];
        }
        Object.assign(stylesTarget, cloneStyles(value));
        revision++;
        return true;
      }
      if (
        property !== 'borderRadius' ||
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0
      ) {
        throw new Error(`Invalid UI theme property "${String(property)}".`);
      }
      theme.borderRadius = value;
      revision++;
      return true;
    },
    deleteProperty(_theme, property) {
      throw new Error(
        `UI theme property "${String(property)}" cannot be removed.`
      );
    },
  });
  return {
    proxy,
    assign(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('UI theme update must be an object.');
      }
      for (const property of Object.keys(value)) {
        if (
          property !== 'colors' &&
          property !== 'borderRadius' &&
          property !== 'styles'
        ) {
          throw new Error(`Invalid UI theme property "${property}".`);
        }
      }
      if (value.colors !== undefined) {
        validateColorUpdate(value.colors, colorsTarget);
      }
      if (value.borderRadius !== undefined) {
        if (
          typeof value.borderRadius !== 'number' ||
          !Number.isFinite(value.borderRadius) ||
          value.borderRadius < 0
        ) {
          throw new Error('Invalid UI theme property "borderRadius".');
        }
      }
      if (value.styles !== undefined) validateStyles(value.styles);
      if (value.colors) Object.assign(colors, value.colors);
      if (value.borderRadius !== undefined)
        proxy.borderRadius = value.borderRadius;
      if (value.styles !== undefined) {
        Object.assign(stylesTarget, cloneStyles(value.styles));
        revision++;
      }
    },
    replace(value) {
      validateTheme(value);
      Object.assign(colors, value.colors);
      proxy.borderRadius = value.borderRadius;
      proxy.styles = value.styles ?? {};
      revision++;
    },
    revision: () => revision,
  };
}

function validateColorUpdate(
  value: unknown,
  target: UIThemeColors
): asserts value is Partial<UIThemeColors> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('UI theme colors must be an object.');
  }
  for (const [property, color] of Object.entries(value)) {
    if (!(property in target) || typeof color !== 'string') {
      throw new Error(`Invalid UI theme color "${property}".`);
    }
  }
}
