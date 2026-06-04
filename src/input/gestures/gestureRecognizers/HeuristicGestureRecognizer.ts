import {GestureConfiguration} from '../GestureRecognitionOptions';
import {
  GestureRecognizer,
  GestureScoreMap,
  HandContext,
} from '../GestureTypes';
import {heuristicDetectors} from '../providers/HeuristicGestureDetectors';

export class HeuristicGestureRecognizer implements GestureRecognizer {
  getGestureConfigurations(): Record<string, GestureConfiguration> {
    return {
      pinch: {enabled: true, threshold: 0.025},
      'open-palm': {enabled: true},
      fist: {enabled: true},
      'thumbs-up': {enabled: true},
      point: {enabled: false},
      spread: {enabled: false, threshold: 0.04},
    };
  }

  recognize(context: HandContext): GestureScoreMap {
    const scores: GestureScoreMap = {};
    const configs = this.getGestureConfigurations();
    for (const [name, detector] of Object.entries(heuristicDetectors)) {
      scores[name] = detector(context, configs[name]);
    }
    return scores;
  }
}
