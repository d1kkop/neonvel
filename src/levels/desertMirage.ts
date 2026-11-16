import * as THREE from 'three';
import { makeFrame } from '../track/Track';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { createCacti, createMesas } from '../world/props/LevelProps';
import { fbm2, Terrain } from '../world/terrain/Terrain';
import type { LevelDef } from './types';

export const desertMirage: LevelDef = {
  id: 'desert-mirage',
  name: 'Desert Mirage',
  tagline: 'Sunset highway between mesas and wireframe mountains.',
  cardColors: ['#ff6a3c', '#5a1a6a'],
  time: 'dusk',
  seed: 777,
  track: {
    points: [[0, 0], [600, -50], [1000, 150], [1050, 450], [800, 600], [500, 500], [300, 700], [-100, 650], [-300, 400], [-200, 150]],
    length: 3000, height: 2, width: 18, lanes: 4, pillars: false,
    hills: [[3, 8, 1.0], [7, 2, 0.3]], // rolling over the dunes
    sections: [
      { type: 'tunnel', start: 900, end: 1060 },
      { type: 'canopy', start: 2200, end: 2340 },
    ],
  },
  sky: {
    top: '#1a0638', mid: '#7a1a6a', horizon: '#ff8a3c', sunA: '#ffe14d', sunB: '#ff2a6a',
    sunSize: 0.2, sunIntensity: 2.6, sunStripes: 1, stars: 0.5, dayClouds: 0,
  },
  atmosphere: { fogColor: '#6a2a5a', fogDensity: 0.0006, hazeColor: '#ff7a4a', hazeTop: 30, hazeStrength: 0.35, overcastColor: '#5a4050' },
  lighting: {
    hemiSky: '#a05aff', hemiGround: '#ff8a4a', hemiIntensity: 0.9, sunColor: '#ffae6a', sunIntensity: 1.6,
    sunDir: [0.0, 0.08, -1], exposure: 1.05, bloom: { strength: 0.3, radius: 0.35, threshold: 1.1 },
    env: { top: '#1a0638', horizon: '#ff8a3c', ground: '#7a3a2a', panels: ['#ff2bd6', '#ffb000', '#ff6a3c', '#ffffff'] },
  },
  road: {
    lampsOn: true, leftNeon: '#ff2bd6', rightNeon: '#ffb000', leftLamp: '#ffb36b', rightLamp: '#ff8ad8',
    neonIntensity: 0.9, asphalt: '#3a3036', reflect: 0.45, wetness: 0.15, concrete: '#8a5a4a', wallStyle: 'guardrail', railColor: '#9a8a7a',
  },
  weathers: ['clear', 'rain', 'storm'],
  defaultWeather: 'clear',
  billboards: designs('overdrive', 'driveFast', 'miami2084', 'summer86', 'coconutTan', 'turboCola', 'neonNights', 'synthFm', 'tropicNights', 'miamiHeat'),
  ambience: 'desert',
  music: 'turbo-chase',
  build(ctx) {
    const { track, scene } = ctx;
    const rng = new Rng(ctx.seed);
    // Dunes near the road, rising to big synthwave wireframe mountains far away.
    const terrain = new Terrain(track, {
      cell: ctx.quality === 'low' ? 20 : 15,
      margin: 1800,
      height: (x, z, d, _inside, ry) => {
        if (d < 14) return ry - 0.6;
        const dunes = fbm2(x * 0.006, z * 0.006, 3) * 10 * Math.min(1, (d - 14) / 60);
        const mountains = THREE.MathUtils.smoothstep(d, 700, 1500) * (120 + 280 * fbm2(x * 0.0025, z * 0.0025, 4, 5));
        return ry - 0.6 + dunes + mountains;
      },
      palette: { low: '#c8743a', mid: '#a8502e', high: '#2a0a3a', steep: '#7a3a2a', midAt: 20, highAt: 90, lines: { color: '#ff2bd6', spacing: 24, strength: 1.4, fromHeight: 30 } },
    });
    scene.add(terrain.mesh);

    const frame = makeFrame();
    const mesas: { x: number; y: number; z: number; r: number; h: number; yaw: number }[] = [];
    for (let i = 0; i < 400 && mesas.length < 36; i++) {
      const x = rng.range(-900, 1700), z = rng.range(-700, 1300);
      let near = Infinity;
      for (let k = 0; k < track.samples.length; k += 6) near = Math.min(near, Math.hypot(track.samples[k].x - x, track.samples[k].z - z));
      const r = rng.range(25, 70);
      if (near < r + 40 || near > 650) continue;
      mesas.push({ x, y: terrain.heightAt(x, z) - 3, z, r, h: rng.range(35, 110), yaw: rng.range(0, 6.28) });
    }
    scene.add(createMesas(mesas));

    const cacti = [];
    for (let d = 0; d < track.length; d += 9) {
      if (track.sectionAt(d, 10) || rng.chance(0.5)) continue;
      track.frameAt(d, frame);
      const side = rng.chance(0.5) ? 1 : -1;
      const lat = side * (track.width / 2 + rng.range(5, 90));
      const x = frame.position.x + frame.right.x * lat, z = frame.position.z + frame.right.z * lat;
      cacti.push({ x, y: terrain.heightAt(x, z) - 0.3, z, yaw: rng.range(0, 6.28), scale: rng.range(0.7, 1.5) });
    }
    scene.add(createCacti(cacti));
    return {};
  },
};
