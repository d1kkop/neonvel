import { BOOST } from './boostRules';
import type { InputState } from '../app/Input';
import type { LoopTrack } from '../track/Track';

/**
 * Arcade car physics in track coordinates (deterministic, fixed-step).
 *  s   distance along the track centre line (unwrapped, laps = s / length)
 *  x   lateral offset from the centre (+ = right)
 *  psi body heading relative to the track tangent (+ = pointing right)
 *  phi velocity direction relative to the track tangent (psi - phi = slip angle)
 *  v   speed (m/s)
 */
export interface CarPhys {
  s: number;
  x: number;
  psi: number;
  phi: number;
  v: number;
  yawRate: number;
  steer: number; // smoothed steering angle (rad), for visuals
  gear: number;
  rpm: number;
  slip: number; // 0..1 tyre slip (drift / skid amount)
  throttle: number;
  latAcc: number; // for body roll
  lonAcc: number; // for body pitch
  wallHit: number; // impact strength this step (0 = none)
  drift: number; // 0..1 drift state (drift mode)
  driftDir: number; // -1 / +1 side of the current drift
  driftAngle: number; // visual body angle during a drift (rad)
  driftAngleVel: number; // its spring velocity (rad/s): the body swings with weight, not on rails
  /** Boost meter 0..1 (earned by drifting and hitting cars, lost on walls) and whether it fires now. */
  boost: number;
  boosting: boolean;
  /** Seconds until a car-to-car hit may give boost again. */
  boostHitCd: number;
  /** Was against a wall last step (a hard knock drains boost once, scraping drains steadily). */
  onWall: boolean;
  // previous step (interpolation)
  ps: number;
  px: number;
  ppsi: number;
}

export interface CarSpec {
  topSpeed: number; // m/s
  accel: number; // m/s² at low speed
  brake: number; // m/s²
  grip: number; // max lateral acceleration, m/s²
  wheelbase: number;
  maxSteer: number; // rad at standstill
  halfWidth: number;
  length: number;
  /** Drift mode: hard steering + brake/handbrake tap starts a held, controllable slide. */
  driftMode?: boolean;
  /** Player cars: braking while steering hard at speed starts a slide (AI cars brake for corners without it). */
  brakeSlide?: boolean;
}

export const DEFAULT_SPEC: CarSpec = {
  topSpeed: 90,
  accel: 15,
  brake: 32,
  grip: 26,
  wheelbase: 2.6,
  maxSteer: 0.6,
  halfWidth: 1.0,
  length: 4.5,
};

const GEAR_TOP = [0, 22, 38, 54, 70, 86, 108]; // top speed per gear (m/s); index 0 unused
const IDLE_RPM = 900;
const REDLINE = 7600;

export function createPhys(s: number, x: number): CarPhys {
  return {
    s, x, psi: 0, phi: 0, v: 0, yawRate: 0, steer: 0, gear: 1, rpm: IDLE_RPM, slip: 0, throttle: 0,
    latAcc: 0, lonAcc: 0, wallHit: 0, drift: 0, driftDir: 1, driftAngle: 0, driftAngleVel: 0, ps: s, px: x, ppsi: 0,
    boost: 1, boosting: false, boostHitCd: 0, onWall: false, // races start with a full boost bar
  };
}

/** One fixed simulation step. `handbrake` lowers rear grip for drifting. */
export { BOOST } from './boostRules';

/** A car-to-car hit: both cars earn a little boost (with a cooldown so leaning on someone doesn't farm it). */
export function boostFromHit(c: CarPhys, strength: number): void {
  if (c.boostHitCd > 0 || strength < 0.05) return;
  c.boost = Math.min(1, c.boost + BOOST.hitGain * Math.min(1, 0.4 + strength * 1.5));
  c.boostHitCd = BOOST.hitCooldown;
}

/**
 * Grip multiplier from speed (downforce): fast cars stick to the road, so a quick bend can be taken flat instead
 * of the car pushing wide. Full effect (+35%) from ~250 km/h.
 */
export function downforce(v: number): number {
  return 1 + 0.35 * Math.min(1, (v / 70) ** 2);
}

