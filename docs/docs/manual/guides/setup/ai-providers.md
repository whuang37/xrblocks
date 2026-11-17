---
title: AI providers and credentials
slug: /integrations/ai-providers
---

# AI providers and credentials

Choose the provider before initialization and supply its runtime package.
Provider credentials, network access, and the selected model remain prerequisites
for each operation; an enabled wrapper does not guarantee a successful request.

## Local Gemini prototype

```js
const options = new xb.Options();
options.enableAI();
options.ai.promptForApiKey = true;
await xb.init(options);
```

`enableAI()` enables Gemini. The optional prompt keeps the key for the current
page session. Provider options, key URL parameters, and `keys.json` are also
local-prototype mechanisms. URLs can appear in history and logs; encoding a key
is not protection.

Keep long-lived provider keys on a server for production. Bounded queries and
image generation need a server-controlled request path when the browser must
not hold a key. This is application infrastructure, not automatic SDK proxying.

## OpenAI

```js
const options = new xb.Options();
options.ai.enabled = true;
options.ai.model = 'openai';
options.ai.openai.enabled = true;
```

Supply the `openai` package and a model/credential configuration appropriate
to the intended operation. The SDK's live audio/video integration is Gemini;
selecting OpenAI does not create an equivalent Live implementation.
See [AIOptions](/api/classes/AIOptions) for provider fields and configured model defaults.
Check model availability against your provider account rather than copying a
model name from an unrelated example.

## Gemini Live short-lived tokens

The browser can retrieve a token from an application server:

```js
options.ai.gemini.tokenProvider = async () => {
  const response = await fetch('/api/gemini-live-token', {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Could not obtain a Live token');
  const {token} = await response.json();
  return token;
};
```

Configure this before `xb.init()`. The provider runs for each new Live session;
it does not refresh an open connection. It supplies Live authentication only,
not credentials for queries or image generation. The SDK uses the compatible
Live endpoint for these tokens.

The [reference token server](https://github.com/google/xrblocks/blob/main/tools/gemini-token-server/README.md) explains
local setup, model constraints, exact allowed origins, and production access
controls. A token route must exist and authenticate/authorize its callers.

## Errors and transmitted data

Handle rejected credentials, quota, network loss, and missing provider capability.
The application chooses whether to send text, microphone audio, camera images,
rendered screenshots, or scene context. Keep that choice visible to users and
send only the input needed by the task.

[Queries](/sdk/ai) · [Live sessions](/sdk/ai/live) ·
[Scene context](/sdk/context) · [Live example](/examples/live-assistant)
