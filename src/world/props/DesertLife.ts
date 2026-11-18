import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyAtmosphere, ATMOS_PARS, atmosphere } from '../../render/atmosphere';

/**
 * Desert Mirage wildlife (all larger than life, so it reads from a passing car):
 *  - scorpions on the sand by the road: claws opening and closing, the tail swaying and striking, some of
 *    them scuttling round in small circles (one draw call, animated in the vertex shader);
 *  - rattlesnakes coiled round a few lamp posts, striking at the car as it passes (body bent in the vertex shader);
 *  - a flock of black birds wheeling around wherever the player is, and a couple of eagles soaring over the
 *    mesas (flapping / gliding in the vertex shader);
 *  - eagles perched on the rim of the mesas nearest the road, turning their heads to keep staring at you; now
 *    and then one dives across the road right in front of the car.
 */

const LIGHT_GLSL = /* glsl */ `
  // Low desert sun + sky / sand bounce, with a soft highlight.
  vec3 desertLit(vec3 col, vec3 n, vec3 wpos, float gloss) {
    vec3 L = normalize(uMoonDir);
    vec3 V = normalize(cameraPosition - wpos);
    float diff = max(dot(n, L), 0.0);
    vec3 amb = mix(vec3(0.62, 0.38, 0.24), vec3(0.42, 0.32, 0.55), n.y * 0.5 + 0.5) * 0.75 + vec3(0.22) * max(dot(n, V), 0.0);
    float spec = pow(max(dot(n, normalize(L + V)), 0.0), 40.0) * gloss;
    float rim = pow(clamp(1.0 - dot(n, V), 0.0, 1.0), 3.0) * pow(max(dot(-V, L), 0.0), 2.0);
    return col * (vec3(1.0, 0.82, 0.6) * diff * 1.2 + amb) + vec3(1.0, 0.8, 0.55) * (spec + rim * 0.5);
  }`;

const ROT_GLSL = /* glsl */ `
  vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
  vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }`;

export interface Critter { x: number; y: number; z: number; yaw: number; scale: number }

// ------------------------------------------------------------------ scorpions

/** Tag every vertex of a part: aPart (0 body, 1 tail, 2 left claw, 3 right claw, 4 leg), its pivot and a phase. */
function tagPart(geo: THREE.BufferGeometry, part: number, pivot: [number, number, number] = [0, 0, 0], phase = 0, shade = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const info = new Float32Array(n * 3), piv = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    info.set([part, phase, shade], i * 3);
    piv.set(pivot, i * 3);
  }
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
  g.setAttribute('aPivot', new THREE.BufferAttribute(piv, 3));
  g.deleteAttribute('uv');
  return g;
}

const ball = (rx: number, ry: number, rz: number, x: number, y: number, z: number) => new THREE.SphereGeometry(1, 14, 10).scale(rx, ry, rz).translate(x, y, z);
/** Thin limb from a to b. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0): THREE.BufferGeometry {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 7).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate(a.x, a.y, a.z);
}

/** One scorpion about 1 m long, head toward +X, belly on y = 0. */
function scorpionGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Body: head shield + five plates of the abdomen getting narrower toward the tail.
  parts.push(tagPart(ball(0.17, 0.08, 0.15, 0.16, 0.1, 0), 0));
  for (let i = 0; i < 5; i++) parts.push(tagPart(ball(0.095 - i * 0.004, 0.085 - i * 0.006, 0.16 - i * 0.017, 0.03 - i * 0.075, 0.105, 0), 0, [0, 0, 0], 0, i % 2 ? 0.8 : 1));
  // Eight legs: out and up to a knee, then down to the sand.
  for (let i = 0; i < 4; i++) {
    for (const sd of [-1, 1]) {
      const x = 0.2 - i * 0.085;
      const hip = V(x, 0.08, sd * 0.09), knee = V(x + (i - 1.5) * 0.035, 0.17, sd * 0.24), foot = V(x + (i - 1.5) * 0.075, 0, sd * 0.36);
      const ph = (i + (sd > 0 ? 0.5 : 0)) / 4;
      parts.push(tagPart(limb(hip, knee, 0.026), 4, [hip.x, hip.y, hip.z], ph, 0.75));
      parts.push(tagPart(limb(knee, foot, 0.022, 0.01), 4, [hip.x, hip.y, hip.z], ph, 0.75));
    }
  }
  // Claw arms: forward and out, a fat hand and two fingers.
  for (const sd of [-1, 1]) {
    const sh = V(0.27, 0.08, sd * 0.07), el = V(0.4, 0.09, sd * 0.2), hand = V(0.52, 0.09, sd * 0.15);
    const pv: [number, number, number] = [sh.x, sh.y, sh.z];
    const part = sd < 0 ? 2 : 3;
    parts.push(tagPart(limb(sh, el, 0.034), part, pv));
    parts.push(tagPart(limb(el, hand, 0.036), part, pv));
    parts.push(tagPart(ball(0.1, 0.055, 0.075, hand.x + 0.04, hand.y, hand.z), part, pv));
    parts.push(tagPart(limb(V(hand.x + 0.09, 0.09, hand.z - sd * 0.03), V(hand.x + 0.25, 0.09, hand.z - sd * 0.06), 0.032, 0.006), part, pv));
    parts.push(tagPart(limb(V(hand.x + 0.09, 0.09, hand.z + sd * 0.04), V(hand.x + 0.24, 0.09, hand.z + sd * 0.02), 0.026, 0.006), part, pv));
  }
  // Tail: five beads arcing up and forward over the back, then the sting.
  const tailPivot: [number, number, number] = [-0.3, 0.09, 0];
  const beads = [V(-0.36, 0.11, 0), V(-0.45, 0.19, 0), V(-0.48, 0.31, 0), V(-0.42, 0.42, 0), V(-0.31, 0.47, 0)];
  beads.forEach((b, i) => parts.push(tagPart(ball(0.075 - i * 0.004, 0.065 - i * 0.004, 0.065 - i * 0.004, b.x, b.y, b.z), 1, tailPivot, 0, i % 2 ? 1 : 0.8)));
  parts.push(tagPart(ball(0.065, 0.058, 0.058, -0.22, 0.47, 0), 1, tailPivot));
  parts.push(tagPart(limb(V(-0.18, 0.46, 0), V(-0.06, 0.37, 0), 0.03, 0.003), 1, tailPivot, 0, 1.6)); // sting, paler
  const geo = mergeGeometries(parts)!;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Scorpions. Each instance gets aCfg = (walk radius, phase, tint): a walk radius > 0 makes it scuttle round a
 * small circle, 0 keeps it on the spot waving its claws.
 */
