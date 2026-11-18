import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ==========================================================================
   KONFIGURASI TRANSISI OMBAK (Selaras dengan Ocean Wave pada Ganti Tema)
   ========================================================================== */
export const OCEAN_WAVE_CONFIG = {
  /** Durasi singkat kartu login meredup ke permukaan laut sebelum ombak menyapu (ms) */
  prepDurationMs: 180,
  /** Durasi sapuan ombak samudra melintasi layar (ms) */
  waveDurationMs: 1650,
  /** Durasi settle animasi Motion pada dashboard (ms) */
  settleDurationMs: 1400,
} as const;

export type PlayOceanWaveFn = (onNavigate: () => void, onDone?: () => void) => void;

interface OceanWaveContextValue {
  isTransitioning: boolean;
  enteringFromLogin: boolean;
  registerRevealElement: (el: HTMLDivElement | null) => void;
  playOceanWaveTransition: PlayOceanWaveFn;
}

const OceanWaveCtx = createContext<OceanWaveContextValue>({
  isTransitioning: false,
  enteringFromLogin: false,
  registerRevealElement: () => {},
  playOceanWaveTransition: (onNavigate, onDone) => {
    onNavigate();
    onDone?.();
  },
});

export function useOceanWaveTransition() {
  return useContext(OceanWaveCtx);
}

type WavePhase = "idle" | "prep" | "wave";

interface WaveRun {
  runId: number;
  phase: WavePhase;
}

const OverlayRunCtx = createContext<{
  run: WaveRun;
  revealElRef: React.MutableRefObject<HTMLDivElement | null>;
  onPrepComplete: (runId: number) => void;
  onWaveComplete: (runId: number) => void;
}>({
  run: { runId: 0, phase: "idle" },
  revealElRef: { current: null },
  onPrepComplete: () => {},
  onWaveComplete: () => {},
});

