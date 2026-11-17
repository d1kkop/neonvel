import * as THREE from 'three';
import { ATMOS_PARS, atmosphere, NOISE_GLSL } from '../../render/atmosphere';
import { LoopTrack } from '../../track/Track';
import { insideTrack } from '../coast/Coast';

export interface TerrainPalette {
  low: string;
  mid: string;
  high: string;
  /** Colour on steep slopes (rock). */
  steep: string;
  /** Height where `mid` takes over from `low`, and `high` from `mid`. */
  midAt: number;
  highAt: number;
  /** Optional glowing contour lines (synthwave wireframe look). */
  lines?: { color: string; spacing: number; strength: number; fromHeight?: number; /** Extra glow on the music's hard hits (0 = none). */ beat?: number };
  /**
   * Wind-rippled sand below `midAt`: per-pixel ripple normals, colour patches, crest/trough tint and
   * gentle sheen. `pale` / `dark` are the patch colours mixed into `low`.
   */
  sand?: { pale: string; dark: string; ripple?: number };
  /**
   * Snow cover on the gentle ground: wind-carved drifts and grain (bump mapped), cold blue sky light in the
   * shadows (`shadow` = ambient colour), snow kept on rock ledges and close-range glints.
   */
  snow?: { shadow: string; sparkle?: number };
  /**
   * Bump-mapped ground detail (fades with distance): 'desert' = pebble pavement on the rocky ground and
   * cracked clay pans in sandy hollows; 'harbor' = gravel yard with old asphalt, cracks, puddles, oil and
   * weeds; 'seabed' = underwater ripples, grain, algae patches, pebbles and shells. All add rocky lumps on slopes.
   */
  ground?: 'desert' | 'harbor' | 'seabed';
}

export interface TerrainOptions {
  /** Height function. d = distance to the track centre line, inside = inside the loop. */
  height: (x: number, z: number, d: number, inside: boolean, roadY: number) => number;
  palette: TerrainPalette;
  margin?: number;
  /** Grid spacing (m) of the track-distance field; the mesh itself is `subdiv` times finer. */
  cell?: number;
  /** Mesh subdivisions per distance-field cell (default 3). */
  subdiv?: number;
}

/** Generic heightfield terrain around a loop track, with height/slope based colouring. */
export class Terrain {
  readonly mesh: THREE.Mesh;
  private readonly heights: Float32Array;
  private readonly nx: number;
  private readonly nz: number;
  private readonly x0: number;
  private readonly z0: number;
  private readonly cell: number;