export function stepPhys(c: CarPhys, inp: InputState & { handbrake?: number; boost?: number }, spec: CarSpec, track: LoopTrack, dt: number): void {
  c.ps = c.s;
  c.px = c.x;
  c.ppsi = c.psi;
  c.wallHit = 0;
  const v0 = c.v;

  // --- Boost
  c.boostHitCd = Math.max(0, c.boostHitCd - dt);
  const wasBoosting = c.boosting;
  c.boosting = (inp.boost ?? 0) > 0.5 && c.boost > 0.005 && c.v > 3;
  if (c.boosting && !wasBoosting) { c.v += BOOST.kick; c.boost = Math.max(0, c.boost - BOOST.kickCost); } // the shove costs a bit, so tapping does not farm it
  if (c.boosting) c.boost = Math.max(0, c.boost - BOOST.burn * dt);
  const top = spec.topSpeed * (c.boosting ? BOOST.top : 1);

  // --- Longitudinal
  const speed01 = Math.max(0, c.v) / top;
  // Engine pull fades late (cubic) and drag is moderate, so cars really reach ~90% of their top speed.
  const throttle = c.boosting ? 1 : inp.throttle;
  // Like a real car: full pull (what the tyres allow) up to about 110 km/h, above that the engine's power is
  // spread over more speed (force ~ power / speed), so the acceleration tapers off instead of staying constant.
  const POWER_V = 30; // m/s where traction-limited turns into power-limited
  const powerK = Math.min(1, POWER_V / Math.max(1, Math.abs(c.v)));
  const engine = throttle * spec.accel * (c.boosting ? BOOST.power : 1) * Math.max(0.12, powerK * (1.25 - 0.25 * powerK)) * Math.max(0.15, 1 - speed01 * speed01 * speed01);
  // Drift mode: the brake also holds a drift, so while sliding it only bites lightly.
  // While drifting the brakes bite less (the slide keeps its speed), but enough to scrub speed off when you need to.
  const braking = inp.brake * spec.brake * (c.v > 0.5 ? 1 : 0) * (1 - (spec.driftMode ? 0.6 : 0.3) * c.drift);
  const drag = 0.0006 * c.v * c.v + 0.15;
  c.v += (engine - braking - drag) * dt;
  // Reverse-ish: brake at standstill backs up slowly.
  if (c.v < 0.5 && inp.brake > 0.5 && inp.throttle < 0.1) c.v = Math.max(-6, c.v - 4 * dt);
  if (c.v < 0 && inp.brake < 0.1) c.v = Math.min(0, c.v + 6 * dt);
  // Hills: climbing costs a little speed, descending gives a little (arcade-light gravity).
  if (track.hilly) c.v -= 9.81 * 0.35 * track.slopeAt(c.s) * dt;
  // Above top speed (after a boost) ease back down instead of snapping.
  if (c.v > top) c.v -= (c.v - top) * Math.min(1, dt * 1.5);
  c.throttle = throttle;

  // --- Steering: less lock at speed; yaw rate limited by grip.
  // More lock at speed than before (it felt stiff), still less than at parking speed.
  // Direct: little lock lost at speed, and the wheel follows the input almost at once (keyboard included).
  const steerLock = spec.maxSteer / (1 + Math.abs(c.v) * 0.022);
  const targetSteer = inp.steer * steerLock;
  c.steer += (targetSteer - c.steer) * (1 - Math.exp(-dt * 20));
  const vAbs = Math.max(Math.abs(c.v), 0.1);
  let wantYaw = (c.v / spec.wheelbase) * Math.tan(c.steer);
  const hb = inp.handbrake ?? 0;
  // Drift mode: kick in with hard steering + (hand)brake at speed, hold while steering.
  // Arcade drift — the way to take sharp turns at speed.
  //  Grip mode: handbrake (SPACE) + steer kicks it.  Drift mode: also a brake tap + steer, or just
  //  steering hard at speed (power slide). Held while you keep steering into the turn.
  const steerHard = Math.abs(inp.steer) > 0.5 && c.v > 16;
  // Brake-slide (both modes): brake while steering hard at speed and the tail steps out; it turns in tighter and keeps speed.
  const kick = steerHard && (hb > 0.5 || (!!spec.brakeSlide && inp.brake > 0.25 && c.v > 25) || (!!spec.driftMode && Math.abs(inp.steer) > 0.85 && c.v > 28));
  const into = c.driftDir * inp.steer; // > 0 steering into the drift, < 0 counter-steering
  // A swap needs the other way PLUS a handbrake / brake tap; just steering out of a drift ends it (keyboard steering is
  // always full lock, so steering alone used to flip straight into a drift the other way — "can't steer").
  if (c.drift > 0.3 && into < -0.7 && c.v > 16 && (hb > 0.5 || inp.brake > 0.25)) {
    // Switch sides (flick from one drift into the other, like an S-bend): the slide flips but loses some
    // of its bite for a moment, so the weight transfer is felt.
    c.driftDir = -c.driftDir;
    c.drift = Math.min(c.drift, 0.6);
  } else if (kick && c.drift < 0.3) c.driftDir = Math.sign(inp.steer) || 1;
  // Hold: steer into the drift — or keep the handbrake (drift mode: brake) held, which also holds it on a
  // straight with the wheel centred (the body stays angled and you steer the line).
  const holdButton = hb > 0.5 || (!!spec.driftMode && inp.brake > 0.25);
  const hold = (c.driftDir * inp.steer > 0.15 || (holdButton && c.driftDir * inp.steer > -0.5)) && c.v > 12;
  const target = (kick && Math.sign(inp.steer) === c.driftDir) || (c.drift > 0.3 && hold) ? 1 : 0;
  // Let go = the drift ends fairly quickly; a light counter-steer ends it faster.
  const release = c.driftDir * inp.steer < -0.15 ? 5 : 3.2;
  c.drift += (target - c.drift) * (1 - Math.exp(-dt * (target ? 7 : release)));
  const d = c.drift;
  // While drifting the car can corner up to ~70% harder (that's what makes hairpins possible);
  // the price is a little speed and a big, controllable body angle.
  const gripMax = spec.grip * downforce(vAbs) * (1 - hb * 0.12) * (1 + d * 0.7);
  const yawLimit = gripMax / vAbs;
  const over = 1.0 + hb * 0.15;
  // Soft limit (tanh): the car eases into the grip limit instead of hitting a wall — and gets a little extra.
  const yawCap = yawLimit * over * 1.1;
  wantYaw = yawCap * Math.tanh(wantYaw / yawCap);
  c.yawRate += (wantYaw - c.yawRate) * (1 - Math.exp(-dt * 15));

  // --- Track kinematics (curvature rotates the track frame under the car).
  const kappa = track.curvatureAt(c.s);
  const sDot = (c.v * Math.cos(c.phi)) / Math.max(0.2, 1 - c.x * kappa);
  c.psi += (c.yawRate - kappa * sDot) * dt;

  // Velocity direction chases the heading, limited by tyre grip (that's the drift).
  let beta = c.psi - c.phi;
  const maxTurn = (gripMax / vAbs) * dt; // rad the velocity vector may turn this step
  const turnPhi = Math.max(-maxTurn, Math.min(maxTurn, beta));
  c.phi += turnPhi - kappa * sDot * dt;
  beta = c.psi - c.phi;
  // Coming out of a drift the tyres bite again: the travel direction catches up with the nose fast, so
  // the steering works straight away instead of the car floating sideways for a second.
  if (d < 0.35 && Math.abs(beta) > 0.1) {
    const k = (0.35 - d) / 0.35;
    const catchUp = Math.min(Math.abs(beta) - 0.1, 5 * k * dt);
    c.phi += Math.sign(beta) * catchUp;
    beta = c.psi - c.phi;
  }
  // Never spin out completely: cap the slip angle (drifts are held around 25-35 degrees).
  const betaMax = 0.5 + hb * 0.25;
  if (Math.abs(beta) > betaMax) {
    c.psi = c.phi + Math.sign(beta) * betaMax;
    beta = c.psi - c.phi;
  }
  c.slip = Math.min(1, Math.abs(Math.sin(beta)) * 3 + hb * (c.v > 8 ? 0.5 : 0));
  // Sliding scrubs speed (a held drift keeps most of it).
  c.v *= 1 - Math.abs(Math.sin(beta)) * 0.6 * dt - d * 0.05 * dt;
  // Visual drift angle: 12-28 degrees, more steering into the drift = more angle, counter-steer = less.
  const slipLook = Math.max(-0.07, Math.min(0.07, ((c.v * c.yawRate) / Math.max(1, spec.grip)) * 0.06)) * (1 - d);
  const driftTarget = c.driftDir * d * (0.3 + 0.3 * Math.max(0, inp.steer * c.driftDir)) + slipLook; // ~17..34 degrees
  // Spring with a little overshoot: a side swap swings through like a pendulum (weight transfer).
  c.driftAngleVel += ((driftTarget - c.driftAngle) * 55 - c.driftAngleVel * 11) * dt;
  c.driftAngle += c.driftAngleVel * dt;
  c.slip = Math.max(c.slip, d * 0.8 * Math.min(1, c.v / 25));
  // Driving on the throttle fills the bar slowly, so drivers who never drift still get boost.
  if (!c.boosting && c.v > BOOST.cruiseSpeed && (inp.throttle ?? 0) > 0.5) c.boost = Math.min(1, c.boost + BOOST.cruiseGain * dt);
  // Drifting fills the boost meter much faster — longer, deeper drifts faster still.
  if (d > 0.3 && c.v > 15) c.boost = Math.min(1, c.boost + BOOST.driftGain * d * (0.6 + Math.min(1, Math.abs(c.driftAngle) / 0.5) * 0.6) * dt);

  // --- Integrate position
  c.s += sDot * dt;
  c.x += c.v * Math.sin(c.phi) * dt;

  // --- Walls
  // The body is turned on the track (heading + drift angle): its corner sticks out further than the plain
  // half width, so the wall stop uses the rotated footprint (otherwise the tail swings through the wall).
  // Same geometry as the renderer (World.placeCars): the body is yawed by psi + driftAngle around a pivot
  // 0.28·L ahead of the centre, so in a drift the tail reaches out much further than half a car length.
  const psiB = c.psi + c.driftAngle;
  const sb = Math.sin(psiB), cb = Math.cos(psiB);
  const pa = spec.length * 0.28;
  const pivotLat = pa * Math.sin(c.psi) - pa * sb;
  let reachR = -Infinity, reachL = -Infinity;
  for (const along of [spec.length / 2, -spec.length / 2]) {
    for (const across of [spec.halfWidth, -spec.halfWidth]) {
      const lat = pivotLat + along * sb + across * cb;
      reachR = Math.max(reachR, lat);
      reachL = Math.max(reachL, -lat);
    }
  }
  const edge = track.width / 2 - 0.25;
  const limitR = edge - Math.max(spec.halfWidth, reachR);
  const limitL = edge - Math.max(spec.halfWidth, reachL);
  const wasOnWall = c.onWall;
  c.onWall = false;
  if (c.x > limitR || c.x < -limitL) {
    const side = c.x > limitR ? 1 : -1;
    c.x = side > 0 ? limitR : -limitL;
    const along = c.v * Math.cos(c.phi);
    const lat = c.v * Math.sin(c.phi);
    if (lat * side > 0) {
      c.wallHit = Math.min(1, Math.abs(lat) / 12);
      // Bounce off (a little) and lose speed in proportion to the impact — not a fixed % per frame,
      // which used to bleed all speed while scraping the outside wall of a bend ("stuck").
      // A real knock bounces back a little; a light scrape just slides along the wall (no bounce, so
      // no frame-to-frame in/out jitter that shook the car and the camera).
      const hard = Math.abs(lat) > 3;
      const newLat = hard ? -lat * 0.25 : 0;
      const scrub = Math.abs(lat) * 0.3; // m/s lost per contact
      const newAlong = Math.sign(along || 1) * Math.max(0, Math.abs(along) - scrub);
      c.v = Math.hypot(newAlong, newLat) * Math.sign(newAlong || 1);
      c.phi = Math.atan2(newLat, Math.max(1, Math.abs(newAlong)));
      // The body may point along the wall but not into it; stop any yaw that turns it further in.
      const into = (c.psi - c.phi) * side;
      if (into > 0.12) {
        c.psi += (c.phi + side * 0.12 - c.psi) * 0.5; // ease, don't snap
        if (c.yawRate * side > 0) c.yawRate *= 0.5;
      }
      // Only a real impact knocks the steering; scraping along must not choke it (that caused 'stuck in corners').
      if (Math.abs(lat) > 3) c.yawRate *= 0.6;
      // Walls cost boost: a hard knock once, scraping along steadily.
      c.onWall = true;
      if (hard && !wasOnWall) c.boost -= BOOST.knockDrain[0] + BOOST.knockDrain[1] * c.wallHit;
      c.boost = Math.max(0, c.boost - BOOST.scrapeDrain * dt);
    }
  }

  // --- Gearbox / rpm (automatic)
  const vf = Math.max(0, c.v);
  if (c.gear < 6 && vf > GEAR_TOP[c.gear] * 0.97) c.gear++;
  else if (c.gear > 1 && vf < GEAR_TOP[c.gear - 1] * 0.72) c.gear--;
  const lo = c.gear === 1 ? 0 : GEAR_TOP[c.gear - 1] * 0.62;
  const t = Math.max(0, Math.min(1, (vf - lo) / (GEAR_TOP[c.gear] - lo)));
  const targetRpm = IDLE_RPM + (REDLINE - IDLE_RPM) * (0.3 + 0.7 * t) * (vf < 1 ? 0.15 + inp.throttle * 0.5 : 1);
  // Wheelspin / slides rev the engine up.
  const rev = targetRpm + c.slip * 900 * inp.throttle;
  c.rpm += (rev - c.rpm) * (1 - Math.exp(-dt * 12));

  c.latAcc = c.v * c.yawRate;
  c.lonAcc = (c.v - v0) / dt;
}

