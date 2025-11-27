import {
  FilesetResolver,
  FaceLandmarker,
  HandLandmarker
} from '@mediapipe/tasks-vision';

// Indices for face landmarks
// Left Eye Iris Center: 468
// Right Eye Iris Center: 473
export const LEFT_IRIS_CENTER = 468;
export const RIGHT_IRIS_CENTER = 473;

// Indices for face boundary to check proximity
// 234: Left ear/cheek area
// 454: Right ear/cheek area
// 10: Top of forehead
// 152: Chin
const FACE_BOUNDS = [234, 454, 10, 152];

let faceLandmarker: FaceLandmarker | null = null;
let handLandmarker: HandLandmarker | null = null;

export const initializeVisionModels = async () => {
  // Use @latest for WASM to match the recent version in import map and avoid version mismatch errors
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
      delegate: "GPU"
    },
    outputFaceBlendshapes: false,
    runningMode: "VIDEO",
    numFaces: 1
  });

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 2
  });

  return { faceLandmarker, handLandmarker };
};

export const getVisionModels = () => ({ faceLandmarker, handLandmarker });

/**
 * Calculates Euclidean distance between two normalized points
 */
export const getDistance = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

/**
 * Determines if any hand point is close to any face boundary point
 */
export const checkHandProximity = (
  faceLandmarks: any[], // Using any to avoid complex MediaPipe types in simple helper
  handLandmarks: any[][]
): boolean => {
  if (!faceLandmarks || faceLandmarks.length === 0 || !handLandmarks || handLandmarks.length === 0) {
    return false;
  }

  // faceLandmarks from FaceLandmarkerResult is NormalizedLandmark[][] (array of faces)
  // We assume detection of 1 face, so we take the first array of landmarks
  const facePoints = faceLandmarks[0]; 
  
  if (!facePoints) return false;
  
  // Threshold for "closeness" in normalized coordinates (0-1)
  // 0.06 is very close (touching)
  const PROXIMITY_THRESHOLD = 0.06;

  // Target Zones: Temple/Side of Eyes
  // Left Side Indices: 234 (Cheekbone), 227, 127 (Temple)
  // Right Side Indices: 454 (Cheekbone), 447, 356 (Temple)
  const TEMPLE_ZONES = [234, 227, 127, 454, 447, 356];

  for (const hand of handLandmarks) {
    // Check specific hand landmarks: Index Tip(8), Middle Tip(12), Ring Tip(16)
    const keyHandPoints = [hand[8], hand[12], hand[16]];
    
    for (const handPoint of keyHandPoints) {
      for (const faceIndex of TEMPLE_ZONES) {
        const facePoint = facePoints[faceIndex];
        // Safety check if point exists
        if (facePoint && getDistance(handPoint, facePoint) < PROXIMITY_THRESHOLD) {
          return true;
        }
      }
    }
  }

  return false;
};