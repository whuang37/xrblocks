import type {UITheme, UIThemePresetName, UIThemeUpdate} from './UITheme';
import {createTheme, defaultTheme, uiThemePresets} from './UITheme';

/** Lightweight global UI settings. It does not load the rendering backend. */
export class UI {
  private readonly themeState = createTheme(defaultTheme);

  get theme(): UITheme {
    return this.themeState.proxy;
  }

  set theme(value: UIThemePresetName | UIThemeUpdate) {
    if (typeof value === 'string') {
      const preset = uiThemePresets[value];
      if (!preset) throw new Error(`Unknown UI theme preset "${value}".`);
      this.themeState.replace(preset);
    } else {
      this.themeState.assign(value);
    }
  }

  /** Internal revision used by the private renderer. */
  get revision(): number {
    return this.themeState.revision();
  }
}

export const ui = new UI();
