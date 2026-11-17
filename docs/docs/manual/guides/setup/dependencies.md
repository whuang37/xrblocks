---
title: Dependencies and module loading
slug: /integrations/dependencies
---

# Dependencies and module loading

Resolve each package used by the enabled feature. Externalizing a package tells
a bundler to leave its import in the output; it does not supply the package at
runtime.

## Keep one Three.js instance

Align `three`, its addons, `three/webgpu`, and `three/tsl` with the SDK's peer
range. The current SDK expects `^0.186.0`. Do not mix CDN and bundled copies.
Map `xrblocks/addons/` to the public addon directory, not private internal chunks.

## Feature dependencies

| Feature                   | Package or asset                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Spatial UI                | `@pmndrs/uikit` at the package's pinned version, `@preact/signals-core`; browser maps must resolve UIKit's dependencies too |
| Simulator browser panels  | `lit`, including its subpath imports                                                                                        |
| Gemini / OpenAI           | `@google/genai` / `openai`                                                                                                  |
| Vision/audio inference    | Relevant `@mediapipe/tasks-vision` or `@mediapipe/tasks-audio` package plus model/WASM assets                               |
| Physics                   | One compatible Rapier variant supplied through `options.physics.RAPIER`                                                     |
| Splat assets              | `@sparkjsdev/spark` on WebGL                                                                                                |
| Simulator navigation mesh | `three-pathfinding`                                                                                                         |
| LiteRT integration        | `@litertjs/core` and the selected model/runtime assets                                                                      |

Use the chosen [starter's HTML](/examples#starters) as a complete browser-module
map for that feature. For example, the simulator setup map is:

```html title="templates/14_simulator_setup/index.html"
<!doctype html>
<html lang="en">
  <head>
    <title>Simulator Setup | XR Blocks Template</title>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, user-scalable=no"
    />
    <link rel="stylesheet" href="../../samples/main.css" />
    <script>
      window.litDisableBundleWarning = true;
    </script>
    <script type="importmap">
      {
        "imports": {
          "three": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
          "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/",
          "three-mesh-bvh": "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.10/build/index.module.js",
          "three-pathfinding": "https://cdn.jsdelivr.net/npm/three-pathfinding@1.3.0/dist/three-pathfinding.module.js",
          "lit": "https://esm.sh/lit@3.3.1",
          "lit/": "https://esm.sh/lit@3.3.1/",
          "xrblocks": "../../build/xrblocks.js"
        }
      }
    </script>
  </head>
  <body>
    <script type="module" src="main.js"></script>
  </body>
</html>
```

## Bundlers and declarations

Install packages used at runtime. For unused lazy providers, follow the
[TypeScript/Vite starter's configuration](https://github.com/google/xrblocks/blob/main/templates/13_typescript_vite/vite.config.ts):
use dependency-prebundling exclusions during development and externals for
production. The starter bundles its UI and simulator panel dependencies.
Preserved bare imports still need a runtime mapping if an excluded integration
later loads them.

Use TypeScript `moduleResolution: 'bundler'`. `skipLibCheck: true` avoids
checking declarations for unused integrations. With strict declaration checking,
install the referenced optional peers and `@types/three`. The package's
[manifest](https://github.com/google/xrblocks/blob/main/package.json) is the version/dependency authority.

For LiteRT with TypeScript 5.9, include `@webgpu/types`. TypeScript 6+ provides
WebGPU DOM declarations; adding that package's globals there can conflict.

## Diagnose resolution failures

Inspect the exact failed import or asset URL. A missing WASM/model asset is a
feature-loading failure even when the main JavaScript module loaded. On deploy,
serve the entire SDK build and check requests beneath `internal/` and `addons/`.

[Installation](/get-started/installation) · [Build and deploy](/integrations/build-and-deploy) ·
[Troubleshooting](/sdk/troubleshooting)
