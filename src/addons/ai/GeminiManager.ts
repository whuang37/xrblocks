import type * as GoogleGenAITypes from '@google/genai';
import * as THREE from 'three';
import * as xb from 'xrblocks';
import {AUDIO_CAPTURE_PROCESSOR_CODE} from './AudioCaptureProcessorCode';

const DEFAULT_SCHEDULE_AHEAD_TIME = 1.0;

export interface GeminiManagerEventMap extends THREE.Object3DEventMap {
  inputTranscription: {message: string};
  outputTranscription: {message: string};
  turnComplete: object;
  interrupted: object;
}

export class GeminiManager extends xb.Script<GeminiManagerEventMap> {
  // Core components
  xrDeviceCamera?: xb.XRDeviceCamera;
  ai!: xb.AI;

  // Audio setup
  audioStream: MediaStream | null = null;
  audioContext: AudioContext | null = null;
  sourceNode: MediaStreamAudioSourceNode | null = null;
  processorNode: AudioWorkletNode | null = null;
  queuedSourceNodes = new Set<AudioScheduledSourceNode>();

  // AI state
  isAIRunning: boolean = false;

  // Audio playback setup
  audioQueue: AudioBuffer[] = [];
  nextAudioStartTime = 0;

  // Screenshot setInterval identifier
  private screenshotInterval?: ReturnType<typeof setInterval>;

  // Transcription state
  currentInputText: string = '';
  currentOutputText: string = '';
  tools: xb.Tool[] = [];

  scheduleAheadTime = DEFAULT_SCHEDULE_AHEAD_TIME;

  // Type and quality settings for sending the camera feed to Gemini.
  cameraMimeType = 'image/jpeg';
  cameraQuality = 0.8;

  constructor() {
    super();
  }

  init() {
    this.xrDeviceCamera = xb.core.deviceCamera;
    this.ai = xb.core.ai!;
  }

  async startGeminiLive({
    liveParams,
    model,
  }: {
    liveParams?: GoogleGenAITypes.LiveConnectConfig;
    model?: string;
  } = {}) {
    if (this.isAIRunning || !this.ai) {
      console.warn('AI already running or not available');
      return;
    }

    liveParams = liveParams || {};
    liveParams.tools = liveParams.tools || [];
    liveParams.tools.push({
      functionDeclarations: this.tools.map((tool) => tool.toJSON()),
    });
    try {
      await this.setupAudioCapture();
      await this.startLiveAI(liveParams, model);
      this.startScreenshotCapture();
      this.isAIRunning = true;
    } catch (error) {
      console.error('Failed to start Gemini Live:', error);
      this.cleanup();
      throw error;
    }
  }

  async stopGeminiLive() {
    if (!this.isAIRunning) return;

    try {
      if (this.ai && this.ai.stopLiveSession) {
        await this.ai.stopLiveSession();
      }

      this.cleanup();
      this.isAIRunning = false;

      // Clear transcriptions when stopping
      this.currentInputText = '';
      this.currentOutputText = '';
    } catch (error) {
      console.error('Failed to stop Gemini Live:', error);
    }
  }

  async setupAudioCapture() {
    this.audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const audioTracks = this.audioStream.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error('No audio tracks found.');
    }

    this.audioContext = new AudioContext({sampleRate: 16000});
    const blob = new Blob([AUDIO_CAPTURE_PROCESSOR_CODE], {
      type: 'text/javascript',
    });
    const blobUrl = URL.createObjectURL(blob);
    await this.audioContext.audioWorklet.addModule(blobUrl);
    this.sourceNode = this.audioContext.createMediaStreamSource(
      this.audioStream
    );
    this.processorNode = new AudioWorkletNode(
      this.audioContext,
      'audio-capture-processor'
    );
    this.processorNode.port.onmessage = (event) => {
      if (event.data.type === 'audioData' && this.isAIRunning) {
        this.sendAudioData(event.data.data);
      }
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
  }

  async startLiveAI(
    params: GoogleGenAITypes.LiveConnectConfig,
    model?: string
  ) {
    return new Promise<void>((resolve, reject) => {
      this.ai.setLiveCallbacks({
        onopen: () => {
          resolve();
        },
        onmessage: (message: GoogleGenAITypes.LiveServerMessage) => {
          this.handleAIMessage(message);
        },
        onerror: (error: ErrorEvent) => {
          console.error('Live AI error:', error);
          reject(error);
        },
        onclose: () => {
          this.isAIRunning = false;
        },
      });

      this.ai.startLiveSession(params, model).catch(reject);
    });
  }

