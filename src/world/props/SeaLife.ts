import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATMOS_PARS, atmosphere, NOISE_GLSL } from '../../render/atmosphere';
import { loft } from '../../game/car/CarBuilder';
import { LoopTrack, makeFrame, TrackFrame } from '../../track/Track';

/**
 * Deep Blue sea life: big sharks (with a jaw that opens), a dolphin pod that gets hunted
 * and schools of fish that scatter from sharks.
 * Everything is CPU-posed so the creatures can react to each other.
 */

type Player = { s: number; x: number; v: number };

/**
 * Underwater skin lighting: wrapped sun from the surface, cyan/sand hemisphere, caustic light dancing over the
 * upward-facing skin, a wet two-lobe specular, fresnel sheen and rim. `bumpK` adds fine skin relief.
 */
const SEA_SHADE = /* glsl */ `
${NOISE_GLSL}
float caustic(vec2 p, float t) {
  // Two drifting ridged noise layers multiplied: the bright net of lines sunlight makes through waves.
  float a = 1.0 - abs(vnoise(p * 0.9 + vec2(t * 0.35, t * 0.2)) * 2.0 - 1.0);
  float b = 1.0 - abs(vnoise(p * 1.3 - vec2(t * 0.25, -t * 0.3) + 7.3) * 2.0 - 1.0);
  return pow(a * b, 3.0);
}
vec3 skinBump(vec3 n, vec3 wp, float k) {
  if (k <= 0.0) return n;
  float h = vnoise(wp.xz * 9.0 + wp.y * 5.0) * 0.6 + vnoise(wp.zy * 23.0) * 0.4;
  vec3 sx = dFdx(wp), sy = dFdy(wp);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2) * k;
  return normalize(abs(det) * n - grad);
}
vec3 seaShade(vec3 albedo, vec3 n, vec3 wp, float shine) {
  vec3 L = normalize(vec3(0.2, 1.0, 0.3));
  vec3 V = normalize(cameraPosition - wp);
  float ndl = dot(n, L);
  float wrap = max((ndl + 0.45) / 1.45, 0.0);
  vec3 hemi = mix(vec3(0.07, 0.15, 0.19), vec3(0.32, 0.56, 0.62), n.y * 0.5 + 0.5);
  vec3 H = normalize(L + V);
  float nh = max(dot(n, H), 0.0);
  float spec = (pow(nh, 70.0) * 1.2 + pow(nh, 14.0) * 0.25) * shine;
  float fres = pow(clamp(1.0 - dot(n, V), 0.0, 1.0), 4.0);
  float cau = caustic(wp.xz * 0.35 + wp.y * 0.1, uTime) * smoothstep(-0.1, 0.6, n.y);
  vec3 lit = albedo * (hemi + vec3(0.85, 0.97, 1.0) * wrap * 0.7 + vec3(0.7, 0.95, 1.0) * cau * 0.55);
  return lit + vec3(0.75, 0.95, 1.0) * spec * 0.7 + vec3(0.25, 0.5, 0.6) * fres * (0.08 + 0.12 * shine);
}`;

/** A fin with real thickness: extruded and rounded off with a bevel. */
function thickFin(pts: [number, number][], thick: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  // Straight outline (a spline overshoots into loops at sharp fin tips); the bevel rounds the edges.
  sh.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) sh.lineTo(x, y);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick * 0.4, bevelEnabled: true, bevelThickness: thick * 0.3, bevelSize: thick * 0.45, bevelSegments: 4, curveSegments: 28 });
  g.translate(0, 0, -thick * 0.2);
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

/** Signed shortest distance a-b along a closed loop. */
function loopDiff(a: number, b: number, length: number): number {
  let d = (a - b) % length;
  if (d > length / 2) d -= length;
  if (d < -length / 2) d += length;
  return d;
}

function flatShape(pts: [number, number][]): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) s.lineTo(p[0], p[1]);
  const g = new THREE.ShapeGeometry(s);
  g.deleteAttribute('uv');
  return g;
}

/** Track-relative coordinates of a world point, refining a running estimate of its distance `s`. */
function trackLocal(track: LoopTrack, p: THREE.Vector3, s: number, f: TrackFrame): { s: number; lat: number; h: number } {
  track.frameAt(s, f);
  const tmp = _v.copy(p).sub(f.position);
  s += tmp.dot(f.forward);
  track.frameAt(s, f);
  tmp.copy(p).sub(f.position);
  return { s: ((s % track.length) + track.length) % track.length, lat: tmp.dot(f.right), h: tmp.y };
}
const _v = new THREE.Vector3();

// ------------------------------------------------------------------ sharks

