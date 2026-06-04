import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as THREE from 'three';

// Mock xrblocks so importing `Script` doesn't trigger the Core singleton,
// which constructs a real AudioContext (jsdom can't provide one).
vi.mock('xrblocks', async () => {
  const T = await import('three');
  return {Script: T.Object3D, core: {camera: undefined}};
});

import {LipsyncMouth} from './LipsyncMouth';

// Minimal in-memory Web Audio mock: only what LipsyncMouth touches.
// AnalyserNode emits fixed-shape (silent) buffers; tests stub
// freqData/timeData via `(node as any).__setSpectrum()` to drive the mapper.
class MockAnalyserNode {
  fftSize = 1024;
  frequencyBinCount = 512;
  smoothingTimeConstant = 0.4;
  private _freq = new Uint8Array(this.frequencyBinCount);
  private _freqDb = new Float32Array(this.frequencyBinCount).fill(-120);
  private _time = new Uint8Array(this.fftSize).fill(128);
  connect = vi.fn();
  disconnect = vi.fn();
  getByteFrequencyData(out: Uint8Array) {
    out.set(this._freq);
  }
  getFloatFrequencyData(out: Float32Array) {
    out.set(this._freqDb);
  }
  getByteTimeDomainData(out: Uint8Array) {
    out.set(this._time);
  }
  __setLoudVoiced() {
    // Strong low-band + a F1/F2-shaped pair, plus non-silent time domain.
    for (let i = 0; i < 30; i++) this._freq[i] = 200;
    this._freq[20] = 255;
    this._freq[48] = 230;
    for (let i = 0; i < this._time.length; i++) {
      this._time[i] = 128 + Math.round(64 * Math.sin((i / 8) * Math.PI));
    }
  }
  __setSilent() {
    this._freq.fill(0);
    this._freqDb.fill(-120);
    this._time.fill(128);
  }
  /** Set the time-domain buffer so computeAudioFeatures sees ~targetRms. */
  __setRms(targetRms: number) {
    // sin wave amplitude a → RMS = a / sqrt(2). Solve for the byte
    // amplitude needed: int 128 + a*128 produces amplitude a in
    // [-1,1] space, hence RMS = a/sqrt(2). So a = targetRms * sqrt(2).
    const a = Math.min(0.99, targetRms * Math.SQRT2);
    for (let i = 0; i < this._time.length; i++) {
      this._time[i] = 128 + Math.round(a * 127 * Math.sin((i / 8) * Math.PI));
    }
    this._freq.fill(0);
    this._freqDb.fill(-120);
  }
}

class MockMediaStreamSource {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioContext {
  sampleRate = 48000;
  state = 'running';
  createAnalyser = vi.fn(() => new MockAnalyserNode());
  createMediaStreamSource = vi.fn(() => new MockMediaStreamSource());
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
}

function makeStream(): MediaStream {
  // jsdom provides a MediaStream shim sufficient for our needs.
  return new (globalThis.MediaStream ??
    (class {} as unknown as typeof MediaStream))();
}

let ctx: MockAudioContext;

beforeEach(() => {
  ctx = new MockAudioContext();
});

describe('LipsyncMouth', () => {
  it('is a THREE.Object3D suitable for parenting to a head pivot', () => {
    const m = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
    });
    expect(m.isObject3D).toBe(true);
  });

