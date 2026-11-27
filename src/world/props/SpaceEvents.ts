import * as THREE from 'three';
import { haloTexture } from '../../game/car/CarBuilder';
import { LoopTrack, makeFrame } from '../../track/Track';

/**
 * Orbit Run sky events:
 *  - shooting stars: thin bright streaks across the sky, every few seconds;
 *  - a burning meteor falling in the far distance (a big fireball with a long flame tail);
 *  - a meteor strike: a fireball comes down on the road ahead of you — flash, shock ring, sparks, a glowing
 *    crater mark that cools down (visual only: nothing to hit), a camera shake and a boom;
 *  - a flying saucer that pulls up next to you, flies along for a while and then shoots off into the dark.
 * No real lights are used (adding a light mid-race recompiles every lit shader and freezes the game): everything
 * glows through bright unlit / additive materials and the bloom pass.
 */

type Player = { s: number; x: number; v: number };

const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function halo(color: THREE.ColorRepresentation, k = 1): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(), color: new THREE.Color(color).multiplyScalar(k), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
  }));
  s.renderOrder = 8;
  return s;
}

/**
 * Streak / flame tail: a tapered ribbon along +X (head at x = 0, tail at x = -1), always turned toward the
 * viewer. uHead / uTail colours, uFire > 0 adds a flickering, ragged fire look.
 */