/** Lofted shark, 1 unit long, nose toward -Z. aJaw: 0 upper half, 1 lower half, 0.5 on the mouth seam. */
export function sharkGeometry(): THREE.BufferGeometry {
  const around = 64;
  const along = 120;
  const body = loft(
    [
      [0.0, 0.025, -0.02, 0.05], [0.05, 0.07, -0.055, 0.5], [0.13, 0.105, -0.085, 0.82], [0.25, 0.125, -0.1, 1.0],
      [0.45, 0.11, -0.09, 0.88], [0.7, 0.065, -0.05, 0.46], [0.88, 0.035, -0.025, 0.2], [1.0, 0.025, -0.015, 0.1],
    ],
    { length: 1, halfWidth: 0.09, exp: 2.2, tumble: 0, along, around },
  );
  // Which half of the cross-section each vertex is on (relative to that ring's middle).
  const pos = body.getAttribute('position');
  const ringMid = new Map<number, number>();
  const ringVerts = (along + 1) * around;
  for (let r = 0; r <= along; r++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < around; j++) {
      const y = pos.getY(r * around + j);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    ringMid.set(Math.round(pos.getZ(r * around) * 1e4), (lo + hi) / 2);
  }
  const jaw = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const zKey = Math.round(pos.getZ(i) * 1e4);
    const mid = ringMid.get(zKey) ?? 0;
    const dy = pos.getY(i) - mid;
    jaw[i] = i >= ringVerts && Math.abs(dy) < 1e-4 ? 0.5 : dy < -1e-4 ? 1 : dy > 1e-4 ? 0 : 0.5;
  }
  body.setAttribute('aJaw', new THREE.BufferAttribute(jaw, 1));
  const fin = (pts: [number, number][], z: number, rotZ = 0, y = 0) => {
    const g = thickFin(pts, 0.012).rotateY(Math.PI / 2).rotateZ(rotZ).translate(0, y, z);
    g.setAttribute('aJaw', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
    return g;
  };
  const parts = [
    body.toNonIndexed(),
    fin([[0.06, 0], [-0.02, 0.15], [-0.1, 0.17], [-0.14, 0]], -0.04, 0, 0.1), // tall swept dorsal fin
    fin([[0, 0], [-0.16, 0.2], [-0.1, 0.02], [-0.13, -0.12]], 0.47), // crescent tail
    fin([[0, 0], [-0.17, -0.1], [-0.1, 0]], -0.12, 0.9, -0.04), // pectoral R
    fin([[0, 0], [-0.17, -0.1], [-0.1, 0]], -0.12, -0.9, -0.04), // pectoral L
  ];
  // Keep the smooth loft normals (recomputing after merging would facet the body).
  return mergeGeometries(parts);
}

function sharkMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...atmosphere, uSwim: { value: 0 }, uJaw: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aJaw;
      uniform float uSwim; uniform float uJaw;
      varying vec3 vWorld; varying vec3 vN; varying vec3 vLN; varying vec3 vLocal; varying float vF; varying float vMouth;
      void main() {
        vec3 p = position; vec3 nn = normal;
        vLocal = position;
        // Jaw: the front of the lower half swings down around a hinge behind the snout, upper lifts a little.
        const float HZ = -0.27;
        float w = smoothstep(HZ, HZ - 0.09, p.z);
        float ang = uJaw * w * (aJaw * 0.6 - (1.0 - aJaw) * 0.14);
        float c = cos(ang), s = sin(ang);
        vec2 d = vec2(p.z - HZ, p.y);
        p.z = c * d.x - s * d.y + HZ;
        p.y = s * d.x + c * d.y;
        nn.zy = vec2(c * nn.z - s * nn.y, s * nn.z + c * nn.y);
        // Side-to-side tail swish growing toward the tail.
        float t = clamp(p.z + 0.5, 0.0, 1.2);
        p.x += sin(uSwim - t * 4.0) * t * t * 0.11;
        vF = aJaw; vMouth = w * uJaw; vLN = nn;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vN = normalize(mat3(modelMatrix) * nn);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying vec3 vLN; varying vec3 vLocal; varying float vF; varying float vMouth;
      ${ATMOS_PARS}
      ${SEA_SHADE}
      void main() {
        vec3 ln = normalize(vLN);
        if (!gl_FrontFacing) ln = -ln;
        // Counter-shading: mottled slate-blue back fading (with a ragged edge) to a white belly.
        float edge = (vnoise(vLocal.zx * 40.0) - 0.5) * 0.12;
        float belly = smoothstep(-0.05, -0.32, ln.y + edge);
        vec3 back = vec3(0.15, 0.21, 0.28) * (0.85 + 0.3 * vnoise(vLocal.zy * 60.0 + vLocal.x * 30.0));
        vec3 col = mix(back, vec3(0.88, 0.9, 0.92), belly);
        // Darker fin tips and a faint lateral line along the flank.
        col *= 1.0 - 0.35 * smoothstep(0.12, 0.2, vLocal.y) - 0.3 * smoothstep(0.1, 0.18, abs(vLocal.z - 0.45) < 0.2 ? abs(vLocal.y) : 0.0);
        col *= 1.0 - 0.18 * smoothstep(0.004, 0.0, abs(vLocal.y - 0.01 + (vLocal.z + 0.2) * 0.03)) * step(-0.2, vLocal.z) * step(0.02, abs(vLocal.x));
        // Gill slits.
        float gz = vLocal.z + 0.235;
        float gills = step(0.0, gz) * step(gz, 0.06) * step(0.72, fract(gz * 75.0)) * step(abs(vLocal.y), 0.035) * step(0.03, abs(vLocal.x));
        col *= 1.0 - gills * 0.55;
        // Eye.
        float eye = smoothstep(0.011, 0.006, length(vec2(vLocal.z + 0.36, vLocal.y - 0.028))) * step(0.015, abs(vLocal.x));
        col = mix(col, vec3(0.01), eye);
        // Open mouth: the stretched faces between the jaws turn into a dark throat lined with teeth.
        float gape = 1.0 - abs(vF * 2.0 - 1.0);
        float m = smoothstep(0.06, 0.3, vMouth) * step(0.02, gape);
        if (m > 0.0) {
          vec3 throat = mix(vec3(0.45, 0.05, 0.07), vec3(0.08, 0.0, 0.02), gape);
          float saw = 1.0 - abs(fract(vLocal.z * 120.0) * 2.0 - 1.0);
          float teeth = step(gape, 0.1 + 0.32 * saw);
          col = mix(col, mix(throat, vec3(1.0, 0.98, 0.92), teeth), m);
        }
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        n = skinBump(n, vWorld, 0.012);
        gl_FragColor = vec4(applyAtmos(seaShade(col, n, vWorld, 0.45), vWorld), 1.0);
      }`,
  });
}

/** One shark: place it each frame with pose(). */
export class Shark {
  readonly mesh: THREE.Mesh;
  readonly position = new THREE.Vector3();
  readonly dir = new THREE.Vector3(0, 0, -1);
  private readonly mat = sharkMaterial();
  private swim = Math.random() * 6;
  private jaw = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(geo: THREE.BufferGeometry, readonly scale: number) {
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.scale.setScalar(scale);
    this.mesh.frustumCulled = false;
  }

  /** Tip of the snout (what prey should keep away from). */
  nose(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position).addScaledVector(this.dir, this.scale * 0.45);
  }

  pose(pos: THREE.Vector3, dir: THREE.Vector3, dt: number, rate = 1, jawTarget = 0): void {
    this.position.copy(pos);
    if (dir.lengthSq() > 1e-8) {
      this.tmp.copy(dir).normalize();
      const k = dt > 0 ? 1 - Math.exp(-dt * 4) : 1;
      this.dir.lerp(this.tmp, k);
      if (this.dir.lengthSq() < 1e-4) this.dir.copy(this.tmp);
      this.dir.normalize();
    }
    this.mesh.position.copy(pos);
    this.mesh.lookAt(this.tmp.copy(pos).sub(this.dir));
    this.swim += dt * 4 * rate;
    this.jaw += (jawTarget - this.jaw) * (1 - Math.exp(-dt * 9));
    this.mat.uniforms.uSwim.value = this.swim;
    this.mat.uniforms.uJaw.value = this.jaw;
  }
}

/**
 * Big sharks cruising in circles beside the highway; they gape when a fish school is ahead.
 * Only ONE is ever shown: it stays until it is behind the player, then the next one appears far
 * ahead in the fog. None while `suppress` is set (the hunting shark is out).
 */
export class CirclingSharks {
  readonly group = new THREE.Group();
  readonly sharks: Shark[] = [];
  /** Hook: is there prey within r metres of p? */
  preyNear?: (p: THREE.Vector3, r: number) => boolean;
  private active = -1;
  private readonly pos = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly nose = new THREE.Vector3();

  constructor(private readonly paths: { centre: THREE.Vector3; radius: number; speed: number; phase: number; scale: number }[]) {
    const geo = sharkGeometry();
    for (const p of paths) {
      const s = new Shark(geo, p.scale);
      s.mesh.visible = false;
      this.sharks.push(s);
      this.group.add(s.mesh);
    }
  }

  private place(i: number, time: number): void {
    const p = this.paths[i];
    const a = (time * p.speed) / p.radius + p.phase;
    this.pos.set(p.centre.x + Math.cos(a) * p.radius, p.centre.y + Math.sin(time * 0.3 + p.phase) * 4, p.centre.z + Math.sin(a) * p.radius);
    this.dir.set(-Math.sin(a), Math.cos(time * 0.3 + p.phase) * 0.05, Math.cos(a));
  }

  update(time: number, dt: number, viewer: THREE.Vector3, forward: THREE.Vector3, suppress: boolean): void {
    if (suppress) {
      this.active = -1;
    } else {
      if (this.active >= 0) {
        this.place(this.active, time);
        const ahead = _v.copy(this.pos).sub(viewer).dot(forward);
        if (ahead < -40 || this.pos.distanceTo(viewer) > 420) this.active = -1;
      }
      if (this.active < 0) {
        let best = -1, bestD = Infinity;
        for (let i = 0; i < this.paths.length; i++) {
          this.place(i, time);
          const d = this.pos.distanceTo(viewer);
          const ahead = _v.copy(this.pos).sub(viewer).dot(forward);
          if (ahead > 100 && d > 160 && d < 400 && d < bestD) {
            best = i;
            bestD = d;
          }
        }
        this.active = best;
      }
    }
    this.sharks.forEach((sh, i) => (sh.mesh.visible = i === this.active));
    if (this.active < 0) return;
    const i = this.active, p = this.paths[i], sh = this.sharks[i];
    this.place(i, time);
    const hungry = this.preyNear?.(sh.nose(this.nose), p.scale * 0.9) ?? false;
    sh.pose(this.pos, this.dir, dt, hungry ? 1.8 : 1, hungry ? (Math.sin(time * 5 + p.phase) > -0.2 ? 1 : 0.15) : 0);
  }
}

// ------------------------------------------------------------------ dolphins

/** Lofted bottlenose dolphin, ~1 unit long, nose toward -Z. */
export function dolphinGeometry(): THREE.BufferGeometry {
  const body = loft(
    [
      // t, top, bottom, half-width  (beak → melon → body → tail stock)
      [0.0, 0.012, -0.012, 0.08], [0.06, 0.02, -0.025, 0.18], [0.11, 0.07, -0.05, 0.42], [0.2, 0.1, -0.08, 0.85],
      [0.42, 0.11, -0.095, 1.0], [0.65, 0.08, -0.07, 0.7], [0.85, 0.035, -0.03, 0.3], [1.0, 0.02, -0.015, 0.12],
    ],
    { length: 1, halfWidth: 0.1, exp: 2.3, tumble: 0, along: 110, around: 56 },
  ).toNonIndexed();
  const dorsal = thickFin([[0, 0], [0.05, 0.1], [0.13, 0.12], [0.1, 0.06], [0.14, 0]], 0.012).rotateY(Math.PI / 2).translate(0, 0.09, -0.05);
  const flukes = thickFin([[0, 0], [-0.13, 0.07], [-0.11, 0.0], [0, 0.015], [0.11, 0.0], [0.13, 0.07]], 0.01).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
  const flipL = thickFin([[0, 0], [-0.1, -0.05], [-0.07, 0.01]], 0.009).rotateX(-Math.PI / 2 + 0.4).translate(-0.06, -0.05, -0.2);
  const flipR = thickFin([[0, 0], [0.1, -0.05], [0.07, 0.01]], 0.009).rotateX(-Math.PI / 2 + 0.4).translate(0.06, -0.05, -0.2);
  // Smooth loft normals are kept (no recompute after merging).
  return mergeGeometries([body, dorsal, flukes, flipL, flipR]);
}

export function dolphinMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...atmosphere, uSwim: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uSwim;
      varying vec3 vWorld; varying vec3 vN; varying vec3 vLocal; varying vec3 vLN;
      void main() {
        vec3 p = position;
        vLocal = position;
        vLN = normal;
        // Dolphins swim with an up-down tail beat (unlike sharks).
        float t = clamp(p.z + 0.5, 0.0, 1.2);
        p.y += sin(uSwim - t * 3.5) * t * t * 0.09;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying vec3 vLocal; varying vec3 vLN;
      ${ATMOS_PARS}
      ${SEA_SHADE}
      void main() {
        vec3 ln = normalize(vLN);
        if (!gl_FrontFacing) ln = -ln;
        // Grey back, pale belly; a darker "smiling" mouth line along the beak.
        float belly = smoothstep(0.05, -0.45, ln.y + (vnoise(vLocal.zx * 30.0) - 0.5) * 0.08);
        vec3 col = mix(vec3(0.3, 0.37, 0.45), vec3(0.88, 0.9, 0.92), belly);
        // Darker cape along the back from the melon to behind the dorsal fin, and a blowhole.
        float cape = smoothstep(0.35, 0.75, ln.y) * smoothstep(-0.42, -0.3, vLocal.z) * smoothstep(0.25, 0.05, vLocal.z);
        col = mix(col, vec3(0.16, 0.2, 0.27), cape * 0.8);
        col *= 1.0 - 0.6 * smoothstep(0.008, 0.004, length(vec2(vLocal.x, vLocal.z + 0.31))) * step(0.05, vLocal.y);
        float mouth = smoothstep(0.006, 0.0, abs(vLocal.y + 0.008 - (vLocal.z + 0.5) * 0.06)) * step(vLocal.z, -0.38);
        col = mix(col, vec3(0.15, 0.18, 0.22), mouth);
        float eye = smoothstep(0.012, 0.006, length(vec2(abs(vLocal.x) - 0.045, vLocal.y - 0.025))) * step(abs(vLocal.z + 0.37), 0.015);
        col = mix(col, vec3(0.02), eye);
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        n = skinBump(n, vWorld, 0.006);
        gl_FragColor = vec4(applyAtmos(seaShade(col, n, vWorld, 0.8), vWorld), 1.0);
      }`,
  });
}

