/** Only the WASM functions used by the tangible worker. */
export interface CvMat {
  rows: number;
  cols: number;
  data: Uint8Array;
  data32F: Float32Array;
  data64F: Float64Array;
  data32S: Int32Array;
  clone(): CvMat;
  delete(): void;
}

export interface OpenCv {
  Mat: {new (): CvMat; zeros(rows: number, cols: number, type: number): CvMat};
  Size: new (width: number, height: number) => unknown;
  CV_8UC1: number;
  CV_32FC2: number;
  COLOR_RGBA2GRAY: number;
  CV_64FC1: number;
  CV_64FC2: number;
  CV_64FC3: number;
  SOLVEPNP_ITERATIVE: number;
  solvePnPRansac(
    objectPoints: CvMat,
    imagePoints: CvMat,
    cameraMatrix: CvMat,
    distortion: CvMat,
    rvec: CvMat,
    tvec: CvMat,
    useGuess: boolean,
    iterations: number,
    error: number,
    confidence: number,
    inliers: CvMat,
    flags: number
  ): boolean;
  Rodrigues(source: CvMat, destination: CvMat): void;
  matFromImageData(image: ImageData): CvMat;
  matFromArray(
    rows: number,
    cols: number,
    type: number,
    values: number[]
  ): CvMat;
  cvtColor(source: CvMat, target: CvMat, code: number): void;
  goodFeaturesToTrack(
    image: CvMat,
    points: CvMat,
    count: number,
    quality: number,
    distance: number,
    mask: CvMat
  ): void;
  calcOpticalFlowPyrLK(
    previous: CvMat,
    next: CvMat,
    points: CvMat,
    nextPoints: CvMat,
    status: CvMat,
    errors: CvMat,
    size: unknown,
    levels: number
  ): void;
}
