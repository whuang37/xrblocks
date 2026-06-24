import type * as GoogleGenAITypes from '@google/genai';
import * as THREE from 'three';
import * as xb from 'xrblocks';

export interface GeminiManagerEventMap extends THREE.Object3DEventMap {
  inputTranscription: {message: string};
  outputTranscription: {message: string};
  turnComplete: object;
  interrupted: object;
  close: object;
}

export class GeminiManager extends xb.Script<GeminiManagerEventMap> {
  // Core components
  xrDeviceCamera?: xb.XRDeviceCamera;
  ai!: xb.AI;

  // AI state
  isAIRunning: boolean = false;

  // Screenshot setInterval identifier
  private screenshotInterval?: ReturnType<typeof setInterval>;

  // Transcription state
  currentInputText: string = '';
  currentOutputText: string = '';
  tools: xb.Tool[] = [];

  // Type and quality settings for sending the camera feed to Gemini.
  cameraMimeType = 'image/jpeg';
  cameraQuality = 0.8;
  // Optional downscale for the camera frames sent to the model. Leave
  // undefined to send full-resolution snapshots.
  cameraWidth?: number;
  cameraHeight?: number;

  // What the live session streams to the model each frame:
  //   'camera'     - raw passthrough frames from the device camera (default,
  //                  matching the original startGeminiLive behavior)
  //   'screenshot' - the rendered scene (virtual content), optionally over the
  //                  camera image (see `overlayScreenshotOnCamera`)
  captureMode: 'screenshot' | 'camera' = 'camera';
  // In 'screenshot' mode, composite the virtual content over the camera image.
  overlayScreenshotOnCamera = true;

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
    tools,
    captureMode,
    overlayOnCamera,
    camera,
  }: {
    liveParams?: GoogleGenAITypes.LiveConnectConfig;
    model?: string;
    /** Tools the model may call. Overrides {@link GeminiManager.tools}. */
    tools?: xb.Tool[];
    /**
     * What to stream each frame: `'screenshot'` (rendered virtual content) or
     * `'camera'` (raw passthrough frames). Defaults to
     * {@link GeminiManager.captureMode}.
     */
    captureMode?: 'screenshot' | 'camera';
    /** In screenshot mode, composite virtual content over the camera image. */
    overlayOnCamera?: boolean;
    /** Capture config used in `'camera'` mode. */
    camera?: {
      /** Frames per second sent to the model. Default `1`. */
      fps?: number;
      /** JPEG quality, 0..1. */
      quality?: number;
      /** Downscale width in pixels. Omit for full resolution. */
      width?: number;
      /** Downscale height in pixels. Omit for full resolution. */
      height?: number;
    };
  } = {}) {
    if (this.isAIRunning || !this.ai) {
      console.warn('AI already running or not available');
      return;
    }

    if (tools) this.tools = tools;
    if (captureMode) this.captureMode = captureMode;
    if (overlayOnCamera !== undefined) {
      this.overlayScreenshotOnCamera = overlayOnCamera;
    }
    if (camera?.quality !== undefined) this.cameraQuality = camera.quality;
    if (camera?.width !== undefined) this.cameraWidth = camera.width;
    if (camera?.height !== undefined) this.cameraHeight = camera.height;
    const intervalMs = camera?.fps
      ? Math.max(1, Math.round(1000 / camera.fps))
      : 1000;

    liveParams = liveParams || {};
    liveParams.tools = liveParams.tools || [];
    liveParams.tools.push({
      functionDeclarations: this.tools.map((tool) => tool.toJSON()),
    });
    try {
      await xb.core.sound.enableAudio();
      await this.startLiveAI(liveParams, model);
      this.startScreenshotCapture(intervalMs);
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

  async startLiveAI(
    params: GoogleGenAITypes.LiveConnectConfig,
    model?: string
  ) {
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      this.ai.setLiveCallbacks({
        onopen: () => {
          opened = true;
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
          // Free the mic, audio nodes and screenshot loop even when the
          // session is closed by the server, not just via stopGeminiLive.
          this.cleanup();
          this.dispatchEvent({type: 'close'});
          // If the session closed before it ever opened, the startup promise
          // would otherwise hang forever; surface it as a failure.
          if (!opened) {
            reject(new Error('Live session closed before it opened'));
          }
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
      const base64Image =
        this.captureMode === 'camera'
          ? await this.xrDeviceCamera!.getSnapshot({
              outputFormat: 'base64',
              mimeType: this.cameraMimeType,
              quality: this.cameraQuality,
              ...(this.cameraWidth ? {width: this.cameraWidth} : {}),
              ...(this.cameraHeight ? {height: this.cameraHeight} : {}),
            })
          : await xb.core.screenshotSynthesizer.getScreenshot(
              this.overlayScreenshotOnCamera
            );
      if (typeof base64Image == 'string') {
        // Strip the data URL prefix if present, preserving its declared MIME
        // type (screenshots are PNG, camera snapshots are JPEG).
        let mimeType = this.cameraMimeType;
        let base64Data = base64Image;
        if (base64Image.startsWith('data:')) {
          const match = base64Image.match(/^data:([^;,]+)[^,]*,(.*)$/s);
          if (match) {
            mimeType = match[1];
            base64Data = match[2];
          } else {
            base64Data = base64Image.split(',')[1];
          }
        }
        this.sendVideoFrame(base64Data, mimeType);
      }
    } catch (error) {
      console.error('Failed to capture frame:', error);
    }
  }

  sendVideoFrame(base64Image: string, mimeType: string = this.cameraMimeType) {
    if (!this.isAIRunning || !this.ai || !this.ai.sendRealtimeInput) {
      throw new Error('AI not ready to send video frame');
    }
    try {
      this.ai.sendRealtimeInput({
        video: {data: base64Image, mimeType},
      });
    } catch (error) {
      console.error('❌ Failed to send video frame:', error);
      console.error('Error stack:', (error as Error).stack);
    }
  }

  cleanup() {
    // Audio capture + playback are owned by CoreSound; stop both.
    xb.core.sound.disableAudio();
    xb.core.sound.stopAIAudio();

    if (this.screenshotInterval) {
      clearInterval(this.screenshotInterval);
      this.screenshotInterval = undefined;
    }
  }

  handleAIMessage(message: GoogleGenAITypes.LiveServerMessage) {
    if (message.data) {
      xb.core.sound.playAIAudio(message.data);
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
        xb.core.sound.stopAIAudio();
        this.dispatchEvent({type: 'interrupted'});
      }

      if (message.serverContent.turnComplete) {
        this.dispatchEvent({type: 'turnComplete'});
      }
    }
  }

  dispose() {
    this.cleanup();
    super.dispose();
  }
}
