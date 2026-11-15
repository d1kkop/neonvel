import * as THREE from 'three';
import { ATMOS_PARS, atmosphere } from '../../render/atmosphere';
import { isMobile } from '../../render/Renderer';

/**
 * Procedural palm tree (high detail): S-curved ringed trunk, two layers of drooping fronds
 * with a curled cross-section and alpha-tested leaflets, plus a coconut cluster.
 * Drawn instanced; all palms lean and sway downwind with travelling gusts.
 */
function palmGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const H = 9.5;
  const trunkAt = (t: number) => new THREE.Vector3(1.4 * t * t - 0.25 * Math.sin(t * Math.PI), H * t, 0.18 * Math.sin(t * Math.PI * 1.5));

  // Trunk: 24 rings x 12 sides, bulging ring bands.
  const rings = 24, sides = 12;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const c = trunkAt(t);
    const base = 0.36 - 0.16 * t + (t < 0.06 ? (0.06 - t) * 2.5 : 0); // flared foot
    const rad = base * (r % 2 ? 1.0 : 1.07);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      pos.push(c.x + Math.cos(a) * rad, c.y, c.z + Math.sin(a) * rad);
      uv.push(s / sides, t);
      part.push(0);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * (sides + 1) + s;
      const b = a + sides + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  // Fronds: 14 in two layers, 18 segments long, 5 vertices across (curled).
  const top = trunkAt(1);
  const fronds = 14, segs = 18, across = 5;
  for (let f = 0; f < fronds; f++) {
    const upper = f % 2 === 0;
    const yaw = (f / fronds) * Math.PI * 2 + (upper ? 0 : 0.22);
    const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const L = (upper ? 4.0 : 4.8) + ((f * 7) % 3) * 0.35;
    const lift = upper ? 1.5 : 0.7;
    const droop = upper ? 2.0 : 2.9;
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const c = top.clone().addScaledVector(dir, t * L);
      c.y += Math.sin(t * Math.PI * 0.55) * lift - t * t * droop + 0.1;
      const w = 0.95 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.04)) * (1 - t * 0.25);
      for (let k = 0; k < across; k++) {
        const u = k / (across - 1) * 2 - 1; // -1..1
        const p = c.clone().addScaledVector(side, u * w);
        p.y -= u * u * w * 0.35; // curl: edges hang lower than the rib
        pos.push(p.x, p.y, p.z);
        uv.push((u + 1) / 2, t);
        part.push(1);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let k = 0; k < across - 1; k++) {
        const a = base + i * across + k;
        const b = a + across;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  // Coconuts: small spheres under the crown.
  const nut = new THREE.SphereGeometry(0.17, 8, 6);
  const np = nut.getAttribute('position');
  const ni = nut.getIndex()!;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const off = new THREE.Vector3(top.x + Math.cos(a) * 0.32, top.y - 0.35 - (k % 2) * 0.15, top.z + Math.sin(a) * 0.32);
    const base = pos.length / 3;
    for (let i = 0; i < np.count; i++) {
      pos.push(np.getX(i) + off.x, np.getY(i) + off.y, np.getZ(i) + off.z);
      uv.push(0.5, 0.5);
      part.push(2);
    }
    for (let i = 0; i < ni.count; i++) idx.push(base + ni.getX(i));
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface PalmPlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
}

/** Shared wind for all palms: direction (xz) and strength 0..2. */
export const palmWind = {
  uWindDir: { value: new THREE.Vector2(1, 0.35).normalize() },
  uWindStrength: { value: 1.0 },
};

