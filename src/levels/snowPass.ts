import * as THREE from 'three';
import { makeFrame } from '../track/Track';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { createSnowObjects, createSnowTrees, SnowObject, TreeKind, TreePlacement } from '../world/props/SnowProps';
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
      cell: ctx.quality === 'low' ? 20 : 14, subdiv: ctx.quality === 'low' ? 1 : ctx.quality === 'medium' ? 2 : 3,
      margin: 1500,
      height: (x, z, d, _inside, ry) => {
        if (d < 14) return ry - 0.6;
        const t = THREE.MathUtils.smoothstep(d, 14, 260);
        const ridge = fbm2(x * 0.004, z * 0.004, 5, 3);
        return ry - 0.6 + t * (60 + 340 * ridge * ridge) + (fbm2(x * 0.03, z * 0.03, 2) - 0.5) * 6 * t;
      },
      palette: { low: '#eef2fa', mid: '#e4ecf7', high: '#ffffff', steep: '#4a4e5a', midAt: roadY + 40, highAt: roadY + 160, snow: { shadow: '#4c5f8e', sparkle: 1 } },
    });
    scene.add(terrain.mesh);

    // Forest: groves of mixed species (spruce / fir / young pines, birch stands in the hollows), thinning with
    // altitude; every tree its own size, lean, stretch, tint and snow load. Far trees use the low-detail shapes.
    const trees: TreePlacement[] = [];
    const rocks: SnowObject[] = [];
    const balls: SnowObject[] = [];
    const drifts: SnowObject[] = [];
    const snowmen: SnowObject[] = [];
    const frame = makeFrame();
    const hw = track.width / 2;
    for (let d = 0; d < track.length; d += 4) {
      if (track.sectionAt(d, 25)) continue;
      track.frameAt(d, frame);
      for (let k = 0; k < 3; k++) {
        const side = rng.chance(0.5) ? 1 : -1;
        const off = rng.range(5, 170);
        const lat = side * (hw + off);
        const x = frame.position.x + frame.right.x * lat, z = frame.position.z + frame.right.z * lat;
        const grove = fbm2(x * 0.012, z * 0.012, 3, 7);
        if (grove < 0.38 && rng.chance(0.7)) continue; // clearings
        const y = terrain.heightAt(x, z);
        const alt = y - roadY;
        if (alt > 150) continue;
        const mix = fbm2(x * 0.02 + 40, z * 0.02, 2, 11);
        let kind: TreeKind = mix > 0.62 ? 'fir' : 'spruce';
        if (rng.chance(0.14)) kind = 'young';
        if (mix < 0.33 && alt < 40 && rng.chance(0.55)) kind = 'birch';
        const high = THREE.MathUtils.smoothstep(alt, 40, 150);
        trees.push({
          x, y: y - 0.3, z, kind, yaw: rng.range(0, 6.28),
          scale: rng.range(0.7, 1.45) * (1 - high * 0.35) * (kind === 'young' ? rng.range(0.6, 1.2) : 1),
          stretch: rng.range(0.85, 1.25), lean: rng.range(-0.06, 0.06), snow: THREE.MathUtils.clamp(rng.range(0.3, 1) + high * 0.4, 0, 1),
          far: off > 70,
        });
      }
      // Rocks breaking through the snow on the slopes.
      if (rng.chance(0.35)) {
        const side = rng.chance(0.5) ? 1 : -1;
        const lat = side * (hw + rng.range(8, 120));
        const x = frame.position.x + frame.right.x * lat, z = frame.position.z + frame.right.z * lat;
        const sc = rng.range(0.8, 3.6);
        rocks.push({ x, y: terrain.heightAt(x, z) - sc * 0.35, z, yaw: rng.range(0, 6.28), sx: sc * rng.range(0.9, 1.6), sy: sc * rng.range(0.5, 0.9), sz: sc });
      }
    }
    // Along the road (behind the snowbanks): drifts, snowballs in little groups, the odd snowman facing the road.
    for (let d = 0; d < track.length; d += 9) {
      if (track.sectionAt(d, 20)) continue;
      track.frameAt(d, frame);
      for (const side of [-1, 1]) {
        const lat = side * (hw + rng.range(2.5, 6));
        const x = frame.position.x + frame.right.x * lat, z = frame.position.z + frame.right.z * lat;
        const sx = rng.range(2.5, 6);
        drifts.push({ x, y: terrain.heightAt(x, z) - 0.5, z, yaw: Math.atan2(frame.forward.x, frame.forward.z) + rng.range(-0.3, 0.3), sx: sx * 0.6, sy: rng.range(0.6, 1.3), sz: sx });
      }
      if (rng.chance(0.3)) {
        const side = rng.chance(0.5) ? 1 : -1;
        const base = side * (hw + rng.range(5, 18));
        const n = 1 + Math.floor(rng.range(0, 4));
        for (let i = 0; i < n; i++) {
          const lat = base + rng.range(-2, 2);
          const fwd = rng.range(-2.5, 2.5);
          const x = frame.position.x + frame.right.x * lat + frame.forward.x * fwd, z = frame.position.z + frame.right.z * lat + frame.forward.z * fwd;
          const r = rng.range(0.25, 1.1);
          balls.push({ x, y: terrain.heightAt(x, z) + r * 0.75, z, yaw: rng.range(0, 6.28), sx: r, sy: r * 0.92, sz: r });
        }
      }
      if (d % 207 < 9) {
        const side = rng.chance(0.5) ? 1 : -1;
        const lat = side * (hw + rng.range(6, 12));
        const x = frame.position.x + frame.right.x * lat, z = frame.position.z + frame.right.z * lat;
        // Face the road: local +Z points back toward the track centre.
        const yaw = Math.atan2(-frame.right.x * side, -frame.right.z * side) + rng.range(-0.5, 0.5);
        const sc = rng.range(0.9, 1.3);
        snowmen.push({ x, y: terrain.heightAt(x, z) - 0.15, z, yaw, sx: sc, sy: sc, sz: sc });
      }
    }
    scene.add(createSnowTrees(trees));
    scene.add(createSnowObjects({ balls, drifts, snowmen, rocks }));
    return {};
  },
};
