import type {
  AppAudioCaptureResult,
  Core,
  InjectAudioInputOptions,
  InjectAudioInputResult,
} from 'xrblocks';

import {
  REMOTE_CONTROL_BUILT_IN_TOOL_NAMES,
  type RemoteControlBuiltInTool,
} from './Types';

export type RemoteControlInjectAudioInputToolArgs = InjectAudioInputOptions;

export type RemoteControlInjectAudioInputToolResult = InjectAudioInputResult;

export type RemoteControlGetAppAudioToolArgs = {
  clear?: boolean;
};

export type RemoteControlGetAppAudioToolResult = AppAudioCaptureResult;

type RemoteControlAudioToolDependencies = {
  core: Core;
};

export function createRemoteControlAudioTools({
  core,
}: RemoteControlAudioToolDependencies): RemoteControlBuiltInTool[] {
  return [
    {
      name: REMOTE_CONTROL_BUILT_IN_TOOL_NAMES.injectAudioInput,
      handler: async (args) =>
        core.sound.injectAudioInput(
          args as RemoteControlInjectAudioInputToolArgs
        ),
      metadata: {
        description:
          'Injects PCM or WAV audio into the SDK microphone input path.',
        parameters: {
          audioBase64: 'base64 audio bytes',
          mimeType: 'audio/wav or audio/pcm',
          sampleRate: 'required for audio/pcm',
          chunkMs: 'optional input chunk size in milliseconds',
        },
      },
    },
    {
      name: REMOTE_CONTROL_BUILT_IN_TOOL_NAMES.getAppAudio,
      handler: async (args) =>
        core.sound.getAppAudio(args as RemoteControlGetAppAudioToolArgs),
      metadata: {
        description:
          'Returns captured SDK-managed app audio as a WAV file encoded in base64.',
        parameters: {
          clear: 'boolean',
        },
      },
    },
  ];
}