export function createScorpions(list: (Critter & { walk: number })[]): THREE.InstancedMesh {
  const geo = scorpionGeometry();
  const cfg = new Float32Array(list.length * 3);
  list.forEach((s, i) => cfg.set([s.walk, (i * 2.399) % 6.283, 0.75 + ((i * 0.37) % 1) * 0.5], i * 3));
  geo.setAttribute('aCfg', new THREE.InstancedBufferAttribute(cfg, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      attribute vec3 aInfo; attribute vec3 aPivot; attribute vec3 aCfg;
      uniform float uTime;
      varying vec3 vN; varying vec3 vW; varying float vShade; varying float vTint;
      ${ROT_GLSL}
      void main() {
        float part = aInfo.x, ph = aCfg.y;
        vec3 p = position, n = normal;
        float walking = step(0.01, aCfg.x);
        if (part > 0.5 && part < 1.5) {
          // Tail: sways, and every few seconds whips forward in a strike.
          float a = -0.10 * sin(uTime * 1.3 + ph) - 0.5 * pow(max(0.0, sin(uTime * 0.45 + ph * 1.7)), 24.0);
          p = rotZ(p - aPivot, a) + aPivot; n = rotZ(n, a);
        } else if (part > 1.5 && part < 3.5) {
          // Claws: open and close, out of step with each other.
          float sgn = part < 2.5 ? 1.0 : -1.0;
          float a = sgn * (0.12 + 0.2 * sin(uTime * 1.9 + ph + sgn * 0.8));
          p = rotY(p - aPivot, a) + aPivot; n = rotY(n, a);
        } else if (part > 3.5) {
          // Legs: step in two alternating groups while walking, the odd twitch while standing.
          float lift = max(0.0, sin(uTime * 11.0 + aInfo.y * 6.283 + ph));
          float k = mix(0.25 * step(0.92, sin(uTime * 0.7 + ph + aInfo.y * 9.0)), 1.0, walking);
          p.y += lift * 0.05 * k * smoothstep(0.0, 0.3, length(p.xz - aPivot.xz));
        }
        // Scuttling round a small circle (in the scorpion's own flat frame), nose along the path.
        float ang = uTime * 0.35 / max(aCfg.x, 0.3) + ph;
        float turn = walking * (ang + 1.5708);
        p = rotY(p, -turn); n = rotY(n, -turn);
        p.xz += walking * aCfg.x * vec2(cos(ang), sin(ang)) / max(length(instanceMatrix[0].xyz), 1e-3);
        mat4 m = modelMatrix * instanceMatrix;
        vec4 w = m * vec4(p, 1.0);
        vW = w.xyz; vN = normalize(mat3(m) * n); vShade = aInfo.z; vTint = aCfg.z;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW; varying float vShade; varying float vTint;
      ${ATMOS_PARS}
      ${LIGHT_GLSL}
      void main() {
        // Glossy near-black shell (it has to stand out against pale sand), amber on the sting and plate edges.
        vec3 col = mix(vec3(0.035, 0.022, 0.018), vec3(0.34, 0.17, 0.05), clamp(vShade - 0.6, 0.0, 1.0)) * vTint;
        gl_FragColor = vec4(applyAtmos(desertLit(col, normalize(vN), vW, 1.4), vW), 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  place(mesh, list);
  mesh.name = 'scorpions';
  return mesh;
}

function place(mesh: THREE.InstancedMesh, list: Critter[]): void {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((p, i) => {
    q.setFromAxisAngle(up, p.yaw);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
    mesh.setMatrixAt(i, m);
  });
  mesh.count = list.length;
  mesh.computeBoundingSphere();
  // The shader moves the animals around their spot.
  if (mesh.boundingSphere) mesh.boundingSphere.radius += 12;
}

// ------------------------------------------------------------------ snakes on lamp posts

export interface SnakePole {
  x: number; y: number; z: number;
  /** Distance along the track of this lamp post. */
  s: number;
  /** The lamp post on the other side of the road it can leap to (it then lives there, and can leap back). */
  other?: { x: number; y: number; z: number; s: number };
}

const JUMP_TIME = 1.25;

/**
 * Rattlesnakes coiled round lamp posts. Each one hangs there with its head swaying off the post; when the
 * player comes close it strikes: the front of the body whips off the post straight at the car, mouth first,
 * with a hiss, then draws back. Sometimes, instead, it lets go and leaps right across the road in front of the
 * car to the lamp post on the other side, uncoiling in the air and winding itself round the new post.
 * (It cannot reach or hurt the car.)
 */
export class PoleSnakes {
  readonly group = new THREE.Group();
  private readonly list: { mesh: THREE.Mesh; u: { uLunge: THREE.IUniform; uTarget: THREE.IUniform; uJump: THREE.IUniform; uDest: THREE.IUniform }; pole: SnakePole; t: number; armed: boolean; jumping: boolean; strikeAt: number }[] = [];
  private readonly v = new THREE.Vector3();

  /** `onHiss` fires at the start of every strike. */
  constructor(poles: SnakePole[], private readonly trackLength: number, private readonly onHiss?: () => void,
    /** Chance that it leaps to the other post instead of striking. */
    private readonly jumpChance = 0.4) {
    this.group.name = 'pole-snakes';
    const rings = 110, around = 10;
    const pos: number[] = [], idx: number[] = [];
    // position = (cos, sin of the angle round the body, s along it: 0 = nose .. 1 = tail tip)
    for (let i = 0; i <= rings; i++) for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      pos.push(Math.cos(a), Math.sin(a), i / rings);
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j, b = a + around + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    poles.forEach((pole, i) => {
      const uLunge = { value: 0 }, uTarget = { value: new THREE.Vector3(0, 3, 2) }, uJump = { value: 0 }, uDest = { value: new THREE.Vector3() };
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...atmosphere, uLunge, uTarget, uJump, uDest, uPh: { value: i * 2.1 } },
        vertexShader: /* glsl */ `
          uniform float uTime, uLunge, uPh, uJump; uniform vec3 uTarget, uDest;
          varying vec3 vN; varying vec3 vW; varying vec2 vSkin; varying float vMouth;
          const float R = 0.27;          // coil radius (the post is 0.25 m square)
          const float FREE = 0.4;        // the front 40 % of the body can leave the post
          vec3 coil(float s) {
            float a = (1.0 - s) * 25.0 + uPh;                       // four turns
            return vec3(cos(a) * R, 1.3 + (1.0 - s) * 2.7, sin(a) * R);
          }
          // Centre line: wound round the post; the front hangs off it swaying, or shoots out at the target.
          vec3 spine(float s) {
            vec3 c = coil(s);
            float k = clamp(1.0 - s / FREE, 0.0, 1.0);              // 1 at the nose, 0 where the body grips the post
            float kk = k * k * (3.0 - 2.0 * k);
            vec3 anchor = coil(FREE);
            vec3 out0 = normalize(vec3(uTarget.x, 0.0, uTarget.z) + 1e-4);
            // Idle: an S-curve reaching half a metre toward the road, head raised, swaying.
            vec3 idle = mix(c, anchor + out0 * (0.75 * k) + vec3(0.0, 0.55 * sin(k * 2.6) + 0.12 * sin(uTime * 1.6 + uPh) * k, 0.0)
                             + cross(out0, vec3(0.0, 1.0, 0.0)) * 0.22 * sin(k * 6.0 + uTime * 1.1 + uPh) * k, kk);
            // Strike: straight at the target, with a slight arch.
            vec3 strike = mix(c, anchor + (uTarget - anchor) * k + vec3(0.0, 0.35 * sin(k * 3.1416), 0.0), kk);
            vec3 here = mix(idle, strike, uLunge);
            if (uJump <= 0.0) return here;
            // The leap: the head goes first and the body streams after it. Each point leaves the post, flies
            // an arc to the other post (uDest) and winds on there; in the air the coils pull out straight.
            float tj = clamp(uJump * 1.28 - s * 0.28, 0.0, 1.0);          // the tail leaves a quarter of the leap after the head
            tj = tj * tj * (3.0 - 2.0 * tj);
            float air = sin(tj * 3.1416);
            vec3 axis = vec3(0.0, c.y, 0.0);
            vec3 wound = mix(c, axis, air);                         // coil radius shrinks to nothing mid-air
            vec3 p = wound + uDest * tj + vec3(0.0, 4.2 * air, 0.0);
            // A slow writhe in the air.
            vec3 across = normalize(vec3(-uDest.z, 0.0, uDest.x) + 1e-4);
            p += across * 0.5 * air * sin(s * 9.0 + uTime * 9.0);
            return mix(here, p, smoothstep(0.0, 0.08, uJump));
          }
          void main() {
            float s = position.z;
            // Thickness: a broad flat head (wider still when it strikes), a neck, full body, tapering tail.
            float head = 1.0 - smoothstep(0.0, 0.045, s);
            float prof = mix(1.0, 1.55 + 0.35 * uLunge, head) * mix(0.82, 1.0, smoothstep(0.045, 0.14, s)) * (1.0 - 0.8 * smoothstep(0.6, 1.0, s));
            prof *= smoothstep(0.0, 0.01, s) * 0.5 + 0.5;
            prof *= step(s, 0.999);
            vec3 c = spine(s);
            vec3 fwd = normalize(spine(max(s - 0.008, 0.0)) - spine(s + 0.008));
            vec3 side = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)) + 1e-4);
            vec3 up = cross(side, fwd);
            // Mouth: on the strike the lower half of the head drops open.
            float lower = step(position.y, -0.1);
            float gape = head * lower * uLunge * 0.9;
            vec3 n = side * position.x + up * position.y;
            vec3 p = c + (side * position.x * 1.2 + up * (position.y * (0.8 - gape) - gape * 1.1)) * 0.16 * prof;
            vMouth = head * uLunge * step(abs(position.y), 0.35) * step(0.0, position.x * 0.0 + 1.0);
            vec4 w = modelMatrix * vec4(p, 1.0);
            vW = w.xyz; vN = normalize(mat3(modelMatrix) * n);
            vSkin = vec2(atan(position.y, position.x), s);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vN; varying vec3 vW; varying vec2 vSkin; varying float vMouth;
          ${ATMOS_PARS}
          ${LIGHT_GLSL}
          void main() {
            float s = vSkin.y;
            float top = smoothstep(-0.3, 0.6, sin(vSkin.x));
            float u = fract(s * 34.0) - 0.5;
            float v = (vSkin.x - 1.5708) / 1.2;
            float dia = abs(u) * 2.0 + abs(v);
            vec3 sand = vec3(0.62, 0.47, 0.28), dark = vec3(0.2, 0.12, 0.07), pale = vec3(0.86, 0.76, 0.56);
            vec3 col = mix(sand, pale, smoothstep(1.05, 0.95, dia) * top);
            col = mix(col, dark, smoothstep(0.85, 0.75, dia) * top);
            col = mix(pale * 0.9, col, top);
            float rattle = smoothstep(0.94, 0.96, s);
            col = mix(col, vec3(0.8, 0.7, 0.5) * (0.7 + 0.3 * step(0.5, fract(s * 120.0))), rattle);
            // Eyes (two bright dots on top of the head) and the pink inside of the open mouth.
            float eye = (1.0 - smoothstep(0.004, 0.007, abs(s - 0.02))) * (1.0 - smoothstep(0.1, 0.16, abs(abs(vSkin.x - 1.5708) - 0.75)));
            col = mix(col, vec3(1.0, 0.75, 0.1) * 2.0, eye);
            col = mix(col, vec3(0.95, 0.35, 0.4), vMouth * 0.85);
            col *= 0.9 + 0.1 * sin(s * 520.0) * sin(vSkin.x * 14.0);
            gl_FragColor = vec4(applyAtmos(desertLit(col, normalize(vN), vW, 0.5), vW), 1.0);
          }`,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pole.x, pole.y, pole.z);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.list.push({ mesh, u: { uLunge, uTarget, uJump, uDest }, pole, t: 99, armed: true, jumping: false, strikeAt: 0 });
    });
  }

  /** `player`: world position of the car, its distance along the track and its speed. */
  update(dt: number, player: THREE.Vector3, playerS: number, speed: number): void {
    const L = this.trackLength;
    for (const sn of this.list) {
      // Distance still to go to the post, along the track (positive = it is ahead).
      const ahead = ((((sn.pole.s - playerS) % L) + L + L / 2) % L) - L / 2;
      // Where the head goes: at the car (a metre above the road), but no further than it can stretch.
      this.v.copy(player).sub(sn.mesh.position);
      this.v.y += 1.2;
      const anchorY = 2.9;
      this.v.y -= anchorY;
      const len = this.v.length();
      if (len > 3.3) this.v.multiplyScalar(3.3 / len);
      this.v.y += anchorY;
      (sn.u.uTarget.value as THREE.Vector3).copy(this.v);
      if (sn.jumping) {
        // In the air; on landing the new post becomes its home (and the old one the post to leap back to).
        sn.t += dt;
        sn.u.uJump.value = Math.min(1, sn.t / JUMP_TIME);
        if (sn.t >= JUMP_TIME) {
          const from = sn.pole, to = from.other!;
          sn.pole = { ...to, other: { x: from.x, y: from.y, z: from.z, s: from.s } };
          sn.mesh.position.set(to.x, to.y, to.z);
          sn.u.uJump.value = 0;
          sn.jumping = false;
          sn.t = 99;
        }
        continue;
      }
      // It decides once per pass, when the car is about a second and a half away: leap or strike.
      const lead = Math.max(34, speed * 1.4);
      if (sn.armed && ahead < lead && ahead > -2 && speed > 8) {
        sn.armed = false;
        if (sn.pole.other && ahead > 30 && Math.random() < this.jumpChance) {
          sn.jumping = true;
          sn.t = 0;
          (sn.u.uDest.value as THREE.Vector3).set(sn.pole.other.x - sn.pole.x, sn.pole.other.y - sn.pole.y, sn.pole.other.z - sn.pole.z);
          this.onHiss?.();
          continue;
        }
        sn.strikeAt = 34;
      }
      if (sn.strikeAt && ahead < sn.strikeAt && ahead > -2) {
        sn.strikeAt = 0;
        sn.t = 0;
        this.onHiss?.();
      }
      if (!sn.armed && Math.abs(ahead) > 160) sn.armed = true;
      sn.t += dt;
      // Out in 0.14 s, held for half a second, drawn back over 0.8 s.
      const t = sn.t;
      sn.u.uLunge.value = t < 0.14 ? t / 0.14 : t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.8);
    }
  }
}

// ------------------------------------------------------------------ birds in the air

/** Bird seen from below / the side: a slim body and two two-part wings. aWing = 0 on the body, ±1 at the tips. */
function birdGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], wing: number[] = [];
  const tri = (a: number[], b: number[], c: number[], wa: number, wb: number, wc: number) => {
    pos.push(...a, ...b, ...c);
    wing.push(wa, wb, wc);
  };
  // Body: a flat diamond, beak toward -Z, tail fan at +Z.
  tri([0, 0, -0.5], [0.09, 0, -0.05], [-0.09, 0, -0.05], 0, 0, 0);
  tri([0.09, 0, -0.05], [0, 0, 0.42], [-0.09, 0, -0.05], 0, 0, 0);
  tri([0, 0, 0.3], [0.13, 0, 0.6], [-0.13, 0, 0.6], 0, 0, 0);
  // Side view of the body (a flat bird would vanish when seen level with it): head, chest and tail in profile.
  tri([0, 0.05, -0.5], [0, -0.13, -0.05], [0, 0.1, -0.1], 0, 0, 0);
  tri([0, 0.1, -0.1], [0, -0.13, -0.05], [0, 0.02, 0.55], 0, 0, 0);
  for (const sd of [-1, 1]) {
    // Inner wing (to the wrist) and outer wing (swept back to the tip).
    tri([sd * 0.06, 0, -0.18], [sd * 0.55, 0, -0.2], [sd * 0.06, 0, 0.16], 0, sd * 0.5, 0);
    tri([sd * 0.55, 0, -0.2], [sd * 0.5, 0, 0.12], [sd * 0.06, 0, 0.16], sd * 0.5, sd * 0.5, 0);
    tri([sd * 0.55, 0, -0.2], [sd * 1.05, 0, 0.06], [sd * 0.5, 0, 0.12], sd * 0.5, sd, sd * 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  return g;
}

/**
 * Birds as one draw call. Every bird has an offset inside the flock (aSlot) and a phase; the flock's centre and
 * heading come from uniforms. `glide` 1 = soaring (slow, shallow wing beats), 0 = flapping.
 */
function birdMesh(count: number, color: string, glide: number): { mesh: THREE.InstancedMesh; uCenter: THREE.Vector3; uHeading: THREE.Vector2 } {
  const geo = birdGeometry();
  const slot = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) slot.set([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 6.283], i * 4);
  geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 4));
  const uCenter = new THREE.Vector3(), uHeading = new THREE.Vector2(0, 1);
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      ...atmosphere, uCenter: { value: uCenter }, uHeading: { value: uHeading }, uColor: { value: new THREE.Color(color) }, uGlide: { value: glide },
      uSpread: { value: new THREE.Vector3(34, 9, 26) }, uSize: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aWing; attribute vec4 aSlot;
      uniform float uTime, uGlide, uSize; uniform vec3 uCenter, uSpread; uniform vec2 uHeading;
      varying vec3 vW; varying float vShade;
      void main() {
        float ph = aSlot.w;
        vec3 p = position * uSize;
        // Wing beat: tips swing up and down, the wing shortens a little at the top and bottom of the beat.
        float rate = mix(9.0 + 3.0 * fract(ph * 3.7), 1.1, uGlide);
        float beat = sin(uTime * rate + ph * 5.0);
        float amp = mix(0.55, 0.12, uGlide);
        float w = abs(aWing);
        // Gliding birds hold their wings in a shallow V (also what you see of them from the side).
        p.y += (w * w * beat * amp + w * 0.2 * uGlide) * uSize;
        p.x *= 1.0 - 0.18 * w * abs(beat) * (1.0 - uGlide);
        vShade = 0.75 + 0.25 * beat * w;
        // Bank into the flock's turns a little and face along the heading.
        vec2 h = normalize(uHeading);
        vec3 fwd = vec3(h.x, 0.0, h.y), side = vec3(-h.y, 0.0, h.x);
        vec3 local = side * p.x + vec3(0.0, p.y, 0.0) - fwd * p.z;      // the beak (-Z) points along the heading
        // Its place in the flock: drifting slowly round the middle, bobbing.
        vec3 slot = aSlot.xyz * uSpread;
        float sw = uTime * (0.12 + 0.1 * fract(ph * 1.3)) + ph;
        slot.xz += vec2(cos(sw), sin(sw * 1.3)) * uSpread.xz * 0.35;
        slot.y += sin(uTime * 0.7 + ph * 2.0) * 2.5;
        vec3 wp = uCenter + side * slot.x + vec3(0.0, slot.y, 0.0) + fwd * slot.z + local;
        vW = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying vec3 vW; varying float vShade;
      ${ATMOS_PARS}
      void main() { gl_FragColor = vec4(applyAtmos(uColor * vShade, vW), 1.0); }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false; // the shader puts the birds wherever the flock is
  return { mesh, uCenter, uHeading };
}

