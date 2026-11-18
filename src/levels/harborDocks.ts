import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { City } from '../world/City';
import { createOcean } from '../world/coast/Coast';
import { buildHarborYard } from '../world/props/HarborYard';
import { createShips } from '../world/props/LevelProps';
import { Terrain } from '../world/terrain/Terrain';
import type { LevelDef } from './types';

export const harborDocks: LevelDef = {
  id: 'harbor-docks',
  name: 'Harbor Docks',
  tagline: 'Container canyons, cranes and ship lights at night.',
  cardColors: ['#0a2a4a', '#ffb000'],
  time: 'night',
  seed: 3131,
  track: {
    points: [[0, 0], [350, 0], [700, 60], [900, -100], [1150, 0], [1150, 300], [900, 420], [500, 380], [200, 500], [-150, 420], [-250, 180]],
    length: 3000, height: 16, width: 18, lanes: 4, pillars: true,
    hills: [[2, 6, 0.4], [6, 2.2, 1.3]], // the dock highway climbs and dips over the quays
    sections: [
      { type: 'canopy', start: 300, end: 460 },
      { type: 'tunnel', start: 1700, end: 1880 },
    ],
  },
  sky: {
    top: '#02040c', mid: '#0a1a33', horizon: '#ff8a3c', sunA: '#fff1c0', sunB: '#ffb36b',
    sunSize: 0.05, sunIntensity: 2.0, sunStripes: 0, stars: 0.8, dayClouds: 0,
  },
  atmosphere: { fogColor: '#0c1626', fogDensity: 0.0011, hazeColor: '#ff9a4a', hazeTop: 30, hazeStrength: 0.5, overcastColor: '#1a2230' },
  lighting: {
    hemiSky: '#3a5a9a', hemiGround: '#ff9a4a', hemiIntensity: 0.55, sunColor: '#9ab8ff', sunIntensity: 0.5,
    sunDir: [0.4, 0.3, -0.8], exposure: 1.15, bloom: { strength: 0.35, radius: 0.35, threshold: 1.1 },
    env: { top: '#02040c', horizon: '#ff8a3c', ground: '#1a2a3a', panels: ['#ffb000', '#ffd28a', '#ff3b30', '#9ab8ff'] },
  },
  road: {
    lampsOn: true, leftNeon: '#ffb000', rightNeon: '#00e5ff', leftLamp: '#ffae5c', rightLamp: '#ffae5c',
    neonIntensity: 0.8, asphalt: '#2a2a30', reflect: 0.9, wetness: 0.6, concrete: '#3a3a44',
  },
  weathers: ['clear', 'rain', 'storm'],
  defaultWeather: 'rain',
  billboards: designs('turboCola', 'bikiniBar', 'palmFm', 'synthFm', 'driveFast', 'tropicNights', 'hotelParadise', 'overdrive', 'miamiHeat', 'neonNights'),
  ambience: 'harbor',
  music: 'neon-drive',
  build(ctx) {
    const { track, scene } = ctx;
    const rng = new Rng(ctx.seed);
    // Quay level inside the loop and along the road; harbour water outside.
    const terrain = new Terrain(track, {
      cell: 16, subdiv: ctx.quality === 'low' ? 1 : ctx.quality === 'medium' ? 2 : 3, margin: 1500,
      height: (_x, _z, d, inside) => (inside || d < 45 ? 3 : d < 60 ? 3 - (d - 45) : -12),
      palette: { low: '#1a1c22', mid: '#3a3c44', high: '#3a3c44', steep: '#2a2a30', midAt: 0, highAt: 50, ground: 'harbor' },
    });
    scene.add(terrain.mesh);
    scene.add(createOcean({ deep: '#03101e', shallow: '#0a2238', skyHorizon: '#3a2a30', level: 0, night: true }));

    // The container terminal: stacks under floodlight masts, quay cranes unloading ships, yard cranes over the
    // rows, conveyor belts and robot carriers (see HarborYard.ts).
    const yard = buildHarborYard(track, rng, ctx.quality);
    scene.add(yard.group);
    scene.add(createShips(yard.ships));
    ctx.onUpdate((time) => yard.update(time));

    // City skyline behind the docks.
    const city = new City(track, ctx.seed, { minDist: 650, margin: 1600 });
    scene.add(city.group);
    return { searchlights: city.searchlightSpots.slice(0, 6), noBoards: yard.noBoards };
  },
};
