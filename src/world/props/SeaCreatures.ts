import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATMOS_PARS, atmosphere } from '../../render/atmosphere';
import { LoopTrack, makeFrame } from '../../track/Track';
import { SEA_SHADE } from './SeaLife';

/**
 * Deep Blue extras: electric eels that zap, anglerfish with glowing lures, boxfish, pufferfish that inflate
 * when you pass, and a sunken liner. Each type is ONE merged InstancedMesh (vertex colours + emissive
 * attributes), posed on the CPU, with the swimming wobble done in the vertex shader.
 */

type V4 = [number, number, number, number];
type Col = [number, number, number];

/** Prepare one part of a merged creature: vertex colour, emissive weight, flap weight and appendage anchor. */
function part(
  g0: THREE.BufferGeometry, col: Col,
  o: { emit?: number; flap?: number | ((p: THREE.Vector3, i: number) => number); sp?: (p: THREE.Vector3, i: number) => V4 } = {},
): THREE.BufferGeometry {
  const g = g0.index ? g0.toNonIndexed() : g0;
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');
  const n = pos.count;
  const c = new Float32Array(n * 3), e = new Float32Array(n), f = new Float32Array(n), s = new Float32Array(n * 4);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(col, i * 3);
    e[i] = o.emit ?? 0;
    f[i] = typeof o.flap === 'function' ? o.flap(v, i) : o.flap ?? 0;
    if (o.sp) s.set(o.sp(v, i), i * 4);
  }
  g.setAttribute('aCol', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aEmit', new THREE.BufferAttribute(e, 1));
  g.setAttribute('aFlap', new THREE.BufferAttribute(f, 1));
  g.setAttribute('aSpike', new THREE.BufferAttribute(s, 4));
  return g;
}

function ellipsoid(rx: number, ry: number, rz: number, x = 0, y = 0, z = 0, seg = 14): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, seg, Math.max(6, seg - 4)).scale(rx, ry, rz).translate(x, y, z);
}

/** Rounded box: every vertex pushed out from the inner box by a radius. */
function roundedBox(hx: number, hy: number, hz: number, r: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2, 8, 8, 8);
  const p = g.getAttribute('position'), nr = g.getAttribute('normal');
  const v = new THREE.Vector3(), inner = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inner.set(THREE.MathUtils.clamp(v.x, -hx + r, hx - r), THREE.MathUtils.clamp(v.y, -hy + r, hy - r), THREE.MathUtils.clamp(v.z, -hz + r, hz - r));
    d.copy(v).sub(inner).normalize();
    p.setXYZ(i, inner.x + d.x * r, inner.y + d.y * r, inner.z + d.z * r);
    nr.setXYZ(i, d.x, d.y, d.z);
  }
  return g;
}

function cone(r: number, len: number, from: THREE.Vector3, dir: THREE.Vector3, seg = 5): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, len, seg, 1, false).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  return g.translate(from.x, from.y, from.z);
}

type Kind = 'eel' | 'angler' | 'box' | 'puffer' | 'wreck';

const DEFORM: Record<Kind, string> = {
  eel: `
    float t = p.z + 0.5;
    p.x += sin(uTime * 2.2 + aInst.x * 6.0 - p.z * 11.0) * (0.03 + 0.09 * pow(max(t, 0.0), 1.1));
    p.y += sin(uTime * 1.7 + aInst.x * 3.0 - p.z * 6.0) * 0.012 * t;
    vGlow = vec3(0.4, 0.85, 1.0) * aInst.y * 1.3;`,
  angler: `
    if (aFlap > 0.0) p.x += sin(uTime * 2.2 + aInst.x * 6.0 - p.z * 3.0) * aFlap * 0.12;
    else if (aFlap < 0.0) { p.x += sin(uTime * 1.5 + aInst.x) * -aFlap * 0.06; p.y += cos(uTime * 1.2 + aInst.x) * -aFlap * 0.04; }
    vGlow = aCol * aEmit * (1.6 + 0.6 * sin(uTime * 2.4 + aInst.x * 9.0)) * 1.4;`,
  box: `
    if (aFlap > 0.0) p.y += sin(uTime * 14.0 + aInst.x * 5.0 + sign(p.x) * 1.5) * aFlap * 0.06;
    else if (aFlap < 0.0) p.x += sin(uTime * 3.0 + aInst.x * 5.0) * -aFlap * 0.1;
    vGlow = vec3(0.0);`,
  puffer: `
    float k = aInst.y;
    vec3 d = aSpike.w > 0.5 ? aSpike.xyz : normalize(position);
    vec3 R = mix(vec3(0.2, 0.23, 0.55), vec3(0.46), clamp(k, 0.0, 1.0));
    vec3 bp = d * R * (1.0 + max(k - 1.0, 0.0) * 0.5);
    if (aSpike.w > 0.5) {
      vec3 off = position - d;
      float S = aSpike.w > 1.5 ? mix(0.3, 0.46, k) : smoothstep(0.4, 0.9, k) * 0.46;
      if (aFlap > 0.0) off.y += sin(uTime * 12.0 + aInst.x * 5.0 + sign(off.x) * 1.5) * aFlap * 0.15;
      if (aFlap < 0.0) off.x += sin(uTime * 4.0 + aInst.x * 5.0) * -aFlap * 0.3;
      p = bp + off * S;
      n = normalize(position);
    } else {
      p = bp;
      n = normalize(d / max(R, vec3(0.01)));
    }
    vGlow = vec3(0.0);`,
  wreck: `
    vGlow = aCol * aEmit * (0.6 + 0.4 * sin(uTime * 0.8 + position.x * 0.37 + position.z * 0.21));`,
};