/** A flock of black birds that keeps wheeling around the player's part of the desert. */
export class BirdFlock {
  readonly mesh: THREE.InstancedMesh;
  private readonly center: THREE.Vector3;
  private readonly heading: THREE.Vector2;
  private readonly anchor = new THREE.Vector3();
  private started = false;
  private angle = Math.random() * 6.283;

  constructor(count = 42, private readonly radius = 150, private readonly height = 42) {
    const b = birdMesh(count, '#0c0a0e', 0);
    (b.mesh.material as THREE.ShaderMaterial).uniforms.uSize.value = 2.4;
    this.mesh = b.mesh;
    this.mesh.name = 'bird-flock';
    this.center = b.uCenter;
    this.heading = b.uHeading;
  }

  /** `around` = the player's position: the flock's circle drifts after it. */
  update(time: number, dt: number, around: THREE.Vector3): void {
    if (!this.started) { this.anchor.copy(around); this.started = true; }
    this.anchor.lerp(around, 1 - Math.exp(-dt * 0.5));
    this.angle += dt * 0.16;
    const r = this.radius * (0.75 + 0.25 * Math.sin(time * 0.13));
    this.center.set(this.anchor.x + Math.cos(this.angle) * r, this.anchor.y + this.height + Math.sin(time * 0.21) * 12, this.anchor.z + Math.sin(this.angle) * r);
    // Tangent of the circle (the way they fly).
    this.heading.set(-Math.sin(this.angle), Math.cos(this.angle));
  }
}

