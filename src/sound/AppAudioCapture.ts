import {
  arrayBufferToBase64,
  concatInt16,
  encodeWav,
  float32ToInt16,
} from './AudioDataUtils';

export type AppAudioCaptureResult = {
  audioBase64: string | null;
  mimeType: 'audio/wav';
  sampleRate: number;
  durationMs: number;
  byteLength: number;
};

export class AppAudioCapture {
  private chunks: Int16Array[] = [];
  private sampleRate = 0;

  appendPCM(buffer: ArrayBuffer, sampleRate: number) {
    this.appendInt16(new Int16Array(buffer.slice(0)), sampleRate);
  }

  appendFloat32(samples: Float32Array, sampleRate: number) {
    this.appendInt16(float32ToInt16(samples), sampleRate);
  }

  appendInt16(samples: Int16Array, sampleRate: number) {
    if (samples.length === 0) return;
    if (!this.sampleRate) {
      this.sampleRate = sampleRate;
    }
    const normalizedSamples =
      sampleRate === this.sampleRate
        ? samples
        : resampleInt16(samples, sampleRate, this.sampleRate);
    this.chunks.push(new Int16Array(normalizedSamples));
  }

  exportWav({clear = false}: {clear?: boolean} = {}): AppAudioCaptureResult {
    const pcm = concatInt16(this.chunks);
    const sampleRate = this.sampleRate || 0;
    if (!pcm.length || !sampleRate) {
      return {
        audioBase64: null,
        mimeType: 'audio/wav',
        sampleRate,
        durationMs: 0,
        byteLength: 0,
      };
    }

    const wav = encodeWav(pcm, sampleRate);
    const result = {
      audioBase64: arrayBufferToBase64(wav),
      mimeType: 'audio/wav' as const,
      sampleRate,
      durationMs: (pcm.length / sampleRate) * 1000,
      byteLength: wav.byteLength,
    };
    if (clear) {
      this.clear();
    }
    return result;
  }

  clear() {
    this.chunks = [];
    this.sampleRate = 0;
  }
}

function resampleInt16(
  samples: Int16Array,
  sourceSampleRate: number,
  targetSampleRate: number
) {
  if (sourceSampleRate <= 0 || targetSampleRate <= 0) {
    throw new Error('Sample rates must be positive.');
  }
  if (sourceSampleRate === targetSampleRate) {
    return samples;
  }

  const length = Math.max(
    1,
    Math.round(samples.length * (targetSampleRate / sourceSampleRate))
  );
  const output = new Int16Array(length);
  const ratio = sourceSampleRate / targetSampleRate;

  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const nextIndex = Math.min(index + 1, samples.length - 1);
    const fraction = position - index;
    output[i] = Math.round(
      samples[index] + (samples[nextIndex] - samples[index]) * fraction
    );
  }
  return output;
}
