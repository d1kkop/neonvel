/**
 * Track records use the game's own lap time (what the driver saw), but only after the server has checked it:
 * the game reports its distance along the track ten times a second, and the server times the same lap on its
 * own clock from those reports (from the green light, interpolated where the lap line was crossed). A claimed
 * lap counts only if every report in that lap was possible for this car (no jumps further than its boosted top
 * speed allows) and the claim is not faster than the server's own measurement allows (network jitter leaves a
 * small margin; claiming a slower time is never a problem).
 */
import { CARS, specFor } from '../../src/game/car/catalog';
import { BOOST } from '../../src/game/boostRules';
import { TRACK_LENGTHS } from '../../src/game/products';
import { LEVELS, submitLap, type PlayerRow } from './db';

export interface LapTiming {
  level: string; L: number; car: string; maxV: number;
  lastS: number; lastT: number; lap: number; lapStart: number | null; clean: boolean;
  /** Server-measured lap times by lap number (null = that lap was not clean), and claims waiting for them. */
  measured: Map<number, number | null>;
  claims: Map<number, number>;
}

export const LAP_TOLERANCE_MS = 350;

export function startTiming(level: string, carId: string): LapTiming | null {
  if (!LEVELS.includes(level)) return null;
  const model = CARS.find((x) => x.id === carId) ?? CARS[0];
  return {
    level, L: TRACK_LENGTHS[level], car: model.id, maxV: specFor(model).topSpeed * BOOST.top * 1.1 + 12,
    lastS: 0, lastT: Date.now(), lap: 0, lapStart: Date.now(), clean: true, measured: new Map(), claims: new Map(),
  };
}

type Send = (msg: Record<string, unknown>) => void;

/** Decide a claimed lap once both the claim and the server's measurement of that lap are known. */
export async function judgeLap(k: LapTiming, lap: number, db: D1Database, player: PlayerRow, send: Send): Promise<void> {
  if (!k.claims.has(lap) || !k.measured.has(lap)) return;
  const claim = k.claims.get(lap)!, measured = k.measured.get(lap)!;
  k.claims.delete(lap);
  if (measured === null) return send({ t: 'lap', level: k.level, lap, ms: claim, rejected: 'This lap could not be checked (connection gap or impossible movement).' });
  if (claim < measured - LAP_TOLERANCE_MS - measured * 0.005) return send({ t: 'lap', level: k.level, lap, ms: claim, rejected: 'Lap time does not match the race (paused, or the clock ran fast).' });
  const r = await submitLap(db, player, k.level, claim, k.car);
  send({ t: 'lap', level: k.level, lap, ms: claim, ...r });
}

/** A progress report (distance s, speed v). Returns the lap number that was just measured, if any. */
export function timeProgress(k: LapTiming, s: number, v: number): number | null {
  if (!Number.isFinite(s)) return null;
  const now = Date.now();
  const dt = (now - k.lastT) / 1000, ds = s - k.lastS;
  if (ds < -40 || ds > k.maxV * Math.max(dt, 0.05) * 1.5 + 20 || (Number.isFinite(v) && v > k.maxV * 1.1) || dt > 5) k.clean = false;
  const lap = Math.floor(Math.max(0, s) / k.L);
  let measuredLap: number | null = null;
  if (lap > k.lap && ds > 0) {
    const tCross = k.lastT + (now - k.lastT) * Math.max(0, Math.min(1, (lap * k.L - k.lastS) / ds));
    if (k.lapStart !== null && lap === k.lap + 1) {
      k.measured.set(lap, k.clean ? tCross - k.lapStart : null);
      measuredLap = lap;
      if (k.measured.size > 20) k.measured.delete(Math.min(...k.measured.keys()));
    }
    k.lapStart = tCross;
    k.clean = true;
  }
  k.lap = lap;
  k.lastS = s;
  k.lastT = now;
  return measuredLap;
}
