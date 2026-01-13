import { dist2D } from "./landmarks";
import type { Landmark } from "./landmarks";
import { FACE_LM } from "./indices";

// MediaPipe face landmark indices for eyes (FaceMesh-style indexing)
// All indices can be found here: https://storage.googleapis.com/mediapipe-assets/documentation/mediapipe_face_landmark_fullsize.png

// basically unitless ratios
export type Signals = {
  eyeOpenAvg: number; // average of left and right eye openness, higher when eyes are open
  browInnerDist: number; // smaller when furrowing, larger when relaxing
  mouthWidth: number; // larger when smiling, smaller when relaxing
  mouthCornerLift: number; // higher when smiling (corners lift relative to center)
  cheekRaise: number; // smaller when smiling (cheeks push up toward eyes)
  headRotation: number; // -1 to 1, 0 = forward
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

  const mouthWidth =
    dist2D(
      landmarks[FACE_LM.leftMouthCorner],
      landmarks[FACE_LM.rightMouthCorner],
    ) / faceWidth;

  // Mouth corner lift relative to upper lip
  const upperLipY = landmarks[FACE_LM.upperLipCenter].y;
  const leftCornerLift = upperLipY - landmarks[FACE_LM.leftMouthCorner].y;
  const rightCornerLift = upperLipY - landmarks[FACE_LM.rightMouthCorner].y;
  const mouthCornerLift = (leftCornerLift + rightCornerLift) / 2 / faceWidth;

  // Cheek raise (decreases when smiling)
  const leftCheekDist = dist2D(
    landmarks[FACE_LM.leftMouthCorner],
    landmarks[FACE_LM.leftCheek],
  );
  const rightCheekDist = dist2D(
    landmarks[FACE_LM.rightMouthCorner],
    landmarks[FACE_LM.rightCheek],
  );
  const cheekRaise = (leftCheekDist + rightCheekDist) / 2 / faceWidth;

  // Head rotation from face asymmetry (nose position relative to face edges)
  const noseBridge = landmarks[FACE_LM.noseBridge];
  const noseToLeft = Math.abs(noseBridge.x - landmarks[FACE_LM.leftFaceEdge].x);
  const noseToRight = Math.abs(
    landmarks[FACE_LM.rightFaceEdge].x - noseBridge.x,
  );
  const asymmetryRatio = noseToRight > 0 ? noseToLeft / noseToRight : 1;
  const headRotation = (asymmetryRatio - 1) / (asymmetryRatio + 1);

  return {
    eyeOpenAvg: (leftEyeOpen + rightEyeOpen) / 2,
    browInnerDist,
    mouthWidth,
    mouthCornerLift,
    cheekRaise,
    headRotation,
  };
}
