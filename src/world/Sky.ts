import * as THREE from 'three';
import { atmosphere, NOISE_GLSL } from '../render/atmosphere';

/** Big gradient sky dome with a striped retro sun / moon and twinkling stars. Follows the camera. */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uTop: { value: new THREE.Color('#05010f') },
    uMid: { value: new THREE.Color('#2a0a4a') },
    uHorizon: { value: new THREE.Color('#ff3c8e') },
    uSunColorA: { value: new THREE.Color('#fff36b') },
    uSunColorB: { value: new THREE.Color('#ff2a9a') },
    uSunSize: { value: 0.16 },
    uSunIntensity: { value: 2.2 },
    uClouds: { value: 0 },
    uFlash: { value: 0 },
    uStars: { value: 1 },
    uSunStripes: { value: 1 },
    uDayClouds: { value: 0 },
    uAurora: { value: 0 },
    uNebula: { value: 0 },
    uGridHorizon: { value: 0 },
  };

  constructor() {
    const geo = new THREE.SphereGeometry(5000, 48, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { ...this.uniforms, uFogColor: atmosphere.uFogColor, uMist: atmosphere.uMist, uMistColor: atmosphere.uMistColor, uHazeColor: atmosphere.uHazeColor, uTime: atmosphere.uTime, uMoonDir: atmosphere.uMoonDir },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
          gl_Position.z = gl_Position.w; // always at far plane
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uMistColor;
        uniform float uMist;
        uniform vec3 uTop, uMid, uHorizon, uFogColor, uHazeColor, uSunColorA, uSunColorB, uMoonDir;
        uniform float uSunSize, uSunIntensity, uTime, uClouds, uFlash, uStars, uSunStripes, uDayClouds, uAurora, uNebula, uGridHorizon;
        varying vec3 vWorld;
        ${NOISE_GLSL}
        void main() {
          vec3 dir = normalize(vWorld - cameraPosition);
          float y = dir.y;
          // Vertical gradient.
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, y));
          col = mix(col, uTop, smoothstep(0.15, 0.7, y));
          // Below horizon: city haze glow.
          col = mix(col, uHazeColor * 0.55, smoothstep(0.0, -0.08, y));

          // Stars.
          if (y > 0.05) {
            vec2 sp = dir.xz / (y + 0.35) * 220.0;
            vec2 cell = floor(sp);
            float h = hash21(cell);
            if (h > 0.985) {
              vec2 f = fract(sp) - 0.5;
              float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 4.0) + h * 50.0);
              float s = smoothstep(0.12, 0.0, length(f)) * tw * smoothstep(0.05, 0.3, y);
              col += vec3(0.8, 0.85, 1.0) * s * 1.5 * (1.0 - uClouds) * uStars;
            }
          }

          // Retro sun with horizontal cut stripes on the lower half.
          vec3 sd = normalize(uMoonDir);
          vec3 sx = normalize(cross(vec3(0.0, 1.0, 0.0), sd));
          vec3 sy = cross(sd, sx);
          float facing = dot(dir, sd);
          if (facing > 0.0) {
            vec2 p = vec2(dot(dir, sx), dot(dir, sy)) / uSunSize;
            float r = length(p);
            float disc = smoothstep(1.0, 0.985, r);
            float t = clamp(p.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 sunCol = mix(uSunColorB, uSunColorA, t);
            // Stripes: get thicker towards the bottom.
            float band = fract(p.y * 7.0 + uTime * 0.05);
            float thick = clamp(-p.y * 0.55 + 0.05, 0.0, 0.7);
            float cut = (p.y < 0.15 && uSunStripes > 0.5) ? step(thick, band) : 1.0;
            float sunVis = 1.0 - uClouds * 0.85;
            col = mix(col, sunCol * uSunIntensity, disc * cut * sunVis);
            // Glow halo.
            col += uSunColorB * 0.35 * sunVis * exp(-max(r - 1.0, 0.0) * 2.2) * (1.0 - disc * cut);
          }

          // Space nebula: coloured fbm clouds all around (space continues below the horizon).
          if (uNebula > 0.0) {
            vec3 d3 = dir * 3.0;
            float nb = fbm(d3.xy * 1.3 + d3.z) * fbm(d3.yz * 1.7 - d3.x + 3.1);
            vec3 nc = mix(vec3(0.5, 0.1, 0.8), vec3(0.0, 0.6, 0.9), fbm(d3.xz * 0.8));
            col = mix(col, uTop, (1.0 - smoothstep(-0.2, 0.1, y)) * uNebula);
            col += nc * smoothstep(0.15, 0.6, nb) * 0.9 * uNebula;
            vec2 sp2 = vec2(atan(dir.z, dir.x) * 300.0, dir.y * 300.0);
            float hs = hash21(floor(sp2));
            col += vec3(1.0) * step(0.992, hs) * (1.0 - smoothstep(0.0, 0.5, length(fract(sp2) - 0.5))) * 1.5 * uNebula;
          }
          // Aurora curtains.
          if (uAurora > 0.0 && y > 0.02) {
            vec2 auv = dir.xz / (y + 0.25);
            float band = sin(auv.x * 1.6 + fbm(auv * 0.7 + uTime * 0.05) * 4.0 + uTime * 0.2);
            float curtain = smoothstep(0.75, 1.0, band) * smoothstep(0.02, 0.18, y) * (1.0 - smoothstep(0.3, 0.75, y));
            float rays = 0.6 + 0.4 * sin(auv.x * 40.0 + uTime);
            col += mix(vec3(0.1, 1.0, 0.5), vec3(0.6, 0.2, 1.0), smoothstep(0.1, 0.5, y)) * curtain * rays * 0.9 * uAurora;
          }
          // Infinite neon grid horizon (cyber).
          if (uGridHorizon > 0.0 && y < 0.0) {
            vec2 g = dir.xz / max(-y, 0.002) * 6.0;
            vec2 gf = abs(fract(g + vec2(0.0, uTime * 0.8)) - 0.5);
            float line = smoothstep(0.47, 0.5, max(gf.x, gf.y));
            col = mix(vec3(0.0, 0.0, 0.02), uHorizon * 1.5, line * smoothstep(-1.0, -0.02, y));
            col = mix(col, uHorizon, smoothstep(-0.05, 0.0, y));
          }

          // Puffy daytime clouds.
          if (uDayClouds > 0.0 && y > 0.0) {
            vec2 duv = dir.xz / (y + 0.08);
            float dn = fbm(duv * 0.9 + vec2(uTime * 0.008, 0.0)) * 0.7 + fbm(duv * 2.7) * 0.4;
            float dc = smoothstep(0.62, 0.9, dn) * smoothstep(0.0, 0.08, y) * uDayClouds;
            vec3 dcol = mix(vec3(1.0, 0.92, 0.85), vec3(1.0), smoothstep(0.7, 1.0, dn)) * 1.1;
            col = mix(col, dcol, dc);
          }

          // Storm clouds: dark, lit from below by the city haze; lightning lights them up.
          if (uClouds > 0.0 && y > -0.02) {
            vec2 cuv = dir.xz / (max(y, 0.0) + 0.12);
            float n = fbm(cuv * 1.6 + vec2(uTime * 0.03, uTime * 0.01));
            float n2 = fbm(cuv * 4.0 - vec2(uTime * 0.05, 0.0));
            float cov = smoothstep(0.55 - uClouds * 0.45, 0.85, n * 0.75 + n2 * 0.35);
            vec3 cloudCol = mix(uFogColor * 0.9 + uHazeColor * 0.03, uFogColor * 0.35, smoothstep(0.0, 0.45, y));
            cloudCol += vec3(0.6, 0.65, 0.9) * uFlash * (0.3 + 0.7 * n2);
            col = mix(col, cloudCol, cov * uClouds);
          }
          col += vec3(0.5, 0.55, 0.8) * uFlash * 0.12;

          // Blend toward fog colour near/below horizon so distant city melts into sky.
          col = mix(col, uFogColor, smoothstep(0.12, 0.0, abs(y)) * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  /** Apply a level's sky parameters. */
  configure(p: { top: string; mid: string; horizon: string; sunA: string; sunB: string; sunSize: number; sunIntensity: number; sunStripes: number; stars: number; dayClouds: number; aurora?: number; nebula?: number; gridHorizon?: number }): void {
    const u = this.uniforms;
    u.uTop.value.set(p.top);
    u.uMid.value.set(p.mid);
    u.uHorizon.value.set(p.horizon);
    u.uSunColorA.value.set(p.sunA);
    u.uSunColorB.value.set(p.sunB);
    u.uSunSize.value = p.sunSize;
    u.uSunIntensity.value = p.sunIntensity;
    u.uSunStripes.value = p.sunStripes;
    u.uStars.value = p.stars;
    u.uDayClouds.value = p.dayClouds;
    u.uAurora.value = p.aurora ?? 0;
    u.uNebula.value = p.nebula ?? 0;
    u.uGridHorizon.value = p.gridHorizon ?? 0;
  }

  update(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
