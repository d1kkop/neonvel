/**
 * The garage line-up. Stats are 0..10 bars shown in the UI and mapped onto the physics spec.
 * Two mediocre free starters; PRO cars ($2) are clearly better; ELITE cars ($3) are the best.
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
}

export const CARS: CarModel[] = [
  // Free starters: deliberately mediocre.
  { id: 'vortex', name: 'Vortex GT-R', style: 'wedge', paint: '#c8ff00', accent: '#00e5ff', stats: { speed: 5, accel: 5, grip: 5 }, engine: 'flat12', price: 0, tier: 'free', blurb: 'Your first wedge. Honest, balanced — and outgunned by everything you can unlock.' },
  { id: 'thunder', name: 'Thunder 454', style: 'muscle', paint: '#1a6bff', accent: '#ff2bd6', stats: { speed: 5, accel: 6, grip: 4 }, engine: 'v8muscle', price: 0, tier: 'free', blurb: 'Old-school muscle. Loud and quick off the line, but wallows in the bends.' },
  // PRO ($2): clearly better.
  { id: 'velvet', name: 'Velvet Coupé', style: 'coupe', paint: '#ff2bd6', accent: '#ffb000', stats: { speed: 7, accel: 7, grip: 8 }, engine: 'inline6', price: 200, tier: 'pro', blurb: 'Smooth and sticky — corners like it is on rails.' },
  { id: 'pocket', name: 'Pocket Rocket', style: 'hatch', paint: '#ffb000', accent: '#3dff9e', stats: { speed: 6, accel: 9, grip: 8 }, engine: 'turbo4', price: 200, tier: 'pro', blurb: 'Turbo hot hatch. Explodes out of every corner.' },
  { id: 'cruiser', name: 'Midnight Cruiser', style: 'gt', paint: '#2a2a3a', accent: '#a64dff', stats: { speed: 9, accel: 6, grip: 7 }, engine: 'v12', price: 200, tier: 'pro', blurb: 'V12 grand tourer with a huge top speed.' },
  { id: 'razor', name: 'Razor X', style: 'razor', paint: '#f5f5f5', accent: '#ff3b5c', stats: { speed: 8, accel: 8, grip: 7 }, engine: 'v10', price: 200, tier: 'pro', blurb: 'Knife-edge V10 hypercar wedge. Fast everywhere.' },
  // ELITE ($3): the best.
  { id: 'phantom', name: 'Phantom LM', style: 'proto', paint: '#0b0b12', accent: '#00e5ff', stats: { speed: 9, accel: 9, grip: 9 }, engine: 'racev8', price: 300, tier: 'elite', blurb: 'Le Mans prototype. Iridescent stealth paint, screaming race V8, near-perfect in every corner.' },
  { id: 'aurum', name: 'Aurum Hyper', style: 'hyper', paint: '#d4a017', accent: '#ff2bd6', stats: { speed: 10, accel: 9, grip: 8 }, engine: 'w16', price: 300, tier: 'elite', blurb: 'W16 quad-turbo in pearlescent gold. The fastest car in the game.' },
];

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
