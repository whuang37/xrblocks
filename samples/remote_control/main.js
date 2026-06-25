import * as THREE from 'three';
import * as xb from 'xrblocks';
import 'xrblocks/addons/simulator/SimulatorAddons.js';
import {RemoteControl} from 'xrblocks/addons/remote-control/index.js';

const RELAY_URL =
  new URLSearchParams(location.search).get('remoteControlUrl') ||
  'ws://127.0.0.1:8791';
const SESSION_ID =
  new URLSearchParams(location.search).get('remoteControlSession') || 'default';
const STT_SAMPLE_RATE = 16000;

const options = RemoteControl.configureOptions(new xb.Options());
options.enableAI();
options.setAppTitle('Remote Control Smoke Test');

class RemoteControlSmokeScene extends xb.Script {
  cube;
  label;
  nudgeCount = 0;
  sttRunning = false;
  sttStarting = null;
  sttBuffer = '';
  sttLastTranscript = '';
  sttLastPartial = '';
  sttLastFinal = '';
  sttLastError = '';
  sttEvents = 0;
  geminiOutputTranscript = '';
  pendingGeminiOutput = null;

  init() {
    this.add(new THREE.HemisphereLight(0xffffff, 0x505050, 3));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(1.5, 2.5, 1.5);
    this.add(keyLight);

    const material = new THREE.MeshStandardMaterial({
      color: 0x58d68d,
      roughness: 0.45,
      metalness: 0.05,
    });
    this.cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.35, 0.35),
      material
    );
    this.cube.name = 'Remote Control Smoke Cube';
    this.resetCube();
    this.add(this.cube);

    this.label = document.createElement('aside');
    this.label.id = 'remote-control-smoke-status';
    this.label.textContent = `Remote control relay: ${RELAY_URL}\nSession: ${SESSION_ID}`;
    Object.assign(this.label.style, {
      position: 'fixed',
      left: '16px',
      top: '16px',
      maxWidth: '420px',
      padding: '12px 14px',
      borderRadius: '8px',
      background: 'rgba(8, 10, 14, 0.84)',
      color: '#fff',
      font: "13px/1.45 'Google Sans', 'Segoe UI', Roboto, Arial, sans-serif",
      zIndex: '20',
      whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(this.label);
  }

  dispose() {
    this.label?.remove();
  }

  getCubeState() {
    return {
      name: this.cube?.name,
      position: this.cube ? this.cube.position.toArray() : null,
      rotation: this.cube
        ? [this.cube.rotation.x, this.cube.rotation.y, this.cube.rotation.z]
        : null,
      nudgeCount: this.nudgeCount,
    };
  }

  resetCube() {
    if (!this.cube) return this.getCubeState();
    this.cube.position.set(0, 1.35, -1.6);
    this.cube.rotation.set(0, 0, 0);
    this.nudgeCount = 0;
    this.updateStatus('resetCube');
    return this.getCubeState();
  }

  nudgeCube(args = {}) {
    if (!this.cube) return this.getCubeState();
    const dx = Number(args.dx ?? 0.12);
    const dy = Number(args.dy ?? 0);
    const dz = Number(args.dz ?? 0);
    this.cube.position.x += dx;
    this.cube.position.y += dy;
    this.cube.position.z += dz;
    this.cube.rotation.y += 0.25;
    this.nudgeCount += 1;
    this.updateStatus('nudgeCube');
    xb.core.stepFrame(0);
    return this.getCubeState();
  }

  async startStt() {
    if (this.sttRunning) return this.getSttState();
    if (this.sttStarting) return this.sttStarting;
    if (!xb.core.ai?.isAvailable?.()) {
      throw new Error(
        'AI is not available. Open the sample with ?key=<gemini-api-key> or configure keys.json.'
      );
    }

    this.sttLastError = '';
    this.sttStarting = new Promise((resolve, reject) => {
      xb.core.ai.setLiveCallbacks({
        onopen: () => {
          this.sttRunning = true;
          xb.core.sound.setAIStreaming(true);
          this.updateStatus('startStt');
          resolve(this.getSttState());
        },
        onmessage: (message) => this.handleSttMessage(message),
        onerror: (error) => {
          this.sttLastError = error?.message || String(error);
          this.sttStarting = null;
          this.pendingGeminiOutput?.resolve();
          this.updateStatus('startSttError');
          reject(error);
        },
        onclose: () => {
          this.sttRunning = false;
          this.sttStarting = null;
          xb.core.sound.setAIStreaming(false);
          this.pendingGeminiOutput?.resolve();
          this.updateStatus('sttClosed');
        },
      });
      xb.core.ai
        .startLiveSession({inputAudioTranscription: {}})
        .catch((error) => {
          this.sttLastError = error?.message || String(error);
          this.sttStarting = null;
          this.updateStatus('startSttError');
          reject(error);
        });
    });
    return this.sttStarting;
  }

  getSttState() {
    return {
      running: this.sttRunning,
      transcript: this.sttLastTranscript,
      partial: this.sttLastPartial,
      final: this.sttLastFinal,
      events: this.sttEvents,
      error: this.sttLastError,
    };
  }

  async injectAudioForStt(args = {}) {
    await this.startStt();
    this.sttBuffer = '';
    this.sttLastTranscript = '';
    this.sttLastPartial = '';
    this.sttLastFinal = '';
    this.sttLastError = '';
    this.sttEvents = 0;
    this.updateStatus('injectAudioForStt');

    const injection = await streamAudioForStt(args);

    await new Promise((resolve) => setTimeout(resolve, args.waitMs ?? 2500));
    return {
      injection,
      stt: this.getSttState(),
    };
  }

  async geminiSayAndCaptureAudio(args = {}) {
    await this.startStt();
    const text = args.text ?? 'this is a test';
    const prompt = args.prompt ?? `Say exactly: "${text}"`;
    this.geminiOutputTranscript = '';
    xb.core.sound.getAppAudio({clear: true});
    this.updateStatus('geminiSayAndCaptureAudio');

    const liveSession = xb.core.ai?.model?.liveSession;
    if (!liveSession?.sendClientContent) {
      throw new Error('Gemini Live session is not ready for text input.');
    }

    const outputTurn = this.waitForGeminiOutputTurn(args.timeoutMs ?? 15000);
    liveSession.sendClientContent({
      turns: [
        {
          role: 'user',
          parts: [{text: prompt}],
        },
      ],
      turnComplete: true,
    });

    await outputTurn;
    const audio = xb.core.sound.getAppAudio({clear: true});
    return {
      text,
      prompt,
      outputTranscript: this.geminiOutputTranscript,
      audio,
    };
  }

  waitForGeminiOutputTurn(timeoutMs) {
    this.pendingGeminiOutput?.resolve();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingGeminiOutput = null;
        resolve();
      }, timeoutMs);
      this.pendingGeminiOutput = {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingGeminiOutput = null;
          // Let the final audio chunk reach AudioPlayer's capture sink.
          setTimeout(resolve, 250);
        },
      };
    });
  }

  handleSttMessage(message) {
    if (message.data) {
      xb.core.sound.playAIAudio(message.data);
    }

    const content = message.serverContent;
    const text = content?.inputTranscription?.text;
    if (text) {
      this.sttBuffer += text;
      this.sttLastPartial = this.sttBuffer.trim();
      this.sttLastTranscript = this.sttLastPartial;
      this.sttEvents += 1;
      this.updateStatus('sttPartial');
    }
    if (content?.turnComplete) {
      const finalText = this.sttBuffer.trim();
      this.sttBuffer = '';
      if (finalText) {
        this.sttLastFinal = finalText;
        this.sttLastTranscript = finalText;
        this.updateStatus('sttFinal');
      }
      this.pendingGeminiOutput?.resolve();
    }

    const outputText = content?.outputTranscription?.text;
    if (outputText) {
      this.geminiOutputTranscript += outputText;
      this.updateStatus('geminiOutput');
    }
  }

  updateStatus(action) {
    if (!this.label || !this.cube) return;
    const [x, y, z] = this.cube.position.toArray();
    this.label.textContent =
      `Remote control relay: ${RELAY_URL}\n` +
      `Session: ${SESSION_ID}\n` +
      `Last tool: ${action}\n` +
      `Cube position: ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}\n` +
      `Nudges: ${this.nudgeCount}\n` +
      `STT running: ${this.sttRunning}\n` +
      `STT transcript: ${this.sttLastTranscript || '(none)'}\n` +
      `Gemini output: ${this.geminiOutputTranscript || '(none)'}`;
  }
}