/**
 * Equal-mass car-vs-car collision in track coordinates.
 * Fully separates the cars (with a small margin) every step so they can never stay hooked together,
 * and exchanges momentum along the contact normal with a little bounce.
 * `wallLimit` = max |x| a car may have (so a car pinned against the wall pushes the other one away).
 */
export function collidePhys(a: CarPhys, b: CarPhys, spec: CarSpec, trackLength: number, wallLimit = Infinity): number {
  let ds = b.s - a.s;
  ds -= Math.round(ds / trackLength) * trackLength;
  const dx = b.x - a.x;
  const W = spec.halfWidth * 2;
  const ox = W - Math.abs(dx);
  const os = spec.length - Math.abs(ds);
  if (ox <= 0 || os <= 0) return 0;
  const e = 0.35; // restitution
  const margin = 0.03;

  if (os / spec.length < ox / W) {
    // Front / rear contact.
    const dir = Math.sign(ds) || 1;
    a.s -= dir * (os / 2 + margin);
    b.s += dir * (os / 2 + margin);
    const va = a.v * Math.cos(a.phi);
    const vb = b.v * Math.cos(b.phi);
    const rel = (vb - va) * dir; // < 0 → closing
    if (rel < 0) {
      const j = (-(1 + e) * rel) / 2;
      a.v -= (dir * j) / Math.max(0.2, Math.cos(a.phi));
      b.v += (dir * j) / Math.max(0.2, Math.cos(b.phi));
      return Math.min(1, -rel / 12);
    }
    return 0;
  }

  // Side contact: push apart fully; a car stuck at the wall can't move, so the other takes the push.
  const dir = Math.sign(dx) || 1;
  const corr = ox + margin;
  const room = (c: CarPhys, side: number) => Math.max(0, side > 0 ? wallLimit - c.x : c.x + wallLimit);
  const roomA = room(a, -dir); // a moves away from b
  const roomB = room(b, dir);
  let mA = Math.min(corr / 2, roomA);
  let mB = corr - mA;
  if (mB > roomB) {
    mB = roomB;
    mA = Math.min(corr - mB, roomA);
  }
  a.x -= dir * mA;
  b.x += dir * mB;
  // Lateral momentum exchange.
  const la = a.v * Math.sin(a.phi);
  const lb = b.v * Math.sin(b.phi);
  const rel = (lb - la) * dir; // < 0 → moving toward each other
  let hit = 0.15;
  if (rel < 0) {
    const j = (-(1 + e) * rel) / 2;
    const nla = la - dir * j;
    const nlb = lb + dir * j;
    const setLat = (c: CarPhys, lat: number) => {
      const v = Math.max(1, Math.abs(c.v));
      const phi = Math.asin(Math.max(-0.45, Math.min(0.45, lat / v)));
      c.psi += (phi - c.phi) * 0.5; // the body gets knocked round a bit too
      c.phi = phi;
      c.yawRate *= 0.85;
    };
    setLat(a, nla);
    setLat(b, nlb);
    a.v *= 0.985;
    b.v *= 0.985;
    hit = Math.min(1, 0.25 - rel / 8);
  }
  return hit;
}

