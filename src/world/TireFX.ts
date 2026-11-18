import * as THREE from 'three';
import { haloTexture } from '../game/car/CarBuilder';
import { atmosphere } from '../render/atmosphere';

/**
 * Tyre effects for every car:
 *  - skid marks laid by the rear tyres while drifting / sliding (soft grey, fade out after ~25 s),
 *  - light tyre smoke while drifting on a dry road,
 *  - water spray behind the wheels on a wet road (more when sliding), as droplets + mist.
 * Particles are simulated in the vertex shader from their spawn data, so only new ones are uploaded.
 */

interface TireCar {
  car: { group: THREE.Object3D; wheels: THREE.Object3D[]; exhausts?: THREE.Vector3[] };
  phys: { v: number; drift: number; slip: number; boosting?: boolean };
  input: { handbrake?: number };
  left?: boolean;
}

const MARKS = 12000; // quads in the skid-mark ring buffer
const PARTS = 4000; // particles in the ring buffer

export class TireFX {
  readonly group = new THREE.Group();
  private readonly markPos: THREE.BufferAttribute;
  private readonly markBirth: THREE.BufferAttribute;
  private readonly markMat: THREE.ShaderMaterial;
  private markHead = 0;
  private readonly pPos: THREE.BufferAttribute;
  private readonly pVel: THREE.BufferAttribute;
  private readonly pData: THREE.BufferAttribute; // birth, life, size0, kind
  private readonly pSeed: THREE.BufferAttribute; // random shape / rotation per particle
  private readonly pMat: THREE.ShaderMaterial;
  private pHead = 0;
  private time = 0;
  private readonly last = new Map<TireCar, (THREE.Vector3 | null)[]>();
  private readonly w = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private markLo = -1;
  private markN = 0;
  private pDirty = false;
  private readonly carStep = new THREE.Vector3();
  private frameDt = 1 / 60;

