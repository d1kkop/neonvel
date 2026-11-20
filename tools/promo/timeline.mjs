// Promo video timeline. Music: "Space City" (115 BPM) → one bar = 4 beats = 2.087 s; every cut lands on a beat.
export const FPS = 30;
export const W = 1920;
export const H = 1080;
export const BPM = 115;
export const BAR = (4 * 60) / BPM;
const b = (bars) => bars * BAR;

// level / car / weather: the world; attract: 3 = the game's chase camera, or cam: scripted (orbit, lowfront) —
// the scripted cameras stay inside the road corridor (no clipping into walls / buildings / roofs).
// caption / name / sub / logo / end / feature (+ featureSub, big centred card): on-screen text. A flash + fade only happens when the LEVEL changes.
export const TIMELINE = [
  // Opening: title over the neon city.
  { id: 'title', scene: 'title', level: 'neon-skyway', car: 'aurum', attract: 3, dur: b(2), logo: true, fadeIn: true },

  // The cars on the move.
  { id: 'car-aurum', scene: 'cars', level: 'neon-skyway', car: 'aurum', cam: 'orbit', camOpts: { a0: 0.9, speed: 0.5 }, dur: b(1.5), name: 'AURUM HYPER', sub: 'NEW · W16 QUAD-TURBO' },
  { id: 'car-aurum2', scene: 'cars', level: 'neon-skyway', car: 'aurum', cam: 'lowfront', camOpts: { ahead: 8, lat: 2.2 }, dur: b(1), name: 'AURUM HYPER', sub: 'NEW · W16 QUAD-TURBO' },
  { id: 'car-phantom', scene: 'cars', level: 'neon-skyway', car: 'phantom', cam: 'orbit', camOpts: { a0: -0.8, speed: -0.45 }, dur: b(1), name: 'PHANTOM LM', sub: 'LE MANS PROTOTYPE' },
  { id: 'car-razor', scene: 'cars', level: 'neon-skyway', car: 'razor', cam: 'orbit', camOpts: { a0: 2.4, speed: 0.4 }, dur: b(1), name: 'RAZOR X', sub: 'V10 SUPERCAR' },
  { id: 'car-thunder', scene: 'cars', level: 'neon-skyway', car: 'thunder', cam: 'orbit', camOpts: { a0: -2.2, speed: -0.4 }, dur: b(1), name: 'THUNDER 454', sub: 'BIG-BLOCK MUSCLE' },

  // The worlds: two shots each (no flash between them).
  { id: 'skyway-a', scene: 'world', level: 'neon-skyway', car: 'cruiser', cam: 'lowfront', camOpts: { ahead: 11, lat: -2.6, h: 0.9 }, dur: b(1.5), caption: '8 WORLDS', name: 'NEON SKYWAY' },
  { id: 'skyway-b', scene: 'world', level: 'neon-skyway', car: 'cruiser', attract: 3, dur: b(1.5), feature: 'NETPLAY', featureSub: 'RACE UP TO 4 PLAYERS ONLINE', name: 'NEON SKYWAY', boost: true },
  { id: 'palm-a', scene: 'world', level: 'palm-coast', car: 'razor', cam: 'orbit', camOpts: { a0: 1.4, speed: 0.35, r: 5.6, h: 1.6, fov: 48 }, dur: b(1.5), name: 'PALM COAST' },
  { id: 'palm-b', scene: 'world', level: 'palm-coast', car: 'razor', attract: 3, dur: b(1.5), caption: 'DRIFT · BOOST · RACE', name: 'PALM COAST' },
  { id: 'desert-a', scene: 'world', level: 'desert-mirage', car: 'thunder', cam: 'lowfront', camOpts: { ahead: 10, lat: 2.6 }, dur: b(1.5), name: 'DESERT MIRAGE' },
  { id: 'desert-b', scene: 'world', level: 'desert-mirage', car: 'thunder', attract: 3, dur: b(1.5), feature: 'LEADERBOARDS', featureSub: 'CLIMB THE RANKING · BEAT THE TRACK RECORDS', name: 'DESERT MIRAGE', boost: true },
  { id: 'ocean-a', scene: 'world', level: 'deep-blue', car: 'phantom', cam: 'orbit', camOpts: { a0: -1.2, speed: -0.35, r: 5.6, h: 1.5, fov: 48 }, dur: b(1.5), name: 'DEEP BLUE' },
  { id: 'ocean-b', scene: 'world', level: 'deep-blue', car: 'phantom', attract: 3, dur: b(1.5), name: 'DEEP BLUE', boost: true },
  { id: 'space-a', scene: 'world', level: 'orbit-run', car: 'aurum', cam: 'lowfront', camOpts: { ahead: 10, lat: -2.4 }, dur: b(1.5), name: 'ORBIT RUN' },
  { id: 'space-b', scene: 'world', level: 'orbit-run', car: 'aurum', attract: 3, dur: b(1.5), feature: 'PLAY IN YOUR BROWSER', featureSub: 'PC & MOBILE · NO DOWNLOAD', name: 'ORBIT RUN', boost: true },

  // A glimpse of three more worlds (three quarters of a bar each).
  { id: 'glimpse-harbor', scene: 'glimpse', level: 'harbor-docks', car: 'vortex', attract: 3, dur: b(0.75), name: 'HARBOR DOCKS', flash: 0.6 },
  { id: 'glimpse-snow', scene: 'glimpse', level: 'snow-pass', car: 'pocket', cam: 'lowfront', camOpts: { ahead: 9, lat: 2.2 }, dur: b(0.75), name: 'SNOW PASS', flash: 0.6 },
  { id: 'glimpse-cyber', scene: 'glimpse', level: 'cyber-grid', car: 'velvet', attract: 3, dur: b(0.75), name: 'CYBER GRID', flash: 0.6 },

  // End card.
  { id: 'end', scene: 'end', level: 'neon-skyway', car: 'aurum', attract: 3, dur: b(3), logo: true, end: true, fadeOut: true, flash: 0.5 },
];

export const TOTAL = TIMELINE.reduce((s, x) => s + Math.round(x.dur * FPS), 0) / FPS;