  startScreenshotCapture(intervalMs: number = 1000) {
    if (this.screenshotInterval) {
      console.error('Screenshot interval already running');
      return;
    }
    this.screenshotInterval = setInterval(() => {
      this.captureAndSendScreenshot();
    }, intervalMs);
  }

  async captureAndSendScreenshot() {
    try {
      const base64Image = await this.xrDeviceCamera!.getSnapshot({
        outputFormat: 'base64',
        mimeType: this.cameraMimeType,
        quality: this.cameraQuality,
      });
      if (typeof base64Image == 'string') {
        // Strip the data URL prefix if present
        const base64Data = base64Image.startsWith('data:')
          ? base64Image.split(',')[1]
          : base64Image;
        this.sendVideoFrame(base64Data);
      }
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
    }
  }

  sendAudioData(audioBuffer: ArrayBuffer) {
    if (!this.isAIRunning || !this.ai || !this.ai.sendRealtimeInput) {
      throw new Error('AI not ready to send audio clip.');
    }
    try {
      const base64Audio = this.arrayBufferToBase64(audioBuffer);
      this.ai.sendRealtimeInput({
        audio: {data: base64Audio, mimeType: 'audio/pcm;rate=16000'},
      });
    } catch (error) {
      console.error('Failed to send audio:', error);
    }
  }

  sendVideoFrame(base64Image: string) {
    if (!this.isAIRunning || !this.ai || !this.ai.sendRealtimeInput) {
      throw new Error('AI not ready to send video frame');
    }
    try {
      this.ai.sendRealtimeInput({
        video: {data: base64Image, mimeType: 'image/jpeg'},
      });
    } catch (error) {
      console.error('❌ Failed to send video frame:', error);
      console.error('Error stack:', (error as Error).stack);
    }
  }

