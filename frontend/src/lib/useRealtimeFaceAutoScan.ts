import { useEffect, useRef, useState } from "react";
import { FaceDetector, FilesetResolver, type Detection } from "@mediapipe/tasks-vision";

export type FaceGuideStatus =
  | "idle"
  | "loading_model"
  | "no_face"
  | "multi_face"
  | "too_far"
  | "too_close"
  | "off_center"
  | "tilt"
  | "poor_light"
  | "holding"
  | "detector_error";

export interface FaceAutoScanState {
  status: FaceGuideStatus;
  hint: string;
  aligned: boolean;
  /** 0..1 stability progress towards auto-capture. */
  progress: number;
  detectorReady: boolean;
}

interface UseRealtimeFaceAutoScanOptions {
  enabled: boolean;
  getVideo: () => HTMLVideoElement | null;
  onReadyToCapture: () => void;
  /** Minimum steady-face duration (ms) before triggering server verification. */
  holdDurationMs?: number;
  /** Minimum interval (ms) between consecutive local detections. */
  sampleIntervalMs?: number;
}

const TARGET_ASPECT = 3 / 4; // Matches Viewfinder aspect-[3/4] container
const DEFAULT_HOLD_MS = 650;
const DEFAULT_SAMPLE_MS = 110;

interface FrameAnalysis {
  status: FaceGuideStatus;
  hint: string;
  aligned: boolean;
  centerX?: number;
  centerY?: number;
}

function mapBoxToVisibleContainer(
  box: { originX: number; originY: number; width: number; height: number },
  srcW: number,
  srcH: number,
) {
  const srcAspect = srcW / Math.max(1, srcH);
  let visX = 0;
  let visY = 0;
  let visW = srcW;
  let visH = srcH;

  // Viewfinder uses object-cover inside 3:4, so edges outside the visible crop must be excluded.
  if (srcAspect > TARGET_ASPECT) {
    visW = srcH * TARGET_ASPECT;
    visX = (srcW - visW) / 2;
  } else if (srcAspect < TARGET_ASPECT) {
    visH = srcW / TARGET_ASPECT;
    visY = (srcH - visH) / 2;
  }

  const rawCenterX = box.originX + box.width / 2;
  const rawCenterY = box.originY + box.height / 2;

  // Viewfinder applies -scale-x-100 mirror, so flip X to match user's visual reflection.
  const normCenterX = 1 - (rawCenterX - visX) / Math.max(1, visW);
  const normCenterY = (rawCenterY - visY) / Math.max(1, visH);
  const normWidth = box.width / Math.max(1, visW);
  const normHeight = box.height / Math.max(1, visH);

  return { normCenterX, normCenterY, normWidth, normHeight };
}

function measureSampleBrightness(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): number | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  ctx.drawImage(video, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let total = 0;
  const pixels = w * h;
  for (let i = 0; i < data.length; i += 4) {
    total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return total / Math.max(1, pixels);
}

function evaluateDetection(
  detections: Detection[],
  video: HTMLVideoElement,
  lumaCanvas: HTMLCanvasElement,
): FrameAnalysis {
  if (detections.length === 0) {
    return { status: "no_face", hint: "Arahkan wajah ke dalam bingkai", aligned: false };
  }
  if (detections.length > 1) {
    return { status: "multi_face", hint: "Pastikan hanya 1 wajah di depan kamera", aligned: false };
  }

  const primary = detections[0];
  const box = primary.boundingBox;
  if (!box) {
    return { status: "no_face", hint: "Arahkan wajah ke dalam bingkai", aligned: false };
  }

  const srcW = video.videoWidth || 640;
  const srcH = video.videoHeight || 480;
  const { normCenterX, normCenterY, normWidth, normHeight } = mapBoxToVisibleContainer(box, srcW, srcH);

  if (normWidth < 0.24 || normHeight < 0.19) {
    return { status: "too_far", hint: "Dekatkan wajah sedikit ke kamera", aligned: false };
  }
  if (normWidth > 0.78 || normHeight > 0.74) {
    return { status: "too_close", hint: "Jauhkan wajah sedikit dari kamera", aligned: false };
  }

  // Oval in Viewfinder SVG has center (0.5, 0.4625)
  if (normCenterX < 0.35) {
    return { status: "off_center", hint: "Geser wajah sedikit ke kanan", aligned: false };
  }
  if (normCenterX > 0.65) {
    return { status: "off_center", hint: "Geser wajah sedikit ke kiri", aligned: false };
  }
  if (normCenterY < 0.29) {
    return { status: "off_center", hint: "Turunkan wajah sedikit ke tengah bingkai", aligned: false };
  }
  if (normCenterY > 0.63) {
    return { status: "off_center", hint: "Angkat wajah sedikit ke tengah bingkai", aligned: false };
  }

  // Check rough frontal orientation from BlazeFace eye keypoints (0: rightEye, 1: leftEye)
  if (primary.keypoints && primary.keypoints.length >= 2) {
    const rightEye = primary.keypoints[0];
    const leftEye = primary.keypoints[1];
    const eyeDy = Math.abs(rightEye.y - leftEye.y);
    const eyeDx = Math.abs(rightEye.x - leftEye.x);
    if (eyeDx > 0.01 && eyeDy / eyeDx > 0.28) {
      return { status: "tilt", hint: "Tegakkan kepala & hadap lurus ke kamera", aligned: false };
    }
  }

  const brightness = measureSampleBrightness(video, lumaCanvas);
  if (brightness !== null) {
    if (brightness < 32) {
      return { status: "poor_light", hint: "Pencahayaan terlalu gelap, cari cahaya lebih terang", aligned: false };
    }
    if (brightness > 246) {
      return { status: "poor_light", hint: "Cahaya terlalu silau, hindari lampu langsung", aligned: false };
    }
  }

  return {
    status: "holding",
    hint: "Wajah pas! Tahan sebentar…",
    aligned: true,
    centerX: normCenterX,
    centerY: normCenterY,
  };
}

let cachedDetectorPromise: Promise<FaceDetector> | null = null;

async function getSharedFaceDetector(): Promise<FaceDetector> {
  if (!cachedDetectorPromise) {
    cachedDetectorPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks("/mediapipe-wasm");
      try {
        return await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/blaze_face_short_range.tflite",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.62,
          minSuppressionThreshold: 0.3,
        });
      } catch {
        // Fallback to CPU WASM when WebGL/GPU delegate is unavailable on the device
        return await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/blaze_face_short_range.tflite",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.62,
          minSuppressionThreshold: 0.3,
        });
      }
    })();
  }
  return cachedDetectorPromise;
}

