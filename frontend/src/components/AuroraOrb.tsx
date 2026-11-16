import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useSpring } from "motion/react";

/**
 * Full-bleed 60fps WebGL Liquid Glass sphere with molten wave refraction,
 * chromatic meniscus bevel, and spring-driven Motion pointer/tap physics.
 * Automatically falls back to a crisp zero-blur 2D Canvas renderer if WebGL is unavailable.
 */
export function AuroraOrb({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const pointerXRaw = useMotionValue(0);
  const pointerYRaw = useMotionValue(0);
  const pointerX = useSpring(pointerXRaw, { stiffness: 76, damping: 16, mass: 0.9 });
  const pointerY = useSpring(pointerYRaw, { stiffness: 76, damping: 16, mass: 0.9 });
  const wakeX = useSpring(pointerXRaw, { stiffness: 28, damping: 11, mass: 1.4 });
  const wakeY = useSpring(pointerYRaw, { stiffness: 28, damping: 11, mass: 1.4 });

  const enterMV = useMotionValue(0.86);
  const ripplesRef = useRef<{ x: number; y: number; startMs: number; amp: number }[]>([
    { x: 0, y: 0, startMs: -10000, amp: 0 },
    { x: 0, y: 0, startMs: -10000, amp: 0 },
    { x: 0, y: 0, startMs: -10000, amp: 0 },
  ]);
  const nextRippleIdxRef = useRef(0);

  useEffect(() => {
    const ctrl = animate(enterMV, 1, {
      type: "spring",
      stiffness: 64,
      damping: 13,
      mass: 1.15,
    });
    return () => ctrl.stop();
  }, [enterMV]);

  useEffect(() => {
    const toAspectCoords = (clientX: number, clientY: number) => {
      const w = Math.max(window.innerWidth, 1);
      const h = Math.max(window.innerHeight, 1);
      const aspectX = w / h;
      return {
        nx: (clientX / w - 0.5) * 2.0,
        ny: (0.5 - clientY / h) * 2.0,
        ax: (clientX / w - 0.5) * aspectX,
        ay: 0.5 - clientY / h,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const { nx, ny } = toAspectCoords(e.clientX, e.clientY);
      pointerXRaw.set(Math.max(-1, Math.min(1, nx)));
      pointerYRaw.set(Math.max(-1, Math.min(1, ny)));
    };

    const onPointerDown = (e: PointerEvent) => {
      const { nx, ny, ax, ay } = toAspectCoords(e.clientX, e.clientY);
      pointerXRaw.set(Math.max(-1, Math.min(1, nx)));
      pointerYRaw.set(Math.max(-1, Math.min(1, ny)));
      const idx = nextRippleIdxRef.current % 3;
      nextRippleIdxRef.current = idx + 1;
      const slot = ripplesRef.current[idx];
      slot.x = ax;
      slot.y = ay;
      slot.startMs = performance.now();
      slot.amp = 1.0;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [pointerXRaw, pointerYRaw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let disposed = false;

    const gl = canvas.getContext("webgl", { alpha: false, antialias: true });
    if (gl) {
      const vsSource = `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
          v_uv = a_pos * 0.5 + 0.5;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;

      const fsSource = `
        precision highp float;
        varying vec2 v_uv;
        uniform vec2 u_res;
        uniform float u_time;
        uniform vec2 u_pointer;
        uniform vec2 u_wake;
        uniform float u_enter;
        uniform vec4 u_ripples[3];

        float evalOrbRipples(vec2 uv) {
          float sum = 0.0;
          for (int i = 0; i < 3; i++) {
            vec4 rp = u_ripples[i];
            float age = rp.z;
            if (age >= 0.0 && age < 2.2) {
              float dist = length(uv - rp.xy);
              float front = 1.05 * (1.0 - exp(-age * 1.45));
              float delta = dist - front;
              float band = mix(0.065, 0.135, min(age / 1.5, 1.0));
              float onset = smoothstep(0.0, 0.085, age);
              float decay = exp(-age * 1.65) * exp(-dist * 1.15);
              sum += onset * decay * rp.w * exp(-pow(delta / band, 2.0)) * sin(delta * 44.0);
            }
          }
          return sum;
        }

        // Smooth organic molten-wave field inside the sphere (clear liquid chrome + aurora silk)
        float moltenWaveField(vec2 p, float t) {
          vec2 vel = u_pointer - u_wake;
          vec2 q = vec2(
            sin(p.x * 2.5 + p.y * 1.4 - t * 0.72 + vel.x * 0.55),
            cos(p.y * 2.8 - p.x * 1.6 + t * 0.64 + vel.y * 0.55)
          );
          vec2 r = p + q * 0.24 + vel * 0.12;
          float f1 = sin(r.x * 3.8 + sin(r.y * 3.1 - t * 0.92) + t * 0.68);
          float f2 = cos(r.y * 4.4 - cos(r.x * 2.9 + t * 0.76) - t * 0.58);
          float f3 = sin((r.x - r.y) * 5.2 + t * 1.05);
          return (f1 * 0.46 + f2 * 0.36 + f3 * 0.18);
        }

        // Height surface: 3D spherical lens dome + sharp optical meniscus bezel + flowing liquid ripples
        float liquidSurfaceHeight(vec2 pn, float rNorm, float t, float rippleTerm) {
          float clampedR = min(rNorm, 0.998);
          float sphereDome = sqrt(max(0.0, 1.0 - clampedR * clampedR));

          // Prominent Liquid Glass curved bezel near the perimeter (0.74 -> 0.99)
          float bevel = smoothstep(0.72, 0.985, clampedR);
          float meniscusLip = sin(bevel * 3.14159) * 0.165;

          // Flowing fluid wave relief inside the body
          float wave = moltenWaveField(pn * 1.12 + u_pointer * 0.16, t);
          float waveDetail = wave * 0.082 * smoothstep(0.99, 0.28, clampedR);

          return sphereDome * 0.74 + meniscusLip + waveDetail + rippleTerm * 0.06;
        }

        // Crisp high-contrast internal refraction environment (molten silver-chrome + Night Indigo + Aqua-Mint + Periwinkle)
        vec3 sampleGlassInterior(vec2 uv, float rNorm, float edgeSlope, float t) {
          float f = moltenWaveField(uv * 1.25, t);
          float ridge1 = pow(clamp(1.0 - abs(f), 0.0, 1.0), 4.2);
          float ridge2 = pow(clamp(1.0 - abs(moltenWaveField(uv * 1.85 + vec2(0.7, -0.4), t * 0.92)), 0.0, 1.0), 5.6);

          vec3 cObsidian   = vec3(0.012, 0.012, 0.036);
          vec3 cIndigo     = vec3(0.045, 0.055, 0.165);
          vec3 cSteel      = vec3(0.165, 0.215, 0.345);
          vec3 cSilver     = vec3(0.840, 0.910, 0.980);
          vec3 cAquaMint   = vec3(0.235, 0.769, 0.682);
          vec3 cSkyIce     = vec3(0.550, 0.800, 1.000);
          vec3 cPeriwinkle = vec3(0.486, 0.514, 0.969);

          // Rich dark obsidian base in troughs with crisp liquid chrome folds
          float troughMask = smoothstep(-0.75, 0.55, f);
          vec3 base = mix(cObsidian, cIndigo, troughMask * 0.82);
          base = mix(base, cSteel, ridge1 * 0.45);

          // Silk molten metallic ribbons shifted smoothly by color phase
          float colorMix = 0.5 + 0.5 * sin(uv.x * 2.2 - uv.y * 1.6 + t * 0.75);
          vec3 tintRibbon = mix(cAquaMint, cPeriwinkle, colorMix);
          tintRibbon = mix(tintRibbon, cSkyIce, smoothstep(-0.4, 0.8, -uv.x));

          // Sharp glossy chrome & aqua highlights along liquid folds (zero muddy blur)
          base += mix(cSilver, tintRibbon, 0.48) * ridge1 * 0.52;
          base += cSilver * ridge2 * 0.68;

          // Curved outer lens magnification brightens & saturates rim caustics
          base += tintRibbon * smoothstep(0.65, 0.98, rNorm) * 0.30;
          base += cSkyIce * pow(edgeSlope, 2.2) * 0.24;

          return base;
        }

        void main() {
          vec2 aspect = vec2(u_res.x / max(u_res.y, 1.0), 1.0);
          vec2 uv = (v_uv - 0.5) * aspect;
          float t = u_time;

          // Subtle Motion pointer + fluid velocity sway (restrained so orb stays anchored cleanly)
          vec2 vel = u_pointer - u_wake;
          vec2 center = vec2(
            0.015 * sin(t * 0.55) + u_wake.x * 0.032 + vel.x * 0.018,
            -0.44 + 0.016 * sin(t * 0.82) - u_wake.y * 0.025 - vel.y * 0.014
          );

          float baseR = (0.68 + 0.012 * sin(t * 1.0)) * u_enter;
          vec2 p = uv - center;
          float rawDist = length(p);
          float angle = atan(p.y, p.x);

          // Organic Liquid Glass meniscus surface tension contour + viscous momentum stretch
          float velContour = dot(vec2(cos(angle), sin(angle)), vel) * 0.014;
          float contourWave =
            0.011 * sin(angle * 3.0 - t * 1.25 + u_pointer.x * 1.2) +
            0.006 * cos(angle * 5.0 + t * 1.55 - u_pointer.y * 1.1) +
            0.0035 * sin(angle * 7.0 - t * 0.9) +
            velContour;

          float rippleWave = evalOrbRipples(uv);

          float R = baseR * (1.0 + contourWave + rippleWave * 0.022);
          float d = rawDist;
          vec2 pn = p / max(R, 0.001);
          float rNorm = length(pn);

          // Crisp obsidian Night Indigo backdrop (#03020a -> #0c0b22)
          vec3 bg = mix(
            vec3(0.012, 0.010, 0.036),
            vec3(0.048, 0.044, 0.135),
            smoothstep(0.88, -0.35, v_uv.y)
          );

          // Anti-aliased crystal-sharp orb contour (minimal blur)
          float px = 1.6 / max(u_res.y, 1.0);
          float inside = smoothstep(R + px * 1.7, R - px * 1.7, d);

          // Tight optical rim aura hugging the glass perimeter (no broad hazy fog)
          float outerDist = max(d - R, 0.0);
          float topMask = smoothstep(-0.22, 0.92, pn.y);
          vec3 cAquaMint   = vec3(0.235, 0.769, 0.682);
          vec3 cSkyIce     = vec3(0.560, 0.820, 1.000);
          vec3 cPeriwinkle = vec3(0.486, 0.514, 0.969);
          vec3 cSilver     = vec3(0.920, 0.965, 1.000);

          float rimSlide = 0.45 * sin(t * 0.95 + pn.y * 1.8) + 0.25 * cos(angle * 2.0 - t * 1.2);
          vec3 rimTint = mix(cSkyIce, cAquaMint, smoothstep(-0.55, 0.2, pn.x + rimSlide));
          rimTint = mix(rimTint, cPeriwinkle, smoothstep(0.1, 0.72, pn.x + rimSlide));

          float tightHalo = exp(-outerDist * 30.0) * 0.52 + exp(-outerDist * 13.0) * 0.15;
          bg += rimTint * tightHalo * (0.35 + 0.65 * topMask);

          vec3 col = bg;

          if (inside > 0.001) {
            // Finite-difference optical normal from 3D dome + curved meniscus + molten wave relief
            float eps = 0.009;
            vec2 pnL = pn - vec2(eps, 0.0);
            vec2 pnR = pn + vec2(eps, 0.0);
            vec2 pnD = pn - vec2(0.0, eps);
            vec2 pnU = pn + vec2(0.0, eps);

            float hL = liquidSurfaceHeight(pnL, length(pnL), t, rippleWave);
            float hR = liquidSurfaceHeight(pnR, length(pnR), t, rippleWave);
            float hD = liquidSurfaceHeight(pnD, length(pnD), t, rippleWave);
            float hU = liquidSurfaceHeight(pnU, length(pnU), t, rippleWave);

            vec3 N = normalize(vec3((hL - hR) / (2.0 * eps), (hD - hU) / (2.0 * eps), 1.35));
            vec3 V = vec3(0.0, 0.0, 1.0);
            float edgeSlope = 1.0 - max(N.z, 0.0);

            // Chromatic Snell refraction across curved glass body & meniscus
            float refractAmt = mix(0.24, 0.62, smoothstep(0.55, 0.98, rNorm));
            vec2 envBase = pn + N.xy * refractAmt;
            float disp = 0.014 + 0.068 * edgeSlope;

            float chR = sampleGlassInterior(envBase + N.xy * disp, rNorm, edgeSlope, t).r;
            float chG = sampleGlassInterior(envBase, rNorm, edgeSlope, t).g;
            float chB = sampleGlassInterior(envBase - N.xy * disp, rNorm, edgeSlope, t).b;
            vec3 glassCol = vec3(chR, chG, chB);

            // Signature Liquid Glass Total-Internal-Reflection dark optical ring inside perimeter
            float tirCrease =
              smoothstep(0.77, 0.875, rNorm) *
              (1.0 - smoothstep(0.915, 0.988, rNorm));
            glassCol = mix(glassCol, vec3(0.008, 0.010, 0.032), tirCrease * 0.72);

            // Dual studio lights steered subtly by Motion pointer
            vec3 L1 = normalize(vec3(-0.34 + u_pointer.x * 0.42, 0.82 - u_pointer.y * 0.30, 0.54));
            vec3 L2 = normalize(vec3(0.52 - u_pointer.x * 0.28, 0.36 + u_pointer.y * 0.24, 0.48));
            vec3 H1 = normalize(L1 + V);
            vec3 H2 = normalize(L2 + V);

            float specSharp1 = pow(max(dot(N, H1), 0.0), 145.0);
            float specGloss1 = pow(max(dot(N, H1), 0.0), 28.0);
            float specSharp2 = pow(max(dot(N, H2), 0.0), 96.0);

            // Crisp curved specular arc hugging the outer optical glass edge
            float meniscusArc = exp(-pow((rNorm - 0.972) / 0.019, 2.0));
            float arcSweep = 0.45 + 0.55 * smoothstep(-0.25, 0.85, pn.y + 0.2 * sin(angle * 2.0 - t * 1.1));
            float fresnel = pow(edgeSlope, 2.6) * smoothstep(1.0, 0.96, rNorm);

            // Preserve headline legibility in upper-center zone while letting molten ridges gleam
            float centerDim = smoothstep(0.05, 0.72, length(pn - vec2(0.0, 0.42)));
            glassCol *= mix(0.66, 1.0, centerDim);

            // Composite crisp wet glass reflections + prismatic rim caustics
            glassCol += cSilver * (specSharp1 * 1.15 + specGloss1 * 0.24);
            glassCol += mix(cSkyIce, cAquaMint, 0.5) * specSharp2 * 0.78;
            glassCol += mix(cSilver, rimTint, 0.42) * meniscusArc * arcSweep * 0.95;
            glassCol += rimTint * fresnel * (0.28 + 0.55 * topMask);

            // Subtle interactive ripple highlight ring when tapped/clicked
            glassCol += cSilver * max(rippleWave, 0.0) * 0.42;

            // Gentle crisp inner edge darkening for glass thickness depth
            float edgeDepth = smoothstep(0.95, 1.0, rNorm);
            glassCol = mix(glassCol, rimTint * 0.85 + vec3(0.25), edgeDepth * 0.38);

            col = mix(col, glassCol, inside);
          }

          // Clean highlight roll-off keeping contrast sharp and silver-glass clear
          col = col / (0.88 + col * 0.26);
          gl_FragColor = vec4(col, 1.0);
        }
      `;

      const compile = (type: number, src: string) => {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          gl.deleteShader(shader);
          return null;
        }
        return shader;
      };

      const vs = compile(gl.VERTEX_SHADER, vsSource);
      const fs = compile(gl.FRAGMENT_SHADER, fsSource);
      const prog = gl.createProgram();

      if (vs && fs && prog) {
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          gl.useProgram(prog);
          const buf = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

          const locPos = gl.getAttribLocation(prog, "a_pos");
          gl.enableVertexAttribArray(locPos);
          gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

          const locRes = gl.getUniformLocation(prog, "u_res");
          const locTime = gl.getUniformLocation(prog, "u_time");
          const locPointer = gl.getUniformLocation(prog, "u_pointer");
          const locWake = gl.getUniformLocation(prog, "u_wake");
          const locEnter = gl.getUniformLocation(prog, "u_enter");
          const locRipples = gl.getUniformLocation(prog, "u_ripples");
          const rippleArr = new Float32Array(12);

          const resize = () => {
            const parent = canvas.parentElement;
            if (!parent) return;
            const rect = parent.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(locRes, canvas.width, canvas.height);
          };

          resize();
          window.addEventListener("resize", resize);

          const start = performance.now();
          const renderFrame = (now: number) => {
            if (disposed) return;
            const t = (now - start) * 0.001;
            const ripples = ripplesRef.current;
            for (let i = 0; i < 3; i++) {
              const rp = ripples[i];
              const ageSec = rp.amp > 0 ? (now - rp.startMs) * 0.001 : -1;
              rippleArr[i * 4 + 0] = rp.x;
              rippleArr[i * 4 + 1] = rp.y;
              rippleArr[i * 4 + 2] = ageSec >= 0 && ageSec < 2.2 ? ageSec : -1;
              rippleArr[i * 4 + 3] = rp.amp;
            }
            gl.uniform1f(locTime, t);
            gl.uniform2f(locPointer, pointerX.get(), pointerY.get());
            gl.uniform2f(locWake, wakeX.get(), wakeY.get());
            gl.uniform1f(locEnter, enterMV.get());
            gl.uniform4fv(locRipples, rippleArr);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            rafId = requestAnimationFrame(renderFrame);
          };
          rafId = requestAnimationFrame(renderFrame);

          return () => {
            disposed = true;
            cancelAnimationFrame(rafId);
            window.removeEventListener("resize", resize);
            gl.deleteProgram(prog);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            gl.deleteBuffer(buf);
          };
        }
      }
    }

    // Crisp zero-blur 2D Canvas Liquid Glass fallback when WebGL is unavailable
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 0;
    let h = 0;

    const resize2D = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize2D();
    window.addEventListener("resize", resize2D);

    const start = performance.now();
    const render2D = (now: number) => {
      if (disposed) return;
      const t = (now - start) * 0.001;
      const px = pointerX.get();
      const py = pointerY.get();
      const scale = enterMV.get();

      ctx.fillStyle = "#04030e";
      ctx.fillRect(0, 0, w, h);

      const cx = w * 0.5 + px * 18 + Math.sin(t * 0.6) * 6;
      const cy = h * 0.94 - py * 14 + Math.sin(t * 0.85) * 6;
      const R = Math.min(w, h) * 0.66 * scale;

      // Tight optical rim halo without broad fog blur
      const halo = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.12);
      halo.addColorStop(0, "rgba(134, 216, 255, 0.32)");
      halo.addColorStop(0.55, "rgba(60, 196, 174, 0.14)");
      halo.addColorStop(1, "rgba(4, 3, 14, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();

      // Deep smoked-glass body gradient
      const bodyGrad = ctx.createRadialGradient(
        cx - R * 0.25 + px * 24,
        cy - R * 0.45 - py * 18,
        R * 0.12,
        cx,
        cy,
        R,
      );
      bodyGrad.addColorStop(0, "#121536");
      bodyGrad.addColorStop(0.72, "#060616");
      bodyGrad.addColorStop(0.88, "#020208");
      bodyGrad.addColorStop(1, "#3CC4AE");
      ctx.fillStyle = bodyGrad;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      // Crisp molten silver/aqua ribbons inside sphere
      for (let i = 0; i < 3; i++) {
        const phase = i * 1.15;
        ctx.strokeStyle =
          i === 0
            ? "rgba(226, 242, 255, 0.34)"
            : i === 1
              ? "rgba(60, 196, 174, 0.28)"
              : "rgba(124, 131, 247, 0.24)";
        ctx.lineWidth = R * (0.045 - i * 0.008);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx - R * 0.65, cy - R * (0.15 - i * 0.12));
        ctx.bezierCurveTo(
          cx - R * 0.22 + Math.sin(t * 0.9 + phase) * 28,
          cy - R * (0.68 - i * 0.08),
          cx + R * 0.22 + Math.cos(t * 0.8 + phase) * 28,
          cy - R * (0.28 + i * 0.1),
          cx + R * 0.65,
          cy - R * (0.58 - i * 0.14),
        );
        ctx.stroke();
      }

      // Razor-crisp optical glass meniscus arc
      const rimGrad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
      rimGrad.addColorStop(0, "rgba(186, 230, 253, 0.95)");
      rimGrad.addColorStop(0.5 + 0.12 * Math.sin(t), "rgba(60, 196, 174, 0.9)");
      rimGrad.addColorStop(1, "rgba(165, 180, 252, 0.92)");
      ctx.strokeStyle = rimGrad;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy, R - 3, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      rafId = requestAnimationFrame(render2D);
    };
    rafId = requestAnimationFrame(render2D);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize2D);
    };
  }, [enterMV, pointerX, pointerY, wakeX, wakeY]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className={`pointer-events-none ${className}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </motion.div>
  );
}
