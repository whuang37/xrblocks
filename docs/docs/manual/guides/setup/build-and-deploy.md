---
title: Build and deploy an app
slug: /integrations/build-and-deploy
---

# Build and deploy an app

Deploy the application and every file its modules load. A successful development
page does not prove the deployed paths, permissions, or feature dependencies.

## Bundled application

In the [TypeScript/Vite starter](/get-started/installation#vite-configuration):

```bash
npm run build
npm run preview
```

Inspect the generated `dist/` directory through the preview server, then deploy
that complete directory. Configure the bundler's base path for subdirectory
hosting. Keep public asset URLs consistent with that path.

## Browser modules or a copied SDK build

Serve the complete SDK `build/` output:

```text
build/
  xrblocks.js
  xrblocks.min.js
  internal/
  addons/
```

The SDK lazily loads private chunks. Copying only `xrblocks.js` can break UI,
simulator, or other features later. Do not import private `internal/` files
from app code. Pin SDK URLs to the intended release/build revision and keep its
chunks together.

## Host requirements

Serve JavaScript modules with an appropriate JavaScript MIME type. Make models,
textures, WASM, and environment manifests reachable at their actual URLs.
Cross-origin resources need permissions suitable for their use; an image that
displays elsewhere can still fail when used for canvas capture.

Use a secure origin for restricted APIs. A headset connecting to another
machine's HTTP LAN address does not inherit localhost's exception. Request
camera/microphone permissions through the app's supported entry flow.

## Check the deployed page

Load the deployed URL with a fresh cache, enter the simulator, and exercise a
feature that loads a lazy chunk. Check network errors and an actual interaction.
Then check device entry and the [capabilities](/get-started/capabilities) the app
claims. Stop preview/local servers when finished.

[Dependencies](/integrations/dependencies) · [Verification](/sdk/verification) ·
[Troubleshooting](/sdk/troubleshooting)
