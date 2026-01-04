import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import "./App.css";
import { createFaceLandmarker } from "./face/createFaceLandmarker";
import { computeSignals, type Signals } from "./face/computeSignals";
// use these for debugging to highlight specific landmarks when adding new signals
// import { FACE_LM } from "./face/indices";
// import { highlightPoints } from "./face/drawUtils";

const CALIBRATION_DURATION = 10000; // 10 seconds
const TENSION_ALERT_THRESHOLD_MS = 3000; // 3 seconds

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
  const [calibrationSecondsLeft, setCalibrationSecondsLeft] =
    useState<number>(10);
  const neutralRef = useRef<Signals | null>(null);
  const hasCalibratedRef = useRef<boolean>(false);
  const tensionStartTimeRef = useRef<number | null>(null);

  // TODO: Use the calibrated neutral values to compute a live tension score and trigger alerts when above threshold

  const [eyeOpenAvg, setEyeOpenAvg] = useState<number | null>(null);
  const [browInnerDist, setBrowInnerDist] = useState<number | null>(null);

  const lastUiUpdateRef = useRef<number>(0);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // console.log("Notification.permission", Notification.permission);

  const [isPip, setIsPip] = useState(false);

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
  }, []);

  function startCalibration() {
    // reset everything for a fresh run
    samplesRef.current = [];
    lastSampleTimeRef.current = 0;

    neutralRef.current = null;
    hasCalibratedRef.current = false;
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
                setCalibrationSecondsLeft(
                  Math.max(
                    0,
                    Math.ceil((calibrationEndTimeRef.current! - now) / 1000),
                  ),
                );
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
                  samples.reduce((sum, s) => sum + s.eyeOpenAvg, 0) /
                  samples.length;
                const browMean =
                  samples.reduce((sum, s) => sum + s.browInnerDist, 0) /
                  samples.length;

                neutralRef.current = { eyeOpenAvg: eyeMean, browInnerDist: browMean };
                hasCalibratedRef.current = true;
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

            if (hasCalibratedRef.current && neutralRef.current && signals) {
              const isTense =
                signals.eyeOpenAvg < neutralRef.current.eyeOpenAvg * 0.9 ||
                signals.browInnerDist < neutralRef.current.browInnerDist * 0.9;
              
              if (isTense) {
                console.log("inside if isTense")
                if (tensionStartTimeRef.current === null) {
                  tensionStartTimeRef.current = now; // start tracking
                } else if (now - tensionStartTimeRef.current >= TENSION_ALERT_THRESHOLD_MS) {
                  // Tension sustained for threshold duration - trigger notification!
                  if (Notification.permission === "granted") {
                    console.log("attempting to send notification")
                    try {
                      const notification = new Notification("Face Tension Monitor", {
                        body: "Tension detected! Relax your face :)",
                        icon: "/favicon.ico",
                        requireInteraction: true, // Keep notification visible until dismissed
                      });
                      console.log("Notification created:", notification);
                    } catch (error) {
                      console.error("Error sending notification", error);
                    }
                  }
                  // Play a relaxing chime sound
                  const audioCtx = new AudioContext();
                  const playTone = (freq: number, startTime: number, duration: number) => {
                    const oscillator = audioCtx.createOscillator();
                    const gainNode = audioCtx.createGain();
                    oscillator.connect(gainNode);
                    gainNode.connect(audioCtx.destination);
                    oscillator.type = "sine";
                    oscillator.frequency.value = freq;
                    // Gentle fade in and out
                    gainNode.gain.setValueAtTime(0, startTime);
                    gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
                    oscillator.start(startTime);
                    oscillator.stop(startTime + duration);
                  };
                  // Play a pleasant chord: C5, E5, G5 (major chord)
                  const now = audioCtx.currentTime;
                  playTone(523.25, now, 1.5);        // C5
                  playTone(659.25, now + 0.1, 1.4);  // E5
                  playTone(783.99, now + 0.2, 1.3);  // G5
                  // Reset timer to avoid spamming notifications
                  tensionStartTimeRef.current = null;
                }
                // not sure about this 
              } else {
                tensionStartTimeRef.current = null; // reset timer when relaxed
              }
            }
          }

          rafIdRef.current = requestAnimationFrame(loop);
        }

        rafIdRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.error(err);
        setStatus(
          err instanceof Error ? `Error: ${err.message}` : "Error starting",
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
      <p>Eye openness: {eyeOpenAvg ? eyeOpenAvg.toFixed(4) : "—"}</p>
      <p>
        Brow inner distance: {browInnerDist ? browInnerDist.toFixed(4) : "—"}
      </p>
      <button onClick={startCalibration} disabled={isCalibrating}>
        {isCalibrating
          ? `Calibrating… ${calibrationSecondsLeft ?? ""}`
          : "Calibrate (10s)"}
      </button>
      {" "}
      <button onClick={togglePictureInPicture}>
        {isPip ? "Exit Picture-in-Picture" : "Enable Picture-in-Picture"}
      </button>

      <div style={{ position: "relative", width: 640, display: isPip ? "none" : "block" }}>
        <video
          ref={videoRef}
          width={640}
          height={480}
          playsInline
          muted
          style={{
            display: "block",
            transform: isPip ? "none" : "scaleX(-1)", // mirror only when not in PiP
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            pointerEvents: "none",
            transform: isPip ? "none" : "scaleX(-1)", // mirror only when not in PiP
          }}
        />
      </div>
    </div>
  );
}

export default App;
