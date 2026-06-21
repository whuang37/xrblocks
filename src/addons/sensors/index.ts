export * from './SensorsManager';
export * from './SensorsTypes';

// Export all refactored sensor class references and snapshots
export {
  ProprioceptionSensor,
  type ProprioceptionSnapshot,
} from './sensors/ProprioceptionSensor';
export {SceneGraphSensor} from './sensors/SceneGraphSensor';
export {
  TargetingSensor,
  type TargetingSnapshot,
} from './sensors/TargetingSensor';
export {DepthSensor} from './sensors/DepthSensor';
export {
  VisibilitySensor,
  type VisibilityItem,
} from './sensors/VisibilitySensor';
export {
  ScreenshotCameraSensor,
  ScreenshotXRSensor,
  ScreenshotSOMSensor,
} from './sensors/ScreenshotSensor';
export {SemanticMapSensor} from './sensors/SemanticMapSensor';
