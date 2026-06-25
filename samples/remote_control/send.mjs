#!/usr/bin/env node

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const url = process.env.REMOTE_CONTROL_URL || 'ws://127.0.0.1:8791';
const sessionId = process.env.REMOTE_CONTROL_SESSION || 'default';
const command = process.argv[2] || 'observe';
const extraJson =
  command === 'tool' || command === 'call-tool'
    ? process.argv[4]
    : command === 'inject-audio-stt'
      ? undefined
      : command === 'gemini-say-wav'
        ? process.argv[4]
        : process.argv[3];

if (typeof WebSocket === 'undefined') {
  console.error(
    'This helper requires Node 24+ with the built-in WebSocket API.'
  );
  process.exit(1);
}

const request = await createRequest(command, extraJson);
const ws = new WebSocket(url);
let sent = false;
const timeoutMs =
  command === 'inject-audio-stt' || command === 'gemini-say-wav' ? 30000 : 8000;

const timeout = setTimeout(() => {
  console.error(`Timed out waiting for remote-control response from ${url}`);
  try {
    ws.close();
  } catch {
    // ignore
  }
  process.exit(1);
}, timeoutMs);

ws.addEventListener('open', () => {
  ws.send(
    JSON.stringify({
      type: 'hello',
      role: 'client',
      sessionId,
      protocolVersion: 1,
      client: 'xrblocks-remote-control-smoke-cli',
    })
  );
});

ws.addEventListener('message', async (event) => {
  const message = JSON.parse(await messageDataToString(event.data));

  if (message.type === 'simulatorReady' && !sent) {
    sent = true;
    ws.send(JSON.stringify(request));
    return;
  }

  if (message.type === 'response' && message.id === request.id) {
    clearTimeout(timeout);
    await saveReturnedMedia(message, command);
    console.log(JSON.stringify(message, null, 2));
    ws.close();
  }
});

ws.addEventListener('error', () => {
  clearTimeout(timeout);
  console.error(`Failed to connect to ${url}`);
  process.exit(1);
});

async function createRequest(name, jsonArg) {
  const id = `smoke-${Date.now()}`;
  const args = jsonArg ? JSON.parse(jsonArg) : undefined;

  switch (name) {
    case 'tool':
    case 'call-tool': {
      const toolName = process.argv[3];
      if (!toolName) {
        console.error(
          'Usage: node samples/remote_control/send.mjs tool <toolName> [jsonArgs]'
        );
        process.exit(1);
      }
      return {
        id,
        type: 'callTool',
        name: toolName,
        args: args || {},
      };
    }
    case 'observe':
    case 'get-camera':
      return {
        id,
        type: 'callTool',
        name: 'getCamera',
        args: args || {screenshot: true, overlayOnCamera: true},
      };
    case 'step-forward':
      return {
        id,
        type: 'callTool',
        name: 'step',
        args: {
          durationMs: 250,
          control: {
            locomotion: {move: [0, 0, -0.25]},
          },
        },
      };
    case 'get-hands':
      return {
        id,
        type: 'callTool',
        name: 'getHands',
        args: args || {},
      };
    case 'get-state':
      return {
        id,
        type: 'callTool',
        name: 'getSimulatorState',
        args: args || {},
      };
    case 'screenshot':
      return {
        id,
        type: 'callTool',
        name: 'getScreenshot',
        args: args || {overlayOnCamera: true},
      };
    case 'get-cube':
      return {
        id,
        type: 'callTool',
        name: 'getCubeState',
        args: args || {},
      };
    case 'nudge-cube':
      return {
        id,
        type: 'callTool',
        name: 'nudgeCube',
        args: args || {},
      };
    case 'reset-cube':
      return {
        id,
        type: 'callTool',
        name: 'resetCube',
        args: args || {},
      };
    case 'start-stt':
      return {
        id,
        type: 'callTool',
        name: 'startStt',
        args: args || {},
      };
    case 'get-stt':
      return {
        id,
        type: 'callTool',
        name: 'getSttState',
        args: args || {},
      };
    case 'inject-audio-stt':
      return createInjectAudioSttRequest(id);
    case 'gemini-say-wav':
      return {
        id,
        type: 'callTool',
        name: 'geminiSayAndCaptureAudio',
        args: {
          text: process.argv[3] || 'this is a test',
          ...(args || {}),
        },
      };
    default:
      console.error(
        [
          `Unknown command: ${name}`,
          '',
          'Usage:',
          '  node samples/remote_control/send.mjs observe',
          '  node samples/remote_control/send.mjs get-camera \'{"screenshot":true}\'',
          '  node samples/remote_control/send.mjs step-forward',
          '  node samples/remote_control/send.mjs get-hands',
          '  node samples/remote_control/send.mjs get-state',
          '  node samples/remote_control/send.mjs screenshot',
          '  node samples/remote_control/send.mjs tool getCamera \'{"screenshot":true}\'',
          '  node samples/remote_control/send.mjs get-cube',
          '  node samples/remote_control/send.mjs nudge-cube',
          '  node samples/remote_control/send.mjs nudge-cube \'{"dx":0.25}\'',
          '  node samples/remote_control/send.mjs reset-cube',
          '  node samples/remote_control/send.mjs start-stt',
          '  node samples/remote_control/send.mjs get-stt',
          '  node samples/remote_control/send.mjs inject-audio-stt ./speech.wav \'{"waitMs":3000}\'',
          '  node samples/remote_control/send.mjs inject-audio-stt ./speech.pcm \'{"mimeType":"audio/pcm","sampleRate":16000}\'',
          '  node samples/remote_control/send.mjs gemini-say-wav "this is a test"',
          '  node samples/remote_control/send.mjs gemini-say-wav "this is a test" \'{"timeoutMs":20000}\'',
        ].join('\n')
      );
      process.exit(1);
  }
}

