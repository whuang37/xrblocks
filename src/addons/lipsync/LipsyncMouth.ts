import {Script} from 'xrblocks';

import {ZERO_VISEME} from './BlendshapeReducer';
import {computeAudioFeatures} from './computeAudioFeatures';
import {FormantVisemeMapper} from './FormantVisemeMapper';
import {StylizedMouth} from './StylizedMouth';

export interface LipsyncMouthOptions {
  /**
   * Reuse an existing `AudioContext` instead of creating a new one.
   * Browsers cap the number of contexts per page (typically 6-8), so when
   * driving multiple peer streams (one mouth per peer) pass the shared
   * context from `xb.core.sound.listener.context` or
   * `THREE.AudioContext.getContext()`. When provided, this class will not
   * close the context on `dispose()`.
   */
  audioContext?: AudioContext;
  /** AnalyserNode FFT size; must be a power of two. Defaults to 1024. */
  fftSize?: number;
  /**
   * Below this RMS the viseme target is forced to zero so background noise
   * doesn't drive the mouth. Default 0.01.
   */
  silenceThreshold?: number;
  /**
   * Approximate radius (metres) of the host head this mouth will sit on.
   * Used to scale and position the stylised mouth mesh. Defaults to 0.1
   * to match netblocks `RemoteUserAvatar`'s head sphere; pass 0.18 (for
   * example) if attaching to a bigger custom head.
   */
  headRadius?: number;
  /**
   * Draw a pair of static eye dots above the mouth on the same canvas
   * decal so a bare avatar head sphere reads as a face. Defaults to
   * true. Set false when the host avatar already has its own eye
   * geometry.
   */
  showEyes?: boolean;
}

/**
 * `LipsyncMouth` drives a stylised mouth attached to any `Object3D` from a
 * `MediaStream`. Designed to plug into any avatar that has a head pivot,
 * including netblocks `RemoteUserAvatar.headPivot` for per-peer mouth
 * animation.
 *
 * Extends `xb.Script` so the xrblocks scripts manager calls `init()` once
 * the instance is part of the active scene and `update(time)` every
 * frame. `dispose()` is called automatically when removed from the scene
 * graph; it disconnects audio nodes and releases the mouth geometry. It
 * deliberately never stops the input `MediaStream` tracks (the caller
 * owns those) and never closes a caller-supplied `AudioContext`.
 *
 * @example
 *   const mouth = new LipsyncMouth(myMicStream);
 *   headPivot.add(mouth);
 *   // ... when done:
 *   headPivot.remove(mouth);  // triggers dispose()
 */
export class LipsyncMouth extends Script {
  /** Latest viseme weights applied to the mouth (read-only convenience). */
  readonly mouth: StylizedMouth;

  private readonly stream: MediaStream;
  private readonly fftSize: number;
  private readonly silenceThreshold: number;
  private readonly externalContext: boolean;

  private ctx?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  // TS lib.dom expects Uint8Array<ArrayBuffer> on the analyser methods,
  // not the looser Uint8Array<ArrayBufferLike> that the default
  // `new Uint8Array(n)` produces. Pin the buffer type so the calls below
  // type-check under strict rollup-typescript.
  private freqData?: Uint8Array<ArrayBuffer>;
  private timeData?: Uint8Array<ArrayBuffer>;
  private primer?: HTMLAudioElement;

  private readonly mapper = new FormantVisemeMapper();
  private lastTime = 0;

  constructor(stream: MediaStream, opts: LipsyncMouthOptions = {}) {
    super();
    this.stream = stream;
    this.fftSize = opts.fftSize ?? 1024;
    this.silenceThreshold = opts.silenceThreshold ?? 0.01;
    this.externalContext = !!opts.audioContext;
    this.ctx = opts.audioContext;
    this.mouth = new StylizedMouth({
      headRadius: opts.headRadius,
      showEyes: opts.showEyes,
    });
    this.add(this.mouth);
  }

  override async init(): Promise<void> {
    if (!this.ctx) {
      // Fall back to a fresh context; prefer this only for single-mouth
      // demos. Multi-peer callers should pass a shared context.
      this.ctx = new AudioContext();
    }
    // Browsers create the shared AudioContext suspended until a user
    // gesture. resume() is a no-op when already running.
    void this.ctx.resume?.().catch(() => undefined);

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.4;
    this.source.connect(this.analyser);

    this.freqData = new Uint8Array(
      new ArrayBuffer(this.analyser.frequencyBinCount)
    );
    this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));

    // Chromium WebRTC quirk: a MediaStreamAudioSourceNode built from a
    // remote stream stays silent unless the stream is also being pumped
    // by an HTMLMediaElement. Same fix SpatialVoice uses. Harmless for
    // local mic streams.
    if (typeof document !== 'undefined') {
      const primer = document.createElement('audio');
      primer.muted = true;
      primer.autoplay = true;
      primer.srcObject = this.stream;
      // play() returns a Promise on modern browsers, undefined on older
      // ones (and in jsdom). Optional-chain both.
      const playP = primer.play();
      playP?.catch?.(() => undefined);
      this.primer = primer;
    }
  }

  override update(time?: number): void {
    if (!this.analyser || !this.freqData || !this.timeData) return;
    // xrblocks passes `time` in milliseconds (matches the rest of the
    // codebase — see e.g. netblocks samples). Convert to seconds so the
    // mapper's `1 - exp(-dt / tau)` smoothing stays frame-rate
    // independent across 60/72/90/120 Hz XR refresh.
    const nowMs = typeof time === 'number' ? time : performance.now();
    const dt = this.lastTime
      ? Math.max(0.001, Math.min(0.1, (nowMs - this.lastTime) / 1000))
      : 0.016;
    this.lastTime = nowMs;

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);
    const features = computeAudioFeatures(
      {freqData: this.freqData, timeData: this.timeData},
      this.ctx!.sampleRate
    );

    if (features.rms < this.silenceThreshold) {
      // True silence: collapse the mouth to its rest pose. Reset the
      // mapper so a subsequent voiced frame doesn't smooth from a
      // stale-but-zero internal state, and explicitly write ZERO_VISEME
      // — `setVisemes(this.mouth.visemes)` would reapply whatever shape
      // was last drawn, leaving the mouth frozen open after a mid-word
      // mute or peer disconnect.
      this.mapper.reset();
      this.mouth.setVisemes(ZERO_VISEME);
      return;
    }

    const visemes = this.mapper.update(features, dt);
    this.mouth.setVisemes(visemes);
  }

  override dispose(): void {
    try {
      this.source?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.analyser?.disconnect();
    } catch {
      // ignore
    }
    if (this.primer) {
      try {
        this.primer.pause();
      } catch {
        // ignore
      }
      this.primer.srcObject = null;
      this.primer = undefined;
    }
    if (this.ctx && !this.externalContext) {
      // Only close contexts we created.
      void this.ctx.close?.().catch(() => undefined);
    }
    this.mouth.dispose();
    this.remove(this.mouth);
    this.source = undefined;
    this.analyser = undefined;
    this.freqData = undefined;
    this.timeData = undefined;
    this.ctx = undefined;
  }
}

// Re-export for convenience so consumers can subscribe to viseme weights
// without importing from the reducer file directly.
export type {VisemeWeights} from './BlendshapeReducer';
