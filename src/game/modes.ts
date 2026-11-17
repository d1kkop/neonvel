import * as THREE from 'three';
import { aiInput, type AiDriver } from './CarPhysics';
import type { CarEntry, StepEvents, World } from './World';
import { haloTexture } from './car/CarBuilder';

/**
 * Extra game modes on top of the race tracks:
 *  - Highway Rush: open road with civilian traffic, near-miss style points, checkpoints that add time.
 *  - Heat: a police chase — the heat rises, more patrol cars join, roadblocks appear; don't get boxed in.
 */
export type ModeId = 'race' | 'highway' | 'heat';

export interface ModeResult {
  title: string;
  detail: string;
  score: number;
  won: boolean;
}

export interface GameMode {
  readonly id: Exclude<ModeId, 'race'>;
  start(w: World): void;
  /** One fixed simulation step. */
  update(dt: number, w: World, ev: StepEvents): void;
  /** Per frame (visuals: light bars). */
  frame(dt: number, w: World): void;
  readonly done: boolean;
  /** HUD lines (top right, under the position). */
  hud(): string[];
  /** Popups queued since the last call ("NEAR MISS ×3"). */
  takePops(): { text: string; good: boolean }[];
  result(): ModeResult;
  /** 0..1 how close the nearest police siren is (audio). */
  readonly siren: number;
}

const TRAFFIC_LOOKS: { style: string; paint: string }[] = [
  { style: 'hatch', paint: '#c8c2b0' }, { style: 'gt', paint: '#5a6470' }, { style: 'muscle', paint: '#7a2a22' },
  { style: 'coupe', paint: '#2f4a6a' }, { style: 'hatch', paint: '#e0d070' }, { style: 'gt', paint: '#1e1e24' },
  { style: 'muscle', paint: '#3d5a3a' }, { style: 'coupe', paint: '#9a9aa4' },
];

/** Civilian traffic around the player, recycled from behind to far ahead. */
class Traffic {
  readonly cars: CarEntry[] = [];
  private readonly lastAhead = new Map<CarEntry, boolean>();
  private readonly touched = new Map<CarEntry, number>();

  constructor(private readonly count: number) {}

  private laneX(w: World, i: number): number {
    const lanes = Math.max(2, w.track.lanes);
    const lw = w.track.width / lanes;
    return -w.track.width / 2 + lw * (i + 0.5);
  }

  start(w: World): void {
    const p = w.player.phys;
    for (let i = 0; i < this.count; i++) {
      const look = TRAFFIC_LOOKS[i % TRAFFIC_LOOKS.length];
      const lane = this.laneX(w, i % Math.max(2, w.track.lanes));
      const cruise = 17 + Math.random() * 15;
      const s = p.s + 60 + i * (700 / this.count) + Math.random() * 20;
      const c = w.addNpc({ setup: { style: look.style, paint: look.paint, accent: '#3a3a44', tier: 'free' }, s, x: lane, kind: 'traffic', cruise });
      this.cars.push(c);
    }
  }

  /** Recycle cars that fell far behind; returns near misses this step. */
  update(w: World, ev: StepEvents, time: number): number {
    const P = w.player.phys;
    for (const h of ev.npcHits) if (h.car.isPlayer && h.npc.kind === 'traffic') this.touched.set(h.npc, time);
    let near = 0;
    for (const c of this.cars) {
      const ds = c.phys.s - P.s;
      const ahead = ds > 0;
      const was = this.lastAhead.get(c);
      // Passed it this step: close, fast, and without touching it.
      if (was === true && !ahead && Math.abs(c.phys.x - P.x) < 2.9 && P.v - c.phys.v > 9 && time - (this.touched.get(c) ?? -9) > 1.2) near++;
      this.lastAhead.set(c, ahead);
      if (ds < -140 || ds > 900) {
        const lane = this.laneX(w, Math.floor(Math.random() * Math.max(2, w.track.lanes)));
        c.phys.s = P.s + 420 + Math.random() * 380;
        c.phys.ps = c.phys.s;
        c.phys.x = c.phys.px = lane;
        c.lane = lane;
        c.cruise = 17 + Math.random() * 15;
        c.phys.v = c.cruise;
        this.lastAhead.set(c, true);
      }
    }
    return near;
  }
}

