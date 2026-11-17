---
title: Audio and speech
slug: /sdk/audio
sidebar_position: 17
---

# Audio and speech

`xb.sound` manages the SDK's audio listener, capture/playback helpers, and speech
wrappers. Start audio from a user action where the browser requires it.
Declare microphone permission before XR entry when the app records speech.

## Place sound in the scene

After initialization, attach a positional source to the object it follows:

```js
const sound = new THREE.PositionalAudio(xb.sound.getAudioListener());
sound.setRefDistance(0.5);
sound.setBuffer(audioBuffer);
object.add(sound);
sound.play();
```

This fragment assumes an existing `AudioBuffer` and scene object. The listener
follows the SDK camera. Stop and disconnect an app-owned source when its owner
is removed. A source at the wrong scale or distance can be effectively inaudible.

## Record and play back

Set `options.permissions.microphone = true` before initialization. From a user
action after initialization:

```js
await xb.sound.startRecording();
// Later:
const pcm = xb.sound.stopRecording();
if (pcm)
  await xb.sound.playRecordedAudio(pcm, xb.sound.getRecordingSampleRate());
```

The recording is Int16 PCM. Preserve its actual sample rate when replaying or
sending it to a service. `setMasterVolume()` and category volumes control SDK
output; an app's separate Web Audio graph has its own ownership.

## Speech input and output

The recognizer is configured under `options.sound.speechRecognizer`; listen
for `result` and `error` on `xb.sound.speechRecognizer` and guard the optional
service. Results include `transcript` and `isFinal`. Recognition still depends
on the browser's Web Speech implementation.

Enable `options.sound.speechSynthesizer.enabled` before initialization to use
`xb.sound.speechSynthesizer?.speak(text, lang, pitch, rate)`. Call `cancel()`
to stop output. Show text as well as speech when spoken output carries app state.

Remove app listeners and stop owned recording/playback during cleanup. Check
permission denial, no microphone, muted output, and interrupted sessions.

[CoreSound reference](/api/classes/CoreSound) ·
[Run sound controls](https://xrblocks.github.io/demos/sound/) ·
[Sound example source](https://github.com/google/xrblocks/blob/main/demos/sound/main.js) · [Live AI](/sdk/ai/live)
