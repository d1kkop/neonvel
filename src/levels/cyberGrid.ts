import * as THREE from 'three';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { makeFrame } from '../track/Track';
import { createTrojanHorse, Hacker, VirusWorm } from '../world/props/CyberProps';
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
  billboards: designs('matrixCode', 'hackerRanking', 'virusAlert', 'trojanExe', 'overdrive', 'synthFm', 'matrixCode', 'cyberBeach', 'hackerRanking', 'driveFast', 'virusAlert', 'neonNights'),
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

    const f = makeFrame();

    // --- Two Trojan horses standing on the grid floor beside the elevated road, side-on to it.
    const horseAt = (d: number, side: number) => {
      track.frameAt(d, f);
      for (let lat = 70; lat < 220; lat += 15) {
        const x = f.position.x + f.right.x * lat * side, z = f.position.z + f.right.z * lat * side;
        if (track.distanceSqTo(x, z) < 62 * 62) continue;
        const horse = createTrojanHorse();
        horse.scale.setScalar(3.6);
        horse.position.set(x, 0, z);
        horse.rotation.y = Math.atan2(-f.forward.z, f.forward.x); // its nose along the direction of travel
        scene.add(horse);
        return;
      }
    };
    horseAt(980, 1);
    horseAt(2080, -1);

    // --- The worm (and a smaller green one): spiked viruses winding through the air above the track.
    const worms = [
      new VirusWorm(new THREE.Vector3(250, track.height, 400), 330, 34, '#ff2a4a', 4.2),
      new VirusWorm(new THREE.Vector3(330, track.height, 330), 190, 22, '#3dff9e', 2.4),
    ];
    for (const w of worms) scene.add(w.group);
    // The big worm hunts you along the road: it comes up from behind, overtakes low over your head with WORM.EXE
    // over its head, runs on ahead into the fog, then a while later comes round from behind again.
    {
      const wf = makeFrame();
      let rel = -260, wait = 4;
      worms[0].follow = {
        at: (s, out) => {
          track.frameAt(((s % track.length) + track.length) % track.length, wf);
          return out.copy(wf.position)
            .addScaledVector(wf.right, 9 * Math.sin(s * 0.02))
            .addScaledVector(wf.up, 13 + 5 * Math.sin(s * 0.013 + 1));
        },
        headS: (_time, dt) => {
          const pl = ctx.player();
          if (wait > 0) { wait -= dt; if (wait <= 0) rel = -260; }
          else { rel += dt * 24; if (rel > 420) wait = 10; }
          return pl.s + rel;
        },
      };
    }

    // --- Two giant 80s hackers on the grid beside the road, side-on, typing like mad.
    const hackers: Hacker[] = [];
    const hackerAt = (d: number, side: number) => {
      track.frameAt(d, f);
      for (let lat = 70; lat < 220; lat += 12) {
        const x = f.position.x + f.right.x * lat * side, z = f.position.z + f.right.z * lat * side;
        if (track.distanceSqTo(x, z) < 60 * 60) continue;
        const h = new Hacker();
        h.group.scale.setScalar(16);
        h.group.position.set(x, 0, z);
        h.group.rotation.y = Math.atan2(-f.forward.z, f.forward.x); // facing along the direction of travel
        scene.add(h.group);
        hackers.push(h);
        return;
      }
    };
    hackerAt(520, -1);
    hackerAt(1600, 1);
    ctx.onUpdate((time, dt) => { worms[0].update(time, dt); worms[1].update(time * 1.3 + 40); for (const h of hackers) h.update(time); });
    return {};
  },
};
