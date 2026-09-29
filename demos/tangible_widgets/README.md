# Surface widgets demo

Attach a widget to any textured, rigid surface. Registration uses the central
camera patch and XR depth. It does not wait for object recognition.

## On Galaxy XR

1. Build with `npm run build:sdk` and run `npm run serve`.
2. Open `/demos/tangible_widgets/?debug=1` through your HTTPS development host.
3. Enter AR and grant camera permissions.
4. Use **Change widget** to choose reading, timer, or tilt.
5. Look at the left camera preview. Fill its green square with a textured surface
   about 0.4–1.2 m away. Keep the square off your fingers and background.
6. Press **Register centre patch**, then hold still until the status is `tracked`.
7. Move and tilt the object. The panel should follow the registered surface.

The reading card has sample pages and a Next button. The timer has start/pause
and reset. Tilt moves a dot; **Neutral tilt** sets its centre. Any of these widgets
can attach to a book, decorated cup, labelled bottle, or another suitable surface.
Flat panels sit above curved surfaces; they do not wrap around them.

If tracking is lost, aim at the surface and register again. **Clear attachment**
returns to preview mode. A new object is never chosen automatically after loss.

## Optional object label

After registration succeeds, the demo runs one MediaPipe detection on the saved
registration image in `LabelWorker.js`. It considers boxes covering the image
centre and displays a category estimate. Unknown, incorrect, slow, or failed
labels do not change the selected widget or tracking. Detection runs in a separate
worker, loads only after registration, and stops after its result or a timeout.
It is demo code, not part of the tangible addon or its API.

## Diagnosis

The preview shows the actual camera input; the green outline is added only to the
preview. **Pixels** shows sampled brightness from 0–255. All-zero values suggest
black camera pixels. A black preview with varied values suggests a display issue.

Compare image features, depth features, and fit inliers. At least 12 valid depth
features are required to register. The **Last issue** line retains the failure
reason. Transparent, plain, reflective, or heavily occluded surfaces may fail.
Depth is required only for registration. Motion uses the saved 3D feature map
and camera images; it cannot follow a full rotation that hides the patch.
Fit error is now shown in image pixels. Compare capture and worker times and
check that button presses remain responsive while moving the object.

Camera timing `estimated` uses the device video stream and approximate calibration;
`xr-frame` uses raw XR camera access. Neither label guarantees physical alignment.
A webcam alone cannot supply XR depth. Desktop registration needs trackable
texture and simulated depth, but no category detector or ground-truth object label.

In debug mode, inspect `window.tangibleDemo.tracker`.
See [addon setup](../../src/addons/tangible/README.md).
