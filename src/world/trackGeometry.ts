import * as THREE from 'three';
import { ATMOS_PARS, atmosphere } from '../render/atmosphere';
import { LoopTrack, makeFrame } from '../track/Track';

export interface ExtrudeOpts {
  /** Connect the last profile point back to the first. */
  closedProfile?: boolean;
  /** Distance range along the track (defaults to the whole loop). */
  d0?: number;
  d1?: number;
  /** Sampling step in metres. */
  step?: number;
}

/**
 * Extrude a cross-section profile (pairs of [lateral, height] relative to the road centre)
 * along the track. UV: u = metres along the profile, v = metres along the track.
 */
export function extrude(track: LoopTrack, profile: [number, number][], opts: ExtrudeOpts = {}): THREE.BufferGeometry {
  const d0 = opts.d0 ?? 0;
  const d1 = opts.d1 ?? track.length;
  const step = opts.step ?? 2;
  const n = Math.max(1, Math.ceil((d1 - d0) / step));
  const frame = makeFrame();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const segs = opts.closedProfile ? profile.length : profile.length - 1;
  let uAcc = 0;
  for (let s = 0; s < segs; s++) {
    const [la, ha] = profile[s];
    const [lb, hb] = profile[(s + 1) % profile.length];
    const segLen = Math.hypot(lb - la, hb - ha);
    const start = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const d = d0 + ((d1 - d0) * i) / n;
      track.frameAt(d, frame);
      const p = frame.position;
      const r = frame.right;
      pos.push(p.x + r.x * la, p.y + ha, p.z + r.z * la);
      pos.push(p.x + r.x * lb, p.y + hb, p.z + r.z * lb);
      uv.push(uAcc, d, uAcc + segLen, d);
    }
    for (let i = 0; i < n; i++) {
      const a = start + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    uAcc += segLen;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Profile for a closed rectangle centred at (lat, h). */
export function rectProfile(lat: number, h: number, w: number, hgt: number): [number, number][] {
  return [
    [lat - w / 2, h - hgt / 2],
    [lat + w / 2, h - hgt / 2],
    [lat + w / 2, h + hgt / 2],
    [lat - w / 2, h + hgt / 2],
  ];
}

/**
 * Emissive strip material. `dash` = [period metres, duty 0..1]; period 0 = continuous.
 * Uses the extrude UV v (metres along track) for dashing.
 */
export function neonStripMaterial(color: THREE.ColorRepresentation, intensity: number, dash: [number, number] = [0, 1]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      ...atmosphere,
      uColor: { value: new THREE.Color(color).multiplyScalar(intensity) },
      uDash: { value: new THREE.Vector2(dash[0], dash[1]) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec2 uDash;
      varying vec2 vUv;
      varying vec3 vWorld;
      ${ATMOS_PARS}
      void main() {
        float on = 1.0;
        if (uDash.x > 0.0) {
          float f = fract(vUv.y / uDash.x);
          on = smoothstep(0.0, 0.03, f) * (1.0 - smoothstep(uDash.y - 0.03, uDash.y, f));
        }
        vec3 c = uColor * max(on, 0.04);
        gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
      }`,
  });
}