// ------------------------------------------------------------------ AI

export interface AiDriver {
  skill: number; // 0.85..1.0 — fraction of the theoretical corner speed it dares
  lane: number; // preferred lateral offset
  laneTimer: number;
  /** Smoothed racing line (internal). */
  xLine?: number;
  /** Seconds left of a drift kick (internal). */
  kick?: number;
  /** Uses its boost on straights (Normal difficulty and up). */
  useBoost?: boolean;
  /** Currently burning its boost (internal). */
  boosting?: boolean;
}

export type AiDifficulty = 'easy' | 'normal' | 'hard' | 'impossible';

/**
 * AI strength per difficulty. `power` scales the AI car's engine/top speed/brakes, `grip` its cornering grip;
 * `skill` is the starting range, `band` the rubber-band limits and `catchUp`/`ease` how fast it adapts.
 */
export const AI_DIFFICULTY: Record<AiDifficulty, { power: number; grip: number; skill: [number, number]; band: [number, number]; catchUp: number; ease: number }> = {
  easy: { power: 1.0, grip: 1.0, skill: [0.99, 1.05], band: [0.96, 1.1], catchUp: 0.0012, ease: 0.0003 },
  normal: { power: 1.09, grip: 1.09, skill: [1.01, 1.06], band: [0.98, 1.1], catchUp: 0.0015, ease: 0.0002 },
  hard: { power: 1.17, grip: 1.17, skill: [1.03, 1.08], band: [1.0, 1.1], catchUp: 0.002, ease: 0.0001 },
  impossible: { power: 1.27, grip: 1.27, skill: [1.06, 1.1], band: [1.04, 1.1], catchUp: 0.003, ease: 0 },
};