function tailMaterial(head: THREE.ColorRepresentation, tail: THREE.ColorRepresentation, fire: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uHead: { value: new THREE.Color(head) }, uTail: { value: new THREE.Color(tail) }, uFire: { value: fire }, uTime: { value: 0 }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHead, uTail; uniform float uFire, uTime, uAlpha; varying vec2 vUv;
      float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vn(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float t = 1.0 - vUv.x;                 // 0 at the head, 1 at the end of the tail
        float across = abs(vUv.y - 0.5) * 2.0; // 0 on the centre line, 1 at the edge
        // The tail narrows to a point; fire tails get a ragged, flowing edge.
        float n = vn(vec2(t * 9.0 - uTime * 7.0, vUv.y * 5.0)) * 0.6 + vn(vec2(t * 23.0 - uTime * 13.0, vUv.y * 11.0)) * 0.4;
        float width = (1.0 - t) * mix(1.0, 0.55 + 0.75 * n, uFire) + 0.02;
        float a = (1.0 - smoothstep(width * 0.35, width, across)) * pow(1.0 - t, mix(1.6, 0.9, uFire));
        a *= mix(1.0, 0.65 + 0.7 * n, uFire);
        vec3 col = mix(uHead, uTail, smoothstep(0.0, mix(0.5, 0.75, uFire), t + across * 0.25));
        gl_FragColor = vec4(col * a * uAlpha, a * uAlpha);
      }`,
  });
}

/** Orient a ribbon mesh: its +X along `dir`, its face turned toward `eye`. */
function aimRibbon(mesh: THREE.Object3D, dir: THREE.Vector3, eye: THREE.Vector3): void {
  _x.copy(dir).normalize();
  _z.copy(eye).sub(mesh.position);
  _z.addScaledVector(_x, -_z.dot(_x));
  if (_z.lengthSq() < 1e-6) _z.set(0, 1, 0);
  _z.normalize();
  _y.crossVectors(_z, _x);
  mesh.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

/** Ribbon geometry: x from -1 (tail) to 0 (head), y from -0.5 to 0.5. */
const ribbonGeo = () => new THREE.PlaneGeometry(1, 1, 24, 1).translate(-0.5, 0, 0);

// ------------------------------------------------------------------ shooting stars + far meteors

interface Streak {
  mesh: THREE.Mesh;
  head: THREE.Sprite | null;
  mat: THREE.ShaderMaterial;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  len: number;
  width: number;
}

/** Shooting stars (many, quick, thin) and now and then a burning meteor far away (slow, fat, on fire). */
export class ShootingStars {
  readonly group = new THREE.Group();
  private readonly stars: Streak[] = [];
  private readonly meteors: Streak[] = [];
  private starTimer = 1.5;
  private meteorTimer = 6;
  private readonly frame = makeFrame();
  private readonly eye = new THREE.Vector3();

  constructor(private readonly track: LoopTrack) {
    this.group.name = 'shooting-stars';
    const mk = (fire: boolean): Streak => {
      const mat = fire ? tailMaterial(new THREE.Color('#fff2c0').multiplyScalar(3.2), new THREE.Color('#ff4a0a').multiplyScalar(1.6), 1) : tailMaterial(new THREE.Color('#ffffff').multiplyScalar(3), new THREE.Color('#7ab8ff').multiplyScalar(1.2), 0);
      const mesh = new THREE.Mesh(ribbonGeo(), mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 7;
      this.group.add(mesh);
      let head: THREE.Sprite | null = null;
      if (fire) {
        head = halo('#ffd890', 2.4);
        head.visible = false;
        this.group.add(head);
      }
      return { mesh, head, mat, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, life: 0, len: 1, width: 1 };
    };
    for (let i = 0; i < 5; i++) this.stars.push(mk(false));
    for (let i = 0; i < 2; i++) this.meteors.push(mk(true));
  }

  /** Start a streak on the sky dome around the player. */
  private launch(s: Streak, fire: boolean): void {
    const az = Math.random() * Math.PI * 2;
    if (fire) {
      // An enormous fireball far off (2.6-3.6 km), high up, coming down at a slant: slow to the eye, on fire all the way.
      const dist = 2600 + Math.random() * 1000;
      s.pos.set(Math.cos(az) * dist, 1300 + Math.random() * 700, Math.sin(az) * dist).add(this.eye);
      const side = az + Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      s.vel.set(Math.cos(side) * (0.5 + Math.random() * 0.5), -(0.75 + Math.random() * 0.5), Math.sin(side) * (0.5 + Math.random() * 0.5)).normalize().multiplyScalar(380 + Math.random() * 180);
      s.life = 6 + Math.random() * 2.5;
      s.len = 1500 + Math.random() * 900;
      s.width = 260 + Math.random() * 120;
    } else {
      const dist = 3200;
      const el = 0.2 + Math.random() * 0.9;
      s.pos.set(Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.sin(az) * Math.cos(el) * dist).add(this.eye);
      const side = az + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2) + (Math.random() - 0.5) * 0.8;
      s.vel.set(Math.cos(side), -(0.15 + Math.random() * 0.6), Math.sin(side)).normalize().multiplyScalar(2600 + Math.random() * 1600);
      s.life = 0.45 + Math.random() * 0.6;
      s.len = 1300 + Math.random() * 1000;
      s.width = 60 + Math.random() * 40;
    }
    s.age = 0;
    s.mesh.visible = true;
    if (s.head) s.head.visible = true;
  }

  update(time: number, dt: number, player: Player): void {
    this.track.frameAt(player.s, this.frame);
    this.eye.copy(this.frame.position).addScaledVector(this.frame.right, player.x);
    this.eye.y += 2;
    this.starTimer -= dt;
    if (this.starTimer <= 0) {
      const free = this.stars.find((s) => !s.mesh.visible);
      if (free) this.launch(free, false);
      // Mostly singles a few seconds apart; sometimes two or three in quick succession.
      this.starTimer = Math.random() < 0.3 ? 0.25 + Math.random() * 0.5 : 2 + Math.random() * 3.5;
    }
    this.meteorTimer -= dt;
    if (this.meteorTimer <= 0) {
      const free = this.meteors.find((s) => !s.mesh.visible);
      if (free) this.launch(free, true);
      this.meteorTimer = 12 + Math.random() * 14;
    }
    for (const s of [...this.stars, ...this.meteors]) {
      if (!s.mesh.visible) continue;
      s.age += dt;
      const k = s.age / s.life;
      if (k >= 1) {
        s.mesh.visible = false;
        if (s.head) s.head.visible = false;
        continue;
      }
      s.pos.addScaledVector(s.vel, dt);
      s.mesh.position.copy(s.pos);
      aimRibbon(s.mesh, s.vel, this.eye);
      // The tail grows out behind the head at first, and the whole thing fades at the end.
      const grow = Math.min(1, s.age / (s.head ? 0.8 : 0.12));
      s.mesh.scale.set(s.len * grow, s.width, 1);
      const fade = Math.min(1, k * 8) * (1 - THREE.MathUtils.smoothstep(k, 0.7, 1));
      s.mat.uniforms.uAlpha.value = fade;
      s.mat.uniforms.uTime.value = time;
      if (s.head) {
        s.head.position.copy(s.pos);
        s.head.scale.setScalar(s.width * (1.9 + 0.3 * Math.sin(time * 37)));
        (s.head.material as THREE.SpriteMaterial).opacity = fade;
      }
    }
  }
}

// ------------------------------------------------------------------ meteor strike on the road

const SPARKS = 90;

/**
 * A meteor that hits the road a little way ahead of the player. Purely a show: the crater mark is flat and
 * nothing collides with it.
 */
export class MeteorStrike {
  readonly group = new THREE.Group();
  private readonly frame = makeFrame();
  private timer = 22;
  private phase: 'idle' | 'fall' | 'burn' = 'idle';
  private age = 0;
  private readonly from = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly viewFwd = new THREE.Vector3();
  private readonly viewRight = new THREE.Vector3();
  private fallTime = 1.3;
  // Parts.
  private readonly rock: THREE.Mesh;
  private readonly glow = halo('#ffc070', 3);
  private readonly tail: THREE.Mesh;
  private readonly tailMat = tailMaterial(new THREE.Color('#fff2c0').multiplyScalar(3.4), new THREE.Color('#ff3a08').multiplyScalar(1.8), 1);
  private readonly flash = halo('#fff4dc', 8);
  private readonly fireball = halo('#ff7a1c', 6);
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.ShaderMaterial;
  private readonly scar: THREE.Mesh;
  private readonly scarMat: THREE.ShaderMaterial;
  private readonly sparks: THREE.Points;
  private readonly sparkMat: THREE.ShaderMaterial;
  private readonly smoke: THREE.Sprite[] = [];
  /** The player already drove into this strike (slowed once per strike). */
  private struck = false;

  constructor(
    private readonly track: LoopTrack,
    private readonly fx: { sound?: (kind: 'meteor') => void; shake?: (amount: number) => void; hit?: (slow: number, label: string) => void } = {},
  ) {
    this.group.name = 'meteor-strike';
    this.rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8a30').multiplyScalar(2.2), fog: false }));
    this.tail = new THREE.Mesh(ribbonGeo(), this.tailMat);
    this.tail.frustumCulled = false;
    this.tail.renderOrder = 7;
    // Shock ring: a flat disc on the road; the shader draws an expanding, thinning ring.
    this.ringMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: { uK: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uK; varying vec2 vP;
        void main() {
          float r = length(vP);                       // 0..1 across the disc
          float edge = uK * 0.96;
          float w = mix(0.05, 0.16, uK);
          float a = smoothstep(edge - w, edge, r) * (1.0 - smoothstep(edge, edge + 0.03, r)) * (1.0 - uK) * (1.0 - uK);
          gl_FragColor = vec4(vec3(1.0, 0.72, 0.4) * 2.6 * a, a);
        }`,
    });
    this.ring = new THREE.Mesh(new THREE.CircleGeometry(1, 48), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2; // the shader works in the disc's own xy plane; the mesh is laid flat
    this.ring.renderOrder = 4;
    // Crater mark: scorched black centre, glowing cracks and embers that cool down (uHeat 1 -> 0).
    this.scarMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      uniforms: { uHeat: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uHeat, uFade, uTime; varying vec2 vP;
        float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vn(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        void main() {
          float r = length(vP);
          float ang = atan(vP.y, vP.x);
          // Ragged outline: splash streaks reaching out from the centre.
          float rim = 0.55 + 0.3 * vn(vec2(ang * 3.0, 1.7)) + 0.15 * vn(vec2(ang * 11.0, 4.2));
          float soot = 1.0 - smoothstep(rim * 0.55, rim, r);
          // Radial cracks + a molten centre, flickering.
          float cn = vn(vec2(ang * 5.0 + vn(vP * 4.0) * 1.5, r * 2.0));
          float crack = (1.0 - smoothstep(0.0, 0.09, abs(cn - 0.5))) * (1.0 - smoothstep(0.2, rim * 0.95, r));
          float core = 1.0 - smoothstep(0.1, 0.42, r + (vn(vP * 9.0) - 0.5) * 0.12);
          float lip = (1.0 - smoothstep(0.0, 0.05, abs(r - rim * 0.5))) * 0.6;
          float ember = step(0.9, h21(floor(vP * 26.0))) * soot;
          float glow = (crack * 1.1 + core * 1.5 + lip + ember * 0.8) * uHeat * (0.8 + 0.2 * sin(uTime * 9.0 + r * 20.0));
          vec3 col = mix(vec3(0.02, 0.015, 0.02), vec3(1.0, 0.45, 0.1) * 2.6, clamp(glow, 0.0, 1.0)) + vec3(1.0, 0.85, 0.5) * max(glow - 1.0, 0.0) * 2.0;
          float a = max(soot * 0.85, clamp(glow, 0.0, 1.0)) * uFade;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.scar = new THREE.Mesh(new THREE.CircleGeometry(1, 40), this.scarMat);
    this.scar.rotation.x = -Math.PI / 2;
    this.scar.renderOrder = 3;
    // Sparks: thrown up and out from the impact, falling back (all in the vertex shader).
    const sg = new THREE.BufferGeometry();
    const vel = new Float32Array(SPARKS * 3), seed = new Float32Array(SPARKS);
    for (let i = 0; i < SPARKS; i++) {
      const a = Math.random() * Math.PI * 2, out = 4 + Math.random() * 16;
      vel.set([Math.cos(a) * out, 6 + Math.random() * 20, Math.sin(a) * out], i * 3);
      seed[i] = Math.random();
    }
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    sg.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.sparkMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uAge: { value: 0 }, uMap: { value: haloTexture() }, uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        attribute vec3 aVel; attribute float aSeed; uniform float uAge, uScale; varying float vA;
        void main() {
          float life = 0.7 + aSeed * 1.1;
          float t = uAge / life;
          vec3 p = aVel * uAge + vec3(0.0, -14.0 * uAge * uAge, 0.0);
          p.y = max(p.y, 0.05);
          vA = t < 1.0 ? (1.0 - t) : 0.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.25 + aSeed * 0.35) * uScale / max(-mv.z, 0.5);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying float vA;
        void main() { float m = texture2D(uMap, gl_PointCoord).a; float a = m * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(1.0, 0.7, 0.3) * 3.0 * a, a); }`,
    });
    this.sparks = new THREE.Points(sg, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 7;
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: '#3a3238', transparent: true, depthWrite: false, opacity: 0, fog: false }));
      s.renderOrder = 6;
      this.smoke.push(s);
      this.group.add(s);
    }
    this.group.add(this.rock, this.glow, this.tail, this.flash, this.fireball, this.ring, this.scar, this.sparks);
    this.hideAll();
  }

  private hideAll(): void {
    for (const o of this.group.children) o.visible = false;
  }

  update(time: number, dt: number, player: Player): void {
    this.track.frameAt(player.s, this.frame);
    this.eye.copy(this.frame.position).addScaledVector(this.frame.right, player.x);
    this.eye.y += 2.5;
    if (this.phase === 'idle') {
      this.timer -= dt;
      if (this.timer > 0 || player.v < 15) return;
      this.viewFwd.copy(this.frame.forward);
      this.viewRight.copy(this.frame.right);
      // Lands where the player will be in `fallTime` plus 45-80 m, in the open (not under a roof), on the
      // road but not in the player's own lane.
      this.fallTime = 1.25 + Math.random() * 0.35;
      const s = player.s + player.v * this.fallTime + 45 + Math.random() * 35;
      if (this.track.sectionAt(s, 30) || this.track.sectionAt(player.s, 10)) { this.timer = 1.5; return; }
      this.track.frameAt(s, this.frame);
      const hw = this.track.width / 2;
      let lat = (Math.random() * 2 - 1) * (hw - 1.5);
      if (Math.abs(lat - player.x) < 3.2) lat += lat > player.x ? 3.2 : -3.2;
      lat = THREE.MathUtils.clamp(lat, -(hw - 1), hw - 1);
      this.hit.copy(this.frame.position).addScaledVector(this.frame.right, lat);
      this.hit.y += 0.03;
      const side = Math.random() < 0.5 ? -1 : 1;
      // Comes in from far ahead along the way the driver is looking (not along the road at the impact point,
      // which may bend out of view) and not too steep: the whole fall happens in the windscreen.
      this.from.copy(this.hit).addScaledVector(this.viewRight, side * (30 + Math.random() * 60)).addScaledVector(this.viewFwd, 240 + Math.random() * 100);
      this.from.y += 130 + Math.random() * 50;
      this.vel.copy(this.hit).sub(this.from).divideScalar(this.fallTime);
      this.phase = 'fall';
      this.age = 0;
      this.rock.visible = this.glow.visible = this.tail.visible = true;
    }
    this.age += dt;
    if (this.phase === 'fall') {
      const k = Math.min(1, this.age / this.fallTime);
      this.rock.position.copy(this.from).addScaledVector(this.vel, this.age);
      this.rock.rotation.x += dt * 9;
      this.rock.rotation.z += dt * 6;
      this.glow.position.copy(this.rock.position);
      this.glow.scale.setScalar(16 + 3 * Math.sin(time * 41));
      this.tail.position.copy(this.rock.position);
      aimRibbon(this.tail, this.vel, this.eye);
      this.tail.scale.set(Math.min(1, this.age / 0.35) * 110, 11, 1);
      this.tailMat.uniforms.uTime.value = time;
      if (k >= 1) {
        // Impact.
        this.phase = 'burn';
        this.age = 0;
        this.rock.visible = this.glow.visible = this.tail.visible = false;
        for (const o of [this.flash, this.fireball, this.ring, this.scar, this.sparks, ...this.smoke]) {
          o.visible = true;
          o.position.copy(this.hit);
        }
        this.smoke.forEach((s, i) => s.userData.dir = new THREE.Vector3(Math.cos(i * 1.9) * 1.6, 2.2 + (i % 3) * 0.8, Math.sin(i * 1.9) * 1.6));
        const dist = this.hit.distanceTo(this.eye);
        this.fx.sound?.('meteor');
        this.fx.shake?.(THREE.MathUtils.clamp(1.2 - dist / 110, 0.25, 1));
        this.struck = false;
      }
      return;
    }
    // Driving into the impact (fireball, then the burning crater) slows you down, once per strike.
    if (!this.struck && this.age < 5) {
      const dx = this.eye.x - this.hit.x, dz = this.eye.z - this.hit.z;
      if (dx * dx + dz * dz < 4.5 * 4.5 && Math.abs(this.eye.y - 2.5 - this.hit.y) < 3) {
        this.struck = true;
        this.fx.hit?.(0.4, 'METEOR!');
        this.fx.shake?.(1);
      }
    }
    // After the impact: white flash (0.3 s), orange fireball rising (0.9 s), shock ring (0.7 s), sparks (~1.8 s),
    // smoke (~3 s), crater cooling (12 s).
    const a = this.age;
    const fl = Math.max(0, 1 - a / 0.3);
    this.flash.visible = fl > 0;
    this.flash.position.copy(this.hit).setY(this.hit.y + 1.5);
    this.flash.scale.setScalar(12 + 30 * (1 - fl));
    (this.flash.material as THREE.SpriteMaterial).opacity = fl;
    const fb = Math.max(0, 1 - a / 0.9);
    this.fireball.visible = fb > 0;
    this.fireball.position.copy(this.hit).setY(this.hit.y + 2 + a * 7);
    this.fireball.scale.setScalar(8 + 22 * (1 - fb * fb));
    (this.fireball.material as THREE.SpriteMaterial).opacity = fb * fb;
    const rk = Math.min(1, a / 0.7);
    this.ring.visible = rk < 1;
    this.ring.scale.setScalar(22);
    this.ringMat.uniforms.uK.value = 1 - Math.pow(1 - rk, 2.2);
    this.sparks.visible = a < 1.9;
    this.sparkMat.uniforms.uAge.value = a;
    this.smoke.forEach((s, i) => {
      const t = a / (2.2 + i * 0.35);
      s.visible = t < 1;
      if (!s.visible) return;
      s.position.copy(this.hit).addScaledVector(s.userData.dir as THREE.Vector3, a);
      s.scale.setScalar(3 + 9 * t);
      (s.material as THREE.SpriteMaterial).opacity = 0.5 * (1 - t) * Math.min(1, a * 6);
    });
    this.scar.scale.setScalar(5.5);
    this.scarMat.uniforms.uHeat.value = Math.exp(-a * 0.3);
    this.scarMat.uniforms.uFade.value = 1 - THREE.MathUtils.smoothstep(a, 9, 12);
    this.scarMat.uniforms.uTime.value = time;
    if (a > 12) {
      this.phase = 'idle';
      this.hideAll();
      this.timer = 20 + Math.random() * 22;
    }
  }
}

// ------------------------------------------------------------------ flying saucer

/** Classic saucer (original design): brushed disc, glass dome with a green glow, a ring of running lights. */
export function saucer(): { group: THREE.Group; lights: THREE.MeshBasicMaterial[]; spin: THREE.Group; beam: THREE.Mesh } {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#b9c2d0', metalness: 0.95, roughness: 0.22 });
  const dark = new THREE.MeshStandardMaterial({ color: '#3a4050', metalness: 0.9, roughness: 0.35 });
  // Hull: lathed lens profile (radius, y), with a stepped underside.
  const prof: [number, number][] = [[0, -0.55], [0.9, -0.55], [1.2, -0.42], [2.2, -0.26], [3.2, -0.08], [3.45, 0.02], [3.2, 0.14], [2.3, 0.34], [1.5, 0.5], [1.25, 0.56]];
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 64), metal));
  const collar = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.09, 12, 48).rotateX(Math.PI / 2), dark);
  collar.position.y = 0.56;
  g.add(collar);
  // Dome: clear glass over a glowing cabin.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.2, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#9affd8', metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.38, emissive: '#2aff9a', emissiveIntensity: 0.9 }));
  dome.position.y = 0.56;
  dome.scale.y = 0.85;
  g.add(dome);
  const cabin = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color('#7affc0').multiplyScalar(1.6) }));
  cabin.position.y = 0.85;
  g.add(cabin);
  // Running lights around the rim (they chase each other) + a spinning underside ring.
  const spin = new THREE.Group();
  const lights: THREE.MeshBasicMaterial[] = [];
  const bulb = new THREE.SphereGeometry(0.17, 12, 8);
  for (let i = 0; i < 12; i++) {
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    lights.push(m);
    const b = new THREE.Mesh(bulb, m);
    const a = (i / 12) * Math.PI * 2;
    b.position.set(Math.cos(a) * 3.05, 0.02, Math.sin(a) * 3.05);
    spin.add(b);
  }
  const under = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.12, 10, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#7ad8ff').multiplyScalar(1.7) }));
  under.position.y = -0.56;
  spin.add(under);
  g.add(spin);
  // Soft light cone under the craft.
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 3.4, 7, 32, 1, true).translate(0, -3.5, 0),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uK: { value: 1 } },
      vertexShader: /* glsl */ `varying float vT; void main() { vT = -position.y / 7.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uK; varying float vT; void main() { float a = (1.0 - vT) * (1.0 - vT) * 0.22 * uK; gl_FragColor = vec4(vec3(0.5, 0.95, 1.0) * a, a); }`,
    }),
  );
  beam.position.y = -0.55;
  beam.renderOrder = 7;
  g.add(beam);
  return { group: g, lights, spin, beam };
}

export const SAUCER_SCALE = 1.35;

/**
 * The saucer drops in beside the player, matches their speed and flies along (bobbing, banking, lights running),
 * then tilts and shoots off into the sky in a blink, leaving a short streak.
 */
export class Ufo {
  readonly group = new THREE.Group();
  private readonly craft = saucer();
  private readonly streak: THREE.Mesh;
  private readonly streakMat = tailMaterial(new THREE.Color('#e0fff4').multiplyScalar(3), new THREE.Color('#2aff9a').multiplyScalar(1.4), 0);
  private readonly glow = halo('#7affd0', 1.2);
  private readonly frame = makeFrame();
  private readonly pos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  /** Where it drops in from, relative to its cruise spot (which moves with the player). */
  private readonly entry = new THREE.Vector3();
  private readonly away = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private timer = 32;
  private phase: 'idle' | 'arrive' | 'cruise' | 'leave' = 'idle';
  private age = 0;
  private side = 1;
  private cruiseTime = 8;
  private speed = 0;

  constructor(private readonly track: LoopTrack, private readonly fx: { sound?: (kind: 'ufo') => void } = {}) {
    this.group.name = 'ufo';
    this.streak = new THREE.Mesh(ribbonGeo(), this.streakMat);
    this.streak.frustumCulled = false;
    this.streak.renderOrder = 7;
    this.streak.visible = false;
    this.group.add(this.craft.group, this.glow, this.streak);
    this.group.visible = false;
  }

  update(time: number, dt: number, player: Player): void {
    this.track.frameAt(player.s, this.frame);
    this.eye.copy(this.frame.position).addScaledVector(this.frame.right, player.x);
    this.eye.y += 2.5;
    if (this.phase === 'idle') {
      this.timer -= dt;
      if (this.timer > 0 || player.v < 15 || this.track.sectionAt(player.s + 30, 120)) return;
      this.phase = 'arrive';
      this.age = 0;
      this.side = Math.random() < 0.5 ? -1 : 1;
      this.cruiseTime = 6.5 + Math.random() * 4;
      this.group.visible = true;
      this.streak.visible = false;
      this.craft.group.scale.setScalar(SAUCER_SCALE);
      // Drops in from high up, ahead and to the side.
      this.entry.copy(this.frame.forward).multiplyScalar(150).addScaledVector(this.frame.right, this.side * 70);
      this.entry.y += 105;
    }
    this.age += dt;
    const hw = this.track.width / 2;
    // Where it flies while it keeps you company: a little ahead, just outside the barrier, a few metres up.
    this.track.frameAt(player.s + 24 + Math.sin(time * 0.6) * 5, this.frame);
    this.target.copy(this.frame.position).addScaledVector(this.frame.right, this.side * (hw + 5.5 + Math.sin(time * 0.9) * 1.6));
    this.target.y += 5.2 + Math.sin(time * 1.7) * 0.7;
    const craft = this.craft;
    if (this.phase === 'arrive') {
      // Swoops down onto its cruise spot and settles there. (Positions are relative to the moving cruise spot:
      // chasing an absolute point made it hang 10+ m behind at racing speed, half out of view.)
      const k = 1 - Math.pow(1 - Math.min(1, this.age / 2.4), 3);
      this.pos.copy(this.target).addScaledVector(this.entry, 1 - k);
      if (this.age > 2.4) { this.phase = 'cruise'; this.age = 0; }
    } else if (this.phase === 'cruise') {
      this.pos.copy(this.target);
      // Under a roof the show is over early.
      if (this.age > this.cruiseTime || this.track.sectionAt(player.s + 60, 20)) {
        this.phase = 'leave';
        this.age = 0;
        this.speed = Math.max(40, player.v);
        // Off and up, away from the road, ahead of you (so you watch it go).
        this.away.copy(this.frame.forward).multiplyScalar(0.75).addScaledVector(this.frame.right, this.side * 0.45).addScaledVector(_up, 0.5).normalize();
        this.fx.sound?.('ufo');
      }
    } else {
      // A short wind-up (it tips toward where it is going), then gone: the speed multiplies every frame.
      if (this.age > 0.35) {
        this.speed *= Math.exp(dt * 7.5);
        this.pos.addScaledVector(this.away, this.speed * dt);
      } else this.pos.copy(this.target);
      const k = THREE.MathUtils.clamp((this.age - 0.35) / 1.1, 0, 1);
      craft.group.scale.setScalar(SAUCER_SCALE * (1 - 0.75 * k)); // shrinks into a point of light
      this.streak.visible = k > 0;
      this.streak.position.copy(this.pos);
      aimRibbon(this.streak, this.away, this.eye);
      this.streak.scale.set(Math.min(220, this.speed * 0.16) * (1 - 0.5 * k), 5.5 * (1 - 0.6 * k), 1);
      this.streakMat.uniforms.uAlpha.value = 1 - k * k;
      if (this.age > 1.5) {
        this.phase = 'idle';
        this.group.visible = false;
        this.timer = 34 + Math.random() * 30;
        return;
      }
    }
    craft.group.position.copy(this.pos);
    // Banks with its sideways drift and wobbles like a spinning top; on leaving it tips along its escape line.
    const bank = this.phase === 'leave' ? Math.min(1, this.age / 0.35) : 0;
    craft.group.rotation.set(Math.sin(time * 2.3) * 0.07 + bank * 0.5, 0, Math.cos(time * 1.9) * 0.07 - this.side * bank * 0.35);
    craft.spin.rotation.y += dt * (2.5 + bank * 20);
    // Running lights: a bright pulse runs round the rim, in changing colours.
    craft.lights.forEach((m, i) => {
      const ph = ((time * 1.6 + i / craft.lights.length) % 1 + 1) % 1;
      const on = Math.pow(1 - ph, 3);
      m.color.setHSL((i / craft.lights.length + time * 0.08) % 1, 1, 0.5).multiplyScalar(0.5 + 3 * on);
    });
    (craft.beam.material as THREE.ShaderMaterial).uniforms.uK.value = this.phase === 'leave' ? Math.max(0, 1 - this.age * 4) : 0.8 + 0.2 * Math.sin(time * 5);
    this.glow.position.copy(this.pos);
    this.glow.scale.setScalar(this.phase === 'leave' ? 9 + this.age * 30 : 13);
    (this.glow.material as THREE.SpriteMaterial).opacity = this.phase === 'leave' ? Math.max(0, 0.9 - this.age * 0.4) : 0.35;
  }
}