  it('constructor + init() builds the audio graph from the injected AudioContext', async () => {
    const m = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
    });
    await m.init();
    expect(ctx.createMediaStreamSource).toHaveBeenCalled();
    expect(ctx.createAnalyser).toHaveBeenCalled();
  });

  it('mouth child is added under the LipsyncMouth and follows it', async () => {
    const m = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
    });
    await m.init();
    expect(m.children.length).toBeGreaterThan(0);
    expect(m.children.some((c) => c instanceof THREE.Object3D)).toBe(true);
  });

  it('update() drives the mouth visemes when audio is loud / voiced', async () => {
    const m = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
    });
    await m.init();
    // Drive enough frames to overcome the smoothing time constant.
    const analyser = ctx.createAnalyser.mock.results[0]
      .value as MockAnalyserNode;
    analyser.__setLoudVoiced();
    for (let i = 0; i < 50; i++) m.update(i * 0.016);
    expect(m.mouth.visemes.jawOpen).toBeGreaterThan(0.05);
  });

  it('silent input → mouth stays at rest', async () => {
    const m = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
    });
    await m.init();
    for (let i = 0; i < 50; i++) m.update(i * 16);
    expect(m.mouth.visemes.jawOpen).toBeLessThan(0.05);
  });

  it('loud then silent: brief silence holds visemes; sustained silence decays them', async () => {
    const m = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
      // Default silenceHoldMs is 150; keep default for this test.
    });
    await m.init();
    const analyser = ctx.createAnalyser.mock.results[0]
      .value as MockAnalyserNode;
    analyser.__setLoudVoiced();
    for (let i = 0; i < 60; i++) m.update(i * 16);
    const peakJaw = m.mouth.visemes.jawOpen;
    expect(peakJaw).toBeGreaterThan(0.05);

    // First silent frames within the 150 ms hold window: mouth held in
    // place, no decay started yet. Brief gaps (~one frame) between
    // syllables should not cause any jitter.
    analyser.__setSilent();
    m.update(60 * 16 + 16);
    expect(m.mouth.visemes.jawOpen).toBe(peakJaw);
    m.update(60 * 16 + 80);
    expect(m.mouth.visemes.jawOpen).toBe(peakJaw);

    // Past the hold window: mapper smoothing starts pulling toward zero.
    for (let i = 0; i < 40; i++) m.update(60 * 16 + 200 + i * 16);
    expect(m.mouth.visemes.jawOpen).toBeLessThan(0.02);
    expect(m.mouth.visemes.aa).toBeLessThan(0.02);
    expect(m.mouth.visemes.ee).toBeLessThan(0.02);
    expect(m.mouth.visemes.oo).toBeLessThan(0.02);
    expect(m.mouth.visemes.consonant).toBeLessThan(0.02);
  });

  it('voiced resumes mid-hold: silence timer resets, mouth never began decaying', async () => {
    const m = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
    });
    await m.init();
    const analyser = ctx.createAnalyser.mock.results[0]
      .value as MockAnalyserNode;
    analyser.__setLoudVoiced();
    for (let i = 0; i < 60; i++) m.update(i * 16);
    const peakJaw = m.mouth.visemes.jawOpen;

    // 100 ms silent gap (within the 150 ms hold), then voiced again.
    analyser.__setSilent();
    m.update(60 * 16 + 50);
    m.update(60 * 16 + 100);
    expect(m.mouth.visemes.jawOpen).toBe(peakJaw);
    analyser.__setLoudVoiced();
    m.update(60 * 16 + 116);
    // The mouth should still be active (mapper continued from where it
    // left off; no decay happened during the brief gap).
    expect(m.mouth.visemes.jawOpen).toBeGreaterThan(peakJaw * 0.8);
  });

  it('Schmitt hysteresis: noise-floor RMS chatter around silenceThreshold still accumulates the hold timer', async () => {
    // Default silenceThreshold is 0.01, so exit threshold is 0.0125.
    // Mic noise that hovers between 0.008 and 0.011 must read as
    // "still silent" once we're inside the silence window, so the
    // hold timer can finish and the mapper eventually closes the mouth.
    const m = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
      silenceHoldMs: 100,
    });
    await m.init();
    const analyser = ctx.createAnalyser.mock.results[0]
      .value as MockAnalyserNode;
    analyser.__setLoudVoiced();
    for (let i = 0; i < 60; i++) m.update(i * 16);
    const peakJaw = m.mouth.visemes.jawOpen;
    expect(peakJaw).toBeGreaterThan(0.05);

    // Now drop to noise-floor chatter: alternating RMS just below and
    // just above the entry threshold (0.01), but always below the
    // exit threshold (0.0125).
    for (let i = 0; i < 30; i++) {
      analyser.__setRms(i % 2 === 0 ? 0.008 : 0.011);
      m.update(60 * 16 + i * 16);
    }
    // After ~480 ms of chatter we should be past the 100 ms hold and
    // well into mapper decay; the mouth must have moved off its peak.
    expect(m.mouth.visemes.jawOpen).toBeLessThan(peakJaw * 0.4);
  });

  it('dispose() disconnects analyser + source and removes the mouth child', async () => {
    const m = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
    });
    await m.init();
    const source = ctx.createMediaStreamSource.mock.results[0]
      .value as MockMediaStreamSource;
    const analyser = ctx.createAnalyser.mock.results[0]
      .value as MockAnalyserNode;
    m.dispose();
    expect(source.disconnect).toHaveBeenCalled();
    expect(analyser.disconnect).toHaveBeenCalled();
    expect(m.children.length).toBe(0);
  });

  it('dispose() does NOT close the injected AudioContext (caller owns it)', async () => {
    const m = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
    });
    await m.init();
    m.dispose();
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('dispose() does NOT stop MediaStream tracks (caller owns the stream)', async () => {
    const stream = makeStream();
    const track = {
      stop: vi.fn(),
      kind: 'audio',
      enabled: true,
    } as unknown as MediaStreamTrack;
    // jsdom MediaStream doesn't expose addTrack consistently; monkey-patch
    // getTracks instead since that's what consumers iterate.
    (stream as unknown as {getTracks: () => MediaStreamTrack[]}).getTracks =
      () => [track];
    const m = new LipsyncMouth(stream, {
      audioContext: ctx as unknown as AudioContext,
    });
    await m.init();
    m.dispose();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('two LipsyncMouths can share one AudioContext', async () => {
    const m1 = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
    });
    const m2 = new LipsyncMouth(makeStream(), {
      audioContext: ctx as unknown as AudioContext,
    });
    await m1.init();
    await m2.init();
    expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(2);
    // Disposing one leaves the other working.
    m1.dispose();
    expect(ctx.close).not.toHaveBeenCalled();
    expect(m2.children.length).toBeGreaterThan(0);
    m2.dispose();
  });
});
