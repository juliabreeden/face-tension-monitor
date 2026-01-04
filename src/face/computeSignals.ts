import { dist2D } from "./landmarks";
import type { Landmark } from "./landmarks";
import { FACE_LM } from "./indices";

// MediaPipe face landmark indices for eyes (FaceMesh-style indexing)
// All indices can be found here: https://storage.googleapis.com/mediapipe-assets/documentation/mediapipe_face_landmark_fullsize.png

// basically unitless ratios
export type Signals = {
  eyeOpenAvg: number; // average of left and right eye openness, higher when eyes are open
  browInnerDist: number; // smaller when furrowing, larger when relaxing
};

export function computeSignals(landmarks: Landmark[]): Signals | null {
  if (!landmarks?.length) return null;

  const faceWidth = dist2D(
    landmarks[FACE_LM.leftFaceEdge],
    landmarks[FACE_LM.rightFaceEdge],
  );
  if (faceWidth === 0) return null;

  const leftEyeOpen =
    dist2D(landmarks[FACE_LM.leftEyeTop], landmarks[FACE_LM.leftEyeBottom]) /
    faceWidth;
  const rightEyeOpen =
    dist2D(landmarks[FACE_LM.rightEyeTop], landmarks[FACE_LM.rightEyeBottom]) /
    faceWidth;

  const browInnerDist =
    dist2D(
      landmarks[FACE_LM.leftInnerBrow],
      landmarks[FACE_LM.rightInnerBrow],
    ) / faceWidth;

  return {
    eyeOpenAvg: (leftEyeOpen + rightEyeOpen) / 2,
    browInnerDist,
  };
}
