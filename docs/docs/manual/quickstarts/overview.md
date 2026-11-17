---
title: Overview and requirements
slug: /get-started/overview
sidebar_position: 1
---

# Overview and requirements

XR Blocks is a JavaScript/TypeScript SDK for building spatial interfaces,
interacting with 3D objects, sensing the environment, and connecting AI to an XR
scene. Develop in the desktop simulator, then run the same app on an XR device.

## Build your first app

The quickstart builds a spatial panel with a button that changes its text.
It uses a normal Vite project and needs no headset or AI credentials.

| How you want to build                | Start here                                                |
| ------------------------------------ | --------------------------------------------------------- |
| Write the app yourself               | [Developer quickstart](/get-started/developer-quickstart) |
| Have a coding agent create it        | [Agent quickstart](/get-started/agent-quickstart)         |
| Add XR Blocks to an existing project | [Installation](/get-started/installation)                 |
| Explore an existing application      | [Examples](/examples)                                     |

For either quickstart, install Node.js 24 or later and npm, and use a desktop browser
with WebGL. Internet access is needed to install packages. The SDK's Three.js
peer range is currently `^0.186.0`.

## How an app fits together

Your app creates scene objects or UI components, adds them to the SDK scene,
and calls `xb.init()`. The engine owns the renderer, frame loop, input routing,
and XR entry. Use a `Script` when behavior needs lifecycle or per-frame hooks.

After the quickstart, add [forms](/sdk/ui/forms),
[3D object interaction](/sdk/interaction), or [placement](/sdk/placement).
The [SDK guide index](/sdk) maps the remaining features to their setup pages.

## Desktop and device

The simulator supplies a room, inputs, and synthetic sensing evidence. It does
not emulate the browser's WebXR API. XR Blocks targets Chrome 136+ with WebXR on
Android XR; individual features still depend on the device and browser.

[Run in XR](/get-started/run) when the desktop app works. Camera access, depth,
anchors, and hands have their own [capability requirements](/get-started/capabilities).
Use a secure origin for device access; a headset opening another machine's
plain HTTP address does not receive localhost's secure-context exception.