/**
 * A pod of three playful dolphins. Every so often they turn up beside the road next to the player
 * and swim along, until a huge shark comes hunting: it charges in from behind with its jaws
 * snapping and the dolphins bolt ahead and away. The shark gives up and peels off.
 */
export class DolphinPod {
  readonly group = new THREE.Group();
  readonly hunter: Shark;
  private readonly dolphins: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; phase: number; swim: number; prev: THREE.Vector3; dir: THREE.Vector3; fresh: boolean }[] = [];
  private timer = 6; // first visit soon after the start
  private visit = -1; // seconds into the current visit (-1 = away)
  private side = 1;
  private scaredAt = -1;
  private visits = 0;
  private withShark = false;
  private readonly hunt = { on: false, a: 0, l: 0, h: 0, va: 0, vl: 0, vh: 0 };
  private readonly frame = makeFrame();
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly centroid = { a: 0, l: 0, h: 0 };
  /** Fired when a visit starts (hook for a whistle sound). */
  onArrive?: () => void;
  /** Fired when the dolphins spot the shark and flee. */
  onScare?: () => void;

  constructor(private readonly track: LoopTrack, scale = 3.2, hunterScale = 30) {
    const geo = dolphinGeometry();
    for (let i = 0; i < 3; i++) {
      const mat = dolphinMaterial();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(scale * (0.9 + i * 0.08));
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.dolphins.push({ mesh, mat, phase: i * 2.1, swim: 0, prev: new THREE.Vector3(), dir: new THREE.Vector3(), fresh: true });
    }
    this.hunter = new Shark(sharkGeometry(), hunterScale);
    this.hunter.mesh.visible = false;
    this.group.add(this.hunter.mesh);
  }

  /** Is the hunting shark out right now? */
  get hunting(): boolean {
    return this.hunt.on;
  }

  /** Snout of the hunting shark, if it is out (fish flee from it too). */
  hunterNose(out: THREE.Vector3): THREE.Vector3 | null {
    return this.hunt.on ? this.hunter.nose(out) : null;
  }

  private hideAll(): void {
    for (const d of this.dolphins) {
      d.mesh.visible = false;
      d.fresh = true;
    }
    this.hunter.mesh.visible = false;
    this.hunt.on = false;
  }

  update(time: number, dt: number, player: Player): void {
    if (this.visit < 0) {
      this.timer -= dt;
      if (this.timer <= 0 && player.v > 8 && !this.track.sectionAt(player.s, 40)) {
        this.visit = 0;
        this.scaredAt = -1;
        this.side = Math.random() < 0.5 ? -1 : 1;
        // Mostly they just hang out with you; now and then (never the first time) a shark crashes the party.
        this.withShark = this.visits > 0 && Math.random() < 0.3;
        this.visits++;
        this.onArrive?.();
      }
      this.hideAll();
      return;
    }
    this.visit += dt;
    const v = this.visit;
    if (v > (this.withShark ? 24 : 17)) {
      this.visit = -1;
      this.timer = 14 + Math.random() * 12;
      this.hideAll();
      return;
    }
    const hw = this.track.width / 2;
    const side = this.side;
    const arrive = THREE.MathUtils.smoothstep(v, 0, 2.5);
    const fleeT = this.scaredAt < 0 ? 0 : v - this.scaredAt;
    // Bolt: accelerate to ~21 m/s faster than the player, swerving outward.
    const fleeAlong = fleeT > 0 ? 23 * (fleeT - (1 - Math.exp(-1.6 * fleeT)) / 1.6) : 0;
    const fleeOut = Math.min(fleeT * 5, 20);
    const calm = 1 - THREE.MathUtils.smoothstep(fleeT, 0, 0.8);
    // Calm visits end with the pod peeling off ahead and outward.
    const leave = this.withShark ? 0 : THREE.MathUtils.smoothstep(v, 14, 17);
    const tau = Math.PI * 2;
    const c = this.centroid;
    c.a = c.l = c.h = 0;
    this.dolphins.forEach((d, i) => {
      const ph = time * 1.6 + d.phase;
      const panic = Math.min(fleeT, 1);
      // Acrobatics while playing, each dolphin on its own random rhythm: mostly rolls (a slow full barrel roll,
      // or a half roll onto the back and back again, either way round), and only now and then a leaping
      // somersault.
      const play = calm * arrive;
      const h01 = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
      const rc = time / 3.2 + d.phase * 0.31;
      const rk = Math.floor(rc), ru = rc - rk;
      const rr = h01(rk, i), rdir = h01(rk, i + 3) < 0.5 ? -1 : 1;
      let rollA = 0;
      if (rr < 0.45) rollA = ru < 0.4 ? THREE.MathUtils.smootherstep(ru, 0, 0.4) * tau : 0; // full roll
      else if (rr < 0.8) rollA = ru < 0.55 ? Math.sin((ru / 0.55) * Math.PI) * Math.PI * THREE.MathUtils.smoothstep(ru, 0, 0.1) : 0; // belly-up and back
      rollA *= rdir * play;
      const fc = time / 24 + d.phase * 0.53 + 0.5;
      const fk = Math.floor(fc), fu = fc - fk;
      const flipOn = h01(fk, i + 7) < 0.4 && fu < 0.06;
      const flipA = flipOn ? THREE.MathUtils.smootherstep(fu, 0, 0.06) * tau * play : 0;
      const leap = flipOn ? Math.sin((fu / 0.06) * Math.PI) * 3.2 * play : 0;
      const along = -16 * (1 - arrive) + 6 + i * 4 + Math.sin(ph * 0.7) * 3 * calm + fleeAlong * (1 + i * 0.07) + leave * 30;
      const zig = Math.sin(fleeT * 5 + i * 2) * 2.5 * panic;
      const lateral = side * (hw + 7 + Math.cos(ph) * 2.2 * calm + i * 1.6 + fleeOut + zig + leave * 25);
      const height = 1.5 + (Math.sin(ph * 1.3) * 1.6 + Math.sin(ph) * 0.8) * calm + leap + Math.sin(fleeT * 3 + i) * 1.5 * panic;
      c.a += along / 3;
      c.l += lateral / 3;
      c.h += height / 3;
      this.track.frameAt(player.s + along, this.frame);
      this.pos.copy(this.frame.position).addScaledVector(this.frame.right, lateral);
      this.pos.y += height;
      // Face the way it actually moves through the water (smoothed world velocity).
      if (d.fresh || dt <= 0) {
        d.dir.copy(this.frame.forward);
        d.fresh = false;
      } else {
        this.vel.copy(this.pos).sub(d.prev).divideScalar(dt);
        if (this.vel.lengthSq() > 1) d.dir.lerp(this.vel.normalize(), 1 - Math.exp(-dt * 6)).normalize();
      }
      d.prev.copy(this.pos);
      d.mesh.position.copy(this.pos);
      d.mesh.lookAt(this.look.copy(this.pos).sub(d.dir));
      if (flipA) d.mesh.rotateX(flipA); // nose up and over
      if (rollA) d.mesh.rotateZ(rollA);
      d.swim += dt * (9 + 18 * (1 - calm));
      d.mat.uniforms.uSwim.value = d.swim;
      d.mesh.visible = true;
    });

    // The hunter.
    const h = this.hunt;
    if (this.withShark && !h.on && v > 8 && v < 12) {
      h.on = true;
      h.a = -80;
      h.l = side * (hw + 24);
      h.h = 5;
      h.va = 14;
      h.vl = h.vh = 0;
      this.hunter.dir.copy(this.frame.forward);
      this.hunter.mesh.visible = true;
    }
    if (h.on) {
      const giveUp = v > 17;
      const noseA = h.a + this.hunter.scale * 0.45;
      let ta: number, tl: number, th: number, top: number;
      if (!giveUp) {
        ta = c.a - noseA + h.a;
        tl = c.l;
        th = c.h;
        top = 20;
      } else {
        ta = h.a - 30;
        tl = side * (hw + 70);
        th = h.h - 6;
        top = 12;
      }
      let dx = ta - h.a, dy = tl - h.l, dz = th - h.h;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx = (dx / len) * top;
      dy = (dy / len) * top;
      dz = (dz / len) * top * 0.4;
      const k = 1 - Math.exp(-dt * 1.6);
      h.va += (dx - h.va) * k;
      h.vl += (dy - h.vl) * k;
      h.vh += (dz - h.vh) * k;
      h.a += h.va * dt;
      h.l += h.vl * dt;
      h.h += h.vh * dt;
      if (side * h.l < hw + 9) h.l = side * (hw + 9); // never over the road
      const dist = Math.hypot(c.a - noseA, c.l - h.l, c.h - h.h);
      if (this.scaredAt < 0 && dist < 24) {
        this.scaredAt = v;
        this.onScare?.();
      }
      // Jaws gape as it closes in, snapping shut now and then.
      const jaw = giveUp ? 0 : dist < 22 ? (Math.sin(time * 6) > -0.4 ? 1 : 0.1) : dist < 55 ? 1 : 0;
      this.track.frameAt(player.s + h.a, this.frame);
      this.pos.copy(this.frame.position).addScaledVector(this.frame.right, h.l);
      this.pos.y += h.h;
      this.vel.copy(this.frame.forward).multiplyScalar(player.v + h.va).addScaledVector(this.frame.right, h.vl);
      this.vel.y += h.vh;
      this.hunter.pose(this.pos, this.vel, dt, giveUp ? 1.2 : 2.2, jaw);
      if (giveUp && Math.abs(h.l) > hw + 150) {
        h.on = false;
        this.hunter.mesh.visible = false;
      }
    }
  }
}