const VS_SRC = `
  attribute vec2 a_pos;
  void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

// Shader ombak samudra identik dengan evaluasi ocean wave pada pergantian tema
const FS_SRC = `
  precision highp float;

  uniform vec2 u_stageSize;
  uniform float u_dpr;
  uniform float u_prog;
  uniform float u_waveTime;
  uniform float u_prepAlpha;

  float sq(float x) {
    return x * x;
  }

  float safePow(float x, float e) {
    return pow(max(x, 0.0001), e);
  }

  float organicSeaPattern(vec2 p, float wt) {
    vec2 uv = p * 0.026;
    vec2 w = uv + vec2(
      1.15 * sin(uv.y * 1.35 - wt * 2.3 + cos(uv.x * 1.12 + wt * 1.5)),
      1.15 * cos(uv.x * 1.28 + wt * 2.0 - sin(uv.y * 1.18 - wt * 1.8))
    );
    w += vec2(
      0.48 * cos(w.y * 2.55 + w.x * 0.88 + wt * 2.9),
      0.48 * sin(w.x * 2.40 - w.y * 1.05 - wt * 2.5)
    );
    float f1 = abs(sin(w.x * 1.85 + w.y * 1.08 - wt * 2.1));
    float f2 = abs(sin(-w.x * 0.82 + w.y * 2.12 + wt * 1.7));
    float f3 = abs(sin(w.x * 1.48 - w.y * 1.66 + wt * 2.4));
    float web = 1.0 - min(f1, min(f2, f3));
    float lacy = safePow(web, 5.0);
    float micro = smoothstep(
      0.70,
      0.97,
      0.5 + 0.5 * sin(w.x * 6.2 + cos(w.y * 5.6 - wt * 4.2) * 1.6) *
                  cos(w.y * 5.9 - sin(w.x * 5.2 + wt * 3.8) * 1.6)
    );
    return clamp(lacy * 0.85 + micro * (0.35 + 0.65 * web) * 0.58, 0.0, 1.0);
  }

  void main() {
    vec2 p = vec2(gl_FragCoord.x / max(u_dpr, 1.0), u_stageSize.y - gl_FragCoord.y / max(u_dpr, 1.0));
    vec3 loginSeaColor = vec3(0.016, 0.028, 0.072);

    // Fase persiapan singkat: tirai laut malam halus sebelum ombak mulai menyapu
    if (u_prog <= 0.0001) {
      float a = clamp(u_prepAlpha, 0.0, 1.0);
      gl_FragColor = vec4(loginSeaColor * a, a);
      return;
    }

    float prog = clamp(u_prog, 0.0, 1.0);
    float easeP = 0.5 - 0.5 * cos(3.14159265 * prog);
    float activeEnv = smoothstep(0.0, 0.07, prog) * (1.0 - smoothstep(0.88, 1.0, prog));

    // Arah sapuan diagonal dari kanan-atas ke kiri-bawah (sama seperti ombak ganti tema)
    vec2 dir = normalize(vec2(-0.74, 0.45));
    vec2 perp = vec2(-dir.y, dir.x);
    float coordPx = dot(p, dir);
    float alongPx = dot(p, perp);

    float pMin = min(0.0, u_stageSize.x * dir.x) + min(0.0, u_stageSize.y * dir.y);
    float pMax = max(0.0, u_stageSize.x * dir.x) + max(0.0, u_stageSize.y * dir.y);
    float frontBase = mix(pMin - 85.0, pMax + 230.0, easeP);

    float wt = u_waveTime;
    float s1 = sin(alongPx * 0.0046 + wt * 2.1) * 42.0;
    float s2 = sin(alongPx * 0.0115 - wt * 3.1 + 1.4) * 20.0;
    float s3 = sin(alongPx * 0.0270 + wt * 4.7 + cos(alongPx * 0.015)) * 8.5;
    float scallopPx = (s1 + s2 + s3) * (0.45 + 0.55 * activeEnv);
    float distToCrest = coordPx - (frontBase + scallopPx);

    // Di depan ombak = laut login gelap (alpha 1), di belakang ombak = dashboard tersingkap (alpha 0)
    float aheadMask = smoothstep(-6.0, 6.0, distToCrest);
    float wetAhead = smoothstep(48.0, 2.0, distToCrest) * smoothstep(-3.0, 2.0, distToCrest) * activeEnv;

    float seaPattern = organicSeaPattern(p, wt);
    float foamWobble = sin(alongPx * 0.022 + wt * 3.0 + sin(alongPx * 0.009) * 1.5) * 4.0;

    float lipFoam = exp(-sq((distToCrest + 2.5 + foamWobble * 0.4) / 7.5)) * (0.74 + 0.36 * seaPattern);
    float veilFoam = smoothstep(-72.0, -6.0, distToCrest) * smoothstep(3.0, -4.0, distToCrest) * seaPattern * 0.68;
    float wave2 = exp(-sq((distToCrest + 128.0 + sin(alongPx * 0.010 - wt * 2.4) * 14.0) / 9.5)) * (0.28 + 0.62 * seaPattern);
    float foamTotal = clamp(lipFoam + veilFoam + wave2 * 0.42, 0.0, 1.0) * activeEnv;

    float swashMask = smoothstep(-195.0, -24.0, distToCrest) * smoothstep(3.0, -7.0, distToCrest) * activeEnv;
    float causticSea = safePow(seaPattern, 1.45) * swashMask;
    float crestGlint = exp(-sq((distToCrest + 14.0) / 11.5)) * activeEnv *
      (0.40 + 0.60 * smoothstep(-0.2, 0.9, sin(alongPx * 0.015 + wt * 3.1)));

    // Komposisi warna & transparansi premultiplied-alpha
    vec3 baseCol = loginSeaColor * mix(1.0, 0.72, wetAhead);
    float baseAlpha = aheadMask;

    // Swash biru-teal transparan di belakang puncak ombak
    vec3 seaTint = vec3(0.08, 0.56, 0.64);
    float swashAlpha = swashMask * 0.48;
    vec3 col = mix(baseCol, seaTint, swashAlpha * (1.0 - baseAlpha * 0.5));
    float alpha = 1.0 - (1.0 - baseAlpha) * (1.0 - swashAlpha);

    // Kilau kaustik jaring air & glint puncak ombak
    vec3 causticCol = vec3(0.24, 0.86, 0.86);
    float causticAlpha = clamp(causticSea * 0.52 + crestGlint * 0.42, 0.0, 0.85);
    col = mix(col, causticCol + vec3(0.32, 0.40, 0.42) * crestGlint, causticAlpha);
    alpha = 1.0 - (1.0 - alpha) * (1.0 - causticAlpha);

    // Buih ombak organik putih-aqua di bibir gelombang
    vec3 foamColor = mix(vec3(0.84, 0.97, 0.98), vec3(0.99, 1.0, 1.0), smoothstep(0.20, 0.85, foamTotal));
    float foamAlpha = clamp(foamTotal * 0.95, 0.0, 0.98);
    col = mix(col, foamColor, foamAlpha);
    alpha = 1.0 - (1.0 - alpha) * (1.0 - foamAlpha);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0) * clamp(alpha, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
  }
