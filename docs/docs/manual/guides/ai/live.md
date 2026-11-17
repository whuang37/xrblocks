---
title: Live AI and tools
slug: /sdk/ai/live
---

# Live AI and tools

Live AI needs connection state and media ownership as well as a prompt. Start
from a user action, keep a duplicate-start lock, and expose connecting,
listening, stopping, disconnected, and failed states.

## Connect a session

Configure [Gemini and credentials](/integrations/ai-providers) before engine
initialization. Register callbacks before opening the session:

```js
await xb.ai.setLiveCallbacks({
  onopen: () => console.log('Listening'),
  onmessage: (message) => console.log(message),
  onerror: (error) => console.error(error),
  onclose: () => console.log('Disconnected'),
});

if (xb.ai.isLiveAvailable()) {
  await xb.ai.startLiveSession({
    responseModalities: ['AUDIO'],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  });
}
```

This fragment opens the provider connection. It does not start an application's
microphone capture or audio playback. A returned session is not proof of an
open connection; use `onopen` as the ready transition.

## Send media and own cleanup

`sendRealtimeInput()` takes nested provider fields such as
`{audio: {data, mimeType}}` or `{video: {data, mimeType}}`. Encode audio in the
stated format/rate and images in the stated MIME type. Stop frame timers and
media capture when the session ends.

The public `GeminiManager` addon owns the common microphone, playback,
frame-capture, tool, and cleanup loop. The
[World Companion example](https://github.com/google/xrblocks/blob/main/demos/world_companion/index.html) uses it.
The [live starter](https://github.com/google/xrblocks/blob/main/templates/07_ai_live_assistant/LiveAssistant.js)
shows a lower-level loop owned by the application.
Choose its capture source deliberately: `captureMode: 'camera'` captures the
device/environment view; `'screenshot'` includes rendered app content, with
`overlayOnCamera` controlling compositing over the camera.

Use one idempotent cleanup path for local Stop, remote close, errors, and
Script removal. It must stop the live session and all app-owned capture,
playback, timers, and pending UI state. See [resources](/sdk/resources).

## Give tools bounded actions

An `xb.Tool` describes a name, parameter schema, and `onTriggered` callback.
Validate arguments again during execution. Resolve target IDs through an
application-owned allowlist rather than accepting arbitrary object access.

```js
const toggle = new xb.Tool({
  name: 'show_details',
  description: 'Show the application details card.',
  parameters: {type: 'OBJECT', properties: {}},
  onTriggered: () => {
    detailsCard.visible = true;
    return {visible: true};
  },
});
```

This fragment defines a tool for an existing `detailsCard`; it must still be
registered with the session owner. Follow the complete
[scene-aware assistant example](/examples/live-assistant) for registration,
execution, and responses. Use [scene context](/sdk/context) to ground targets.

[AI reference](/api/classes/AI) · [Tool reference](/api/classes/Tool) ·
[Run the live starter](https://xrblocks.github.io/templates/07_ai_live_assistant/)