  async initializeAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({sampleRate: 24000});
    }
  }

  async playAudioChunk(audioData: string) {
    try {
      await this.initializeAudioContext();
      const arrayBuffer = this.base64ToArrayBuffer(audioData);
      const audioBuffer = this.audioContext!.createBuffer(
        1,
        arrayBuffer.byteLength / 2,
        24000
      );
      const channelData = audioBuffer.getChannelData(0);
      const int16View = new Int16Array(arrayBuffer);

      for (let i = 0; i < int16View.length; i++) {
        channelData[i] = int16View[i] / 32768.0;
      }

      this.audioQueue.push(audioBuffer);

      this.scheduleAudioBuffers();
    } catch (error) {
      console.error('Error playing audio chunk:', error);
    }
  }

  scheduleAudioBuffers() {
    while (
      this.audioQueue.length > 0 &&
      this.nextAudioStartTime <=
        this.audioContext!.currentTime + this.scheduleAheadTime
    ) {
      const audioBuffer = this.audioQueue.shift()!;
      const source = this.audioContext!.createBufferSource();
      source.buffer = audioBuffer!;
      source.connect(this.audioContext!.destination);
      source.onended = () => {
        source.disconnect();
        this.queuedSourceNodes.delete(source);
        this.scheduleAudioBuffers();
      };

      const startTime = Math.max(
        this.nextAudioStartTime,
        this.audioContext!.currentTime
      );
      source.start(startTime);
      this.queuedSourceNodes.add(source);
      this.nextAudioStartTime = startTime + audioBuffer.duration;
    }
  }

  stopPlayingAudio() {
    this.audioQueue = [];
    this.nextAudioStartTime = 0;
    for (const source of this.queuedSourceNodes) {
      source.stop();
      source.disconnect();
    }
    this.queuedSourceNodes.clear();
  }

  cleanup() {
    if (this.screenshotInterval) {
      clearInterval(this.screenshotInterval);
      this.screenshotInterval = undefined;
    }

    // Clear audio queue and stop playback
    this.audioQueue = [];

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }
  }

  handleAIMessage(message: GoogleGenAITypes.LiveServerMessage) {
    if (message.data) {
      this.playAudioChunk(message.data);
    }

    for (const functionCall of message.toolCall?.functionCalls ?? []) {
      const tool = this.tools.find((tool) => tool.name == functionCall.name);
      if (tool) {
        const exec = tool.execute(functionCall.args);
        exec
          .then((result) => {
            this.ai.sendToolResponse({
              functionResponses: {
                id: functionCall.id,
                name: functionCall.name,
                response: {
                  output: result.data,
                  error: result.error,
                  ...result.metadata,
                },
              },
            });
          })
          .catch((error: unknown) => console.error('Tool error:', error));
      }
    }

    if (message.serverContent) {
      if (message.serverContent.inputTranscription) {
        const text = message.serverContent.inputTranscription.text;
        if (text) {
          this.dispatchEvent({type: 'inputTranscription', message: text});
        }
      }
      if (message.serverContent.outputTranscription) {
        const text = message.serverContent.outputTranscription.text;
        if (text) {
          this.dispatchEvent({type: 'outputTranscription', message: text});
        }
      }

      if (message.serverContent.interrupted) {
        this.stopPlayingAudio();
        this.dispatchEvent({type: 'interrupted'});
      }

      if (message.serverContent.turnComplete) {
        this.dispatchEvent({type: 'turnComplete'});
      }
    }
  }

  arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Opens a Gemini Live session that streams the device camera into the model
   * while piping the model's text + audio + tool-calls back to the caller.
   *
   * Builds on the existing primitives:
   *   - `ai.startLiveSession` for the bidirectional channel
   *   - `XRDeviceCamera.getSnapshot` for vision frames
   *   - this manager's `xb.core.sound.playAIAudio` for audio playback (unless
   *     an `onAudio` callback is supplied)
   *
   * The mic is not auto-enabled; call `xb.core.sound.enableAudio(...)` with
   * `streamToAI: true` before this if you want the model to hear the user.
   *
   * @param prompt - The system instruction / persona for the session.
   * @param options - Frame rate, image quality, optional tools, and callbacks.
   * @returns A handle exposing `stop()` and `isActive()`. The caller is
   *     responsible for calling `stop()`.
   * @throws If no AI is available, the active model isn't Live-capable, or no
   *     XRDeviceCamera is available.
   */
  async streamScene(
    prompt: string,
    options: StreamSceneOptions = {}
  ): Promise<StreamSceneSession> {
    const ai = this.ai;
    if (!ai) {
      throw new Error(
        'GeminiManager.streamScene: no AI is available. Call ' +
          'options.enableAI() first.'
      );
    }
    if (!ai.isLiveAvailable()) {
      throw new Error(
        'GeminiManager.streamScene: active AI model does not support Live ' +
          'sessions. Use a Gemini Live model.'
      );
    }
    const camera = this.xrDeviceCamera;
    if (!camera) {
      throw new Error(
        'GeminiManager.streamScene: no XRDeviceCamera is available. Call ' +
          'options.enableCamera() first.'
      );
    }

    const fps = options.fps ?? 1;
    const quality = options.imageQuality ?? 0.7;
    const width = options.imageWidth ?? 640;
    const height = options.imageHeight ?? 480;
    const tools = options.tools ?? [];

    const toolsByName = new Map<string, xb.Tool>(tools.map((t) => [t.name, t]));
    const functionDeclarations: GoogleGenAITypes.FunctionDeclaration[] =
      tools.map((t) => t.toJSON());

    let active = true;
    let sending = false;

    const handleToolCall = async (
      toolCall: GoogleGenAITypes.LiveServerToolCall
    ) => {
      if (options.onToolCall) {
        await options.onToolCall(toolCall);
        return;
      }
      const calls = toolCall.functionCalls ?? [];
      const responses: GoogleGenAITypes.FunctionResponse[] = [];
      for (const call of calls) {
        const tool = toolsByName.get(call.name ?? '');
        if (!tool) {
          responses.push({
            id: call.id,
            name: call.name,
            response: {error: `unknown tool: ${call.name}`},
          });
          continue;
        }
        try {
          const result = await tool.execute(call.args ?? {});
          responses.push({
            id: call.id,
            name: call.name,
            response: result.success
              ? {result: result.data ?? null}
              : {error: result.error ?? 'tool execution failed'},
          });
        } catch (err) {
          responses.push({
            id: call.id,
            name: call.name,
            response: {error: (err as Error).message},
          });
        }
      }
      ai.sendToolResponse({functionResponses: responses});
    };

    ai.setLiveCallbacks({
      onopen: () => options.onOpen?.(),
      onmessage: (msg: GoogleGenAITypes.LiveServerMessage) => {
        const text = msg.serverContent?.modelTurn?.parts
          ?.map((p) => p.text)
          .filter(Boolean)
          .join('');
        if (text) options.onText?.(text);

        // Audio Live sessions return the spoken reply as audio, so the text
        // shows up under `outputTranscription` rather than `modelTurn.parts`.
        const transcript = msg.serverContent?.outputTranscription?.text;
        if (transcript) options.onText?.(transcript);

        // The user's own recognized speech arrives under `inputTranscription`.
        const inputText = msg.serverContent?.inputTranscription?.text;
        if (inputText) options.onInputText?.(inputText);

        const audioPart = msg.serverContent?.modelTurn?.parts?.find((p) =>
          p.inlineData?.mimeType?.startsWith('audio/')
        );
        const audio = audioPart?.inlineData?.data;
        if (audio) {
          if (options.onAudio) options.onAudio(audio);
          else xb.core.sound?.playAIAudio(audio);
        }

        if (msg.toolCall) handleToolCall(msg.toolCall);

        if (msg.serverContent?.turnComplete) options.onTurnComplete?.();
      },
      onerror: (e: ErrorEvent) => options.onError?.(new Error(e.message)),
      onclose: () => {
        active = false;
        clearInterval(frameTimer);
        options.onClose?.();
      },
    });

    await ai.startLiveSession({
      systemInstruction: {parts: [{text: prompt}]},
      ...(functionDeclarations.length ? {tools: [{functionDeclarations}]} : {}),
    });

    const sendFrame = async () => {
      if (!active || sending) return;
      sending = true;
      try {
        const dataUrl = await camera.getSnapshot({
          outputFormat: 'base64',
          mimeType: 'image/jpeg',
          quality,
          width,
          height,
        });
        if (!dataUrl || !active) return;
        const {strippedBase64, mimeType} = xb.parseBase64DataURL(dataUrl);
        ai.sendRealtimeInput({
          video: {data: strippedBase64, mimeType: mimeType ?? 'image/jpeg'},
        });
      } catch (err) {
        options.onError?.(err as Error);
      } finally {
        sending = false;
      }
    };

    const frameTimer: ReturnType<typeof setInterval> = setInterval(
      sendFrame,
      Math.max(1, Math.round(1000 / fps))
    );
    sendFrame();

    return {
      isActive: () => active,
      async stop() {
        if (!active) return;
        active = false;
        clearInterval(frameTimer);
        await ai.stopLiveSession();
      },
    };
  }

  dispose() {
    this.cleanup();
    super.dispose();
  }
}

