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

export interface UITheme {
  colors: UIThemeColors;
  borderRadius: number;
}

export interface UIThemeUpdate {
  colors?: Partial<UIThemeColors>;
  borderRadius?: number;
}

export const defaultTheme: UITheme = {
  colors: {
    surface: '#202124',
    raisedSurface: '#303134',
    primary: '#8ab4f8',
    primaryText: '#202124',
    text: '#f1f3f4',
    secondaryText: '#bdc1c6',
    outline: '#5f6368',
    disabledSurface: '#3c4043',
    disabledText: '#9aa0a6',
  },
  borderRadius: 16,
};

export function createTheme(initial: UITheme): {
  proxy: UITheme;
  assign(value: UIThemeUpdate): void;
  revision(): number;
} {
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
  const target = {colors, borderRadius: initial.borderRadius};
  const proxy = new Proxy(target, {
    set(theme, property, value) {
      if (property === 'colors') {
        validateColorUpdate(value, colorsTarget);
        Object.assign(colors, value);
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
        if (property !== 'colors' && property !== 'borderRadius') {
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
      if (value.colors) Object.assign(colors, value.colors);
      if (value.borderRadius !== undefined)
        proxy.borderRadius = value.borderRadius;
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