async function streamAudioForStt(args = {}) {
  const {pcm, sampleRate} = resolveAudioInput(args);
  const targetSampleRate = args.targetSampleRate ?? STT_SAMPLE_RATE;
  const audioPcm =
    sampleRate === targetSampleRate
      ? pcm
      : resampleInt16(pcm, sampleRate, targetSampleRate);
  const trailingSilence = new Int16Array(
    Math.round(targetSampleRate * ((args.trailingSilenceMs ?? 800) / 1000))
  );
  const streamPcm = concatInt16([audioPcm, trailingSilence]);
  const chunkMs = args.chunkMs ?? 40;
  const chunkSamples = Math.max(
    1,
    Math.floor(targetSampleRate * (chunkMs / 1000))
  );
  let chunksSent = 0;

  for (let offset = 0; offset < streamPcm.length; offset += chunkSamples) {
    const chunk = streamPcm.slice(offset, offset + chunkSamples);
    xb.core.sound.audioListener.handleAudioInputChunk(
      chunk.buffer,
      targetSampleRate
    );
    chunksSent++;
    await new Promise((resolve) => setTimeout(resolve, chunkMs));
  }

  return {
    completed: true,
    sampleRate: targetSampleRate,
    durationMs: (audioPcm.length / targetSampleRate) * 1000,
    chunksSent,
  };
}