/** Eagles gliding in slow circles high above given points (the mesas). */
export class SoaringEagles {
  readonly group = new THREE.Group();
  private readonly birds: { center: THREE.Vector3; heading: THREE.Vector2; at: THREE.Vector3; r: number; ph: number }[] = [];

  constructor(points: { x: number; y: number; z: number }[]) {
    this.group.name = 'soaring-eagles';
    points.forEach((p, i) => {
      const b = birdMesh(1, '#3a2414', 1);
      const u = (b.mesh.material as THREE.ShaderMaterial).uniforms;
      u.uSize.value = 7;
      u.uSpread.value.set(0, 0, 0);
      this.group.add(b.mesh);
      this.birds.push({ center: b.uCenter, heading: b.uHeading, at: new THREE.Vector3(p.x, p.y, p.z), r: 55 + i * 18, ph: i * 2.1 });
    });
  }

  update(time: number): void {
    for (const b of this.birds) {
      const a = time * 0.11 + b.ph;
      b.center.set(b.at.x + Math.cos(a) * b.r, b.at.y + Math.sin(time * 0.17 + b.ph) * 6, b.at.z + Math.sin(a) * b.r);
      b.heading.set(-Math.sin(a), Math.cos(a));
    }
  }
}

// ------------------------------------------------------------------ perched eagles