/** Highway Rush: near misses and distance score points; checkpoints add time; the clock is the enemy. */
export class HighwayMode implements GameMode {
  readonly id = 'highway' as const;
  readonly siren = 0;
  private readonly traffic = new Traffic(26);
  private time = 0;
  private timeLeft = 45;
  private score = 0;
  private combo = 0;
  private nears = 0;
  private startS = 0;
  private nextCheck = 0;
  private checkLen = 0;
  private pops: { text: string; good: boolean }[] = [];
  done = false;

  start(w: World): void {
    this.traffic.start(w);
    this.startS = w.player.phys.s;
    this.checkLen = w.track.length / 3;
    this.nextCheck = this.startS + this.checkLen;
  }

  update(dt: number, w: World, ev: StepEvents): void {
    if (this.done) return;
    this.time += dt;
    this.timeLeft -= dt;
    const P = w.player.phys;
    const near = this.traffic.update(w, ev, this.time);
    if (near) {
      this.combo += near;
      this.nears += near;
      this.score += 250 * near * Math.min(this.combo, 10);
      P.boost = Math.min(1, P.boost + 0.06 * near);
      this.pops.push({ text: this.combo > 1 ? `NEAR MISS ×${this.combo}` : 'NEAR MISS', good: true });
    }
    for (const h of ev.npcHits) {
      if (h.car.isPlayer && h.strength > 0.15) {
        if (this.combo > 1) this.pops.push({ text: 'CRASH — combo lost', good: false });
        this.combo = 0;
      }
    }
    if (P.s >= this.nextCheck) {
      this.nextCheck += this.checkLen;
      const bonus = Math.max(8, 16 - Math.floor((P.s - this.startS) / w.track.length) * 2);
      this.timeLeft += bonus;
      this.pops.push({ text: `CHECKPOINT +${bonus}s`, good: true });
    }
    this.score += Math.max(0, P.v) * dt * 2; // distance points
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.done = true;
    }
  }

  frame(): void {}

  hud(): string[] {
    return [`TIME ${this.timeLeft.toFixed(1)}`, `SCORE ${Math.round(this.score).toLocaleString('en-US')}${this.combo > 1 ? ` · ×${this.combo}` : ''}`];
  }

  takePops(): { text: string; good: boolean }[] {
    const p = this.pops;
    this.pops = [];
    return p;
  }

  result(): ModeResult {
    return { title: 'TIME UP', detail: `${Math.round(this.score).toLocaleString('en-US')} points · ${this.nears} near misses`, score: Math.round(this.score), won: true };
  }
}

interface Cop {
  car: CarEntry;
  bar: { red: THREE.MeshBasicMaterial; blue: THREE.MeshBasicMaterial; redHalo: THREE.SpriteMaterial; blueHalo: THREE.SpriteMaterial };
  ai: AiDriver;
  block?: boolean;
}

/** Heat: survive the police chase. Busted when boxed in (slow, with a patrol car right on you). */
export class HeatMode implements GameMode {
  readonly id = 'heat' as const;
  private readonly traffic = new Traffic(14);
  private readonly cops: Cop[] = [];
  private time = 0;
  private heat = 1;
  private busted = 0;
  private nears = 0;
  private score = 0;
  private nextBlock = 35;
  private flash = 0;
  private pops: { text: string; good: boolean }[] = [];
  private readonly goal = 150; // seconds to escape
  siren = 0;
  done = false;
  private escaped = false;

  start(w: World): void {
    this.traffic.start(w);
    this.spawnCop(w, -140);
  }

