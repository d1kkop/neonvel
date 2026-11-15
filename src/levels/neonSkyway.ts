import { City } from '../world/City';
import { createGround } from '../world/Ground';
import { designs } from '../world/billboardArt';
import type { LevelDef } from './types';

export const neonSkyway: LevelDef = {
  id: 'neon-skyway',
  name: 'Neon Skyway',
  tagline: 'An elevated highway through a sleepless megacity.',
  cardColors: ['#2a0a4a', '#ff2bd6'],
  time: 'night',
  seed: 1337,
  track: {
    points: [
      [0, 0], [420, -40], [760, 60], [880, 340], [760, 600], [520, 640],
      [380, 820], [120, 900], [-180, 820], [-260, 600], [-120, 440], [-380, 300],
      [-520, 120], [-360, -20],
    ],
    length: 2800,
    height: 150,
    hills: [[2, 7, 0.3], [5, 2.5, 1.1]], // gentle ramps on the skyway (tests the slope-following road mirror)
    width: 18,
    lanes: 4,
    pillars: true,
    sections: [
      { type: 'canopy', start: 380, end: 640 },
      { type: 'tunnel', start: 1050, end: 1380 },
      { type: 'canopy', start: 1900, end: 2080 },
      { type: 'tunnel', start: 2420, end: 2560 },
    ],
  },
  sky: {
    top: '#05010f', mid: '#2a0a4a', horizon: '#ff3c8e', sunA: '#fff36b', sunB: '#ff2a9a',
    sunSize: 0.16, sunIntensity: 2.2, sunStripes: 1, stars: 1, dayClouds: 0,
  },
  atmosphere: {
    fogColor: '#2a0838', fogDensity: 0.00085, hazeColor: '#d0207a', hazeTop: 110, hazeStrength: 0.92, overcastColor: '#2a1440',
  },
  lighting: {
    hemiSky: '#6a3cff', hemiGround: '#ff2f7a', hemiIntensity: 0.6, sunColor: '#ff9ad8', sunIntensity: 0.5,
    sunDir: [0, 0.25, -1], exposure: 1.1, bloom: { strength: 0.32, radius: 0.3, threshold: 1.15 },
    env: { top: '#05030d', horizon: '#ff3c8e', ground: '#991a59', panels: ['#00e5ff', '#ff2bd6', '#ffae5c', '#ffffff'] },
  },
  road: {
    lampsOn: true, leftNeon: '#00e5ff', rightNeon: '#ff2bd6', leftLamp: '#7fd8ff', rightLamp: '#ffae5c',
    neonIntensity: 1, asphalt: '#292732', reflect: 1, wetness: 0.5, concrete: '#2a2838',
  },
  weathers: ['clear', 'rain', 'fog', 'storm'],
  defaultWeather: 'clear',
  firstWeather: 'storm',
  billboards: designs(
    'neonNights', 'tropicNights', 'turboCola', 'palmFm', 'overdrive', 'miami2084', 'bikiniBar', 'synthFm',
    'driveFast', 'summer86', 'hotelParadise', 'miamiHeat', 'cyberBeach',
  ),
  ambience: 'city',
  music: 'space-city',
  build(ctx) {
    ctx.scene.add(createGround());
    const city = new City(ctx.track, ctx.seed);
    ctx.scene.add(city.group);
    return { roofSpots: city.roofSpots, faceSpots: city.faceSpots, searchlights: city.searchlightSpots };
  },
};
