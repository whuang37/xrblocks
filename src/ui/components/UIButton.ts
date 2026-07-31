import type {SelectEvent} from '../../core/Script';
import {registerSemanticControl} from '../../interaction/SemanticControl';
import {UIIcon} from './UIIcon';
import {UIPanel, type UIPanelProperties} from './UIPanel';
import {UIText} from './UIText';

export interface UIButtonProperties extends Omit<UIPanelProperties, 'onClick'> {
  /** Optional text content created inside the button. */
  label?: string;
  /** Optional Material Symbol created before the label. */
  icon?: string;
  /** Accessible name. Required when the button has no text label. */
  ariaLabel?: string;
  /** Prevents selection and activation. */
  disabled?: boolean;
  /** Runs after a selection starts and ends on this button. */
  onClick?: () => void;
}

/** A semantic UI action backed by the shared interaction capture system. */
export class UIButton extends UIPanel {
  name = 'UIButton';
  readonly ariaLabel: string;
  onClick?: () => void;
  private _disabled: boolean;

  constructor({
    label,
    icon,
    ariaLabel,
    disabled = false,
    onClick,
    ...properties
  }: UIButtonProperties = {}) {
    const resolvedAriaLabel = ariaLabel ?? label;
    if (!resolvedAriaLabel) {
      throw new Error('UIButton requires ariaLabel when it has no label.');
    }

    super(properties);
    this.ariaLabel = resolvedAriaLabel;
    this.onClick = onClick;
    this._disabled = disabled;
    this.interactionEnabled = !disabled;

    if (icon) this.add(new UIIcon(icon));
    if (label) this.add(new UIText(label));

    registerSemanticControl(this, {
      isDisabled: () => this._disabled,
      activate: () => this.onClick?.(),
    });
  }

  get disabled(): boolean {
    return this._disabled;
  }

  set disabled(value: boolean) {
    this._disabled = value;
    this.interactionEnabled = !value;
  }

  onObjectSelectStart(_event: SelectEvent): true {
    return true;
  }

  onObjectSelectEnd(_event: SelectEvent): true {
    return true;
  }
}
