import * as THREE from 'three';
import { makeFrame } from '../track/Track';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { createBoulders, createMesas, createSaguaros, createSmallCacti } from '../world/props/LevelProps';
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
    neonIntensity: 0.9, asphalt: '#3a3036', reflect: 0.75, wetness: 0.35, concrete: '#8a5a4a', wallStyle: 'guardrail', railColor: '#9a8a7a',
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
      cell: ctx.quality === 'low' ? 20 : 15, subdiv: ctx.quality === 'low' ? 1 : ctx.quality === 'medium' ? 2 : 3,
      margin: 1800,
      height: (x, z, d, _inside, ry) => {
        if (d < 14) return ry - 0.6;
        const dunes = fbm2(x * 0.006, z * 0.006, 3) * 10 * Math.min(1, (d - 14) / 60);
        const mountains = THREE.MathUtils.smoothstep(d, 700, 1500) * (120 + 280 * fbm2(x * 0.0025, z * 0.0025, 4, 5));
        return ry - 0.6 + dunes + mountains;
      },
      palette: {
        low: '#c8743a', mid: '#a8502e', high: '#2a0a3a', steep: '#7a3a2a', midAt: 20, highAt: 90, lines: { color: '#ff2bd6', spacing: 24, strength: 1.4, fromHeight: 30, beat: 1 },
        sand: { pale: '#e8a868', dark: '#9a4a2a', ripple: 1 }, ground: 'desert',
      },
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

    // Roadside scatter: a point `lat` metres off the road at distance d, on the terrain.
    const spot = (d: number, latMin: number, latMax: number) => {
      track.frameAt(d, frame);
      const side = rng.chance(0.5) ? 1 : -1;
      const lat = side * (track.width / 2 + rng.range(latMin, latMax));
      const x = frame.position.x + frame.right.x * lat, z = frame.position.z + frame.right.z * lat;
      return { x, z, y: terrain.heightAt(x, z) };
    };
    const farSpot = () => {
      for (let tries = 0; tries < 20; tries++) {
        const x = rng.range(-700, 1500), z = rng.range(-500, 1100);
        let near = Infinity;
        for (let k = 0; k < track.samples.length; k += 8) near = Math.min(near, Math.hypot(track.samples[k].x - x, track.samples[k].z - z));
        if (near > track.width / 2 + 25 && near < 500 && !mesas.some((m) => Math.hypot(m.x - x, m.z - z) < m.r * 1.1)) return { x, z, y: terrain.heightAt(x, z) };
      }
      return null;
    };
    const dense = ctx.quality === 'low' ? 0.6 : 1;

    // Big saguaros (four shapes), near the road and scattered out across the dunes.
    const saguaros: { x: number; y: number; z: number; yaw: number; scale: number; variant: number }[] = [];
    const addSaguaro = (p: { x: number; y: number; z: number } | null) => {
      if (p) saguaros.push({ x: p.x, y: p.y - 0.2, z: p.z, yaw: rng.range(0, 6.28), scale: rng.range(0.8, 1.45), variant: rng.int(0, 3) });
    };
    for (let d = 0; d < track.length; d += 10) {
      if (track.sectionAt(d, 10) || !rng.chance(0.5 * dense)) continue;
      addSaguaro(spot(d, 6, 110));
    }
    for (let i = 0; i < 260 * dense; i++) addSaguaro(farSpot());
    scene.add(createSaguaros(saguaros));

    // Small cacti close to the road: barrel cacti and prickly-pear clumps, often in little groups.
    const barrels: { x: number; y: number; z: number; yaw: number; scale: number }[] = [];
    const pears: { x: number; y: number; z: number; yaw: number; scale: number }[] = [];
    for (let d = 0; d < track.length; d += 6) {
      if (track.sectionAt(d, 8) || !rng.chance(0.55 * dense)) continue;
      const c = spot(d, 3.5, 60);
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const x = c.x + rng.range(-2.5, 2.5), z = c.z + rng.range(-2.5, 2.5);
        const p = { x, y: terrain.heightAt(x, z) - 0.1, z, yaw: rng.range(0, 6.28), scale: rng.range(0.6, 1.4) };
        (rng.chance(0.55) ? barrels : pears).push(p);
      }
    }
    scene.add(createSmallCacti(barrels, pears));

    // Sandstone boulders: clusters of a big one with smaller ones around it, half sunk into the sand.
    const boulders: { x: number; y: number; z: number; yaw: number; scale: number }[] = [];
    const cluster = (c: { x: number; z: number }, big: number) => {
      const n = rng.int(2, 6);
      for (let k = 0; k < n; k++) {
        const s = k === 0 ? big : big * rng.range(0.2, 0.55);
        const x = c.x + (k === 0 ? 0 : rng.range(-1.6, 1.6) * big), z = c.z + (k === 0 ? 0 : rng.range(-1.6, 1.6) * big);
        boulders.push({ x, y: terrain.heightAt(x, z) - s * 0.25, z, yaw: rng.range(0, 6.28), scale: s });
      }
    };
    for (let d = 0; d < track.length; d += 35) {
      if (track.sectionAt(d, 10) || !rng.chance(0.6 * dense)) continue;
      cluster(spot(d, 8, 90), rng.range(0.8, 3.2));
    }
    for (let i = 0; i < 70 * dense; i++) {
      const p = farSpot();
      if (p) cluster(p, rng.range(2, 7));
    }
    // Rock fall at the foot of the mesas.
    for (const m of mesas) {
      for (let k = 0; k < 3; k++) {
        const a = rng.range(0, 6.28), r = m.r * rng.range(1.0, 1.3);
        cluster({ x: m.x + Math.cos(a) * r, z: m.z + Math.sin(a) * r }, rng.range(2.5, 6));
      }
    }
    scene.add(createBoulders(boulders));
    return {};
  },
};
