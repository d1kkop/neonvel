import * as THREE from 'three';
import { makeFrame } from '../track/Track';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { createPines, Placement } from '../world/props/LevelProps';
import { fbm2, Terrain } from '../world/terrain/Terrain';
import type { LevelDef } from './types';

export const snowPass: LevelDef = {
  id: 'snow-pass',
  name: 'Snow Pass',
  tagline: 'Mountain pass in falling snow under the aurora.',
  cardColors: ['#cfe8ff', '#3a6aa0'],
  time: 'night',
  seed: 9001,
  track: {
    points: [[0, 0], [300, -150], [650, -120], [800, 100], [700, 350], [900, 550], [650, 750], [300, 650], [100, 800], [-200, 650], [-150, 350], [-300, 150]],
    length: 3200, height: 60, width: 18, lanes: 4, pillars: false,
    hills: [[2, 12, 0.4], [5, 4, 1.7]], // mountain pass: long climbs and dips
    sections: [
      { type: 'tunnel', start: 700, end: 900 },
      { type: 'tunnel', start: 1900, end: 2150 },
      { type: 'canopy', start: 2700, end: 2820 },
    ],
  },
  sky: {
    top: '#020611', mid: '#0a1a3a', horizon: '#2a4a7a', sunA: '#e8f4ff', sunB: '#9ab8ff',
    sunSize: 0.07, sunIntensity: 2.2, sunStripes: 0, stars: 1, dayClouds: 0, aurora: 1,
  },
  atmosphere: { fogColor: '#0e1c33', fogDensity: 0.0009, hazeColor: '#8ab0e0', hazeTop: 70, hazeStrength: 0.4, overcastColor: '#3a4a60' },
  lighting: {
    hemiSky: '#6a8ac0', hemiGround: '#c8d8ff', hemiIntensity: 0.75, sunColor: '#bcd4ff', sunIntensity: 0.9,
    sunDir: [-0.3, 0.45, -0.8], exposure: 1.1, bloom: { strength: 0.3, radius: 0.35, threshold: 1.15 },
    env: { top: '#020611', horizon: '#3dff9e', ground: '#c8d8ff', panels: ['#e8f4ff', '#3dff9e', '#a64dff', '#ffffff'] },
  },
  road: {
    lampsOn: true, leftNeon: '#3dff9e', rightNeon: '#a64dff', leftLamp: '#d8e8ff', rightLamp: '#d8e8ff',
    neonIntensity: 0.9, asphalt: '#3a3c46', reflect: 0.6, wetness: 0.55, concrete: '#5a5e6a', wallStyle: 'snowbank',
  },
  weathers: ['clear', 'rain', 'storm'],
  defaultWeather: 'rain',
  precipitation: 'snow',
  billboards: designs('hotelParadise', 'synthFm', 'turboCola', 'neonNights', 'driveFast', 'palmFm', 'overdrive', 'tropicNights'),
  ambience: 'snow',
  music: 'midnight-cruise',
  build(ctx) {
    const { track, scene } = ctx;
    const rng = new Rng(ctx.seed);
    const roadY = track.height;
    // The road runs through a pass: mountains rise steeply on both sides.
    const terrain = new Terrain(track, {
      cell: ctx.quality === 'low' ? 20 : 14,
      margin: 1500,
      height: (x, z, d, _inside, ry) => {
        if (d < 14) return ry - 0.6;
        const t = THREE.MathUtils.smoothstep(d, 14, 260);
        const ridge = fbm2(x * 0.004, z * 0.004, 5, 3);
        return ry - 0.6 + t * (60 + 340 * ridge * ridge) + (fbm2(x * 0.03, z * 0.03, 2) - 0.5) * 6 * t;
      },
      palette: { low: '#e8eef8', mid: '#dfe8f5', high: '#ffffff', steep: '#4a4e5a', midAt: roadY + 40, highAt: roadY + 160 },
    });
    scene.add(terrain.mesh);

    // Pines on the lower slopes.
    const pines: Placement[] = [];
    const frame = makeFrame();
    for (let d = 0; d < track.length; d += 5) {
      if (track.sectionAt(d, 25)) continue;
      track.frameAt(d, frame);
      for (let k = 0; k < 3; k++) {
        const side = rng.chance(0.5) ? 1 : -1;
        const lat = side * (track.width / 2 + rng.range(5, 160));
        const x = frame.position.x + frame.right.x * lat, z = frame.position.z + frame.right.z * lat;
        const y = terrain.heightAt(x, z);
        if (y > roadY + 150) continue;
        pines.push({ x, y: y - 0.5, z, yaw: rng.range(0, 6.28), scale: rng.range(0.8, 1.8) });
      }
    }
    scene.add(createPines(pines));
    return {};
  },
};
