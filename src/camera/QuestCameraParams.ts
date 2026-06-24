import * as THREE from 'three';
import {intrinsicsToProjectionMatrix} from './CameraParameterUtils';

// Approximate intrinsics for the Meta Quest 3 front passthrough RGB camera
// as exposed via `getUserMedia` (camera-access is not available on Quest).
// Named QUEST_3_* because these were measured on a Quest 3 - other Quest
// variants (Quest 3S, Quest Pro, etc.) likely have different sensor and
// passthrough characteristics and should get their own constants.
// The stream comes back at 1280x720. Although the Quest 3 passthrough sensor
// has ~108° native HFOV, the cropped/processed video stream surfaced via
// getUserMedia behaves closer to ~77° HFOV (fx≈fy≈800), matching the
// Galaxy XR `moohan` reference. These are estimates; exact values are not
// exposed by WebXR and may need per-device calibration tweaks.
// prettier-ignore
export const QUEST_3_INTRINSICS_MATRIX = [
  800, 0, 640,
  0, 800, 360,
  0, 0, 1,
];

export const QUEST_3_PROJECTION_MATRIX = intrinsicsToProjectionMatrix(
  QUEST_3_INTRINSICS_MATRIX,
  1280,
  720,
  0.1,
  1000,
  new THREE.Matrix4()
);

// On Quest 3 the RGB passthrough cameras sit at the top-front of the visor,
// roughly centered between the eye displays, slightly above the eye plane,
// and a few cm forward. Offsets are relative to the right XR eye camera.
export const QUEST_3_CAMERA_POSE_IN_RIGHT_CAMERA_POSITION = new THREE.Vector3(
  -0.032,
  0.02,
  -0.025
);
// Quest 3 passthrough RGB cameras are physically tilted downward (Meta design
// favours seeing hands and the desk surface). Roughly ~15° pitch down.
export const QUEST_3_CAMERA_POSE_IN_RIGHT_CAMERA_ROTATION =
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.26, 0, 0, 'YXZ'));

const QUEST_3_CAMERA_POSE_IN_RIGHT_CAMERA_SCALE = new THREE.Vector3(1, 1, 1);

export const QUEST_3_CAMERA_POSE_IN_RIGHT_CAMERA = new THREE.Matrix4().compose(
  QUEST_3_CAMERA_POSE_IN_RIGHT_CAMERA_POSITION,
  QUEST_3_CAMERA_POSE_IN_RIGHT_CAMERA_ROTATION,
  QUEST_3_CAMERA_POSE_IN_RIGHT_CAMERA_SCALE
);

export function getQuestCameraPose(
  _camera: THREE.Camera,
  xrCameras: THREE.WebXRArrayCamera,
  target: THREE.Matrix4
) {
  target.copy(QUEST_3_CAMERA_POSE_IN_RIGHT_CAMERA);
  target.premultiply(xrCameras.cameras[1].matrixWorld);
}