  /**
   * Roof light bar: black housing with a red and a blue lens, as bright as a braking tail light (same HDR
   * level, so bloom makes them glow), each with a soft additive halo. (No real point light: adding lights
   * mid-race would recompile every shader and hitch.)
   */
  private makeLightBar(c: CarEntry): Cop['bar'] {
    const red = new THREE.MeshBasicMaterial({ color: '#ff1030', fog: false });
    const blue = new THREE.MeshBasicMaterial({ color: '#1060ff', fog: false });
    const roofT = c.car.style.cabin[1][0];
    const roofY = c.car.style.cabin[1][1];
    const z = -c.car.style.length / 2 + roofT * c.car.style.length + 0.25;
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: '#0a0a0e', metalness: 0.6, roughness: 0.35 }));
    housing.position.set(0, roofY + 0.04, z);
    c.car.group.add(housing);
    const mk = (col: string) => new THREE.SpriteMaterial({ map: haloTexture(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false });
    const redHalo = mk('#ff2040'), blueHalo = mk('#2a70ff');
    for (const [mat, hm, x] of [[red, redHalo, -0.3], [blue, blueHalo, 0.3]] as const) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.24), mat);
      lens.position.set(x, roofY + 0.1, z);
      c.car.group.add(lens);
      for (const zz of [-0.13, 0.13]) {
        const h = new THREE.Sprite(hm);
        h.scale.setScalar(3.0);
        h.position.set(x, roofY + 0.1, z + zz);
        c.car.group.add(h);
      }
    }
    return { red, blue, redHalo, blueHalo };
  }

  private spawnCop(w: World, ds: number, block?: { x: number }): void {
    const P = w.player.phys;
    const ai: AiDriver = { skill: 1.06, lane: P.x, laneTimer: 1e9, useBoost: !block };
    const car = w.addNpc({
      setup: { style: 'gt', paint: '#0e0e14', accent: '#2a6bff', tier: 'pro', spec: { topSpeed: 92, accel: 17, grip: 27 } },
      s: P.s + ds,
      x: block ? block.x : P.x,
      kind: 'police',
      cruise: block ? 0 : Math.max(20, P.v),
      brain: block ? undefined : (c, dt) => this.copBrain(c, ai, w, dt),
    });
    if (block) { car.lane = block.x; car.cruise = 0; }
    this.cops.push({ car, bar: this.makeLightBar(car), ai, block: !!block });
  }

  /** Race line + speed from the racing AI, but the steering homes in on the player when close. */
  private copBrain(c: CarEntry, ai: AiDriver, w: World, dt: number) {
    const P = w.player.phys;
    ai.lane = P.x;
    const inp = aiInput(c.phys, ai, c.spec, w.track, [c.phys], dt);
    const ds = P.s - c.phys.s;
    if (ds > -4 && ds < 30) {
      const dx = P.x - c.phys.x;
      inp.steer = Math.max(-1, Math.min(1, inp.steer + dx * 0.12));
      if (ds < 12) inp.throttle = 1;
    }
    // Rubber band: patrol cars never fall hopelessly behind (hotter = faster).
    if (ds > 60) { inp.throttle = 1; inp.brake = 0; if (c.phys.boost < 0.5) c.phys.boost += dt * 0.05 * this.heat; }
    return inp;
  }

  update(dt: number, w: World, ev: StepEvents): void {
    if (this.done) return;
    this.time += dt;
    const P = w.player.phys;
    const near = this.traffic.update(w, ev, this.time);
    if (near) {
      this.nears += near;
      this.heat = Math.min(5, this.heat + 0.12 * near);
      this.score += 150 * near;
      P.boost = Math.min(1, P.boost + 0.05 * near);
      this.pops.push({ text: 'NEAR MISS', good: true });
    }
    for (const h of ev.npcHits) if (h.car.isPlayer && h.npc.kind === 'police' && h.strength > 0.2) this.heat = Math.min(5, this.heat + 0.05);
    this.heat = Math.min(5, this.heat + dt * (P.boosting ? 0.03 : 0.012));
    // More patrol cars as the heat rises.
    const chasers = this.cops.filter((c) => !c.block).length;
    if (chasers < Math.min(4, Math.floor(this.heat))) {
      this.spawnCop(w, -170 - Math.random() * 60);
      this.pops.push({ text: `HEAT ${Math.floor(this.heat)}`, good: false });
    }
    // Roadblocks from heat 3: two parked patrol cars across the road, leaving a gap.
    if (this.heat >= 3 && this.time > this.nextBlock) {
      this.nextBlock = this.time + 32;
      const lanes = Math.max(2, w.track.lanes);
      const lw = w.track.width / lanes;
      const gap = Math.floor(Math.random() * lanes);
      let placed = 0;
      for (let i = 0; i < lanes && placed < lanes - 1; i++) {
        if (i === gap) continue;
        this.spawnCop(w, 420, { x: -w.track.width / 2 + lw * (i + 0.5) });
        placed++;
      }
      this.pops.push({ text: 'ROADBLOCK AHEAD', good: false });
    }
    // Clean up roadblocks we passed.
    for (const c of this.cops.slice()) {
      if (c.block && c.car.phys.s < P.s - 120) {
        w.removeNpc(c.car);
        this.cops.splice(this.cops.indexOf(c), 1);
      }
    }
    // Busted: a patrol car on you while you're (nearly) stopped.
    let closest = Infinity;
    for (const c of this.cops) {
      const d = Math.hypot(c.car.phys.s - P.s, c.car.phys.x - P.x);
      closest = Math.min(closest, d);
    }
    this.siren = Math.max(0, 1 - closest / 220);
    if (closest < 8 && P.v < 11) this.busted += dt;
    else this.busted = Math.max(0, this.busted - dt * 0.6);
    this.score += dt * 40 * this.heat;
    if (this.busted >= 2.6) this.done = true;
    else if (this.time >= this.goal) {
      this.done = true;
      this.escaped = true;
    }
  }

  frame(dt: number): void {
    this.flash += dt;
    // Wig-wag with a double flash per side (red, red, blue, blue), at brake-light brightness.
    const k = Math.floor(this.flash * 12) % 8;
    const redOn = k === 0 || k === 2, blueOn = k === 4 || k === 6;
    for (const c of this.cops) {
      const b = c.bar;
      b.red.color.set('#ff1030').multiplyScalar(redOn ? 12 : 0.25);
      b.blue.color.set('#1060ff').multiplyScalar(blueOn ? 14 : 0.25);
      b.redHalo.opacity = redOn ? 1 : 0;
      b.blueHalo.opacity = blueOn ? 1 : 0;
    }
  }

  hud(): string[] {
    const stars = '★'.repeat(Math.floor(this.heat)) + '☆'.repeat(5 - Math.floor(this.heat));
    const left = Math.max(0, this.goal - this.time);
    return [`HEAT ${stars}`, this.busted > 0.3 ? `BUSTED ${'▮'.repeat(Math.ceil((this.busted / 2.6) * 5))}${'▯'.repeat(5 - Math.ceil((this.busted / 2.6) * 5))}` : `ESCAPE IN ${left.toFixed(0)}s`];
  }

  takePops(): { text: string; good: boolean }[] {
    const p = this.pops;
    this.pops = [];
    return p;
  }

  result(): ModeResult {
    return this.escaped
      ? { title: 'ESCAPED!', detail: `${Math.round(this.score).toLocaleString('en-US')} points · heat ${Math.floor(this.heat)} · ${this.nears} near misses`, score: Math.round(this.score), won: true }
      : { title: 'BUSTED', detail: `${this.time.toFixed(0)} s on the run · ${Math.round(this.score).toLocaleString('en-US')} points`, score: Math.round(this.score), won: false };
  }
}
