import { useEffect, useRef, type ReactNode } from "react";
import { motion } from "motion/react";

interface LiquidDrippingButtonProps {
  onClick: () => void;
  children: ReactNode;
}

const PAD_X = 52;
const PAD_TOP = 32;
const PAD_BOTTOM = 104;

const VS_SOURCE = `
  attribute vec2 a_pos;
  void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const FS_SOURCE = `
  precision highp float;

  uniform vec2 u_btnSize;
  uniform vec2 u_pillCenter;
  uniform float u_dpr;
  uniform float u_time;
  uniform float u_hover;
  uniform vec2 u_pointer;

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  float sdCapsule(vec2 p, vec2 a, vec2 b, float ra, float rb) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
    return length(pa - ba * h) - mix(ra, rb, h);
  }

  // Molten viscous liquid-glass capsule + traveling overflow wave + 5 deep teardrop drips
  float sceneSDF(vec2 p) {
    vec2 halfB = u_btnSize * 0.5;
    float pillR = halfB.y;
    float t = u_time;

    // Smooth traveling liquid surface tension wave along capsule rim (stronger along lower lip)
    float bottomWeight = smoothstep(halfB.y * 0.35, -halfB.y, p.y);
    float rimWave =
      (1.1 + 1.5 * bottomWeight) * sin(p.x * 0.052 - t * 2.1) * cos(p.y * 0.08 + t * 1.4) +
      0.65 * sin(p.x * 0.105 + t * 1.6);

    float d = sdRoundBox(p, halfB, pillR) + rimWave;

    // 5 lush staggered molten-glass drips spilling smoothly over the lower rim
    float baseY = -halfB.y + 4.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float xRatio = -0.35 + fi * 0.175;
      float speed = 0.165 + 0.045 * hash11(fi * 7.3 + 1.1);
      float phase = hash11(fi * 13.7 + 2.9);
      float cyc = fract(t * speed + phase);

      float maxDrop = 38.0 + 26.0 * hash11(fi * 5.1 + 4.3);
      float x0 = xRatio * u_btnSize.x + 2.6 * sin(t * 1.15 + fi * 2.1);

      // Thick pouring liquid shoulder pooling along the lower pill bezel
      float swell = sin(clamp(cyc / 0.72, 0.0, 1.0) * 3.14159);
      float meniscusR = 5.5 + 5.8 * swell;
      float dMeniscus = length(p - vec2(x0, baseY - 2.2 * swell)) - meniscusR;
      d = smin(d, dMeniscus, 13.5);

      // Phase 0 -> 0.70: viscous glass neck stretches smoothly down with plump teardrop tip
      // Phase 0.70 -> 0.88: elastic recoil back up into pill meniscus
      float grow = smoothstep(0.03, 0.70, cyc);
      float snapBack = 1.0 - smoothstep(0.70, 0.86, cyc);
      float stretchLen = maxDrop * 0.78 * pow(grow, 1.15) * snapBack;

      if (stretchLen > 0.6) {
        vec2 neckTop = vec2(x0, baseY + 1.0);
        vec2 neckTip = vec2(x0 + 1.8 * sin(cyc * 5.2 + fi), baseY - stretchLen);
        float pinch = mix(1.0, 0.30, smoothstep(0.48, 0.70, cyc));
        float dNeck = sdCapsule(p, neckTop, neckTip, 6.4, 2.5 * pinch);
        d = smin(d, dNeck, 9.5);

        // Plump glossy teardrop bulb hanging from tip until pinch-off
        float bulbScale = smoothstep(0.05, 0.38, cyc) * (1.0 - smoothstep(0.68, 0.75, cyc));
        if (bulbScale > 0.02) {
          float rBulb = (6.8 + 2.8 * hash11(fi * 3.7)) * bulbScale;
          vec2 bulbPos = neckTip + vec2(0.0, -rBulb * 0.62);
          vec2 bp = (p - bulbPos) * vec2(1.08, 0.82); // classic vertical glass teardrop
          float dBulb = length(bp) - rBulb;
          d = smin(d, dBulb, 6.5);
        }
      }

      // Phase 0.66 -> 0.99: detached plump glass marble droplet falling cleanly with gravity
      if (cyc > 0.64) {
        float fallT = clamp((cyc - 0.66) / 0.33, 0.0, 1.0);
        float startY = baseY - maxDrop * 0.78 - 5.0;
        float fallDist = 28.0 * fallT * fallT;
        float fadeOut = 1.0 - smoothstep(0.65, 1.0, fallT);
        float rDrop = (5.8 + 2.4 * hash11(fi * 9.1)) * smoothstep(0.0, 0.08, fallT) * fadeOut;
        if (rDrop > 0.3) {
          vec2 dropPos = vec2(x0 + 1.8 * sin(0.70 * 5.2 + fi), startY - fallDist);
          vec2 dp = (p - dropPos) * vec2(1.06, 0.86);
          float dDrop = length(dp) - rDrop;
          d = smin(d, dDrop, 2.5 * (1.0 - smoothstep(0.66, 0.74, cyc)));
        }
      }
    }

    // Smooth undulating overflow droplets clinging between main tendrils
    for (int j = 0; j < 4; j++) {
      float fj = float(j);
      float bx = (-0.26 + fj * 0.175) * u_btnSize.x;
      float pulse = 0.5 + 0.5 * sin(t * 1.9 + fj * 2.1);
      float br = 3.8 + 2.2 * pulse;
      float by = baseY - 2.5 - 4.5 * pulse;
      d = smin(d, length(p - vec2(bx, by)) - br, 7.5);
    }

    return d;
  }

  float heightAt(vec2 p, float d) {
    float tBevel = clamp(-d / 16.0, 0.0, 1.0);
    float dome = sqrt(max(0.0, 1.0 - (1.0 - tBevel) * (1.0 - tBevel)));
    float t = u_time;
    float ripple =
      0.055 * sin(p.x * 0.048 - t * 2.1 + sin(p.y * 0.065 + t * 1.35)) +
      0.036 * cos(p.y * 0.078 - t * 1.65 + p.x * 0.034);
    return dome * 14.5 + ripple * 11.5 * smoothstep(0.0, 0.35, tBevel);
  }

  // Luminous translucent glass environment matched to AuroraOrb + clear crystal reflections
  vec3 sampleEnvironment(vec2 uv, float t) {
    float wave1 = sin(uv.x * 2.5 - t * 1.15 + cos(uv.y * 2.1 + t * 0.85));
    float wave2 = cos(uv.y * 2.9 + t * 0.95 - sin(uv.x * 1.75 - t * 0.75));
    float caustic = pow(clamp(0.5 + 0.5 * sin((uv.x + uv.y) * 3.6 - t * 1.55 + wave1 * 1.5), 0.0, 1.0), 2.2);

    vec3 cIndigo     = vec3(0.045, 0.055, 0.165);
    vec3 cSapphire   = vec3(0.140, 0.350, 0.760);
    vec3 cSkyBlue    = vec3(0.450, 0.760, 1.000);
    vec3 cAquaMint   = vec3(0.235, 0.769, 0.682);
    vec3 cPeriwinkle = vec3(0.520, 0.560, 0.980);

    vec3 col = mix(cIndigo, cSapphire, smoothstep(-0.7, 0.65, wave1));
    col = mix(col, cAquaMint, 0.55 * smoothstep(-0.2, 0.85, wave2));
    col = mix(col, cPeriwinkle, 0.42 * smoothstep(0.1, 0.9, -wave1 * wave2));
    col += cSkyBlue * caustic * 0.58;

    // Bright upper & lower studio glass reflection ribbons
    float topRibbon = exp(-pow((uv.y - 0.52 + 0.22 * wave1) * 3.0, 2.0));
    float botRibbon = exp(-pow((uv.y + 0.62 - 0.18 * wave2) * 3.6, 2.0));
    col += vec3(0.92, 0.97, 1.0) * (topRibbon * 0.55 + botRibbon * 0.36);

    return col;
  }

  void main() {
    vec2 fragCss = gl_FragCoord.xy / max(u_dpr, 1.0);
    vec2 p = fragCss - u_pillCenter;

    float d = sceneSDF(p);
    float aa = 1.65;
    float inside = smoothstep(aa, -aa * 0.85, d);

    float shadowD = sceneSDF(p + vec2(0.0, 6.0));
    float shadowAlpha = smoothstep(14.0, -3.0, shadowD) * 0.22 * (1.0 - inside);

    if (inside < 0.002 && shadowAlpha < 0.002) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float eps = 1.25;
    float dL = sceneSDF(p - vec2(eps, 0.0));
    float dR = sceneSDF(p + vec2(eps, 0.0));
    float dD = sceneSDF(p - vec2(0.0, eps));
    float dU = sceneSDF(p + vec2(0.0, eps));

    float hx = heightAt(p + vec2(eps, 0.0), dR) - heightAt(p - vec2(eps, 0.0), dL);
    float hy = heightAt(p + vec2(0.0, eps), dU) - heightAt(p - vec2(0.0, eps), dD);
    vec3 N = normalize(vec3(-hx, -hy, 2.65 * eps));
    vec3 V = vec3(0.0, 0.0, 1.0);

    // Chromatic Snell refraction across curved glass body & dripping tendrils
    vec2 envUV = p * 0.011 + N.xy * 0.78;
    float edgeSlope = 1.0 - max(N.z, 0.0);
    float disp = 0.075 * edgeSlope + 0.016;
    float cr = sampleEnvironment(envUV + N.xy * disp, u_time).r;
    float cg = sampleEnvironment(envUV, u_time).g;
    float cb = sampleEnvironment(envUV - N.xy * disp, u_time).b;
    vec3 glassColor = vec3(cr, cg, cb);

    // Soft volumetric depth contour (no hard outer border stroke)
    float edgeTaper = smoothstep(0.5, -3.5, d);
    float tirBand = smoothstep(0.24, 0.56, edgeSlope) * (1.0 - smoothstep(0.66, 0.90, edgeSlope)) * edgeTaper;
    glassColor = mix(glassColor, vec3(0.02, 0.035, 0.10), tirBand * 0.36);

    // Crisp multi-light specular highlights for wet molten-glass sheen
    vec3 L1 = normalize(vec3(-0.46, 0.76, 0.62));
    vec3 L2 = normalize(vec3(0.56, -0.66, 0.52));
    vec3 H1 = normalize(L1 + V);
    vec3 H2 = normalize(L2 + V);

    float specSharp1 = pow(max(dot(N, H1), 0.0), 105.0);
    float specSoft1  = pow(max(dot(N, H1), 0.0), 16.0);
    float specSharp2 = pow(max(dot(N, H2), 0.0), 68.0);

    // Subtle natural Fresnel curve fading softly at the extreme outer pixel so no border appears
    vec3 prism = 0.5 + 0.5 * cos(6.2831 * (N.x * 0.42 + N.y * 0.30 + vec3(0.02, 0.14, 0.30) + u_time * 0.06));
    float fresnel = pow(edgeSlope, 2.8) * edgeTaper;

    glassColor += vec3(0.96, 0.99, 1.0) * (specSharp1 * 1.25 + specSoft1 * 0.24);
    glassColor += vec3(0.66, 0.94, 1.0) * specSharp2 * 0.85;
    glassColor += mix(vec3(0.85, 0.94, 1.0), prism, 0.38) * fresnel * 0.52;

    // Trapped clear spherical glass micro-bubbles drifting inside the fluid
    if (d < -3.0) {
      for (int b = 0; b < 6; b++) {
        float fb = float(b);
        vec2 bCenter = vec2(
          (-0.34 + fb * 0.135) * u_btnSize.x + 14.0 * sin(u_time * 0.58 + fb * 1.9),
          9.0 * cos(u_time * 0.78 + fb * 2.3) - 2.0
        );
        float br = 2.1 + 1.5 * hash11(fb * 4.7);
        vec2 bp = p - bCenter;
        float bd = length(bp);
        if (bd < br + 1.3) {
          float bRing = smoothstep(1.1, 0.0, abs(bd - br));
          float bDark = smoothstep(br, 0.0, length(bp - vec2(0.0, -0.45 * br))) * 0.35;
          float bGlint = smoothstep(br * 0.45, 0.0, length(bp - vec2(-0.35 * br, 0.35 * br)));
          glassColor = mix(glassColor, vec3(0.015, 0.025, 0.08), bDark);
          glassColor += vec3(0.94, 0.98, 1.0) * (bRing * 0.52 + bGlint * 0.92);
        }
      }
    }

    // Translucent glass center for effortless reading, gleaming high-contrast wet drops
    float dripMask = smoothstep(-u_btnSize.y * 0.34, -u_btnSize.y * 0.50, p.y);
    float bodyAlpha = mix(0.42, 0.84, fresnel + tirBand * 0.35 + specSharp1 * 0.75);
    bodyAlpha = mix(bodyAlpha, 0.92, dripMask * 0.68);
    bodyAlpha *= inside;

    vec3 outCol = mix(vec3(0.01, 0.02, 0.07), glassColor, inside);
    float outAlpha = clamp(bodyAlpha + shadowAlpha, 0.0, 1.0);

    gl_FragColor = vec4(outCol * outAlpha, outAlpha);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

/**
 * Interactive 60fps WebGL Optical Liquid Glass CTA button with unified SDF
 * metaball surface tension, swirling caustic refraction, TIR rims, trapped
 * micro-bubbles, and continuous molten-glass spilling/dripping tendrils.
 */
export function LiquidDrippingButton({ onClick, children }: LiquidDrippingButtonProps) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerState = useRef({ hover: 0, targetHover: 0, x: 0, y: 0 });

  useEffect(() => {
    const btn = btnRef.current;
    const canvas = canvasRef.current;
    if (!btn || !canvas) return;

    let rafId = 0;
    let disposed = false;
    let btnW = btn.offsetWidth || 220;
    let btnH = btn.offsetHeight || 50;
    let drawImmediate: ((now: number) => void) | null = null;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });

    const syncSize = () => {
      btnW = btn.offsetWidth || 220;
      btnH = btn.offsetHeight || 50;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = btnW + PAD_X * 2;
      const cssH = btnH + PAD_TOP + PAD_BOTTOM;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      if (gl) {
        gl.viewport(0, 0, targetW, targetH);
      }
      drawImmediate?.(performance.now());
    };

    const ro = new ResizeObserver(syncSize);
    ro.observe(btn);

    if (gl) {
      const vs = compileShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_SOURCE);
      if (vs && fs) {
        const prog = gl.createProgram();
        if (prog) {
          gl.attachShader(prog, vs);
          gl.attachShader(prog, fs);
          gl.linkProgram(prog);

          if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(
              gl.ARRAY_BUFFER,
              new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
              gl.STATIC_DRAW
            );

            const posLoc = gl.getAttribLocation(prog, "a_pos");
            const uBtnSize = gl.getUniformLocation(prog, "u_btnSize");
            const uPillCenter = gl.getUniformLocation(prog, "u_pillCenter");
            const uDpr = gl.getUniformLocation(prog, "u_dpr");
            const uTime = gl.getUniformLocation(prog, "u_time");
            const uHover = gl.getUniformLocation(prog, "u_hover");
            const uPointer = gl.getUniformLocation(prog, "u_pointer");

            // Offset start slightly so prominent tendrils are visibly hanging right on load
            const start = performance.now() - 2400;

            const drawFrame = (now: number) => {
              const ps = pointerState.current;
              ps.hover += (ps.targetHover - ps.hover) * 0.12;

              const dpr = Math.min(window.devicePixelRatio || 1, 2);
              gl.clearColor(0, 0, 0, 0);
              gl.clear(gl.COLOR_BUFFER_BIT);
              gl.useProgram(prog);
              gl.bindBuffer(gl.ARRAY_BUFFER, buf);
              gl.enableVertexAttribArray(posLoc);
              gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

              gl.uniform2f(uBtnSize, btnW, btnH);
              gl.uniform2f(uPillCenter, PAD_X + btnW * 0.5, PAD_BOTTOM + btnH * 0.5);
              gl.uniform1f(uDpr, dpr);
              gl.uniform1f(uTime, (now - start) * 0.001);
              gl.uniform1f(uHover, ps.hover);
              gl.uniform2f(uPointer, ps.x, ps.y);

              gl.drawArrays(gl.TRIANGLES, 0, 6);
            };

            drawImmediate = drawFrame;
            syncSize();

            const tick = (now: number) => {
              if (disposed) return;
              drawFrame(now);
              rafId = requestAnimationFrame(tick);
            };
            rafId = requestAnimationFrame(tick);

            return () => {
              disposed = true;
              cancelAnimationFrame(rafId);
              ro.disconnect();
              gl.deleteBuffer(buf);
              gl.deleteProgram(prog);
              gl.deleteShader(vs);
              gl.deleteShader(fs);
            };
          }
          gl.deleteProgram(prog);
        }
        gl.deleteShader(fs);
      }
      if (vs) gl.deleteShader(vs);
    }

    // 2D Canvas fallback when WebGL is unavailable
    const ctx = canvas.getContext("2d");
    const start = performance.now() - 1200;
    const draw2d = (now: number) => {
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = btnW + PAD_X * 2;
      const cssH = btnH + PAD_TOP + PAD_BOTTOM;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const t = (now - start) * 0.001;
      const r = btnH * 0.5;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(PAD_X, PAD_TOP, btnW, btnH, r);
      const grad = ctx.createLinearGradient(PAD_X, PAD_TOP, PAD_X + btnW, PAD_TOP + btnH);
      grad.addColorStop(0, "rgba(125,211,252,0.28)");
      grad.addColorStop(0.5, "rgba(60,196,174,0.20)");
      grad.addColorStop(1, "rgba(124,131,247,0.32)");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.stroke();

      for (let i = 0; i < 4; i++) {
        const cyc = (t * 0.25 + i * 0.25) % 1;
        const dx = PAD_X + btnW * (0.22 + i * 0.19);
        const dropLen = 14 + 34 * Math.sin(cyc * Math.PI);
        const by = PAD_TOP + btnH;
        ctx.beginPath();
        ctx.moveTo(dx - 7, by - 1);
        ctx.quadraticCurveTo(dx - 2, by + dropLen * 0.65, dx, by + dropLen);
        ctx.quadraticCurveTo(dx + 2, by + dropLen * 0.65, dx + 7, by - 1);
        ctx.fillStyle = "rgba(186,230,253,0.45)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
      ctx.restore();
    };

    drawImmediate = draw2d;
    syncSize();

    const tick2d = (now: number) => {
      if (disposed) return;
      draw2d(now);
      rafId = requestAnimationFrame(tick2d);
    };
    rafId = requestAnimationFrame(tick2d);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  const updatePointer = (clientX: number, clientY: number) => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    pointerState.current.x = clientX - rect.left - rect.width * 0.5;
    pointerState.current.y = rect.height * 0.5 - (clientY - rect.top);
  };

  return (
    <div className="relative inline-flex items-center justify-center pb-16 pt-1">
      <motion.button
        ref={btnRef}
        type="button"
        onClick={onClick}
        onPointerEnter={(e) => {
          pointerState.current.targetHover = 1;
          updatePointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => updatePointer(e.clientX, e.clientY)}
        onPointerLeave={() => {
          pointerState.current.targetHover = 0;
        }}
        whileHover={{ y: -1.5, scale: 1.015 }}
        whileTap={{ y: 1, scale: 0.975 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="relative inline-flex cursor-pointer items-center gap-2.5 rounded-full border-0 bg-transparent px-8 py-3.5 font-display text-sm font-semibold text-white outline-none sm:text-[15px]"
      >
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute max-w-none"
          style={{ left: `-${PAD_X}px`, top: `-${PAD_TOP}px` }}
        />
        <span className="relative z-10 flex items-center gap-2.5 drop-shadow-[0_1px_10px_rgba(3,5,18,0.88)]">
          {children}
        </span>
      </motion.button>
    </div>
  );
}
