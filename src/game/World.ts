import * as THREE from 'three';
import type { LevelDef, LevelSound } from '../levels/types';
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
import { CARS, specFor } from './car/catalog';
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
  /** Non-racing cars (game modes): traffic drives its lane. */
  kind?: 'traffic';
  /** Traffic: lane offset and cruising speed (m/s). */
  lane?: number;
  cruise?: number;
}

/** A car-to-NPC contact this step (for the game modes: crashes into traffic). */
export interface NpcHit {
  npc: CarEntry;
  car: CarEntry;
  strength: number;
}

/** Events from one simulation step that the game wants to react to (sounds, shake). */
export interface StepEvents {
  playerWall: number;
  playerHit: number;
  npcHits: NpcHit[];
}

export interface CarSetup {
  style: string;
  paint: string;
  accent: string;
  driftMode?: boolean;
  /** Physics overrides from the car's stats. */
  spec?: { topSpeed: number; accel: number; grip: number; brake?: number; wheelbase?: number; maxSteer?: number };
  name?: string;
  tier?: 'free' | 'pro' | 'elite';
}

const DRIVER_NAMES = ['VIPER', 'NOVA', 'GHOST', 'BLAZE', 'JADE', 'RAVEN', 'ZED', 'ACE', 'LUNA', 'ROCCO'];
/** Second livery for a model that appears twice on a big grid. */
const ALT_PAINTS = ['#ff3b5c', '#3dff9e', '#ffe14a', '#8a7bff', '#00e5ff', '#ff8a20', '#f0f0f0'];

/** AI opponents drive the free garage cars (never the player's model). */
const BUS_PAINTS = ['#e04040', '#2a7ae0', '#30c070', '#f0f0f0', '#9040e0', '#ff8a20', '#20c8d8'];