/**
 * A big eagle sitting on a rock edge, about 1 m tall at scale 1, facing +Z: hunched forward over its feet,
 * shoulders up, head low and thrust forward. Its head is a separate group (it turns to follow the player).
 */
function eagle(): { group: THREE.Group; head: THREE.Group } {
  const g = new THREE.Group();
  const mat = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => applyAtmosphere(new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o }));
  const brown = mat('#3e2614'), dark = mat('#21130a'), breast = mat('#553620'), gold = mat('#c9a05a'), yellow = mat('#f0b020', { roughness: 0.4 });
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0, ry = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    g.add(mesh);
    return mesh;
  };
  // Body: a slim teardrop leaning well forward; the breast only a shade lighter than the back.
  part(new THREE.SphereGeometry(1, 20, 16).scale(0.2, 0.36, 0.22), brown, 0, 0.5, 0, 0.5);
  part(new THREE.SphereGeometry(1, 16, 12).scale(0.15, 0.25, 0.1), breast, 0, 0.47, 0.13, 0.55);
  // Folded wings: the wrists stand up and out past the shoulders (the hunched look), the long primaries cross
  // behind and reach below the perch.
  for (const sd of [-1, 1]) {
    part(new THREE.SphereGeometry(1, 16, 12).scale(0.08, 0.34, 0.2), dark, sd * 0.21, 0.56, -0.04, 0.55, sd * 0.16);
    part(new THREE.SphereGeometry(1, 12, 10).scale(0.09, 0.11, 0.12), dark, sd * 0.2, 0.8, 0.07);
    part(new THREE.ConeGeometry(0.08, 0.6, 6).scale(0.45, 1, 1.5), dark, sd * 0.1, 0.12, -0.3, 0.75 + Math.PI, sd * 0.1);
  }
  // Tail: a wedge pointing down and back between the wing tips.
  part(new THREE.BoxGeometry(0.2, 0.42, 0.035), brown, 0, 0.04, -0.3, 0.7);
  // Feathered "trousers" and yellow feet, toes spread, long talons hooked over the edge.
  for (const sd of [-1, 1]) {
    part(new THREE.SphereGeometry(1, 12, 10).scale(0.085, 0.17, 0.1), breast, sd * 0.1, 0.2, 0.08, 0.15);
    part(new THREE.CylinderGeometry(0.028, 0.034, 0.1, 8), yellow, sd * 0.1, 0.05, 0.1);
    for (let t = -1; t <= 1; t++) {
      part(new THREE.CylinderGeometry(0.016, 0.02, 0.13, 6), yellow, sd * 0.1 + t * 0.045, 0.014, 0.16, Math.PI / 2, 0, -t * 0.3);
      part(new THREE.ConeGeometry(0.014, 0.07, 6), dark, sd * 0.1 + t * 0.07, 0.0, 0.235, Math.PI / 2 + 0.9, 0, -t * 0.3);
    }
    part(new THREE.ConeGeometry(0.016, 0.1, 6), yellow, sd * 0.1, 0.012, 0.03, -Math.PI / 2 - 0.25);
  }
  // Head: low between the shoulders and thrust forward; pale golden crown and nape, a heavy dark brow over the
  // eyes (the stare), and a big hooked beak.
  const head = new THREE.Group();
  head.position.set(0, 0.84, 0.2);
  const hp = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    head.add(mesh);
  };
  hp(new THREE.SphereGeometry(1, 18, 14).scale(0.105, 0.105, 0.14), gold, 0, 0, 0);
  hp(new THREE.SphereGeometry(1, 14, 10).scale(0.13, 0.13, 0.13), brown, 0, -0.09, -0.06);   // neck ruff
  for (const sd of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.028, 0.13), dark);
    brow.position.set(sd * 0.06, 0.05, 0.07);
    brow.rotation.set(0.25, 0, -sd * 0.45); // slanted down toward the beak: an angry frown
    head.add(brow);
  }
  hp(new THREE.CylinderGeometry(0.03, 0.055, 0.15, 8).scale(0.8, 1, 1), yellow, 0, -0.015, 0.19, Math.PI / 2 + 0.15);
  hp(new THREE.ConeGeometry(0.034, 0.1, 8), dark, 0, -0.07, 0.262, Math.PI + 0.25);                                    // the hook
  for (const sd of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc21a').multiplyScalar(1.6) }));
    eye.position.set(sd * 0.075, 0.018, 0.1);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), new THREE.MeshBasicMaterial({ color: '#000000' }));
    pupil.position.set(sd * 0.086, 0.018, 0.113);
    head.add(eye, pupil);
  }
  g.add(head);
  return { group: g, head };
}

