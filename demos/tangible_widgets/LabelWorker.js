// Optional demo metadata only. Runs once after successful surface registration.
self.onmessage = async ({data}) => {
  let detector;
  try {
    const {FilesetResolver, ObjectDetector} = await import(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/vision_bundle.mjs'
    );
    const files = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
    );
    detector = await ObjectDetector.createFromOptions(files, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite',
        delegate: 'CPU',
      },
      runningMode: 'IMAGE',
      scoreThreshold: 0.2,
    });
    const image = new ImageData(
      new Uint8ClampedArray(data.pixels),
      data.width,
      data.height
    );
    // Label the registered centre, not an unrelated object elsewhere in view.
    const matches = detector
      .detect(image)
      .detections.filter(
        ({boundingBox: box}) =>
          box &&
          box.originX <= data.width / 2 &&
          box.originY <= data.height / 2 &&
          box.originX + box.width >= data.width / 2 &&
          box.originY + box.height >= data.height / 2
      )
      .sort((a, b) => b.categories[0].score - a.categories[0].score);
    const category = matches[0]?.categories[0];
    self.postMessage({
      label: category
        ? `${category.categoryName || category.displayName} ${Math.round(category.score * 100)}%`
        : 'unknown',
    });
  } catch {
    self.postMessage({label: 'unavailable; tracking continues'});
  } finally {
    detector?.close();
    self.close();
  }
};
