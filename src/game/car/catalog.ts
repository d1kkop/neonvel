/**
 * The garage line-up. Stats are 0..10 bars shown in the UI and mapped onto the physics spec.
 * Listed from the slowest to the best (stats only go up down the list).
 */
export interface CarModel {
  id: string;
  name: string;
  style: string;
  paint: string;
  accent: string;
  /** 0..10 */
  stats: { speed: number; accel: number; grip: number };
  /** Engine sound profile id (see audio/engineProfiles.ts). */
  engine: string;
  /** Price in US cents (0 = free). */
  price: number;
  /** Visual / marketing tier. */
  tier: 'free' | 'pro' | 'elite';
  blurb: string;
  /** Vehicle class: buses only race buses (also online). */
  class?: 'car' | 'bus';
  /** Physics overrides on top of the stat-derived spec (e.g. the heavy bus). */
  specOverride?: { topSpeed?: number; accel?: number; brake?: number; grip?: number; wheelbase?: number; maxSteer?: number };
}

export const CARS: CarModel[] = [
  // Ordered from the slowest to the best: every step down the list is a better car. Models: the 90s pack
  // (tools/build-cars.mjs). Free: the first four. Paid: the last three ($0.50 / $1.00 / $1.50).
  { id: 'velvet', name: 'Asti HF', style: 'asti', paint: '#a3261c', accent: '#ff2bd6', stats: { speed: 4, accel: 5, grip: 6 }, engine: 'i4sport', price: 0, tier: 'free', blurb: 'Boxy rally-bred hot hatch: flared arches, a roof spoiler and a turbo four that loves to rev. Light, nimble, forgiving.' },
  { id: 'pocket', name: 'Phoenix', style: 'phoenix', paint: '#b08d57', accent: '#00e5ff', stats: { speed: 5, accel: 5, grip: 6 }, engine: 'v8muscle', price: 0, tier: 'free', blurb: 'Late-70s pony car in champagne gold: long bonnet, shaker scoop, lazy V8 torque.' },
  { id: 'vortex', name: 'Gallo 99', style: 'gallo', paint: '#24497e', accent: '#00e5ff', stats: { speed: 6, accel: 6, grip: 6 }, engine: 'turbo4', price: 0, tier: 'free', blurb: 'Late-90s twin-turbo coupé with a big rear wing. Balanced and honest, with a real top end.' },
  { id: 'thunder', name: 'Duke 69', style: 'duke', paint: '#8b8e92', accent: '#ffffff', stats: { speed: 7, accel: 7, grip: 6 }, engine: 'v8muscle', price: 0, tier: 'free', blurb: 'Big-block muscle in gunmetal silver: hidden grille, fat tyres, brutal off the line, a handful in the bends.' },
  { id: 'cruiser', name: 'Duntov', style: 'duntov', paint: '#4c2340', accent: '#a64dff', stats: { speed: 8, accel: 7, grip: 7 }, engine: 'v12', price: 50, tier: 'pro', blurb: 'Late-50s roadster coupé in plum with white coves and chrome teeth. Old money, surprising pace.' },
  { id: 'razor', name: 'Cheetah', style: 'cheetah', paint: '#9e1d1d', accent: '#ff3b5c', stats: { speed: 8, accel: 8, grip: 8 }, engine: 'flat12', price: 100, tier: 'pro', blurb: 'Flat-twelve wedge with side strakes and a wide hip. Fast everywhere.' },
  { id: 'aurum', name: 'NFR', style: 'nfr', paint: '#c4561a', accent: '#ff2bd6', stats: { speed: 10, accel: 10, grip: 9 }, engine: 'v10', price: 150, tier: 'elite', blurb: 'Mid-engined 90s supercar in burnt orange: pop-up lamps, a screaming V10. The fastest car in the game.' },
];

/** Physics spec for a vehicle: stats mapped onto the spec, plus its own overrides (bus). */
export function specFor(m: CarModel): { topSpeed: number; accel: number; grip: number; brake?: number; wheelbase?: number; maxSteer?: number } {
  return { ...specFromStats(m.stats), ...(m.specOverride ?? {}) };
}

export function classOf(id: string): 'car' | 'bus' {
  return CARS.find((c) => c.id === id)?.class ?? 'car';
}

export function carById(id: string): CarModel {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}

/** Map 0..10 stat bars onto the physics spec. Paid cars are genuinely faster. */
export function specFromStats(s: CarModel['stats']): { topSpeed: number; accel: number; grip: number } {
  return {
    topSpeed: 52.5 + s.speed * 5.1, // 5 → 78 m/s, 10 → 103.5 m/s (real top ≈ 255 … 330 km/h with drag)
    accel: 12 + s.accel * 0.6, // 5 → 15, 10 → 18 m/s²
    grip: 21 + s.grip * 0.7, // 5 → 24.5, 10 → 28 m/s²
  };
}

export const PAINTS = ['#c8ff00', '#ff2bd6', '#00e5ff', '#ffb000', '#ff3b5c', '#f5f5f5', '#1a6bff', '#14d68a', '#2a2a3a', '#d4a017'];

export function formatPrice(cents: number): string {
  return cents === 0 ? 'FREE' : `$${(cents / 100).toFixed(2)}`;
}
