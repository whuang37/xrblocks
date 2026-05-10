import * as THREE from 'three';
import {intrinsicsToProjectionMatrix} from './CameraParameterUtils';

// Approximate intrinsics for the Meta Quest 3 front passthrough RGB camera
// as exposed via `getUserMedia` (camera-access is not available on Quest).
// The stream comes back at 1280x720. Although the Quest passthrough sensor
// has ~108° native HFOV, the cropped/processed video stream surfaced via
// getUserMedia behaves closer to ~77° HFOV (fx≈fy≈800), matching the
// Galaxy XR `moohan` reference. These are estimates; exact values are not
// exposed by WebXR and may need per-device calibration tweaks.
// prettier-ignore
export const QUEST_INTRINSICS_MATRIX = [
  800, 0, 640,
  0, 800, 360,
  0, 0, 1,
];

export const QUEST_PROJECTION_MATRIX = intrinsicsToProjectionMatrix(
  QUEST_INTRINSICS_MATRIX,
  1280,
  720,
  0.1,
  1000,
  new THREE.Matrix4()
);

// On Quest 3 the RGB passthrough cameras sit at the top-front of the visor,
// roughly centered between the eye displays, slightly above the eye plane,
// and a few cm forward. Offsets are relative to the right XR eye camera.
export const QUEST_CAMERA_POSE_IN_RIGHT_CAMERA_POSITION = new THREE.Vector3(
  -0.032,
  0.02,
  -0.025
);
export const QUEST_CAMERA_POSE_IN_RIGHT_CAMERA_ROTATION =
  new THREE.Quaternion();

const QUEST_CAMERA_POSE_IN_RIGHT_CAMERA_SCALE = new THREE.Vector3(1, 1, 1);

export const QUEST_CAMERA_POSE_IN_RIGHT_CAMERA = new THREE.Matrix4().compose(
  QUEST_CAMERA_POSE_IN_RIGHT_CAMERA_POSITION,
  QUEST_CAMERA_POSE_IN_RIGHT_CAMERA_ROTATION,
  QUEST_CAMERA_POSE_IN_RIGHT_CAMERA_SCALE
);

export function getQuestCameraPose(
  _camera: THREE.Camera,
  xrCameras: THREE.WebXRArrayCamera,
  target: THREE.Matrix4
) {
  target.compose(
    QUEST_CAMERA_POSE_IN_RIGHT_CAMERA_POSITION,
    QUEST_CAMERA_POSE_IN_RIGHT_CAMERA_ROTATION,
    QUEST_CAMERA_POSE_IN_RIGHT_CAMERA_SCALE
  );
  target.premultiply(xrCameras.cameras[1].matrixWorld);
}
