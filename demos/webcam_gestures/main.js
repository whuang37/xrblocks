import 'xrblocks/addons/simulator/SimulatorAddons.js';

import * as THREE from 'three';
import * as xb from 'xrblocks';
import {
  DrawingUtils,
  FilesetResolver,
  GestureRecognizer as MediaPipeGestureRecognizer,
} from '@mediapipe/tasks-vision';

const MEDIAPIPE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task';
const MEDIAPIPE_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm';

const WEBCAM_HAND = xb.Handedness.RIGHT;
const WEBCAM_HAND_LABEL = 'right';

const GESTURE_CONFIGURATIONS = {
  pinch: {enabled: true},
  fist: {enabled: true},
  'thumbs-up': {enabled: true},
  'thumbs-down': {enabled: true},
  point: {enabled: true},
  victory: {enabled: true},
  rock: {enabled: true},
  'open-palm': {enabled: true},
};

const NATIVE_GESTURE_NAMES = {
  Closed_Fist: 'fist',
  Open_Palm: 'open-palm',
  Pointing_Up: 'point',
  Thumb_Down: 'thumbs-down',
  Thumb_Up: 'thumbs-up',
  Victory: 'victory',
};

const GESTURE_TO_SIMULATOR_POSE = {
  pinch: xb.SimulatorHandPose.PINCHING,
  fist: xb.SimulatorHandPose.FIST,
  'thumbs-up': xb.SimulatorHandPose.THUMBS_UP,
  'thumbs-down': xb.SimulatorHandPose.THUMBS_DOWN,
  point: xb.SimulatorHandPose.POINTING,
  victory: xb.SimulatorHandPose.VICTORY,
  rock: xb.SimulatorHandPose.ROCK,
  'open-palm': xb.SimulatorHandPose.RELAXED,
};

const MEDIAPIPE_JOINT_INDEX = {
  wrist: 0,
  'thumb-metacarpal': 1,
  'thumb-phalanx-proximal': 2,
  'thumb-phalanx-distal': 3,
  'thumb-tip': 4,
  'index-finger-phalanx-proximal': 5,
  'index-finger-phalanx-intermediate': 6,
  'index-finger-phalanx-distal': 7,
  'index-finger-tip': 8,
  'middle-finger-phalanx-proximal': 9,
  'middle-finger-phalanx-intermediate': 10,
  'middle-finger-phalanx-distal': 11,
  'middle-finger-tip': 12,
  'ring-finger-phalanx-proximal': 13,
  'ring-finger-phalanx-intermediate': 14,
  'ring-finger-phalanx-distal': 15,
  'ring-finger-tip': 16,
  'pinky-finger-phalanx-proximal': 17,
  'pinky-finger-phalanx-intermediate': 18,
  'pinky-finger-phalanx-distal': 19,
  'pinky-finger-tip': 20,
};

const ESTIMATED_METACARPALS = {
  'index-finger-metacarpal': 5,
  'middle-finger-metacarpal': 9,
  'ring-finger-metacarpal': 13,
  'pinky-finger-metacarpal': 17,
};

class WebcamHandContext {
  constructor(joints) {
    this.handedness = WEBCAM_HAND;
    this.handLabel = WEBCAM_HAND_LABEL;
    this.globalTransform = new THREE.Matrix4();
    this.joints = joints;
    this.localJoints = joints;
    this.globalJoints = joints;
  }

  getLocalJointPositions() {
    return jointMapToArray(this.localJoints);
  }

  getGlobalJointPositions() {
    return jointMapToArray(this.globalJoints);
  }

  getJoint(jointName) {
    return this.joints.get(jointName);
  }
}

class WebcamMediaPipeSource {
  constructor() {
    this.videoElement = document.getElementById('webcam-video');
    this.canvasElement = document.getElementById('output-canvas');
    this.canvasCtx = this.canvasElement.getContext('2d');
    this.gestureLabel = document.getElementById('gesture-label');
    this.mediaPipeRecognizer = null;
    this.latestResults = null;
    this.lastVideoTime = -1;
    this.initPromise = null;
  }

  init() {
    this.initPromise ??= this.loadAndStart();
    return this.initPromise;
  }

