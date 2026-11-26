import type { CarEntry, StepEvents, World } from './World';

/**
 * Extra game modes on top of the race tracks:
 *  - Highway Rush: open road with civilian traffic, near-miss style points, checkpoints that add time.
 */
export type ModeId = 'race' | 'highway';

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
  /** Per frame (visuals). */
  frame(dt: number, w: World): void;
  readonly done: boolean;
  /** HUD lines (top right, under the position). */
  hud(): string[];
  /** Popups queued since the last call ("NEAR MISS ×3"). */
  takePops(): { text: string; good: boolean }[];
  result(): ModeResult;
}

const TRAFFIC_LOOKS: { style: string; paint: string }[] = [
  { style: 'asti', paint: '#c8c2b0' }, { style: 'gallo', paint: '#5a6470' }, { style: 'duke', paint: '#7a2a22' },
  { style: 'phoenix', paint: '#2f4a6a' }, { style: 'asti', paint: '#e0d070' }, { style: 'gallo', paint: '#1e1e24' },
  { style: 'duke', paint: '#3d5a3a' }, { style: 'phoenix', paint: '#9a9aa4' },
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

/** Boost-bar share gained per near miss, and the extra share per combo step (up to 5 steps). */
const NEAR_BOOST = 0.16;
const NEAR_BOOST_COMBO = 0.02;

/** Highway Rush: near misses and distance score points; checkpoints add time; the clock is the enemy. */
export class HighwayMode implements GameMode {
  readonly id = 'highway' as const;
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
      // Near misses are the boost source in this mode: a good chunk of the bar each, more as the combo builds.
      P.boost = Math.min(1, P.boost + (NEAR_BOOST + NEAR_BOOST_COMBO * Math.min(this.combo - 1, 5)) * near);
      this.pops.push({ text: this.combo > 1 ? `NEAR MISS ×${this.combo} +BOOST` : 'NEAR MISS +BOOST', good: true });
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
