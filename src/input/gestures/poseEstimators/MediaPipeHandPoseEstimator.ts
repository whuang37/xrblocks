import {Handedness} from '../../Hands';
import {HandContext, PoseEstimator} from '../GestureTypes';

export class MediaPipeHandPoseEstimator implements PoseEstimator {
  async init() {}

  getHandContext(_handedness: Handedness): HandContext | null {
    // TODO: map MediaPipe landmarks into canonical XR Blocks JointName positions.
    return null;
  }

  getHandContexts(): Partial<Record<'left' | 'right', HandContext>> {
    // TODO: return canonical contexts once MediaPipe landmark mapping is wired.
    return {};
  }
}
