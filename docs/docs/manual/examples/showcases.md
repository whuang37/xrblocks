---
title: Explore showcases
slug: /examples/showcases
sidebar_position: 5
---

# Explore showcases

These applications combine SDK features. Launch one to explore its behavior,
then read its source and the owning guide before copying the pattern. They are
source examples, not a claim that every provider or hardware path was verified
in this documentation build.

For a smaller starting point, use the [starter catalog](/examples#starters).
For local showcase builds, run `npm ci`, `npm run build`, and `npm run serve`
from the repository. Some demos load compiled TypeScript and need the full
build rather than `build:sdk`. Read the source project for additional services.

| Showcase                                                                                                 | Requirements to check                                                     | Complete source                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Model Viewer](https://xrblocks.github.io/samples/spatial_ui/modelviewer/)                               | glTF/splat assets; Spark and WebGL for splats.                            | [Source](https://github.com/google/xrblocks/tree/main/samples/spatial_ui/modelviewer)             |
| [UI Blocks](https://xrblocks.github.io/samples/spatial_ui/ui/)                                           | UI packages and the example's image/font assets.                          | [Source](https://github.com/google/xrblocks/tree/main/samples/spatial_ui/ui)                      |
| [Occlusion](https://xrblocks.github.io/samples/xr_realism/occlusion/)                                    | Depth evidence and the sample's material integration.                     | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_realism/occlusion)               |
| [Hand Gestures](https://xrblocks.github.io/samples/xr_interaction/hand_gestures/)                        | Tracked or simulated hand poses and gesture recognition.                  | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_interaction/hand_gestures)       |
| [Depth Map](https://xrblocks.github.io/samples/xr_realism/depthmap/)                                     | Depth evidence and the visualization render pass.                         | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_realism/depthmap)                |
| [Head Gestures](https://xrblocks.github.io/samples/xr_interaction/head_gestures/)                        | Camera pose and completed nod/shake motion.                               | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_interaction/head_gestures)       |
| [Depth Mesh](https://xrblocks.github.io/samples/xr_realism/depthmesh/)                                   | Depth evidence; device testing for native reconstruction.                 | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_realism/depthmesh)               |
| [Reticle](https://xrblocks.github.io/samples/xr_realism/reticle/)                                        | A pointing source; depth for environment projection.                      | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_realism/reticle)                 |
| [Paint](https://xrblocks.github.io/samples/advanced/paint/)                                              | Pointing/selection input and drawing resources.                           | [Source](https://github.com/google/xrblocks/tree/main/samples/advanced/paint)                     |
| [Gemini Icebreakers](https://xrblocks.github.io/samples/xr_ai/gemini_icebreakers/)                       | Gemini credentials, microphone/camera permissions, network.               | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_ai/gemini_icebreakers)           |
| [Ballpit](https://xrblocks.github.io/samples/advanced/ballpit/)                                          | Rapier and depth/environment collision geometry.                          | [Source](https://github.com/google/xrblocks/tree/main/samples/advanced/ballpit)                   |
| [Rock Paper Scissors](https://xrblocks.github.io/samples/xr_interaction/rock_paper_scissors/)            | Hand poses and gesture recognition.                                       | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_interaction/rock_paper_scissors) |
| [XR Emoji](https://xrblocks.github.io/samples/xr_interaction/xr_emoji/)                                  | Tracked/simulated hands and supported gesture input.                      | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_interaction/xr_emoji)            |
| [Splash](https://xrblocks.github.io/samples/advanced/splash/)                                            | Pointing input and audio assets; audio playback permission.               | [Source](https://github.com/google/xrblocks/tree/main/samples/advanced/splash)                    |
| [Screen Wiper](https://xrblocks.github.io/samples/advanced/screenwiper/)                                 | The sample's screen-space rendering path and assets.                      | [Source](https://github.com/google/xrblocks/tree/main/samples/advanced/screenwiper)               |
| [XR Object](https://xrblocks.github.io/samples/xr_ai/gemini_xrobject/)                                   | Gemini credentials and captured scene input.                              | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_ai/gemini_xrobject)              |
| [Rain](https://xrblocks.github.io/samples/advanced/rain/)                                                | Particle/rendering assets and sufficient frame budget.                    | [Source](https://github.com/google/xrblocks/tree/main/samples/advanced/rain)                      |
| [Lighting](https://xrblocks.github.io/samples/xr_realism/lighting/)                                      | Light-estimation support or simulator lighting; lit materials.            | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_realism/lighting)                |
| [XR Poet](https://xrblocks.github.io/samples/xr_ai/xrpoet/)                                              | Gemini credentials, network, and the selected scene input.                | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_ai/xrpoet)                       |
| [Drone](https://xrblocks.github.io/samples/advanced/drone/)                                              | Model assets and the example's control/physics dependencies.              | [Source](https://github.com/google/xrblocks/tree/main/samples/advanced/drone)                     |
| [3D graphing calculator](https://xrblocks.github.io/demos/math3d/)                                       | UI and mathematical expression/graphing dependencies.                     | [Source](https://github.com/google/xrblocks/tree/main/demos/math3d)                               |
| [Virtual Screens](https://xrblocks.github.io/samples/advanced/virtual_screens/)                          | Media assets and browser playback/capture permissions as used.            | [Source](https://github.com/google/xrblocks/tree/main/samples/advanced/virtual_screens)           |
| [Balloon Pop](https://xrblocks.github.io/samples/advanced/balloonpop/)                                   | Tracked/simulated hand or pointer input and physics assets.               | [Source](https://github.com/google/xrblocks/tree/main/samples/advanced/balloonpop)                |
| [3DGS Walkthrough](https://xrblocks.github.io/samples/xr_realism/3dgs_walkthrough/)                      | Spark, WebGL, splat assets, and sufficient GPU memory.                    | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_realism/3dgs_walkthrough)        |
| [Portal Gallery](https://xrblocks.github.io/samples/advanced/portals/)                                   | Portal assets and the sample's rendering setup.                           | [Source](https://github.com/google/xrblocks/tree/main/samples/advanced/portals)                   |
| [Language Detector](https://xrblocks.github.io/samples/xr_ai/language_detector/)                         | Provider credentials and text/audio input used by the example.            | [Source](https://github.com/google/xrblocks/tree/main/samples/xr_ai/language_detector)            |
| [Netblocks](https://xrblocks.github.io/demos/netblocks/)                                                 | Two peers and the selected signaling/relay transport.                     | [Source](https://github.com/google/xrblocks/tree/main/demos/netblocks)                            |
| [Lipsync Puppet](https://xrblocks.github.io/samples/avatar_lab/lipsync_puppet/)                          | Audio input/playback, avatar assets, and lipsync mapping.                 | [Source](https://github.com/google/xrblocks/tree/main/samples/avatar_lab/lipsync_puppet)          |
| [VRM Avatar](https://xrblocks.github.io/demos/vrm-avatar/)                                               | VRM loader/model assets; permission for any tracking input used.          | [Source](https://github.com/google/xrblocks/tree/main/demos/vrm-avatar)                           |
| [3D Object Detection](https://xrblocks.github.io/demos/objects_3d/)                                      | Selected detector backend, camera/depth, provider credentials where used. | [Source](https://github.com/google/xrblocks/tree/main/demos/objects_3d)                           |
| [Face Landmarks](https://xrblocks.github.io/samples/avatar_lab/face_mirror/)                             | Camera permission, face-model assets, and depth for world landmarks.      | [Source](https://github.com/google/xrblocks/tree/main/samples/avatar_lab/face_mirror)             |
| [Person Segmentation](https://xrblocks.github.io/demos/magic_window/)                                    | Camera permission and local segmentation model/runtime assets.            | [Source](https://github.com/google/xrblocks/tree/main/demos/magic_window)                         |
| [GNM Head](https://xrblocks.github.io/samples/avatar_lab/gnm/)                                           | Head-model assets; camera or portrait image for fitting/tracking.         | [Source](https://github.com/google/xrblocks/tree/main/samples/avatar_lab/gnm)                     |
| [Collaborative Roomcraft](https://xrblocks.github.io/demos/roomcraft/?collab=1&lobby=1&transport=webrtc) | Two peers and networking; provider credentials for AI authoring.          | [Source](https://github.com/google/xrblocks/tree/main/demos/roomcraft)                            |
| [Super-Resolution](https://xrblocks.github.io/demos/super_resolution/)                                   | Local inference runtime and super-resolution model assets.                | [Source](https://github.com/google/xrblocks/tree/main/demos/super_resolution)                     |
| [Gemma 4 On-Device](https://xrblocks.github.io/demos/gemma_on_device/)                                   | Model download, local inference runtime, and sufficient device memory.    | [Source](https://github.com/google/xrblocks/tree/main/demos/gemma_on_device)                      |
| [Gemma Vision](https://xrblocks.github.io/demos/gemma_vision/)                                           | Camera permission and local model/runtime assets.                         | [Source](https://github.com/google/xrblocks/tree/main/demos/gemma_vision)                         |
| [Offline Captions](https://xrblocks.github.io/demos/offline_captions/)                                   | Microphone permission and local speech-model assets.                      | [Source](https://github.com/google/xrblocks/tree/main/demos/offline_captions)                     |

## Inspect a result

Check a complete action and its outcome. A 3D view loading does not prove
occlusion, speech, networking, or persistence works. Use the relevant
[SDK guide](/sdk), [dependency setup](/integrations/dependencies), and
[verification steps](/sdk/verification).
