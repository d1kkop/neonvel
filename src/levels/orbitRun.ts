import * as THREE from 'three';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { createAsteroids, createPlanet, Placement } from '../world/props/LevelProps';
import { AlienCyclist, FloatingRoadster, RocketFlyby } from '../world/props/SpaceVisitors';
import type { LevelDef } from './types';

export const orbitRun: LevelDef = {
  id: 'orbit-run',
  name: 'Orbit Run',
  tagline: 'A track floating between planets and asteroid fields.',
  cardColors: ['#05010f', '#a64dff'],
  time: 'night',
  seed: 4040,
  track: {
    points: [[0, 0], [400, -200], [900, -100], [1000, 300], [700, 500], [800, 800], [400, 900], [0, 700], [-200, 400]],
    length: 3000, height: 0, width: 18, lanes: 4, pillars: false,
    sections: [
      { type: 'canopy', start: 250, end: 520 },
      { type: 'tunnel', start: 1300, end: 1460 },
      { type: 'canopy', start: 2300, end: 2500 },
    ],
  },
  sky: {
    top: '#010008', mid: '#05001a', horizon: '#10002a', sunA: '#ffffff', sunB: '#fff0c0',
    sunSize: 0.035, sunIntensity: 9, sunStripes: 0, stars: 1, dayClouds: 0, nebula: 1,
  },
  atmosphere: { fogColor: '#05001a', fogDensity: 0.00012, hazeColor: '#000000', hazeTop: -1e4, hazeStrength: 0, overcastColor: '#2a1050' },
  lighting: {
    hemiSky: '#5a4aff', hemiGround: '#0a0020', hemiIntensity: 0.35, sunColor: '#ffffff', sunIntensity: 1.3,
    sunDir: [0.7, 0.3, -0.6], exposure: 1.1, bloom: { strength: 0.4, radius: 0.4, threshold: 1.3 },
    env: { top: '#010008', horizon: '#3a1a6a', ground: '#010008', panels: ['#ffffff', '#a64dff', '#00e5ff', '#ffffff'] },
  },
  road: {
    lampsOn: false, leftNeon: '#00e5ff', rightNeon: '#a64dff', leftLamp: '#bfe8ff', rightLamp: '#d8b8ff',
    neonIntensity: 1.4, asphalt: '#1a1a24', reflect: 0.8, wetness: 0.7, concrete: '#2a2a38', wallStyle: 'glass', lampStyle: 'none', railColor: '#a0c8ff',
  },
  weathers: ['clear', 'fog'],
  defaultWeather: 'clear',
  billboards: designs('overdrive', 'synthFm', 'cyberBeach', 'neonNights', 'driveFast', 'turboCola', 'tropicNights', 'palmFm'),
  ambience: 'space',
  music: 'deep-dive',
  build(ctx) {
    const { track, scene } = ctx;
    const rng = new Rng(ctx.seed);
    scene.add(createPlanet(new THREE.Vector3(2600, 500, -3200), 900, '#d89a5a', '#7a4a2a', true));
    scene.add(createPlanet(new THREE.Vector3(-2400, -300, 1800), 320, '#4a8ad8', '#e8f4ff'));
    scene.add(createPlanet(new THREE.Vector3(600, 1300, 2600), 140, '#8a8a90', '#5a5a60'));

    // Asteroid belt around (and below / above) the track.
    const rocks: Placement[] = [];
    for (let i = 0; i < 900; i++) {
      const x = rng.range(-1100, 1900), z = rng.range(-1000, 1800);
      const d2 = track.distanceSqTo(x, z);
      const y = rng.range(-260, 220);
      if (d2 < 45 * 45 && Math.abs(y) < 40) continue;
      rocks.push({ x, y, z, yaw: rng.range(0, 6.28), scale: rng.range(1.5, 22) * (rng.chance(0.05) ? 3 : 1) });
    }
    scene.add(createAsteroids(rocks));

    // Space-station rings around the road at intervals.
    const ringGeo = new THREE.TorusGeometry(16, 0.9, 10, 48);
    const ringMat = new THREE.MeshStandardMaterial({ color: '#3a3a48', metalness: 0.8, roughness: 0.35 });
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#00e5ff').multiplyScalar(3) });
    const glowGeo = new THREE.TorusGeometry(15.2, 0.15, 6, 48);
    const f = { position: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
    for (let d = 120; d < track.length; d += 210) {
      if (track.sectionAt(d, 20)) continue;
      track.frameAt(d, f);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      const glow = new THREE.Mesh(glowGeo, glowMat);
      for (const m of [ring, glow]) {
        m.position.copy(f.position).setY(f.position.y + 4);
        m.lookAt(f.position.clone().add(f.forward).setY(f.position.y + 4));
        scene.add(m);
      }
    }
    // Visitors: a drifting red roadster with an astronaut, a rocket launch, and an alien on a flying bike.
    const visitors = [new FloatingRoadster(track), new RocketFlyby(track), new AlienCyclist(track)];
    for (const v of visitors) scene.add(v.group);
    ctx.onUpdate((time, dt) => {
      const pl = ctx.player();
      for (const v of visitors) v.update(time, dt, pl);
    });
    return {};
  },
};
