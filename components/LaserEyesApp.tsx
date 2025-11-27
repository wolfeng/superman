import React, { useEffect, useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { DrawingUtils, FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
import { initializeVisionModels, getVisionModels, LEFT_IRIS_CENTER, RIGHT_IRIS_CENTER, checkHandProximity } from '../utils/vision';
import { ThreeOverlay } from './ThreeOverlay';
import { AppState, EyePosition } from '../types';
import { Camera, Hand, ScanFace, Eye, TriangleAlert, EyeOff } from 'lucide-react';

const VIDEO_CONSTRAINTS = {
  facingMode: "user",
  width: 1280,
  height: 720
};

export const LaserEyesApp: React.FC = () => {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [appState, setAppState] = useState<AppState>(AppState.LOADING_MODELS);
  const [eyes, setEyes] = useState<EyePosition | null>(null);
  const [isFiring, setIsFiring] = useState(false);
  const [showLandmarks, setShowLandmarks] = useState(false);
  
  const requestRef = useRef<number>(0);

  useEffect(() => {
    const loadModels = async () => {
      try {
        await initializeVisionModels();
        setAppState(AppState.WAITING_FOR_CAMERA);
      } catch (error) {
        console.error("Failed to load models:", error);
        setAppState(AppState.ERROR);
      }
    };
    loadModels();
  }, []);

  const processVideo = useCallback(async () => {
    if (
      typeof webcamRef.current !== "undefined" &&
      webcamRef.current !== null &&
      webcamRef.current.video?.readyState === 4
    ) {
      const video = webcamRef.current.video;
      const { faceLandmarker, handLandmarker } = getVisionModels();

      // --- LANDMARK DRAWING SETUP ---
      let drawingUtils: DrawingUtils | null = null;
      if (canvasRef.current) {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          
          // Match canvas size to video
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
          }
          
          if (ctx) {
              // Clear canvas every frame
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              
              if (showLandmarks) {
                drawingUtils = new DrawingUtils(ctx);
              }
          }
      }

      if (faceLandmarker && handLandmarker) {
        const startTimeMs = performance.now();
        
        // 1. DETECT FACE
        const faceResult = faceLandmarker.detectForVideo(video, startTimeMs);
        
        // Draw Face Landmarks
        if (showLandmarks && drawingUtils && faceResult.faceLandmarks) {
            for (const landmarks of faceResult.faceLandmarks) {
                drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_TESSELATION,
                    { color: '#C0C0C070', lineWidth: 1 }
                );
                drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
                    { color: '#FF3030' }
                );
                drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
                    { color: '#30FF30' }
                );
            }
        }

        let currentEyes: EyePosition | null = null;
        let faceLandmarksData = null;

        if (faceResult.faceLandmarks && faceResult.faceLandmarks.length > 0) {
          const landmarks = faceResult.faceLandmarks[0];
          faceLandmarksData = faceResult.faceLandmarks;
          
          // Normalize coordinates are 0-1.
          const leftIris = landmarks[LEFT_IRIS_CENTER];
          const rightIris = landmarks[RIGHT_IRIS_CENTER];

          if (leftIris && rightIris) {
             currentEyes = {
               left: { x: leftIris.x, y: leftIris.y },
               right: { x: rightIris.x, y: rightIris.y }
             };
          }
        }

        setEyes(currentEyes);

        // 2. DETECT HANDS
        const handResult = handLandmarker.detectForVideo(video, startTimeMs);
        
        // Draw Hand Landmarks
        if (showLandmarks && drawingUtils && handResult.landmarks) {
            for (const landmarks of handResult.landmarks) {
                drawingUtils.drawConnectors(
                    landmarks,
                    HandLandmarker.HAND_CONNECTIONS,
                    { color: '#00CC00', lineWidth: 3 }
                );
                drawingUtils.drawLandmarks(landmarks, {
                    color: '#FF0000',
                    lineWidth: 2
                });
            }
        }

        // 3. CHECK PROXIMITY LOGIC
        const handLandmarks = handResult.landmarks;
        
        // Need both face and hands to fire
        if (faceLandmarksData && handLandmarks && handLandmarks.length > 0) {
           const active = checkHandProximity(faceLandmarksData, handLandmarks);
           setIsFiring(active);
        } else {
           setIsFiring(false);
        }

        if (appState === AppState.WAITING_FOR_CAMERA) {
           setAppState(AppState.READY);
        }
      }
    }
    requestRef.current = requestAnimationFrame(processVideo);
  }, [appState, showLandmarks]);

  useEffect(() => {
    if (appState === AppState.WAITING_FOR_CAMERA || appState === AppState.READY) {
        requestRef.current = requestAnimationFrame(processVideo);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [processVideo, appState]);

  return (
    <div className="relative w-full h-full bg-neutral-900 flex items-center justify-center">
      {appState === AppState.ERROR && (
        <div className="text-red-500 font-bold p-8 bg-black/80 rounded-xl border border-red-900">
          <TriangleAlert className="w-12 h-12 mb-4 mx-auto" />
          <p className="text-xl">模型加载失败，请检查网络连接并刷新页面。</p>
        </div>
      )}

      {appState === AppState.LOADING_MODELS && (
        <div className="text-cyan-400 font-bold p-8 bg-black/80 rounded-xl border border-cyan-900 flex flex-col items-center animate-pulse">
           <ScanFace className="w-12 h-12 mb-4 animate-spin" />
           <p className="text-xl">正在初始化视觉系统...</p>
           <p className="text-sm opacity-70 mt-2">加载 MediaPipe 模型中</p>
        </div>
      )}

      {(appState === AppState.WAITING_FOR_CAMERA || appState === AppState.READY) && (
        <>
          {/* 1. WEBCAM LAYER */}
          <Webcam
            ref={webcamRef}
            audio={false}
            screenshotFormat="image/jpeg"
            videoConstraints={VIDEO_CONSTRAINTS}
            className="absolute w-full h-full object-cover scale-x-[-1]"
          />

          {/* 2. 2D CANVAS LAYER (Landmarks) */}
          <canvas 
            ref={canvasRef}
            className="absolute w-full h-full object-cover scale-x-[-1] pointer-events-none z-10"
          />

          {/* 3. 3D OVERLAY LAYER (Three.js) */}
          <ThreeOverlay eyes={eyes} isFiring={isFiring} />

          {/* 4. UI HUD OVERLAY */}
          <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between z-30">
            {/* Header */}
            <div className="flex justify-between items-start">
              <div className="bg-black/60 backdrop-blur-sm p-4 rounded-br-2xl border-l-4 border-cyan-500 shadow-[0_0_15px_rgba(0,255,255,0.2)]">
                <h1 className="text-3xl font-black tracking-tighter text-white flex items-center gap-3">
                  <Eye className="w-8 h-8 text-cyan-400" />
                  激光眼 <span className="text-cyan-400 text-sm font-normal self-end mb-1 tracking-widest">AR系统</span>
                </h1>
              </div>

              <div className="flex flex-col gap-2 items-end">
                 <div className={`px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase flex items-center gap-2 ${eyes ? 'bg-green-500/20 text-green-400 border border-green-500/50' : 'bg-red-500/20 text-red-400 border border-red-500/50'}`}>
                    <ScanFace className="w-3 h-3" />
                    {eyes ? '面部追踪: 锁定' : '面部追踪: 搜索中'}
                 </div>
                 <div className={`px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase flex items-center gap-2 ${isFiring ? 'bg-red-600 text-white animate-pulse' : 'bg-neutral-800/80 text-neutral-400 border border-white/10'}`}>
                    <Hand className="w-3 h-3" />
                    {isFiring ? '手势激活: 确认' : '手势激活: 等待'}
                 </div>
              </div>
            </div>
            
            {/* Footer */}
            <div className="flex justify-between items-end">
               {/* Instructions */}
               <div className="bg-black/70 backdrop-blur-md p-4 rounded-tr-2xl border-l-2 border-white/20 max-w-md">
                  <h3 className="text-cyan-400 font-bold mb-2 text-sm uppercase tracking-wider border-b border-white/10 pb-1">操作指南</h3>
                  <ul className="text-xs text-neutral-300 space-y-1.5 font-sans">
                    <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full"></span>
                        允许摄像头访问权限
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full"></span>
                        将您的面部置于画面中央
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
                        将手指放在眼睛两侧（太阳穴附近）以触发激光
                    </li>
                  </ul>
               </div>

               {/* Warning Label & Toggle Button */}
               <div className="flex flex-col items-end gap-4">
                   {isFiring && (
                     <div className="flex flex-col items-end">
                        <div className="text-4xl font-black text-red-600 tracking-tighter animate-pulse-fast drop-shadow-[0_0_10px_rgba(255,0,0,0.8)]">
                            激光已激活
                        </div>
                        <div className="text-xs text-red-400 tracking-[0.5em] uppercase font-bold">System Overload</div>
                     </div>
                   )}
                   
                   {/* Toggle Contour Button - Bottom Right */}
                   <button 
                     onClick={() => setShowLandmarks(!showLandmarks)}
                     className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-neutral-800/90 hover:bg-neutral-700 text-white rounded-lg border border-white/20 transition-all text-xs font-bold uppercase tracking-wider active:scale-95"
                   >
                      {showLandmarks ? <EyeOff className="w-4 h-4 text-red-400" /> : <Eye className="w-4 h-4 text-cyan-400" />}
                      {showLandmarks ? '隐藏轮廓' : '显示轮廓'}
                   </button>
               </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};