import { useEffect, useRef } from "react";

/**
 * 60fps WebGL flowing silk-wave background for the Liquid Glass sidebar & drawer,
 * styled in the app's Night Indigo, Periwinkle, Lavender, and Ice-White palette.
 */
export function SidebarSilkBg({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let disposed = false;

    const gl = canvas.getContext("webgl", { alpha: false, antialias: true });
    if (gl) {
      const vs = `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
          v_uv = a_pos * 0.5 + 0.5;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;

      const fs = `
        precision highp float;
        varying vec2 v_uv;
        uniform float u_time;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        // Smooth liquid heightfield for real-time 3D normal & specular glass refraction
        float liquidHeight(vec2 uv, float t) {
          float w1 = sin(uv.x * 4.6 + uv.y * 2.8 + t * 0.75 + 0.8 * sin(uv.y * 3.1 - t * 0.55));
          float w2 = cos(uv.y * 5.8 - uv.x * 2.4 - t * 0.65 + 0.6 * cos(uv.x * 3.4 + t * 0.45));
          float w3 = sin((uv.x + uv.y) * 3.5 + t * 0.5);

          // Curved glass bezel pinch near left/right/top/bottom edges (like reference)
          vec2 edge = abs(uv - 0.5) * 2.0; // 0 center -> 1 edge
          float bezelPinch = pow(max(edge.x, edge.y), 4.0) * 1.45;
          float rippleEdge = sin(uv.y * 9.0 + t * 0.8) * pow(edge.x, 3.0) * 0.45;

          return 0.42 * w1 + 0.32 * w2 + 0.26 * w3 + bezelPinch + rippleEdge;
        }

        void main() {
          vec2 uv = v_uv;
          float t = u_time * 0.85;

          // Compute 3D surface normal via central differences
          float eps = 0.008;
          float hC = liquidHeight(uv, t);
          float hX = liquidHeight(uv + vec2(eps, 0.0), t);
          float hY = liquidHeight(uv + vec2(0.0, eps), t);
          vec3 N = normalize(vec3((hC - hX) * 1.65, (hC - hY) * 1.65, 1.0));

          // Refracted environment lookup + Fresnel rim
          vec2 reflUV = clamp(uv + N.xy * 0.34, 0.0, 1.0);
          float fresnel = pow(1.0 - clamp(N.z, 0.0, 1.0), 1.75);

          // Combined Dusk Navy + Electric Cobalt-Indigo + Draped Lavender + Pearl Mist base
          vec3 cDeepShadow = vec3(0.032, 0.030, 0.092); // #080817
          vec3 cDuskNavy   = vec3(0.110, 0.106, 0.270); // #1c1b45
          vec3 cElectric   = vec3(0.245, 0.185, 0.920); // #3f2feb
          vec3 cSlateLav   = vec3(0.560, 0.575, 0.785); // #8f93c8
          vec3 cIceSpec    = vec3(0.950, 0.965, 1.000); // crisp liquid-glass specular white

          float diag = smoothstep(0.05, 1.0, reflUV.x * 0.55 + (1.0 - reflUV.y) * 0.55);
          vec3 base = mix(cDeepShadow, cDuskNavy, smoothstep(0.1, 0.65, diag));
          base = mix(base, cElectric, exp(-pow((reflUV.x - 0.35 + 0.15 * sin(reflUV.y * 3.0 + t)) * 2.4, 2.0)) * 0.52);
          base = mix(base, cSlateLav, smoothstep(0.45, 0.95, diag) * 0.78);

          // Glossy specular highlights (dual light sources for liquid-chrome glass folds)
          vec3 L1 = normalize(vec3(-0.65, 0.72, 0.65));
          vec3 L2 = normalize(vec3(0.75, -0.55, 0.55));
          vec3 V  = vec3(0.0, 0.0, 1.0);
          vec3 H1 = normalize(L1 + V);
          vec3 H2 = normalize(L2 + V);

          float spec1 = pow(max(dot(N, H1), 0.0), 22.0);
          float spec2 = pow(max(dot(N, H2), 0.0), 16.0);
          float darkFold = smoothstep(0.35, -0.45, dot(N.xy, vec2(0.7, -0.7)));

          // Curved outer glass bezel rim highlight (matching reference frame)
          vec2 dEdge = min(uv, 1.0 - uv);
          float borderDist = min(dEdge.x, dEdge.y);
          float bezelRim = exp(-borderDist * 55.0);
          float innerBezelShadow = exp(-abs(borderDist - 0.025) * 48.0) * 0.45;

          vec3 col = base;
          col = mix(col, cDeepShadow, darkFold * 0.58);
          col += cSlateLav * fresnel * 0.85;
          col += cIceSpec * (spec1 * 0.88 + spec2 * 0.58 + fresnel * 0.45);
          col = mix(col, cDeepShadow, innerBezelShadow);
          col += cIceSpec * bezelRim * 0.78;

          // Subtle tactile grain
          float grain = (hash(uv * 340.0 + fract(u_time * 0.12)) - 0.5) * 0.020;
          col += grain;

          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }
      `;

      const compile = (type: number, src: string) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };

      const vsShader = compile(gl.VERTEX_SHADER, vs);
      const fsShader = compile(gl.FRAGMENT_SHADER, fs);
      const prog = gl.createProgram();

      if (vsShader && fsShader && prog) {
        gl.attachShader(prog, vsShader);
        gl.attachShader(prog, fsShader);
        gl.linkProgram(prog);

        if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          gl.useProgram(prog);
          const buf = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

          const loc = gl.getAttribLocation(prog, "a_pos");
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

          const uTime = gl.getUniformLocation(prog, "u_time");
          const resize = () => {
            const parent = canvas.parentElement;
            if (!parent) return;
            const rect = parent.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            gl.viewport(0, 0, canvas.width, canvas.height);
          };

          resize();
          window.addEventListener("resize", resize);

          const start = performance.now();
          const frame = (now: number) => {
            if (disposed) return;
            gl.uniform1f(uTime, (now - start) * 0.001);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            rafId = requestAnimationFrame(frame);
          };
          rafId = requestAnimationFrame(frame);

          return () => {
            disposed = true;
            cancelAnimationFrame(rafId);
            window.removeEventListener("resize", resize);
            gl.deleteProgram(prog);
            gl.deleteShader(vsShader);
            gl.deleteShader(fsShader);
            gl.deleteBuffer(buf);
          };
        }
      }
    }

    // 2D Canvas fallback
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
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#1b1a3d");
      grad.addColorStop(0.55 + 0.1 * Math.sin(t * 0.7), "#62648f");
      grad.addColorStop(1, "#eef0f9");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      rafId = requestAnimationFrame(render2D);
    };
    rafId = requestAnimationFrame(render2D);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize2D);
    };
  }, []);

  return <canvas ref={canvasRef} className={`pointer-events-none ${className}`} aria-hidden="true" />;
}
