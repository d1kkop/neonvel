import * as THREE from 'three';
import { makeFrame } from '../track/Track';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { BirdFlock, createScorpions, PerchedEagles, PoleSnakes, type SnakePole, SoaringEagles } from '../world/props/DesertLife';
import { ROAD_STYLE } from '../world/Road';
import { createBoulders, createMesas, createSaguaros, createSmallCacti, mesaTopRadius } from '../world/props/LevelProps';
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
  billboards: designs('duskTillDawn', 'overdrive', 'driveFast', 'miami2084', 'summer86', 'coconutTan', 'turboCola', 'neonNights', 'synthFm', 'tropicNights', 'miamiHeat'),
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
        low: '#c8743a', mid: '#a8502e', high: '#2a0a3a', steep: '#7a3a2a', midAt: 20, highAt: 90, lines: { color: '#ff2bd6', spacing: 24, strength: 1.4, fromHeight: 30, beat: 1, pulse: 1 },
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

    // --- Wildlife. Scorpions on the sand beside the road: one at a time, a good 300 m apart, so you never see
    // more than one. Some scuttle round in a small circle, the rest stand their ground waving their claws.
    const scorpions: { x: number; y: number; z: number; yaw: number; scale: number; walk: number }[] = [];
    for (let d = 140; d < track.length - 100; d += 300 + rng.range(0, 60)) {
      if (track.sectionAt(d, 20)) continue;
      const c = spot(d, 4, 10);
      scorpions.push({ x: c.x, y: terrain.heightAt(c.x, c.z) + 0.02, z: c.z, yaw: rng.range(0, 6.28), scale: rng.range(2.6, 3.4), walk: rng.chance(0.5) ? rng.range(1.2, 2.2) : 0 });
    }
    scene.add(createScorpions(scorpions));

    // Rattlesnakes: three of them round the lap, each coiled round a street-lamp post (the posts stand every
    // 40 m on the barrier, right-hand ones on the 40 m marks, left-hand ones in between).
    const snakePoles: SnakePole[] = [];
    for (let k = 0; k < 3; k++) {
      const side = rng.chance(0.5) ? 1 : -1;
      const sp = ROAD_STYLE.lightSpacing;
      let d = Math.round(((k + 0.55) * track.length) / 3 / sp) * sp + (side < 0 ? sp / 2 : 0);
      for (let tries = 0; tries < 8 && track.sectionAt(d, 45); tries++) d += sp;
      if (track.sectionAt(d, 45)) continue;
      // Its post, and the next post on the other side of the road (20 m further on) that it can leap to.
      const post = (dd: number, sd: number) => {
        track.frameAt(dd, frame);
        const lat = sd * (track.width / 2 + ROAD_STYLE.wallThickness * 0.5);
        return { x: frame.position.x + frame.right.x * lat, y: frame.position.y + ROAD_STYLE.wallHeight, z: frame.position.z + frame.right.z * lat, s: dd };
      };
      snakePoles.push({ ...post(d, side), other: track.sectionAt(d + sp / 2, 8) ? undefined : post(d + sp / 2, -side) });
    }
    const snakes = new PoleSnakes(snakePoles, track.length, () => ctx.sound?.('hiss'));
    scene.add(snakes.group);

    // Eagles: perched right on the edge of four mesa tops, on the side facing the road, heads following the
    // player. The mesas picked are the nearest ones whose top you can still see from the road (looking up at
    // no more than about 35 degrees: close under a tall wall the top is hidden). Two more eagles soar in
    // circles above; a flock of black birds wheels around wherever you are.
    const nearRoad = mesas.map((m) => {
      let best = Infinity, bx = 0, bz = 0;
      for (let k = 0; k < track.samples.length; k += 4) {
        if (track.sectionAt(k * track.sampleStep, 15)) continue; // seen from open road, not from inside a tunnel
        const dd = Math.hypot(track.samples[k].x - m.x, track.samples[k].z - m.z);
        if (dd < best) { best = dd; bx = track.samples[k].x; bz = track.samples[k].z; }
      }
      const gap = best - m.r;
      return { m, gap, steep: m.h / Math.max(gap, 1), dx: (bx - m.x) / best, dz: (bz - m.z) / best, roadS: track.nearestSample(bx, bz) * track.sampleStep };
    }).sort((a, b) => (a.steep > 0.7 ? 1e4 + a.steep : a.gap) - (b.steep > 0.7 ? 1e4 + b.steep : b.gap));
    const perches = nearRoad.slice(0, 4).map(({ m, dx, dz, roadS }) => {
      const r = mesaTopRadius(m, dx, dz) - 1.2;
      return { x: m.x + dx * r, y: m.y + m.h - 0.05, z: m.z + dz * r, yaw: Math.atan2(dx, dz), scale: 6.5, roadS };
    });
    const roadFrame = makeFrame();
    const eagles = new PerchedEagles(perches, track.length, (d, out) => out.copy(track.frameAt(d, roadFrame).position));
    scene.add(eagles.group);
    const soaring = new SoaringEagles(nearRoad.slice(1, 3).map(({ m }) => ({ x: m.x, y: m.y + m.h + 38, z: m.z })));
    scene.add(soaring.group);
    const flock = new BirdFlock(ctx.quality === 'low' ? 26 : 44);
    scene.add(flock.mesh);
    const playerPos = new THREE.Vector3();
    ctx.onUpdate((time, dt) => {
      const pl = ctx.player();
      track.frameAt(pl.s, frame);
      playerPos.copy(frame.position).addScaledVector(frame.right, pl.x);
      flock.update(time, dt, playerPos);
      soaring.update(time);
      eagles.update(time, dt, playerPos, pl.s, pl.v);
      snakes.update(dt, playerPos, pl.s, pl.v);
    });
    return {};
  },
};
