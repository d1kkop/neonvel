import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATMOS_PARS, atmosphere, NOISE_GLSL } from '../../render/atmosphere';

/**
 * Snow level props: four tree species (tall spruce, wide fir, young pine, bare birch) with irregular drooping
 * branch tiers, per-instance size / lean / tint / snow load; plus snowballs, snowmen, rocks and drifts.
 * Everything shares one lit shader with blue snow shading and view-dependent sparkle.
 */

export type TreeKind = 'spruce' | 'fir' | 'young' | 'birch';
export interface TreePlacement { x: number; y: number; z: number; yaw: number; scale: number; kind: TreeKind; /** 0..1 */ snow: number; lean?: number; stretch?: number; /** Far from the road: low-detail shape. */ far?: boolean }
export interface SnowObject { x: number; y: number; z: number; yaw: number; sx: number; sy: number; sz: number }

// Part ids (aInfo.x): 0 foliage, 1 bark, 2 birch bark, 3 snow, 4 rock, 5 carrot, 6 coal, 7 wood (sticks).
function tag(geo: THREE.BufferGeometry, part: number, ao: (x: number, y: number, z: number) => number = () => 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  const info = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    info[i * 2] = part;
    info[i * 2 + 1] = ao(p.getX(i), p.getY(i), p.getZ(i));
  }
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
  return g;
}

/** Deterministic hash 0..1. */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * One branch tier: a cone whose rim is cut into drooping branch tips (N lobes, jittered) and sagging down.
 * Inner vertices get a low ambient-occlusion value so the tree reads as layered, not as a stack of cones.
 */
function tier(r: number, h: number, y: number, lobes: number, jag: number, droop: number, seed: number, seg = 3): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, lobes * seg, seg, true);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), yy = p.getY(i), z = p.getZ(i);
    const t = (h / 2 - yy) / h; // 0 top .. 1 rim
    const a = Math.atan2(z, x);
    const lobe = Math.pow(Math.abs(Math.sin((a * lobes) / 2 + seed)), 0.6);
    const jit = 0.85 + 0.3 * hash(Math.round(a * 40), seed);
    const k = (1 - jag * (1 - lobe) * t) * (t > 0.99 ? jit : 1 + (jit - 1) * t);
    const dr = Math.hypot(x, z) * k;
    const sag = droop * t * t * (0.6 + 0.4 * lobe);
    p.setXYZ(i, Math.cos(a) * dr, yy - sag, Math.sin(a) * dr);
  }
  g.computeVertexNormals();
  g.translate(0, y, 0);
  return tag(g, 0, (px, _py, pz) => {
    const rr = Math.hypot(px, pz) / r;
    return 0.35 + 0.65 * Math.min(1, rr * 1.2);
  });
}

function conifer(tiers: number, height: number, baseR: number, topR: number, lobes: number, jag: number, droop: number, trunkR: number, seed: number, seg = 3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunkH = height * 0.32;
  parts.push(tag(new THREE.CylinderGeometry(trunkR * 0.55, trunkR, trunkH + height * 0.4, 12, 1, true).translate(0, (trunkH + height * 0.4) / 2, 0), 1));
  const y0 = trunkH * 0.7;
  const span = height - y0;
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1);
    const r = baseR + (topR - baseR) * Math.pow(f, 0.85);
    const th = (span / tiers) * 2.1 * (1 - f * 0.25);
    const y = y0 + span * Math.pow(f, 0.95) + th * 0.5;
    parts.push(tier(r * (0.92 + 0.16 * hash(i, seed)), th, y, lobes, jag, droop * (1 - f * 0.6) * r, seed + i * 1.7, seg));
  }
  // Leader spike.
  parts.push(tag(new THREE.ConeGeometry(topR * 0.5, height * 0.12, 8).translate(0, height + height * 0.02, 0), 0, () => 0.9));
  return mergeGeometries(parts);
}