`;

function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}

const ZERO_WAVE_MASK =
  "linear-gradient(238.7deg, rgba(0,0,0,1) -120px, rgba(0,0,0,0) -90px)";

function applyDiagonalWaveMask(el: HTMLDivElement | null, prog: number, cssW: number, cssH: number) {
  if (!el) return;
  if (prog >= 0.98) {
    el.style.maskImage = "";
    el.style.webkitMaskImage = "";
    return;
  }
  const easeP = 0.5 - 0.5 * Math.cos(Math.PI * clamp(prog, 0, 1));
  const len = Math.hypot(-0.74, 0.45);
  const dx = -0.74 / len;
  const dy = 0.45 / len;
  const pMin = Math.min(0, cssW * dx) + Math.min(0, cssH * dy);
  const pMax = Math.max(0, cssW * dx) + Math.max(0, cssH * dy);
  const frontBase = pMin - 85 + (pMax + 230 - (pMin - 85)) * easeP;
  const distFromStart = frontBase - pMin;

  const grad = `linear-gradient(238.7deg, rgba(0,0,0,1) ${(distFromStart - 22).toFixed(1)}px, rgba(0,0,0,0) ${(distFromStart + 22).toFixed(1)}px)`;
  el.style.maskImage = grad;
  el.style.webkitMaskImage = grad;
}

export function OceanWaveTransitionProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState<WaveRun>({ runId: 0, phase: "idle" });
  const [enteringFromLogin, setEnteringFromLogin] = useState(false);

  const revealElRef = useRef<HTMLDivElement | null>(null);
  const awaitingRevealRef = useRef(false);
  const pendingNavigateRef = useRef<(() => void) | null>(null);
  const pendingDoneRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef(0);
  const settleTimerRef = useRef<number | null>(null);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  const registerRevealElement = useCallback((el: HTMLDivElement | null) => {
    const prev = revealElRef.current;
    if (prev && prev !== el) {
      prev.style.maskImage = "";
      prev.style.webkitMaskImage = "";
    }
    revealElRef.current = el;
    if (el && awaitingRevealRef.current) {
      el.style.maskImage = ZERO_WAVE_MASK;
      el.style.webkitMaskImage = ZERO_WAVE_MASK;
      awaitingRevealRef.current = false;
    }
  }, []);

  const onPrepComplete = useCallback((completedRunId: number) => {
    if (completedRunId !== runIdRef.current) return;

    awaitingRevealRef.current = true;
    const navFn = pendingNavigateRef.current;
    pendingNavigateRef.current = null;
    navFn?.();

    setRun((prev) =>
      prev.runId === completedRunId ? { ...prev, phase: "wave" } : prev,
    );
  }, []);

  const onWaveComplete = useCallback((completedRunId: number) => {
    if (completedRunId !== runIdRef.current) return;

    awaitingRevealRef.current = false;
    if (revealElRef.current) {
      revealElRef.current.style.maskImage = "";
      revealElRef.current.style.webkitMaskImage = "";
    }

    setRun((prev) =>
      prev.runId === completedRunId ? { ...prev, phase: "idle" } : prev,
    );

    const doneFn = pendingDoneRef.current;
    pendingDoneRef.current = null;
    doneFn?.();
  }, []);

  const playOceanWaveTransition = useCallback<PlayOceanWaveFn>(
    (onNavigate, onDone) => {
      clearSettleTimer();
      const nextId = ++runIdRef.current;
      pendingNavigateRef.current = onNavigate;
      pendingDoneRef.current = onDone ?? null;

      setEnteringFromLogin(true);
      setRun({ runId: nextId, phase: "prep" });

      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        setEnteringFromLogin(false);
      }, OCEAN_WAVE_CONFIG.prepDurationMs + OCEAN_WAVE_CONFIG.settleDurationMs);
    },
    [clearSettleTimer],
  );

  const contextValue = useMemo<OceanWaveContextValue>(
    () => ({
      isTransitioning: run.phase !== "idle",
      enteringFromLogin,
      registerRevealElement,
      playOceanWaveTransition,
    }),
    [enteringFromLogin, playOceanWaveTransition, registerRevealElement, run.phase],
  );

  const overlayValue = useMemo(
    () => ({
      run,
      revealElRef,
      onPrepComplete,
      onWaveComplete,
    }),
    [onPrepComplete, onWaveComplete, revealElRef, run],
  );

  return (
    <OceanWaveCtx.Provider value={contextValue}>
      <OverlayRunCtx.Provider value={overlayValue}>{children}</OverlayRunCtx.Provider>
    </OceanWaveCtx.Provider>
  );
}

export function OceanWaveTransition() {
  const { run, revealElRef, onPrepComplete, onWaveComplete } = useContext(OverlayRunCtx);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<WavePhase>(run.phase);
  phaseRef.current = run.phase;

  useEffect(() => {
    if (run.phase === "idle") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });

    const compileShader = (ctx: WebGLRenderingContext, type: number, src: string) => {
      const shader = ctx.createShader(type);
      if (!shader) return null;
      ctx.shaderSource(shader, src);
      ctx.compileShader(shader);
      if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
        ctx.deleteShader(shader);
        return null;
      }
      return shader;
    };

    let prog: WebGLProgram | null = null;
    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    let buf: WebGLBuffer | null = null;

    if (gl) {
      vs = compileShader(gl, gl.VERTEX_SHADER, VS_SRC);
      fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_SRC);
      prog = vs && fs ? gl.createProgram() : null;
      if (vs && fs && prog) {
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          gl.deleteProgram(prog);
          prog = null;
        }
      }
      if (prog) {
        buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
          gl.STATIC_DRAW,
        );
      }
    }

    const posLoc = gl && prog ? gl.getAttribLocation(prog, "a_pos") : -1;
    const uStageSize = gl && prog ? gl.getUniformLocation(prog, "u_stageSize") : null;
    const uDpr = gl && prog ? gl.getUniformLocation(prog, "u_dpr") : null;
    const uProg = gl && prog ? gl.getUniformLocation(prog, "u_prog") : null;
    const uWaveTime = gl && prog ? gl.getUniformLocation(prog, "u_waveTime") : null;
    const uPrepAlpha = gl && prog ? gl.getUniformLocation(prog, "u_prepAlpha") : null;

    const ctx2d = !gl || !prog ? canvas.getContext("2d") : null;

    let rafId = 0;
    let disposed = false;
    let lastNow = performance.now();
    let prepTime = 0;
    let prepNotified = false;
    let mountWaitFrames = 0;
    let waveStarted = false;
    let waveProg = 0;
    let waveTime = 0;
    const waveDurSec = OCEAN_WAVE_CONFIG.waveDurationMs * 0.001;
    const prepDurSec = OCEAN_WAVE_CONFIG.prepDurationMs * 0.001;

    const tick = (now: number) => {
      if (disposed) return;

      const rawDt = Math.max(0.001, (now - lastNow) * 0.001);
      lastNow = now;
      const dt = Math.min(0.028, rawDt);

      const cssW = Math.max(window.innerWidth, 300);
      const cssH = Math.max(window.innerHeight, 400);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      if (!prepNotified) {
        prepTime = Math.min(prepDurSec, prepTime + dt);
        if (prepTime >= prepDurSec) {
          prepNotified = true;
          onPrepComplete(run.runId);
        }
      } else if (!waveStarted) {
        if (phaseRef.current === "wave" && revealElRef.current) {
          applyDiagonalWaveMask(revealElRef.current, 0, cssW, cssH);
          mountWaitFrames += 1;
          if (mountWaitFrames >= 2) {
            waveStarted = true;
          }
        }
      } else {
        waveProg = Math.min(1, waveProg + dt / waveDurSec);
        waveTime += dt * 0.92;
        applyDiagonalWaveMask(revealElRef.current, waveProg, cssW, cssH);
      }

      const prepAlpha = prepDurSec > 0 ? clamp(prepTime / prepDurSec, 0, 1) : 1;

      if (gl && prog && buf) {
        gl.viewport(0, 0, targetW, targetH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(uStageSize, cssW, cssH);
        gl.uniform1f(uDpr, dpr);
        gl.uniform1f(uProg, waveStarted ? waveProg : 0.0);
        gl.uniform1f(uWaveTime, waveTime);
        gl.uniform1f(uPrepAlpha, prepAlpha);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } else if (ctx2d) {
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.clearRect(0, 0, cssW, cssH);
        if (!waveStarted) {
          ctx2d.fillStyle = `rgba(4, 7, 18, ${prepAlpha.toFixed(3)})`;
          ctx2d.fillRect(0, 0, cssW, cssH);
        }
      }

      if (!waveStarted || waveProg < 1) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        onWaveComplete(run.runId);
      }
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      if (revealElRef.current) {
        revealElRef.current.style.maskImage = "";
        revealElRef.current.style.webkitMaskImage = "";
      }
      if (gl) {
        if (buf) gl.deleteBuffer(buf);
        if (prog) gl.deleteProgram(prog);
        if (vs) gl.deleteShader(vs);
        if (fs) gl.deleteShader(fs);
      }
    };
  }, [onPrepComplete, onWaveComplete, revealElRef, run.runId]);

  if (run.phase === "idle") return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden select-none"
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