  async loadAndStart() {
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
    this.mediaPipeRecognizer =
      await MediaPipeGestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MEDIAPIPE_MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
      });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({video: true});
      this.videoElement.srcObject = stream;
      await new Promise((resolve) => {
        this.videoElement.addEventListener('loadeddata', resolve, {once: true});
      });
      this.gestureLabel.innerText = 'Show Hand';
      this.predictWebcam();
    } catch (error) {
      console.error(error);
      this.gestureLabel.innerText = 'Camera Error';
    }
  }

  predictWebcam() {
    requestAnimationFrame(() => this.predictWebcam());
    if (!this.mediaPipeRecognizer) return;
    if (this.videoElement.currentTime === this.lastVideoTime) return;

    this.lastVideoTime = this.videoElement.currentTime;
    this.latestResults = this.mediaPipeRecognizer.recognizeForVideo(
      this.videoElement,
      performance.now()
    );
    this.drawResults();
  }

  getLandmarks() {
    return this.latestResults?.landmarks?.[0] ?? null;
  }

  getNativeGestureName() {
    const categoryName = this.latestResults?.gestures?.[0]?.[0]?.categoryName;
    return categoryName ? NATIVE_GESTURE_NAMES[categoryName] : undefined;
  }

  drawResults() {
    this.canvasElement.width = this.videoElement.videoWidth;
    this.canvasElement.height = this.videoElement.videoHeight;
    this.canvasCtx.clearRect(
      0,
      0,
      this.canvasElement.width,
      this.canvasElement.height
    );

    const landmarks = this.getLandmarks();
    if (!landmarks) {
      this.gestureLabel.innerText = 'No Hand';
      this.gestureLabel.style.color = '#fff';
      return;
    }

    const drawingUtils = new DrawingUtils(this.canvasCtx);
    drawingUtils.drawConnectors(
      landmarks,
      MediaPipeGestureRecognizer.HAND_CONNECTIONS,
      {
        color: '#00FF00',
        lineWidth: 3,
      }
    );
    drawingUtils.drawLandmarks(landmarks, {
      color: '#FF0000',
      lineWidth: 1,
      radius: 3,
    });
  }
}

class WebcamMediaPipePoseEstimator {
  constructor(source) {
    this.source = source;
  }

  init() {
    return this.source.init();
  }

  getHandContext(handedness) {
    if (handedness !== WEBCAM_HAND) return null;
    const landmarks = this.source.getLandmarks();
    if (!landmarks) return null;
    return new WebcamHandContext(createJointMapFromLandmarks(landmarks));
  }

  getHandContexts() {
    return {
      right: this.getHandContext(WEBCAM_HAND) ?? undefined,
    };
  }
}

class WebcamGestureRecognizer {
  constructor(source) {
    this.source = source;
  }

  init() {
    return this.source.init();
  }

  getGestureConfigurations() {
    return GESTURE_CONFIGURATIONS;
  }

  recognize(context) {
    const scores = createEmptyScores();
    this.applyHandContextScores(context, scores);
    this.applyNativeGestureScore(scores);
    return scores;
  }

  applyHandContextScores(context, scores) {
    const indexStraight = xb.getFingerStraightness(context, 'index');
    const middleStraight = xb.getFingerStraightness(context, 'middle');
    const ringStraight = xb.getFingerStraightness(context, 'ring');
    const pinkyStraight = xb.getFingerStraightness(context, 'pinky');
    const indexCurl = xb.getFingerCurl(context, 'index');
    const middleCurl = xb.getFingerCurl(context, 'middle');
    const ringCurl = xb.getFingerCurl(context, 'ring');
    const pinkyCurl = xb.getFingerCurl(context, 'pinky');
    const closedFingers = xb.average([
      indexCurl,
      middleCurl,
      ringCurl,
      pinkyCurl,
    ]);
    const openFingers = xb.average([
      indexStraight,
      middleStraight,
      ringStraight,
      pinkyStraight,
    ]);

    const thumbVertical = xb.getThumbVerticalDirection(context);
    const thumbIndexDistance = xb.getFingertipDistance(
      context,
      'thumb',
      'index'
    );
    const scale = xb.getPalmWidth(context) ?? xb.estimateHandScale(context);
    const pinch =
      thumbIndexDistance !== null && scale > 0
        ? xb.clamp01(1 - thumbIndexDistance / (scale * 0.55))
        : 0;

    scores.pinch.confidence = Math.max(scores.pinch.confidence, pinch);
    scores.fist.confidence = Math.max(scores.fist.confidence, closedFingers);
    scores['thumbs-up'].confidence = Math.max(
      scores['thumbs-up'].confidence,
      closedFingers * xb.clamp01((thumbVertical - 0.25) / 0.5)
    );
    scores['thumbs-down'].confidence = Math.max(
      scores['thumbs-down'].confidence,
      closedFingers * xb.clamp01((-thumbVertical - 0.25) / 0.5)
    );
    scores.point.confidence = Math.max(
      scores.point.confidence,
      indexStraight * xb.average([middleCurl, ringCurl, pinkyCurl])
    );
    scores.victory.confidence = Math.max(
      scores.victory.confidence,
      xb.average([indexStraight, middleStraight, ringCurl, pinkyCurl])
    );
    scores.rock.confidence = Math.max(
      scores.rock.confidence,
      xb.average([indexStraight, middleCurl, ringCurl, pinkyStraight])
    );
    scores['open-palm'].confidence = Math.max(
      scores['open-palm'].confidence,
      openFingers
    );
  }