  constructor(track: LoopTrack, opts: TerrainOptions) {
    const margin = opts.margin ?? 1400;
    const coarse = opts.cell ?? 14;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.samples) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this.x0 = minX - margin;
    this.z0 = minZ - margin;
    // 1) Coarse grid: distance to the track, road height and inside/outside (the expensive part).
    const cx = Math.ceil((maxX - minX + margin * 2) / coarse) + 1;
    const cz = Math.ceil((maxZ - minZ + margin * 2) / coarse) + 1;
    const cD = new Float32Array(cx * cz), cY = new Float32Array(cx * cz), cIn = new Float32Array(cx * cz);
    const s = track.samples;
    for (let j = 0; j < cz; j++) {
      for (let i = 0; i < cx; i++) {
        const x = this.x0 + i * coarse, z = this.z0 + j * coarse;
        let best = Infinity;
        let bk = 0;
        for (let k = 0; k < s.length; k += 3) {
          const dx = s[k].x - x, dz = s[k].z - z;
          const dd = dx * dx + dz * dz;
          if (dd < best) { best = dd; bk = k; }
        }
        const d = Math.sqrt(best);
        // Road height at the nearest point, blending back to the base height far away (no cliffs where
        // two parts of a hilly track are equally near).
        cD[j * cx + i] = d;
        cY[j * cx + i] = THREE.MathUtils.lerp(s[bk].y, track.height, THREE.MathUtils.smoothstep(d, 60, 420));
        cIn[j * cx + i] = insideTrack(track, x, z) ? 1 : 0;
      }
    }
    // 2) Fine grid (subdiv × denser, capped to ~1.1M vertices): heights from the level's height function,
    //    with the coarse fields interpolated.
    let sub = Math.max(1, Math.round(opts.subdiv ?? 3));
    while (sub > 1 && ((cx - 1) * sub + 1) * ((cz - 1) * sub + 1) > 900_000) sub--;
    const cell = (this.cell = coarse / sub);
    const nx = (this.nx = (cx - 1) * sub + 1);
    const nz = (this.nz = (cz - 1) * sub + 1);
    this.heights = new Float32Array(nx * nz);
    const lerp2 = (f: Float32Array, i: number, j: number, tx: number, tz: number) => {
      const i1 = Math.min(cx - 1, i + 1), j1 = Math.min(cz - 1, j + 1);
      return (f[j * cx + i] * (1 - tx) + f[j * cx + i1] * tx) * (1 - tz) + (f[j1 * cx + i] * (1 - tx) + f[j1 * cx + i1] * tx) * tz;
    };
    for (let j = 0; j < nz; j++) {
      const cj = Math.floor(j / sub), tz = (j % sub) / sub;
      for (let i = 0; i < nx; i++) {
        const ci = Math.floor(i / sub), tx = (i % sub) / sub;
        const x = this.x0 + i * cell, z = this.z0 + j * cell;
        this.heights[j * nx + i] = opts.height(x, z, lerp2(cD, ci, cj, tx, tz), lerp2(cIn, ci, cj, tx, tz) > 0.5, lerp2(cY, ci, cj, tx, tz));
      }
    }
    const geo = new THREE.PlaneGeometry((nx - 1) * cell, (nz - 1) * cell, nx - 1, nz - 1);
    geo.deleteAttribute('uv');
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.x0 + ((nx - 1) * cell) / 2, 0, this.z0 + ((nz - 1) * cell) / 2);
    const pos = geo.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const i = Math.round((pos.getX(k) - this.x0) / cell);
      const j = Math.round((pos.getZ(k) - this.z0) / cell);
      pos.setY(k, this.heights[j * nx + i]);
    }
    geo.computeVertexNormals();
    const P = opts.palette;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...atmosphere,
        uLow: { value: new THREE.Color(P.low) },
        uMid: { value: new THREE.Color(P.mid) },
        uHigh: { value: new THREE.Color(P.high) },
        uSteep: { value: new THREE.Color(P.steep) },
        uMidAt: { value: P.midAt },
        uHighAt: { value: P.highAt },
        uLineColor: { value: new THREE.Color(P.lines?.color ?? '#000000') },
        uLineSpacing: { value: P.lines?.spacing ?? 10 },
        uLineStrength: { value: P.lines?.strength ?? 0 },
        uLineFrom: { value: P.lines?.fromHeight ?? 2 },
        uLineBeat: { value: P.lines?.beat ?? 0 },
        uSand: { value: P.sand ? 1 : 0 },
        uSandPale: { value: new THREE.Color(P.sand?.pale ?? '#ffffff') },
        uSandDark: { value: new THREE.Color(P.sand?.dark ?? '#000000') },
        uRipple: { value: P.sand?.ripple ?? 1 },
        uSnow: { value: P.snow ? 1 : 0 },
        uSnowShadow: { value: new THREE.Color(P.snow?.shadow ?? '#5a6a90') },
        uSparkle: { value: P.snow?.sparkle ?? 1 },
        uGround: { value: P.ground ? { desert: 1, harbor: 2, seabed: 3 }[P.ground] : 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld; varying vec3 vNormal;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz; vNormal = normal;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLow, uMid, uHigh, uSteep, uLineColor, uSandPale, uSandDark;
        uniform float uMidAt, uHighAt, uLineSpacing, uLineStrength, uLineFrom, uLineBeat, uSand, uRipple, uSnow, uSparkle, uGround;
        uniform vec3 uSnowShadow;
        varying vec3 vWorld; varying vec3 vNormal;
        ${ATMOS_PARS}
        ${NOISE_GLSL}
        // Shared helpers (any ground style may use them).
        // Fade for a detail of frequency f (cycles per metre) given the pixel footprint (metres): no shimmer far away.
        float lod(float foot, float f) { return 1.0 - smoothstep(0.15, 0.5, foot * f); }
        // Bump mapping from a height value via screen derivatives (one height evaluation).
        vec3 bump(vec3 n, float h, float k) {
          vec3 sx = dFdx(vWorld), sy = dFdy(vWorld);
          vec3 r1 = cross(sy, n), r2 = cross(n, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dFdx(h) * k * r1 + dFdy(h) * k * r2);
          return normalize(abs(det) * n - grad);
        }
        // Cellular noise: x = distance to nearest feature, y = distance to the cell edge (F2 - F1), z = cell id.
        vec3 voro(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          float d1 = 8.0, d2 = 8.0, id = 0.0;
          for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
            vec2 g = vec2(float(xx), float(yy));
            vec2 r = g + vec2(hash21(i + g), hash21(i + g + 19.7)) - f;
            float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; id = hash21(i + g + 41.3); } else if (d < d2) { d2 = d; }
          }
          d1 = sqrt(d1); d2 = sqrt(d2);
          return vec3(d1, d2 - d1, id);
        }
        void main() {
          vec3 n = normalize(vNormal);
          float y = vWorld.y + (fbm(vWorld.xz * 0.02) - 0.5) * 8.0;
          vec3 low = uLow;
          vec3 L = normalize(uMoonDir);
          vec3 V = normalize(cameraPosition - vWorld);
          float dist = length(cameraPosition - vWorld);
          float px = max(sqrt(length(dFdx(vWorld.xz)) * length(dFdy(vWorld.xz))) * 1.3, 1e-4); // metres per pixel (area mean)
          #define LAYER(f) (1.0 - smoothstep(0.25, 0.9, (f) * px))
          float sandMask = uSand * (1.0 - smoothstep(uMidAt - 6.0, uMidAt + 6.0, y)) * smoothstep(0.6, 0.85, n.y);
          float panMask = 0.0;
          if (uGround > 0.5 && uGround < 1.5) {
            panMask = sandMask * smoothstep(0.56, 0.64, fbm(vWorld.xz * 0.006 + 9.0));
            sandMask *= 1.0 - panMask; // pans stay flat (no ripples)
          }
          if (uSand > 0.0) {
            vec2 p = vWorld.xz;
            // Colour patches: big pale drifts, darker iron-rich hollows, wind streaks.
            float patchA = fbm(p * 0.0045 + 3.1);
            float patchB = vnoise(p * 0.03) * 0.6 + vnoise(p * 0.11) * 0.4;
            float streak = vnoise(vec2(dot(p, vec2(0.8, 0.6)) * 0.01, dot(p, vec2(-0.6, 0.8)) * 0.15));
            low = mix(low, uSandPale, smoothstep(0.45, 0.75, patchA) * 0.7);
            low = mix(low, uSandDark, smoothstep(0.55, 0.3, patchA) * 0.55);
            low *= 0.9 + 0.2 * patchB + 0.08 * (streak - 0.5);
            // Wind ripples: wavy crests across the wind, bent by noise, with a steep lee side.
            vec2 dir = normalize(vec2(0.8, 0.6));
            float k = 3.0;
            float phase = dot(p, dir) * k + vnoise(p * 0.035) * 9.0 + vnoise(p * 0.17) * 1.6;
            float fw = fwidth(phase);
            float fade = sandMask * (1.0 - smoothstep(0.5, 1.4, fw));
            float dh = cos(phase) + 0.45 * cos(2.0 * phase);           // d(height)/d(phase), asymmetric profile
            float crest = sin(phase) + 0.22 * sin(2.0 * phase);
            // Fine grain on top (only up close).
            float g1 = vnoise(p * 4.0), g2 = vnoise(p * 4.0 + vec2(0.13, 0.0)), g3 = vnoise(p * 4.0 + vec2(0.0, 0.13));
            vec2 grain = vec2(g2 - g1, g3 - g1) * 4.0 * LAYER(4.0);
            // Small secondary ripples riding on the big ones (a different wind angle).
            vec2 dir2 = normalize(vec2(0.95, 0.3));
            float phase2 = dot(p, dir2) * 9.0 + vnoise(p * 0.25) * 4.0 + crest * 0.8;
            float fade2 = sandMask * (1.0 - smoothstep(0.5, 1.4, fwidth(phase2)));
            float dh2 = cos(phase2) + 0.4 * cos(2.0 * phase2);
            vec2 grad = (dir * dh * 0.2 * uRipple + grain * 0.12) * fade + dir2 * dh2 * 0.09 * uRipple * fade2;
            n = normalize(n + vec3(-grad.x, 0.0, -grad.y));
            low *= 1.0 + crest * 0.06 * fade;
          }
          float snowMask = 0.0;
          if (uSnow > 0.0) {
            // Wind-carved sastrugi (sharp crests, warped), soft drift swells and fine grain, all bump mapped.
            vec2 p = vWorld.xz;
            float foot = px;
            vec2 w = p + (vec2(fbm(p * 0.03), fbm(p * 0.03 + 5.3)) - 0.5) * 22.0;
            float sast = sin(dot(w, vec2(0.6, 0.8)) * 1.4 + fbm(p * 0.18) * 5.0) * 0.5 + 0.5;
            sast = sast * sast * sast;
            float h = fbm(p * 0.06) * 0.35 + sast * 0.07 * lod(foot, 0.25) * smoothstep(0.4, 0.7, fbm(p * 0.015 + 2.0))
                    + (vnoise(p * 2.2) - 0.5) * 0.035 * lod(foot, 2.2) + (vnoise(p * 7.0 + 3.1) - 0.5) * 0.015 * lod(foot, 7.0);
            snowMask = smoothstep(0.62, 0.8, n.y);
            n = bump(n, h, snowMask);
            low *= 0.97 + 0.06 * fbm(p * 0.01);
          }
          vec3 col = mix(low, uMid, smoothstep(uMidAt - 4.0, uMidAt + 4.0, y));
          col = mix(col, uHigh, smoothstep(uHighAt - 6.0, uHighAt + 6.0, y));
          col = mix(col, uSteep, smoothstep(0.82, 0.6, n.y));
          col *= 0.85 + 0.3 * vnoise(vWorld.xz * 0.3);
          // Detail at every scale, each faded out below pixel size.
          col *= 0.9 + 0.2 * fbm(vWorld.xz * 0.012);
          col *= 1.0 + 0.14 * (vnoise(vWorld.xz * 1.7) - 0.5) * LAYER(1.7) + 0.12 * (vnoise(vWorld.xz * 6.0) - 0.5) * LAYER(6.0)
                     + 0.1 * (vnoise(vWorld.xz * 19.0) - 0.5) * LAYER(19.0);
          // Rock strata and gullies on steep ground.
          float steepK = smoothstep(0.85, 0.6, n.y);
          float strata = sin(vWorld.y * 1.3 + vnoise(vWorld.xz * 0.08) * 6.0) * 0.5 + 0.5;
          float fineStrata = sin(vWorld.y * 7.0 + vnoise(vWorld.xz * 0.5) * 3.0) * 0.5 + 0.5;
          col *= 1.0 - steepK * (0.22 * strata + 0.12 * fineStrata * (1.0 - smoothstep(0.3, 1.0, fwidth(vWorld.y * 7.0))));
          float puddle = 0.0;
          if (uGround > 0.5) {
            vec2 p = vWorld.xz;
            float foot = px;
            float flatK = 1.0 - steepK;
            // Rocky lumps on slopes (all styles).
            float h = steepK * (fbm(p * 0.35 + vWorld.y * 0.2) * 0.8 + (vnoise(p * 1.6 + vWorld.y) - 0.5) * 0.5 * lod(foot, 1.6)
                                + (vnoise(p * 5.0 + vWorld.y * 2.0) - 0.5) * 0.25 * lod(foot, 5.0));
            float k = 0.08;
            if (uGround < 1.5) {
              // Desert pavement: packed pebbles on the rocky ground above the sand.
              float pav = smoothstep(uMidAt - 8.0, uMidAt + 2.0, y) * flatK;
              vec3 v = voro(p * 2.2);
              float pl = lod(foot, 2.2);
              float peb = smoothstep(0.45, 0.15, v.x) * step(0.3, v.z) * pl;
              vec3 v2 = voro(p * 7.0 + 5.0);
              float peb2 = smoothstep(0.4, 0.12, v2.x) * step(0.45, v2.z) * lod(foot, 7.0);
              h += pav * (peb * 0.7 + peb2 * 0.3 + (vnoise(p * 16.0) - 0.5) * 0.15 * lod(foot, 16.0));
              col = mix(col, col * (0.5 + 0.7 * v.z), peb * pav * 0.65);
              col = mix(col, col * (0.6 + 0.6 * v2.z), peb2 * pav * 0.5);
              col *= 1.0 - 0.25 * pav * (1.0 - peb) * pl;                     // dark gaps between stones
              // Clay pans: pale, cracked into curling plates (big cracks + finer sub-cracks).
              vec2 wq = (vec2(vnoise(p * 2.0), vnoise(p * 2.0 + 7.0)) - 0.5) * 0.35;
              vec3 c1 = voro(p * 0.7 + wq);
              vec3 c2 = voro(p * 2.6 + 3.0 + wq);
              float cr1 = 1.0 - smoothstep(0.0, 0.028 + foot * 0.8, c1.y);
              float cr2 = (1.0 - smoothstep(0.0, 0.035 + foot * 2.6, c2.y)) * lod(foot, 2.6);
              float cr = max(cr1, cr2 * 0.75);
              vec3 clay = mix(uSandPale, uLow, 0.3) * (0.9 + 0.15 * c1.z) * (0.94 + 0.12 * vnoise(p * 9.0));
              col = mix(col, clay, panMask * 0.9);
              col *= 1.0 - cr * panMask * 0.6;
              h += panMask * ((1.0 - cr) * 0.5 + smoothstep(0.2, 0.0, c1.y) * 0.25);  // plate edges curl up
              float sm = sandMask;
              float gA = vnoise(p * 13.0), gB = vnoise(p * 34.0 + 2.0), gC = vnoise(p * 85.0 + 5.0);
              h += sm * ((gA - 0.5) * 0.18 * lod(foot, 13.0) + (gB - 0.5) * 0.1 * lod(foot, 34.0) + (gC - 0.5) * 0.05 * lod(foot, 85.0));
              col *= 1.0 + sm * (0.1 * (gB - 0.5) * lod(foot, 34.0) + 0.14 * (gC - 0.5) * lod(foot, 85.0));
              float dark = step(0.93, hash21(floor(p * 60.0))) * lod(foot, 60.0);   // dark mineral grains
              col *= 1.0 - sm * dark * 0.35;
            } else if (uGround < 2.5) {
              // Harbor yard: gravel, patches of old cracked asphalt, puddles, oil stains, weeds in the cracks.
              vec3 v = voro(p * 6.0);
              float gl = lod(foot, 6.0);
              float stone = smoothstep(0.5, 0.12, v.x) * gl;
              float asph = smoothstep(0.42, 0.58, fbm(p * 0.018 + 2.0));
              vec3 c1 = voro(p * 0.45 + (vec2(vnoise(p * 1.3), vnoise(p * 1.3 + 4.0)) - 0.5) * 0.4);
              float crack = (1.0 - smoothstep(0.0, 0.03 + foot * 0.45, c1.y)) * asph;
              h += (1.0 - asph) * (stone * 0.6 + (vnoise(p * 18.0) - 0.5) * 0.2 * lod(foot, 18.0))
                 + asph * ((vnoise(p * 9.0) - 0.5) * 0.12 * lod(foot, 9.0) - crack * 0.5);
              col *= mix(0.7 + 0.6 * v.z * gl + 0.3 * (1.0 - gl), 0.85 + 0.15 * c1.z, asph);
              col = mix(col, col * vec3(0.8, 0.85, 0.9) * 0.8, asph * 0.5);
              col *= 1.0 - crack * 0.6;
              float weed = smoothstep(0.55, 0.75, vnoise(p * 0.6 + 9.0)) * (crack + (1.0 - asph) * 0.4) * flatK;
              col = mix(col, vec3(0.1, 0.16, 0.07) * (0.7 + 0.6 * vnoise(p * 30.0)), clamp(weed, 0.0, 1.0) * 0.8);
              float oil = smoothstep(0.72, 0.82, vnoise(p * 0.25 + 5.0)) * flatK;
              col = mix(col, col * 0.4, oil * 0.7);
              puddle = smoothstep(0.55, 0.61, fbm(p * 0.05 + 11.0)) * flatK;
              h *= 1.0 - puddle;
              col *= 1.0 - 0.45 * puddle;
            } else {
              // Seabed: wavy underwater ripples, grain, algae patches, scattered pebbles and shells.
              vec2 dir = normalize(vec2(0.3, 1.0));
              float phase = dot(p, dir) * 5.5 + vnoise(p * 0.08) * 8.0 + vnoise(p * 0.4) * 1.5;
              float rf = (1.0 - smoothstep(0.5, 1.4, fwidth(phase))) * flatK * smoothstep(0.35, 0.6, fbm(p * 0.01 + 3.0) + 0.2);
              float rip = sin(phase); rip = rip * abs(rip);
              h += rip * 0.7 * rf + (vnoise(p * 12.0) - 0.5) * 0.15 * lod(foot, 12.0) + (vnoise(p * 30.0) - 0.5) * 0.08 * lod(foot, 30.0);
              col *= 1.0 + rip * 0.07 * rf;
              col *= 0.88 + 0.24 * fbm(p * 0.08 + 1.0);
              float alg = smoothstep(0.55, 0.72, fbm(p * 0.025 + 6.0)) * flatK;
              float tuft = vnoise(p * 6.0) * lod(foot, 6.0) + 0.5 * (1.0 - lod(foot, 6.0));
              col = mix(col, vec3(0.2, 0.32, 0.2) * (0.6 + 0.6 * tuft), alg * 0.75);
              h += alg * tuft * 0.4;
              vec3 v = voro(p * 1.3);
              float pr = 0.1 + 0.12 * fract(v.z * 7.3);
              float peb = smoothstep(pr, pr * 0.55, v.x) * step(0.72, v.z) * lod(foot, 4.0) * flatK;
              vec3 pc = v.z > 0.93 ? vec3(0.96, 0.92, 0.86) : mix(vec3(0.42, 0.4, 0.36), vec3(0.62, 0.56, 0.46), fract(v.z * 13.0));
              col = mix(col, pc * (0.85 + 0.3 * vnoise(p * 20.0)), peb);
              h += peb * (1.0 - v.x / pr) * 1.2;
            }
            n = bump(n, h, k);
            col *= 0.92 + 0.12 * clamp(h, -0.5, 1.0);   // cavities a touch darker
          }
          if (uSnow > 0.0) {
            // Snow stays on rock ledges and in cracks.
            float ledge = smoothstep(0.5, 0.75, vnoise(vWorld.xz * 0.25 + vWorld.y * 0.15) + n.y * 0.4);
            col = mix(col, uHigh, steepK * ledge * 0.75);
          }
          float diff = max(dot(n, L), 0.0);
          vec3 lit = col * (0.4 + 0.8 * diff);
          if (uSnow > 0.0) {
            // Snow: cold blue sky light in the shadows instead of grey, a soft sheen, and glints up close.
            float sm = max(snowMask, 1.0 - steepK);
            lit = mix(lit, col * (uSnowShadow + 0.85 * diff), sm);
            lit += uSnowShadow * pow(1.0 - max(dot(n, V), 0.0), 4.0) * 0.15 * sm;
            vec2 cell = floor(vWorld.xz * 18.0);
            float hh = fract(sin(dot(cell + floor(V.xz * 16.0), vec2(12.9898, 78.233))) * 43758.5453);
            float glint = step(0.988, hh) * (1.0 - smoothstep(6.0, 35.0, dist)) * sm * uSparkle;
            lit += vec3(0.9, 0.95, 1.0) * glint * (0.5 + 1.5 * pow(max(dot(reflect(-L, n), V), 0.0), 4.0));
          }
          if (uSand > 0.0) {
            // Low sun: ripple faces toward it light up, lee sides drop into shade; soft sheen.
            float facing = dot(n.xz, normalize(L.xz + 1e-4));
            lit *= 1.0 + facing * 0.45 * sandMask;
            float spec = pow(max(dot(n, normalize(L + V)), 0.0), 40.0);
            lit += vec3(1.0, 0.75, 0.55) * spec * 0.12 * sandMask;
          }
          if (puddle > 0.0) {
            // Puddles: sharp highlight + a sky-tinted sheen at grazing angles.
            vec3 pn = normalize(mix(n, vec3(0.0, 1.0, 0.0), puddle));
            float fres = pow(1.0 - max(dot(pn, V), 0.0), 5.0);
            lit += (uFogColor * 1.5 + uHazeColor * 0.3) * fres * puddle * 0.8;
            lit += vec3(1.0, 0.9, 0.8) * pow(max(dot(pn, normalize(L + V)), 0.0), 120.0) * puddle * 1.5;
          }
          if (uLineStrength > 0.0) {
            // Wireframe-ish grid: contour lines + a world-space grid. Thicker and brighter on hard hits.
            float hit = uBeatHit * uLineBeat;
            vec2 g = vWorld.xz / uLineSpacing;
            vec2 fw = max(fwidth(g), vec2(1e-4));
            vec2 dd = abs(fract(g - 0.5) - 0.5) / (fw * (1.0 + hit * 1.5));
            float grid = 1.0 - min(min(dd.x, dd.y), 1.0);
            float above = smoothstep(uLineFrom, uLineFrom + 18.0, vWorld.y);
            lit += uLineColor * (grid * uLineStrength * (1.0 + hit * 2.2) + hit * 0.12) * above;
          }
          gl_FragColor = vec4(applyAtmos(lit, vWorld), 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
  }

  heightAt(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    const i = Math.max(0, Math.min(this.nx - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(this.nz - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j));
    const h = this.heights;
    const a = h[j * this.nx + i], b = h[j * this.nx + i + 1];
    const c = h[(j + 1) * this.nx + i], d = h[(j + 1) * this.nx + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
}

/** Cheap smooth 2D value noise for height functions (deterministic). */
export function heightNoise(x: number, z: number, seed = 0): number {
  // Integer hash (much faster than a sin hash; terrain meshes evaluate this millions of times).
  const sd = Math.imul(seed | 0, 0x27d4eb2d);
  const s = (a: number, b: number) => {
    let h = Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ sd;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = s(xi, zi), b = s(xi + 1, zi), c = s(xi, zi + 1), d = s(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm2(x: number, z: number, octaves = 4, seed = 0): number {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < octaves; o++) {
    v += amp * heightNoise(x * f, z * f, seed + o * 13);
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}
