// Clean clips for editing in CapCut / Resolve: no captions, no flashes, 5 s each (cut them shorter yourself).
// Same cameras as the promo (timeline.mjs); OPEN stretches keep the high shots clear of roofs.
const OPEN = {
  'neon-skyway': [700, 1450, 2120], 'palm-coast': [950, 1450, 2350], 'desert-mirage': [150, 1150, 1650], 'harbor-docks': [560, 1100],
  'snow-pass': [980, 2200], 'cyber-grid': [760, 1760], 'orbit-run': [580, 1560, 1900], 'deep-blue': [560, 1360, 2020],
};
const D = 5;
export const CLIPS = [
  // Cars up close.
  { id: 'car-aurum-wheel', level: 'neon-skyway', car: 'aurum', skipTo: OPEN['neon-skyway'][0], cam: 'detail', camOpts: { a0: 1.45, speed: 0.22, r: 2.3, h: 0.32, lookH: 0.35, focus: 1.2 }, dur: D },
  { id: 'car-aurum-front', level: 'neon-skyway', car: 'aurum', cam: 'detail', camOpts: { a0: 0.35, speed: -0.15, r: 2.8, h: 0.5, lookH: 0.5, focus: 1.9, fov: 30 }, dur: D },
  { id: 'car-aurum-rear', level: 'neon-skyway', car: 'aurum', cam: 'detail', camOpts: { a0: 3.0, speed: 0.18, r: 3.3, h: 0.75, lookH: 0.7, focus: -1.6, fov: 36 }, dur: D },
  { id: 'car-aurum-orbit', level: 'neon-skyway', car: 'aurum', cam: 'orbit', camOpts: { a0: 0.9, speed: 0.45 }, dur: D },
  { id: 'car-phantom-orbit', level: 'deep-blue', car: 'phantom', skipTo: OPEN['deep-blue'][1], cam: 'orbit', camOpts: { a0: -0.8, speed: -0.4, r: 5.6, fov: 44 }, dur: D },
  { id: 'car-razor-orbit', level: 'palm-coast', car: 'razor', skipTo: OPEN['palm-coast'][0], cam: 'orbit', camOpts: { a0: 2.4, speed: 0.35, r: 5.6, fov: 44 }, dur: D },
  { id: 'car-thunder-orbit', level: 'desert-mirage', car: 'thunder', skipTo: OPEN['desert-mirage'][1], cam: 'orbit', camOpts: { a0: -2.2, speed: -0.35, r: 5.6, fov: 44 }, dur: D },
  { id: 'car-cruiser-orbit', level: 'neon-skyway', car: 'cruiser', skipTo: OPEN['neon-skyway'][2], cam: 'orbit', camOpts: { a0: 1.8, speed: 0.4 }, dur: D },
  // Worlds, several perspectives each.
  { id: 'skyway-chase', level: 'neon-skyway', car: 'aurum', skipTo: OPEN['neon-skyway'][1], attract: 3, dur: D, boost: true },
  { id: 'skyway-low', level: 'neon-skyway', car: 'aurum', skipTo: OPEN['neon-skyway'][2], cam: 'lowfront', camOpts: { ahead: 9, lat: 2, h: 0.5 }, dur: D },
  { id: 'skyway-flyby', level: 'neon-skyway', car: 'aurum', skipTo: OPEN['neon-skyway'][0], cam: 'flyby', camOpts: { side: -1, h: 0.8, lead: 110 }, dur: D },
  { id: 'palm-crane', level: 'palm-coast', car: 'razor', skipTo: OPEN['palm-coast'][1], cam: 'crane', camOpts: { back0: 70, h0: 42, lat: 22, back1: 9, h1: 2.2 }, dur: D },
  { id: 'palm-flyby', level: 'palm-coast', car: 'razor', skipTo: OPEN['palm-coast'][2], cam: 'flyby', camOpts: { side: 1, h: 0.6, lead: 110 }, dur: D },
  { id: 'palm-chase', level: 'palm-coast', car: 'razor', skipTo: OPEN['palm-coast'][0], attract: 3, dur: D, boost: true },
  { id: 'desert-drone', level: 'desert-mirage', car: 'thunder', skipTo: OPEN['desert-mirage'][1], cam: 'drone', camOpts: { h: 34, lat: 16, ahead: -20, drift: 6 }, dur: D },
  { id: 'desert-flyby', level: 'desert-mirage', car: 'thunder', skipTo: OPEN['desert-mirage'][2], cam: 'flyby', camOpts: { side: -1, h: 0.7, lead: 110 }, dur: D },
  { id: 'desert-chase', level: 'desert-mirage', car: 'thunder', skipTo: OPEN['desert-mirage'][0], attract: 3, dur: D, boost: true },
  { id: 'ocean-crane', level: 'deep-blue', car: 'phantom', skipTo: OPEN['deep-blue'][0], cam: 'crane', camOpts: { back0: 55, h0: 30, lat: -16, back1: 8, h1: 1.6 }, dur: D },
  { id: 'ocean-drone', level: 'deep-blue', car: 'phantom', skipTo: OPEN['deep-blue'][1], cam: 'drone', camOpts: { h: 22, lat: -10, ahead: -6, drift: 4 }, dur: D },
  { id: 'ocean-chase', level: 'deep-blue', car: 'phantom', skipTo: OPEN['deep-blue'][2], attract: 3, dur: D, boost: true },
  { id: 'space-crane', level: 'orbit-run', car: 'aurum', skipTo: OPEN['orbit-run'][2], cam: 'crane', camOpts: { back0: 50, h0: 30, lat: -14, back1: 9, h1: 2 }, dur: D },
  { id: 'space-low', level: 'orbit-run', car: 'aurum', skipTo: OPEN['orbit-run'][0], cam: 'lowfront', camOpts: { ahead: 7, lat: 1.8, h: 0.45 }, dur: D },
  { id: 'space-chase', level: 'orbit-run', car: 'aurum', skipTo: OPEN['orbit-run'][1], attract: 3, dur: D, boost: true },
  { id: 'harbor-chase', level: 'harbor-docks', car: 'vortex', skipTo: OPEN['harbor-docks'][0], attract: 3, dur: D },
  { id: 'harbor-flyby', level: 'harbor-docks', car: 'vortex', skipTo: OPEN['harbor-docks'][1], cam: 'flyby', camOpts: { side: 1, h: 0.9, lead: 110 }, dur: D },
  { id: 'snow-chase', level: 'snow-pass', car: 'pocket', skipTo: OPEN['snow-pass'][0], attract: 3, dur: D },
  { id: 'snow-low', level: 'snow-pass', car: 'pocket', skipTo: OPEN['snow-pass'][1], cam: 'lowfront', camOpts: { ahead: 8, lat: 2, h: 0.5 }, dur: D },
  { id: 'cyber-chase', level: 'cyber-grid', car: 'velvet', skipTo: OPEN['cyber-grid'][0], attract: 3, dur: D },
  { id: 'cyber-low', level: 'cyber-grid', car: 'velvet', skipTo: OPEN['cyber-grid'][1], cam: 'lowfront', camOpts: { ahead: 8, lat: -2, h: 0.5 }, dur: D },
];
