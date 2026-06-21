# Sensors Debugger Sample

This sample demonstrates the XR Blocks **Sensors Addon** by building a real-time floating telemetry debugger in the DOM. It showcases the simplified async execution pipeline and provides a visual inspector for all 5 core sensor streams.

![Sensors Debugger](https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/sensors/default/48px.svg)

## Features

- **Set-of-Mark (SOM) Viewport**: Renders real-time camera screenshots annotated with visual IDs for all visible, interactive objects.
- **Environmental Depth Heatmap**: Visualizes real-time depth-sensing grids by rendering distance measurements (0m to 4m) as a smooth blue-to-red color ramp on a 2D canvas.
- **Plaintext Subtitles**: Displays a live, unoccluded index of visible entities with descriptions (e.g., `"Green Torus"`, `"Orange Box"`).
- **Skeletal Proprioception**: Inspects head (camera) and hand tracking coordinates, visibility states, and pinching gestures.
- **Targeting & Pointer Normals**: Monitors Left, Right, and Gaze targeting rays, indicating hit object IDs, intersection coordinates, and surface normal vectors.

## How to Use

1. Serve the repository locally by running `npm run dev`.
2. Open the browser and navigate to the samples page (`http://127.0.0.1:8080/samples/sensors_debug/`).
3. You will see a 3D prototyping room containing three draggable, colorful shapes (a green Torus, an orange Box, and a blue Sphere).
4. The floating **Sensors Debugger** sidebar on the right will update in real-time at 10Hz.
5. Drag and move the shapes around, look around with the mouse, or use the simulator keys (`Left Shift` to toggle hand modes, `WASD` to move) to watch the targeting intersections, depth heatmaps, and SOM overlays respond instantly.

## Technical Highlights

The sample showcases:

- **Centralized Capture Pipeline**: Using `SensorsManager.capture([...])` to pull multiple high-fidelity telemetry streams concurrently in a single awaited call.
- **`ProprioceptionSensor`**: Capturing user spatial context, skeletal hand joints, and tracking visibility.
- **`TargetingSensor`**: Retrieving 3D raycast targeting results for hands and gaze, including collision distances and surface normal vectors.
- **`DepthSensor`**: Querying environmental distance grids with custom parameterizations (e.g., custom grid sizes).
- **`ScreenshotSOMSensor` & `SemanticMapSensor`**: Resolving complex, multi-sensor dependencies dynamically at runtime to synthesize annotated screenshots and unoccluded entity visibility lists.
- **Dependency Injection Integration**: Registering the manager in the registry (`xb.core.registry.register(sensors)`) and injecting it cleanly as a dependency on custom scripts.
