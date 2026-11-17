---
title: Starters and examples
slug: /examples
---

# Starters and examples

Choose a small starter to learn one capability. Use an example to combine
capabilities into a complete task. Source links open the repository; hosted launch links run the site's deployed examples.

## Run locally

From a repository checkout:

```bash
npm ci
npm run build:sdk
npm run serve
```

Open the starter's path at `http://127.0.0.1:8080/`. A page can opt into desktop
startup with `?formFactor=desktop`. Stop the server with Ctrl+C when finished.
The separate TypeScript/Vite project has its own install/dev/build commands.

## Starters

| Starter                                                                                      | Task and requirements                                  | Source / guide                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [Basic](https://xrblocks.github.io/templates/00_basic/)                                      | Lifecycle, visible object, selection; no provider.     | [Code](https://github.com/google/xrblocks/blob/main/templates/00_basic/main.js), [quickstart](/get-started/developer-quickstart) |
| [Spatial UI](https://xrblocks.github.io/templates/01_spatial_ui/)                            | Layout, controls, updates; UI dependencies.            | [Code](https://github.com/google/xrblocks/blob/main/templates/01_spatial_ui/main.js), [UI](/sdk/ui)                              |
| [Object interaction](https://xrblocks.github.io/templates/02_object_interaction/)            | Select, touch, grab, and move; hands for direct touch. | [Code](https://github.com/google/xrblocks/blob/main/templates/02_object_interaction/main.js), [interaction](/sdk/interaction)    |
| [Spatial placement](https://xrblocks.github.io/templates/03_spatial_placement/)              | Preview/place a depth hit; depth evidence.             | [Code](https://github.com/google/xrblocks/blob/main/templates/03_spatial_placement/main.js), [placement](/sdk/placement)         |
| [Stereo](https://xrblocks.github.io/templates/04_stereo/)                                    | Per-eye media; check on a stereo device.               | [Code](https://github.com/google/xrblocks/blob/main/templates/04_stereo/main.js), [media](/sdk/media)                            |
| [Camera view](https://xrblocks.github.io/templates/05_camera_view/)                          | Display/switch cameras; permission and stream.         | [Code](https://github.com/google/xrblocks/blob/main/templates/05_camera_view/main.js), [camera](/sdk/camera)                     |
| [AI query](https://xrblocks.github.io/templates/06_ai_query/)                                | Bounded request; provider and credentials.             | [Code](https://github.com/google/xrblocks/blob/main/templates/06_ai_query/main.js), [AI](/sdk/ai)                                |
| [Live assistant](https://xrblocks.github.io/templates/07_ai_live_assistant/)                 | Live audio/camera; provider and microphone.            | [Code](https://github.com/google/xrblocks/tree/main/templates/07_ai_live_assistant), [Live AI](/sdk/ai/live)                     |
| [Scene understanding](https://xrblocks.github.io/templates/08_scene_understanding/)          | Spatial detection; backend, camera, and depth.         | [Code](https://github.com/google/xrblocks/blob/main/templates/08_scene_understanding/main.js), [detection](/sdk/world/detection) |
| [XR backgrounds](https://xrblocks.github.io/templates/09_xr_modes/)                          | Visual background fades within a session.              | [Code](https://github.com/google/xrblocks/blob/main/templates/09_xr_modes/main.js), [rendering](/sdk/rendering)                  |
| [Environment physics](https://xrblocks.github.io/templates/10_environment_physics/)          | Rapier objects and depth colliders.                    | [Code](https://github.com/google/xrblocks/blob/main/templates/10_environment_physics/main.js), [physics](/sdk/physics)           |
| [Agent context](https://xrblocks.github.io/templates/11_agent_context/)                      | Capture context and optionally query AI.               | [Code](https://github.com/google/xrblocks/blob/main/templates/11_agent_context/main.js), [context](/sdk/context)                 |
| [Hand gestures](https://xrblocks.github.io/templates/12_hand_gestures/)                      | Inspect recognition; tracked or simulated hands.       | [Code](https://github.com/google/xrblocks/tree/main/templates/12_hand_gestures), [gestures](/sdk/gestures)                       |
| [TypeScript/Vite](https://github.com/google/xrblocks/tree/main/templates/13_typescript_vite) | A project with build/type checks.                      | [Installation](/get-started/installation#vite-configuration)                                                                     |
| [Simulator setup](https://xrblocks.github.io/templates/14_simulator_setup/)                  | Interface, control modes, and debug settings.          | [Code](https://github.com/google/xrblocks/blob/main/templates/14_simulator_setup/main.js), [simulator](/sdk/simulator)           |
| [Planes](https://xrblocks.github.io/templates/15_planes/)                                    | Visualize planes and place an object.                  | [Code](https://github.com/google/xrblocks/blob/main/templates/15_planes/main.js), [surfaces](/sdk/world/surfaces)                |

## Complete tasks

- [Interactive spatial form](/examples/spatial-form): input, scrolling, validation, submission.
- [Persistent room content](/examples/room-content): anchors and restoration.
- [Scene-aware assistant](/examples/live-assistant): live media and grounded tools.
- [Shared spatial experience](/examples/shared-experience): presence and shared objects.

[Explore showcases](/examples/showcases) for larger combinations. A source or
launch link is not a claim that a provider or hardware path was tested in this build.