// Soft sky-to-belly gradient, a warm subsurface glow in the lit side and a cyan rim, like the shark/dolphin skins.
const FISH_RIM = `
    float ndv = clamp(dot(n, normalize(cameraPosition - vWorld)), 0.0, 1.0);
    float rimF = pow(1.0 - ndv, 3.0);
    lit *= 0.82 + 0.3 * (n.y * 0.5 + 0.5);
    lit += vCol * vec3(0.5, 0.32, 0.18) * 0.18 * smoothstep(-0.2, 0.8, n.y) * (1.0 - vEmit);
    lit += vec3(0.1, 0.3, 0.36) * rimF * 0.55 * (1.0 - vEmit);`;

const RIM: Record<Kind, string> = {
  eel: FISH_RIM, angler: FISH_RIM, box: FISH_RIM, puffer: FISH_RIM,
  // Less fog on the wreck plus a faint cyan rim so the silhouette survives the murk.
  wreck: `
    lit = mix(lit, shaded * 0.55, 0.3);
    float rim = pow(1.0 - clamp(dot(n, normalize(cameraPosition - vWorld)), 0.0, 1.0), 2.5);
    lit += vec3(0.05, 0.22, 0.28) * rim * (1.0 - vEmit);`,
};

const SPOT_FRAG: Record<Kind, string> = {
  eel: '',
  angler: `
    float mott = vnoise(vLocal.xz * 11.0 + vLocal.y * 7.0);
    col *= 0.7 + 0.6 * mott;`,
  box: `
    if (vCol.r > 0.9 && vCol.b < 0.25) {
      vec3 q = vLocal * 9.0; vec3 id = floor(q);
      float h = fract(sin(dot(id, vec3(12.9, 78.2, 37.7))) * 43758.5);
      float h2 = fract(h * 91.7);
      vec3 f = fract(q) - 0.5 + (vec3(h, h2, fract(h * 7.3)) - 0.5) * 0.35;
      col = mix(col, vec3(0.06, 0.07, 0.13), step(length(f), 0.27) * step(0.35, h));
      col *= 0.85 + 0.15 * smoothstep(-0.4, 0.5, vLocal.y);
    }`,
  puffer: `
    if (vCol.r > 0.4 && vCol.r < 0.85 && vCol.g > 0.35 && vCol.b < 0.55) {
      vec3 q = vLocal * 6.0; vec3 id = floor(q);
      float h = fract(sin(dot(id, vec3(12.9, 78.2, 37.7))) * 43758.5);
      vec3 f = fract(q) - 0.5;
      col = mix(col, vec3(0.2, 0.15, 0.07), step(length(f), 0.28) * step(0.4, h) * step(0.0, vLocal.y + 0.2));
    }`,
  wreck: `
    float rn = vnoise(vWorld.xz * 0.28 + vWorld.y * 0.17) * 0.65 + vnoise(vWorld.xz * 1.3 + vWorld.y * 0.9) * 0.35;
    vec3 rust = vec3(0.32, 0.15, 0.06) * (0.6 + 0.8 * vnoise(vWorld.zy * 0.8));
    float lit0 = 1.0 - vEmit;
    col = mix(col, rust, smoothstep(0.52, 0.75, rn) * lit0 * 0.6);
    float streak = smoothstep(0.55, 0.8, vnoise(vec2(vLocal.z * 0.9, vLocal.y * 0.07 + vLocal.x * 0.02)));
    col = mix(col, rust * 1.1, streak * lit0 * smoothstep(1.5, 8.0, vLocal.y + 6.0) * 0.4);
    float up = smoothstep(0.2, 0.9, normalize(vN).y);
    col = mix(col, vec3(0.08, 0.2, 0.14) * (0.5 + rn), up * 0.15 * lit0);
    col = mix(col, vec3(0.2, 0.19, 0.15), up * up * 0.06 * lit0);
    if (!gl_FrontFacing) col *= 0.3;`,
};

