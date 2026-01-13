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

  // brow furrow
  leftInnerBrow: 107,
  rightInnerBrow: 336,

  // mouth width (for detecting smiling)
  leftMouthCorner: 61,
  rightMouthCorner: 291,

  // mouth vertical reference (upper lip center)
  upperLipCenter: 13,

  // under eye cheek area (for detecting cheek raise during smiles)
  leftCheek: 50,
  rightCheek: 280,

  // nose tip (stable vertical reference)
  noseTip: 1,
  noseBridge: 6,
} as const;
