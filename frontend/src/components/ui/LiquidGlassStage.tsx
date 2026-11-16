import { useEffect, useRef } from "react";
import { useMotionValue, useSpring } from "motion/react";
import { WAVE_SYNC_SELECTOR, applyDomThemeZones, useTheme } from "@/state/theme";

const VS_SRC = `
  attribute vec2 a_pos;
  void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const MAX_RECTS = 32;
const MAX_RIPPLES = 3;

const FS_SRC = `
  precision highp float;

  uniform vec2 u_stageSize;
  uniform float u_dpr;
  uniform float u_time;
  uniform float u_scrollY;
  uniform int u_count;
  uniform vec4 u_rects[${MAX_RECTS}]; // centerX, centerY, halfW, halfH (viewport CSS px)
  uniform vec2 u_meta[${MAX_RECTS}];  // cornerRadius, styleType (0=slab, 1=card, 2=pill, 3=capsule)
  uniform float u_fromDark;
  uniform float u_toDark;
  uniform float u_waveProgress;
  uniform float u_waveTime;
  uniform float u_waveReverse;
  uniform float u_rectAlpha;
  uniform vec2 u_pointer;
  uniform vec2 u_pointerPx;
  uniform vec2 u_wakePx;
  uniform float u_pointerActive;
  uniform vec4 u_ripples[${MAX_RIPPLES}]; // xy = origin px, z = ageSec (<0 inactive), w = amp

  float sq(float x) {
    return x * x;
  }

  float safePow(float x, float e) {
    return pow(max(x, 0.0001), e);
  }

  float sdRoundBox(vec2 p, vec2 b, float r) {
    float cr = min(r, min(b.x, b.y));
    vec2 q = abs(p) - b + vec2(cr);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - cr;
  }

  // Distance + closest parameter t along segment [a, b] for fluid pointer slipstream wake
  vec2 segmentDistAndT(vec2 p, vec2 a, vec2 b) {
    vec2 ba = b - a;
    float baLenSq = dot(ba, ba);
    float t = baLenSq > 0.25 ? clamp(dot(p - a, ba) / baLenSq, 0.0, 1.0) : 0.0;
    return vec2(length(p - (a + ba * t)), t);
  }

  // Multi-wave viscous capillary ring interference for zero-snap rapid clicks
  float evalRippleWave(vec2 p, out vec2 rippleGradDir, out float crestCaustic) {
    float totalH = 0.0;
    vec2 accumGrad = vec2(0.0);
    float accumCrest = 0.0;

    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 rp = u_ripples[i];
      float age = rp.z;
      if (age >= 0.0 && age < 2.2) {
        vec2 diff = p - rp.xy;
        float dist = length(diff);
        vec2 dir = dist > 0.5 ? diff / dist : vec2(0.0);

        // Decelerating viscous wavefront bloom + gentle onset (zero initial pop)
        float radius = 640.0 * (1.0 - exp(-age * 1.45));
        float delta = dist - radius;
        float bandWidth = mix(38.0, 74.0, min(age / 1.5, 1.0));
        float onset = smoothstep(0.0, 0.085, age);
        float decay = exp(-age * 1.65) * exp(-dist * 0.00105);
        float env = onset * decay * rp.w * exp(-sq(delta / bandWidth));

        float phase = delta * 0.082;
        float h = env * sin(phase);
        float slope = env * cos(phase);

        totalH += h;
        accumGrad += dir * slope;
        accumCrest += env * max(sin(phase), 0.0);
      }
    }

    rippleGradDir = accumGrad;
    crestCaustic = clamp(accumCrest, 0.0, 1.2);
    return totalH;
  }

  // Smooth hydrodynamic slipstream + ripple distortion across backdrop
  float evalInteractiveField(
    vec2 p,
    out vec2 pDisp,
    out float crestCaustic,
    out float wakeAura
  ) {
    vec2 rippleDir;
    float rippleH = evalRippleWave(p, rippleDir, crestCaustic);

    // Fluid cursor slipstream between spring-delayed wake and leading pointer
    vec2 seg = segmentDistAndT(p, u_wakePx, u_pointerPx);
    float segDist = seg.x;
    float segT = seg.y;
    vec2 wakeVel = u_pointerPx - u_wakePx;
    float speed = length(wakeVel);
    vec2 velDir = speed > 0.5 ? wakeVel / speed : vec2(0.0);

    vec2 fromHead = p - u_pointerPx;
    float headDist = length(fromHead);
    vec2 headDir = headDist > 0.5 ? fromHead / headDist : vec2(0.0);

    float trailEnv = u_pointerActive * exp(-segDist / mix(92.0, 118.0, segT));
    float wakeStrength = clamp(speed / 120.0, 0.0, 1.0);
    wakeAura = trailEnv * (0.45 + 0.55 * wakeStrength);

    // Hydrodynamic drag pulls liquid along pointer momentum + soft optical lens swell
    vec2 wakePull = velDir * (trailEnv * min(speed * 0.16, 26.0)) + headDir * (u_pointerActive * exp(-headDist * 0.0072) * 9.5);
    pDisp = p - rippleDir * 24.0 - wakePull;
    return rippleH;
  }

  // Sweeping diagonal fluid-chrome ribbons for both Studio Light & Midnight Dark themes
  vec3 sampleBackdrop(vec2 p, vec2 size, float t, float darkMix, float scrollY) {
    vec2 uv = p / max(size, vec2(1.0)) + u_pointer * vec2(0.022, -0.016);

    float arch = uv.x * 0.78 + (1.0 - uv.y) * 0.16 + 0.12 * sin(uv.y * 3.0 - t * 0.90);
    float inLiquid = smoothstep(0.14, 0.62, arch);

    vec2 sp = vec2(uv.x * 1.55, uv.y * 1.0);
    float angle = sin(sp.y * 2.8 - t * 0.95) * 0.65 + cos(sp.x * 2.1 + t * 0.75) * 0.45;
    vec2 q = sp + vec2(
      0.25 * sin(sp.y * 3.1 - t * 1.20 + angle),
      0.23 * cos(sp.x * 2.7 + t * 1.05 - angle)
    );

    float scrollPhase = mod(scrollY * 0.0024, 6.2831853);
    float river = (q.x * 0.70 - q.y * 0.62) * 8.2 + 0.90 * sin(q.x * 2.3 + q.y * 2.8 - t * 1.15) - scrollPhase;
    float phase = river - t * 1.45;
    float wave = 0.5 + 0.5 * sin(phase + 0.55 * sin(phase * 1.65 + t * 0.80));

    float darkCrease = exp(-sq((wave - 0.24) * 4.4));
    float silverSlope = smoothstep(0.14, 0.54, wave);
    float mirrorCrest = smoothstep(0.46, 0.88, wave);
    float razorSpark = safePow(smoothstep(0.78, 1.0, wave), 2.0);
    float tealEdge = exp(-sq((wave - 0.38) * 6.2));
    float silkWave = 0.5 + 0.5 * sin(q.x * 2.0 + q.y * 1.5 - t * 0.95);
    float baseGrad = smoothstep(0.0, 0.95, uv.x * 0.55 + uv.y * 0.32 + silkWave * 0.09);

    // 1) Studio Light Chrome Palette
    vec3 lightChrome = mix(vec3(0.74, 0.81, 0.90), vec3(0.95, 0.968, 0.992), silverSlope);
    lightChrome = mix(lightChrome, vec3(0.065, 0.095, 0.175), darkCrease * 0.84);
    lightChrome = mix(lightChrome, vec3(0.996, 0.998, 1.0), mirrorCrest);
    lightChrome += vec3(0.15) * razorSpark;
    lightChrome += vec3(0.05, 0.62, 0.56) * tealEdge * 0.28;
    vec3 lightPearl = mix(vec3(0.976, 0.984, 0.996), vec3(0.905, 0.932, 0.970), baseGrad);
    vec3 lightCol = mix(lightPearl, lightChrome, inLiquid * 0.88);

    // 2) Midnight Smoked Mercury + Aurora Teal Dark Chrome Palette
    vec3 darkChrome = mix(vec3(0.082, 0.122, 0.210), vec3(0.245, 0.345, 0.495), silverSlope);
    darkChrome = mix(darkChrome, vec3(0.010, 0.016, 0.036), darkCrease * 0.95);
    darkChrome = mix(darkChrome, vec3(0.74, 0.88, 1.0), mirrorCrest * 0.88);
    darkChrome += vec3(0.78, 0.92, 1.0) * (razorSpark * 0.32);
    darkChrome += vec3(0.12, 0.86, 0.78) * (tealEdge * 0.36);
    vec3 darkBase = mix(vec3(0.022, 0.036, 0.072), vec3(0.054, 0.085, 0.158), baseGrad);
    darkBase += vec3(0.016, 0.075, 0.092) * silkWave * 0.22;
    vec3 darkCol = mix(darkBase, darkChrome, inLiquid * 0.90);

    return mix(lightCol, darkCol, clamp(darkMix, 0.0, 1.0));
  }

  // 3D curved optical meniscus height + fluid wake & multi-wave surface deformation
  float glassHeight(vec2 p, vec2 center, vec2 halfS, float r, float style, float t) {
    float sd = sdRoundBox(p - center, halfS, r);
    float rimWidth = style < 0.5 ? 24.0 : (style > 1.5 && style < 2.5 ? 14.0 : 19.0);
    float tRim = clamp(-sd / rimWidth, 0.0, 1.0);
    float dome = sqrt(max(0.0, 1.0 - sq(1.0 - tRim)));
    float ripple = (style < 0.5 ? 0.055 : 0.036) *
      sin(p.x * 0.024 - t * 1.15 + cos(p.y * 0.030 + t * 0.85));

    vec2 rDir;
    float rCrest;
    float interactiveRipple = evalRippleWave(p, rDir, rCrest) * 5.2;

    vec2 seg = segmentDistAndT(p, u_wakePx, u_pointerPx);
    float wakeLift = u_pointerActive * exp(-seg.x * 0.0115) * (2.6 + 1.8 * seg.y);

    return dome * 15.0 + ripple * 10.0 * smoothstep(0.0, 0.35, tRim) + interactiveRipple + wakeLift;
  }

  // Real-time Snell's Law R/G/B chromatic refraction & dynamic passing-wave edge caustics
  vec3 shadeGlassRefraction(
    vec3 behindCol,
    vec2 pGlass,
    vec2 center,
    vec2 halfS,
    float r,
    float style,
    float t,
    float darkMix,
    float scrollY
  ) {
    float sd = sdRoundBox(pGlass - center, halfS, r);
    // Feather strictly inside the DOM container radius so scroll has zero double-border shear
    float inside = smoothstep(-0.5, -3.0, sd);
    if (inside < 0.002) return behindCol;

    float eps = 1.4;
    float hx = glassHeight(pGlass + vec2(eps, 0.0), center, halfS, r, style, t) -
               glassHeight(pGlass - vec2(eps, 0.0), center, halfS, r, style, t);
    float hy = glassHeight(pGlass + vec2(0.0, eps), center, halfS, r, style, t) -
               glassHeight(pGlass - vec2(0.0, eps), center, halfS, r, style, t);
    vec3 N = normalize(vec3(-hx, -hy, 2.55 * eps));
    vec3 V = vec3(0.0, 0.0, 1.0);
    float rimSlope = clamp(1.0 - max(N.z, 0.0), 0.0, 1.0);

    // Strong curved lens deflection + chromatic R/G/B prism dispersion along curved glass bevel
    float refractAmt = (style < 0.5 ? 86.0 : (style > 1.5 && style < 2.5 ? 64.0 : 76.0)) * (0.34 + 0.66 * rimSlope);
    vec2 refrR = pGlass - N.xy * (refractAmt * 1.22);
    vec2 refrG = pGlass - N.xy * refractAmt;
    vec2 refrB = pGlass - N.xy * (refractAmt * 0.78);

    vec3 refrRCol = sampleBackdrop(refrR, u_stageSize, t, darkMix, scrollY);
    vec3 refrGCol = sampleBackdrop(refrG, u_stageSize, t, darkMix, scrollY);
    vec3 refrBCol = sampleBackdrop(refrB, u_stageSize, t, darkMix, scrollY);
    vec3 refractedScene = vec3(refrRCol.r, refrGCol.g, refrBCol.b);
    float bgLuma = dot(refractedScene, vec3(0.299, 0.587, 0.114));

    // Crystal-clear refractive rims (rimTransparency -> low veil), gently frosted center for legible text
    float rimTransparency = 1.0 - smoothstep(0.04, 0.40, rimSlope) * 0.88;
    vec2 luv = (pGlass - (center - halfS)) / max(halfS * 2.0, vec2(1.0));
    float silkSheen = 0.5 + 0.5 * sin(luv.x * 4.2 + luv.y * 2.6 - t * 0.90);
    vec3 lightVeil = mix(vec3(0.955, 0.968, 0.992), vec3(1.0), silkSheen * 0.65);
    vec3 darkVeil = mix(vec3(0.036, 0.062, 0.118), vec3(0.095, 0.148, 0.242), silkSheen * 0.55);
    vec3 crystalVeil = mix(lightVeil, darkVeil, darkMix);
    float veilStrength = style < 0.5 ? mix(0.28, 0.36, darkMix) : mix(0.34, 0.42, darkMix);
    vec3 glassCol = mix(refractedScene, crystalVeil, veilStrength * rimTransparency);

    // Dynamic caustic transmission flare when moving bright chrome wave glides past curved rim
    float passingCaustic = smoothstep(mix(0.56, 0.20, darkMix), mix(0.96, 0.70, darkMix), bgLuma);
    vec3 causticCol = mix(vec3(0.96, 0.99, 1.0), vec3(0.32, 0.94, 0.90), darkMix);
    glassCol += causticCol * (passingCaustic * rimSlope * mix(0.42, 0.58, darkMix));

    // Internal TIR dark band + curved directional catchlights
    float rimBand = exp(-sq((rimSlope - 0.50) * 4.6));
    float nLen = length(N.xy);
    vec2 nDir = nLen > 0.0005 ? (N.xy / nLen) : vec2(0.7071, 0.7071);
    float dirChrome = clamp(0.5 + 0.5 * dot(nDir, vec2(0.7, 0.7)), 0.0, 1.0);
    vec3 tirDark = mix(vec3(0.08, 0.12, 0.20), vec3(0.006, 0.012, 0.028), darkMix);
    glassCol = mix(glassCol, tirDark, rimBand * dirChrome * mix(0.26, 0.44, darkMix));

    vec3 L1 = normalize(vec3(-0.62 + u_pointer.x * 0.44, -0.68 + u_pointer.y * 0.36, 0.58));
    vec3 L2 = normalize(vec3(0.65 - u_pointer.x * 0.32, 0.62 - u_pointer.y * 0.28, 0.52));
    float spec1 = safePow(max(dot(N, normalize(L1 + V)), 0.0), 38.0);
    float spec2 = safePow(max(dot(N, normalize(L2 + V)), 0.0), 32.0);
    float fresnel = safePow(rimSlope, 1.9);
    vec3 specCol = mix(vec3(1.0), vec3(0.84, 0.94, 1.0), darkMix);
    glassCol += specCol * (spec1 * (0.72 + 0.28 * passingCaustic) + spec2 * 0.50 + fresnel * mix(0.26, 0.38, darkMix));

    return mix(behindCol, glassCol, inside);
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

  void evaluateOceanWave(
    vec2 p,
    vec2 size,
    float prog,
    float wt,
    float rev,
    out float localDark,
    out vec2 waterOffset,
    out float wetAhead,
    out float swashMask,
    out float causticSea,
    out float crestGlint,
    out float foamTotal
  ) {
    if (prog <= 0.0001 || prog >= 0.9999) {
      localDark = u_toDark;
      waterOffset = vec2(0.0);
      wetAhead = 0.0;
      swashMask = 0.0;
      causticSea = 0.0;
      crestGlint = 0.0;
      foamTotal = 0.0;
      return;
    }

    float easeP = 0.5 - 0.5 * cos(3.14159265 * clamp(prog, 0.0, 1.0));
    float activeEnv = smoothstep(0.0, 0.07, prog) * (1.0 - smoothstep(0.90, 1.0, prog));

    vec2 dir = rev < 0.5 ? normalize(vec2(-0.74, 0.45)) : normalize(vec2(0.74, -0.45));
    vec2 perp = vec2(-dir.y, dir.x);
    float coordPx = dot(p, dir);
    float alongPx = dot(p, perp);

    float pMin = min(0.0, size.x * dir.x) + min(0.0, size.y * dir.y);
    float pMax = max(0.0, size.x * dir.x) + max(0.0, size.y * dir.y);
    float frontBase = mix(pMin - 85.0, pMax + 230.0, easeP);

    float s1 = sin(alongPx * 0.0046 + wt * 2.1) * 42.0;
    float s2 = sin(alongPx * 0.0115 - wt * 3.1 + 1.4) * 20.0;
    float s3 = sin(alongPx * 0.0270 + wt * 4.7 + cos(alongPx * 0.015)) * 8.5;
    float scallopPx = (s1 + s2 + s3) * (0.45 + 0.55 * activeEnv);
    float distToCrest = coordPx - (frontBase + scallopPx);

    float behindMask = smoothstep(4.5, -4.5, distToCrest);
    localDark = mix(u_fromDark, u_toDark, behindMask);

    wetAhead = smoothstep(48.0, 2.0, distToCrest) * smoothstep(-3.0, 2.0, distToCrest) * activeEnv;

    float seaPattern = organicSeaPattern(p, wt);
    float foamWobble = sin(alongPx * 0.022 + wt * 3.0 + sin(alongPx * 0.009) * 1.5) * 4.0;

    float lipFoam = exp(-sq((distToCrest + 2.5 + foamWobble * 0.4) / 7.5)) * (0.74 + 0.36 * seaPattern);
    float veilFoam = smoothstep(-72.0, -6.0, distToCrest) * smoothstep(3.0, -4.0, distToCrest) * seaPattern * 0.68;
    float wave2 = exp(-sq((distToCrest + 128.0 + sin(alongPx * 0.010 - wt * 2.4) * 14.0) / 9.5)) * (0.28 + 0.62 * seaPattern);
    foamTotal = clamp(lipFoam + veilFoam + wave2 * 0.42, 0.0, 1.0) * activeEnv;

    swashMask = smoothstep(-195.0, -24.0, distToCrest) * smoothstep(3.0, -7.0, distToCrest) * activeEnv;
    float swellCurve = smoothstep(-135.0, -10.0, distToCrest) * smoothstep(3.0, -12.0, distToCrest);
    float capWave = sin(coordPx * 0.062 - wt * 8.0 + cos(alongPx * 0.024 + wt * 2.3) * 1.9);
    waterOffset = (dir * (swellCurve * 13.0 + capWave * 4.5) + perp * (cos(alongPx * 0.032 - wt * 3.8) * 3.5)) * swashMask;

    causticSea = safePow(seaPattern, 1.45) * swashMask;
    crestGlint = exp(-sq((distToCrest + 14.0) / 11.5)) * activeEnv *
      (0.40 + 0.60 * smoothstep(-0.2, 0.9, sin(alongPx * 0.015 + wt * 3.1)));
  }

  void main() {
    vec2 p = vec2(gl_FragCoord.x / max(u_dpr, 1.0), u_stageSize.y - gl_FragCoord.y / max(u_dpr, 1.0));
    float t = u_time;

    float localDark;
    vec2 waterOffset;
    float wetAhead;
    float swashMask;
    float causticSea;
    float crestGlint;
    float foamTotal;
    evaluateOceanWave(
      p,
      u_stageSize,
      u_waveProgress,
      u_waveTime,
      u_waveReverse,
      localDark,
      waterOffset,
      wetAhead,
      swashMask,
      causticSea,
      crestGlint,
      foamTotal
    );

    vec2 pWater = p - waterOffset;
    vec2 pInteractive;
    float crestCaustic;
    float wakeAura;
    float rippleVal = evalInteractiveField(pWater, pInteractive, crestCaustic, wakeAura);

    vec3 col = sampleBackdrop(pInteractive, u_stageSize, t, localDark, u_scrollY);

    // Subtle specular liquid wake sheen & multi-wave caustic highlight on stage backdrop
    vec3 wakeCol = mix(vec3(0.16, 0.65, 0.72), vec3(0.56, 0.90, 1.0), localDark);
    col += wakeCol * (wakeAura * mix(0.045, 0.095, localDark));
    col += mix(vec3(0.14, 0.58, 0.68), vec3(0.86, 0.97, 1.0), localDark) * (crestCaustic * mix(0.13, 0.28, localDark));
    col -= vec3(0.025, 0.045, 0.085) * (max(-rippleVal, 0.0) * (1.0 - localDark * 0.45));

    // O(1) AABB-culled optical refraction pass for visible liquid glass containers (desktop fine pointer)
    if (u_rectAlpha > 0.005) {
      for (int i = 0; i < ${MAX_RECTS}; i++) {
        if (i >= u_count) break;
        vec4 rc = u_rects[i];
        if (abs(pWater.x - rc.x) < rc.z && abs(pWater.y - rc.y) < rc.w) {
          vec2 meta = u_meta[i];
          vec3 refractedCol = shadeGlassRefraction(col, pWater, rc.xy, rc.zw, meta.x, meta.y, t, localDark, u_scrollY);
          refractedCol += mix(vec3(0.15, 0.60, 0.68), vec3(0.88, 0.98, 1.0), localDark) * (crestCaustic * 0.16);
          col = mix(col, refractedCol, u_rectAlpha);
        }
      }
    }

    if (wetAhead > 0.001 || swashMask > 0.001 || foamTotal > 0.001) {
      col *= mix(1.0, 0.82, wetAhead * (1.0 - localDark * 0.45));

      float colLuma = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 seaTint = mix(vec3(0.04, 0.42, 0.52), vec3(0.14, 0.62, 0.70), clamp(colLuma, 0.0, 1.0));
      col = mix(col, seaTint, swashMask * mix(0.32, 0.38, u_waveReverse));
      col += vec3(0.20, 0.80, 0.82) * (causticSea * mix(0.28, 0.14, colLuma));
      col += vec3(0.62, 0.92, 0.98) * (crestGlint * mix(0.30, 0.12, colLuma));

      vec3 foamColor = mix(vec3(0.84, 0.97, 0.98), vec3(0.99, 1.0, 1.0), smoothstep(0.20, 0.85, foamTotal));
      col = mix(col, foamColor, clamp(foamTotal * 0.94, 0.0, 0.96));
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export function LiquidGlassStage({ enabled = true }: { enabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { isDark, oceanWaveRef } = useTheme();
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  // Fluid two-stage Motion springs for silky cursor tracking & delayed velocity wake
  const pointerXRaw = useMotionValue(0);
  const pointerYRaw = useMotionValue(0);
  const pointerX = useSpring(pointerXRaw, { stiffness: 78, damping: 16, mass: 0.9 });
  const pointerY = useSpring(pointerYRaw, { stiffness: 78, damping: 16, mass: 0.9 });

  const pointerPxXRaw = useMotionValue(typeof window !== "undefined" ? window.innerWidth * 0.5 : 640);
  const pointerPxYRaw = useMotionValue(typeof window !== "undefined" ? window.innerHeight * 0.5 : 360);
  const pointerPxX = useSpring(pointerPxXRaw, { stiffness: 95, damping: 17, mass: 0.78 });
  const pointerPxY = useSpring(pointerPxYRaw, { stiffness: 95, damping: 17, mass: 0.78 });

  // Secondary slower spring builds an organic viscous slipstream trail behind the pointer
  const wakePxX = useSpring(pointerPxXRaw, { stiffness: 32, damping: 12, mass: 1.35 });
  const wakePxY = useSpring(pointerPxYRaw, { stiffness: 32, damping: 12, mass: 1.35 });

  const pointerActiveRaw = useMotionValue(0);
  const pointerActive = useSpring(pointerActiveRaw, { stiffness: 62, damping: 18 });

  // Multi-wave ring buffer (up to MAX_RIPPLES concurrent waves with zero click cut-off)
  const ripplesRef = useRef<{ x: number; y: number; startMs: number; amp: number }[]>(
    Array.from({ length: MAX_RIPPLES }, () => ({ x: 0, y: 0, startMs: -10000, amp: 0 })),
  );
  const nextRippleIdxRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const pushRipple = (x: number, y: number, amp = 1.0) => {
      const idx = nextRippleIdxRef.current % MAX_RIPPLES;
      nextRippleIdxRef.current = idx + 1;
      const slot = ripplesRef.current[idx];
      slot.x = x;
      slot.y = y;
      slot.startMs = performance.now();
      slot.amp = amp;
    };

    const syncPointer = (clientX: number, clientY: number) => {
      const w = Math.max(window.innerWidth, 1);
      const h = Math.max(window.innerHeight, 1);
      const nx = (clientX / w - 0.5) * 2.0;
      const ny = (0.5 - clientY / h) * 2.0;
      pointerXRaw.set(Math.max(-1, Math.min(1, nx)));
      pointerYRaw.set(Math.max(-1, Math.min(1, ny)));
      pointerPxXRaw.set(clientX);
      pointerPxYRaw.set(clientY);
      pointerActiveRaw.set(1);
    };

    const onPointerMove = (e: PointerEvent) => {
      syncPointer(e.clientX, e.clientY);
    };

    const onPointerDown = (e: PointerEvent) => {
      syncPointer(e.clientX, e.clientY);
      pushRipple(e.clientX, e.clientY, 1.0);
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") {
        pointerActiveRaw.set(0);
      }
    };

    const onMouseLeave = () => {
      pointerActiveRaw.set(0);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    document.documentElement.addEventListener("mouseleave", onMouseLeave, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [enabled, pointerActiveRaw, pointerPxXRaw, pointerPxYRaw, pointerXRaw, pointerYRaw]);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
    });

    if (!gl) {
      document.documentElement.classList.add("gl-fallback");
      return;
    }
    document.documentElement.classList.remove("gl-fallback");

    const compileShader = (type: number, src: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("WebGL shader error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compileShader(gl.VERTEX_SHADER, VS_SRC);
    const fs = compileShader(gl.FRAGMENT_SHADER, FS_SRC);
    const prog = vs && fs ? gl.createProgram() : null;

    if (!vs || !fs || !prog) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      document.documentElement.classList.add("gl-fallback");
      return;
    }

    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("WebGL program link error:", gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      document.documentElement.classList.add("gl-fallback");
      return;
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const posLoc = gl.getAttribLocation(prog, "a_pos");
    const uStageSize = gl.getUniformLocation(prog, "u_stageSize");
    const uDpr = gl.getUniformLocation(prog, "u_dpr");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uScrollY = gl.getUniformLocation(prog, "u_scrollY");
    const uCount = gl.getUniformLocation(prog, "u_count");
    const uRects = gl.getUniformLocation(prog, "u_rects");
    const uMeta = gl.getUniformLocation(prog, "u_meta");
    const uFromDark = gl.getUniformLocation(prog, "u_fromDark");
    const uToDark = gl.getUniformLocation(prog, "u_toDark");
    const uWaveProgress = gl.getUniformLocation(prog, "u_waveProgress");
    const uWaveTime = gl.getUniformLocation(prog, "u_waveTime");
    const uWaveReverse = gl.getUniformLocation(prog, "u_waveReverse");
    const uRectAlpha = gl.getUniformLocation(prog, "u_rectAlpha");
    const uPointer = gl.getUniformLocation(prog, "u_pointer");
    const uPointerPx = gl.getUniformLocation(prog, "u_pointerPx");
    const uWakePx = gl.getUniformLocation(prog, "u_wakePx");
    const uPointerActive = gl.getUniformLocation(prog, "u_pointerActive");
    const uRipples = gl.getUniformLocation(prog, "u_ripples");

    const rectArr = new Float32Array(MAX_RECTS * 4);
    const metaArr = new Float32Array(MAX_RECTS * 2);
    const rippleArr = new Float32Array(MAX_RIPPLES * 4);
    const radiusCache = new WeakMap<Element, number>();
    const glassSelector =
      '[data-glass]:not([class*="!bg-"]), .glass:not(.grad-accent):not(.glass-navy):not([class*="!bg-"]), .soft:not([data-glass]):not(.grad-accent):not([class*="!bg-"])';
    const orderRank: Record<string, number> = { slab: 0, card: 1, pill: 2, capsule: 3 };

    let cachedGlassNodes: Element[] = [];
    let domDirty = true;
    let lastDomScanMs = 0;

    const mutObserver = new MutationObserver(() => {
      domDirty = true;
    });
    mutObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-glass"],
    });

    const inferGlassRadius = (el: Element): number => {
      const cached = radiusCache.get(el);
      if (cached !== undefined) return cached;
      const attr = el.getAttribute("data-radius");
      if (attr) {
        const parsed = parseFloat(attr);
        if (Number.isFinite(parsed) && parsed > 0) {
          radiusCache.set(el, parsed);
          return parsed;
        }
      }
      const computedR = parseFloat(window.getComputedStyle(el).borderTopLeftRadius);
      const val = Number.isFinite(computedR) && computedR > 0 ? computedR : 24;
      radiusCache.set(el, val);
      return val;
    };

    const finePointerMq = window.matchMedia("(hover: hover) and (pointer: fine)");
    let isFinePointer = finePointerMq.matches;
    const onPointerMediaChange = (ev: MediaQueryListEvent) => {
      isFinePointer = ev.matches;
      if (!isFinePointer) rectAlpha = 0;
    };
    finePointerMq.addEventListener("change", onPointerMediaChange);

    let accumTime = 0;
    let lastNow = performance.now();
    let lastScrollY = window.scrollY || 0;
    let fastScrollHoldUntil = 0;
    let rectAlpha = isFinePointer ? 1.0 : 0.0;
    let rafId = 0;
    let disposed = false;

    const onPassiveScroll = () => {
      if (!isFinePointer) return;
      const sy = window.scrollY || 0;
      const d = Math.abs(sy - lastScrollY);
      if (d > 48) {
        fastScrollHoldUntil = performance.now() + 75;
      }
    };
    window.addEventListener("scroll", onPassiveScroll, { passive: true });

    const syncDomToOceanWave = (cssW: number, cssH: number) => {
      const w = oceanWaveRef.current;
      if (!w.active) return;

      const progVal = w.progress;
      const easeP = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, progVal)));
      const activeEnv =
        Math.min(1, Math.max(0, progVal / 0.07)) *
        (1 - Math.min(1, Math.max(0, (progVal - 0.90) / 0.10)));

      const rev = w.reverse;
      const angLen = Math.hypot(-0.74, 0.45);
      const dirX = rev < 0.5 ? -0.74 / angLen : 0.74 / angLen;
      const dirY = rev < 0.5 ? 0.45 / angLen : -0.45 / angLen;
      const perpX = -dirY;
      const perpY = dirX;

      const pMin = Math.min(0, cssW * dirX) + Math.min(0, cssH * dirY);
      const pMax = Math.max(0, cssW * dirX) + Math.max(0, cssH * dirY);
      const frontBase = pMin - 85.0 + (pMax + 230.0 - (pMin - 85.0)) * easeP;

      const wt = w.time;
      const els = document.querySelectorAll(WAVE_SYNC_SELECTOR);
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cx = r.left + r.width * 0.5;
        const cy = r.top + r.height * 0.5;
        const coordPx = cx * dirX + cy * dirY;
        const alongPx = cx * perpX + cy * perpY;
        const s1 = Math.sin(alongPx * 0.0046 + wt * 2.1) * 42.0;
        const s2 = Math.sin(alongPx * 0.0115 - wt * 3.1 + 1.4) * 20.0;
        const s3 = Math.sin(alongPx * 0.027 + wt * 4.7 + Math.cos(alongPx * 0.015)) * 8.5;
        const scallopPx = (s1 + s2 + s3) * (0.45 + 0.55 * activeEnv);
        const behind = coordPx - (frontBase + scallopPx) < 0.0;
        const shouldBeDark = behind ? w.toDark === 1 : w.fromDark === 1;
        if (el.classList.contains("is-dark-zone") !== shouldBeDark) {
          el.classList.toggle("is-dark-zone", shouldBeDark);
        }
      }
    };

    // Pre-allocated bucket lists to avoid per-frame sort & object allocation jitter
    const itemsBuf: { cx: number; cy: number; hw: number; hh: number; r: number; rank: number }[] = Array.from(
      { length: MAX_RECTS * 2 },
      () => ({ cx: 0, cy: 0, hw: 0, hh: 0, r: 24, rank: 1 }),
    );

    const tick = (now: number) => {
      if (disposed) return;

      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) * 0.001));
      lastNow = now;
      accumTime += dt * 0.92;

      const w = oceanWaveRef.current;
      if (w.active) {
        w.progress += dt / w.duration;
        w.time += dt * 0.92;
        if (w.progress >= 1.0) {
          w.active = false;
          w.progress = 0.0;
          w.fromDark = w.toDark;
          applyDomThemeZones(isDarkRef.current);
        }
      }

      const cssW = Math.max(canvas.clientWidth || window.innerWidth, 300);
      const cssH = Math.max(canvas.clientHeight || window.innerHeight, 400);
      const dpr = Math.min(window.devicePixelRatio || 1, isFinePointer && cssW >= 768 ? 1.5 : 1.0);
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        gl.viewport(0, 0, targetW, targetH);
      }

      if (w.active) {
        syncDomToOceanWave(window.innerWidth || cssW, window.innerHeight || cssH);
      }

      const curScrollY = window.scrollY || 0;
      const scrollDelta = Math.abs(curScrollY - lastScrollY);
      lastScrollY = curScrollY;
      if (isFinePointer && scrollDelta > 48) {
        fastScrollHoldUntil = now + 75;
      }

      let rectCount = 0;
      if (isFinePointer) {
        const isFastScrolling = now < fastScrollHoldUntil;
        const targetAlpha = isFastScrolling ? 0.18 : 1.0;
        rectAlpha += (targetAlpha - rectAlpha) * Math.min(1, dt * 14);

        if (rectAlpha > 0.005) {
          if (domDirty || now - lastDomScanMs > 600) {
            cachedGlassNodes = Array.from(document.querySelectorAll(glassSelector));
            domDirty = false;
            lastDomScanMs = now;
          }

          const canvasRect = canvas.getBoundingClientRect();
          const baseLeft = canvasRect.left;
          const baseTop = canvasRect.top;
          let found = 0;
          const cap = itemsBuf.length;

          for (let i = 0; i < cachedGlassNodes.length && found < cap; i++) {
            const el = cachedGlassNodes[i] as HTMLElement;
            if (!el.isConnected || el.offsetParent === null) continue;
            const rc = el.getBoundingClientRect();
            const left = rc.left - baseLeft;
            const top = rc.top - baseTop;
            const right = rc.right - baseLeft;
            const bottom = rc.bottom - baseTop;
            if (rc.width < 12 || rc.height < 12 || bottom <= 0 || top >= cssH || right <= 0 || left >= cssW) {
              continue;
            }
            const kind = el.getAttribute("data-glass") || "card";
            const slot = itemsBuf[found++];
            slot.cx = left + rc.width * 0.5;
            slot.cy = top + rc.height * 0.5;
            slot.hw = rc.width * 0.5;
            slot.hh = rc.height * 0.5;
            slot.r = inferGlassRadius(el);
            slot.rank = orderRank[kind] ?? 1;
          }

          // Bucket pass by rank (0..3) avoids allocation & O(N log N) sort per frame
          for (let rk = 0; rk <= 3 && rectCount < MAX_RECTS; rk++) {
            for (let i = 0; i < found && rectCount < MAX_RECTS; i++) {
              const it = itemsBuf[i];
              if (it.rank !== rk) continue;
              rectArr[rectCount * 4 + 0] = it.cx;
              rectArr[rectCount * 4 + 1] = it.cy;
              rectArr[rectCount * 4 + 2] = it.hw;
              rectArr[rectCount * 4 + 3] = it.hh;
              metaArr[rectCount * 2 + 0] = it.r;
              metaArr[rectCount * 2 + 1] = it.rank;
              rectCount++;
            }
          }
        }
      } else {
        rectAlpha = 0.0;
      }

      const ripples = ripplesRef.current;
      for (let i = 0; i < MAX_RIPPLES; i++) {
        const rp = ripples[i];
        const ageSec = rp.amp > 0 ? (now - rp.startMs) * 0.001 : -1;
        rippleArr[i * 4 + 0] = rp.x;
        rippleArr[i * 4 + 1] = rp.y;
        rippleArr[i * 4 + 2] = ageSec >= 0 && ageSec < 2.2 ? ageSec : -1;
        rippleArr[i * 4 + 3] = rp.amp;
      }

      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(uStageSize, cssW, cssH);
      gl.uniform1f(uDpr, dpr);
      gl.uniform1f(uTime, accumTime);
      gl.uniform1f(uScrollY, curScrollY);
      gl.uniform1i(uCount, rectCount);
      gl.uniform4fv(uRects, rectArr);
      gl.uniform2fv(uMeta, metaArr);
      gl.uniform1f(uFromDark, w.fromDark);
      gl.uniform1f(uToDark, w.toDark);
      gl.uniform1f(uWaveProgress, w.active ? w.progress : 0.0);
      gl.uniform1f(uWaveTime, w.time);
      gl.uniform1f(uWaveReverse, w.reverse);
      gl.uniform1f(uRectAlpha, rectAlpha);
      gl.uniform2f(uPointer, pointerX.get(), pointerY.get());
      gl.uniform2f(uPointerPx, pointerPxX.get(), pointerPxY.get());
      gl.uniform2f(uWakePx, wakePxX.get(), wakePxY.get());
      gl.uniform1f(uPointerActive, pointerActive.get());
      gl.uniform4fv(uRipples, rippleArr);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      rafId = window.requestAnimationFrame(tick);
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
      window.cancelAnimationFrame(rafId);
      document.documentElement.classList.add("gl-fallback");
    };

    canvas.addEventListener("webglcontextlost", onContextLost);
    applyDomThemeZones(isDarkRef.current);
    rafId = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      mutObserver.disconnect();
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onPassiveScroll);
      finePointerMq.removeEventListener("change", onPointerMediaChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [enabled, oceanWaveRef, pointerActive, pointerPxX, pointerPxY, pointerX, pointerY, wakePxX, wakePxY]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      id="gl-liquid-stage"
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[100lvh] min-h-dvh w-full"
    />
  );
}