function seaMaterial(kind: Kind, shine = 0.35): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      attribute vec3 aCol; attribute float aEmit; attribute float aFlap; attribute vec4 aSpike; attribute vec4 aInst;
      uniform float uTime;
      varying vec3 vWorld; varying vec3 vN; varying vec3 vCol; varying vec3 vLocal; varying vec3 vGlow; varying float vEmit;
      void main() {
        vec3 p = position; vec3 n = normal;
        ${DEFORM[kind]}
        vLocal = position; vCol = aCol; vEmit = aEmit;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying vec3 vCol; varying vec3 vLocal; varying vec3 vGlow; varying float vEmit;
      ${ATMOS_PARS}
      ${SEA_SHADE}
      void main() {
        vec3 col = vCol;
        ${SPOT_FRAG[kind]}
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        vec3 shaded = seaShade(col, n, vWorld, ${shine.toFixed(2)});
        vec3 lit = applyAtmos(shaded, vWorld);
        ${RIM[kind]}
        // Emissive is added after the fog so lures and portholes stay visibly lit.
        float fogK = clamp(length(vWorld - cameraPosition) / 300.0, 0.0, 1.0);
        gl_FragColor = vec4(lit + vGlow * (1.0 - fogK * 0.6), 1.0);
      }`,
  });
}

function instanced(geo: THREE.BufferGeometry, kind: Kind, n: number, shine?: number): { mesh: THREE.InstancedMesh; inst: THREE.InstancedBufferAttribute } {
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  inst.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < n; i++) inst.setX(i, Math.random() * 6.28);
  geo.setAttribute('aInst', inst);
  const mesh = new THREE.InstancedMesh(geo, seaMaterial(kind, shine), n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  return { mesh, inst };
}

// ------------------------------------------------------------------ shared placement

interface Spot { c: THREE.Vector3; radius: number; speed: number; phase: number; scale: number; bob: number }

/** Spots beside the road: lateral distance in [latMin, latMax] from the centre line, spread along the loop. */
function makeSpots(track: LoopTrack, n: number, latMin: number, latMax: number, yMin: number, yMax: number, scale: [number, number], radius: [number, number], rnd: () => number, offset = 0): Spot[] {
  const f = makeFrame();
  const out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    track.frameAt(((i + rnd() * 0.6 + offset) / n) * track.length, f);
    const side = rnd() < 0.5 ? 1 : -1;
    const lat = side * (latMin + rnd() * (latMax - latMin));
    const c = f.position.clone().addScaledVector(f.right, lat);
    c.y = track.height + yMin + rnd() * (yMax - yMin);
    out.push({ c, radius: radius[0] + rnd() * (radius[1] - radius[0]), speed: 0.6 + rnd() * 0.6, phase: rnd() * 6.28, scale: scale[0] + rnd() * (scale[1] - scale[0]), bob: rnd() * 6.28 });
  }
  return out;
}

const _o = new THREE.Object3D();
function poseOrbit(s: Spot, time: number, mesh: THREE.InstancedMesh, i: number, wob = 1, cw = 1): void {
  const a = ((time * s.speed * cw) / s.radius) * 3 + s.phase;
  _o.position.set(s.c.x + Math.cos(a) * s.radius, s.c.y + Math.sin(time * 0.4 + s.bob) * 1.2 * wob, s.c.z + Math.sin(a) * s.radius);
  const dx = -Math.sin(a) * cw, dz = Math.cos(a) * cw;
  _o.rotation.set(0, Math.atan2(-dx, -dz), 0);
  _o.scale.setScalar(s.scale);
  _o.updateMatrix();
  mesh.setMatrixAt(i, _o.matrix);
}

// ------------------------------------------------------------------ electric eels

function eelGeometry(): THREE.BufferGeometry {
  const N = 56, M = 10;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const head = t < 0.03 ? Math.sqrt(t / 0.03) * 0.9 : 1 + 0.12 * Math.exp(-Math.pow((t - 0.07) / 0.04, 2));
    const r = 0.021 * head * (1 - 0.8 * THREE.MathUtils.smoothstep(t, 0.5, 1)) * (t > 0.92 ? 1 - (t - 0.92) * 9 : 1) + 0.0015;
    for (let j = 0; j < M; j++) {
      const a = (j / M) * Math.PI * 2;
      pos.push(Math.cos(a) * r, Math.sin(a) * r * 1.05, t - 0.5);
      const belly = THREE.MathUtils.smoothstep(-Math.sin(a), 0.1, 0.8);
      col.push(0.13 + belly * 0.45, 0.12 + belly * 0.4, 0.06 + belly * 0.14);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + ((j + 1) % M), c = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const body = g.toNonIndexed();
  const n = body.getAttribute('position').count;
  body.setAttribute('aEmit', new THREE.BufferAttribute(new Float32Array(n), 1));
  body.setAttribute('aFlap', new THREE.BufferAttribute(new Float32Array(n), 1));
  body.setAttribute('aSpike', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  const eyes = [-1, 1].map((sx) => part(ellipsoid(0.0045, 0.0045, 0.0045, sx * 0.018, 0.009, -0.47, 8), [0.95, 0.9, 0.4]));
  const mouth = part(ellipsoid(0.013, 0.003, 0.017, 0, -0.011, -0.49, 8), [0.05, 0.02, 0.02]);
  // Long low fin ribbon down the back (and round the tail).
  const fp: number[] = [], fi: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, z = t - 0.5;
    const r = 0.021 * (1 - 0.8 * THREE.MathUtils.smoothstep(t, 0.5, 1)) + 0.0015;
    const h = t < 0.12 ? 0 : 0.011 * Math.min((t - 0.12) * 6, 1) * (1 - 0.6 * t);
    fp.push(0, r * 0.95, z, 0, r * 0.95 + h, z);
    if (i < N) fi.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  fg.setIndex(fi);
  fg.computeVertexNormals();
  const fin = part(fg, [0.3, 0.26, 0.1]);
  return mergeGeometries([body, ...eyes, mouth, fin]);
}

const EEL_SEG_ALONG = 24, EEL_BOLTS = 5, EEL_BOLT_SEG = 7;
const EEL_SEGS = (EEL_SEG_ALONG + EEL_BOLTS * EEL_BOLT_SEG) * 2;

class Eels {
  readonly group = new THREE.Group();
  readonly spots: Spot[];
  private readonly mesh: THREE.InstancedMesh;
  private readonly inst: THREE.InstancedBufferAttribute;
  private readonly lines: THREE.LineSegments;
  private readonly lpos: Float32Array;
  private readonly next: number[] = [];
  private readonly zapT: number[] = [];
  private readonly lit: boolean[] = [];
  private readonly mats: THREE.Matrix4[] = [];
  /** Test hook: zap every eel at once. */
  forceZap = false;

  constructor(track: LoopTrack, n: number, rnd: () => number) {
    this.spots = makeSpots(track, n, 30, 52, -8, 14, [7, 10], [10, 14], rnd, 0.25);
    const { mesh, inst } = instanced(eelGeometry(), 'eel', n, 0.8);
    this.mesh = mesh;
    this.inst = inst;
    for (let i = 0; i < n; i++) {
      this.next.push(1 + rnd() * 5);
      this.zapT.push(-1);
      this.lit.push(false);
      this.mats.push(new THREE.Matrix4());
    }
    this.lpos = new Float32Array(n * EEL_SEGS * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lpos, 3).setUsage(THREE.DynamicDrawUsage));
    const lm = new THREE.LineBasicMaterial({ color: new THREE.Color(1.3, 1.6, 1.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    this.lines = new THREE.LineSegments(lg, lm);
    this.lines.frustumCulled = false;
    this.group.add(mesh, this.lines);
  }

  private bodyPt(z: number, time: number, seed: number, out: THREE.Vector3): THREE.Vector3 {
    const t = z + 0.5;
    return out.set(Math.sin(time * 2.2 + seed * 6 - z * 11) * (0.03 + 0.09 * Math.pow(Math.max(t, 0), 1.1)), Math.sin(time * 1.7 + seed * 3 - z * 6) * 0.012 * t, z);
  }

  update(time: number, dt: number): void {
    const shaderT = atmosphere.uTime.value as number;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3();
    let dirty = false;
    for (let i = 0; i < this.spots.length; i++) {
      poseOrbit(this.spots[i], time, this.mesh, i, 1, i % 2 ? 1 : -1);
      this.mesh.getMatrixAt(i, this.mats[i]);
      this.next[i] -= dt;
      if (this.forceZap) { this.next[i] = 0; this.zapT[i] = this.zapT[i] < 0 ? 0.12 : this.zapT[i]; }
      if (this.next[i] <= 0) {
        if (this.zapT[i] < 0) this.zapT[i] = 0;
        this.next[i] = this.forceZap ? 0.2 : 2.5 + Math.random() * 5;
      }
      let zap = 0;
      if (this.zapT[i] >= 0) {
        this.zapT[i] += dt;
        if (this.zapT[i] > 0.55) this.zapT[i] = -1;
        else zap = Math.sqrt(Math.sin((this.zapT[i] / 0.55) * Math.PI)) * (0.55 + Math.random() * 0.45);
      }
      this.inst.setY(i, zap);
      const base = i * EEL_SEGS * 6;
      if (zap <= 0) {
        if (this.lit[i]) {
          this.lpos.fill(0, base, base + EEL_SEGS * 6);
          this.lit[i] = false;
          dirty = true;
        }
        continue;
      }
      this.lit[i] = dirty = true;
      const seed = this.inst.getX(i);
      const M = this.mats[i];
      let w = base;
      const seg = (p: THREE.Vector3, q: THREE.Vector3) => {
        for (let c = 0; c < 2; c++) {
          const o = c * 0.003;
          a.copy(p);
          b.copy(q);
          a.x += o; a.y += o; b.x += o; b.y += o;
          a.applyMatrix4(M);
          b.applyMatrix4(M);
          this.lpos[w++] = a.x; this.lpos[w++] = a.y; this.lpos[w++] = a.z;
          this.lpos[w++] = b.x; this.lpos[w++] = b.y; this.lpos[w++] = b.z;
        }
      };
      // A crackle running down the whole body.
      let prev = new THREE.Vector3(), cur = new THREE.Vector3();
      for (let j = 0; j <= EEL_SEG_ALONG; j++) {
        const z = -0.45 + (0.9 * j) / EEL_SEG_ALONG;
        this.bodyPt(z, shaderT, seed, cur);
        const jit = j === 0 || j === EEL_SEG_ALONG ? 0 : 0.02;
        cur.x += (Math.random() - 0.5) * jit * 2;
        cur.y += (Math.random() - 0.5) * jit * 2;
        if (j > 0) seg(prev, cur);
        [prev, cur] = [cur, prev];
      }
      // Bolts leaping off the body.
      for (let k = 0; k < EEL_BOLTS; k++) {
        const z = -0.4 + Math.random() * 0.85;
        this.bodyPt(z, shaderT, seed, prev);
        const ang = Math.random() * Math.PI * 2, len = 0.1 + Math.random() * 0.13;
        dir.set(Math.cos(ang), Math.sin(ang), (Math.random() - 0.5) * 0.6);
        for (let j = 1; j <= EEL_BOLT_SEG; j++) {
          const f = j / EEL_BOLT_SEG;
          this.bodyPt(z, shaderT, seed, cur);
          cur.addScaledVector(dir, len * f);
          cur.x += (Math.random() - 0.5) * 0.035;
          cur.y += (Math.random() - 0.5) * 0.035;
          cur.z += (Math.random() - 0.5) * 0.035;
          seg(prev, cur);
          prev.copy(cur);
        }
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.inst.needsUpdate = true;
    if (dirty) this.lines.geometry.getAttribute('position').needsUpdate = true;
  }
}

// ------------------------------------------------------------------ anglerfish

const LURE: Col = [0.6, 1.0, 0.92];
const LURE_AT = new THREE.Vector3(0, 0.45, -0.8);

function anglerGeometry(): THREE.BufferGeometry {
  const dark: Col = [0.05, 0.035, 0.06], dark2: Col = [0.035, 0.025, 0.05];
  const parts: THREE.BufferGeometry[] = [
    part(ellipsoid(0.38, 0.4, 0.46, 0, 0.02, 0.1, 20), dark),
    part(ellipsoid(0.27, 0.07, 0.36, 0, -0.17, -0.26, 14), [0.32, 0.02, 0.05]), // red mouth cavity
    part(ellipsoid(0.3, 0.14, 0.4, 0, -0.27, -0.24, 14), dark2), // big lower jaw
    part(ellipsoid(0.31, 0.12, 0.34, 0, -0.05, -0.28, 14), dark), // upper lip
  ];
  for (let i = 0; i < 12; i++) {
    const a = -1.25 + (i / 11) * 2.5;
    const x = Math.sin(a) * 0.27, z = -0.26 - Math.cos(a) * 0.3;
    parts.push(part(cone(0.02, 0.15, new THREE.Vector3(x, -0.13, z), new THREE.Vector3(0, -1, 0)), [0.95, 0.93, 0.85]));
    parts.push(part(cone(0.02, 0.17, new THREE.Vector3(x * 1.02, -0.27, z - 0.03), new THREE.Vector3(0, 1, 0)), [0.95, 0.93, 0.85]));
  }
  for (const sx of [-1, 1]) {
    parts.push(part(ellipsoid(0.075, 0.075, 0.075, sx * 0.25, 0.14, -0.22, 10), [0.9, 0.85, 0.5]));
    parts.push(part(ellipsoid(0.04, 0.04, 0.04, sx * 0.29, 0.15, -0.27, 8), [0.0, 0.0, 0.0]));
    parts.push(part(ellipsoid(0.2, 0.025, 0.1, sx * 0.4, -0.05, 0.1, 8), dark2));
  }
  parts.push(part(new THREE.ConeGeometry(0.2, 0.45, 8).scale(1, 1, 0.12).rotateX(Math.PI / 2).translate(0, 0, 0.62), dark2, { flap: (p) => 0.4 + (p.z - 0.4) * 2 }));
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.36, -0.1), new THREE.Vector3(0, 0.62, -0.32), new THREE.Vector3(0, 0.66, -0.62), LURE_AT.clone().add(new THREE.Vector3(0, 0.07, 0))]);
  const tube = new THREE.TubeGeometry(curve, 16, 0.012, 5);
  parts.push(part(tube, [0.15, 0.12, 0.14], { flap: (p) => -THREE.MathUtils.clamp((-p.z - 0.05) / 0.6, 0, 1) }));
  parts.push(part(ellipsoid(0.075, 0.075, 0.075, LURE_AT.x, LURE_AT.y, LURE_AT.z, 14), LURE, { emit: 1, flap: -1 }));
  return mergeGeometries(parts);
}

function haloMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPx: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aGlow;
      uniform float uPx; varying float vGlow;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uPx / max(-mv.z, 0.5), 2.0, 420.0);
        vGlow = aGlow;
      }`,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float a = pow(1.0 - r, 2.2) * 0.75 + pow(1.0 - r, 9.0) * 1.4;
        gl_FragColor = vec4(vec3(0.45, 1.0, 0.9) * a * vGlow, a * vGlow);
      }`,
  });
}

class Anglers {
  readonly group = new THREE.Group();
  readonly spots: Spot[];
  private readonly mesh: THREE.InstancedMesh;
  private readonly halo: THREE.Points;
  private readonly hp: THREE.BufferAttribute;
  private readonly hs: THREE.BufferAttribute;
  private readonly hg: THREE.BufferAttribute;
  private readonly inst: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();

  constructor(track: LoopTrack, n: number, rnd: () => number) {
    this.spots = makeSpots(track, n, 15, 38, -2, 16, [4, 5.5], [5, 9], rnd, 0.1);
    const { mesh, inst } = instanced(anglerGeometry(), 'angler', n, 0.7);
    this.mesh = mesh;
    this.inst = inst;
    const g = new THREE.BufferGeometry();
    this.hp = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.hs = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    this.hg = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.hp);
    g.setAttribute('aSize', this.hs);
    g.setAttribute('aGlow', this.hg);
    this.halo = new THREE.Points(g, haloMaterial());
    this.halo.frustumCulled = false;
    this.group.add(mesh, this.halo);
  }

  update(time: number): void {
    const mat = this.halo.material as THREE.ShaderMaterial;
    mat.uniforms.uPx.value = 0.5 * window.innerHeight * Math.min(window.devicePixelRatio || 1, 2);
    const shaderT = atmosphere.uTime.value as number;
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      poseOrbit(s, time, this.mesh, i, 1);
      this.mesh.getMatrixAt(i, this.m);
      const seed = this.inst.getX(i);
      this.v.set(Math.sin(shaderT * 1.5 + seed) * 0.06, LURE_AT.y + Math.cos(shaderT * 1.2 + seed) * 0.04, LURE_AT.z).applyMatrix4(this.m);
      this.hp.setXYZ(i, this.v.x, this.v.y, this.v.z);
      const pulse = 0.8 + 0.2 * Math.sin(shaderT * 2.4 + seed * 9);
      this.hs.setX(i, 1.7 * s.scale * pulse);
      this.hg.setX(i, pulse);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.hp.needsUpdate = this.hs.needsUpdate = this.hg.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ boxfish

function boxfishGeometry(): THREE.BufferGeometry {
  const yel: Col = [1.0, 0.72, 0.02];
  const parts: THREE.BufferGeometry[] = [part(roundedBox(0.25, 0.27, 0.4, 0.13), yel)];
  parts.push(part(ellipsoid(0.07, 0.06, 0.06, 0, -0.06, -0.47, 10), [1.0, 0.6, 0.35]));
  parts.push(part(ellipsoid(0.04, 0.025, 0.02, 0, -0.06, -0.52, 8), [0.35, 0.05, 0.07]));
  for (const sx of [-1, 1]) {
    parts.push(part(ellipsoid(0.07, 0.07, 0.04, sx * 0.19, 0.1, -0.31, 10), [0.95, 0.95, 0.9]));
    parts.push(part(ellipsoid(0.04, 0.04, 0.03, sx * 0.22, 0.1, -0.34, 8), [0.0, 0.0, 0.0]));
    parts.push(part(new THREE.ConeGeometry(0.1, 0.18, 4).scale(0.15, 1, 1).rotateZ(sx * 1.7).translate(sx * 0.33, -0.02, -0.12), [1.0, 0.75, 0.2], { flap: 1 }));
  }
  parts.push(part(new THREE.ConeGeometry(0.13, 0.25, 4).scale(0.12, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.52), [1.0, 0.75, 0.2], { flap: -1 }));
  return mergeGeometries(parts);
}

class Boxfish {
  readonly group = new THREE.Group();
  readonly spots: Spot[];
  private readonly mesh: THREE.InstancedMesh;
  constructor(track: LoopTrack, n: number, rnd: () => number) {
    this.spots = makeSpots(track, n, 13, 30, -4, 12, [2.4, 3.2], [2, 4], rnd, 0.4);
    this.mesh = instanced(boxfishGeometry(), 'box', n, 0.85).mesh;
    this.group.add(this.mesh);
  }
  update(time: number): void {
    for (let i = 0; i < this.spots.length; i++) poseOrbit(this.spots[i], time * 0.55, this.mesh, i, 1.4);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ pufferfish

function pufferGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Body: unit sphere (the shader stretches it into a slim fish or a ball). Back tan, belly cream.
  const bodyG = new THREE.SphereGeometry(1, 26, 18).toNonIndexed();
  const bp = bodyG.getAttribute('position');
  const bc = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i) / Math.hypot(bp.getX(i), bp.getY(i), bp.getZ(i));
    const t = THREE.MathUtils.smoothstep(y, 0.0, -0.4);
    bc.set([0.42 + t * 0.3, 0.38 + t * 0.3, 0.16 + t * 0.34], i * 3);
  }
  bodyG.deleteAttribute('uv');
  bodyG.setAttribute('aCol', new THREE.BufferAttribute(bc, 3));
  for (const [nm, sz] of [['aEmit', 1], ['aFlap', 1], ['aSpike', 4]] as const) bodyG.setAttribute(nm, new THREE.BufferAttribute(new Float32Array(bp.count * sz), sz));
  parts.push(bodyG);
  // Spikes on a Fibonacci sphere.
  const SP = 56;
  for (let i = 0; i < SP; i++) {
    const y = 1 - ((i + 0.5) / SP) * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    const d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    if (d.z < -0.82 || d.z > 0.88) continue;
    parts.push(part(cone(0.1, 0.62, d.clone().multiplyScalar(0.96), d, 5), [0.78, 0.7, 0.42], { sp: () => [d.x, d.y, d.z, 1] }));
  }
  const attach = (g: THREE.BufferGeometry, d: THREE.Vector3, col: Col, flap = 0) => {
    d.normalize();
    parts.push(part(g, col, { flap, sp: () => [d.x, d.y, d.z, 2] }));
  };
  for (const sx of [-1, 1]) {
    const de = new THREE.Vector3(sx * 0.55, 0.3, -0.7).normalize();
    attach(ellipsoid(0.2, 0.2, 0.17, de.x, de.y, de.z, 10), de.clone(), [0.97, 0.97, 0.9]);
    attach(ellipsoid(0.12, 0.12, 0.1, de.x + sx * 0.08, de.y + 0.02, de.z - 0.08, 8), de.clone(), [0.0, 0.0, 0.0]);
    const dp = new THREE.Vector3(sx * 0.95, -0.1, -0.2).normalize();
    attach(ellipsoid(0.34, 0.03, 0.22, dp.x + sx * 0.25, dp.y, dp.z, 8), dp.clone(), [0.95, 0.85, 0.5], 1);
  }
  const dm = new THREE.Vector3(0, -0.05, -1);
  attach(ellipsoid(0.12, 0.09, 0.1, dm.x, dm.y, dm.z - 0.05, 8), dm.clone(), [0.55, 0.15, 0.15]);
  attach(new THREE.ConeGeometry(0.35, 0.8, 6).scale(0.12, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, 1.35), new THREE.Vector3(0, 0, 1), [0.9, 0.8, 0.45], -1);
  return mergeGeometries(parts);
}

const easeOutBack = (t: number) => 1 + 2.9 * Math.pow(t - 1, 3) + 1.9 * Math.pow(t - 1, 2);

class Puffers {
  readonly group = new THREE.Group();
  readonly spots: Spot[];
  private readonly mesh: THREE.InstancedMesh;
  private readonly inst: THREE.InstancedBufferAttribute;
  private readonly st: number[] = [];
  private readonly tm: number[] = [];
  private readonly hold: number[] = [];
  private readonly p = new THREE.Vector3();
  constructor(track: LoopTrack, n: number, rnd: () => number) {
    this.spots = makeSpots(track, n, 12, 22, -2, 10, [3, 4], [2, 4], rnd, 0.7);
    const r = instanced(pufferGeometry(), 'puffer', n, 0.3);
    this.mesh = r.mesh;
    this.inst = r.inst;
    for (let i = 0; i < n; i++) {
      this.st.push(0);
      this.tm.push(0);
      this.hold.push(4);
    }
    this.group.add(this.mesh);
  }
  update(time: number, dt: number, viewer: THREE.Vector3): void {
    for (let i = 0; i < this.spots.length; i++) {
      poseOrbit(this.spots[i], time * (this.st[i] === 0 ? 0.6 : 0.2), this.mesh, i, 0.8);
      this.mesh.getMatrixAt(i, _o.matrix);
      this.p.setFromMatrixPosition(_o.matrix);
      this.tm[i] += dt;
      let k = 0;
      switch (this.st[i]) {
        case 0:
          if (this.tm[i] > 3 && this.p.distanceTo(viewer) < 25) {
            this.st[i] = 1;
            this.tm[i] = 0;
            this.hold[i] = 3 + Math.random() * 2.5;
          }
          break;
        case 1:
          k = easeOutBack(Math.min(this.tm[i] / 0.25, 1));
          if (this.tm[i] > 0.25) { this.st[i] = 2; this.tm[i] = 0; }
          break;
        case 2:
          k = 1 + 0.02 * Math.sin(this.tm[i] * 7);
          if (this.tm[i] > this.hold[i]) { this.st[i] = 3; this.tm[i] = 0; }
          break;
        default:
          k = 1 - THREE.MathUtils.smoothstep(this.tm[i] / 3, 0, 1);
          if (this.tm[i] > 3) { this.st[i] = 0; this.tm[i] = 0; k = 0; }
      }
      this.inst.setY(i, k);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.inst.needsUpdate = true;
  }
  /** Test hook: inflate everything now and keep it puffed. */
  forcePuff(): void {
    for (let i = 0; i < this.st.length; i++) { this.st[i] = 1; this.tm[i] = 0; this.hold[i] = 600; }
  }
}

// ------------------------------------------------------------------ sunken liner

const HULL_L = 240;
const hullHalfWidth = (z: number): number => {
  const u = (z + HULL_L / 2) / HULL_L;
  const bow = Math.pow(Math.min(u / 0.2, 1), 0.65);
  const stern = u > 0.88 ? 1 - Math.pow((u - 0.88) / 0.12, 2) * 0.55 : 1;
  return 13 * bow * stern + 0.05;
};
const hullTop = (z: number): number => 9 + 3.5 * Math.pow(1 - (z + HULL_L / 2) / HULL_L, 2.5);

/** Hull skin between stations z0..z1 of a 240 m liner (bow at -z). */
function hullSection(z0: number, z1: number, col: Col): THREE.BufferGeometry {
  const M = 64, N = Math.max(12, Math.round(Math.abs(z1 - z0) / 2));
  const bot = (z: number) => { const u = (z + HULL_L / 2) / HULL_L; return -8 + (u < 0.2 ? ((0.2 - u) / 0.2) * 11 : 0); };
  const sg = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const z = z0 + ((z1 - z0) * i) / N, w = hullHalfWidth(z), t = hullTop(z), b = bot(z);
    for (let j = 0; j < M; j++) {
      const a = (j / M) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const y = (t + b) / 2 + ((t - b) / 2) * sg(s, s >= 0 ? 0.4 : 0.75);
      pos.push(w * sg(c, 0.6), y, z);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + ((j + 1) % M), c = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const base = part(g, col);
  const p = base.getAttribute('position'), c = base.getAttribute('aCol') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -2.5) c.setXYZ(i, 0.35, 0.07, 0.05); // red boot-topping
  return base;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, col: Col): THREE.BufferGeometry {
  return part(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col);
}

function funnel(x: number, z: number, rake = 0.12, roll = 0.03): THREE.BufferGeometry[] {
  const buff: Col = [0.85, 0.66, 0.2], black: Col = [0.04, 0.04, 0.04];
  const a = part(new THREE.CylinderGeometry(4.2, 4.8, 32, 16).scale(1, 1, 1.55).translate(0, 16, 0), buff);
  const b = part(new THREE.CylinderGeometry(4.3, 4.2, 7, 16).scale(1, 1, 1.55).translate(0, 35.5, 0), black);
  const m = new THREE.Matrix4();
  m.makeRotationFromEuler(new THREE.Euler(rake, 0, roll)).setPosition(x, 9, z);
  a.applyMatrix4(m);
  b.applyMatrix4(m);
  return [a, b];
}

/** Low-poly anonymous human silhouette, ~1.8 units tall, facing -Z. `pose` 0 = arms spread wide, 1 = arms forward/down. */
function ghostFigure(pose: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(0.42, 0.62, 0.22).translate(0, 1.15, 0),
    new THREE.IcosahedronGeometry(0.16, 1).translate(0, 1.64, 0),
    new THREE.BoxGeometry(0.17, 0.85, 0.17).translate(-0.11, 0.42, 0),
    new THREE.BoxGeometry(0.17, 0.85, 0.17).translate(0.11, 0.42, 0),
  ];
  for (const sx of [-1, 1]) {
    const arm = new THREE.BoxGeometry(0.62, 0.12, 0.12).translate(sx * 0.31, 0, 0);
    if (pose === 0) arm.rotateZ(sx * 0.08).translate(sx * 0.2, 1.38, 0);
    else arm.rotateY(sx * 0.9).rotateZ(sx * -0.35).translate(sx * 0.22, 1.1, -0.05);
    parts.push(arm);
  }
  return mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }));
}

function ghostMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: atmosphere.uTime },
    vertexShader: /* glsl */ `
      uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vH;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.9 + p.y * 1.5) * 0.04 * p.y;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz; vH = p.y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vH;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = (0.3 + 0.6 * f) * (0.8 + 0.2 * sin(uTime * 1.7 + vH * 3.0)) * (0.55 + 0.45 * smoothstep(0.0, 1.8, vH));
        gl_FragColor = vec4(vec3(0.55, 0.95, 1.0) * a, a);
      }`,
  });
}

/** Glowing canvas sprite: text with a down-pointing arrow underneath (same look as the .EXE labels). */
function arrowLabel(text: string, color: string, height: number): THREE.Sprite {
  const font = 'bold 96px Consolas, "Courier New", monospace';
  const c = document.createElement('canvas');
  let g = c.getContext('2d')!;
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 80;
  c.height = 280;
  g = c.getContext('2d')!;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const draw = (blur: number, fill: string) => {
    g.shadowColor = color;
    g.shadowBlur = blur;
    g.fillStyle = fill;
    g.fillText(text, c.width / 2, 84);
    g.beginPath();
    const cx = c.width / 2;
    g.moveTo(cx - 20, 150);
    g.lineTo(cx + 20, 150);
    g.lineTo(cx + 20, 200);
    g.lineTo(cx + 55, 200);
    g.lineTo(cx, 268);
    g.lineTo(cx - 55, 200);
    g.lineTo(cx - 20, 200);
    g.closePath();
    g.fill();
  };
  draw(26, color);
  draw(6, '#ffffff');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  sp.scale.set(height * (c.width / c.height), height, 1);
  return sp;
}

/** Rows of window holes along both sides of a deck box; a few still lit. */
function deckWindows(list: THREE.BufferGeometry[], hw: number, z0: number, z1: number, y: number, rnd: () => number): void {
  for (let z = z0; z < z1; z += 3.4) {
    for (const sx of [-1, 1]) {
      const lit = rnd() < 0.12;
      list.push(part(new THREE.PlaneGeometry(1.7, 2).rotateY((sx * Math.PI) / 2).translate(sx * (hw + 0.06), y, z), lit ? [1.0, 0.75, 0.35] : [0.02, 0.025, 0.03], { emit: lit ? 0.8 : 0 }));
    }
  }
}

/** Deck railing along both sides between z0 and z1. */
function railings(list: THREE.BufferGeometry[], z0: number, z1: number): void {
  for (const sx of [-1, 1]) {
    for (let z = z0; z < z1; z += 2) {
      const w = hullHalfWidth(z) - 0.5, y = hullTop(z);
      const w2 = hullHalfWidth(z + 2) - 0.5, y2 = hullTop(z + 2);
      if (w < 1) continue;
      list.push(box(0.14, 0.14, 2.05, 0, 0, 0, [0.35, 0.3, 0.25]).translate((sx * (w + w2)) / 2, (y + y2) / 2 + 1.3, z + 1));
      if (((z - z0) / 2) % 3 === 0) list.push(box(0.12, 1.3, 0.12, 0, 0, 0, [0.3, 0.26, 0.22]).translate(sx * w, y + 0.65, z));
    }
  }
}

/** A broken-in-two liner. Returns one merged mesh, ~230 m long, lying along local Z (bow toward -Z). */
export function createWreck(): THREE.Mesh {
  const hull: Col = [0.045, 0.05, 0.055], white: Col = [0.5, 0.5, 0.46];
  const bow: THREE.BufferGeometry[] = [hullSection(-120, 8, hull)];
  const stern: THREE.BufferGeometry[] = [hullSection(14, 120, hull)];
  // Bow: bridge forward, a long deckhouse under three funnels, masts.
  bow.push(box(20, 6, 22, 0, 12.5, -88, white), box(16, 5, 14, 0, 18, -88, white), box(18, 1.5, 10, 0, 21.5, -88, [0.2, 0.2, 0.18]));
  bow.push(box(24, 6, 76, 0, 12.5, -26, white), box(20, 5.5, 54, 0, 18, -24, white));
  bow.push(...funnel(0, -50), ...funnel(0, -28), ...funnel(0, -6));
  bow.push(part(new THREE.CylinderGeometry(0.5, 0.8, 42, 6).translate(0, 30, -108), [0.15, 0.1, 0.07]));
  // Stern: aft deckhouse with the 4th funnel (cracked, leaning hard), aft mast.
  stern.push(box(24, 6, 60, 0, 12.5, 45, white), box(20, 5.5, 44, 0, 18, 45, white), box(15, 5, 30, 0, 23, 45, white));
  stern.push(...funnel(0, 32, 0.36, 0.12));
  stern.push(part(new THREE.CylinderGeometry(0.4, 0.7, 34, 6).translate(0, 26, 108), [0.15, 0.1, 0.07]));
  // Portholes along the hull, a few still lit.
  let seed = 77;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const portholes = (list: THREE.BufferGeometry[], z0: number, z1: number) => {
    for (let z = z0; z < z1; z += 3.2) {
      for (const sx of [-1, 1]) {
        for (const y of [4.5, 1.5]) {
          const w = hullHalfWidth(z);
          if (w < 6) continue;
          const lit = rnd() < 0.11;
          list.push(part(new THREE.CircleGeometry(0.45, 8).rotateY((sx * Math.PI) / 2).translate(sx * (w + 0.12), y, z), lit ? [1.0, 0.72, 0.3] : [0.03, 0.03, 0.03], { emit: lit ? 1 : 0 }));
        }
      }
    }
  };
  // Window rows on every deck.
  const wr = (() => { let q = 31; return () => (q = (q * 16807) % 2147483647) / 2147483647; })();
  deckWindows(bow, 10, -98, -78, 12.5, wr);
  deckWindows(bow, 8, -94, -82, 18, wr);
  deckWindows(bow, 12, -62, 10, 12.5, wr);
  deckWindows(bow, 10, -50, 2, 18, wr);
  deckWindows(stern, 12, 18, 74, 12.5, wr);
  deckWindows(stern, 10, 25, 66, 18, wr);
  deckWindows(stern, 7.5, 32, 58, 23, wr);
  railings(bow, -118, -100);
  railings(bow, -76, -64);
  railings(stern, 76, 112);
  portholes(bow, -90, 6);
  portholes(stern, 16, 112);
  // Two halves, each tilted and half buried; the stern has twisted away.
  // The bow section rises out of the sand at an angle, pivoting about its broken end.
  const bowM = new THREE.Matrix4()
    .makeTranslation(0, 0, 8)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.3, -0.04, 0.16)))
    .multiply(new THREE.Matrix4().makeTranslation(0, -3, -8));
  const sternM = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.1, 0.2, -0.28)).setPosition(8, -2, 4);
  const all = [...bow.map((g) => g.applyMatrix4(bowM)), ...stern.map((g) => g.applyMatrix4(sternM))];
  const { mesh } = instanced(mergeGeometries(all), 'wreck', 1, 0.15);
  _o.position.set(0, 0, 0);
  _o.rotation.set(0, 0, 0);
  _o.scale.setScalar(1.2);
  _o.updateMatrix();
  mesh.setMatrixAt(0, _o.matrix);

  // Two faint ghosts on the very tip of the bow: one leading with arms spread, one holding her waist.
  const ghostMat = ghostMaterial();
  const tipY = hullTop(-103) + 0.2;
  for (const [pose, z] of [[0, -103], [1, -97.5]] as const) {
    const gm = new THREE.Mesh(ghostFigure(pose), ghostMat);
    gm.scale.setScalar(10.5);
    gm.position.set(0, tipY, z).applyMatrix4(bowM);
    gm.quaternion.setFromRotationMatrix(bowM);
    gm.frustumCulled = false;
    mesh.add(gm);
  }
  const tag = arrowLabel('TITANIC', '#7af0ff', 46);
  tag.position.set(0, 95, -24);
  mesh.add(tag);
  return mesh;
}

// ------------------------------------------------------------------ public

export class OceanCreatures {
  readonly group = new THREE.Group();
  readonly eels: Eels;
  readonly anglers: Anglers;
  readonly boxfish: Boxfish;
  readonly puffers: Puffers;

  constructor(track: LoopTrack, rnd: () => number, quality: string) {
    const low = quality === 'low';
    this.eels = new Eels(track, low ? 3 : 5, rnd);
    this.anglers = new Anglers(track, low ? 4 : 7, rnd);
    this.boxfish = new Boxfish(track, low ? 5 : 8, rnd);
    this.puffers = new Puffers(track, low ? 4 : 6, rnd);
    this.group.name = 'ocean-creatures';
    this.group.add(this.eels.group, this.anglers.group, this.boxfish.group, this.puffers.group);
  }

  update(time: number, dt: number, viewer: THREE.Vector3): void {
    this.eels.update(time, dt);
    this.anglers.update(time);
    this.boxfish.update(time);
    this.puffers.update(time, dt, viewer);
  }
}