// ------------------------------------------------------------------ fish schools

function fishGeometry(): THREE.BufferGeometry {
  const body = loft(
    [[0.0, 0.02, -0.02, 0.3], [0.15, 0.13, -0.11, 0.8], [0.4, 0.16, -0.14, 1.0], [0.75, 0.06, -0.05, 0.45], [0.9, 0.03, -0.03, 0.22], [1.0, 0.025, -0.025, 0.12]],
    { length: 1, halfWidth: 0.075, exp: 2.2, tumble: 0, along: 14, around: 10 },
  ).toNonIndexed();
  const tail = flatShape([[0, 0], [-0.2, 0.17], [-0.13, 0], [-0.2, -0.17]]).rotateY(Math.PI / 2).translate(0, 0, 0.47).toNonIndexed();
  const dorsal = flatShape([[0, 0], [-0.12, 0.09], [-0.25, 0]]).rotateY(Math.PI / 2).translate(0, 0.14, -0.05).toNonIndexed();
  return mergeGeometries([body, tail, dorsal]);
}

interface School {
  c: THREE.Vector3;
  v: THREE.Vector3;
  calm: THREE.Vector3;
  flee: THREE.Vector3;
  panic: number;
  s: number;
  size: number;
  seed: number;
  first: number;
}

const SCHOOL_COLOURS = ['#ffd23a', '#4ab8ff', '#ff7a3a', '#c8e0f0', '#7affc8', '#ff5aa8', '#b0a0ff'];

