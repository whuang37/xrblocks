import * as THREE from 'three';

import type {SelectEvent} from '../../core/Script';
import {registerSemanticControl} from '../../interaction/SemanticControl';
import {clamp} from '../../utils/utils';
import {XRUI} from '../mixins/XRUI';
import {
  GradientPanel,
  type GradientPanelProperties,
} from '../primitives/GradientPanel';
import type {Paint} from '../types/ShaderTypes';
import {FreestandingSlider} from '../interaction/FreestandingSlider';

/** Initialization properties for a horizontal spatial slider. */
export interface UISliderProperties extends GradientPanelProperties {
  /** Accessible control name. */
  ariaLabel: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  disabled?: boolean;
  /** Controller travel in meters that spans the complete value range. */
  dragDistance?: number;
  trackColor?: Paint;
  progressColor?: Paint;
  thumbColor?: Paint;
  trackHeight?: number;
  thumbSize?: number;
  onChange?: (value: number) => void;
}

const SliderBase = XRUI(GradientPanel);

/** A horizontal slider that captures one controller until selection ends. */
export class UISlider extends SliderBase {
  name = 'UISlider';
  readonly ariaLabel: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  onChange?: (value: number) => void;

  private _value: number;
  private _disabled: boolean;
  private activeController?: THREE.Object3D;
  private readonly motion: FreestandingSlider;
  private readonly progress: GradientPanel;
  private readonly thumb: GradientPanel;

  constructor({
    ariaLabel,
    min = 0,
    max = 1,
    step = 0.01,
    value = min,
    disabled = false,
    dragDistance = 0.25,
    trackColor = 'rgba(255, 255, 255, 0.25)',
    progressColor = '#4796e3',
    thumbColor = '#ffffff',
    trackHeight = 10,
    thumbSize = 28,
    onChange,
    ...properties
  }: UISliderProperties) {
    validateRange(min, max, step, dragDistance);
    super({
      width: 240,
      height: 44,
      cornerRadius: 22,
      fillColor: 'rgba(0, 0, 0, 0)',
      pointerEvents: 'auto',
      ...properties,
    });

    this.ariaLabel = ariaLabel;
    this.min = min;
    this.max = max;
    this.step = step;
    this._value = quantize(value, min, max, step);
    this._disabled = disabled;
    this.onChange = onChange;
    this.interactionEnabled = !disabled;
    this.motion = new FreestandingSlider(
      this._value,
      min,
      max,
      (max - min) / dragDistance
    );

    const track = new GradientPanel({
      positionType: 'absolute',
      positionLeft: 0,
      positionRight: 0,
      positionTop: '50%',
      transformTranslateY: -trackHeight / 2,
      height: trackHeight,
      cornerRadius: trackHeight / 2,
      fillColor: trackColor,
      pointerEvents: 'none',
    });
    this.progress = new GradientPanel({
      positionType: 'absolute',
      positionLeft: 0,
      positionTop: '50%',
      transformTranslateY: -trackHeight / 2,
      height: trackHeight,
      cornerRadius: trackHeight / 2,
      fillColor: progressColor,
      pointerEvents: 'none',
    });
    this.thumb = new GradientPanel({
      positionType: 'absolute',
      positionTop: '50%',
      width: thumbSize,
      height: thumbSize,
      transformTranslateX: -thumbSize / 2,
      transformTranslateY: -thumbSize / 2,
      cornerRadius: thumbSize / 2,
      fillColor: thumbColor,
      pointerEvents: 'none',
    });
    this.add(track, this.progress, this.thumb);
    this.updateVisuals();

    registerSemanticControl(this, {
      isDisabled: () => this._disabled,
      activate: () => this.setValue(this._value + this.step, true),
    });

    // The child shader layers provide the physical hit surfaces. The slider
    // remains the logical interaction owner.
    this.raycast = () => {};
  }

  get value(): number {
    return this._value;
  }

  set value(value: number) {
    this.setValue(value);
  }

  get disabled(): boolean {
    return this._disabled;
  }

  set disabled(value: boolean) {
    this._disabled = value;
    this.interactionEnabled = !value;
    if (value) this.activeController = undefined;
  }

  /** Updates the value. User-originated updates can emit `onChange`. */
  setValue(value: number, emit = false): void {
    const next = quantize(value, this.min, this.max, this.step);
    if (next === this._value) return;
    this._value = next;
    this.motion.updateValue(next);
    this.updateVisuals();
    if (emit) this.onChange?.(next);
  }

  onObjectSelectStart(event: SelectEvent): true {
    if (!this._disabled) {
      this.activeController = event.target;
      this.motion.updateValue(this._value);
      this.motion.setInitialPoseFromController(event.target);
    }
    return true;
  }

  onObjectSelectEnd(event: SelectEvent): true {
    if (this.activeController === event.target) {
      this.activeController = undefined;
      this.motion.updateValue(this._value);
    }
    return true;
  }

  override update(): void {
    super.update();
    const controller = this.activeController;
    if (!controller || controller.userData.selected !== true) return;
    this.setValue(this.motion.getValueFromController(controller), true);
  }

  private updateVisuals(): void {
    const percentage = ((this._value - this.min) / (this.max - this.min)) * 100;
    this.progress.setProperties({width: `${percentage}%`});
    this.thumb.setProperties({positionLeft: `${percentage}%`});
  }
}

function validateRange(
  min: number,
  max: number,
  step: number,
  dragDistance: number
): void {
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    !Number.isFinite(step) ||
    !Number.isFinite(dragDistance) ||
    max <= min ||
    step <= 0 ||
    dragDistance <= 0
  ) {
    throw new Error(
      'UISlider requires finite values with max > min, step > 0, and dragDistance > 0.'
    );
  }
}

function quantize(
  value: number,
  min: number,
  max: number,
  step: number
): number {
  const finiteValue = Number.isFinite(value) ? value : min;
  const stepped = min + Math.round((finiteValue - min) / step) * step;
  return clamp(Number(stepped.toPrecision(12)), min, max);
}
