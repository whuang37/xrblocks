# Sensors Spatial Debugger Sample

This sample demonstrates the XR Blocks **Sensors Addon** integrated with the **UI Blocks Addon** (`uiblocks`). It replaces standard DOM sidebar panels with a high-fidelity spatial 3D card that floats in the environment. The card features an interactive collapsible dropdown selector, allowing you to select and query any individual sensor dynamically while keeping performance fast.

![Sensors Debugger](https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/sensors/default/48px.svg)

## Features

- **Spatial UI Blocks Panel**: A beautiful, grabbable, and cylindrical-billboarded 3D card layout that floats in front of the user at eye level.
- **Collapsible Dropdown Selector**: A custom-designed spatial dropdown menu that lists all 8 available sensors. Clicking the dropdown expands the options list; selecting an option updates the active sensor and collapses the menu.
- **Performant Single-Sensor Queries**: Rather than capturing all 8 sensors constantly, the app runs a throttled capture loop (at 300ms) that queries _only_ the selected sensor.
- **Depth Heatmap Rendering in XR**: Renders environmental depth-sensing distance grids (0m to 4m) as a blue-to-red color ramp on an offscreen canvas, which is uploaded as a `THREE.CanvasTexture` and displayed dynamically inside a spatial `UIImage` component.
- **Image & Telemetry Display**:
  - **Text-based sensors** (`Proprioception`, `Scene Graph`, `Targeting`, `Visibility`): Renders formatted, multi-line diagnostic text inside a `UIText` component.
  - **View sensors** (`Device Camera View`, `User View`, `SOM View`): Renders the captured base64 image streams inside a `UIImage` component.

## How to Use

1. Serve the repository locally by running:
   ```bash
   npm run dev
   ```
2. Open your browser and navigate to the sample page:
   `http://127.0.0.1:8080/samples/sensors_debug/?formFactor=desktop` (this will automatically launch the desktop simulator).
3. Click the **Enter AR** or **Enter VR** button to enter the spatial experience.
4. You will see a 3D prototyping room containing three draggable, colorful shapes (a green Torus, an orange Box, and a blue Sphere) along with the **Sensors Debugger** panel floating in front of you.
5. **Move & Grab the Panel**: Aim your simulated controller/hand ray at the margins of the panel. Pinch/click and drag to move it anywhere in your room. The panel will rotate cylindrically to face you as you move around.
6. **Toggle Sensors**: Click on the dropdown menu at the top of the panel (displaying "Proprioception" by default). The options menu will expand. Click on any sensor to load its telemetry:
   - Select **Visibility** or **Targeting** and interact with the shapes or look around to see the live intersections and visible object indices update.
   - Select **Depth Heatmap** to see the live distance ramp.
   - Select one of the **View** sensors to inspect viewport frame captures in real-time.

## Technical Highlights

The sample showcases:

- **`uiblocks` Layout & Styling**: Building structured layouts (`UIPanel`, `UIText`, `UIImage`, `UIIcon`) using flexbox properties and styling tokens (like custom corner rounding, borders, drop shadows, and linear gradients).
- **Dynamic Interaction Callbacks**: Implementing custom hovering states and click events (`onHoverEnter`, `onHoverExit`, `onClick`) directly in the spatial UI.
- **Dynamic Layout Toggling**: Using the `display` property (`'flex'` / `'none'`) to hide and show components dynamically (e.g. expanding the dropdown, switching between text and image views).
- **Offscreen Canvas Textures in XR**: Bridging HTML5 2D canvas drawing with 3D WebGL scenes by rendering dynamic heatmaps to an offscreen canvas, wrapping it in a `THREE.CanvasTexture`, and passing it to a spatial `UIImage`.
- **Targeted Subsystem Resolution**: Utilizing `sensors.capture(SensorClass)` to capture specific telemetry streams on-demand, reducing rendering overhead.
