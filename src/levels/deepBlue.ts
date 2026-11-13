import * as THREE from 'three';
import { makeFrame } from '../track/Track';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { createCoral, createKelp, createWaterSurface, Placement } from '../world/props/LevelProps';
import { fbm2, Terrain } from '../world/terrain/Terrain';
import { createLampBeams } from '../world/weather/Beams';
import { CirclingSharks, DolphinPod, FishSchools } from '../world/props/SeaLife';
import type { LevelDef } from './types';

const SURFACE = 150;

export const deepBlue: LevelDef = {
  id: 'deep-blue',
  name: 'Deep Blue',
  tagline: 'Underwater highway between kelp forests — mind the sharks.',
  cardColors: ['#003a5a', '#00c8a8'],
  time: 'day',
  seed: 2020,
  track: {
    points: [[0, 0], [450, -60], [800, 100], [850, 450], [550, 650], [200, 560], [-150, 700], [-350, 450], [-250, 150]],
    length: 2900, height: 34, width: 18, lanes: 4, pillars: true,
    sections: [
      { type: 'canopy', start: 200, end: 520 },
      { type: 'canopy', start: 1100, end: 1300 },
      { type: 'tunnel', start: 1800, end: 1980 },
      { type: 'canopy', start: 2400, end: 2650 },
    ],
  },
  sky: {
    top: '#0a6a8a', mid: '#0a4a6a', horizon: '#06304a', sunA: '#e8ffff', sunB: '#8ae8ff',
    sunSize: 0.12, sunIntensity: 1.6, sunStripes: 0, stars: 0, dayClouds: 0,
  },
  atmosphere: {
    fogColor: '#05354a', fogDensity: 0.0042, hazeColor: '#0a5a6a', hazeTop: 12, hazeStrength: 0.35, overcastColor: '#0a2a30', caustics: 0.55,
  },
  lighting: {
    hemiSky: '#6ad8e8', hemiGround: '#0a3a4a', hemiIntensity: 0.9, sunColor: '#bff4ff', sunIntensity: 1.2,
    sunDir: [0.1, 1, 0.2], exposure: 1.1, bloom: { strength: 0.3, radius: 0.4, threshold: 1.1 },
    env: { top: '#3ad8e8', horizon: '#0a4a6a', ground: '#052a3a', panels: ['#bff4ff', '#00c8a8', '#ffffff', '#3ad8e8'] },
  },
  road: {
    lampsOn: true, leftNeon: '#00ffd0', rightNeon: '#ff6ad5', leftLamp: '#9af0ff', rightLamp: '#9af0ff',
    neonIntensity: 1.2, asphalt: '#2a3a44', reflect: 0.5, wetness: 0.9, concrete: '#3a5a66', wallStyle: 'glass', railColor: '#7af0ff',
  },
  weathers: ['clear', 'rain', 'fog', 'storm'],
  defaultWeather: 'rain',
  precipitation: 'bubbles',
  billboards: designs('surfParadise', 'sunsetClub', 'cyberBeach', 'coconutTan', 'summer86', 'bikiniBar', 'miamiHeat', 'palmFm'),
  ambience: 'underwater',
  music: 'deep-dive',
  build(ctx) {
    const { track, scene } = ctx;
    const rng = new Rng(ctx.seed);
    const seabed = new Terrain(track, {
      cell: ctx.quality === 'low' ? 20 : 14,
      margin: 900,
      height: (x, z, d) => {
        const dunes = fbm2(x * 0.008, z * 0.008, 4) * 14;
        const canyon = THREE.MathUtils.smoothstep(d, 200, 600) * fbm2(x * 0.003, z * 0.003, 3, 9) * 90;
        return -2 + dunes + canyon;
      },
      palette: { low: '#c8b890', mid: '#a89870', high: '#5a6a5a', steep: '#4a4a44', midAt: 10, highAt: 50 },
    });
    scene.add(seabed.mesh);
    scene.add(createWaterSurface(SURFACE, '#2ab8d0'));

    // God rays from the surface.
    const rays = [];
    for (let i = 0; i < 70; i++) {
      rays.push({ pos: new THREE.Vector3(rng.range(-600, 1300), SURFACE, rng.range(-400, 1100)), color: new THREE.Color('#9af0ff') });
    }
    scene.add(createLampBeams(rays, 22, SURFACE + 20, 0.9));

    // Kelp forests and coral on the seabed.
    const kelp: Placement[] = [];
    const coral: Placement[] = [];
    const frame = makeFrame();
    for (let d = 0; d < track.length; d += 6) {
      track.frameAt(d, frame);
      for (let k = 0; k < 2; k++) {
        const side = rng.chance(0.5) ? 1 : -1;
        const lat = side * (track.width / 2 + rng.range(6, 140));
        const x = frame.position.x + frame.right.x * lat, z = frame.position.z + frame.right.z * lat;
        const y = seabed.heightAt(x, z);
        if (rng.chance(0.55)) kelp.push({ x, y, z, yaw: rng.range(0, 6.28), scale: rng.range(0.7, 1.6) });
        else coral.push({ x, y, z, yaw: rng.range(0, 6.28), scale: rng.range(0.8, 2.2) });
      }
    }
    scene.add(createKelp(kelp));
    scene.add(createCoral(coral));

    // Huge sharks circling just beside the highway (paths never cross the road), spread around the
    // loop; only one is shown at a time (see CirclingSharks).
    const paths = [];
    const hw = track.width / 2;
    const SHARKS = 6;
    for (let tries = 0; tries < 600 && paths.length < SHARKS; tries++) {
      track.frameAt((paths.length + rng.range(0, 0.7)) * (track.length / SHARKS), frame);
      const side = rng.chance(0.5) ? 1 : -1;
      const scale = rng.range(26, 38);
      const L = rng.range(50, 85);
      const radius = L - hw - rng.range(8, 12) - scale * 0.12; // closest approach just outside the barrier
      const c = frame.position.clone().addScaledVector(frame.right, side * L);
      let ok = radius > 15;
      for (let k = 0; k < 16 && ok; k++) {
        const a = (k / 16) * Math.PI * 2;
        if (track.distanceSqTo(c.x + Math.cos(a) * radius, c.z + Math.sin(a) * radius) < (hw + 6 + scale * 0.1) ** 2) ok = false;
      }
      if (!ok) continue;
      c.y = track.height + rng.range(-8, 14);
      paths.push({ centre: c, radius, speed: rng.range(7, 11), phase: rng.range(0, 6.28), scale });
    }
    const sharks = new CirclingSharks(paths);
    scene.add(sharks.group);

    // Dolphins swim along with you now and then — until a giant shark comes hunting them.
    const pod = new DolphinPod(track, 3.4, 30);
    pod.onArrive = () => ctx.sound?.('dolphin');
    pod.onScare = () => ctx.sound?.('dolphin');
    scene.add(pod.group);

    // Schools of fish everywhere; they bolt from any shark.
    const low = ctx.quality === 'low';
    const fish = new FishSchools(track, low ? 9 : 16, low ? 22 : 36);
    scene.add(fish.mesh);
    const noses = paths.map(() => ({ p: new THREE.Vector3(), d: new THREE.Vector3() }));
    const hunter = { p: new THREE.Vector3(), d: new THREE.Vector3() };
    const threatList: { p: THREE.Vector3; d: THREE.Vector3 }[] = [];
    fish.threats = () => {
      threatList.length = 0;
      sharks.sharks.forEach((sh, i) => {
        if (!sh.mesh.visible) return;
        sh.nose(noses[i].p);
        noses[i].d.copy(sh.dir);
        threatList.push(noses[i]);
      });
      if (pod.hunterNose(hunter.p)) {
        hunter.d.copy(pod.hunter.dir);
        threatList.push(hunter);
      }
      return threatList;
    };
    sharks.preyNear = (p, r) => fish.preyNear(p, r);

    const viewer = new THREE.Vector3();
    ctx.onUpdate((time, dt) => {
      const pl = ctx.player();
      track.frameAt(pl.s, frame);
      viewer.copy(frame.position).addScaledVector(frame.right, pl.x);
      pod.update(time, dt, pl);
      sharks.update(time, dt, viewer, frame.forward, pod.hunting);
      fish.update(time, dt, pl);
    });
    return {};
  },
};