/** Racing AI: brake for curvature ahead, steer to a target line, dodge cars ahead. */
export function aiInput(c: CarPhys, ai: AiDriver, spec: CarSpec, track: LoopTrack, others: CarPhys[], dt: number): InputState & { handbrake: number; boost: number } {
  // Target speed from the tightest curve within braking distance.
  const lookAhead = 25 + c.v * c.v / (2 * spec.brake * 0.85); // brakes late, like a racer
  const k = track.maxCurvatureAhead(c.s, lookAhead);
  // Sharp bends (radius under ~80 m) are taken drifting, like a player would: drift grip lets it carry more speed.
  const SHARP = 0.0125;
  const driftCorner = k > SHARP;
  const cornerGrip = spec.grip * 0.96 * ai.skill * (driftCorner ? 1.35 : 1);
  let vCorner = k > 1e-4 ? Math.sqrt(cornerGrip / k) : spec.topSpeed;
  if (k > 1e-4) for (let it = 0; it < 3; it++) vCorner = Math.sqrt((cornerGrip * downforce(vCorner)) / k); // grip grows with speed
  // Boost on long straights (Normal and up): fire when there's a decent charge and no bend ahead.
  if (ai.useBoost) {
    const kFar = track.maxCurvatureAhead(c.s, 120 + c.v * 1.5);
    if (!ai.boosting && c.boost > 0.35 && kFar < 0.004 && c.drift < 0.2) ai.boosting = true;
    else if (ai.boosting && (c.boost < 0.03 || kFar > 0.006)) ai.boosting = false;
  } else ai.boosting = false;
  const vTarget = ai.boosting ? Math.min(spec.topSpeed * BOOST.top, vCorner) : Math.min(spec.topSpeed * (0.9 + 0.1 * ai.skill), vCorner);

  // Racing line: drift to the inside of upcoming bends, otherwise preferred lane.
  const kNear = track.curvatureAt(c.s + 25 + c.v * 0.6);
  const hw = track.width / 2 - spec.halfWidth - 0.6;
  let xTarget = Math.abs(kNear) > 0.003 ? Math.sign(kNear) * hw * 0.65 : ai.lane;

  // Avoid the car directly ahead: pick the side with more room.
  for (const o of others) {
    if (o === c) continue;
    let ds = o.s - c.s;
    ds -= Math.round(ds / track.length) * track.length;
    if (ds > 0 && ds < 18 + c.v * 0.4 && Math.abs(o.x - c.x) < 2.6 && c.v > o.v - 2) {
      xTarget = o.x > 0 ? o.x - 3.2 : o.x + 3.2;
      xTarget = Math.max(-hw, Math.min(hw, xTarget));
    } else if (Math.abs(ds) < spec.length + 2 && Math.abs(o.x - c.x) < 3.0) {
      // Car alongside: give it room instead of leaning on it.
      xTarget = Math.max(-hw, Math.min(hw, c.x + (c.x >= o.x ? 1 : -1) * 3.4));
      if (ai.xLine !== undefined) ai.xLine = c.x + (xTarget - c.x) * 0.3;
    }
  }
  ai.laneTimer -= dt;
  if (ai.laneTimer <= 0) {
    ai.laneTimer = 9 + Math.random() * 9;
    ai.lane = Math.max(-hw * 0.55, Math.min(hw * 0.55, ai.lane + (Math.random() * 2 - 1) * hw * 0.35));
  }

  // Steering: PD on heading toward a point ahead of the car.
  // Smoothly approach the target line (rate-limited) so the cars don't weave.
  ai.xLine = ai.xLine ?? c.x;
  const maxLat = 2.2 * dt;
  ai.xLine += Math.max(-maxLat, Math.min(maxLat, xTarget - ai.xLine));
  const desiredPsi = Math.max(-0.12, Math.min(0.12, (ai.xLine - c.x) * 0.035));
  // Feed-forward: the steering angle the curve needs at this speed, as a fraction of available lock.
  const steerLock = spec.maxSteer / (1 + Math.abs(c.v) * 0.045);
  const ff = Math.atan(track.curvatureAt(c.s + 6) * spec.wheelbase) / steerLock;
  let steer = Math.max(-1, Math.min(1, ff + (desiredPsi - c.psi) * 2.2 / (1 + c.v * 0.03) - (c.yawRate - track.curvatureAt(c.s) * c.v) * 0.12 - (c.psi - c.phi) * 0.8 * (1 - c.drift)));
  const throttle = c.v < vTarget - 1 ? 1 : c.v < vTarget ? 0.4 : 0;
  const brake = c.v > vTarget + 3 ? Math.min(1, (c.v - vTarget) / 10) : 0;
  // Drift: at the turn-in of a sharp bend, flick it (handbrake + hard steer for a moment), then hold it by
  // steering into the bend; it ends by itself when the bend straightens out.
  const kTurnIn = track.curvatureAt(c.s + 6 + c.v * 0.35);
  let handbrake = 0;
  ai.kick = Math.max(0, (ai.kick ?? 0) - dt);
  if (Math.abs(kTurnIn) > SHARP && c.v > 22 && c.drift < 0.3 && ai.kick === 0) ai.kick = 0.22;
  if (ai.kick > 0) {
    handbrake = 1;
    steer = Math.sign(kTurnIn || steer) * Math.max(0.65, Math.abs(steer));
  } else if (c.drift > 0.3 && Math.abs(kTurnIn) > SHARP * 0.6) {
    // Keep its own line-following steering; just don't let it drop below the drift-hold threshold
    // (unless it is getting close to the inside edge, then let the drift go).
    const into = Math.sign(kTurnIn);
    if (c.x * into < hw - 2.5) steer = into * Math.max(0.17, steer * into);
  }
  return { throttle, brake, steer, handbrake, boost: ai.boosting ? 1 : 0 };
}
