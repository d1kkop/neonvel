import * as THREE from 'three';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { createAsteroids, createPlanet, Placement } from '../world/props/LevelProps';
import { createSpaceGiants } from '../world/props/SpaceGiants';
import { ShootingStars, Ufo } from '../world/props/SpaceEvents';
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
  weathers: ['clear'],
  defaultWeather: 'clear',
  billboards: designs('overdrive', 'synthFm', 'cyberBeach', 'neonNights', 'driveFast', 'turboCola', 'tropicNights', 'palmFm'),
  ambience: 'space',
  music: 'deep-dive',
  build(ctx) {
    const { track, scene } = ctx;
    const rng = new Rng(ctx.seed);
    // A whole system: two ringed giants (gold, and a huge blue one whose rings cross the sky), a banded giant,
    // a red hypergiant and a few small rocky bodies, spread all around (and above / below) the track.
    const giants = createSpaceGiants(scene);
    scene.add(createPlanet(new THREE.Vector3(700, 1700, -1700), 150, '#b8b4ac', '#6a6660', false, 'rocky', 3.1));
    // (The ringed ice planet that stood here was inside the big banded giant: removed.)
    scene.add(createPlanet(new THREE.Vector3(600, 1300, 2600), 140, '#9a968e', '#5a5850', false, 'rocky', 6.6));
    scene.add(createPlanet(new THREE.Vector3(3700, -200, 1200), 90, '#c8a888', '#6a5040', false, 'rocky', 11.3));
    // Huge blue ringed giant behind the track: its rings lie almost flat about 500 m up and arc across the
    // whole sky over the road.
    const ringPos = new THREE.Vector3(-2400, 500, 1400);
    const ringed = createPlanet(ringPos, 1800, '#a8d0ff', '#24479a', true, 'gas', 9.3, 1);
    ringed.rotation.set(-0.35, 0, 0.05); // cancels the ring's built-in tilt, then a slight lean
    scene.add(ringed);

    // Asteroid belt around (and below / above) the track.
    const rocks: Placement[] = [];
    for (let i = 0; i < 450; i++) {
      const x = rng.range(-1100, 1900), z = rng.range(-1000, 1800);
      const d2 = track.distanceSqTo(x, z);
      const y = rng.range(-260, 220);
      if (d2 < 45 * 45 && Math.abs(y) < 40) continue;
      if (ringPos.distanceToSquared(new THREE.Vector3(x, y, z)) < 1900 * 1900) continue; // not inside the giant
      rocks.push({ x, y, z, yaw: rng.range(0, 6.28), scale: rng.range(1.5, 22) * (rng.chance(0.05) ? 3 : 1) });
    }
    scene.add(createAsteroids(rocks));

    // Space-station rings around the road at intervals.
    const ringGeo = new THREE.TorusGeometry(16, 0.9, 24, 160);
    const ringMat = new THREE.MeshStandardMaterial({ color: '#3a3a48', metalness: 0.8, roughness: 0.35 });
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#00e5ff').multiplyScalar(3) });
    const glowGeo = new THREE.TorusGeometry(15.2, 0.15, 12, 160);
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
    // Visitors: the Roadster (a drifting red roadster with an astronaut), a rocket launch, an alien on a flying
    // bike; shooting stars and huge burning meteors far off in the sky,
    // and a flying saucer that tags along for a while before it shoots off.
    const visitors = [
      new FloatingRoadster(track), new RocketFlyby(track), new AlienCyclist(track),
      new ShootingStars(track), new Ufo(track, { sound: (k) => ctx.sound?.(k) }),
    ];
    for (const v of visitors) scene.add(v.group);
    // The Roadster, the alien on his bike and the saucer fly beside the road, where the billboards stand: near a
    // board they rise and pass over the top of it instead of through it (a smooth hop, 3 m clear).
    const clearBoards = (p: THREE.Vector3, size: number) => {
      for (const b of ctx.boards()) {
        const reach = b.w / 2 + size + 6;
        const d = Math.hypot(p.x - b.pos.x, p.z - b.pos.z);
        if (d >= reach) continue;
        const k = THREE.MathUtils.smoothstep(reach - d, 0, reach * 0.45);
        p.y = Math.max(p.y, THREE.MathUtils.lerp(p.y, b.pos.y + b.h / 2 + size + 3, k));
      }
    };
    ctx.onUpdate((time, dt) => {
      giants(time, dt);
      const pl = ctx.player();
      for (const v of visitors) v.update(time, dt, pl);
      clearBoards(visitors[0].group.position, 5);   // Roadster (with its arrow and name above it)
      clearBoards(visitors[2].group.position, 2);   // alien cyclist
      const craft = visitors[4].group.children[0], glow = visitors[4].group.children[1];
      clearBoards(craft.position, 5);               // saucer
      glow.position.copy(craft.position);
    });
    return {};
  },
};