function opponentSetups(playerStyle: string): (CarSetup & { name: string })[] {
  // Bus race: everyone gets a bus, in different liveries.
  if (playerStyle === 'bus') {
    const bus = CARS.find((c) => c.class === 'bus')!;
    return DRIVER_NAMES.map((name, i) => ({ name, style: bus.style, paint: BUS_PAINTS[i % BUS_PAINTS.length], accent: bus.accent, spec: specFor(bus), tier: bus.tier }));
  }
  // AI drives the whole car line-up (so races stay competitive against unlocked cars).
  const pool = CARS.filter((c) => c.style !== playerStyle && c.class !== 'bus');
  return DRIVER_NAMES.map((name, i) => {
    const m = pool[i % pool.length];
    const paint = i < pool.length ? m.paint : ALT_PAINTS[i % ALT_PAINTS.length];
    return { name, style: m.style, paint, accent: m.accent, spec: specFor(m), tier: m.tier };
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
  /** 0..1, set by the app every frame from the music's beat clock. */
  beatPulse = 0;
  /** 0..1 flash on the music's harder kicks (accents, drops), decaying. */
  beatHit = 0;
  private boostFx!: BoostFX;
  private readonly frame = makeFrame();
  private readonly basis = new THREE.Matrix4();
  private readonly back = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  time = 0;
  private boardSpots: { pos: THREE.Vector3; w: number; h: number }[] = [];
  /** Hook for level one-shot sounds (set by the app). */
  onLevelSound?: (kind: LevelSound) => void;
  /** Hook for something hitting the player's car (set by the app: popup, sound, shake). */
  onHit?: (label: string) => void;
  /** Hook for level events that shake the camera (set by the app). */
  onShake?: (amount: number) => void;

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
    this.renderer.setSunBoost(L.sky.sunGlow ?? 0);
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
      minRadius: L.track.minRadius,
    });
    const reflectionScale = quality === 'low' ? 0.3 : quality === 'medium' ? 0.5 : 0.8;
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
      shake: (amount) => this.onShake?.(amount),
      boards: () => this.boardSpots,
      hitPlayer: (slow, label) => {
        const p = this.cars[0]?.phys;
        if (!p) return;
        p.v *= 1 - slow;
        this.onHit?.(label);
      },
    });
    const billboards = new Billboards(this.track, built.roofSpots ?? [], built.faceSpots ?? [], L.seed, L.billboards, L.billboardStyle ?? 'neon', built.noBoards);
    this.boardSpots = billboards.spots;
    if (billboards.update) this.updaters.push((t) => billboards.update!(t));
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
      : (() => {
          // The player starts mid-grid (not on pole): AI cars fill the slots ahead and behind.
          const opp = opponentSetups(playerCar.style).slice(0, opponents);
          const mid = Math.floor((opp.length + 1) / 2);
          return [playerCar, ...opp].map((setup, i) => ({ setup, slot: i === 0 ? mid : i <= mid ? i - 1 : i }));
        })();
    slots.forEach(({ setup, slot, netId, remote, name: netName }, i) => {
      // Detail: low quality = light models for everyone; medium = only your own car in full detail.
      const lowDetail = quality === 'low' || (quality === 'medium' && (online ? !!remote : i !== 0));
      const car = buildCar({ style: setup.style, paint: setup.paint, accent: setup.accent, tier: setup.tier, lowDetail });
      car.group.add(createHeadlightBeams(car.style.width, 24, -car.style.length / 2, 0.55, L.time === 'day' ? 0.35 : L.time === 'dusk' ? 0.7 : L.id === 'orbit-run' ? 0.4 : 1)); // space: dark road + strong bloom made them glare
      for (const w of car.wheels) w.rotation.order = 'YXZ';
      this.scene.add(car.group);
      const row = Math.floor(slot / 2);
      const x = (slot % 2 === 0 ? -1 : 1) * this.track.width * 0.22;
      const spec: CarSpec = { ...DEFAULT_SPEC, ...(setup.spec ?? {}), length: car.style.length, halfWidth: car.style.width / 2, driftMode: i === 0 && playerCar.driftMode, brakeSlide: i === 0 };
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
    this.boostFx.prewarm(this.cars); // hidden flames / trails exist before the shader precompile
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
    const ev: StepEvents = { playerWall: 0, playerHit: 0, npcHits: [] };
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
    if (!frozen && this.npcs.length) this.stepNpcs(dt, ev);
    return ev;
  }

  // ------------------------------------------------------------- game-mode cars (traffic)

  /** Traffic: not part of the race standings, but driven, collided and drawn like the others. */
  readonly npcs: CarEntry[] = [];

  addNpc(o: { setup: CarSetup; s: number; x: number; kind: 'traffic'; cruise?: number }): CarEntry {
    const car = buildCar({ style: o.setup.style, paint: o.setup.paint, accent: o.setup.accent, tier: o.setup.tier, lowDetail: this.quality !== 'high' });
    car.group.add(createHeadlightBeams(car.style.width, 18, -car.style.length / 2, 0.55, this.level.time === 'day' ? 0.25 : 0.6));
    for (const w of car.wheels) w.rotation.order = 'YXZ';
    this.scene.add(car.group);
    const spec: CarSpec = { ...DEFAULT_SPEC, ...(o.setup.spec ?? {}), length: car.style.length, halfWidth: car.style.width / 2 };
    const phys = createPhys(o.s, o.x);
    phys.v = o.cruise ?? 0;
    phys.boost = 0;
    const e: CarEntry = { car, name: o.kind, phys, spec, ai: null, isPlayer: false, input: { throttle: 0, brake: 0, steer: 0 }, kind: o.kind, lane: o.x, cruise: o.cruise };
    this.npcs.push(e);
    return e;
  }

  removeNpc(e: CarEntry): void {
    const i = this.npcs.indexOf(e);
    if (i < 0) return;
    this.npcs.splice(i, 1);
    this.scene.remove(e.car.group);
    e.car.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }

  private stepNpcs(dt: number, ev: StepEvents): void {
    for (const n of this.npcs) {
      const p = n.phys;
      // Traffic: holds its lane and cruising speed (recovers after being knocked about).
      p.ps = p.s; p.px = p.x; p.ppsi = p.psi;
      const target = n.cruise ?? 25;
      p.v += (target - p.v) * Math.min(1, dt * 0.6);
      p.s += p.v * dt;
      p.x += ((n.lane ?? 0) - p.x) * Math.min(1, dt * 1.2);
      p.psi *= Math.exp(-dt * 3);
      p.phi = p.psi;
      p.drift = 0;
      n.input = { throttle: 0.4, brake: p.v > target + 2 ? 0.6 : 0, steer: 0 };
    }
    const wallLimit = this.track.width / 2 - 1.2;
    for (const n of this.npcs) {
      for (const c of this.cars) {
        if (c.left || c.remote) continue;
        const hit = collidePhys(c.phys, n.phys, c.spec, this.track.length, wallLimit);
        if (hit > 0) {
          ev.npcHits.push({ npc: n, car: c, strength: hit });
          if (c.isPlayer) ev.playerHit = Math.max(ev.playerHit, hit);
        }
      }
    }
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
    for (const c of this.npcs.length ? this.cars.concat(this.npcs) : this.cars) {
      const p = c.phys;
      const s = p.ps + (p.s - p.ps) * alpha;
      const x = p.px + (p.x - p.px) * alpha;
      const psiTravel = p.ppsi + (p.psi - p.ppsi) * alpha;
      const psi = psiTravel + p.driftAngle;
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
      // Drift swing pivots near the front axle: the tail swings out instead of the car spinning on its middle.
      if (Math.abs(p.driftAngle) > 0.005) {
        const a = c.car.style.length * 0.28;
        const f0x = this.frame.forward.x * Math.cos(psiTravel) + this.frame.right.x * Math.sin(psiTravel);
        const f0z = this.frame.forward.z * Math.cos(psiTravel) + this.frame.right.z * Math.sin(psiTravel);
        g.position.x += (f0x - this.fwd.x) * a;
        g.position.z += (f0z - this.fwd.z) * a;
      }
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
        const cal = w.userData.caliper as THREE.Object3D | undefined;
        if (cal) cal.rotation.x = -spin; // calipers don't spin
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
    atmosphere.uBeatHit.value = this.beatHit;
    atmosphere.uBeatPulse.value = this.beatPulse;
    // The player's Lighting option: at its lowest the glow is about a third and the picture 12 % darker.
    const lk = this.renderer.lighting;
    this.renderer.bloom.strength = bloom.strength * (1 + mist * 1.1) * (1 + 0.18 * this.beatPulse + 0.3 * this.beatHit) * (lk * 1.35 - 0.35);
    this.renderer.webgl.toneMappingExposure = this.level.lighting.exposure * (0.76 + 0.24 * lk);
    this.road.setBeatPulse(this.beatPulse);
    this.renderer.bloom.radius = Math.min(1, bloom.radius + mist * 0.45);
    setCarFogGlow(mist * (this.level.time === 'day' ? 0.35 : 1));
    this.tireFx.setViewportHeight(this.renderer.webgl.domElement.height);
    // Snow levels throw powder even when it is not snowing; underwater always bubbles.
    const fxPrecip = this.level.precipitation === 'snow' || this.level.precipitation === 'bubbles' ? this.level.precipitation : this.weather.precipAmount > 0.1 ? 'rain' : 'none';
    const fxCars = this.npcs.length ? this.cars.concat(this.npcs) : this.cars;
    this.tireFx.update(dt, fxCars, this.weather.roadWet, { precip: fxPrecip, mist });
    this.boostFx.update(dt, fxCars, mist);
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
        // Shared, cached textures (billboard atlases) are marked persistent and kept.
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture && !v.userData.persistent) v.dispose();
        const u = (mat as THREE.ShaderMaterial).uniforms;
        if (u) for (const x of Object.values(u)) if (x && x.value instanceof THREE.Texture && !x.value.userData.persistent) x.value.dispose();
        mat.dispose();
      }
    });
    this.road.surface.dispose();
    this.scene.environment = null;
    this.envTarget.dispose();
  }
}
