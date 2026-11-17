import * as THREE from 'three';
import { makeFrame } from '../track/Track';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { CoastTerrain, createOcean } from '../world/coast/Coast';
import { createHotels, createLifeguardTowers, createSeagulls, createUmbrellas, Placement } from '../world/props/BeachProps';
import { createPalms, PalmPlacement, palmWind } from '../world/props/Palms';
import type { LevelDef } from './types';

const PASTELS = ['#ffb3c7', '#9fe3e0', '#ffe3a3', '#c7b3ff', '#ffc9a3', '#b3ffd1', '#f7f3ea'].map((c) => new THREE.Color(c));

export const palmCoast: LevelDef = {
  id: 'palm-coast',
  name: 'Palm Coast',
  tagline: 'Pastel hotels and palms while a red sun sinks into the sea.',
  cardColors: ['#ff6a3a', '#7a3aa8'],
  time: 'dusk',
  seed: 4242,
  track: {
    points: [
      [0, 0], [500, -90], [900, 0], [1120, 260], [960, 540], [620, 580],
      [360, 430], [120, 580], [-260, 520], [-400, 250], [-260, 40],
    ],
    length: 3200,
    height: 7,
    hills: [[3, 5, 0.8], [8, 1.2, 2.0]], // coastal climbs (lowest point stays above the beach)
    width: 18,
    lanes: 4,
    pillars: false,
    sections: [
      { type: 'canopy', start: 640, end: 800 },
      { type: 'tunnel', start: 2050, end: 2260 },
    ],
  },
  // Sunset: a big red sun sinking into the sea at the end of the start straight, violet sky overhead,
  // long low orange light with a cool purple fill from the sky side.
  sky: {
    top: '#1c1a52', mid: '#c24e78', horizon: '#ff7a3e', sunA: '#ff3a1c', sunB: '#b00616',
    sunSize: 0.11, sunIntensity: 1.45, sunStripes: 0, stars: 0.15, dayClouds: 0.6, cloudTint: 1,
  },
  atmosphere: {
    fogColor: '#e0846e', fogDensity: 0.0005, hazeColor: '#ff8a5a', hazeTop: 22, hazeStrength: 0.35, overcastColor: '#6a5a6e',
  },
  lighting: {
    hemiSky: '#7c6ac8', hemiGround: '#ff9466', hemiIntensity: 0.95, sunColor: '#ff7038', sunIntensity: 2.3,
    sunDir: [0.93, 0.025, -0.36], exposure: 1.0, bloom: { strength: 0.28, radius: 0.35, threshold: 1.15 },
    env: { top: '#2a2468', horizon: '#ff7a44', ground: '#6a4250', panels: ['#ff8a50', '#ffb07a', '#ff5a6a', '#b0a0ff'] },
  },
  road: {
    lampsOn: true, leftNeon: '#00c8d8', rightNeon: '#ff5fb0', leftLamp: '#ffd2a0', rightLamp: '#ffd2a0',
    neonIntensity: 0.75, asphalt: '#4a4450', reflect: 0.7, wetness: 0.35, concrete: '#efe9df', wallStyle: 'guardrail', lampStyle: 'post', railColor: '#e8ecf2',
  },
  weathers: ['clear', 'rain', 'storm'],
  defaultWeather: 'clear',
  billboards: designs(
    'miamiHeat', 'sunsetClub', 'coconutTan', 'surfParadise', 'summer86', 'bikiniBar', 'palmFm', 'turboCola',
    'tropicNights', 'cyberBeach', 'miami2084', 'driveFast',
  ),
  ambience: 'beach',
  music: 'sunset-boulevard',
  build(ctx) {
    const { track, scene } = ctx;
    const rng = new Rng(ctx.seed);
    const shoulder = track.height - 0.4;
    const terrain = new CoastTerrain(track, {
      shoulder, sand: '#f0dcae', wetSand: '#c2a676', grass: '#5f9f45', hills: 26, cell: ctx.quality === 'low' ? 16 : 12, subdiv: ctx.quality === 'low' ? 1 : ctx.quality === 'medium' ? 2 : 3,
    });
    scene.add(terrain.mesh);
    scene.add(createOcean({ deep: '#1c2f6a', shallow: '#3a7aa6', skyHorizon: '#ff9a6a', level: 0 }));

    const hw = track.width / 2;
    const frame = makeFrame();
    const palms: PalmPlacement[] = [];
    const umbrellas: Placement[] = [];
    const towers: Placement[] = [];
    const hotels: { x: number; y: number; z: number; w: number; h: number; d: number; yaw: number; color: THREE.Color }[] = [];

    // Palm avenue along both sides of the road + umbrellas and towers on the beach side.
    for (let d = 0; d < track.length; d += 16 + rng.range(0, 10)) {
      if (track.sectionAt(d, 15)) continue;
      track.frameAt(d, frame);
      for (const side of [-1, 1]) {
        if (rng.chance(0.25)) continue;
        const lat = side * (hw + rng.range(3.5, 9));
        const x = frame.position.x + frame.right.x * lat;
        const z = frame.position.z + frame.right.z * lat;
        palms.push({ x, y: terrain.heightAt(x, z) - 0.2, z, scale: rng.range(0.8, 1.35), yaw: rng.range(0, Math.PI * 2) });
      }
      // Beach side = outside the loop.
      for (const side of [-1, 1]) {
        const probe = side * (hw + 40);
        const px = frame.position.x + frame.right.x * probe;
        const pz = frame.position.z + frame.right.z * probe;
        if (terrain.inside(px, pz)) continue;
        if (rng.chance(0.55)) {
          const lat = side * (hw + rng.range(22, 75));
          const x = frame.position.x + frame.right.x * lat + rng.range(-6, 6);
          const z = frame.position.z + frame.right.z * lat + rng.range(-6, 6);
          const y = terrain.heightAt(x, z);
          if (y > 0.3) umbrellas.push({ x, y, z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.9, 1.15) });
        }
        if (rng.chance(0.06)) {
          const lat = side * (hw + 55);
          const x = frame.position.x + frame.right.x * lat;
          const z = frame.position.z + frame.right.z * lat;
          const y = terrain.heightAt(x, z);
          if (y > 0.2) towers.push({ x, y, z, yaw: Math.atan2(frame.right.x * side, frame.right.z * side) });
        }
      }
    }

    // Inland: hotels and palm groves on the island.
    for (let i = 0; i < 900 && hotels.length < 140; i++) {
      const x = rng.range(-500, 1200);
      const z = rng.range(-200, 700);
      if (!terrain.inside(x, z)) continue;
      const dist = terrain.distance(x, z);
      const w = rng.range(18, 50), d = rng.range(14, 34);
      if (dist < hw + 30 + Math.hypot(w, d) / 2) continue;
      const tall = rng.chance(0.15);
      const h = tall ? rng.range(45, 110) : rng.range(10, 36);
      // Face the nearest road point.
      const yaw = Math.round(rng.range(-1, 1)) * 0.3;
      const rad = Math.hypot(w, d) / 2;
      if (hotels.some((o) => Math.hypot(o.x - x, o.z - z) < rad + Math.hypot(o.w, o.d) / 2 + 3)) continue;
      hotels.push({ x, y: terrain.heightAt(x, z) - 1, z, w, h, d, yaw, color: rng.pick(PASTELS) });
    }
    for (let i = 0; i < 700; i++) {
      const x = rng.range(-600, 1300);
      const z = rng.range(-300, 800);
      const dist = terrain.distance(x, z);
      if (dist < hw + 12 || dist > 400) continue;
      const y = terrain.heightAt(x, z);
      if (y < 0.8) continue;
      palms.push({ x, y: y - 0.2, z, scale: rng.range(0.7, 1.3), yaw: rng.range(0, Math.PI * 2) });
    }

    palmWind.uWindStrength.value = 1.35; // it's windy at the coast
    scene.add(createPalms(palms));
    if (umbrellas.length) scene.add(createUmbrellas(umbrellas));
    if (towers.length) scene.add(createLifeguardTowers(towers));
    if (hotels.length) scene.add(createHotels(hotels));
    const gulls: THREE.Vector3[] = [];
    for (let i = 0; i < 36; i++) {
      track.frameAt(rng.range(0, track.length), frame);
      const side = rng.chance(0.5) ? 1 : -1;
      gulls.push(frame.position.clone().addScaledVector(frame.right, side * rng.range(40, 160)).setY(rng.range(18, 45)));
    }
    scene.add(createSeagulls(gulls));

    // Rooftop billboards on the lower hotels close to the road.
    const roofSpots = hotels
      .filter((h) => h.h < 30 && terrain.distance(h.x, h.z) < 160)
      .slice(0, 16)
      .map((h) => ({ x: h.x, z: h.z, y: h.y + h.h, w: Math.min(h.w, 30), d: h.d, yaw: h.yaw }));
    return { roofSpots };
  },
};