function resolveAudioInput(args = {}) {
  const bytes = base64ToBytes(args.audioBase64);
  if (args.mimeType === 'audio/pcm') {
    if (!args.sampleRate) {
      throw new Error('sampleRate is required for audio/pcm input.');
    }
    return {
      pcm: new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2),
      sampleRate: args.sampleRate,
    };
  }
  return decodeWav(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
}

function decodeWav(buffer) {
  const view = new DataView(buffer);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Invalid WAV data.');
  }

  let offset = 12;
  let sampleRate = 0;
  let channelCount = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = -1;
  let dataByteLength = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;
    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(chunkDataOffset, true);
      channelCount = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataByteLength = chunkSize;
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (
    audioFormat !== 1 ||
    bitsPerSample !== 16 ||
    !sampleRate ||
    !channelCount ||
    dataOffset < 0
  ) {
    throw new Error('Only 16-bit PCM WAV data is supported.');
  }

  const pcm = new Int16Array(
    buffer.slice(dataOffset, dataOffset + dataByteLength)
  );
  if (channelCount === 1) {
    return {pcm, sampleRate};
  }

  const frames = pcm.length / channelCount;
  const mono = new Int16Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channelCount; channel++) {
      sum += pcm[frame * channelCount + channel];
    }
    mono[frame] = sum / channelCount;
  }
  return {pcm: mono, sampleRate};
}

function resampleInt16(samples, sourceSampleRate, targetSampleRate) {
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

function concatInt16(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Int16Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function readAscii(view, offset, length) {
  let value = '';
  for (let i = 0; i < length; i++) {
    value += String.fromCharCode(view.getUint8(offset + i));
  }
  return value;
}

const smokeScene = new RemoteControlSmokeScene();
xb.add(smokeScene);

xb.add(
  new RemoteControl({
    url: RELAY_URL,
    sessionId: SESSION_ID,
    reconnect: true,
    embodiedOptions: {autoPause: true, realTime: true},
    tools: {
      getCubeState: async () => smokeScene.getCubeState(),
      resetCube: async () => smokeScene.resetCube(),
      nudgeCube: async (args) => smokeScene.nudgeCube(args),
      startStt: async () => smokeScene.startStt(),
      getSttState: async () => smokeScene.getSttState(),
      injectAudioForStt: async (args) => smokeScene.injectAudioForStt(args),
      geminiSayAndCaptureAudio: async (args) =>
        smokeScene.geminiSayAndCaptureAudio(args),
    },
  })
);

await xb.init(options);