function birch(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const H = 8.5;
  // Slightly bent trunk from three tapered segments.
  let base = new THREE.Vector3(0, 0, 0);
  let r = 0.2;
  const up = new THREE.Vector3(0, 1, 0);
  for (let s = 0; s < 3; s++) {
    const len = H / 3;
    const dir = new THREE.Vector3((hash(s, seed) - 0.5) * 0.25, 1, (hash(seed, s) - 0.5) * 0.25).normalize();
    const g = new THREE.CylinderGeometry(r * 0.75, r, len, 12, 2, true).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(base.x, base.y, base.z);
    parts.push(tag(g, 2, () => 1));
    base = base.clone().addScaledVector(dir, len);
    r *= 0.75;
  }
  // Branches: thin, angled up, with a pair of twigs each.
  for (let i = 0; i < 9; i++) {
    const h = 2.6 + i * 0.62;
    const a = i * 2.4 + seed;
    const len = 2.4 * (1 - i / 12);
    const dir = new THREE.Vector3(Math.cos(a), 0.9 + hash(i, seed) * 0.5, Math.sin(a)).normalize();
    const g = new THREE.CylinderGeometry(0.02, 0.06, len, 6, 1, true).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(0, h, 0);
    parts.push(tag(g, 7, () => 0.8));
    for (const k of [0.55, 0.8]) {
      const d2 = dir.clone().add(new THREE.Vector3(Math.cos(a + 1.3 * (k > 0.6 ? 1 : -1)), 0.6, Math.sin(a + 1.3))).normalize();
      const t = new THREE.CylinderGeometry(0.01, 0.025, len * 0.45, 5, 1, true).translate(0, len * 0.225, 0);
      t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d2));
      t.translate(dir.x * len * k, h + dir.y * len * k, dir.z * len * k);
      parts.push(tag(t, 7, () => 0.8));
    }
  }
  return mergeGeometries(parts);
}

function snowman(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ball = (r: number, y: number) => tag(new THREE.IcosahedronGeometry(r, 4).scale(1, 0.94, 1).translate(0, y, 0), 3, (_x, yy) => (yy < y - r * 0.5 ? 0.6 : 1));
  parts.push(ball(0.62, 0.55), ball(0.45, 1.45), ball(0.32, 2.1));
  parts.push(tag(new THREE.ConeGeometry(0.06, 0.4, 10).rotateX(Math.PI / 2).translate(0, 2.08, 0.5), 5));
  for (const s of [-1, 1]) {
    parts.push(tag(new THREE.IcosahedronGeometry(0.045, 1).translate(s * 0.12, 2.2, 0.28), 6));
    const arm = new THREE.CylinderGeometry(0.02, 0.035, 1.0, 6).rotateZ(s * -1.1).translate(s * 0.82, 1.62, 0);
    parts.push(tag(arm, 7));
  }
  for (let i = 0; i < 3; i++) parts.push(tag(new THREE.IcosahedronGeometry(0.05, 1).translate(0, 1.25 + i * 0.2, 0.43 - Math.abs(i - 1) * 0.02), 6));
  return mergeGeometries(parts);
}

