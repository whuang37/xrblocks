# Object widgets demo

Show a **book**, **cup**, or **bottle** to attach a widget automatically:

- Book: a short reading card with a working Next page button.
- Cup: a three-minute start/pause/reset timer.
- Bottle: a dot controlled by the registered object's tilt.

All three widgets attach to the visible object patch. Curved objects do not use
a separate floating side panel. Registration sets a local attachment frame;
the panel stays flat rather than wrapping around the object.

## Run on Android XR

1. Run `npm ci` if dependencies are missing, then `npm run build:sdk`.
2. Run `npm run serve` and expose this checkout through your usual HTTPS
   development host. A plain HTTP LAN address is not a secure camera/WebXR origin.
3. Open `/demos/tangible_widgets/?debug=1` in the headset browser.
4. Enter AR and grant the requested camera and XR permissions.
5. Hold a textured object near the centre of view, about 0.4–1.2 m away. Wait for
   the status to show `tracked`, then move and rotate it slowly.
6. Use **Find / register again** to choose another object. Use **Neutral tilt**
   to reset the bottle control's neutral orientation.

No API key, printed fiducial, or physical size entry is required. The default
models/runtime files load from public CDNs. Image processing then runs locally.

The first registration can take a moment. An object needs enough visible image
features and usable depth points. Prefer a printed cover, decorated cup, or
opaque labelled bottle. Clear bottles and plain cups often provide poor evidence.

The diagnostics report depth feature count, rigid-fit residual, worker time,
observation age, and camera timing mode. `estimated` indicates the media-stream
camera path, which uses the SDK's approximate device calibration. A small fit
residual does not prove exact camera alignment.

If the widget disappears, check the status. Missing depth, occlusion, stale
frames, or inconsistent motion disable the attachment and its controls. This
version needs depth while tracking and does not track continuously through a full
rotation that hides the registered face. Recognition selects an object category;
it does not remember your specific book or cup across sessions.

## Desktop and scope

The desktop simulator can load the UI and run the worker, but its scene needs a
recognizable textured object and simulated depth for registration. A normal webcam
alone is insufficient. The demo does not replace camera recognition with simulator
ground truth. Use Android XR for the intended interaction trial.

The reading content is sample text; it does not read the book's pages. The timer
runs locally; it does not control an appliance. Existing ray/pinch UI input works
on the attached cards; this addon does not add a monocular fingertip-touch detector.

With `?debug=1`, inspect `window.tangibleDemo.tracker` in the browser console.
See [addon setup and limits](../../src/addons/tangible/README.md).

For a failed device run, record **Last issue**, the detected category, image/depth
feature counts, capture/depth-index/worker times, image age, and camera timing.
The last failure stays visible after a new registration attempt. Recognition
runs only while searching; tracking captures are capped at 15 fps and 480 pixels
wide. Raw XR snapshots are resized before GPU readback.
