import * as THREE from 'three';

/**
 * Shared atmosphere: distance fog + a glowing height haze that swallows the bottom of the city.
 * All custom shaders reference the SAME uniform objects, so tweaking them updates everything.
 */
export const atmosphere = {
  uFogColor: { value: new THREE.Color('#2a0838') },
  uFogDensity: { value: 0.00085 },
  uHazeColor: { value: new THREE.Color('#d0207a') },
  uHazeTop: { value: 110 },
  uHazeStrength: { value: 0.92 },
  uTime: { value: 0 },
  uMoonDir: { value: new THREE.Vector3(0.0, 0.25, -1).normalize() },
  /** Underwater caustic light strength (0 = off). */
  uCaustics: { value: 0 },
  /** Ground-mist amount (0..1) and its lit colour (see GroundMist). */
  uMist: { value: 0 },
  uMistColor: { value: new THREE.Color('#80708a') },
  /** 0..1 flash on the music's harder kicks (set by World every frame). */
  uBeatHit: { value: 0 },
  /** 0..1 pulse on every beat of the music (1 right on the beat, decaying; set by World every frame). */
  uBeatPulse: { value: 0 },
};

export const ATMOS_PARS = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uHazeColor;
uniform float uHazeTop;
uniform float uHazeStrength;
uniform float uTime;
uniform vec3 uMoonDir;
uniform float uCaustics;
uniform float uMist;
uniform vec3 uMistColor;
uniform float uBeatHit;
uniform float uBeatPulse;

float causticLayer(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tn = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tn - i.x) + sin(tn + i.y), sin(tn - i.y) + cos(tn + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tn) / inten), p.y / (cos(i.y + tn) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 2.0);
}

vec3 applyAtmos(vec3 col, vec3 worldPos) {
  float dist = length(worldPos - cameraPosition);
  if (uCaustics > 0.0) {
    float ca = causticLayer(worldPos.xz * 0.045, uTime * 0.5);
    col += vec3(0.45, 0.85, 1.0) * ca * uCaustics * 0.35 * exp(-dist * 0.006);
  }
  // Height haze: dense, glowing pink near the ground, gone above uHazeTop.
  float h = clamp(worldPos.y / uHazeTop, 0.0, 1.0);
  float haze = (1.0 - h * h * (3.0 - 2.0 * h)) * uHazeStrength;
  // Haze is thicker further away (we look through more of it).
  haze *= clamp(0.55 + dist / 700.0, 0.0, 1.0);
  col = mix(col, uHazeColor * 0.42, haze);
  // Distance fog (exp2).
  float d = dist * uFogDensity;
  float fog = 1.0 - exp(-d * d);
  return mix(col, uFogColor, fog);
}
`;

/** Common GLSL helpers. */
export const NOISE_GLSL = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;

/**
 * Patch a built-in material (MeshStandardMaterial etc.) so it uses our atmosphere instead of
 * three's fog. Works with instancing. `detail` adds world-space surface detail (no UVs needed),
 * each layer fading out below pixel size so it stays sharp up close without shimmering.
 */
export type SurfaceDetail = 'concrete' | 'metal';

const DETAIL_GLSL: Record<SurfaceDetail, string> = {
  concrete: /* glsl */ `
    float d = 1.0;
    d *= 0.88 + 0.24 * fbm(tp * 0.08);                                    // big stains / tone drift
    d *= 1.0 + 0.16 * (vnoise(tp * 1.3) - 0.5) * LAYER(1.3);
    d *= 1.0 + 0.14 * (vnoise(tp * 5.0) - 0.5) * LAYER(5.0);
    d *= 1.0 + 0.12 * (vnoise(tp * 19.0) - 0.5) * LAYER(19.0);
    d *= 1.0 - 0.35 * smoothstep(0.8, 0.92, vnoise(tp * 41.0 + 3.0)) * LAYER(41.0); // air pockets
    // Rain streaks running down vertical faces.
    float vert = 1.0 - an.y;
    d *= 1.0 - 0.18 * vert * smoothstep(0.5, 0.85, vnoise(vec2((wpos.x + wpos.z) * 2.3, wpos.y * 0.15)));
    // Formwork joints every 1.5 m on vertical faces.
    float jy = abs(fract(wpos.y / 1.5) - 0.5);
    d *= 1.0 - 0.25 * vert * (1.0 - smoothstep(0.0, max(fwidth(wpos.y / 1.5) * 1.5, 0.004), 0.5 - jy));
    diffuseColor.rgb *= d;
    detailRough = 0.85 + 0.3 * vnoise(tp * 3.0);
  `,
  metal: /* glsl */ `
    float d = 1.0;
    d *= 0.9 + 0.2 * fbm(tp * 0.3);
    d *= 1.0 + 0.1 * (vnoise(vec2(tp.x * 2.0, tp.y * 60.0)) - 0.5) * LAYER(60.0);   // rolled grain
    d *= 1.0 - 0.25 * smoothstep(0.7, 0.9, vnoise(tp * 2.2 + 7.0)) * LAYER(2.2);    // grime spots
    diffuseColor.rgb *= d;
    detailRough = 0.75 + 0.5 * vnoise(tp * 1.7) * LAYER(1.7) + 0.25 * (1.0 - LAYER(1.7));
  `,
};

export function applyAtmosphere<T extends THREE.Material>(mat: T, detail?: SurfaceDetail): T {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, atmosphere);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtmosWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 aw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            aw = instanceMatrix * aw;
          #endif
          vAtmosWorld = (modelMatrix * aw).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vAtmosWorld;\n${ATMOS_PARS}`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vAtmosWorld);');
    if (detail) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\nfloat detailRough = 1.0;`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 wpos = vAtmosWorld;
            vec3 wn = normalize(cross(dFdx(wpos), dFdy(wpos)));
            vec3 an = abs(wn);
            vec2 tp = an.y > max(an.x, an.z) ? wpos.xz : (an.x > an.z ? wpos.zy : wpos.xy);
            float px = max(length(fwidth(tp)), 1e-4);
            #define LAYER(f) (1.0 - smoothstep(0.25, 0.9, (f) * px))
            ${DETAIL_GLSL[detail]}
            #undef LAYER
          }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor * detailRough, 0.04, 1.0);');
    }
  };
  if (detail) mat.customProgramCacheKey = () => 'atmos-' + detail;
  return mat;
}
