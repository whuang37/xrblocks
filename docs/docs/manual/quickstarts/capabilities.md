---
title: Capabilities and permissions
slug: /get-started/capabilities
sidebar_position: 6
---

# Capabilities and permissions

A public API can exist even when a device cannot supply its data. Keep the app
usable while a feature is unsupported, waiting for permission, warming up, empty,
or temporarily unavailable.

## Feature requirements

| Feature                         | Requires                                                             | Desktop evidence                                        |
| ------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Rendering and mouse interaction | WebGL and resolved modules                                           | Rendered application and mouse behavior                 |
| Immersive XR                    | Secure context, WebXR, supported session, user entry action          | Simulator does not prove native session support         |
| Hand joints and direct touch    | Enabled hands and tracked joint poses                                | Simulated poses and contacts                            |
| Planes and scene meshes         | Enabled branch and native or simulated geometry                      | Environment-derived geometry                            |
| Depth and occlusion             | Enabled depth and supported data/render path                         | Synthetic environment depth                             |
| Camera-based detection          | Camera frames, backend/model assets, sometimes depth or credentials  | Rendered room or selected webcam                        |
| Spatial anchors                 | Enabled anchors and platform support, or explicit simulated fallback | Locally held poses; no native relocalization proof      |
| Live AI                         | Provider, network, credentials, selected media inputs                | Connection and application behavior with supplied media |
| XR layers                       | Layer support and compatible renderer/session                        | Fallback rendering when no native layer exists          |

The SDK targets Android XR, but feature availability must be checked in the
running session. Do not infer raw camera access or depth from the presence of
`navigator.xr`.

## Declare permissions before entry

```js
const options = new xb.Options();
options.permissions.camera = true;
options.permissions.microphone = true;
```

Helpers such as `enableCamera()` set their stated prerequisites. Direct nested
assignments need not perform the same setup. The entry flow requests declared
browser permissions before immersive entry, where browser prompts can be
restricted. A user can deny a request or the device can reject session features.

Use `webxrRequiredFeatures` only when the app cannot work without a feature.
Optional features allow entry without that capability; the app must still handle
missing data. `enableHands()` requests hand tracking optionally.

## Handle missing evidence

Show a waiting state until current data arrives. Clear old labels when detection
returns no results. Offer another input source when hands are lost. Explain a
failed permission or session request in visible app state.

[Resource ownership](/sdk/resources) explains cleanup;
[verification](/sdk/verification) separates simulator checks from device checks.
