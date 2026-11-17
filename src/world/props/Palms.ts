import * as THREE from 'three';
import { ATMOS_PARS, NOISE_GLSL, atmosphere } from '../../render/atmosphere';
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
  const seg: number[] = [];
  const idx: number[] = [];
  const H = 9.5;
  const trunkAt = (t: number) => new THREE.Vector3(1.4 * t * t - 0.25 * Math.sin(t * Math.PI), H * t, 0.18 * Math.sin(t * Math.PI * 1.5));

  // Trunk: stacked leaf-scar segments. Each segment flares out toward its top and ends in a small
  // ledge (two rows at almost the same height), rings are slightly tilted and irregular per segment.
  const segCount = isMobile ? 26 : 46;
  const rowF = isMobile ? [0, 0.5, 0.93] : [0, 0.45, 0.85, 0.95];
  const sides = isMobile ? 12 : 16;
  const rnd = (k: number) => { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  let row = 0;
  for (let k = 0; k < segCount; k++) {
    const tilt = (rnd(k) - 0.5) * 0.09, tiltA = rnd(k + 50) * Math.PI * 2;
    const wob = 0.025 + rnd(k + 90) * 0.03, wobA = rnd(k + 130) * Math.PI * 2;
    const last = k === segCount - 1;
    const rows = last ? [...rowF, 1] : rowF;
    for (const f of rows) {
      const t = Math.min(1, (k + f) / segCount);
      const c = trunkAt(t);
      const base = 0.36 - 0.16 * t + (t < 0.07 ? (0.07 - t) * 2.8 : 0); // flared foot
      // segment profile: pinched at the bottom, swelling into a lip at the top
      const prof = 0.97 + 0.05 * f * f - (f > 0.9 ? (f - 0.9) * 0.3 : 0);
      for (let s2 = 0; s2 <= sides; s2++) {
        const a = (s2 / sides) * Math.PI * 2;
        const rad = base * prof * (1 + wob * Math.sin(a * 2 + wobA) + 0.02 * Math.sin(a * 5 + k));
        const dy = tilt * base * Math.cos(a - tiltA) * (f > 0.5 ? 1 : 0.6);
        pos.push(c.x + Math.cos(a) * rad, c.y + dy, c.z + Math.sin(a) * rad);
        uv.push(s2 / sides, t);
        part.push(0);
        seg.push(f);
      }
      row++;
    }
  }
  for (let r = 0; r < row - 1; r++) {
    for (let s2 = 0; s2 < sides; s2++) {
      const a = r * (sides + 1) + s2;
      const b = a + sides + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  // Old frond stubs (leaf bases) ringing the top of the trunk under the crown.
  const stubs = isMobile ? 8 : 14, ss = 6;
  for (let k = 0; k < stubs; k++) {
    const t = 0.87 + (k % 3) * 0.035 + rnd(k + 200) * 0.02;
    const c = trunkAt(t);
    const yaw = (k / stubs) * Math.PI * 2 * 2.618;
    const out = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const dir = out.clone().multiplyScalar(0.75).add(new THREE.Vector3(0, 0.66 + rnd(k + 300) * 0.3, 0)).normalize();
    const sideV = new THREE.Vector3(-out.z, 0, out.x);
    const upV = new THREE.Vector3().crossVectors(dir, sideV).normalize();
    const r0 = 0.2 - 0.16 * t;
    const len = 0.35 + rnd(k + 400) * 0.25;
    const base = pos.length / 3;
    for (let i = 0; i <= 3; i++) {
      const f = i / 3;
      const cc = c.clone().addScaledVector(out, r0 * 0.8).addScaledVector(dir, f * len);
      const w = (0.15 - 0.08 * f), th = (0.04 - 0.025 * f);
      for (let j = 0; j <= ss; j++) {
        const a = (j / ss) * Math.PI * 2;
        const p = cc.clone().addScaledVector(sideV, Math.cos(a) * w).addScaledVector(upV, Math.sin(a) * th);
        pos.push(p.x, p.y, p.z);
        uv.push(j / ss, f);
        part.push(3);
        seg.push(0);
      }
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < ss; j++) {
      const a = base + i * (ss + 1) + j, b = a + ss + 1;
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
        seg.push(0);
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
  const nut = new THREE.SphereGeometry(0.17, 12, 9);
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
      seg.push(0);
    }
    for (let i = 0; i < ni.count; i++) idx.push(base + ni.getX(i));
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aSeg', new THREE.Float32BufferAttribute(seg, 1));
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
      attribute float aPart, aSeg;
      varying vec2 vUv; varying float vPart, vSeg, vSeed; varying vec3 vWorld; varying vec3 vNormal;
      uniform float uTime, uWindStrength;
      uniform vec2 uWindDir;
      void main() {
        vUv = uv; vPart = aPart; vSeg = aSeg;
        vec3 p = position;
        mat4 m = modelMatrix * instanceMatrix;
        vec3 inst = instanceMatrix[3].xyz;
        vSeed = fract(sin(dot(inst.xz, vec2(12.9898, 78.233))) * 43758.5453);
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
      varying vec2 vUv; varying float vPart, vSeg, vSeed; varying vec3 vWorld; varying vec3 vNormal;
      ${ATMOS_PARS}
      ${NOISE_GLSL}
      // Noise that wraps around the trunk (u = 0..1 around): blend two samples so the seam matches.
      float wrapNoise(vec2 uvq, float k, float ky) {
        vec2 a = vec2(uvq.x * k, uvq.y * ky);
        return mix(vnoise(a), vnoise(a - vec2(k, 0.0)), uvq.x);
      }
      float lodF(vec2 k, vec2 fw) { return 1.0 - smoothstep(0.25, 0.8, max(k.x * fw.x, k.y * fw.y)); }
      vec3 bumpN(vec3 n, float h, float k) {
        vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
        vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
        float det = dot(dpx, r1);
        vec2 dh = vec2(dFdx(h), dFdy(h)) * k;
        return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
      }
      void main() {
        vec3 col;
        float alpha = 1.0;
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        if (vPart < 0.5) {
          // Bark: grey-brown, a dark scar band at each segment's foot, a pale worn lip at its top,
          // vertical fibres and cracks (bump), lichen patches, a darker foot, fibrous brown below the crown.
          vec2 px = vec2(min(fwidth(vUv.x), 0.05), fwidth(vUv.y)); // uv per pixel (seam jump clamped)
          float f = vSeg;
          float fib = wrapNoise(vUv, 110.0, 34.0);
          float fib2 = wrapNoise(vUv + 0.37, 240.0, 70.0);
          float crack = smoothstep(0.72, 0.9, wrapNoise(vUv + 0.71, 150.0, 40.0)) * smoothstep(0.35, 0.6, wrapNoise(vUv + 1.3, 20.0, 60.0));
          float sub = abs(fract(vUv.y * 92.0) - 0.5) * 2.0; // finer ring scars between the segment ledges
          float subL = lodF(vec2(0.0, 92.0), px);
          float h = 0.25 * sub * subL + 0.35 * fib * lodF(vec2(110.0, 34.0), px) + 0.2 * fib2 * lodF(vec2(240.0, 70.0), px) - 0.6 * crack * lodF(vec2(150.0, 40.0), px) + 0.5 * f;
          n = bumpN(n, h, 0.012);
          float lum = dot(uTrunk, vec3(0.3, 0.59, 0.11));
          vec3 bark = mix(uTrunk, vec3(lum) * vec3(1.12, 1.08, 1.0), 0.4);
          bark *= 0.88 + 0.24 * vSeed;
          bark *= 0.82 + 0.36 * wrapNoise(vUv + 0.2, 5.0, 26.0);         // tone patches along the trunk
          bark *= 0.86 + 0.28 * mix(0.5, fib, lodF(vec2(110.0, 34.0), px));
          bark *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.2, f));            // scar band
          bark = mix(bark, vec3(lum * 1.45), smoothstep(0.7, 0.92, f) * 0.35); // weathered lip
          bark *= 1.0 - 0.4 * crack * lodF(vec2(150.0, 40.0), px);
          float lichen = smoothstep(0.7, 0.85, wrapNoise(vUv + vSeed, 34.0, 160.0)) * smoothstep(0.45, 0.65, wrapNoise(vUv + 3.0, 4.0, 14.0)) * (1.0 - smoothstep(0.25, 0.6, vUv.y));
          bark = mix(bark, vec3(lum) * vec3(0.95, 1.05, 0.85), lichen * 0.45 * lodF(vec2(34.0, 160.0), px));
          bark *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.3, sub)) * subL;
          bark *= mix(0.55, 1.0, smoothstep(0.0, 0.07, vUv.y));             // damp, dirty foot
          bark = mix(bark, vec3(0.34, 0.23, 0.13) * (0.8 + 0.4 * fib), smoothstep(0.84, 0.96, vUv.y));
          col = bark;
        } else if (vPart > 2.5) {
          // Frond stubs: fibrous dry leaf bases.
          float fibs = vnoise(vec2(vUv.x * 30.0, vUv.y * 6.0));
          n = bumpN(n, fibs, 0.006);
          col = vec3(0.26, 0.17, 0.09) * (0.7 + 0.45 * fibs) * mix(0.55, 1.0, vUv.y);
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