function lumpySphere(detail: number, amp: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const n = hash(Math.round(v.x * 9) + seed, Math.round(v.y * 9) * 7 + Math.round(v.z * 9) * 13);
    v.multiplyScalar(1 + (n - 0.5) * amp);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

let sharedMat: THREE.ShaderMaterial | null = null;
function snowMaterial(): THREE.ShaderMaterial {
  if (sharedMat) return sharedMat;
  sharedMat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      attribute vec2 aInfo; attribute vec3 aTint; attribute float aSnow;
      varying vec2 vInfo; varying vec3 vTint; varying float vSnow;
      varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNormalW;
      uniform float uTime;
      void main() {
        vInfo = aInfo; vTint = aTint; vSnow = aSnow; vLocal = position;
        vec3 p = position;
        mat4 m = modelMatrix * instanceMatrix;
        // A breath of wind in the tree tops.
        if (aInfo.x < 0.5 || aInfo.x > 6.5) {
          vec3 inst = instanceMatrix[3].xyz;
          float sway = sin(uTime * 0.8 + inst.x * 0.05 + inst.z * 0.07) * 0.03 * max(0.0, p.y - 3.0) / 6.0;
          p.x += sway;
        }
        vec4 w = m * vec4(p, 1.0);
        vWorld = w.xyz;
        vNormalW = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vInfo; varying vec3 vTint; varying float vSnow;
      varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNormalW;
      ${ATMOS_PARS}
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vNormalW);
        if (!gl_FrontFacing) n = -n;
        vec3 L = normalize(uMoonDir);
        vec3 V = normalize(cameraPosition - vWorld);
        float part = vInfo.x, ao = vInfo.y;
        float dist = length(cameraPosition - vWorld);
        float ang = atan(vLocal.z, vLocal.x);
        vec3 col;
        float snow = 0.0;
        if (part < 0.5) {
          // Needles: tinted dark green, branch striations from the trunk outwards, layered occlusion.
          float stri = vnoise(vec2(ang * 14.0, length(vLocal.xz) * 5.0 + vLocal.y * 2.0));
          col = vTint * (0.75 + 0.45 * stri) * (0.9 + 0.2 * vnoise(vWorld.xz * 0.7));
          col *= ao;
          float top = smoothstep(0.15, 0.75, n.y);
          float patchy = smoothstep(0.62 - vSnow * 0.5, 0.95 - vSnow * 0.3, vnoise(vWorld.xz * 2.2 + vLocal.y * 1.3) * 0.7 + stri * 0.3);
          snow = top * patchy * (0.35 + 0.65 * vSnow);
          snow = max(snow, smoothstep(0.92, 1.0, ao) * top * vSnow * 0.6); // tips catch snow
        } else if (part < 1.5) {
          float bark = vnoise(vec2(ang * 6.0, vLocal.y * 2.5)) * 0.6 + vnoise(vec2(ang * 18.0, vLocal.y * 9.0)) * 0.4;
          col = mix(vec3(0.16, 0.11, 0.08), vec3(0.3, 0.24, 0.2), bark);
        } else if (part < 2.5) {
          // Birch: chalk-white bark with dark horizontal lenticels and darker base.
          float mark = step(0.72, vnoise(vec2(ang * 3.0, vLocal.y * 7.0))) * step(0.4, vnoise(vec2(ang * 9.0, vLocal.y * 2.0)));
          col = mix(vec3(0.86, 0.85, 0.82), vec3(0.08, 0.07, 0.07), mark);
          col = mix(vec3(0.25, 0.22, 0.2), col, smoothstep(0.2, 1.4, vLocal.y));
          snow = smoothstep(0.6, 0.9, n.y) * vSnow;
        } else if (part < 3.5) {
          col = vec3(0.93, 0.95, 1.0) * ao;
          snow = 1.0;
        } else if (part < 4.5) {
          float g = vnoise(vWorld.xz * 3.0 + vWorld.y) * 0.6 + vnoise(vWorld.xz * 11.0) * 0.4;
          col = vTint * (0.7 + 0.5 * g);
          snow = smoothstep(0.35, 0.65, n.y + (vnoise(vWorld.xz * 1.5) - 0.5) * 0.4) * (0.5 + 0.5 * vSnow);
        } else if (part < 5.5) {
          col = vec3(1.0, 0.42, 0.08);
        } else if (part < 6.5) {
          col = vec3(0.03);
        } else {
          col = vec3(0.24, 0.19, 0.15) * (0.8 + 0.3 * vnoise(vLocal.xy * 20.0));
          snow = smoothstep(0.7, 0.95, n.y) * vSnow * 0.8;
        }
        vec3 snowCol = vec3(0.93, 0.95, 1.0);
        col = mix(col, snowCol, clamp(snow, 0.0, 1.0));
        float diff = max(dot(n, L), 0.0);
        // Snow is lit with a cold blue ambient (sky light in the shadows), the rest with a neutral one.
        vec3 amb = mix(vec3(0.35), vec3(0.32, 0.4, 0.58), snow);
        vec3 lit = col * (amb + 0.85 * diff);
        if (snow > 0.3) {
          // Glints: tiny facets that flash as the view moves; only up close (no far-field shimmer).
          vec3 cell = floor(vWorld * 26.0);
          float h = fract(sin(dot(cell + floor(V * 14.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float glint = step(0.985, h) * (1.0 - smoothstep(8.0, 40.0, dist)) * snow;
          lit += vec3(0.9, 0.95, 1.0) * glint * (0.6 + 1.6 * pow(max(dot(reflect(-L, n), V), 0.0), 4.0));
          lit += vec3(0.6, 0.7, 0.9) * pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.12 * snow; // soft sheen
        }
        gl_FragColor = vec4(applyAtmos(lit, vWorld), 1.0);
      }`,
  });
  return sharedMat;
}

function instances(geo: THREE.BufferGeometry, list: { m: THREE.Matrix4; tint: THREE.Color; snow: number }[]): THREE.InstancedMesh {
  const n = Math.max(1, list.length);
  const tint = new Float32Array(n * 3), snow = new Float32Array(n);
  list.forEach((it, i) => { tint.set([it.tint.r, it.tint.g, it.tint.b], i * 3); snow[i] = it.snow; });
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  geo.setAttribute('aSnow', new THREE.InstancedBufferAttribute(snow, 1));
  const mesh = new THREE.InstancedMesh(geo, snowMaterial(), n);
  list.forEach((it, i) => mesh.setMatrixAt(i, it.m));
  mesh.count = list.length;
  mesh.computeBoundingSphere();
  return mesh;
}


function matrix(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, leanX = 0, leanZ = 0): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(leanX, yaw, leanZ, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}

const NEEDLES = ['#1d3a28', '#22442e', '#1a3326', '#26402f', '#1f3a33', '#2b4630', '#173024'].map((c) => new THREE.Color(c));

/** All the trees of the snow level (one instanced mesh per species, two shape variants each). */
export function createSnowTrees(list: TreePlacement[]): THREE.Group {
  const g = new THREE.Group();
  const variants: Record<TreeKind, THREE.BufferGeometry[]> = {
    spruce: [conifer(10, 11, 3.0, 0.4, 11, 0.28, 0.55, 0.24, 1.3), conifer(12, 13, 2.7, 0.35, 12, 0.32, 0.6, 0.22, 4.1)],
    fir: [conifer(7, 8, 3.8, 0.8, 9, 0.22, 0.35, 0.3, 2.2), conifer(6, 7, 4.1, 1.0, 8, 0.2, 0.3, 0.32, 7.7)],
    young: [conifer(5, 3.4, 1.7, 0.3, 8, 0.25, 0.4, 0.1, 3.3)],
    birch: [birch(1.0), birch(5.0)],
  };
  // Low-detail stand-ins for the far slopes (same silhouettes, fewer tiers / segments).
  const farVariants: Record<TreeKind, THREE.BufferGeometry[]> = {
    spruce: [conifer(6, 11, 3.0, 0.4, 7, 0.25, 0.5, 0.24, 1.3, 2)],
    fir: [conifer(4, 8, 3.8, 0.8, 6, 0.2, 0.3, 0.3, 2.2, 2)],
    young: [conifer(3, 3.4, 1.7, 0.3, 6, 0.22, 0.35, 0.1, 3.3, 2)],
    birch: [birch(3.0)],
  };
  const groups: [TreeKind, THREE.BufferGeometry[], boolean][] = [];
  for (const kind of Object.keys(variants) as TreeKind[]) groups.push([kind, variants[kind], false], [kind, farVariants[kind], true]);
  for (const [kind, geos, far] of groups) {
    geos.forEach((geo, vi) => {
      const items = list.filter((t, i) => t.kind === kind && !!t.far === far && i % geos.length === vi);
      if (!items.length) return;
      g.add(instances(geo, items.map((t, k) => {
        const st = t.stretch ?? 1;
        const lean = t.lean ?? 0;
        return {
          m: matrix(t.x, t.y, t.z, t.yaw, t.scale, t.scale * st, t.scale, lean * Math.cos(t.yaw), lean * Math.sin(t.yaw)),
          tint: NEEDLES[k % NEEDLES.length].clone().multiplyScalar(0.85 + 0.3 * hash(t.x, t.z)),
          snow: t.snow,
        };
      })));
    });
  }
  return g;
}

/** Snowballs (lumpy), half-buried drifts, snowmen and snow-capped rocks. */
export function createSnowObjects(o: { balls: SnowObject[]; drifts: SnowObject[]; snowmen: SnowObject[]; rocks: SnowObject[] }): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.Color('#ffffff');
  const ballGeo = tag(lumpySphere(3, 0.1, 3), 3, (_x, y) => 0.75 + 0.25 * Math.min(1, (y + 1) / 1.2));
  if (o.balls.length) g.add(instances(ballGeo, o.balls.map((b) => ({ m: matrix(b.x, b.y, b.z, b.yaw, b.sx, b.sy, b.sz), tint: white, snow: 1 }))));
  const driftGeo = tag(lumpySphere(3, 0.25, 9), 3, (_x, y) => 0.8 + 0.2 * Math.min(1, (y + 1) / 1.5));
  if (o.drifts.length) g.add(instances(driftGeo, o.drifts.map((b) => ({ m: matrix(b.x, b.y, b.z, b.yaw, b.sx, b.sy, b.sz), tint: white, snow: 1 }))));
  if (o.snowmen.length) g.add(instances(snowman(), o.snowmen.map((b) => ({ m: matrix(b.x, b.y, b.z, b.yaw, b.sx, b.sy, b.sz), tint: white, snow: 1 }))));
  const rockGeo = tag(lumpySphere(2, 0.45, 17), 4);
  const greys = ['#4a4c55', '#3e3f46', '#55575e', '#45434a'].map((c) => new THREE.Color(c));
  if (o.rocks.length) g.add(instances(rockGeo, o.rocks.map((b, i) => ({ m: matrix(b.x, b.y, b.z, b.yaw, b.sx, b.sy, b.sz), tint: greys[i % greys.length], snow: 0.6 + 0.4 * hash(b.x, b.z) }))));
  return g;
}