/** Flat feather panel in the XZ plane from an outline (x, z pairs), at height y, one colour. */
function featherPanel(outline: number[], y: number, color: string): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const c = new THREE.Color(color);
  for (let i = 1; i + 1 < outline.length / 2; i++) {
    for (const k of [0, i, i + 1]) { pos.push(outline[k * 2], y, outline[k * 2 + 1]); col.push(c.r, c.g, c.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function tinted(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const a = new Float32Array(n.getAttribute('position').count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  n.setAttribute('color', new THREE.BufferAttribute(a, 3));
  n.deleteAttribute('uv');
  return n;
}

interface FlyingEagle {
  group: THREE.Group;
  /** Inner wings (pivot at the shoulder) and outer wings (pivot at the wrist), left then right. */
  inner: THREE.Group[]; outer: THREE.Group[];
  legs: THREE.Group;
}

/**
 * An eagle in flight, about 1 m long with a 2.6 m span at scale 1, flying toward +Z. Rounded body, golden
 * head with a hooked beak, layered wings (dark flight feathers, lighter coverts, spread "finger" primaries),
 * a barred tail fan and yellow feet that swing forward for the strike.
 */
function flyingEagle(): FlyingEagle {
  const mat = applyAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  const ball = (rx: number, ry: number, rz: number, x: number, y: number, z: number) => new THREE.SphereGeometry(1, 18, 12).scale(rx, ry, rz).translate(x, y, z);
  const group = new THREE.Group();
  const BROWN = '#3e2614', DARK = '#1f1209', COVERT = '#5a3a20', GOLD = '#c9a05a', YELLOW = '#f0b020', PALE = '#8a6a44';
  // Body, neck ruff, head, beak, eyes.
  const body: THREE.BufferGeometry[] = [
    tinted(ball(0.15, 0.14, 0.4, 0, 0, 0), BROWN),
    tinted(ball(0.13, 0.115, 0.2, 0, -0.03, 0.12), COVERT),               // paler breast
    tinted(ball(0.105, 0.1, 0.13, 0, 0.03, 0.36), BROWN),
    tinted(ball(0.085, 0.085, 0.11, 0, 0.05, 0.47), GOLD),
    tinted(new THREE.CylinderGeometry(0.022, 0.045, 0.12, 8).rotateX(Math.PI / 2 + 0.15).translate(0, 0.035, 0.59), YELLOW),
    tinted(new THREE.ConeGeometry(0.026, 0.07, 8).rotateX(Math.PI + 0.3).translate(0, -0.005, 0.645), DARK), // the hook
  ];
  for (const sx of [-1, 1]) {
    body.push(tinted(ball(0.018, 0.018, 0.018, sx * 0.06, 0.065, 0.52), '#ffd020'));
    body.push(tinted(new THREE.BoxGeometry(0.06, 0.016, 0.09).rotateZ(-sx * 0.4).translate(sx * 0.05, 0.088, 0.515), DARK)); // brow
  }
  // Tail: a fan of seven feathers with a dark band at the end.
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.13;
    const fx = (len: number, w: number) => [Math.sin(a) * 0.05 - w * Math.cos(a), -0.3, Math.sin(a) * 0.05 + w * Math.cos(a), -0.3, Math.sin(a) * len + w * Math.cos(a), -0.3 - Math.cos(a) * len, Math.sin(a) * len - w * Math.cos(a), -0.3 - Math.cos(a) * len];
    const q = fx(0.42, 0.05);
    body.push(featherPanel([q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7]], 0.01 - Math.abs(i) * 0.004, i % 2 ? BROWN : PALE));
    const tipQ = fx(0.5, 0.05), q2 = fx(0.4, 0.05);
    body.push(featherPanel([q2[6], q2[7], q2[4], q2[5], tipQ[4], tipQ[5], tipQ[6], tipQ[7]], 0.012 - Math.abs(i) * 0.004, DARK));
  }
  group.add(new THREE.Mesh(mergeGeometries(body), mat));
  // Wings. Built for the left side (+X) and mirrored.
  const inner: THREE.Group[] = [], outer: THREE.Group[] = [];
  for (const sx of [1, -1]) {
    const X = (pts: number[]) => pts.map((v, i) => (i % 2 === 0 ? v * sx : v));
    const arm: THREE.BufferGeometry[] = [
      featherPanel(X([0, 0.2, 0.62, 0.22, 0.62, -0.2, 0.3, -0.26, 0, -0.22]), 0, DARK),            // secondaries
      featherPanel(X([0, 0.21, 0.62, 0.23, 0.62, 0.02, 0, -0.02]), 0.012, COVERT),                 // coverts on top
      featherPanel(X([0, 0.21, 0.62, 0.23, 0.62, 0.02, 0, -0.02]), -0.012, PALE),                  // pale wing lining below
      tinted(new THREE.CapsuleGeometry(0.035, 0.56, 3, 8).rotateZ(Math.PI / 2).translate(sx * 0.31, 0.01, 0.2), BROWN), // the arm itself
      tinted(new THREE.SphereGeometry(1, 14, 8).scale(0.33, 0.032, 0.2).translate(sx * 0.31, 0.004, 0.03), COVERT),      // the wing has body: a thin lens
    ];
    const ig = new THREE.Group();
    ig.position.set(sx * 0.1, 0.06, 0.12);
    ig.add(new THREE.Mesh(mergeGeometries(arm), mat));
    const hand: THREE.BufferGeometry[] = [
      featherPanel(X([0, 0.23, 0.3, 0.22, 0.3, -0.1, 0, -0.2]), 0, DARK),
      featherPanel(X([0, 0.23, 0.3, 0.22, 0.3, 0.06, 0, 0.02]), 0.012, COVERT),
      tinted(new THREE.CapsuleGeometry(0.026, 0.28, 3, 8).rotateZ(Math.PI / 2).translate(sx * 0.15, 0.01, 0.21), BROWN),
      tinted(new THREE.SphereGeometry(1, 12, 8).scale(0.2, 0.022, 0.16).translate(sx * 0.14, 0.004, 0.05), COVERT),
    ];
    // Five spread "finger" primaries at the tip, each a little longer and more swept than the last.
    for (let k = 0; k < 5; k++) {
      const a = 0.25 - k * 0.2;                           // angle from straight out (+ = forward)
      const len = 0.42 - Math.abs(k - 1.5) * 0.035, w = 0.036;
      const bx = 0.28, bz = 0.16 - k * 0.07;
      const dx = Math.cos(a), dz = Math.sin(a);
      hand.push(featherPanel(X([bx - dz * w, bz + dx * w, bx + dx * len, bz + dz * len + w * 0.3, bx + dx * len, bz + dz * len - w * 0.3, bx + dz * w, bz - dx * w]), 0.002 * k, k % 2 ? DARK : '#2a1a0e'));
    }
    const og = new THREE.Group();
    og.position.set(sx * 0.62, 0, 0);
    og.add(new THREE.Mesh(mergeGeometries(hand), mat));
    ig.add(og);
    group.add(ig);
    inner.push(ig);
    outer.push(og);
  }
  // Legs: feathered thighs, yellow feet with black talons; they hang back in flight and swing forward to strike.
  const legs = new THREE.Group();
  legs.position.set(0, -0.08, -0.06);
  const lg: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    lg.push(tinted(ball(0.05, 0.1, 0.055, sx * 0.07, -0.07, 0), COVERT));
    lg.push(tinted(new THREE.CylinderGeometry(0.016, 0.02, 0.1, 8).translate(sx * 0.07, -0.19, 0), YELLOW));
    for (let t = -1; t <= 1; t++) {
      lg.push(tinted(new THREE.CylinderGeometry(0.01, 0.013, 0.08, 6).rotateX(Math.PI / 2).rotateY(-t * 0.35).translate(sx * 0.07 + t * 0.02, -0.245, 0.04), YELLOW));
      lg.push(tinted(new THREE.ConeGeometry(0.01, 0.05, 6).rotateX(Math.PI / 2 + 0.9).rotateY(-t * 0.35).translate(sx * 0.07 + t * 0.045, -0.262, 0.09), DARK));
    }
  }
  legs.add(new THREE.Mesh(mergeGeometries(lg), mat));
  group.add(legs);
  return { group, inner, outer, legs };
}

interface Perch {
  root: THREE.Group; head: THREE.Group; yaw: number; ph: number;
  /** Distance along the track of the road point this eagle overlooks. */
  roadS: number;
  phase: 'perch' | 'dive' | 'away' | 'return';
  t: number; armed: boolean;
  flyer: FlyingEagle;
  /** Smoothed wing pose: 0 = flapping, 1 = gliding; tuck 0..1 = wings half folded for the stoop. */
  glide: number; tuck: number;
  cross: THREE.Vector3; dir: THREE.Vector3; far: THREE.Vector3;
}

const DIVE_TIME = 3.2, AWAY_TIME = 3.0, RETURN_TIME = 6.0;

/**
 * Eagles perched on mesa rims: each one keeps its head turned toward the player. Now and then (about one pass
 * in three, never twice in a row on the same lap section) one drops off its perch as you approach, swoops down
 * across the road a few metres over the tarmac just ahead of your car, climbs away and circles back to its rock.
 */
export class PerchedEagles {
  readonly group = new THREE.Group();
  private readonly birds: Perch[] = [];
  private readonly v = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');

  /**
   * `spots`: where each eagle sits, which way its body faces (yaw: 0 = +Z) and the track distance of the road
   * below it. `pointAt(s, out)`: the road's centre line at distance s.
   */
  constructor(
    spots: { x: number; y: number; z: number; yaw: number; scale: number; roadS: number }[],
    private readonly trackLength: number,
    private readonly pointAt: (s: number, out: THREE.Vector3) => THREE.Vector3,
    /** Chance that an eagle dives when the player comes by. */
    private readonly diveChance = 0.35,
  ) {
    this.group.name = 'perched-eagles';
    spots.forEach((s, i) => {
      const { group, head } = eagle();
      group.position.set(s.x, s.y, s.z);
      group.rotation.y = s.yaw;
      group.scale.setScalar(s.scale);
      this.group.add(group);
      // In the air it is a proper bird (about 6 m across the wings: larger than life, like the perched one).
      const f = flyingEagle();
      f.group.scale.setScalar(s.scale * 0.38);
      f.group.visible = false;
      this.group.add(f.group);
      this.birds.push({
        root: group, head, yaw: s.yaw, ph: i * 1.7, roadS: s.roadS, phase: 'perch', t: 0, armed: true,
        flyer: f, glide: 1, tuck: 0,
        cross: new THREE.Vector3(), dir: new THREE.Vector3(), far: new THREE.Vector3(),
      });
    });
  }

  /** Is any eagle in the air right now? */
  get diving(): boolean {
    return this.birds.some((b) => b.phase !== 'perch');
  }

  update(time: number, dt: number, target: THREE.Vector3, playerS = 0, speed = 0): void {
    const L = this.trackLength;
    for (const b of this.birds) {
      if (b.phase === 'perch') {
        // Direction to the player in the eagle's own frame: head yaw (limited to ±110°) and pitch.
        this.v.copy(target).sub(b.root.position);
        const yawWorld = Math.atan2(this.v.x, this.v.z);
        let rel = yawWorld - b.yaw;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        const yaw = THREE.MathUtils.clamp(rel, -1.9, 1.9);
        const pitch = THREE.MathUtils.clamp(-Math.atan2(this.v.y, Math.hypot(this.v.x, this.v.z)), -0.2, 0.9);
        // Small twitchy corrections on top, the way a raptor looks around.
        this.e.set(pitch + 0.03 * Math.sin(time * 2.3 + b.ph), yaw + 0.05 * Math.sin(time * 0.9 + b.ph), 0.06 * Math.sin(time * 1.7 + b.ph));
        b.head.quaternion.slerp(this.q.setFromEuler(this.e), 1 - Math.exp(-dt * 5));
        b.root.rotation.z = 0.02 * Math.sin(time * 0.8 + b.ph);
        // Dive? The point where it will cross the road is where the car will be in DIVE_TIME, plus 16 m; it
        // goes when that point comes level with its rock.
        const crossS = playerS + speed * DIVE_TIME + 16;
        const off = ((((b.roadS - crossS) % L) + L + L / 2) % L) - L / 2;
        if (b.armed && speed > 25 && Math.abs(off) < 20 && !this.diving) {
          b.armed = false;
          if (Math.random() < this.diveChance) {
            this.pointAt(crossS, b.cross);
            b.cross.y += 3.4;
            b.dir.copy(b.cross).sub(b.root.position).setY(0).normalize();
            b.far.copy(b.cross).addScaledVector(b.dir, 150).setY(b.cross.y + 55);
            b.phase = 'dive';
            b.t = 0;
            b.root.visible = false;
            b.flyer.group.visible = true;
            b.flyer.group.position.copy(b.root.position);
            this.prev.copy(b.root.position);
          }
        }
        const gone = ((((b.roadS - playerS) % L) + L + L / 2) % L) - L / 2;
        if (!b.armed && Math.abs(gone) > 350) b.armed = true;
        continue;
      }
      // In the air: three legs, each a curve.
      b.t += dt;
      const perch = this.a.copy(b.root.position).setY(b.root.position.y + 2);
      const bez = (p0: THREE.Vector3, c: THREE.Vector3, p1: THREE.Vector3, u: number, out: THREE.Vector3) =>
        out.copy(p0).multiplyScalar((1 - u) * (1 - u)).addScaledVector(c, 2 * u * (1 - u)).addScaledVector(p1, u * u);
      const pos = b.flyer.group.position;
      let glide = 1, tuck = 0, strike = 0;
      if (b.phase === 'dive') {
        // Off the rock, falling faster and faster, levelling out just over the road.
        const u = Math.min(1, b.t / DIVE_TIME);
        const ctl = this.b.copy(perch).lerp(b.cross, 0.55).setY(b.cross.y + 1);
        bez(perch, ctl, b.cross, u * u * 0.55 + u * 0.45, pos);
        // The stoop: wings half folded, feet coming forward as it levels out over the road.
        tuck = u < 0.75 ? 0.8 : 0.8 * (1 - (u - 0.75) / 0.25);
        strike = THREE.MathUtils.smoothstep(u, 0.6, 0.95);
        if (u >= 1) { b.phase = 'away'; b.t = 0; }
      } else if (b.phase === 'away') {
        // Across the road and up again, flapping hard.
        const u = Math.min(1, b.t / AWAY_TIME);
        const ctl = this.b.copy(b.cross).addScaledVector(b.dir, 70).setY(b.cross.y + 2);
        bez(b.cross, ctl, b.far, u, pos);
        glide = 0;
        strike = 1 - THREE.MathUtils.smoothstep(u, 0, 0.3);
        if (u >= 1) { b.phase = 'return'; b.t = 0; }
      } else {
        // A wide turn back to the rock.
        const u = Math.min(1, b.t / RETURN_TIME);
        const k = u * u * (3 - 2 * u);
        const ctl = this.b.copy(b.far).lerp(perch, 0.5).addScaledVector(this.v.set(-b.dir.z, 0, b.dir.x), 120).setY(perch.y + 40);
        bez(b.far, ctl, perch, k, pos);
        glide = u > 0.75 ? 1 : 0.3;
        if (u >= 1) {
          b.phase = 'perch';
          b.root.visible = true;
          b.flyer.group.visible = false;
          continue;
        }
      }
      // Nose along the flight path (it pitches down in the stoop and up in the climb).
      this.v.copy(pos).sub(this.prev);
      if (this.v.lengthSq() > 1e-6) b.flyer.group.lookAt(this.v.add(pos));
      this.prev.copy(pos);
      // Wings: slow deep beats when flapping, a shallow V when gliding, half folded back in the stoop.
      const k = 1 - Math.exp(-dt * 6);
      b.glide += (glide - b.glide) * k;
      b.tuck += (tuck - b.tuck) * k;
      const beat = Math.sin(time * 6.5 + b.ph), beatLag = Math.sin(time * 6.5 + b.ph - 0.9);
      const flap = (1 - b.glide) * (1 - b.tuck);
      b.flyer.inner.forEach((w, i) => {
        const sd = i === 0 ? 1 : -1;
        w.rotation.z = sd * (0.14 * b.glide + 0.3 * b.tuck + flap * 0.7 * beat);
        w.rotation.y = -sd * 0.35 * b.tuck;
      });
      b.flyer.outer.forEach((w, i) => {
        const sd = i === 0 ? 1 : -1;
        w.rotation.z = sd * (0.1 * b.glide - 0.5 * b.tuck + flap * 0.55 * beatLag);
        w.rotation.y = -sd * 1.0 * b.tuck;
      });
      b.flyer.legs.rotation.x = 0.9 - 1.9 * strike; // tucked back -> thrust forward, talons open
    }
  }
}
