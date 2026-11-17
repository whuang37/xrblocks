---
title: AI queries and generated content
slug: /sdk/ai
---

# AI queries and generated content

Use `xb.ai` for bounded queries and supported content generation. Configure a
provider before initialization, then show pending, response, empty, and failed
states in the application.

## Make a query

After [provider setup](/integrations/ai-providers):

```js
async function ask() {
  if (!xb.ai.isAvailable()) return 'AI is unavailable';
  try {
    const response = await xb.ai.query({prompt: 'Describe a small XR garden.'});
    const text = typeof response === 'string' ? response : response?.text;
    return text || 'No text returned';
  } catch (error) {
    return `Request failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
```

`isAvailable()` reports local provider-wrapper state. A subsequent request can
still fail because of credentials, quota, network, or provider errors. Prevent
duplicate requests while one is pending unless concurrency is intentional.

Gemini multipart queries use `type: 'multiPart'` with text and inline-data
parts. Supply the encoding and MIME type required by the provider; do not send
an entire scene image when known application state answers the task.

## Generate an image

```js
const image = await xb.ai.generate('A low-poly treehouse', 'image');
if (image?.startsWith('data:image/')) {
  console.log('Generated image data URL', image.slice(0, 30));
}
```

A successful Gemini image result is a data URL. Validate it before setting a UI
image or loading a texture. Handle empty results and generation errors.

The optional Roomcraft integration composes editable scene objects from a
validated plan. See its [existing source documentation](https://github.com/google/xrblocks/blob/main/src/addons/roomcraft/README.md)
for the supported boundary; it does not execute arbitrary model-generated code.

## Choose grounding and lifetime

Use [scene context](/sdk/context) for named app objects and visible state,
[camera snapshots](/sdk/camera) for real imagery, and [Live AI](/sdk/ai/live)
for a continuing audio/video session. Context collection does not automatically
send anything to a provider. Keep provider secrets on a server for production.

[Run the query starter](https://xrblocks.github.io/templates/06_ai_query/) ·
[Source](https://github.com/google/xrblocks/blob/main/templates/06_ai_query/main.js) · [AI reference](/api/classes/AI)