export function createPalms(
  list: PalmPlacement[],
  colors: { trunk: string; frond: string; frondTip: string } = { trunk: '#7a5236', frond: '#2f8a3a', frondTip: '#9acb4a' },
): THREE.InstancedMesh {
  const geo = palmGeometry();
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    // Smooth leaf edges with MSAA; mobile (no MSAA) falls back to a hard cut-out.
    alphaToCoverage: !isMobile,
    defines: isMobile ? { HARD_CUTOUT: 1 } : {},
    uniforms: {
      ...atmosphere,
      ...palmWind,
      uTrunk: { value: new THREE.Color(colors.trunk) },
      uFrond: { value: new THREE.Color(colors.frond) },
      uTip: { value: new THREE.Color(colors.frondTip) },
    },
    vertexShader: /* glsl */ `
      attribute float aPart;
      varying vec2 vUv; varying float vPart; varying vec3 vWorld; varying vec3 vNormal;
      uniform float uTime, uWindStrength;
      uniform vec2 uWindDir;
      void main() {
        vUv = uv; vPart = aPart;
        vec3 p = position;
        mat4 m = modelMatrix * instanceMatrix;
        vec3 inst = instanceMatrix[3].xyz;
        float phase = inst.x * 0.13 + inst.z * 0.07;
        // Wind in the palm's local frame (instance may be rotated / scaled).
        vec3 wl = normalize((inverse(mat3(m)) * vec3(uWindDir.x, 0.0, uWindDir.y)) * vec3(1.0, 0.0, 1.0) + 1e-5);
        // Gusts travel across the world.
        float gust = 0.6 + 0.4 * sin(dot(inst.xz, uWindDir) * 0.02 - uTime * 1.3) + 0.25 * sin(uTime * 0.37 + phase);
        float h = clamp(p.y / 10.0, 0.0, 1.3);
        float bend = (0.55 + 0.75 * gust) * uWindStrength * h * h;
        float sway = sin(uTime * 1.6 + phase) * 0.35 + sin(uTime * 2.9 + phase * 1.7) * 0.12;
        p += wl * (bend + sway * uWindStrength * h * h);
        p.y -= bend * 0.15 * h;
        if (aPart > 0.5 && aPart < 1.5) {
          // Fronds flutter, stronger toward the tip; windward fronds get lifted and blown over.
          float t = uv.y;
          float flutter = sin(uTime * 7.0 + phase * 3.0 + t * 6.0 + uv.x * 3.0) * 0.18 + sin(uTime * 11.0 + t * 9.0) * 0.06;
          p.y += flutter * t * uWindStrength * (0.6 + gust);
          p += wl * t * t * 0.9 * uWindStrength * gust;
        }
        vec4 w = m * vec4(p, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTrunk, uFrond, uTip;
      varying vec2 vUv; varying float vPart; varying vec3 vWorld; varying vec3 vNormal;
      ${ATMOS_PARS}
      void main() {
        vec3 col;
        float alpha = 1.0;
        if (vPart < 0.5) {
          float rc = vUv.y * 44.0;
          float ring = smoothstep(0.32, 0.5, abs(fract(rc) - 0.5));
          ring = mix(ring, 0.4, smoothstep(0.3, 0.8, fwidth(rc))); // fade sub-pixel rings
          float fibre = 0.9 + 0.1 * sin(vUv.x * 80.0 + vUv.y * 13.0);
          col = uTrunk * (0.7 + 0.4 * ring) * fibre * mix(0.75, 1.05, vUv.y);
        } else if (vPart < 1.5) {
          // Solid leaf (no see-through gaps): only the outer edge is lightly serrated where the leaflet
          // tips end; the leaflets themselves are drawn as shading lines across the surface.
          float across = abs(vUv.x - 0.5) * 2.0;
          float cc = vUv.y * 46.0 + across * 2.2;
          float fw = max(fwidth(cc), 1e-4);
          float lines = smoothstep(0.0, 0.5 + fw, abs(fract(cc) - 0.5) * 2.0);
          lines = mix(lines, 0.5, smoothstep(0.35, 0.9, fw)); // fade the lines out far away
          float fwe = max(fwidth(across), 1e-4);
          float limit = 1.0 - vUv.y * 0.35 - 0.1 * fract(cc) * smoothstep(0.35, 0.9, across) * (1.0 - smoothstep(0.35, 0.9, fw));
          float edge = 1.0 - smoothstep(limit - fwe, limit + fwe, across);
          alpha = edge;
          #ifdef HARD_CUTOUT
            if (alpha < 0.5) discard;
            alpha = 1.0;
          #else
            if (alpha < 0.02) discard;
          #endif
          col = mix(uFrond, uTip, vUv.y * 0.75 + across * 0.25);
          col *= 0.8 + 0.25 * (1.0 - across);
          col *= 0.82 + 0.18 * lines; // leaflet lines
          if (across < 0.08) col *= 0.75; // darker rib
        } else {
          col = vec3(0.32, 0.22, 0.1);
        }
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        float diff = max(dot(n, normalize(uMoonDir)), 0.0);
        // Light shining through the leaves.
        float trans = vPart > 0.5 && vPart < 1.5 ? max(dot(-n, normalize(uMoonDir)), 0.0) * 0.35 : 0.0;
        vec3 lit = col * (0.42 + 0.85 * diff + trans);
        gl_FragColor = vec4(applyAtmos(lit, vWorld), alpha);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  list.forEach((pl, i) => {
    q.setFromAxisAngle(up, pl.yaw);
    m.compose(p.set(pl.x, pl.y, pl.z), q, s.setScalar(pl.scale));
    mesh.setMatrixAt(i, m);
  });
  mesh.count = list.length;
  mesh.computeBoundingSphere();
  return mesh;
}
