import * as THREE from 'three';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { createFloatingShapes } from '../world/props/LevelProps';
import { Terrain } from '../world/terrain/Terrain';
import type { LevelDef } from './types';

const NEONS = ['#00e5ff', '#ff2bd6', '#a64dff', '#3dff9e', '#ffe14d'].map((c) => new THREE.Color(c));

export const cyberGrid: LevelDef = {
  id: 'cyber-grid',
  name: 'Cyber Grid',
  tagline: 'Pure neon in an endless digital void.',
  cardColors: ['#000000', '#00e5ff'],
  time: 'night',
  seed: 1010,
  track: {
    points: [[0, 0], [500, 0], [700, 200], [500, 400], [700, 600], [400, 800], [0, 700], [-200, 500], [0, 300], [-200, 100]],
    length: 2600, height: 40, width: 18, lanes: 4, pillars: true,
    sections: [
      { type: 'canopy', start: 400, end: 700 },
      { type: 'tunnel', start: 1500, end: 1700 },
      { type: 'canopy', start: 2200, end: 2400 },
    ],
  },
  sky: {
    top: '#000000', mid: '#05001a', horizon: '#ff2bd6', sunA: '#00e5ff', sunB: '#ff2bd6',
    sunSize: 0.12, sunIntensity: 2.5, sunStripes: 1, stars: 0.3, dayClouds: 0, gridHorizon: 1,
  },
  atmosphere: { fogColor: '#05001a', fogDensity: 0.0007, hazeColor: '#3a0060', hazeTop: 20, hazeStrength: 0.4, overcastColor: '#12002a' },
  lighting: {
    hemiSky: '#3a00ff', hemiGround: '#ff2bd6', hemiIntensity: 0.4, sunColor: '#00e5ff', sunIntensity: 0.6,
    sunDir: [0, 0.2, -1], exposure: 1.1, bloom: { strength: 0.45, radius: 0.4, threshold: 1.0 },
    env: { top: '#000000', horizon: '#ff2bd6', ground: '#00e5ff', panels: ['#00e5ff', '#ff2bd6', '#a64dff', '#3dff9e'] },
  },
  road: {
    lampsOn: false, leftNeon: '#00e5ff', rightNeon: '#ff2bd6', leftLamp: '#00e5ff', rightLamp: '#ff2bd6',
    neonIntensity: 1.6, asphalt: '#0a0a14', reflect: 1.1, wetness: 0.9, concrete: '#101020', wallStyle: 'rail', lampStyle: 'none', railColor: '#202040',
  },
  weathers: ['clear', 'rain', 'storm'],
  defaultWeather: 'clear',
  billboards: designs('overdrive', 'synthFm', 'neonNights', 'palmFm', 'tropicNights', 'cyberBeach', 'driveFast', 'miami2084'),
  ambience: 'grid',
  music: 'cyber-pulse',
  build(ctx) {
    const { track, scene } = ctx;
    const rng = new Rng(ctx.seed);
    // Flat black floor with a glowing grid.
    const floor = new Terrain(track, {
      cell: 40, margin: 2000,
      height: () => 0,
      palette: { low: '#020008', mid: '#020008', high: '#020008', steep: '#020008', midAt: 100, highAt: 200, lines: { color: '#00e5ff', spacing: 30, strength: 2.2, fromHeight: -1e4 } },
    });
    scene.add(floor.mesh);

    const shapes = [];
    for (let i = 0; i < 260; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(80, 900);
      const cx = 250 + Math.cos(a) * r, cz = 400 + Math.sin(a) * r;
      if (track.distanceSqTo(cx, cz) < 60 * 60) continue;
      shapes.push({ x: cx, y: rng.range(10, 160), z: cz, scale: rng.range(3, 18), color: rng.pick(NEONS), kind: rng.int(0, 3) });
    }
    scene.add(createFloatingShapes(shapes));
    return {};
  },
};