/**
 * Schools of small fish milling around near the player. Any shark snout within range sends the
 * school bolting away and scattering; they regroup once it has passed.
 */
export class FishSchools {
  readonly mesh: THREE.InstancedMesh;
  /** Hook: current shark snouts and headings. */
  threats: () => { p: THREE.Vector3; d: THREE.Vector3 }[] = () => [];
  private readonly schools: School[] = [];
  private readonly offsets: { o: THREE.Vector3; ph: number; sc: number }[] = [];
  private readonly aFish: THREE.InstancedBufferAttribute;
  private readonly frame = makeFrame();
  private readonly m = new THREE.Matrix4();
  private readonly x = new THREE.Vector3();
  private readonly y = new THREE.Vector3();
  private readonly z = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly hd = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly playerPos = new THREE.Vector3();
  private readonly playerFwd = new THREE.Vector3();
  private started = false;

  constructor(private readonly track: LoopTrack, count: number, private readonly per: number) {
    const geo = fishGeometry();
    const total = count * per;
    this.aFish = new THREE.InstancedBufferAttribute(new Float32Array(total * 2), 2);
    this.aFish.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFish', this.aFish);
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { ...atmosphere },
      vertexShader: /* glsl */ `
        attribute vec2 aFish;
        varying vec3 vWorld; varying vec3 vN; varying vec3 vCol; varying vec3 vLocal;
        uniform float uTime;
        void main() {
          vec3 p = position;
          vLocal = position;
          float t = clamp(p.z + 0.5, 0.0, 1.2);
          p.x += sin(uTime * (9.0 + aFish.y * 18.0) + aFish.x - t * 5.0) * t * t * 0.16;
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vWorld = w.xyz;
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #else
            vCol = vec3(1.0);
          #endif
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld; varying vec3 vN; varying vec3 vCol; varying vec3 vLocal;
        ${ATMOS_PARS}
        ${SEA_SHADE}
        void main() {
          vec3 col = mix(vCol * 0.5, vCol, smoothstep(0.1, 0.0, vLocal.y));
          col = mix(col, vec3(0.92, 0.94, 0.95), smoothstep(-0.03, -0.11, vLocal.y));
          col *= 1.0 - 0.3 * step(0.8, fract(vLocal.z * 5.0 + 0.3)) * step(vLocal.z, 0.3);
          float eye = smoothstep(0.03, 0.018, length(vec2(vLocal.z + 0.36, vLocal.y - 0.03)));
          col = mix(col, vec3(0.02), eye);
          vec3 n = normalize(vN);
          if (!gl_FrontFacing) n = -n;
          gl_FragColor = vec4(applyAtmos(seaShade(col, n, vWorld, 0.9), vWorld), 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, total);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const col = new THREE.Color();
    for (let k = 0; k < count; k++) {
      this.schools.push({
        c: new THREE.Vector3(), v: new THREE.Vector3(), calm: new THREE.Vector3(1, 0, 0), flee: new THREE.Vector3(),
        panic: 0, s: 0, size: 0.7 + Math.random() * 0.9, seed: Math.random() * 100, first: k * per,
      });
      col.set(SCHOOL_COLOURS[k % SCHOOL_COLOURS.length]);
      for (let i = 0; i < per; i++) this.mesh.setColorAt(k * per + i, col);
    }
    // Loose ellipsoid formation, shared by all schools.
    for (let i = 0; i < per; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.cbrt(Math.random());
      const e = Math.random() * 2 - 1;
      const q = Math.sqrt(1 - e * e);
      this.offsets.push({ o: new THREE.Vector3(Math.cos(a) * q * 5 * r, e * 2.2 * r, Math.sin(a) * q * 5 * r), ph: Math.random() * 6.28, sc: 0.75 + Math.random() * 0.5 });
    }
  }

  /** Is any school within r metres of p? (Sharks use this to decide to gape.) */
  preyNear(p: THREE.Vector3, r: number): boolean {
    const r2 = r * r;
    return this.schools.some((s) => s.c.distanceToSquared(p) < r2);
  }

  private spawn(sc: School, player: Player, near: number, far: number): void {
    const hw = this.track.width / 2;
    // Often right in the path of a shark ahead, so you see them scatter.
    const threats = this.threats();
    if (threats.length && Math.random() < 0.4) {
      const th = threats[Math.floor(Math.random() * threats.length)];
      const ahead = this.t.copy(th.p).sub(this.playerPos).dot(this.playerFwd);
      if (ahead > near && ahead < far) {
        sc.c.copy(th.p).addScaledVector(th.d, 30 + Math.random() * 20);
        sc.c.y += Math.random() * 6 - 3;
        sc.s = trackLocal(this.track, sc.c, player.s + ahead, this.frame).s;
        sc.panic = 0;
        sc.v.set(0, 0, 0);
        sc.calm.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        return;
      }
    }
    sc.s = player.s + near + Math.random() * (far - near);
    this.track.frameAt(sc.s, this.frame);
    const overRoad = Math.random() < 0.3;
    const side = Math.random() < 0.5 ? -1 : 1;
    const lat = overRoad ? (Math.random() * 2 - 1) * hw : side * (hw + 10 + Math.random() * 80);
    const hgt = overRoad ? 11 + Math.random() * 10 : -8 + Math.random() * 30;
    sc.c.copy(this.frame.position).addScaledVector(this.frame.right, lat);
    sc.c.y += hgt;
    sc.panic = 0;
    sc.v.set(0, 0, 0);
    const yaw = Math.random() * Math.PI * 2;
    sc.calm.set(Math.cos(yaw), 0, Math.sin(yaw));
  }

  update(time: number, dt: number, player: Player): void {
    const track = this.track;
    const hw = track.width / 2;
    track.frameAt(player.s, this.frame);
    this.playerPos.copy(this.frame.position).addScaledVector(this.frame.right, player.x);
    this.playerFwd.copy(this.frame.forward);
    if (!this.started) {
      this.started = true;
      for (const sc of this.schools) this.spawn(sc, player, -60, 420);
    }
    const threats = this.threats();
    for (const sc of this.schools) {
      const loc = trackLocal(track, sc.c, sc.s, this.frame);
      sc.s = loc.s;
      const ahead = loopDiff(sc.s, player.s, track.length);
      if (ahead < -110 || ahead > 560 || Math.abs(loc.lat) > 220) {
        this.spawn(sc, player, 150, 420);
        continue;
      }
      // Sharks nearby → bolt directly away from the nearest snout.
      let best = 55 * 55;
      for (const th of threats) {
        const d2 = th.p.distanceToSquared(sc.c);
        if (d2 < best) {
          best = d2;
          sc.flee.copy(sc.c).sub(th.p);
          sc.flee.y *= 0.5;
          sc.flee.normalize();
          sc.panic = 1;
        }
      }
      sc.panic = Math.max(0, sc.panic - dt * 0.3);
      // Wander gently when calm.
      sc.calm.applyAxisAngle(this.up, Math.sin(time * 0.25 + sc.seed) * dt * 0.35);
      const scared = sc.panic > 0.05;
      this.t.copy(scared ? sc.flee : sc.calm).multiplyScalar(scared ? 6 + 16 * sc.panic : 2.5);
      // Stay clear of the cars: never low over the road; keep within the water column.
      if (Math.abs(loc.lat) < hw + 6 && loc.h < 10) this.t.addScaledVector(this.up, 7).addScaledVector(this.frame.right, Math.sign(loc.lat || 1) * 3);
      if (loc.h < -20) this.t.y += 4;
      if (loc.h > 45) this.t.y -= 4;
      sc.v.lerp(this.t, 1 - Math.exp(-dt * (scared ? 5 : 0.8)));
      sc.c.addScaledVector(sc.v, dt);

      // Pose the fish.
      const spread = 1 + sc.panic * 1.8;
      const heading = this.hd.copy(sc.v);
      if (heading.lengthSq() < 0.5) heading.copy(sc.calm);
      heading.normalize();
      const swirl = time * 0.12 + sc.seed;
      for (let i = 0; i < this.per; i++) {
        const f = this.offsets[i];
        const idx = sc.first + i;
        this.p.copy(f.o).applyAxisAngle(this.up, swirl).multiplyScalar(spread);
        this.p.x += Math.sin(time * 0.8 + f.ph) * 0.6;
        this.p.y += Math.sin(time * 1.1 + f.ph * 1.3) * 0.4;
        this.p.z += Math.cos(time * 0.7 + f.ph) * 0.6;
        this.p.multiplyScalar(sc.size).add(sc.c);
        // Heading: with the school, plus a scatter burst outward while panicking, plus a little wobble.
        this.t.copy(f.o).normalize().multiplyScalar(sc.panic * 0.9);
        this.t.add(heading);
        this.t.x += Math.sin(time * 2 + f.ph) * 0.12;
        this.t.z += Math.cos(time * 1.7 + f.ph) * 0.12;
        this.z.copy(this.t).normalize().negate(); // local +Z points backward (nose is -Z)
        this.x.crossVectors(this.up, this.z);
        if (this.x.lengthSq() < 1e-6) this.x.set(1, 0, 0);
        this.x.normalize();
        this.y.crossVectors(this.z, this.x);
        this.m.makeBasis(this.x, this.y, this.z).scale(this.t.setScalar(f.sc * sc.size)).setPosition(this.p);
        this.mesh.setMatrixAt(idx, this.m);
        this.aFish.setXY(idx, f.ph, sc.panic);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aFish.needsUpdate = true;
  }
}
