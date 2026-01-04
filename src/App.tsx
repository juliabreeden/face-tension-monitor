import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import "./App.css";
import { createFaceLandmarker } from "./face/createFaceLandmarker";
import { computeSignals, type Signals } from "./face/computeSignals";
// use these for debugging to highlight specific landmarks when adding new signals 
// import { FACE_LM } from "./face/indices";
// import { highlightPoints } from "./face/drawUtils";

const CALIBRATION_DURATION = 10000; // 10 seconds


function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const samplesRef = useRef<Signals[]>([]);
  const calibrationEndTimeRef = useRef<number | null>(null);
  const lastSampleTimeRef = useRef<number>(0);
  const isCalibrationRef = useRef<boolean>(false);


  const [status, setStatus] = useState("Initializing…");
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [calibrationSecondsLeft, setCalibrationSecondsLeft] = useState<number>(10);
  const [neutral, setNeutral] = useState<Signals | null>(null);

  // TODO: Use the calibrated neutral values to compute a live tension score and trigger alerts when above threshold

  const [eyeOpenAvg, setEyeOpenAvg] = useState<number | null>(null)
  const [browInnerDist, setBrowInnerDist] = useState<number | null>(null);


  const lastUiUpdateRef = useRef<number>(0);

  function startCalibration() {
    // reset everything for a fresh run
    samplesRef.current = [];
    lastSampleTimeRef.current = 0;
  
    setNeutral(null);
    setIsCalibrating(true);
    isCalibrationRef.current = true;
  
    calibrationEndTimeRef.current = performance.now() + CALIBRATION_DURATION;
  }
  

  useEffect(() => {
    const videoEl = videoRef.current;
    let cancelled = false;

    async function start() {
      try {
        setStatus("Requesting camera…");

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });

        if (cancelled) return;

        
        if (!videoEl) throw new Error("Video element not found");

        videoEl.srcObject = stream;

        // Wait until the video has enough data to play
        await new Promise<void>((resolve) => {
          const onLoaded = () => {
            videoEl.removeEventListener("loadeddata", onLoaded);
            resolve();
          };
          videoEl.addEventListener("loadeddata", onLoaded);
        });

        if (cancelled) return;

        // Make sure video is actually playing
        await videoEl.play();

        if (cancelled) return;

        setStatus("Loading Face Landmarker…");
        faceLandmarkerRef.current = await createFaceLandmarker();

        if (cancelled) return;

        setStatus("Tracking");

        const canvasEl = canvasRef.current;
        if (!canvasEl) throw new Error("Canvas element not found");

        const ctx = canvasEl.getContext("2d");
        if (!ctx) throw new Error("Could not get canvas 2D context");

        // Match canvas size to the actual video size
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;

        // Capture narrowed types for use in closures
        const canvas = canvasEl;
        const context = ctx;
        const video = videoEl;

        function drawLandmarks(landmarks: Array<{ x: number; y: number }>) {
          // Draw as small circles
          for (const pt of landmarks) {
            const x = pt.x * canvas.width;
            const y = pt.y * canvas.height;

            context.beginPath();
            context.arc(x, y, 1, 0, Math.PI * 2);
            context.fill();
          }
        }

        function loop() {
          if (cancelled) return;

          const landmarker = faceLandmarkerRef.current;
          if (!landmarker) {
            rafIdRef.current = requestAnimationFrame(loop);
            return;
          }

          // Clear previous frame
          context.clearRect(0, 0, canvas.width, canvas.height);

          // Optional: set draw style each frame
          context.fillStyle = "lime";

          const result = landmarker.detectForVideo(video, performance.now());


          const faceLandmarks = result.faceLandmarks?.[0];
          if (faceLandmarks) {
            drawLandmarks(faceLandmarks);
            const signals = computeSignals(faceLandmarks);
            const now = performance.now();

            // Calibration sampling
            if (isCalibrationRef.current && signals) {
              if (now - lastSampleTimeRef.current >= 100) {
                samplesRef.current.push(signals);
                lastSampleTimeRef.current = now;
                setCalibrationSecondsLeft(Math.max(0, Math.ceil((calibrationEndTimeRef.current! - now) / 1000)));
              }
            }

            // End calibration if time is up
            if (
              isCalibrationRef.current &&
              calibrationEndTimeRef.current !== null &&
              now >= calibrationEndTimeRef.current
            ) {
              // stop calibrating
              isCalibrationRef.current = false;
              setIsCalibrating(false);
              calibrationEndTimeRef.current = null;
            
              // compute neutral from samples
              const samples = samplesRef.current;
              if (samples.length > 0) {
                const eyeMean =
                  samples.reduce((sum, s) => sum + s.eyeOpenAvg, 0) / samples.length;
                const browMean =
                  samples.reduce((sum, s) => sum + s.browInnerDist, 0) / samples.length;
            
                setNeutral({ eyeOpenAvg: eyeMean, browInnerDist: browMean });
              }
            
              // clear samples
              samplesRef.current = [];
            }
            

            // UI throttling to avoid excessive re-renders
            if (signals && now - lastUiUpdateRef.current > 100) {
              setEyeOpenAvg(signals.eyeOpenAvg);
              setBrowInnerDist(signals.browInnerDist);
              lastUiUpdateRef.current = now;
            }
          }

          rafIdRef.current = requestAnimationFrame(loop);
        }

        rafIdRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.error(err);
        setStatus(
          err instanceof Error ? `Error: ${err.message}` : "Error starting"
        );
      }
    }

    start();

    return () => {
      cancelled = true;

      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);

      // Stop camera stream
      const stream = videoEl?.srcObject;
      if (stream instanceof MediaStream) {
        for (const track of stream.getTracks()) track.stop();
      }
    };
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h1>Face Tension Monitor</h1>
      <p>{status}</p>
      <p>
  Eye openness: {eyeOpenAvg ? eyeOpenAvg.toFixed(4) : "—"}
</p>
<p>
  Brow inner distance: {browInnerDist ? browInnerDist.toFixed(4) : "—"}
</p>
<button onClick={startCalibration} disabled={isCalibrating}>
  {isCalibrating
    ? `Calibrating… ${calibrationSecondsLeft ?? ""}`
    : "Calibrate (10s)"}
</button>




      <div style={{ position: "relative", width: 640 }}>
        <video
          ref={videoRef}
          width={640}
          height={480}
          playsInline
          muted
          style={{
            display: "block",
            transform: "scaleX(-1)", // mirror 
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            pointerEvents: "none",
            transform: "scaleX(-1)", // mirror the overlay too
          }}
        />
      </div>
    </div>
  );
}

export default App;
