import * as THREE from 'three';
import { haloTexture } from '../game/car/CarBuilder';

/**
 * Boost visuals per car: exhaust flames (blue-white fire, or plasma in space; none underwater — bubbles
 * come from TireFX there), a soft glow behind the car that lights up mist / fog, and neon light trails
 * from the tail lights. Weather-specific spray / powder / bubbles are emitted by TireFX.
 */
export type BoostTheme = 'fire' | 'plasma' | 'bubbles';

interface BoostCar {
  car: { group: THREE.Object3D; exhausts: THREE.Vector3[]; tailLights: THREE.Vector3[] };
  phys: { boosting: boolean };
  left?: boolean;
}

const TRAIL = 30; // points per trail

interface State {
  k: number;
  flames: THREE.Mesh[];
  /** This car's flame material (shared program): its uBurst drives the ignition size / colour. */
  flameMat: THREE.ShaderMaterial | null;
  /** Seconds since the boost started (large = no ignition running). */
  bt: number;
  wasOn: boolean;
  glow: THREE.Sprite;
  trails: { pos: THREE.BufferAttribute; alpha: THREE.BufferAttribute; pts: THREE.Vector3[]; side: THREE.Vector3[]; ks: number[]; mesh: THREE.Mesh }[];
}

/**
 * Exhaust flame shape, along +Z out of the pipe (0 at the pipe, 1 at the tip): a teardrop that starts at the
 * pipe's width, swells into a round bulb and tapers to a point, plus three balls of fire that travel down it.
 * The vertex shader bends the whole thing sideways in travelling waves (a licking, curling flame) and lets
 * blobs run along it. `seed` offsets the motion so the two pipes of a car don't move in step.
 * Attributes: aBall = (phase, radius) for the fire balls (their position holds a unit sphere), x < 0 for the
 * teardrop; aSeed = this flame's phase offset.
 */
function flameGeometry(seed: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], ball: number[] = [], idx: number[] = [];
  const along = 20, around = 14;
  const rad = (t: number) => 0.04 * (1 - t) + 0.075 * Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - 0.35 * t);
  for (let i = 0; i <= along; i++) {
    const t = i / along;
    const r = rad(t), dr = (rad(Math.min(1, t + 0.01)) - rad(Math.max(0, t - 0.01))) / 0.02;
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, t);
      const n = new THREE.Vector3(Math.cos(a), Math.sin(a), -dr).normalize();
      nor.push(n.x, n.y, n.z);
      ball.push(-1, 0);
    }
  }
  for (let i = 0; i < along; i++) for (let j = 0; j < around; j++) {
    const a = i * (around + 1) + j, b = a + around + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const sphere = new THREE.SphereGeometry(1, 10, 7);
  const sp = sphere.getAttribute('position'), si = sphere.getIndex()!;
  for (let k = 0; k < 3; k++) {
    const base = pos.length / 3;
    for (let i = 0; i < sp.count; i++) {
      pos.push(sp.getX(i), sp.getY(i), sp.getZ(i));
      nor.push(sp.getX(i), sp.getY(i), sp.getZ(i));
      ball.push(k / 3 + 0.13 * k, 0.06 + 0.018 * ((k * 7) % 3));
    }
    for (let i = 0; i < si.count; i++) idx.push(base + si.getX(i));
  }
  sphere.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aBall', new THREE.Float32BufferAttribute(ball, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(seed), 1));
  g.setIndex(idx);
  // The shader moves vertices well outside the static shape.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.6), 1.6);
  return g;
}

const THEMES: Record<BoostTheme, { core: string; edge: string; trail: string; glow: string; burstCore: string; burstEdge: string }> = {
  fire: { core: '#ffffff', edge: '#2a8cff', trail: '#5cc8ff', glow: '#7fc8ff', burstCore: '#5f8dff', burstEdge: '#0c22c8' },
  plasma: { core: '#ffe8ff', edge: '#c030ff', trail: '#ff50f0', glow: '#d070ff', burstCore: '#e27bff', burstEdge: '#5200b8' },
  bubbles: { core: '#e0ffff', edge: '#40d0ff', trail: '#60e8ff', glow: '#60d8ff', burstCore: '#e0ffff', burstEdge: '#40d0ff' },
};
/** Ignition: the exhaust flames flare to 2.5x their size in a darker, fiery blue, then settle over this time. */
const BURST_TIME = 0.55;
const BURST_SCALE = 2.5;

export class BoostFX {
  readonly group = new THREE.Group();
  private readonly state = new Map<BoostCar, State>();
  private readonly flameMat: THREE.ShaderMaterial;
  private readonly glowMat: THREE.SpriteMaterial;
  private readonly trailMat: THREE.ShaderMaterial;
  private readonly flameGeos: THREE.BufferGeometry[];
  private readonly tmp = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private time = 0;

