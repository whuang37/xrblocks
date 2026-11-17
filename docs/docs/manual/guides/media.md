---
title: Stereo media and XR layers
slug: /sdk/media
sidebar_position: 16
---

# Stereo media and XR layers

Stereo media sends different content to each eye. Composition layers let a
supported XR compositor present content separately from the scene's eye buffer.
These features have different setup and fallback requirements.

## Present stereo content

Use the [Stereo starter](https://xrblocks.github.io/templates/04_stereo/) to see the supported
per-eye geometry/material setup. Keep the left/right convention consistent with
the source asset. A desktop preview cannot prove binocular alignment or comfort.

```js title="templates/04_stereo/main.js"
import * as THREE from 'three';
import * as xb from 'xrblocks';

const stereoTextureFile = 'SV_20241216_144600.webp';

class StereoImage extends xb.Script {
  async init() {
    await this.addStereoQuad();
  }

  async addStereoQuad() {
    const stereoObject = new THREE.Group();
    const [leftTexture, rightTexture] =
      await xb.loadStereoImageAsTextures(stereoTextureFile);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const leftMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: leftTexture,
        side: THREE.DoubleSide,
      })
    );

    xb.showOnlyInLeftEye(leftMesh);
    stereoObject.add(leftMesh);
    const rightMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: rightTexture,
        side: THREE.DoubleSide,
      })
    );

    xb.showOnlyInRightEye(rightMesh);
    stereoObject.add(rightMesh);
    stereoObject.position.set(0.0, 1.5, -1.5);
    stereoObject.name = 'Stereo image';
    this.add(stereoObject);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const options = new xb.Options();
  options.simulator.stereo.enabled = true;
  xb.add(new StereoImage());
  xb.init(options);
});
```

The complete [HTML and import map](https://github.com/google/xrblocks/blob/main/templates/04_stereo/index.html)
supplies its dependencies. Replace assets with URLs your deployment can serve.
For video, await a user-triggered `play()` and handle playback rejection; loading
a texture does not bypass autoplay policy.

## Use composition layers

Enable `options.enableLayers()` before initialization. `LayerManager` maintains
the compositor stack and `VideoLayer` presents a video where supported.
The application's layer setup must preserve the projection/base layer that
Three.js uses for the ordinary scene.

`VideoLayer.getState()` reports `layer` or `fallback`. A fallback result tells
the application to keep its in-scene video visible; it does not create that
fallback mesh automatically. The [layers example](https://github.com/google/xrblocks/blob/main/demos/layers/LayersScene.js)
shows session binding, base-layer ownership, attachment, fallback, and cleanup.

Layers have explicit reference-space placement. They do not inherit a Group's
transform like an ordinary mesh. Verify the actual supported binding on hardware
before claiming a quality or frame-rate improvement.

## Cleanup and checks

Pause app-owned videos, detach layers, dispose video textures and geometry,
and stop any tracks the app created. Session exit must not submit a layer stack
to an already-ended session.

Check playback failure, per-eye assignment, fallback visibility, exit/re-entry,
and actual layer state on the target device.

[VideoLayer reference](/api/classes/VideoLayer) · [LayerManager reference](/api/classes/LayerManager) ·
[Run the layer comparison](https://xrblocks.github.io/demos/layers/) · [Rendering](/sdk/rendering)
