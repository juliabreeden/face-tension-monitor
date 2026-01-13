import { useEffect, useRef, useState } from "react";
import { useCamera } from "./hooks/useCamera";
import { useFaceLandmarker } from "./hooks/useFaceLandmarker";
import { computeSignals, type Signals } from "./face/computeSignals";
import { playRelaxChime } from "./utils/audio";
import { StatusIndicator } from "./components/StatusIndicator";
import { ThemeToggle } from "./components/ThemeToggle";
import { Switch } from "./components/ui/switch";
import { Label } from "./components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { Button } from "./components/ui/button";

// Timing
const CALIBRATION_DURATION_MS = 10_000;
const TENSION_ALERT_THRESHOLD_MS = 3_000;
const SAMPLE_INTERVAL_MS = 100;
const UI_UPDATE_INTERVAL_MS = 100;

// Detection thresholds (relative to calibrated neutral)
const TENSION_THRESHOLD = 0.9;
const SMILE_MOUTH_WIDTH_THRESHOLD = 1.05;
const SMILE_CORNER_LIFT_THRESHOLD = 1.3;
const SMILE_CHEEK_RAISE_THRESHOLD = 0.95;
const HEAD_ROTATION_THRESHOLD = 0.5;

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
  const [hasCalibrated, setHasCalibrated] = useState(false);

  // Tension tracking
  const tensionStartTimeRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [isAlertEnabled, setIsAlertEnabled] = useState(true);

  // Live signals for UI display
  const [eyeOpenAvg, setEyeOpenAvg] = useState<number | null>(null);
  const [browInnerDist, setBrowInnerDist] = useState<number | null>(null);
  const [isSmiling, setIsSmiling] = useState(false);
  const [smileScore, setSmileScore] = useState(0);
  const [headRotation, setHeadRotation] = useState<number | null>(null);
  const [isHeadTurned, setIsHeadTurned] = useState(false);
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
        // Only collect samples when facing forward (head not turned)
        if (Math.abs(signals.headRotation) <= HEAD_ROTATION_THRESHOLD) {
          samplesRef.current.push(signals);
        }
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
        const mouthMean =
          samples.reduce((sum, s) => sum + s.mouthWidth, 0) / samples.length;
        const cornerLiftMean =
          samples.reduce((sum, s) => sum + s.mouthCornerLift, 0) /
          samples.length;
        const cheekRaiseMean =
          samples.reduce((sum, s) => sum + s.cheekRaise, 0) / samples.length;
        const headRotationMean =
          samples.reduce((sum, s) => sum + s.headRotation, 0) / samples.length;
        neutralRef.current = {
          eyeOpenAvg: eyeMean,
          browInnerDist: browMean,
          mouthWidth: mouthMean,
          mouthCornerLift: cornerLiftMean,
          cheekRaise: cheekRaiseMean,
          headRotation: headRotationMean,
        };
        hasCalibratedRef.current = true;
        setHasCalibrated(true);
      }

      samplesRef.current = [];
    }

    function detectSmile(
      signals: Signals,
      neutral: Signals,
    ): { isSmiling: boolean; score: number } {
      const mouthWidthRatio = signals.mouthWidth / neutral.mouthWidth;
      const mouthWidthScore = Math.max(0, (mouthWidthRatio - 1) * 10);

      const cornerLiftDelta = signals.mouthCornerLift - neutral.mouthCornerLift;
      const cornerLiftScore = Math.max(0, cornerLiftDelta * 100);

      const cheekRaiseRatio = signals.cheekRaise / neutral.cheekRaise;
      const cheekRaiseScore = Math.max(0, (1 - cheekRaiseRatio) * 10);

      const score =
        mouthWidthScore * 0.4 + cornerLiftScore * 0.35 + cheekRaiseScore * 0.25;

      // Require at least 2 of 3 indicators for robustness
      const indicators = [
        mouthWidthRatio > SMILE_MOUTH_WIDTH_THRESHOLD,
        cornerLiftDelta >
          (neutral.mouthCornerLift * (SMILE_CORNER_LIFT_THRESHOLD - 1) ||
            0.002),
        cheekRaiseRatio < SMILE_CHEEK_RAISE_THRESHOLD,
      ];
      const isSmiling = score > 0.3 || indicators.filter(Boolean).length >= 2;

      return { isSmiling, score: Math.min(1, score) };
    }

    function checkTension(signals: Signals, now: number) {
      const neutral = neutralRef.current;
      if (!neutral) return;

      const headTurned =
        Math.abs(signals.headRotation) > HEAD_ROTATION_THRESHOLD;
      if (headTurned) {
        tensionStartTimeRef.current = null;
        setIsSmiling(false);
        setSmileScore(0);
        return;
      }

      const { isSmiling: smiling, score } = detectSmile(signals, neutral);
      setIsSmiling(smiling);
      setSmileScore(score);

      const isTense =
        !smiling &&
        (signals.eyeOpenAvg < neutral.eyeOpenAvg * TENSION_THRESHOLD ||
          signals.browInnerDist < neutral.browInnerDist * TENSION_THRESHOLD);

      if (isTense) {
        if (tensionStartTimeRef.current === null) {
          tensionStartTimeRef.current = now;
        } else if (
          now - tensionStartTimeRef.current >=
          TENSION_ALERT_THRESHOLD_MS
        ) {
          if (isAlertEnabled) {
            triggerTensionAlert();
          }
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
            setHeadRotation(signals.headRotation);
            setIsHeadTurned(
              Math.abs(signals.headRotation) > HEAD_ROTATION_THRESHOLD,
            );
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
  }, [cameraStatus, videoRef, landmarkerRef, isAlertEnabled]);

  function startCalibration() {
    samplesRef.current = [];
    lastSampleTimeRef.current = 0;
    neutralRef.current = null;
    hasCalibratedRef.current = false;
    setHasCalibrated(false);
    setIsSmiling(false);
    setSmileScore(0);

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
  function getStatus(): {
    type: "error" | "loading" | "ready";
    message: string;
  } {
    if (cameraError) return { type: "error", message: `Error: ${cameraError}` };
    if (landmarkerError)
      return { type: "error", message: `Error: ${landmarkerError}` };
    if (cameraStatus === "requesting")
      return { type: "loading", message: "Requesting camera…" };
    if (landmarkerStatus === "loading")
      return { type: "loading", message: "Loading Face Landmarker…" };
    if (cameraStatus === "ready" && landmarkerStatus === "ready")
      return { type: "ready", message: "Tracking" };
    return { type: "loading", message: "Initializing…" };
  }

  const status = getStatus();
  return (
    <div className="flex flex-col items-center p-4 pt-16 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <h1 className="text-3xl font-bold mb-2">Face Tension Monitor</h1>

      <StatusIndicator status={status} />

      <div className="mb-4 text-sm">
        <p>Eye openness: {eyeOpenAvg?.toFixed(4) ?? "—"}</p>
        <p>Brow inner distance: {browInnerDist?.toFixed(4) ?? "—"}</p>
        <p>
          Head rotation:{" "}
          {headRotation !== null ? (
            <span
              className={
                isHeadTurned ? "text-amber-600 dark:text-amber-400" : ""
              }
            >
              {(headRotation * 100).toFixed(0)}%
            </span>
          ) : (
            "—"
          )}
        </p>
        {hasCalibrated && (
          <p
            className={
              isHeadTurned
                ? "text-amber-600 dark:text-amber-400"
                : isSmiling
                  ? "text-green-600 dark:text-green-400 font-medium"
                  : ""
            }
          >
            {isHeadTurned
              ? "🔄 Head turned – detection paused"
              : isSmiling
                ? `😊 Smiling (${(smileScore * 100).toFixed(0)}%) – no tension alert`
                : "😐 Neutral"}
          </p>
        )}
      </div>

      <div className="w-[640px]">
        <div className="flex justify-between items-center mb-2">
          <Button
            onClick={startCalibration}
            disabled={isCalibrating}
            className="px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isCalibrating
              ? `Calibrating… ${calibrationSecondsLeft}`
              : "Calibrate (10s)"}
          </Button>
          <div className="flex items-center gap-4">
            {isPip ? (
              <Button
                onClick={togglePictureInPicture}
                className="px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
              >
                Exit PiP
              </Button>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={togglePictureInPicture}
                      className="px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                    >
                      Enable PiP
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Picture-in-Picture keeps the video feed visible in a
                    floating window, allowing face tracking to continue even
                    when you switch to other tabs or apps.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <div className="flex items-center gap-2">
              <Switch
                id="alerts"
                checked={isAlertEnabled}
                onCheckedChange={setIsAlertEnabled}
              />
              <Label htmlFor="alerts">Alerts</Label>
            </div>
          </div>
        </div>
        <div className={`relative ${isPip ? "hidden" : "block"}`}>
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
    </div>
  );
}

export default App;
