import { useEffect, useRef, useState } from "react";
import { useCamera } from "./hooks/useCamera";
import { useFaceLandmarker } from "./hooks/useFaceLandmarker";
import { computeSignals, type Signals } from "./face/computeSignals";
import { playRelaxChime } from "./utils/audio";

// Configuration constants
const CALIBRATION_DURATION_MS = 10_000;
const TENSION_ALERT_THRESHOLD_MS = 3_000;
const TENSION_THRESHOLD = 0.9; // 90% of neutral = tense
const SAMPLE_INTERVAL_MS = 100;
const UI_UPDATE_INTERVAL_MS = 100;

function App() {
  // Custom hooks for camera and face detection
  const { videoRef, status: cameraStatus, error: cameraError } = useCamera();
  const {
    landmarkerRef,
    status: landmarkerStatus,
    error: landmarkerError,
  } = useFaceLandmarker();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Calibration state (both state for UI and ref for animation loop)
  const [isCalibrating, setIsCalibrating] = useState(false);
  const isCalibrationRef = useRef(false);
  const calibrationEndTimeRef = useRef<number | null>(null);
  const samplesRef = useRef<Signals[]>([]);
  const lastSampleTimeRef = useRef(0);
  const [calibrationSecondsLeft, setCalibrationSecondsLeft] = useState(10);

  // Neutral baseline from calibration
  const neutralRef = useRef<Signals | null>(null);
  const hasCalibratedRef = useRef(false);

  // Tension tracking
  const tensionStartTimeRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Live signals for UI display
  const [eyeOpenAvg, setEyeOpenAvg] = useState<number | null>(null);
  const [browInnerDist, setBrowInnerDist] = useState<number | null>(null);
  const lastUiUpdateRef = useRef(0);

  // Picture-in-Picture state
  const [isPip, setIsPip] = useState(false);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Track PiP state changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnterPip = () => setIsPip(true);
    const onLeavePip = () => setIsPip(false);

    video.addEventListener("enterpictureinpicture", onEnterPip);
    video.addEventListener("leavepictureinpicture", onLeavePip);

    return () => {
      video.removeEventListener("enterpictureinpicture", onEnterPip);
      video.removeEventListener("leavepictureinpicture", onLeavePip);
    };
  }, [videoRef]);

  // Main detection loop
  useEffect(() => {
    if (cameraStatus !== "ready") return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Match canvas size to video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Capture narrowed types for use in closures
    const canvasEl = canvas;
    const context = ctx;
    const videoEl = video;

    let cancelled = false;

    function drawLandmarks(
      landmarks: Array<{ x: number; y: number }>,
      width: number,
      height: number,
    ) {
      context.fillStyle = "lime";
      for (const pt of landmarks) {
        const x = pt.x * width;
        const y = pt.y * height;
        context.beginPath();
        context.arc(x, y, 1, 0, Math.PI * 2);
        context.fill();
      }
    }

    function handleCalibrationSample(signals: Signals, now: number) {
      if (now - lastSampleTimeRef.current >= SAMPLE_INTERVAL_MS) {
        samplesRef.current.push(signals);
        lastSampleTimeRef.current = now;
        setCalibrationSecondsLeft(
          Math.max(0, Math.ceil((calibrationEndTimeRef.current! - now) / 1000)),
        );
      }
    }

    function finalizeCalibration() {
      isCalibrationRef.current = false;
      setIsCalibrating(false);
      calibrationEndTimeRef.current = null;

      const samples = samplesRef.current;
      if (samples.length > 0) {
        const eyeMean =
          samples.reduce((sum, s) => sum + s.eyeOpenAvg, 0) / samples.length;
        const browMean =
          samples.reduce((sum, s) => sum + s.browInnerDist, 0) / samples.length;

        neutralRef.current = { eyeOpenAvg: eyeMean, browInnerDist: browMean };
        hasCalibratedRef.current = true;
      }

      samplesRef.current = [];
    }

    function checkTension(signals: Signals, now: number) {
      const neutral = neutralRef.current;
      if (!neutral) return;

      const isTense =
        signals.eyeOpenAvg < neutral.eyeOpenAvg * TENSION_THRESHOLD ||
        signals.browInnerDist < neutral.browInnerDist * TENSION_THRESHOLD;

      if (isTense) {
        if (tensionStartTimeRef.current === null) {
          tensionStartTimeRef.current = now;
        } else if (
          now - tensionStartTimeRef.current >=
          TENSION_ALERT_THRESHOLD_MS
        ) {
          triggerTensionAlert();
          tensionStartTimeRef.current = null;
        }
      } else {
        tensionStartTimeRef.current = null;
      }
    }

    function triggerTensionAlert() {
      // Send notification
      if (Notification.permission === "granted") {
        new Notification("Face Tension Monitor", {
          body: "Tension detected! Relax your face :)",
          icon: "/favicon.ico",
          requireInteraction: true,
        });
      }

      // Play chime sound
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      playRelaxChime(audioCtxRef.current);
    }

    function loop() {
      if (cancelled) return;

      const landmarker = landmarkerRef.current;
      if (!landmarker) {
        rafIdRef.current = requestAnimationFrame(loop);
        return;
      }

      context.clearRect(0, 0, canvasEl.width, canvasEl.height);

      const result = landmarker.detectForVideo(videoEl, performance.now());
      const faceLandmarks = result.faceLandmarks?.[0];

      if (faceLandmarks) {
        drawLandmarks(faceLandmarks, canvasEl.width, canvasEl.height);

        const signals = computeSignals(faceLandmarks);
        const now = performance.now();

        if (signals) {
          // Handle calibration
          if (isCalibrationRef.current) {
            handleCalibrationSample(signals, now);

            if (
              calibrationEndTimeRef.current !== null &&
              now >= calibrationEndTimeRef.current
            ) {
              finalizeCalibration();
            }
          }

          // Update UI (throttled)
          if (now - lastUiUpdateRef.current > UI_UPDATE_INTERVAL_MS) {
            setEyeOpenAvg(signals.eyeOpenAvg);
            setBrowInnerDist(signals.browInnerDist);
            lastUiUpdateRef.current = now;
          }

          // Check for tension after calibration
          if (hasCalibratedRef.current) {
            checkTension(signals, now);
          }
        }
      }

      rafIdRef.current = requestAnimationFrame(loop);
    }

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [cameraStatus, videoRef, landmarkerRef]);

  function startCalibration() {
    samplesRef.current = [];
    lastSampleTimeRef.current = 0;
    neutralRef.current = null;
    hasCalibratedRef.current = false;

    setIsCalibrating(true);
    isCalibrationRef.current = true;
    calibrationEndTimeRef.current = performance.now() + CALIBRATION_DURATION_MS;
  }

  async function togglePictureInPicture() {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.error("PiP error:", err);
    }
  }

  // Derive status message from hook states
  function getStatusMessage(): string {
    if (cameraError) return `Error: ${cameraError}`;
    if (landmarkerError) return `Error: ${landmarkerError}`;
    if (cameraStatus === "requesting") return "Requesting camera…";
    if (landmarkerStatus === "loading") return "Loading Face Landmarker…";
    if (cameraStatus === "ready" && landmarkerStatus === "ready")
      return "Tracking";
    return "Initializing…";
  }

  return (
    <div className="flex flex-col items-center p-4 pt-16">
      <h1 className="text-3xl font-bold mb-2">Face Tension Monitor</h1>

      <p className="text-gray-400 mb-4">{getStatusMessage()}</p>

      <div className="mb-4 text-sm">
        <p>Eye openness: {eyeOpenAvg?.toFixed(4) ?? "—"}</p>
        <p>Brow inner distance: {browInnerDist?.toFixed(4) ?? "—"}</p>
      </div>

      <div className="flex justify-center gap-2 mb-4">
        <button
          onClick={startCalibration}
          disabled={isCalibrating}
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isCalibrating
            ? `Calibrating… ${calibrationSecondsLeft}`
            : "Calibrate (10s)"}
        </button>
        <button
          onClick={togglePictureInPicture}
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
        >
          {isPip ? "Exit Picture-in-Picture" : "Enable Picture-in-Picture"}
        </button>
      </div>

      <div className={`relative w-[640px] ${isPip ? "hidden" : "block"}`}>
        <video
          ref={videoRef}
          width={640}
          height={480}
          playsInline
          muted
          className={`block ${isPip ? "" : "-scale-x-100"}`}
        />
        <canvas
          ref={canvasRef}
          className={`absolute left-0 top-0 pointer-events-none ${isPip ? "" : "-scale-x-100"}`}
        />
      </div>
    </div>
  );
}

export default App;
