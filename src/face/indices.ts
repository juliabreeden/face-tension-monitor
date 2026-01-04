// MediaPipe face landmark indices for eyes (FaceMesh-style indexing)
// All indices can be found here: https://storage.googleapis.com/mediapipe-assets/documentation/mediapipe_face_landmark_fullsize.png

export const FACE_LM = {
  // normalization anchors
  leftFaceEdge: 234,
  rightFaceEdge: 454,

  // eye openness
  leftEyeTop: 159,
  leftEyeBottom: 145,
  rightEyeTop: 386,
  rightEyeBottom: 374,

  // brow furrow (candidates for inner brow corners)
  leftInnerBrow: 107,
  rightInnerBrow: 336,
} as const;