  constructor() {
    // Skid marks: non-indexed quads (6 verts each).
    const mg = new THREE.BufferGeometry();
    this.markPos = new THREE.BufferAttribute(new Float32Array(MARKS * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.markBirth = new THREE.BufferAttribute(new Float32Array(MARKS * 6 * 2).fill(-1e4), 2).setUsage(THREE.DynamicDrawUsage); // birth, strength
    mg.setAttribute('position', this.markPos);
    mg.setAttribute('aBirth', this.markBirth);
    this.markMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      uniforms: { uTime: { value: 0 }, uDark: { value: 0.6 } },
      vertexShader: /* glsl */ `
        attribute vec2 aBirth; uniform float uTime; varying float vA;
        void main() {
          float age = uTime - aBirth.x;
          vA = aBirth.y * (1.0 - smoothstep(18.0, 28.0, age));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uDark; varying float vA;
        void main() { if (vA <= 0.002) discard; gl_FragColor = vec4(vec3(0.015, 0.015, 0.02), vA * uDark); }`,
    });
    const marks = new THREE.Mesh(mg, this.markMat);
    marks.frustumCulled = false;
    marks.renderOrder = 3;
    this.group.add(marks);

    // Particles.
    const pg = new THREE.BufferGeometry();
    this.pPos = new THREE.BufferAttribute(new Float32Array(PARTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.pVel = new THREE.BufferAttribute(new Float32Array(PARTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.pData = new THREE.BufferAttribute(new Float32Array(PARTS * 4).fill(-1e4), 4).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('position', this.pPos);
    pg.setAttribute('aVel', this.pVel);
    pg.setAttribute('aData', this.pData);
    this.pSeed = new THREE.BufferAttribute(new Float32Array(PARTS), 1).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('aSeed', this.pSeed);
    this.pMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uMap: { value: haloTexture() }, uScale: { value: 400 }, uMistColor: atmosphere.uMistColor },
      vertexShader: /* glsl */ `
        attribute vec3 aVel; attribute vec4 aData; attribute float aSeed;
        uniform float uTime, uScale;
        varying float vA; varying float vKind; varying float vSeed; varying float vT;
        void main() {
          float age = uTime - aData.x;
          float t = age / aData.y;
          vKind = aData.w;
          vSeed = aSeed;
          vT = t;
          vec3 p = position;
          if (t < 0.0 || t > 1.0) { vA = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          float size = aData.z;
          if (aData.w < 0.5) {            // smoke: drifts, slows, rises, grows
            p += aVel * (1.0 - exp(-age * 1.5)) / 1.5 + vec3(0.0, 0.7 * age, 0.0);
            size *= 1.0 + 2.2 * t;
            vA = 0.22 * (1.0 - t) * smoothstep(0.0, 0.08, t);
          } else if (aData.w < 1.5) {     // droplet: ballistic
            p += aVel * age + vec3(0.0, -9.8 * age * age * 0.5, 0.0);
            vA = 0.55 * (1.0 - t);
          } else if (aData.w < 2.5) {     // spray mist
            p += aVel * (1.0 - exp(-age * 2.0)) / 2.0 + vec3(0.0, 0.4 * age, 0.0);
            size *= 1.0 + 1.6 * t;
            vA = 0.26 * (1.0 - t) * smoothstep(0.0, 0.1, t);
          } else if (aData.w < 3.5) {     // bubble: rises and wobbles
            p += aVel * (1.0 - exp(-age * 2.5)) / 2.5 + vec3(sin(age * 8.0 + aSeed * 30.0) * 0.12, 1.4 * age, cos(age * 7.0 + aSeed * 20.0) * 0.12);
            size *= 1.0 + 0.5 * t;
            vA = 0.6 * (1.0 - t) * smoothstep(0.0, 0.05, t);
          } else if (aData.w < 4.5) {     // powder snow
            p += aVel * (1.0 - exp(-age * 1.8)) / 1.8 + vec3(0.0, 0.3 * age - 0.4 * age * age, 0.0);
            size *= 1.0 + 2.2 * t;
            vA = 0.42 * (1.0 - t) * smoothstep(0.0, 0.08, t);
          } else {                        // fog swirl pushed aside by a boosting car
            p += aVel * (1.0 - exp(-age * 1.2)) / 1.2 + vec3(0.0, 0.3 * age, 0.0);
            size *= 1.0 + 2.0 * t;
            vA = 0.13 * (1.0 - t) * smoothstep(0.0, 0.12, t);
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(size * uScale / max(-mv.z, 0.5), 0.0, 256.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uMistColor; varying float vA; varying float vKind; varying float vSeed; varying float vT;
        float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vn(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        void main() {
          // Each puff gets its own rotation and a wispy noise shape that slowly churns as it ages.
          float ang = vSeed * 6.2832 + (vKind > 4.5 ? vT * 3.0 : 0.0);
          vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (gl_PointCoord - 0.5);
          float m = texture2D(uMap, q + 0.5).a;
          if (vKind > 0.5 && vKind < 1.5) {
            m = smoothstep(0.25, 0.9, m); // droplets: small crisp beads
          } else if (vKind > 2.5 && vKind < 3.5) {
            float r = length(gl_PointCoord - 0.5); // bubble: thin bright rim + highlight
            m = smoothstep(0.3, 0.42, r) * smoothstep(0.5, 0.44, r) + 0.6 * smoothstep(0.12, 0.0, length(gl_PointCoord - vec2(0.36, 0.34)));
          } else {
            float n = vn(q * 5.0 + vSeed * 37.0 + vT * 1.5) * 0.65 + vn(q * 11.0 - vSeed * 13.0) * 0.35;
            m *= clamp(0.25 + 1.3 * n, 0.0, 1.4);
          }
          vec3 col = vKind < 0.5 ? vec3(0.82, 0.82, 0.86) : vKind < 1.5 ? vec3(0.8, 0.9, 1.0) : vKind < 2.5 ? vec3(0.75, 0.82, 0.9)
            : vKind < 3.5 ? vec3(0.75, 0.95, 1.0) : vKind < 4.5 ? vec3(0.97, 0.98, 1.0) : uMistColor * 1.15;
          float a = vA * m;
          if (a < 0.003) discard;
          gl_FragColor = vec4(col, a);
        }`,
    });
    const pts = new THREE.Points(pg, this.pMat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    this.group.add(pts);
  }

  /** Pixel scale for particle sizes (call on resize: viewport height in px). */
  setViewportHeight(px: number): void {
    this.pMat.uniforms.uScale.value = px * 0.55;
  }

  private addMark(a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3, strength: number): void {
    const i = this.markHead;
    this.markHead = (this.markHead + 1) % MARKS;
    const hw = 0.14;
    const p = this.markPos.array as Float32Array;
    const q = this.markBirth.array as Float32Array;
    const v = [
      a.x - side.x * hw, a.y, a.z - side.z * hw,
      a.x + side.x * hw, a.y, a.z + side.z * hw,
      b.x - side.x * hw, b.y, b.z - side.z * hw,
      b.x - side.x * hw, b.y, b.z - side.z * hw,
      a.x + side.x * hw, a.y, a.z + side.z * hw,
      b.x + side.x * hw, b.y, b.z + side.z * hw,
    ];
    if (this.markLo < 0) this.markLo = i;
    this.markN++;
    p.set(v, i * 18);
    for (let k = 0; k < 6; k++) {
      q[i * 12 + k * 2] = this.time;
      q[i * 12 + k * 2 + 1] = strength;
    }
  }

  /** back = 0..1 fraction of this frame's travel to spread the spawn over (no evenly spaced puffs at speed). */
  private spawn(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, kind: number, back = 0): void {
    const i = this.pHead;
    this.pHead = (this.pHead + 1) % PARTS;
    // Spread along the path travelled since last frame: born a little earlier, a bit further back.
    const f = Math.random() * back;
    const bx = pos.x - this.carStep.x * f, by = pos.y, bz = pos.z - this.carStep.z * f;
    (this.pPos.array as Float32Array).set([bx, by, bz], i * 3);
    (this.pVel.array as Float32Array).set([vel.x, vel.y, vel.z], i * 3);
    (this.pData.array as Float32Array).set([this.time - f * this.frameDt, life, size, kind], i * 4);
    (this.pSeed.array as Float32Array)[i] = Math.random();
    this.pDirty = true;
  }

  /** `wet` 0..1 (rain on the road), `dust` = smoke colour stays the same; marks are fainter on a wet road. */
  update(dt: number, cars: TireCar[], wet: number, fx: { precip: 'rain' | 'snow' | 'bubbles' | 'none'; mist: number } = { precip: 'rain', mist: 0 }): void {
    this.time += dt;
    this.markMat.uniforms.uTime.value = this.time;
    this.pMat.uniforms.uTime.value = this.time;
    this.markMat.uniforms.uDark.value = 0.6 * (1 - wet * 0.5);
    this.frameDt = dt;
    for (const c of cars) {
      if (c.left || !c.car.group.visible) continue;
      const p = c.phys;
      // A pack of cars: each one throws up a bit less cloud (smoke, spray mist, powder), so the pack does not
      // disappear in one big white-out. From 6 cars within 45 m: 60 % of the clouds, down to 45 % for 10+.
      let pack = 0;
      for (const o of cars) if (!o.left && o.car.group.visible && o.car.group.position.distanceToSquared(c.car.group.position) < 45 * 45) pack++;
      const thin = pack >= 6 ? Math.max(0.45, 0.6 - 0.04 * (pack - 6)) : 1;
      const sliding = Math.max(p.drift > 0.25 ? p.drift : 0, p.slip > 0.4 ? p.slip : 0, (c.input.handbrake ?? 0) > 0.3 && p.v > 5 ? 0.8 : 0);
      let last = this.last.get(c);
      if (!last) this.last.set(c, (last = [null, null]));
      const g = c.car.group;
      this.fwd.set(0, 0, -1).applyQuaternion(g.quaternion);
      this.side.set(1, 0, 0).applyQuaternion(g.quaternion);
      this.vel.copy(this.fwd).multiplyScalar(Math.max(0, p.v));
      this.carStep.copy(this.vel).multiplyScalar(dt);
      for (let k = 0; k < 2; k++) {
        const wheel = c.car.wheels[2 + k];
        if (!wheel) continue;
        this.w.copy(wheel.position).setY(0.03);
        g.localToWorld(this.w);
        // Skid marks while sliding.
        if (sliding > 0.25 && p.v > 4) {
          const prev = last[k];
          if (prev && prev.distanceToSquared(this.w) > 0.09 && prev.distanceToSquared(this.w) < 16) {
            this.addMark(prev, this.w, this.side, 0.55 + 0.45 * Math.min(1, sliding));
            prev.copy(this.w);
          } else if (!prev || prev.distanceToSquared(this.w) >= 16) last[k] = this.w.clone();
        } else last[k] = null;
        // Smoke (dry) or spray (wet).
        const rate = dt * 60;
        if (p.boosting && p.v > 10) {
          const out = k ? 1 : -1;
          if (wet > 0.15) {
            // Boost blasts the water into a big fan.
            for (let n = 0; n < Math.round(3 * rate * wet); n++) {
              const v = this.vel.clone().multiplyScalar(0.15 + Math.random() * 0.45).addScaledVector(this.side, out * (1 + Math.random() * 4));
              v.y = 2 + Math.random() * 4.5;
              this.spawn(this.w.clone(), v, 0.5 + Math.random() * 0.5, 0.06 + Math.random() * 0.12, 1, 1);
            }
            if (Math.random() < 0.9 * rate * wet * thin) {
              const v = this.vel.clone().multiplyScalar(0.4 + Math.random() * 0.3).addScaledVector(this.side, out * (0.5 + Math.random() * 2.5));
              v.y = 0.6 + Math.random();
              this.spawn(this.w.clone().setY(this.w.y + 0.4), v, 0.8 + Math.random() * 0.6, 0.7 + Math.random() * 0.7, 2, 1);
            }
          }
          if (fx.precip === 'snow') {
            // Powder snow thrown up behind the car.
            for (let n = 0, cnt = Math.floor(1.4 * rate * thin + Math.random()); n < cnt; n++) {
              const v = this.vel.clone().multiplyScalar(0.3 + Math.random() * 0.35).addScaledVector(this.side, out * (Math.random() * 2.5 - 0.5));
              v.y = 0.6 + Math.random() * 1.6;
              this.spawn(this.w.clone().setY(this.w.y + 0.2), v, 1.0 + Math.random() * 0.9, 0.5 + Math.random() * 0.9, 4, 1);
            }
          }
        }
        if (wet > 0.15 && p.v > 12) {
          const amount = Math.min(1, p.v / 60) * wet * (1 + sliding);
          const out = k ? 1 : -1;
          // Droplets: a few per frame, flung up and out of the tyre at varied speeds.
          let n = amount * 1.6 * rate;
          while (n > 0) {
            if (Math.random() < Math.min(1, n)) {
              const d = this.w.clone().addScaledVector(this.side, out * (0.05 + Math.random() * 0.15));
              const v = this.vel.clone().multiplyScalar(0.35 + Math.random() * 0.4).addScaledVector(this.side, out * (0.2 + Math.random() * 2.2));
              v.y = 0.8 + Math.random() * 3.8;
              this.spawn(d, v, 0.35 + Math.random() * 0.55, 0.05 + Math.random() * 0.11, 1, 1);
            }
            n -= 1;
          }
          // Mist: soft churning clouds of different sizes trailing the wheel.
          if (Math.random() < amount * 0.75 * rate * thin) {
            const v = this.vel.clone().multiplyScalar(0.55 + Math.random() * 0.35).addScaledVector(this.side, out * (Math.random() * 1.4 - 0.2));
            v.y = 0.15 + Math.random() * 0.8;
            const d = this.w.clone().addScaledVector(this.side, out * Math.random() * 0.25);
            d.y += 0.15 + Math.random() * 0.3;
            this.spawn(d, v, 0.6 + Math.random() * 0.8, 0.3 + Math.random() * 0.65, 2, 1);
          }
          // At high speed: an occasional big rooster-tail plume behind the car.
          if (k === 0 && p.v > 35 && Math.random() < amount * 0.18 * rate * thin) {
            const d = this.w.clone().addScaledVector(this.side, -this.side.dot(this.w.clone().sub(g.position)) * 0.5);
            d.y += 0.4;
            const v = this.vel.clone().multiplyScalar(0.7);
            v.y = 0.6 + Math.random() * 0.6;
            this.spawn(d, v, 0.9 + Math.random() * 0.5, 1.0 + Math.random() * 0.6, 2, 1);
          }
        } else if (sliding > 0.3 && p.v > 6) {
          if (Math.random() < sliding * 0.7 * rate * thin) {
            const v = this.vel.clone().multiplyScalar(0.25).addScaledVector(this.side, (k ? 1 : -1) * (0.3 + Math.random()));
            v.y = 0.3 + Math.random() * 0.4;
            this.spawn(this.w.clone().setY(this.w.y + 0.25), v, 1.1 + Math.random() * 0.9, 0.45 + Math.random() * 0.5, 0, 1);
          }
        }
      }
      // Per-car boost effects from the exhausts.
      if (p.boosting && p.v > 10 && c.car.exhausts) {
        const rate = dt * 60;
        if (fx.precip === 'bubbles') {
          for (const e of c.car.exhausts) {
            this.w.copy(e);
            g.localToWorld(this.w);
            for (let n = 0; n < Math.round(3 * rate); n++) {
              const v = this.vel.clone().multiplyScalar(0.55 + Math.random() * 0.1).addScaledVector(this.fwd, -(2 + Math.random() * 4));
              v.x += (Math.random() - 0.5) * 1.5;
              v.z += (Math.random() - 0.5) * 1.5;
              this.spawn(this.w.clone(), v, 1.0 + Math.random() * 0.8, 0.14 + Math.random() * 0.2, 3, 1);
            }
          }
        }
        if (fx.mist > 0.3 && Math.random() < 0.7 * rate * fx.mist * thin) {
          // The car tears through the mist: swirls pushed out to the sides behind it.
          this.w.set(0, 0.6, 2.4);
          g.localToWorld(this.w);
          const sd = Math.random() < 0.5 ? -1 : 1;
          const v = this.vel.clone().multiplyScalar(0.55 + Math.random() * 0.2).addScaledVector(this.side, sd * (1.5 + Math.random() * 3));
          v.y = 0.2 + Math.random() * 0.4;
          this.spawn(this.w.clone(), v, 1.0 + Math.random() * 0.8, 0.8 + Math.random() * 0.9, 5, 1);
        }
      }
    }
    if (this.markN > 0) {
      // Upload only the quads written this frame (full upload if the ring wrapped).
      const wrapped = this.markLo + this.markN > MARKS;
      for (const [attr, per] of [[this.markPos, 18], [this.markBirth, 12]] as const) {
        attr.clearUpdateRanges();
        if (!wrapped) attr.addUpdateRange(this.markLo * per, this.markN * per);
        attr.needsUpdate = true;
      }
      this.markLo = -1;
      this.markN = 0;
    }
    if (this.pDirty) {
      this.pPos.needsUpdate = true;
      this.pVel.needsUpdate = true;
      this.pData.needsUpdate = true;
      this.pSeed.needsUpdate = true;
      this.pDirty = false;
    }
  }
}
