# Low-level Three.js fallback

The legacy `SpatialPanel` grid is not part of the current public API. If an app
cannot load the UIKit peer packages required by the core flex UI, build the
surface from ordinary Three.js meshes and text that already exist in the app.

Keep the fallback small. Make each control an `xb.Script`, give its visible hit
surface `pointerEvents = 'auto'`, and implement the targeted select or hover
hooks. Use `object.xb.manipulation` for movable roots. Record the missing peer
dependency as the reason for using this lower-level path.
