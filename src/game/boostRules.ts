/**
 * Boost tuning, shared by the car physics (client) and the race server's plausibility check.
 * No imports: the Node server loads this file directly.
 */
export const BOOST = {
  power: 2.4, // engine force multiplier
  top: 1.3, // top-speed multiplier
  kick: 4, // m/s instant shove when it fires
  kickCost: 0.05, // meter spent by each shove
  burn: 0.25, // meter per second while boosting
  driftGain: 0.12, // meter per second of a full drift (× up to 1.2 for a deep angle)
  cruiseGain: 0.03, // meter per second just driving on the throttle above cruiseSpeed (a full bar in ~33 s), not while boosting
  cruiseSpeed: 20, // m/s
  hitGain: 0.08, // per car-to-car hit
  hitCooldown: 0.6,
  scrapeDrain: 0.25, // per second against a wall
  knockDrain: [0.03, 0.12] as const, // base + per impact strength, once per hard knock
  emptyLock: 2.5, // seconds without any refill after boosting the bar completely empty
  rearm: 0.2, // after running empty, boost only fires again from this much meter (no endless tiny boosts)
};