/**
 * Options for {@link GeminiManager.streamScene}.
 */
export interface StreamSceneOptions {
  /** Camera frames per second sent to the model. Default `1`. */
  fps?: number;
  /** JPEG quality for camera snapshots, 0..1. Default `0.7`. */
  imageQuality?: number;
  /** Snapshot width in pixels. Default `640`. */
  imageWidth?: number;
  /** Snapshot height in pixels. Default `480`. */
  imageHeight?: number;
  /** Optional agentic tools the model may invoke. */
  tools?: xb.Tool[];
  /** Called when the Live session opens. */
  onOpen?: () => void;
  /** Called for each text chunk the model emits (its spoken reply). */
  onText?: (text: string) => void;
  /** Called for each chunk of the user's own recognized speech. */
  onInputText?: (text: string) => void;
  /** Called when the model finishes a turn, useful for separating turns. */
  onTurnComplete?: () => void;
  /**
   * Called for each audio chunk (base64 PCM) the model emits. If omitted,
   * audio is auto-played via `xb.core.sound.playAIAudio`.
   */
  onAudio?: (base64: string) => void;
  /**
   * Called for each tool invocation. If omitted, tools provided in
   * `options.tools` are dispatched and their results sent back automatically.
   */
  onToolCall?: (
    toolCall: GoogleGenAITypes.LiveServerToolCall
  ) => Promise<void> | void;
  /** Called on transport error. */
  onError?: (err: Error) => void;
  /** Called when the session closes (caller- or server-initiated). */
  onClose?: () => void;
}

/**
 * Handle returned by {@link GeminiManager.streamScene}.
 */
export interface StreamSceneSession {
  /** Whether the session is still streaming. */
  isActive(): boolean;
  /** Stops the camera loop and closes the Live session. Idempotent. */
  stop(): Promise<void>;
}
