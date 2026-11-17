---
title: Installation and project structure
slug: /get-started/installation
sidebar_position: 4
---

# Installation and project structure

Use the [developer quickstart](/get-started/developer-quickstart) for a new app.
This page covers existing projects, bundler configuration, and browser modules.

## Add to an existing project

```bash
npm install xrblocks@0.24.0 three@0.186.0 lit
npm install --save-dev @types/three@0.186.0
```

npm installs the SDK's required UI peers at the versions its package declares.
Lit supplies the simulator's browser panels. Use one resolved Three.js version
across the app, SDK, and integrations.

With TypeScript, use `module: "ESNext"`, `moduleResolution: "bundler"`, and the
`ES2023`, `DOM`, and `DOM.Iterable` libraries. TypeScript 5.9 or later is supported;
`skipLibCheck: true` avoids checking declarations for unused optional integrations.

## Vite configuration

Create `vite.config.ts` in the project root:

```ts title="vite.config.ts"
import {defineConfig} from 'vite';

// These optional integrations are not used by this starter. Keep the UI and
// simulator panel dependencies bundled so they resolve in the production app.
const unusedDependencies = [
  '@google/genai',
  '@mediapipe/tasks-vision',
  '@mediapipe/tasks-audio',
  'openai',
  '@sparkjsdev/spark',
  'three-mesh-bvh',
  '@litertjs/core',
  'three-pathfinding',
];

export default defineConfig({
  optimizeDeps: {
    exclude: unusedDependencies,
  },
  build: {
    rollupOptions: {
      external: unusedDependencies,
    },
  },
});
```

This bundles the UI and simulator panel dependencies while leaving unused
provider and ML integrations external. Install and remove an integration from
this list when your app starts using it. See [dependencies](/integrations/dependencies)
for other bundlers and runtime requirements.

For a prepared project, the
[TypeScript/Vite example](https://github.com/google/xrblocks/tree/main/templates/13_typescript_vite)
contains these settings and a runnable application.

## Browser modules

For a page without a build, create `index.html` with this complete import map:

```html title="index.html"
<!doctype html>
<html lang="en">
  <head>
    <title>My XR app</title>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, user-scalable=no"
    />
    <script type="importmap">
      {
        "imports": {
          "three": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
          "three/": "https://cdn.jsdelivr.net/npm/three@0.186.0/",
          "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/",
          "@pmndrs/uikit": "https://cdn.jsdelivr.net/npm/@pmndrs/uikit@1.0.64/dist/index.min.js",
          "@pmndrs/uikit-pub-sub": "https://cdn.jsdelivr.net/npm/@pmndrs/uikit-pub-sub@1.0.64/dist/index.min.js",
          "@pmndrs/msdfonts": "https://cdn.jsdelivr.net/npm/@pmndrs/msdfonts@1.0.64/dist/index.min.js",
          "@pmndrs/msdfonts/inter": "https://cdn.jsdelivr.net/npm/@pmndrs/msdfonts@1.0.64/dist/inter.js",
          "@pmndrs/msdfonts/": "https://cdn.jsdelivr.net/npm/@pmndrs/msdfonts@1.0.64/dist/",
          "zod": "https://cdn.jsdelivr.net/npm/zod@4.4.3/+esm",
          "@preact/signals-core": "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.14.0/dist/signals-core.mjs",
          "yoga-layout/load": "https://cdn.jsdelivr.net/npm/yoga-layout@3.2.1/dist/src/load.js",
          "lit": "https://esm.sh/lit@3.3.1",
          "lit/": "https://esm.sh/lit@3.3.1/",
          "xrblocks": "https://cdn.jsdelivr.net/npm/xrblocks@0.24.0/build/xrblocks.js"
        }
      }
    </script>
  </head>
  <body>
    <script type="module" src="main.js"></script>
  </body>
</html>
```

Create `main.js` beside it. The panel module in
[the developer quickstart](/get-started/developer-quickstart#add-a-spatial-panel)
also runs as JavaScript; copy that code into `main.js`.

Serve this folder and open the printed local address:

```bash
npx http-server . -p 8080
```

Choose **Enter Simulator** if shown, then press **Add one**. Stop the server with
Ctrl+C when finished. Keep the import map before module scripts and pin aligned
SDK/Three.js versions when upgrading.

For a local SDK build, map `xrblocks` to the served `build/xrblocks.js` and serve
the entire build directory, including private chunks. Do not import those chunks
directly. [Build and deploy](/integrations/build-and-deploy) explains hosting.