/**
 * Lightweight client-side MediaPipe BlazeFace pre-check loop.
 * Guides the resident to center their face and fires `onReadyToCapture` only once
 * when aligned & steady, avoiding backend rate-limit pressure and false audit rejections.
 */
export function useRealtimeFaceAutoScan({
  enabled,
  getVideo,
  onReadyToCapture,
  holdDurationMs = DEFAULT_HOLD_MS,
  sampleIntervalMs = DEFAULT_SAMPLE_MS,
}: UseRealtimeFaceAutoScanOptions): FaceAutoScanState {
  const onTriggerRef = useRef(onReadyToCapture);
  const getVideoRef = useRef(getVideo);
  onTriggerRef.current = onReadyToCapture;
  getVideoRef.current = getVideo;

  const [state, setState] = useState<FaceAutoScanState>({
    status: enabled ? "loading_model" : "idle",
    hint: enabled ? "Menyiapkan detektor wajah…" : "Posisikan wajah di dalam bingkai",
    aligned: false,
    progress: 0,
    detectorReady: false,
  });

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({
        ...prev,
        status: "idle",
        aligned: false,
        progress: 0,
      }));
      return;
    }

    let cancelled = false;
    let rafId: number | null = null;
    let lastSampleAt = 0;
    let lastVideoTimestamp = 0;
    let steadySince: number | null = null;
    let prevCenter: { x: number; y: number } | null = null;
    let triggeredThisCycle = false;

    const lumaCanvas = document.createElement("canvas");
    lumaCanvas.width = 40;
    lumaCanvas.height = 40;

    setState({
      status: "loading_model",
      hint: "Menyiapkan detektor wajah…",
      aligned: false,
      progress: 0,
      detectorReady: false,
    });

    getSharedFaceDetector()
      .then((detector) => {
        if (cancelled) return;

        const tick = (now: number) => {
          if (cancelled || triggeredThisCycle) return;

          if (now - lastSampleAt >= sampleIntervalMs) {
            lastSampleAt = now;
            const video = getVideoRef.current();

            if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
              // MediaPipe VIDEO mode requires strictly increasing integer timestamps in ms.
              const ts = Math.max(Math.round(now), lastVideoTimestamp + 1);
              lastVideoTimestamp = ts;

              try {
                const res = detector.detectForVideo(video, ts);
                const analysis = evaluateDetection(res.detections, video, lumaCanvas);

                if (analysis.aligned && analysis.centerX !== undefined && analysis.centerY !== undefined) {
                  const movedTooMuch =
                    prevCenter !== null &&
                    (Math.abs(analysis.centerX - prevCenter.x) > 0.04 ||
                      Math.abs(analysis.centerY - prevCenter.y) > 0.04);

                  prevCenter = { x: analysis.centerX, y: analysis.centerY };

                  if (steadySince === null || movedTooMuch) {
                    steadySince = now;
                  }

                  const elapsed = now - steadySince;
                  const progress = Math.min(1, elapsed / holdDurationMs);

                  setState({
                    status: "holding",
                    hint: progress >= 1 ? "Memindai wajah sekarang…" : "Wajah pas! Tahan sebentar…",
                    aligned: true,
                    progress,
                    detectorReady: true,
                  });

                  if (elapsed >= holdDurationMs) {
                    triggeredThisCycle = true;
                    onTriggerRef.current();
                    return;
                  }
                } else {
                  steadySince = null;
                  prevCenter = null;
                  setState({
                    status: analysis.status,
                    hint: analysis.hint,
                    aligned: false,
                    progress: 0,
                    detectorReady: true,
                  });
                }
              } catch {
                // Keep loop alive if a transient frame decode error happens
              }
            }
          }

          rafId = window.requestAnimationFrame(tick);
        };

        rafId = window.requestAnimationFrame(tick);
      })
      .catch(() => {
        if (!cancelled) {
          cachedDetectorPromise = null;
          setState({
            status: "detector_error",
            hint: "Deteksi otomatis tidak didukung, gunakan tombol Pindai wajah",
            aligned: false,
            progress: 0,
            detectorReady: false,
          });
        }
      });

    return () => {
      cancelled = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      lumaCanvas.width = 0;
      lumaCanvas.height = 0;
    };
  }, [enabled, holdDurationMs, sampleIntervalMs]);

  return state;
}
