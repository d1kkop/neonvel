import * as THREE from 'three';
import type { LevelDef } from '../levels/types';
import { atmosphere } from '../render/atmosphere';
import { createEnvironment, Renderer } from '../render/Renderer';
import { LoopTrack, makeFrame } from '../track/Track';
import { Billboards } from '../world/Billboards';
import { Road, roadUniforms } from '../world/Road';
import { Sky } from '../world/Sky';
import { Structures } from '../world/Structures';
import { TireFX } from '../world/TireFX';
import { GroundMist } from '../world/weather/GroundMist';
import { BoostFX } from '../world/BoostFX';
import { createHeadlightBeams, createLampBeams, Searchlights } from '../world/weather/Beams';
import { Weather, WeatherName } from '../world/weather/Weather';
import type { InputState } from '../app/Input';
import type { NetCarState } from '../net/NetClient';
import { buildCar, BuiltCar, setCarFogGlow } from './car/CarBuilder';
import { CARS, specFromStats } from './car/catalog';
import { AI_DIFFICULTY, AiDifficulty, AiDriver, aiInput, boostFromHit, CarPhys, CarSpec, collidePhys, createPhys, DEFAULT_SPEC, stepPhys } from './CarPhysics';

export type Quality = 'low' | 'medium' | 'high';

export interface CarEntry {
  car: BuiltCar;
  name: string;
  phys: CarPhys;
  spec: CarSpec;
  /** AI brain (null = controlled by the player / network). */
  ai: AiDriver | null;
  isPlayer: boolean;
  /** Finish time in seconds (set when the car completes the race). */
  finish?: number;
  /** Last input applied (for audio / visuals). */
  input: InputState;
  /** Smoothed brake-light level, and speed last frame (remote cars). */
  brakeVis?: number;
  prevV?: number;
  /** Online: network player id + received snapshots (remote cars follow these, no local physics). */
  netId?: string;
  remote?: boolean;
  snaps?: { t: number; st: NetCarState }[];
  left?: boolean;
  visRoll?: number;
  visPitch?: number;
}

/** Events from one simulation step that the game wants to react to (sounds, shake). */
export interface StepEvents {
  playerWall: number;
  playerHit: number;
}

export interface CarSetup {
  style: string;
  paint: string;
  accent: string;
  driftMode?: boolean;
  /** Physics overrides from the car's stats. */
  spec?: { topSpeed: number; accel: number; grip: number };
  name?: string;
  tier?: 'free' | 'pro' | 'elite';
}

const DRIVER_NAMES = ['VIPER', 'NOVA', 'GHOST', 'BLAZE', 'JADE', 'RAVEN', 'ZED'];

/** AI opponents drive the free garage cars (never the player's model). */
function opponentSetups(playerStyle: string): (CarSetup & { name: string })[] {
  // AI drives the whole line-up (so races stay competitive against unlocked cars).
  const pool = CARS.filter((c) => c.style !== playerStyle);
  return DRIVER_NAMES.map((name, i) => {
    const m = pool[i % pool.length];
    return { name, style: m.style, paint: m.paint, accent: m.accent, spec: specFromStats(m.stats), tier: m.tier };
  });
}

