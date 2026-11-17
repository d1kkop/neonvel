import * as THREE from 'three';
import { ATMOS_PARS, atmosphere, NOISE_GLSL } from '../../render/atmosphere';
import { LoopTrack } from '../../track/Track';

/** Point-in-polygon test (ray casting) against the track centre line. */
export function insideTrack(track: LoopTrack, x: number, z: number, stride = 3): boolean {
  const s = track.samples;
  let inside = false;
  for (let i = 0, j = s.length - stride; i < s.length; j = i, i += stride) {
    const a = s[i], b = s[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Fast-ish horizontal distance to the track (subsampled) and the road height there. */
function distToTrack(track: LoopTrack, x: number, z: number, stride = 3): [number, number] {
  let best = Infinity;
  let y = track.height;
  const s = track.samples;
  for (let i = 0; i < s.length; i += stride) {
    const dx = s[i].x - x, dz = s[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; y = s[i].y; }
  }
  return [Math.sqrt(best), y];
}

export interface CoastOptions {
  /** Ground level next to the road. */
  shoulder: number;
  sand: string;
  wetSand: string;
  grass: string;
  /** Inland hills height. */
  hills: number;
  /** Grid spacing (m) of the track-distance field; the mesh is `subdiv` times finer. */
  cell: number;
  /** Mesh subdivisions per distance-field cell (default 3). */
  subdiv?: number;
}

/**
 * Island terrain around a loop track: hills inland (inside the loop), a sandy beach sloping
 * into the sea outside the loop. Also exposes a height query for placing props.
 */
export class CoastTerrain {
  readonly mesh: THREE.Mesh;
  private readonly heights: Float32Array;
  private readonly nx: number;
  private readonly nz: number;
  private readonly x0: number;
  private readonly z0: number;
  private readonly cell: number;

  constructor(private readonly track: LoopTrack, opts: CoastOptions, margin = 1300) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.samples) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    // Coarse grid (opts.cell): distance to the track, road height, inside/outside — the expensive part.
    const cx = Math.ceil((maxX - minX + margin * 2) / opts.cell) + 1;
    const cz = Math.ceil((maxZ - minZ + margin * 2) / opts.cell) + 1;
    const cD = new Float32Array(cx * cz), cR = new Float32Array(cx * cz), cIn = new Float32Array(cx * cz);
    this.x0 = minX - margin;
    this.z0 = minZ - margin;
    for (let j = 0; j < cz; j++) {
      for (let i = 0; i < cx; i++) {
        const x = this.x0 + i * opts.cell, z = this.z0 + j * opts.cell;
        const [d, ry] = distToTrack(track, x, z);
        cD[j * cx + i] = d;
        cR[j * cx + i] = ry;
        cIn[j * cx + i] = insideTrack(track, x, z) ? 1 : 0;
      }
    }
    // Fine mesh: `subdiv` times denser (capped to ~1.1M vertices), coarse fields interpolated.
    let sub = Math.max(1, Math.round(opts.subdiv ?? 3));
    while (sub > 1 && ((cx - 1) * sub + 1) * ((cz - 1) * sub + 1) > 1_100_000) sub--;
    const cell = (this.cell = opts.cell / sub);
    this.nx = (cx - 1) * sub + 1;
    this.nz = (cz - 1) * sub + 1;
    const nx = this.nx, nz = this.nz;
    this.heights = new Float32Array(nx * nz);
    const land = new Float32Array(nx * nz);
    const hw = track.width / 2;
    const lerp2 = (f: Float32Array, i: number, j: number, tx: number, tz: number) => {
      const i1 = Math.min(cx - 1, i + 1), j1 = Math.min(cz - 1, j + 1);
      return (f[j * cx + i] * (1 - tx) + f[j * cx + i1] * tx) * (1 - tz) + (f[j1 * cx + i] * (1 - tx) + f[j1 * cx + i1] * tx) * tz;
    };

    const noise = (x: number, z: number) =>
      Math.sin(x * 0.006) * Math.cos(z * 0.0051) * 0.5 + Math.sin(x * 0.013 + z * 0.011) * 0.3 + Math.sin(z * 0.023 - x * 0.007) * 0.2;

    for (let j = 0; j < nz; j++) {
      const cj = Math.floor(j / sub), tz = (j % sub) / sub;
      for (let i = 0; i < nx; i++) {
        const ci = Math.floor(i / sub), tx = (i % sub) / sub;
        const x = this.x0 + i * cell;
        const z = this.z0 + j * cell;
        const d = lerp2(cD, ci, cj, tx, tz), ry = lerp2(cR, ci, cj, tx, tz), landK = lerp2(cIn, ci, cj, tx, tz);
        const inside = landK > 0.5;
        // Hilly road: the shoulder follows it, blending back to the base level far away.
        const shoulder = opts.shoulder + (THREE.MathUtils.lerp(ry, track.height, THREE.MathUtils.smoothstep(d, 40, 300)) - track.height);
        let h: number;
        if (d < hw + 6) {
          h = shoulder;
        } else if (inside) {
          const t = THREE.MathUtils.smoothstep(d, hw + 30, hw + 260);
          h = shoulder + t * opts.hills * (0.45 + 0.55 * (noise(x, z) * 0.5 + 0.5));
        } else {
          // Beach: gentle slope into the sea, then deeper water.
          const b = d - (hw + 6);
          h = shoulder - b * 0.04 - Math.max(0, b - 90) * 0.06;
          h = Math.max(h, -12);
        }
        this.heights[j * nx + i] = h;
        land[j * nx + i] = landK;
      }
    }

    const geo = new THREE.PlaneGeometry((nx - 1) * cell, (nz - 1) * cell, nx - 1, nz - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.x0 + ((nx - 1) * cell) / 2, 0, this.z0 + ((nz - 1) * cell) / 2);
    const pos = geo.getAttribute('position');
    const landAttr = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) {
      const i = Math.round((pos.getX(k) - this.x0) / cell);
      const j = Math.round((pos.getZ(k) - this.z0) / cell);
      pos.setY(k, this.heights[j * nx + i]);
      landAttr[k] = land[j * nx + i];
    }
    geo.setAttribute('aLand', new THREE.BufferAttribute(landAttr, 1));
    geo.computeVertexNormals();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...atmosphere,
        uSand: { value: new THREE.Color(opts.sand) },
        uWetSand: { value: new THREE.Color(opts.wetSand) },
        uGrass: { value: new THREE.Color(opts.grass) },
        uShoulder: { value: opts.shoulder },
      },
      vertexShader: /* glsl */ `
        attribute float aLand;
        varying vec3 vWorld; varying vec3 vNormal; varying float vLand;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz; vNormal = normal; vLand = aLand;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSand, uWetSand, uGrass;
        uniform float uShoulder;
        varying vec3 vWorld; varying vec3 vNormal; varying float vLand;
        ${ATMOS_PARS}
        ${NOISE_GLSL}
        // Fade for a detail of frequency f (cycles per metre) given the pixel footprint (metres): no shimmer far away.
        float lod(float foot, float f) { return 1.0 - smoothstep(0.15, 0.5, foot * f); }
        mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

        // Grass: clumps, tufts and blade streaks. Two fixed blade directions blended by a slow noise (a rotating
        // direction field would shear the pattern into visible lines).
        float grassH(vec2 p, float foot, out float blades) {
          float h = fbm(p * 0.35) * 0.55;
          h += vnoise(p * 1.7) * 0.35 * lod(foot, 1.7);
          vec2 qa = rot(0.4) * p, qb = rot(-1.1) * p + 17.0;
          float k = smoothstep(0.35, 0.65, fbm(p * 0.07));
          float l1 = lod(foot, 16.0), l2 = lod(foot, 38.0);
          blades = mix(vnoise(qa * vec2(16.0, 6.0)), vnoise(qb * vec2(16.0, 6.0)), k) * l1;
          float fine = mix(vnoise(qa * vec2(38.0, 12.0) + 3.1), vnoise(qb * vec2(38.0, 12.0) + 3.1), k) * l2;
          // Isotropic tuft grain at 5-8 cycles/m: survives much further than the blades (texture at mid range).
          float l3 = lod(foot, 5.5), l4 = lod(foot, 8.0);
          float tuft = vnoise(p * 5.5 + 2.3) * l3 + 0.5 * (1.0 - l3);
          float tuft2 = vnoise(p * 8.0 + 9.7) * l4 + 0.5 * (1.0 - l4);
          h += blades * 0.32 + fine * 0.16 + 0.5 * (0.32 * (1.0 - l1) + 0.16 * (1.0 - l2)) // faded detail -> its average
             + (tuft - 0.5) * 0.45 + (tuft2 - 0.5) * 0.3;
          return h;
        }

        // Sand: warped wind ripples (only on patches of the dry upper beach), soft bumps and fine grain.
        float sandH(vec2 p, float foot, float dry, out float ripple) {
          vec2 w = p + (vec2(fbm(p * 0.045), fbm(p * 0.045 + 7.1)) - 0.5) * 14.0;
          float r = sin(dot(w, vec2(0.83, 0.55)) * 8.5 + fbm(p * 0.35) * 4.0) * 0.5 + 0.5;
          r = r * r * (3.0 - 2.0 * r);
          float rmask = smoothstep(0.35, 0.65, fbm(p * 0.02 + 4.0)) * dry;
          ripple = r * rmask * lod(foot, 1.4);
          float h = ripple * 0.3 + fbm(p * 0.5) * 0.3;
          h += (vnoise(p * 7.0) - 0.5) * 0.14 * lod(foot, 7.0) + (vnoise(p * 16.0 + 3.3) - 0.5) * 0.08 * lod(foot, 16.0);
          return h;
        }

        // Bump mapping from a height value via screen derivatives (one height evaluation).
        vec3 bump(vec3 n, float h, float k) {
          vec3 sx = dFdx(vWorld), sy = dFdy(vWorld);
          vec3 r1 = cross(sy, n), r2 = cross(n, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dFdx(h) * k * r1 + dFdy(h) * k * r2);
          return normalize(abs(det) * n - grad);
        }

        void main() {
          vec2 p = vWorld.xz;
          float y = vWorld.y;
          // Metres per pixel: area mean close by (keeps fine detail at grazing angles near the car), blending to the
          // long axis with distance (there the stretched axis is what aliases).
          float fa = length(dFdx(p)), fb = length(dFdy(p));
          float foot = max(mix(sqrt(fa * fb) * 1.3, max(fa, fb), smoothstep(15.0, 60.0, length(cameraPosition - vWorld))), 1e-4);
          vec3 n0 = normalize(vNormal);
          float n = fbm(p * 0.05);

          // ---- Sand: tone patches, ripples, grain at three scales, pebbles and shells, a wrack line.
          float dry = smoothstep(0.6, 2.0, y);
          float ripple;
          float hs = sandH(p, foot, dry, ripple);
          vec3 sand = uSand * 0.94 * (0.86 + 0.26 * fbm(p * 0.018));
          sand = mix(sand, uSand * vec3(1.06, 0.97, 0.86), smoothstep(0.45, 0.75, fbm(p * 0.07 + 2.0)) * 0.6);
          sand *= 0.9 + 0.2 * ripple;
          sand *= 1.0 + 0.1 * (vnoise(p * 3.0) - 0.5) * lod(foot, 3.0) + 0.1 * (vnoise(p * 11.0) - 0.5) * lod(foot, 11.0);
          sand *= 0.86 + 0.24 * fbm(p * 0.25);           // metre-scale tone drift (stays visible far away)
          sand *= 0.92 + 0.16 * mix(0.5, vnoise(p * 1.3 + 4.0), lod(foot, 1.3));
          sand *= 1.0 + 0.14 * (vnoise(p * 6.0 + 1.1) - 0.5) * lod(foot, 6.0) + 0.12 * (vnoise(p * 15.0 + 5.2) - 0.5) * lod(foot, 15.0);
          float g1 = vnoise(p * 48.0), g2 = vnoise(p * 130.0 + 7.0);
          sand *= mix(1.0, 0.7 + 0.45 * g1, lod(foot, 48.0));
          sand *= mix(1.0, 0.82 + 0.3 * g2, lod(foot, 130.0));
          hs += (g1 - 0.5) * 0.05 * lod(foot, 48.0);
          {
            vec2 c = p * 1.8;
            vec2 id = floor(c), f = fract(c) - 0.5;
            float hh = hash21(id + 11.0);
            vec2 o = vec2(hash21(id + 3.7), hash21(id + 9.1)) - 0.5;
            float r = 0.08 + 0.1 * hash21(id + 5.5);
            float speck = smoothstep(r, r * 0.6, length(f - o * 0.6)) * step(0.9, hh) * lod(foot, 9.0);
            vec3 pebble = hh > 0.96 ? vec3(0.95, 0.92, 0.86) : vec3(0.42, 0.4, 0.38);
            sand = mix(sand, pebble, speck * 0.85);
            hs += speck * 0.12;
          }
          float wrack = smoothstep(0.12, 0.0, abs(y - 0.95 - (n - 0.5) * 0.5)) * smoothstep(0.4, 0.7, vnoise(p * 0.6));
          sand = mix(sand, vec3(0.2, 0.18, 0.1), wrack * 0.6);

          // ---- Grass: big patches of lush / dry / dark, tufts, blades, bare dirt, tiny flowers.
          float blades;
          float hg = grassH(p, foot, blades);
          float m1 = fbm(p * 0.011), m2 = fbm(p * 0.045 + 3.0), m3 = fbm(p * 0.03 + 9.0);
          vec3 grassCol = mix(uGrass, uGrass * vec3(1.5, 1.28, 0.55), smoothstep(0.42, 0.72, m1));
          grassCol = mix(grassCol, uGrass * vec3(0.5, 0.68, 0.48), smoothstep(0.45, 0.75, m2) * 0.75);
          float m4 = fbm(p * 0.09 + 5.0), m5 = fbm(p * 0.14 + 12.0);
          grassCol = mix(grassCol, uGrass * vec3(1.6, 1.35, 0.6), smoothstep(0.5, 0.68, m4) * 0.75);  // dry, yellowed tufts
          grassCol = mix(grassCol, uGrass * vec3(0.62, 0.95, 0.7), smoothstep(0.52, 0.7, m5) * 0.75);  // lush dark-green clover
          grassCol *= 0.84 + 0.3 * fbm(p * 0.25);       // metre-scale tone drift (stays visible far away)
          grassCol *= 0.88 + 0.24 * vnoise(p * 0.9 + 1.7);
          grassCol *= 0.55 + 0.6 * hg;    // blade tips lighter, roots darker
          grassCol *= 0.75 + 0.5 * mix(0.5, blades, lod(foot, 16.0));
          grassCol *= mix(0.7, 1.0, pow(max(n0.y, 0.0), 6.0)); // steeper banks: thinner, darker grass
          grassCol = mix(grassCol, vec3(0.42, 0.33, 0.22) * (0.8 + 0.4 * vnoise(p * 3.0)), smoothstep(0.62, 0.8, m3) * 0.8); // bare dirt
          {
            vec2 c = p * 3.0;
            vec2 id = floor(c), f = fract(c) - 0.5;
            float hh = hash21(id + 21.0);
            float fl = smoothstep(0.09, 0.04, length(f)) * step(0.985, hh) * lod(foot, 14.0);
            grassCol = mix(grassCol, hh > 0.993 ? vec3(1.0, 0.95, 0.4) : vec3(0.95, 0.95, 1.0), fl);
          }

          // ---- Grass over sand on the inland hills (ragged edge), then wet sand + foam at the water.
          float grass = vLand * smoothstep(uShoulder + 0.8, uShoulder + 3.0 + n * 3.0 + (hg - 0.5) * 1.5, y);
          vec3 col = mix(sand, grassCol, grass);
          float h = mix(hs, hg, grass);
          float wet = 1.0 - smoothstep(0.0, 1.1, y);
          col = mix(col, uWetSand * (0.92 + 0.12 * fbm(p * 0.3)), wet);
          h *= 1.0 - wet * 0.8; // wet sand is smooth
          float wash = sin(vWorld.x * 0.05 + vWorld.z * 0.04 - uTime * 0.9) * 0.25 + 0.25;
          // Foam line: never thinner than ~1.5 px (a sub-pixel band flickers far away), fading as it widens.
          float fw = max(0.12, fwidth(y) * 1.5);
          float foam = smoothstep(fw, 0.0, abs(y - wash)) * (0.6 + 0.4 * mix(0.5, vnoise(p * 2.0 + uTime), lod(foot, 2.0))) * (0.12 / fw);
          col = mix(col, vec3(1.0), foam * 0.8 * step(-0.3, y));

          // ---- Lighting: bumped normal, sun + sky/ground ambient, glossy wet sand.
          // Bump detail fades once a pixel covers more than ~half a metre (derivative bumps turn to sparkle there).
          float far = smoothstep(0.15, 1.0, foot);
          vec3 nrm = bump(n0, h, mix(0.12, 0.14, grass) * (1.0 - far));
          vec3 L = normalize(uMoonDir);
          float diff = max(dot(nrm, L), 0.0);
          vec3 sky = mix(vec3(0.55, 0.65, 0.85), uFogColor, 0.3);
          vec3 amb = mix(vec3(0.35, 0.3, 0.25), sky, nrm.y * 0.5 + 0.5) * 0.55;
          vec3 lit = col * (amb + 0.85 * diff);
          vec3 V = normalize(cameraPosition - vWorld);
          // Wet-sand sheen: a tight glint up close, a broad soft sheen far away (no glitter at the waterline).
          float shin = mix(80.0, 16.0, far);
          lit += vec3(1.0, 0.95, 0.85) * pow(max(dot(reflect(-L, nrm), V), 0.0), shin) * wet * mix(0.9, 0.35, far);
          gl_FragColor = vec4(applyAtmos(lit, vWorld), 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
  }

  /** Bilinear terrain height at (x, z). */
  heightAt(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell;
    const fz = (z - this.z0) / this.cell;
    const i = Math.max(0, Math.min(this.nx - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(this.nz - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - i));
    const tz = Math.min(1, Math.max(0, fz - j));
    const h = this.heights;
    const a = h[j * this.nx + i], b = h[j * this.nx + i + 1];
    const c = h[(j + 1) * this.nx + i], d = h[(j + 1) * this.nx + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  distance(x: number, z: number): number {
    return distToTrack(this.track, x, z, 2)[0];
  }

  inside(x: number, z: number): boolean {
    return insideTrack(this.track, x, z);
  }
}

/** Animated ocean: wave normals, fresnel sky reflection, sun glitter. */
export function createOcean(opts: { deep: string; shallow: string; skyHorizon: string; level?: number; night?: boolean }): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(16000, 16000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphere,
      uDeep: { value: new THREE.Color(opts.deep) },
      uShallow: { value: new THREE.Color(opts.shallow) },
      uSky: { value: new THREE.Color(opts.skyHorizon) },
      uNight: { value: opts.night ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uDeep, uShallow, uSky;
      uniform float uNight;
      varying vec3 vWorld;
      ${ATMOS_PARS}
      ${NOISE_GLSL}
      // Wave slope; ws = weight of the small chop (faded out where a pixel covers several metres: no aliasing).
      vec2 waveGrad(vec2 p, float t, float ws) {
        float e = 0.6;
        float h0 = fbm(p * 0.08 + vec2(t * 0.05, t * 0.03)) + 0.5 * ws * vnoise(p * 0.35 - vec2(t * 0.2, 0.0));
        float hx = fbm((p + vec2(e, 0.0)) * 0.08 + vec2(t * 0.05, t * 0.03)) + 0.5 * ws * vnoise((p + vec2(e, 0.0)) * 0.35 - vec2(t * 0.2, 0.0));
        float hz = fbm((p + vec2(0.0, e)) * 0.08 + vec2(t * 0.05, t * 0.03)) + 0.5 * ws * vnoise((p + vec2(0.0, e)) * 0.35 - vec2(t * 0.2, 0.0));
        return vec2(hx - h0, hz - h0) / e;
      }
      void main() {
        float dist = length(cameraPosition - vWorld);
        // Pixel footprint in metres (area mean, so grazing angles don't over-blur).
        float fa = length(dFdx(vWorld.xz)), fb = length(dFdy(vWorld.xz));
        float foot = max(mix(sqrt(fa * fb) * 1.3, max(fa, fb), smoothstep(15.0, 60.0, dist)), 1e-3);
        float ws = 1.0 - smoothstep(0.4, 1.4, foot * 0.35 * 4.0);   // small chop (0.35 c/m)
        float wb = 1.0 - smoothstep(0.5, 1.6, foot * 0.6);          // fbm's finest octaves
        vec2 g = waveGrad(vWorld.xz, uTime, ws) * (1.0 / (1.0 + dist / 300.0)) * mix(0.35, 1.0, wb);
        vec3 n = normalize(vec3(-g.x * 3.0, 1.0, -g.y * 3.0));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 4.0);
        vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 0.6, n.y * 0.5 + fbm(vWorld.xz * 0.01) * 0.6));
        vec3 col = mix(water, uSky, clamp(fres * 1.2, 0.0, 1.0));
        vec3 r = reflect(-v, n);
        float sun = pow(max(dot(r, normalize(uMoonDir)), 0.0), uNight > 0.5 ? 60.0 : 300.0);
        col += vec3(1.0, 0.95, 0.8) * sun * (uNight > 0.5 ? 1.2 : 6.0);
        gl_FragColor = vec4(applyAtmos(col, vWorld), 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = opts.level ?? 0;
  return m;
}
