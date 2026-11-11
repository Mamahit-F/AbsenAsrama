import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CameraOff, Check, RefreshCw, UserRound, X } from "lucide-react";
import { cn } from "../lib/utils";

export type CamState = "idle" | "scanning" | "ok" | "fail";
export type CamAccessState = "loading" | "on" | "off";

export interface ViewfinderHandle {
  captureFrame: (quality?: number) => Promise<Blob | null>;
  retryCamera: () => void;
  getAccessState: () => CamAccessState;
}

export interface ViewfinderProps {
  state?: CamState;
  pose?: string;
  label?: string;
  children?: ReactNode;
  onCameraStateChange?: (accessState: CamAccessState) => void;
}

/** Webcam viewfinder with face guide and real JPEG frame capture via canvas. */
export const Viewfinder = forwardRef<ViewfinderHandle, ViewfinderProps>(function Viewfinder(
  { state = "idle", pose, label, children, onCameraStateChange },
  ref,
) {
  const video = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cam, setCam] = useState<CamAccessState>("loading");
  const [retryCounter, setRetryCounter] = useState(0);

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (video.current) {
      video.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    onCameraStateChange?.(cam);
  }, [cam, onCameraStateChange]);

  useEffect(() => {
    let cancelled = false;
    setCam("loading");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCam("off");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (video.current) {
          video.current.srcObject = s;
        }
        setCam("on");
      })
      .catch(() => {
        if (!cancelled) {
          setCam("off");
        }
      });

    return () => {
      cancelled = true;
      stopTracks();
    };
  }, [retryCounter, stopTracks]);

  const captureFrame = useCallback(async (quality = 0.9): Promise<Blob | null> => {
    const v = video.current;
    if (!v || cam !== "on" || v.readyState < 2) {
      return null;
    }

    const srcW = v.videoWidth || 640;
    const srcH = v.videoHeight || 640;
    const maxDim = 720;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(v, 0, 0, targetW, targetH);

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => {
          canvas.width = 0;
          canvas.height = 0;
          resolve(blob);
        },
        "image/jpeg",
        quality,
      );
    });
  }, [cam]);

  const retryCamera = useCallback(() => {
    stopTracks();
    setRetryCounter((c) => c + 1);
  }, [stopTracks]);

  useImperativeHandle(
    ref,
    () => ({
      captureFrame,
      retryCamera,
      getAccessState: () => cam,
    }),
    [cam, captureFrame, retryCamera],
  );

  const ring =
    state === "ok"
      ? "#34d399"
      : state === "fail"
        ? "#f87171"
        : state === "scanning"
          ? "#e879f9"
          : "rgba(255,255,255,.85)";
  const Arrow = { kiri: ArrowLeft, kanan: ArrowRight, atas: ArrowUp, bawah: ArrowDown }[pose ?? ""];

  return (
    <div className="soft relative mx-auto aspect-[3/4] w-full overflow-hidden rounded-[36px] p-2.5">
      <div className="night relative h-full w-full overflow-hidden rounded-[28px]">
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          className={cn(
            "absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity duration-500",
            cam === "on" ? "opacity-100" : "opacity-0",
          )}
        />
        {cam !== "on" && (
          <div className="absolute inset-0 grid place-items-center" aria-hidden>
            <UserRound className="size-48 text-white/25" strokeWidth={1} />
          </div>
        )}
        {cam === "off" && (
          <div className="absolute inset-x-4 top-4 z-20 flex flex-col items-center gap-2 rounded-2xl bg-black/75 p-3 text-center text-white backdrop-blur-md">
            <div className="flex items-center gap-1.5 text-xs font-bold text-danger">
              <CameraOff className="size-4 shrink-0" aria-hidden /> Kamera tidak tersedia atau izin ditolak
            </div>
            <p className="text-[11px] text-white/80">
              Izinkan akses kamera pada browser Anda untuk mengambil foto wajah.
            </p>
            <button
              type="button"
              onClick={retryCamera}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/25"
            >
              <RefreshCw className="size-3" aria-hidden /> Coba lagi izin kamera
            </button>
          </div>
        )}

        {/* oval guide with mask */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden>
          <defs>
            <mask id="hole">
              <rect width="300" height="400" fill="white" />
              <ellipse cx="150" cy="185" rx="98" ry="128" fill="black" />
            </mask>
          </defs>
          <rect width="300" height="400" fill="rgba(14,11,40,.6)" mask="url(#hole)" />
          <motion.ellipse
            cx="150"
            cy="185"
            rx="98"
            ry="128"
            fill="none"
            strokeWidth="3"
            strokeDasharray={state === "idle" ? "6 8" : "0"}
            animate={{ stroke: ring }}
            transition={{ duration: 0.3 }}
          />
        </svg>

        {/* viewfinder corner brackets */}
        {[
          "left-4 top-4 border-l-2 border-t-2 rounded-tl-xl",
          "right-4 top-4 border-r-2 border-t-2 rounded-tr-xl",
          "bottom-4 left-4 border-b-2 border-l-2 rounded-bl-xl",
          "bottom-4 right-4 border-b-2 border-r-2 rounded-br-xl",
        ].map((c, i) => (
          <motion.span
            key={c}
            aria-hidden
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", bounce: 0.3, delay: 0.1 + i * 0.05 }}
            className={cn("absolute size-7 border-white/70", c)}
          />
        ))}

        {/* liveness pulse */}
        <AnimatePresence>
          {state === "scanning" && (
            <motion.div
              key="pulse"
              className="pointer-events-none absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="absolute left-1/2 top-[46%] h-[64%] w-[65%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-[#c084fc]"
                animate={{ scale: [1, 1.08], opacity: [0.7, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
              />
              <div className="absolute inset-x-[17%] top-[14%] h-[64%] overflow-hidden rounded-[50%]">
                <div className="scan-sweep h-14 w-full bg-gradient-to-b from-transparent via-[#e879f9]/60 to-transparent" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {Arrow && state !== "ok" && (
          <motion.div
            key={pose}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{
              opacity: 1,
              scale: 1,
              x: pose === "kiri" ? [-4, 4] : pose === "kanan" ? [4, -4] : 0,
              y: pose === "atas" ? [-4, 4] : pose === "bawah" ? [4, -4] : 0,
            }}
            transition={{
              opacity: { duration: 0.2 },
              scale: { type: "spring", bounce: 0.4 },
              x: { repeat: Infinity, repeatType: "reverse", duration: 0.7 },
              y: { repeat: Infinity, repeatType: "reverse", duration: 0.7 },
            }}
            className={cn(
              "glass-chip absolute grid size-12 place-items-center rounded-full text-white",
              pose === "kiri" && "left-3 top-[44%]",
              pose === "kanan" && "right-3 top-[44%]",
              pose === "atas" && "left-1/2 top-3 -ml-6",
              pose === "bawah" && "bottom-20 left-1/2 -ml-6",
            )}
            aria-hidden
          >
            <Arrow className="size-6" />
          </motion.div>
        )}

        {label && (
          <AnimatePresence mode="wait">
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="night-card absolute inset-x-6 bottom-5 rounded-full px-4 py-2.5 text-center font-display text-sm font-medium text-white"
              aria-live="polite"
            >
              {label}
            </motion.div>
          </AnimatePresence>
        )}
        {children}
      </div>
    </div>
  );
});

/* ---------- Animated check / cross ---------- */
export function ResultMark({ ok, size = 88 }: { ok: boolean; size?: number }) {
  return (
    <motion.div
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", bounce: 0.45, visualDuration: 0.4 }}
      className={cn("mx-auto grid place-items-center rounded-full", ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        {ok ? (
          <motion.path d="M4.5 12.5l5 5L19.5 7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15, duration: 0.4, ease: "easeOut" }} />
        ) : (
          <>
            <motion.path d="M6 6l12 12" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15, duration: 0.25 }} />
            <motion.path d="M18 6L6 18" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.32, duration: 0.25 }} />
          </>
        )}
      </svg>
    </motion.div>
  );
}

/* ---------- Pipeline steps (liveness → match → session → save) ---------- */
export function Pipeline({ steps, current, failedAt }: { steps: string[]; current: number; failedAt?: number }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const done = i < current && failedAt !== i;
        const fail = failedAt === i;
        const active = i === current && failedAt === undefined;
        return (
          <motion.li
            key={s}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: i <= current ? 1 : 0.45, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex items-center gap-3 text-sm font-medium"
          >
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full text-[11px] font-extrabold transition-colors duration-200",
                done && "bg-success text-white",
                fail && "bg-danger text-white",
                active && "grad-accent",
                !done && !fail && !active && "soft-inset text-subtle",
              )}
            >
              {active ? (
                <span className="spin block size-3 rounded-full border-2 border-white/40 border-t-white" />
              ) : done ? (
                <Check className="size-3.5" strokeWidth={3} aria-hidden />
              ) : fail ? (
                <X className="size-3.5" strokeWidth={3} aria-hidden />
              ) : (
                i + 1
              )}
            </span>
            {s}
          </motion.li>
        );
      })}
    </ol>
  );
}
