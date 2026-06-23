import type {AudioClassifierResult} from 'xrblocks';
import {Sensor, type SensorContext, type SensorsOptions} from '../SensorsTypes';

export interface SoundSensorSnapshot {
  isListening: boolean;
  latest: AudioClassifierResult | null;
  history: AudioClassifierResult[];
}

interface SoundSensorOptions extends SensorsOptions {
  historySize?: number;
}

interface SoundDetectedEvent {
  audioClassifierResult: AudioClassifierResult;
}

type SoundDetectorLike = {
  isListening: boolean;
  startListening(): Promise<void>;
  addEventListener(
    type: 'soundDetected',
    listener: (event: SoundDetectedEvent) => void
  ): void;
};

export class SoundSensor extends Sensor<SoundSensorSnapshot> {
  readonly key = 'sound';

  private attachedDetector?: SoundDetectorLike;
  private latest: AudioClassifierResult | null = null;
  private history: AudioClassifierResult[] = [];
  private startPromise: Promise<void> | null = null;

  constructor(options: SoundSensorOptions = {}) {
    super(options);
  }

  override mergeOptions(options?: SoundSensorOptions): void {
    const currentHistorySize =
      (this.options as SoundSensorOptions | undefined)?.historySize ?? 5;
    const nextHistorySize = options?.historySize;

    super.mergeOptions(options);

    if (nextHistorySize !== undefined) {
      (this.options as SoundSensorOptions).historySize = Math.max(
        currentHistorySize,
        nextHistorySize
      );
    }
  }

  async update(context: SensorContext): Promise<SoundSensorSnapshot> {
    const detector = context.core.world.sounds as SoundDetectorLike | undefined;
    if (!detector) {
      return {isListening: false, latest: null, history: []};
    }

    this.attach(detector);

    if (!detector.isListening) {
      this.startPromise ??= detector.startListening().finally(() => {
        this.startPromise = null;
      });
      await this.startPromise;
    }

    return {
      isListening: detector.isListening,
      latest: this.latest,
      history: [...this.history],
    };
  }

  private attach(detector: SoundDetectorLike) {
    if (this.attachedDetector === detector) {
      return;
    }

    this.attachedDetector = detector;
    detector.addEventListener('soundDetected', (event) => {
      const result = event.audioClassifierResult;
      this.latest = result;
      this.history.push(result);

      const historySize =
        (this.options as SoundSensorOptions | undefined)?.historySize ?? 5;
      if (this.history.length > historySize) {
        this.history.splice(0, this.history.length - historySize);
      }
    });
  }
}
