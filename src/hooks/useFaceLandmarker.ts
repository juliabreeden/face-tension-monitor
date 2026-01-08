import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { createFaceLandmarker } from "../face/createFaceLandmarker";

export type LandmarkerStatus = "idle" | "loading" | "ready" | "error";

interface UseFaceLandmarkerResult {
  landmarkerRef: React.RefObject<FaceLandmarker | null>;
  status: LandmarkerStatus;
  error: string | null;
}

/**
 * Hook to load and manage the MediaPipe FaceLandmarker.
 * Handles async initialization and cleanup.
 */
export function useFaceLandmarker(): UseFaceLandmarkerResult {
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const [status, setStatus] = useState<LandmarkerStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadLandmarker() {
      try {
        setStatus("loading");

        const landmarker = await createFaceLandmarker();

        if (cancelled) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "Failed to load face landmarker",
        );
      }
    }

    loadLandmarker();

    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
    };
  }, []);

  return { landmarkerRef, status, error };
}
