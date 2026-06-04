import {deepMerge} from '../../utils/OptionsUtils';
import {DeepPartial, DeepReadonly} from '../../utils/Types';
import type {GestureRecognizer, PoseEstimator} from './GestureTypes';
import {HeuristicGestureRecognizer} from './gestureRecognizers/HeuristicGestureRecognizer';
import {WebXRHandPoseEstimator} from './poseEstimators/WebXRHandPoseEstimator';

export type GestureProvider = 'heuristics' | 'mediapipe' | 'tfjs';

export type BuiltInGestureName =
  | 'pinch'
  | 'open-palm'
  | 'fist'
  | 'thumbs-up'
  | 'point'
  | 'spread';

export type GestureConfiguration = {
  enabled: boolean;
  /**
   * Optional override for gesture-specific score thresholds. For distance based
   * gestures this is treated as a maximum distance; for confidence based
   * gestures it is treated as a minimum score.
   */
  threshold?: number;
};

export type GestureConfigurations = Record<
  string,
  Partial<GestureConfiguration>
>;

export class GestureRecognitionOptions {
  /** Master switch for the gesture recognition block. */
  enabled = false;

  /**
   * Backing provider that extracts gesture information.
   *  - 'heuristics': WebXR joint heuristics only (no external ML dependency).
   *  - 'mediapipe': MediaPipe Hands running via Web APIs / wasm.
   *  - 'tfjs': TensorFlow.js hand-pose-detection models.
   */
  provider: GestureProvider = 'heuristics';

  /**
   * Minimum confidence score to emit gesture events. Different providers map to
   * different score domains so this value is normalised to [0-1].
   */
  minimumConfidence = 0.6;

  /**
   * Optional throttle window for expensive providers.
   */
  updateIntervalMs = 33;

  poseEstimator: PoseEstimator = new WebXRHandPoseEstimator();

  gestureRecognizer: GestureRecognizer = new HeuristicGestureRecognizer();

  /**
   * Gesture catalogue. Defaults are supplied by the configured gesture
   * recognizer.
   */
  gestures: Record<string, GestureConfiguration> = {};

  constructor(options?: DeepReadonly<DeepPartial<GestureRecognitionOptions>>) {
    const customPoseEstimator = options?.poseEstimator as
      | PoseEstimator
      | undefined;
    const customGestureRecognizer = options?.gestureRecognizer as
      | GestureRecognizer
      | undefined;
    const gestureOverrides = options?.gestures;

    if (options) {
      const optionsWithoutRecognizers = {...options};
      delete optionsWithoutRecognizers.poseEstimator;
      delete optionsWithoutRecognizers.gestureRecognizer;
      delete optionsWithoutRecognizers.gestures;
      deepMerge(this, optionsWithoutRecognizers);
    }

    if (customPoseEstimator) {
      this.poseEstimator = customPoseEstimator;
    }
    if (customGestureRecognizer) {
      this.gestureRecognizer = customGestureRecognizer;
    }

    this.applyGestureRecognizerConfigurations();

    if (gestureOverrides) {
      for (const [name, config] of Object.entries(gestureOverrides)) {
        this.setGestureConfig(name, config as Partial<GestureConfiguration>);
      }
    }
  }

  enable() {
    this.enabled = true;
    return this;
  }

  /**
   * Convenience helper to toggle specific gestures.
   */
  setGestureEnabled(name: string, enabled: boolean) {
    this.gestures[name] ??= {enabled};
    this.gestures[name].enabled = enabled;
    return this;
  }

  setPoseEstimator(poseEstimator: PoseEstimator) {
    this.poseEstimator = poseEstimator;
    return this;
  }

  setGestureRecognizer(gestureRecognizer: GestureRecognizer) {
    this.gestureRecognizer = gestureRecognizer;
    this.gestures = {};
    this.applyGestureRecognizerConfigurations();
    return this;
  }

  setGestureConfig(name: string, config: Partial<GestureConfiguration>) {
    const mergedConfig = {
      ...this.gestures[name],
      enabled: this.gestures[name]?.enabled ?? true,
    } as GestureConfiguration;
    deepMerge(mergedConfig, config);
    this.gestures[name] = mergedConfig;
    return this;
  }

  private applyGestureRecognizerConfigurations() {
    const configs = this.gestureRecognizer.getGestureConfigurations?.() ?? {};
    for (const [name, config] of Object.entries(configs)) {
      this.setGestureConfig(name, config);
    }
  }
}
