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
  lines?: { color: string; spacing: number; strength: number; fromHeight?: number };
}

export interface TerrainOptions {
  /** Height function. d = distance to the track centre line, inside = inside the loop. */
  height: (x: number, z: number, d: number, inside: boolean, roadY: number) => number;
  palette: TerrainPalette;
  margin?: number;
  cell?: number;
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
    const cell = (this.cell = opts.cell ?? 14);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.samples) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this.x0 = minX - margin;
    this.z0 = minZ - margin;
    const nx = (this.nx = Math.ceil((maxX - minX + margin * 2) / cell) + 1);
    const nz = (this.nz = Math.ceil((maxZ - minZ + margin * 2) / cell) + 1);
    this.heights = new Float32Array(nx * nz);
    const s = track.samples;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = this.x0 + i * cell, z = this.z0 + j * cell;
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
        const roadY = THREE.MathUtils.lerp(s[bk].y, track.height, THREE.MathUtils.smoothstep(d, 60, 420));
        this.heights[j * nx + i] = opts.height(x, z, d, insideTrack(track, x, z), roadY);
      }
    }
    const geo = new THREE.PlaneGeometry((nx - 1) * cell, (nz - 1) * cell, nx - 1, nz - 1);
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
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld; varying vec3 vNormal;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz; vNormal = normal;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLow, uMid, uHigh, uSteep, uLineColor;
        uniform float uMidAt, uHighAt, uLineSpacing, uLineStrength, uLineFrom;
        varying vec3 vWorld; varying vec3 vNormal;
        ${ATMOS_PARS}
        ${NOISE_GLSL}
        void main() {
          vec3 n = normalize(vNormal);
          float y = vWorld.y + (fbm(vWorld.xz * 0.02) - 0.5) * 8.0;
          vec3 col = mix(uLow, uMid, smoothstep(uMidAt - 4.0, uMidAt + 4.0, y));
          col = mix(col, uHigh, smoothstep(uHighAt - 6.0, uHighAt + 6.0, y));
          col = mix(col, uSteep, smoothstep(0.82, 0.6, n.y));
          col *= 0.85 + 0.3 * vnoise(vWorld.xz * 0.3);
          float diff = max(dot(n, normalize(uMoonDir)), 0.0);
          vec3 lit = col * (0.4 + 0.8 * diff);
          if (uLineStrength > 0.0) {
            // Wireframe-ish grid: contour lines + a world-space grid.
            vec2 g = vWorld.xz / uLineSpacing;
            vec2 fw = max(fwidth(g), vec2(1e-4));
            vec2 dd = abs(fract(g - 0.5) - 0.5) / fw;
            float grid = 1.0 - min(min(dd.x, dd.y), 1.0);
            lit += uLineColor * grid * uLineStrength * smoothstep(uLineFrom, uLineFrom + 18.0, vWorld.y);
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
  const s = (a: number, b: number) => {
    const h = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453;
    return h - Math.floor(h);
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
