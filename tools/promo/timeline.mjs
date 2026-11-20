// Promo video timeline, cut like a racing-game trailer. Music: "Space City" (115 BPM): one bar = 2.087 s,
// every cut lands on a beat.
//   cold open: close details on the beat → build: wide crane / drone shots coming down from high →
//   title drop → action montage (heights alternate: drone, ground level, chase, roadside fly-by, crane;
//   worlds and cars mixed, no name tags) with short feature cards → climax of quick cuts → end card.
export const FPS = 30;
export const W = 1920;
export const H = 1080;
export const BPM = 115;
export const BAR = (4 * 60) / BPM;
const b = (bars) => bars * BAR;

// Open stretches (no tunnel / canopy for a while) per level, in metres along the track: high shots start there.
const OPEN = {
  'neon-skyway': [700, 1450, 2120], 'palm-coast': [950, 1450, 2350], 'desert-mirage': [150, 1150, 1650], 'harbor-docks': [560, 1100],
  'snow-pass': [980, 2200], 'cyber-grid': [760, 1760], 'orbit-run': [580, 1560, 1900], 'deep-blue': [560, 1360, 2020],
};

// cam: crane (high → low), drone (high, looking down), flyby (still at the roadside, car races past), detail
// (very close and low), lowfront (low, ahead of the car), orbit; attract: 3 = the game's chase camera.
// feature / featureSub: big centred card. logo / end: title and end card.
export const TIMELINE = [
  // Cold open: details on the beat.
  { id: 'open-wheel', level: 'neon-skyway', car: 'aurum', skipTo: OPEN['neon-skyway'][0], cam: 'detail', camOpts: { a0: 1.45, speed: 0.25, r: 2.3, h: 0.32, lookH: 0.35, focus: 1.2 }, dur: b(0.5), fadeIn: true },
  { id: 'open-lamp', level: 'neon-skyway', car: 'aurum', cam: 'detail', camOpts: { a0: 0.35, speed: -0.2, r: 2.6, h: 0.5, lookH: 0.5, focus: 1.9, fov: 30 }, dur: b(0.5) },
  { id: 'open-rear', level: 'neon-skyway', car: 'aurum', cam: 'detail', camOpts: { a0: 3.0, speed: 0.22, r: 3.2, h: 0.75, lookH: 0.7, focus: -1.6, fov: 36 }, dur: b(0.5) },
  { id: 'open-wheel2', level: 'palm-coast', car: 'razor', skipTo: OPEN['palm-coast'][0], cam: 'detail', camOpts: { a0: -1.5, speed: -0.25, r: 2.3, h: 0.32, lookH: 0.35, focus: -1.1 }, dur: b(0.5) },

  // Build: wide and high, coming down.
  { id: 'build-palm', level: 'palm-coast', car: 'razor', skipTo: OPEN['palm-coast'][1], cam: 'crane', camOpts: { back0: 70, h0: 42, lat: 22, back1: 9, h1: 2.2 }, dur: b(1.5) },
  { id: 'build-desert', level: 'desert-mirage', car: 'thunder', skipTo: OPEN['desert-mirage'][1], cam: 'drone', camOpts: { h: 34, lat: 16, ahead: -20, drift: 6 }, dur: b(1.25) },
  { id: 'build-ocean', level: 'deep-blue', car: 'phantom', skipTo: OPEN['deep-blue'][0], cam: 'crane', camOpts: { back0: 55, h0: 30, lat: -16, back1: 8, h1: 1.6 }, dur: b(1.25) },

  // Title drop.
  { id: 'title', level: 'neon-skyway', car: 'aurum', skipTo: OPEN['neon-skyway'][1], attract: 3, dur: b(2), logo: true, flash: 0.9, boost: true },

  // Action montage.
  { id: 'm-flyby-desert', level: 'desert-mirage', car: 'thunder', skipTo: OPEN['desert-mirage'][2], cam: 'flyby', camOpts: { side: -1, h: 0.7 }, dur: b(0.75) },
  { id: 'm-low-space', level: 'orbit-run', car: 'aurum', skipTo: OPEN['orbit-run'][0], cam: 'lowfront', camOpts: { ahead: 7, lat: 1.8, h: 0.45 }, dur: b(0.75) },
  { id: 'm-drone-ocean', level: 'deep-blue', car: 'phantom', skipTo: OPEN['deep-blue'][1], cam: 'drone', camOpts: { h: 22, lat: -10, ahead: -6, drift: 4 }, dur: b(0.75) },
  { id: 'm-chase-palm', level: 'palm-coast', car: 'razor', skipTo: OPEN['palm-coast'][2], attract: 3, dur: b(0.75), boost: true },
  { id: 'feat-net', level: 'neon-skyway', car: 'cruiser', skipTo: OPEN['neon-skyway'][2], attract: 3, dur: b(1.5), feature: 'NETPLAY', featureSub: 'RACE UP TO 4 PLAYERS ONLINE', flash: 0.25 },
  { id: 'm-crane-space', level: 'orbit-run', car: 'aurum', skipTo: OPEN['orbit-run'][1], cam: 'crane', camOpts: { back0: 30, h0: 18, lat: 10, back1: 7, h1: 1.2, fov: 60 }, dur: b(0.75) },
  { id: 'm-flyby-harbor', level: 'harbor-docks', car: 'vortex', skipTo: OPEN['harbor-docks'][0], cam: 'flyby', camOpts: { side: 1, h: 0.9 }, dur: b(0.75) },
  { id: 'm-detail-snow', level: 'snow-pass', car: 'pocket', skipTo: OPEN['snow-pass'][0], cam: 'detail', camOpts: { a0: 2.2, speed: 0.35, r: 3.4, h: 0.6, lookH: 0.5, fov: 38 }, dur: b(0.5) },
  { id: 'm-low-cyber', level: 'cyber-grid', car: 'velvet', skipTo: OPEN['cyber-grid'][0], cam: 'lowfront', camOpts: { ahead: 8, lat: -2, h: 0.5 }, dur: b(0.5) },
  { id: 'feat-lb', level: 'desert-mirage', car: 'thunder', skipTo: OPEN['desert-mirage'][0], cam: 'drone', camOpts: { h: 18, lat: 8, ahead: -8, drift: 5 }, dur: b(1.5), feature: 'LEADERBOARDS', featureSub: 'CLIMB THE RANKING · BEAT THE TRACK RECORDS', flash: 0.25 },
  { id: 'm-chase-ocean', level: 'deep-blue', car: 'phantom', skipTo: OPEN['deep-blue'][2], attract: 3, dur: b(0.75), boost: true },
  { id: 'm-flyby-palm', level: 'palm-coast', car: 'razor', skipTo: OPEN['palm-coast'][0], cam: 'flyby', camOpts: { side: 1, h: 0.6 }, dur: b(0.75) },
  { id: 'feat-worlds', level: 'orbit-run', car: 'aurum', skipTo: OPEN['orbit-run'][2], cam: 'crane', camOpts: { back0: 50, h0: 30, lat: -14, back1: 9, h1: 2 }, dur: b(1.5), feature: '8 WORLDS', featureSub: 'CITY · COAST · DESERT · HARBOR · SNOW · GRID · SPACE · OCEAN', flash: 0.25 },

  // Climax: quick cuts.
  { id: 'c-chase-skyway', level: 'neon-skyway', car: 'cruiser', skipTo: OPEN['neon-skyway'][0], attract: 3, dur: b(0.5), boost: true },
  { id: 'c-low-space', level: 'orbit-run', car: 'aurum', skipTo: OPEN['orbit-run'][0], cam: 'lowfront', camOpts: { ahead: 6, lat: -1.6, h: 0.4 }, dur: b(0.5) },
  { id: 'c-drone-ocean', level: 'deep-blue', car: 'phantom', skipTo: OPEN['deep-blue'][0], cam: 'drone', camOpts: { h: 16, lat: 7, ahead: -4, drift: 6 }, dur: b(0.5) },
  { id: 'c-flyby-desert', level: 'desert-mirage', car: 'thunder', skipTo: OPEN['desert-mirage'][1], cam: 'flyby', camOpts: { side: 1, h: 0.5 }, dur: b(0.5) },
  { id: 'c-chase-palm', level: 'palm-coast', car: 'razor', skipTo: OPEN['palm-coast'][1], attract: 3, dur: b(0.5), boost: true },
  { id: 'c-low-harbor', level: 'harbor-docks', car: 'vortex', skipTo: OPEN['harbor-docks'][1], cam: 'lowfront', camOpts: { ahead: 7, lat: 2, h: 0.5 }, dur: b(0.5) },
  { id: 'feat-browser', level: 'orbit-run', car: 'aurum', skipTo: OPEN['orbit-run'][1], attract: 3, dur: b(1.5), feature: 'PLAY IN YOUR BROWSER', featureSub: 'PC & MOBILE · NO DOWNLOAD', flash: 0.4, boost: true },

  // End card.
  { id: 'end', level: 'neon-skyway', car: 'aurum', skipTo: OPEN['neon-skyway'][1], cam: 'crane', camOpts: { back0: 8, h0: 1.6, back1: 46, h1: 26 }, dur: b(3), logo: true, end: true, fadeOut: true, flash: 0.6 },
];

export const TOTAL = TIMELINE.reduce((s, x) => s + Math.round(x.dur * FPS), 0) / FPS;