/**
 * One loaded level: its scene, track, shared systems (road, billboards, weather, beams)
 * and the level's own scenery. Create a new World to switch levels; dispose() the old one.
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly track: LoopTrack;
  readonly sky = new Sky();
  readonly road: Road;
  readonly weather: Weather;
  readonly cars: CarEntry[] = [];
  readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly searchlights?: Searchlights;
  private readonly updaters: ((time: number, dt: number) => void)[] = [];
  private readonly envTarget: THREE.WebGLRenderTarget;
  private readonly tireFx = new TireFX();
  private groundMist!: GroundMist;
  private boostFx!: BoostFX;
  private readonly frame = makeFrame();
  private readonly basis = new THREE.Matrix4();
  private readonly back = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  time = 0;
  /** Hook for level one-shot sounds (set by the app). */
  onLevelSound?: (kind: 'dolphin') => void;

  constructor(
    readonly level: LevelDef,
    weatherName: WeatherName,
    private readonly renderer: Renderer,
    readonly quality: Quality,
    playerCar: CarSetup,
    opponents = 3,
    /** Online race: every driver in server order; `local` marks this machine's player. */
    online?: { id: string; name: string; setup: CarSetup; local: boolean }[],
  ) {
    const L = level;
    // --- Global look
    atmosphere.uMoonDir.value.set(...L.lighting.sunDir).normalize();
    atmosphere.uFogColor.value.set(L.atmosphere.fogColor);
    atmosphere.uFogDensity.value = L.atmosphere.fogDensity;
    atmosphere.uHazeColor.value.set(L.atmosphere.hazeColor);
    atmosphere.uHazeTop.value = L.atmosphere.hazeTop;
    atmosphere.uHazeStrength.value = L.atmosphere.hazeStrength;
    atmosphere.uCaustics.value = L.atmosphere.caustics ?? 0;
    renderer.webgl.toneMappingExposure = L.lighting.exposure;
    renderer.bloom.strength = L.lighting.bloom.strength;
    renderer.bloom.radius = L.lighting.bloom.radius;
    renderer.bloom.threshold = L.lighting.bloom.threshold;
    this.envTarget = createEnvironment(renderer.webgl, L.lighting.env);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = L.time === 'day' ? 1.0 : 0.8;

    this.hemi = new THREE.HemisphereLight(L.lighting.hemiSky, L.lighting.hemiGround, L.lighting.hemiIntensity);
    this.sun = new THREE.DirectionalLight(L.lighting.sunColor, L.lighting.sunIntensity);
    this.sun.position.copy(atmosphere.uMoonDir.value).multiplyScalar(1000);
    this.scene.add(this.hemi, this.sun);

    this.sky.configure(L.sky);
    this.scene.add(this.sky.mesh);

    // --- Track & road
    this.track = new LoopTrack({
      points: L.track.points,
      targetLength: L.track.length,
      height: L.track.height,
      width: L.track.width,
      lanes: L.track.lanes,
      sections: L.track.sections,
      hills: L.track.hills,
    });
    const reflectionScale = quality === 'low' ? 0.3 : quality === 'medium' ? 0.4 : 0.5;
    this.road = new Road(this.track, { reflectionScale, style: L.road, pillars: L.track.pillars });
    this.scene.add(this.road.group);
    this.scene.add(new Structures(this.track, { concrete: L.road.concrete, metal: L.road.railColor ?? '#1c1a26', neonA: L.road.leftNeon, neonB: L.road.rightNeon, solidWalls: ['concrete', 'snowbank'].includes(L.road.wallStyle ?? 'concrete') }).group);

    // --- Level scenery
    const built = L.build({
      scene: this.scene,
      track: this.track,
      seed: L.seed,
      quality,
      onUpdate: (fn) => this.updaters.push(fn),
      player: () => {
        const p = this.cars[0]?.phys;
        return p ? { s: p.s, x: p.x, v: p.v } : { s: 0, x: 0, v: 0 };
      },
      sound: (kind) => this.onLevelSound?.(kind),
    });
    const billboards = new Billboards(this.track, built.roofSpots ?? [], built.faceSpots ?? [], L.seed, L.billboards);
    this.scene.add(billboards.group);

    // --- Weather & beams
    this.weather = new Weather({ road: this.road.uniforms, sky: this.sky.uniforms, hemi: this.hemi }, L.atmosphere, L.time, weatherName, L.precipitation ?? 'rain');
    this.scene.add(this.weather.rain.mesh);
    this.scene.add(this.tireFx.group);
    this.boostFx = new BoostFX(L.id === 'orbit-run' ? 'plasma' : L.precipitation === 'bubbles' ? 'bubbles' : 'fire');
    this.scene.add(this.boostFx.group);
    this.groundMist = new GroundMist(this.track);
    this.scene.add(this.groundMist.mesh);
    if (this.road.lamps.length) this.scene.add(createLampBeams(this.road.lamps));
    if (built.searchlights?.length) {
      this.searchlights = new Searchlights(built.searchlights);
      this.scene.add(this.searchlights.mesh);
    }

    // --- Cars: staggered two-wide grid behind the start line.
    type Slot = { setup: CarSetup & { name?: string }; slot: number; netId?: string; remote?: boolean; name?: string };
    const slots: Slot[] = online
      ? online.map((p, i) => ({ setup: p.setup, slot: i, netId: p.id, remote: !p.local, name: p.name })).sort((a, b) => Number(!!a.remote) - Number(!!b.remote))
      : [playerCar, ...opponentSetups(playerCar.style).slice(0, opponents)].map((setup, i) => ({ setup, slot: i }));
    slots.forEach(({ setup, slot, netId, remote, name: netName }, i) => {
      const car = buildCar({ style: setup.style, paint: setup.paint, accent: setup.accent, tier: setup.tier });
      car.group.add(createHeadlightBeams(car.style.width, 24, -car.style.length / 2, 0.55, L.time === 'day' ? 0.35 : L.time === 'dusk' ? 0.7 : L.id === 'orbit-run' ? 0.4 : 1)); // space: dark road + strong bloom made them glare
      for (const w of car.wheels) w.rotation.order = 'YXZ';
      this.scene.add(car.group);
      const row = Math.floor(slot / 2);
      const x = (slot % 2 === 0 ? -1 : 1) * this.track.width * 0.22;
      const spec: CarSpec = { ...DEFAULT_SPEC, ...(setup.spec ?? {}), length: car.style.length, halfWidth: car.style.width / 2, driftMode: i === 0 && playerCar.driftMode };
      this.cars.push({
        car,
        name: netName ?? (i === 0 ? 'YOU' : (setup as { name?: string }).name ?? `CPU ${i}`),
        phys: createPhys(-6 - row * 10, x),
        spec,
        ai: i === 0 || remote ? null : { skill: 0.99 + Math.random() * 0.06, lane: x, laneTimer: 2 + Math.random() * 4 },
        netId,
        remote,
        snaps: remote ? [] : undefined,
        isPlayer: i === 0,
        input: { throttle: 0, brake: 0, steer: 0 },
      });
    });
    this.placeCars(0);
  }

  /** Direction of travel (velocity) of a car in world space — the chase camera follows this. */
  travelDir(c: CarEntry, out: THREE.Vector3): THREE.Vector3 {
    this.track.frameAt(c.phys.s, this.frame);
    return out.copy(this.frame.forward).multiplyScalar(Math.cos(c.phys.phi)).addScaledVector(this.frame.right, Math.sin(c.phys.phi));
  }

  /** Apply an AI difficulty to every AI car (call once right after building the race world). */
  setDifficulty(d: AiDifficulty): void {
    const D = AI_DIFFICULTY[d];
    for (const c of this.cars) {
      if (!c.ai || c.isPlayer) continue;
      c.spec = { ...c.spec, topSpeed: c.spec.topSpeed * D.power, accel: c.spec.accel * D.power, brake: c.spec.brake * D.power, grip: c.spec.grip * D.grip };
      c.ai.skill = D.skill[0] + Math.random() * (D.skill[1] - D.skill[0]);
      c.ai.useBoost = d !== 'easy';
    }
  }

  get player(): CarEntry {
    return this.cars[0];
  }

  /**
   * Fixed-step simulation. `playerInput` = null → the player car is AI-driven too (menus).
   * `frozen` holds every car on the grid (countdown).
   */
  step(dt: number, playerInput: (InputState & { handbrake?: number }) | null, frozen = false): StepEvents {
    const ev: StepEvents = { playerWall: 0, playerHit: 0 };
    const phys = this.cars.map((c) => c.phys);
    this.updateRemotes();
    for (const c of this.cars) {
      if (c.remote) continue;
      let inp: InputState & { handbrake?: number };
      if (frozen) {
        // Hold on the grid.
        const p = c.phys;
        p.ps = p.s; p.px = p.x; p.ppsi = p.psi; p.v = 0; p.wallHit = 0;
        continue;
      }
      if (c.isPlayer && playerInput) inp = playerInput;
      else {
        c.ai ??= { skill: 0.95, lane: 0, laneTimer: 1 };
        inp = aiInput(c.phys, c.ai, c.spec, this.track, phys, dt);
      }
      c.input = inp;
      stepPhys(c.phys, inp, c.spec, this.track, dt);
      if (c.isPlayer) ev.playerWall = Math.max(ev.playerWall, c.phys.wallHit);
    }
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const A = this.cars[i], B = this.cars[j];
        if (A.left || B.left || (A.remote && B.remote)) continue;
        const wallLimit = this.track.width / 2 - A.spec.halfWidth - 0.25;
        // A remote car is driven by its owner: only the local car gets pushed.
        const keep = A.remote ? { ...A.phys } : B.remote ? { ...B.phys } : null;
        const hit = collidePhys(A.phys, B.phys, A.spec, this.track.length, wallLimit);
        if (keep) Object.assign(A.remote ? A.phys : B.phys, keep);
        if (hit && (this.cars[i].isPlayer || this.cars[j].isPlayer)) ev.playerHit = Math.max(ev.playerHit, hit);
        if (hit) {
          boostFromHit(A.phys, hit);
          boostFromHit(B.phys, hit);
        }
      }
    }
    return ev;
  }

  /** Store a network snapshot for a remote car. */
  applyRemote(id: string, st: NetCarState): void {
    const c = this.cars.find((x) => x.netId === id);
    if (!c?.snaps) return;
    c.snaps.push({ t: performance.now(), st });
    if (c.snaps.length > 30) c.snaps.shift();
  }

  /** Mark a remote player as gone (hidden, out of the standings). */
  removeRemote(id: string): void {
    const c = this.cars.find((x) => x.netId === id);
    if (!c) return;
    c.left = true;
    c.car.group.visible = false;
  }

  /** Remote cars: interpolate 100 ms in the past between snapshots, extrapolate briefly if late. */
  private updateRemotes(): void {
    const renderT = performance.now() - 100;
    for (const c of this.cars) {
      if (!c.remote || !c.snaps || c.snaps.length === 0) continue;
      const p = c.phys;
      p.ps = p.s; p.px = p.x; p.ppsi = p.psi;
      const snaps = c.snaps;
      let a = snaps[0], b = snaps[snaps.length - 1];
      for (let k = snaps.length - 1; k > 0; k--) {
        if (snaps[k - 1].t <= renderT) { a = snaps[k - 1]; b = snaps[k]; break; }
      }
      let st: NetCarState;
      if (renderT >= b.t) {
        // Late packet: extrapolate up to 0.5 s along the track.
        const dt = Math.min(0.5, (renderT - b.t) / 1000);
        st = { ...b.st, s: b.st.s + b.st.v * Math.cos(b.st.phi) * dt };
      } else {
        const k = b.t > a.t ? Math.max(0, Math.min(1, (renderT - a.t) / (b.t - a.t))) : 1;
        const L = (u: number, v: number) => u + (v - u) * k;
        st = { s: L(a.st.s, b.st.s), x: L(a.st.x, b.st.x), psi: L(a.st.psi, b.st.psi), phi: L(a.st.phi, b.st.phi), v: L(a.st.v, b.st.v), steer: L(a.st.steer, b.st.steer), drift: L(a.st.drift, b.st.drift), b: k < 0.5 ? a.st.b : b.st.b };
      }
      p.s = st.s; p.x = st.x; p.psi = st.psi; p.phi = st.phi; p.v = st.v; p.steer = st.steer; p.driftAngle = st.drift; p.boosting = !!st.b;
      if (p.ps === 0 && p.px === 0) { p.ps = p.s; p.px = p.x; p.ppsi = p.psi; }
    }
  }

  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly qTilt = new THREE.Quaternion();
  private readonly eTilt = new THREE.Euler();

  /** Interpolated placement of all cars, with body roll / pitch and steered front wheels. */
  placeCars(alpha: number): void {
    for (const c of this.cars) {
      const p = c.phys;
      const s = p.ps + (p.s - p.ps) * alpha;
      const x = p.px + (p.x - p.px) * alpha;
      const psi = p.ppsi + (p.psi - p.ppsi) * alpha + p.driftAngle;
      this.track.frameAt(s, this.frame);
      const g = c.car.group;
      g.position.copy(this.frame.position).addScaledVector(this.frame.right, x);
      // Body forward = track forward rotated by psi toward the right.
      this.fwd.copy(this.frame.forward).multiplyScalar(Math.cos(psi)).addScaledVector(this.frame.right, Math.sin(psi));
      // On hills the body sits on the sloped road: up = road normal, forward tipped along the slope.
      const slope = this.track.slopeAt(s);
      this.up.set(-slope * this.frame.forward.x, 1, -slope * this.frame.forward.z).normalize();
      this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
      this.side.crossVectors(this.fwd, this.up).normalize();
      this.back.copy(this.fwd).negate();
      this.basis.makeBasis(this.side, this.up, this.back);
      g.quaternion.setFromRotationMatrix(this.basis);
      // Subtle, spring-damped roll into corners and pitch under acceleration / braking.
      const tr = THREE.MathUtils.clamp(-p.latAcc * 0.0012, -0.025, 0.025);
      const tp = THREE.MathUtils.clamp(p.lonAcc * 0.0006, -0.012, 0.012);
      c.visRoll = (c.visRoll ?? 0) + (tr - (c.visRoll ?? 0)) * 0.08;
      c.visPitch = (c.visPitch ?? 0) + (tp - (c.visPitch ?? 0)) * 0.08;
      this.eTilt.set(c.visPitch, 0, c.visRoll);
      g.quaternion.multiply(this.qTilt.setFromEuler(this.eTilt));
      // Brake lights: braking, handbrake or drifting (remote cars: deceleration / drift).
      const braking = c.remote ? (p.v < (c.prevV ?? p.v) - 0.15 || p.drift > 0.3 ? 1 : 0) : (c.input.brake > 0.1 || (c.input.handbrake ?? 0) > 0.3 || p.drift > 0.3) && p.v > 1 ? 1 : 0;
      c.prevV = p.v;
      c.brakeVis = (c.brakeVis ?? 0) + (braking - (c.brakeVis ?? 0)) * (braking ? 0.5 : 0.15);
      c.car.setBrake(c.brakeVis);
      const spin = -s / c.car.style.wheelRadius;
      // Visual steering: the physics lock shrinks a lot at speed, which made the wheels look straight.
      // Show the driver's input (up to ~30°), and in a drift the classic opposite lock: the front wheels
      // point along the direction of travel (that is the body's drift angle, the other way).
      const lock = c.spec.maxSteer / (1 + Math.abs(p.v) * 0.045);
      const steerIn = Math.max(-1, Math.min(1, p.steer / Math.max(1e-3, lock)));
      const d = Math.min(1, p.drift * 1.2);
      const wheelYaw = Math.max(-0.62, Math.min(0.62, -steerIn * 0.52 * (1 - d) + p.driftAngle * 1.15 * d));
      c.car.wheels.forEach((w, i) => {
        w.rotation.x = spin;
        w.rotation.y = i < 2 ? wheelYaw : 0;
      });
    }
  }

  /** Per-frame visual update. */
  update(dt: number, camera: THREE.Camera, covered: boolean): void {
    this.time += dt;
    atmosphere.uTime.value = this.time;
    this.sky.update(camera);
    this.weather.update(dt, camera, covered);
    // Hills: the road mirror follows the road under the camera's car, tilted to its slope.
    if (this.track.hilly) {
      const s = this.cars[0]?.phys.s ?? 0;
      this.track.frameAt(s, this.frame);
      const slope = this.track.slopeAt(s);
      this.up.set(-slope * this.frame.forward.x, 1, -slope * this.frame.forward.z).normalize();
      this.road.setMirror(this.frame.position, this.up);
    } else roadUniforms.uMirrorFade.value = 0;
    // Mist lying on the track; lights bloom wider and the car lights get soft halos in the air.
    const mist = this.weather.mist;
    this.groundMist.update(mist, this.cars[0]?.phys.s ?? 0);
    const bloom = this.level.lighting.bloom;
    this.renderer.bloom.strength = bloom.strength * (1 + mist * 1.1);
    this.renderer.bloom.radius = Math.min(1, bloom.radius + mist * 0.45);
    setCarFogGlow(mist * (this.level.time === 'day' ? 0.35 : 1));
    this.tireFx.setViewportHeight(this.renderer.webgl.domElement.height);
    // Snow levels throw powder even when it is not snowing; underwater always bubbles.
    const fxPrecip = this.level.precipitation === 'snow' || this.level.precipitation === 'bubbles' ? this.level.precipitation : this.weather.precipAmount > 0.1 ? 'rain' : 'none';
    this.tireFx.update(dt, this.cars, this.weather.roadWet, { precip: fxPrecip, mist });
    this.boostFx.update(dt, this.cars, mist);
    this.searchlights?.update(this.time);
    for (const fn of this.updaters) fn(this.time, dt);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        const u = (mat as THREE.ShaderMaterial).uniforms;
        if (u) for (const x of Object.values(u)) if (x && x.value instanceof THREE.Texture) x.value.dispose();
        mat.dispose();
      }
    });
    this.road.surface.dispose();
    this.scene.environment = null;
    this.envTarget.dispose();
  }
}
