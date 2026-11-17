import { makeFrame } from '../track/Track';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { City } from '../world/City';
import { createOcean, insideTrack } from '../world/coast/Coast';
import { createContainers, createCranes, createShips, Placement } from '../world/props/LevelProps';
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

    // Container stacks in rows on the quay.
    const containers: Placement[] = [];
    const s = track.samples;
    const nearest = (x: number, z: number) => {
      let b = Infinity;
      for (let k = 0; k < s.length; k += 4) b = Math.min(b, Math.hypot(s[k].x - x, s[k].z - z));
      return b;
    };
    for (let gx = -200; gx < 1150; gx += 16) {
      for (let gz = -50; gz < 420; gz += 34) {
        if (!insideTrack(track, gx, gz) || rng.chance(0.25)) continue;
        if (nearest(gx, gz) < 24) continue;
        const stack = rng.int(1, 4);
        for (let k = 0; k < stack; k++) containers.push({ x: gx, y: 3 + k * 2.65, z: gz, yaw: 0 });
        if (rng.chance(0.5)) for (let k = 0; k < stack; k++) containers.push({ x: gx, y: 3 + k * 2.65, z: gz + 2.6, yaw: 0 });
      }
    }
    scene.add(createContainers(containers));

    // Cranes and ships along the waterfront (outside the loop).
    const frame = makeFrame();
    const cranes: Placement[] = [];
    const ships: Placement[] = [];
    for (let d = 0; d < track.length; d += 70) {
      track.frameAt(d, frame);
      for (const side of [-1, 1]) {
        const probe = side * 55;
        const px = frame.position.x + frame.right.x * probe, pz = frame.position.z + frame.right.z * probe;
        if (insideTrack(track, px, pz)) continue;
        const yaw = Math.atan2(frame.right.x * side, frame.right.z * side);
        if (rng.chance(0.6)) cranes.push({ x: frame.position.x + frame.right.x * side * 46, y: 3, z: frame.position.z + frame.right.z * side * 46, yaw });
        if (rng.chance(0.3)) ships.push({ x: frame.position.x + frame.right.x * side * 110, y: 0, z: frame.position.z + frame.right.z * side * 110, yaw: yaw + Math.PI / 2 });
      }
    }
    scene.add(createCranes(cranes));
    scene.add(createShips(ships));

    // City skyline behind the docks.
    const city = new City(track, ctx.seed, { minDist: 650, margin: 1600 });
    scene.add(city.group);
    return { searchlights: city.searchlightSpots.slice(0, 6) };
  },
};
