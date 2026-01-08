import { useEffect, useRef, useState } from "react";

export type CameraStatus = "initializing" | "requesting" | "ready" | "error";

interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: string | null;
}

/**
 * Hook to manage webcam stream initialization and cleanup.
 * Handles requesting camera permissions and setting up the video element.
 */
export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<CameraStatus>("initializing");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initCamera() {
      const videoEl = videoRef.current;
      if (!videoEl) return;

      try {
        setStatus("requesting");

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });

        if (cancelled) {
          // Clean up stream if component unmounted during async operation
          for (const track of stream.getTracks()) track.stop();
          return;
        }

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

        await videoEl.play();

        if (cancelled) return;

        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "Failed to access camera",
        );
      }
    }

    initCamera();

    return () => {
      cancelled = true;

      // Stop camera stream on cleanup
      const stream = videoRef.current?.srcObject;
      if (stream instanceof MediaStream) {
        for (const track of stream.getTracks()) track.stop();
      }
    };
  }, []);

  return { videoRef, status, error };
}
