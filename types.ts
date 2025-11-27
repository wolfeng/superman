export interface Point2D {
  x: number;
  y: number;
}

export interface EyePosition {
  left: Point2D;
  right: Point2D;
}

export enum AppState {
  LOADING_MODELS = 'LOADING_MODELS',
  WAITING_FOR_CAMERA = 'WAITING_FOR_CAMERA',
  READY = 'READY',
  ERROR = 'ERROR'
}

export interface DetectionResult {
  eyes: EyePosition | null;
  isHandNearFace: boolean;
}