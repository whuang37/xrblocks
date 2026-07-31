import type {UITheme, UIThemeUpdate} from './UITheme';
import {createTheme, defaultTheme} from './UITheme';

/** Lightweight global UI settings. It does not load the rendering backend. */
export class UI {
  private readonly themeState = createTheme(defaultTheme);

  get theme(): UITheme {
    return this.themeState.proxy;
  }

  set theme(value: UIThemeUpdate) {
    this.themeState.assign(value);
  }

  /** Internal revision used by the private renderer. */
  get revision(): number {
    return this.themeState.revision();
  }
}

export const ui = new UI();