async function createInjectAudioSttRequest(id) {
  const filePath = process.argv[3];
  if (!filePath) {
    console.error(
      'Usage: node samples/remote_control/send.mjs inject-audio-stt <audio.wav|audio.pcm> [jsonArgs]'
    );
    process.exit(1);
  }

  const args = process.argv[4] ? JSON.parse(process.argv[4]) : {};
  const bytes = await readFile(filePath);
  const inferredMimeType = filePath.toLowerCase().endsWith('.wav')
    ? 'audio/wav'
    : 'audio/pcm';

  if ((args.mimeType ?? inferredMimeType) === 'audio/pcm' && !args.sampleRate) {
    console.error('sampleRate is required for audio/pcm input.');
    process.exit(1);
  }

  return {
    id,
    type: 'callTool',
    name: 'injectAudioForStt',
    args: {
      mimeType: inferredMimeType,
      waitMs: 2500,
      ...args,
      audioBase64: bytes.toString('base64'),
    },
  };
}

async function saveReturnedMedia(message, commandName) {
  if (!message.ok || message.result === undefined) return;
  const savedFiles = [];
  message.result = await replaceReturnedMedia(
    message.result,
    savedFiles,
    commandName
  );
  if (savedFiles.length > 0) {
    message.downloadedFiles = savedFiles;
  }
}

async function replaceReturnedMedia(value, savedFiles, commandName) {
  if (
    typeof value === 'string' &&
    (value.startsWith('data:image/') || value.startsWith('data:audio/'))
  ) {
    const file = await saveDataUrl(value, commandName, savedFiles.length);
    savedFiles.push(file);
    return file.path;
  }

  if (Array.isArray(value)) {
    return Promise.all(
      value.map((item) => replaceReturnedMedia(item, savedFiles, commandName))
    );
  }

  if (value && typeof value === 'object') {
    if (
      typeof value.audioBase64 === 'string' &&
      typeof value.mimeType === 'string' &&
      value.mimeType.startsWith('audio/')
    ) {
      const file = await saveBase64File(
        value.audioBase64,
        value.mimeType,
        commandName,
        savedFiles.length
      );
      savedFiles.push(file);
      return {
        ...value,
        audioBase64: file.path,
      };
    }

    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [
        key,
        await replaceReturnedMedia(item, savedFiles, commandName),
      ])
    );
    return Object.fromEntries(entries);
  }

  return value;
}

async function saveDataUrl(dataUrl, commandName, index) {
  const match = /^data:((?:image|audio)\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(
    dataUrl
  );
  if (!match) {
    throw new Error('Unsupported image data URL.');
  }
  const [, mimeType, base64] = match;
  const extension = mediaExtension(mimeType);
  return saveBase64File(base64, mimeType, commandName, index, extension);
}

async function saveBase64File(
  base64,
  mimeType,
  commandName,
  index,
  extension = mediaExtension(mimeType)
) {
  const dir = path.join(tmpdir(), 'xrblocks-remote-control');
  await mkdir(dir, {recursive: true});
  const safeCommand = commandName.replace(/[^a-zA-Z0-9_-]/g, '-');
  const filePath = path.join(
    dir,
    `${safeCommand}-${Date.now()}-${index}.${extension}`
  );
  const bytes = Buffer.from(base64, 'base64');
  await writeFile(filePath, bytes);
  return {
    path: filePath,
    mimeType,
    sizeBytes: bytes.byteLength,
  };
}

function mediaExtension(mimeType) {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/ogg':
      return 'ogg';
    default:
      return mimeType.split('/')[1]?.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
  }
}

async function messageDataToString(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (data instanceof Blob) return data.text();
  return String(data);
}