  constructor(private readonly theme: BoostTheme) {
    const T = THEMES[theme];
    // Two phase variants, so the pipes of one car curl independently.
    this.flameGeos = [flameGeometry(0), flameGeometry(2.4)];
    this.flameMat = new THREE.ShaderMaterial({
      // Front faces only: with both sides added up the round bulb burnt out to a white blob.
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false,
      uniforms: {
        uTime: { value: 0 }, uBurst: { value: 0 }, uPhase: { value: 0 },
        uCore: { value: new THREE.Color(T.core) }, uEdge: { value: new THREE.Color(T.edge) },
        uBurstCore: { value: new THREE.Color(T.burstCore) }, uBurstEdge: { value: new THREE.Color(T.burstEdge) },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aBall; attribute float aSeed;
        uniform float uTime, uPhase;
        varying float vL; varying vec3 vN; varying vec3 vV; varying float vBall;
        // Sideways lick: nothing at the pipe, growing toward the tip, in waves that travel down the flame.
        vec2 sway(float t, float ph) {
          float a = (t * t * 0.85 + t * 0.15) * 0.17;
          return a * vec2(sin(uTime * 17.0 - t * 6.5 + ph) + 0.5 * sin(uTime * 31.0 - t * 11.0 + ph * 2.3),
                          cos(uTime * 13.0 - t * 5.0 + ph * 1.7) + 0.5 * sin(uTime * 27.0 - t * 9.0 + ph * 0.7));
        }
        void main() {
          float ph = uPhase + aSeed;
          vec3 p = position;
          float t;
          if (aBall.x < 0.0) {
            t = position.z; // 0 at the pipe, 1 at the tip
            // Blobs running down the flame: it swells and pinches.
            p.xy *= 1.0 + 0.24 * sin(uTime * 26.0 - t * 13.0 + ph) * smoothstep(0.0, 0.25, t);
            p.xy += sway(t, ph);
          } else {
            // A ball of fire: born in the bulb, grows, drifts past the tip and shrinks away.
            float f = fract(uTime * 2.6 + aBall.x + ph * 0.37);
            t = 0.28 + f * 0.95;
            float r = aBall.y * sin(3.14159 * min(1.0, f * 1.12)) * (1.0 - 0.4 * f);
            p = position * r + vec3(sway(min(t, 1.1), ph), t);
          }
          vL = t;
          vBall = aBall.x < 0.0 ? 0.0 : 1.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uBurst; uniform vec3 uCore, uEdge, uBurstCore, uBurstEdge;
        varying float vL; varying vec3 vN; varying vec3 vV; varying float vBall;
        void main() {
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float flick = 0.82 + 0.18 * sin(uTime * 47.0 + vL * 9.0);
          // On ignition (uBurst 1 -> 0) the flame is a darker, fiery blue instead of blue-white.
          vec3 core = mix(uCore * 3.0, uBurstCore * 2.6, uBurst);
          vec3 edge = mix(uEdge * 2.2, uBurstEdge * 2.4, uBurst);
          vec3 col = mix(core, edge, smoothstep(0.05, mix(0.7, 0.35, uBurst), vL));
          col = mix(col, edge, (1.0 - facing) * 0.65); // hot core, coloured rim: reads as a ball of flame
          // Rounded volume: bright where we look into it, soft at the silhouette; fades out toward the tip.
          float a = (1.0 - smoothstep(0.35, 1.2, vL)) * (0.18 + 0.82 * facing * facing) * flick;
          a *= mix(1.0, 0.75, vBall);
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    this.glowMat = new THREE.SpriteMaterial({ map: haloTexture(), color: T.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false });
    this.trailMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uColor: { value: new THREE.Color(T.trail).multiplyScalar(2.2) } },
      vertexShader: /* glsl */ `
        attribute float aAlpha; varying float vA; varying float vEdge;
        void main() {
          vA = aAlpha;
          vEdge = float(gl_VertexID % 2);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA; varying float vEdge;
        void main() {
          float e = 1.0 - abs(vEdge * 2.0 - 1.0); // soft across the ribbon (interpolated)
          float a = vA * (0.4 + 0.6 * e);
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
  }

  private create(c: BoostCar): State {
    const flameMat = this.theme === 'bubbles' ? null : this.flameMat.clone();
    if (flameMat) flameMat.uniforms.uPhase.value = Math.random() * 6.283;
    const flames = !flameMat ? [] : c.car.exhausts.map((e, i) => {
      const m = new THREE.Mesh(this.flameGeos[i % 2], flameMat);
      m.position.copy(e);
      m.visible = false;
      m.renderOrder = 7;
      c.car.group.add(m);
      return m;
    });
    const glow = new THREE.Sprite(this.glowMat.clone());
    glow.position.set(0, 0.5, (c.car.exhausts[0]?.z ?? 2) + 0.7);
    glow.visible = false;
    glow.renderOrder = 7;
    c.car.group.add(glow);
    const trails = c.car.exhausts.map(() => {
      const g = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(TRAIL * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const alpha = new THREE.BufferAttribute(new Float32Array(TRAIL * 2), 1).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', pos);
      g.setAttribute('aAlpha', alpha);
      const idx: number[] = [];
      for (let i = 0; i < TRAIL - 1; i++) {
        const a = i * 2, b = a + 1, cc = a + 2, d = a + 3;
        idx.push(a, b, cc, b, d, cc);
      }
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, this.trailMat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      return { pos, alpha, pts: [] as THREE.Vector3[], side: [] as THREE.Vector3[], ks: [] as number[], mesh };
    });
    const s: State = { k: 0, flames, flameMat, bt: 99, wasOn: false, glow, trails };
    this.state.set(c, s);
    return s;
  }

  /**
   * Build the (hidden) flames, glow and trails for these cars now. Call before the level's shaders are compiled:
   * otherwise the flame and trail shaders compile on the first boost of the race, which freezes the game for a moment.
   */
  prewarm(cars: BoostCar[]): void {
    for (const c of cars) if (c.car.exhausts && !this.state.has(c)) this.create(c);
  }

  /** `mist` 0..1: the glow behind a boosting car grows and brightens in fog / mist. */
  update(dt: number, cars: BoostCar[], mist: number): void {
    this.time += dt;

    for (const c of cars) {
      if (!c.car.exhausts) continue;
      const s = this.state.get(c) ?? this.create(c);
      const on = c.phys.boosting && !c.left && c.car.group.visible;
      s.k += ((on ? 1 : 0) - s.k) * Math.min(1, dt * (on ? 10 : 4));
      const k = s.k;
      // Ignition: the flames flare up to BURST_SCALE x within ~60 ms, then settle over BURST_TIME.
      if (on && !s.wasOn) s.bt = 0;
      s.wasOn = on;
      s.bt += dt;
      const bk = s.bt < BURST_TIME ? Math.min(1, s.bt / 0.06) * Math.pow(1 - s.bt / BURST_TIME, 1.4) : 0;
      const big = 1 + (BURST_SCALE - 1) * bk;
      if (s.flameMat) {
        s.flameMat.uniforms.uTime.value = this.time;
        s.flameMat.uniforms.uBurst.value = bk;
      }
      for (const f of s.flames) {
        f.visible = k > 0.02;
        if (f.visible) f.scale.set(big, big, k * big * (0.95 + Math.random() * 0.12)); // the shader does the licking; only a slight length flutter here
      }
      const gm = s.glow.material as THREE.SpriteMaterial;
      s.glow.visible = k > 0.02 || bk > 0.01;
      gm.opacity = k * (0.1 + mist * 0.28) + bk * 0.12;
      s.glow.scale.setScalar(1.8 + mist * 3 + bk * 1.2 + Math.random() * 0.25);
      // Light trails from the tail lights (world space; they stay behind as the car moves on).
      const g = c.car.group;
      this.right.set(1, 0, 0).applyQuaternion(g.quaternion);
      s.trails.forEach((t, i) => {
        if (k > 0.02 || t.ks.some((x) => x > 0.01)) {
          const p = g.localToWorld(this.tmp.copy(c.car.exhausts[i]).setZ(c.car.exhausts[i].z + 0.4));
          t.pts.unshift(p.clone());
          t.side.unshift(this.right.clone());
          t.ks.unshift(k);
          if (t.pts.length > TRAIL) { t.pts.pop(); t.side.pop(); t.ks.pop(); }
          const pa = t.pos.array as Float32Array;
          const aa = t.alpha.array as Float32Array;
          for (let j = 0; j < TRAIL; j++) {
            const q = t.pts[Math.min(j, t.pts.length - 1)];
            const sd = t.side[Math.min(j, t.side.length - 1)];
            const w = 0.06 * (1 - (j / TRAIL) * 0.5);
            pa.set([q.x - sd.x * w, q.y, q.z - sd.z * w, q.x + sd.x * w, q.y, q.z + sd.z * w], j * 6);
            const a = j < t.ks.length ? t.ks[j] * (1 - j / TRAIL) * 0.9 : 0;
            aa[j * 2] = aa[j * 2 + 1] = a;
          }
          t.pos.needsUpdate = true;
          t.alpha.needsUpdate = true;
          t.mesh.visible = true;
          // Fade the whole trail out once boosting stops.
          if (k <= 0.02) for (let j = 0; j < t.ks.length; j++) t.ks[j] *= Math.exp(-dt * 6);
        } else if (t.mesh.visible) {
          t.mesh.visible = false;
          t.pts.length = 0; t.side.length = 0; t.ks.length = 0;
        }
      });
    }
  }
}