  applyNativeGestureScore(scores) {
    const gestureName = this.source.getNativeGestureName();
    if (gestureName && scores[gestureName]) {
      scores[gestureName].confidence = Math.max(
        scores[gestureName].confidence,
        0.9
      );
    }
  }
}

class GestureToSimulatorBridge extends xb.Script {
  constructor(source) {
    super();
    this.source = source;
    this.activeGestures = new Map();
  }

  init() {
    const gestureRecognition = xb.core.gestureRecognition;
    if (!gestureRecognition) return;

    this.onGestureStart = (event) => {
      const {name, confidence = 0} = event.detail;
      this.activeGestures.set(name, confidence);
      this.applyBestGesture();
    };
    this.onGestureUpdate = this.onGestureStart;
    this.onGestureEnd = (event) => {
      this.activeGestures.delete(event.detail.name);
      this.applyBestGesture();
    };

    gestureRecognition.addEventListener('gesturestart', this.onGestureStart);
    gestureRecognition.addEventListener('gestureupdate', this.onGestureUpdate);
    gestureRecognition.addEventListener('gestureend', this.onGestureEnd);
  }

  applyBestGesture() {
    const [name] = getBestGesture(this.activeGestures);
    const simulatorPose = GESTURE_TO_SIMULATOR_POSE[name];
    if (simulatorPose && xb.core.simulator?.hands) {
      xb.core.simulator.hands.setRightHandLerpPose(simulatorPose);
    }

    const label = name ?? 'none';
    this.source.gestureLabel.innerText = label.replace(/-/g, ' ');
    this.source.gestureLabel.style.color = name ? '#0f0' : '#ccc';
  }

  dispose() {
    const gestureRecognition = xb.core.gestureRecognition;
    if (!gestureRecognition) return;
    gestureRecognition.removeEventListener('gesturestart', this.onGestureStart);
    gestureRecognition.removeEventListener(
      'gestureupdate',
      this.onGestureUpdate
    );
    gestureRecognition.removeEventListener('gestureend', this.onGestureEnd);
  }
}

function createJointMapFromLandmarks(landmarks) {
  const joints = new Map();
  for (const [jointName, index] of Object.entries(MEDIAPIPE_JOINT_INDEX)) {
    joints.set(jointName, landmarkToVector(landmarks[index]));
  }
  for (const [jointName, index] of Object.entries(ESTIMATED_METACARPALS)) {
    const wrist = landmarkToVector(landmarks[0]);
    const knuckle = landmarkToVector(landmarks[index]);
    joints.set(jointName, wrist.lerp(knuckle, 0.65));
  }
  return joints;
}

function landmarkToVector(landmark) {
  return new THREE.Vector3(
    0.5 - landmark.x,
    0.5 - landmark.y,
    -(landmark.z ?? 0)
  );
}

function jointMapToArray(joints) {
  const positions = new Float32Array(xb.HAND_JOINT_NAMES.length * 3);
  xb.HAND_JOINT_NAMES.forEach((jointName, index) => {
    const joint = joints.get(jointName);
    if (!joint) return;
    const offset = index * 3;
    positions[offset] = joint.x;
    positions[offset + 1] = joint.y;
    positions[offset + 2] = joint.z;
  });
  return positions;
}

function createEmptyScores() {
  const scores = {};
  for (const name of Object.keys(GESTURE_CONFIGURATIONS)) {
    scores[name] = {confidence: 0};
  }
  return scores;
}

function getBestGesture(activeGestures) {
  let bestName = null;
  let bestConfidence = 0;
  for (const [name, confidence] of activeGestures.entries()) {
    if (confidence > bestConfidence) {
      bestName = name;
      bestConfidence = confidence;
    }
  }
  return [bestName, bestConfidence];
}

const webcamSource = new WebcamMediaPipeSource();
const options = new xb.Options();
options.enableUI();
options.enableGestures();
options.gestures.setPoseEstimator(
  new WebcamMediaPipePoseEstimator(webcamSource)
);
options.gestures.setGestureRecognizer(
  new WebcamGestureRecognizer(webcamSource)
);
options.simulator.defaultMode = xb.SimulatorMode.POSE;
options.simulator.stereo.enabled = true;
options.xrButton.alwaysAutostartSimulator = true;

document.addEventListener('DOMContentLoaded', () => {
  xb.add(new GestureToSimulatorBridge(webcamSource));
  xb.init(options);
});
