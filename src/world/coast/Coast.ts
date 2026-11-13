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
  /** Size of a terrain cell in metres. */
  cell: number;
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
    this.cell = opts.cell;
    this.x0 = minX - margin;
    this.z0 = minZ - margin;
    this.nx = Math.ceil((maxX - minX + margin * 2) / opts.cell) + 1;
    this.nz = Math.ceil((maxZ - minZ + margin * 2) / opts.cell) + 1;
    const nx = this.nx, nz = this.nz;
    this.heights = new Float32Array(nx * nz);
    const land = new Float32Array(nx * nz);
    const hw = track.width / 2;

    const noise = (x: number, z: number) =>
      Math.sin(x * 0.006) * Math.cos(z * 0.0051) * 0.5 + Math.sin(x * 0.013 + z * 0.011) * 0.3 + Math.sin(z * 0.023 - x * 0.007) * 0.2;

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = this.x0 + i * opts.cell;
        const z = this.z0 + j * opts.cell;
        const [d, ry] = distToTrack(track, x, z);
        const inside = insideTrack(track, x, z);
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
        land[j * nx + i] = inside ? 1 : 0;
      }
    }

    const geo = new THREE.PlaneGeometry((nx - 1) * opts.cell, (nz - 1) * opts.cell, nx - 1, nz - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.x0 + ((nx - 1) * opts.cell) / 2, 0, this.z0 + ((nz - 1) * opts.cell) / 2);
    const pos = geo.getAttribute('position');
    const landAttr = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) {
      const i = Math.round((pos.getX(k) - this.x0) / opts.cell);
      const j = Math.round((pos.getZ(k) - this.z0) / opts.cell);
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
        void main() {
          float n = fbm(vWorld.xz * 0.05);
          float y = vWorld.y;
          vec3 col = uSand * (0.9 + 0.2 * vnoise(vWorld.xz * 0.8));
          // Grass on the inland hills.
          float grass = vLand * smoothstep(uShoulder + 0.8, uShoulder + 3.0 + n * 3.0, y);
          col = mix(col, uGrass * (0.7 + 0.5 * n), grass);
          // Wet sand near the waterline + animated foam wash.
          float wet = 1.0 - smoothstep(0.0, 1.1, y);
          col = mix(col, uWetSand, wet);
          float wash = sin(vWorld.x * 0.05 + vWorld.z * 0.04 - uTime * 0.9) * 0.25 + 0.25;
          float foam = smoothstep(0.12, 0.0, abs(y - wash)) * (0.6 + 0.4 * vnoise(vWorld.xz * 2.0 + uTime));
          col = mix(col, vec3(1.0), foam * 0.8 * step(-0.3, y));
          vec3 nrm = normalize(vNormal);
          float diff = max(dot(nrm, normalize(uMoonDir)), 0.0);
          vec3 lit = col * (0.45 + 0.75 * diff);
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
      vec2 waveGrad(vec2 p, float t) {
        float e = 0.6;
        float h0 = fbm(p * 0.08 + vec2(t * 0.05, t * 0.03)) + 0.5 * vnoise(p * 0.35 - vec2(t * 0.2, 0.0));
        float hx = fbm((p + vec2(e, 0.0)) * 0.08 + vec2(t * 0.05, t * 0.03)) + 0.5 * vnoise((p + vec2(e, 0.0)) * 0.35 - vec2(t * 0.2, 0.0));
        float hz = fbm((p + vec2(0.0, e)) * 0.08 + vec2(t * 0.05, t * 0.03)) + 0.5 * vnoise((p + vec2(0.0, e)) * 0.35 - vec2(t * 0.2, 0.0));
        return vec2(hx - h0, hz - h0) / e;
      }
      void main() {
        float dist = length(cameraPosition - vWorld);
        vec2 g = waveGrad(vWorld.xz, uTime) * (1.0 / (1.0 + dist / 300.0));
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
