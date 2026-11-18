import * as THREE from 'three';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { makeFrame } from '../track/Track';
import { type CodePanel, createCodePanels, createTrojanHorse, VirusWorm } from '../world/props/CyberProps';
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

    // --- Falling code: screens in the air along the road, gates of code over it, and code towers far away.
    const GREEN = new THREE.Color('#3dff9e'), CYAN = new THREE.Color('#00e5ff'), PINK = new THREE.Color('#ff2bd6');
    const panels: CodePanel[] = [];
    const f = makeFrame();
    const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz); // a panel's face (+Z) turned toward (dx, dz)
    for (let d = 60; d < track.length; d += 85) {
      if (track.sectionAt(d, 25)) continue;
      track.frameAt(d, f);
      const kind = rng.int(0, 3);
      if (kind === 0) {
        // A gate of code right over the road, facing the driver (see-through: it only adds light).
        panels.push({ x: f.position.x, y: f.position.y + 15, z: f.position.z, w: track.width + 10, h: 12, yaw: yawOf(-f.forward.x, -f.forward.z), glyph: 0.9, color: GREEN.clone().multiplyScalar(0.8) });
      } else {
        // A screen beside the road: half of them face the driver, half run along the road like a wall of code.
        const side = rng.chance(0.5) ? 1 : -1;
        const lat = side * (track.width / 2 + rng.range(9, 34));
        const w = rng.range(10, 20), h = rng.range(14, 34);
        const along = kind === 1;
        panels.push({
          x: f.position.x + f.right.x * lat, y: f.position.y + rng.range(3, 12) + h / 2, z: f.position.z + f.right.z * lat,
          w, h, yaw: along ? yawOf(f.right.x * -side, f.right.z * -side) : yawOf(-f.forward.x, -f.forward.z),
          glyph: rng.range(0.7, 1.3), color: (rng.chance(0.75) ? GREEN : rng.chance(0.5) ? CYAN : PINK).clone().multiplyScalar(0.9),
        });
      }
    }
    for (let i = 0; i < 46; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(260, 1500);
      const x = 250 + Math.cos(a) * r, z = 400 + Math.sin(a) * r;
      if (track.distanceSqTo(x, z) < 120 * 120) continue;
      const h = rng.range(160, 520), w = rng.range(26, 70);
      panels.push({ x, y: h / 2, z, w, h, yaw: rng.range(0, Math.PI), glyph: rng.range(5, 9), color: (rng.chance(0.8) ? GREEN : CYAN).clone().multiplyScalar(0.55) });
    }
    scene.add(createCodePanels(panels));

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
      new VirusWorm(new THREE.Vector3(250, track.height, 400), 330, 62, '#ff2a4a', 3.2),
      new VirusWorm(new THREE.Vector3(330, track.height, 330), 190, 36, '#3dff9e', 1.9),
    ];
    for (const w of worms) scene.add(w.group);
    ctx.onUpdate((time) => { worms[0].update(time); worms[1].update(time * 1.3 + 40); });
    return {};
  },
};
