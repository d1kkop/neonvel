import * as THREE from 'three';
import type { LoopTrack, TrackSection } from '../track/Track';
import type { WeatherName } from '../world/weather/Weather';
import type { BillboardDesign } from '../world/billboardArt';

export type TimeOfDay = 'day' | 'dusk' | 'night';
export type AmbienceKind = 'city' | 'beach' | 'desert' | 'harbor' | 'snow' | 'grid' | 'space' | 'underwater';

export interface SkyParams {
  top: string;
  mid: string;
  horizon: string;
  sunA: string;
  sunB: string;
  sunSize: number;
  sunIntensity: number;
  /** 1 = retro horizontal cut stripes, 0 = plain disc. */
  sunStripes: number;
  stars: number;
  /** White puffy daytime clouds amount (independent from storm clouds). */
  dayClouds: number;
  /** 0..1: tint the daytime clouds with the horizon / sun colours (sunsets). */
  cloudTint?: number;
  /** Sun glow: > 0 makes the sun's disc a bloom source of this brightness (it glows like a lamp); 0 / unset = off. */
  sunGlow?: number;
  /** 0..1: hot yellow-white core in the middle of the sun's disc (a sun that reads as a light source). */
  sunCore?: number;
  aurora?: number;
  nebula?: number;
  gridHorizon?: number;
}

export interface AtmosphereParams {
  fogColor: string;
  fogDensity: number;
  hazeColor: string;
  hazeTop: number;
  hazeStrength: number;
  /** Fog colour used when the weather turns bad (rain / fog / storm). */
  overcastColor: string;
  /** Underwater caustics strength. */
  caustics?: number;
}

export interface LightingParams {
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunColor: string;
  sunIntensity: number;
  /** Direction toward the sun / moon (also drives the sky disc and building shading). */
  sunDir: [number, number, number];
  exposure: number;
  bloom: { strength: number; radius: number; threshold: number };
  /** Colours for the synthetic reflection environment (car paint). */
  env: { top: string; horizon: string; ground: string; panels: string[] };
}

export interface RoadStyleParams {
  lampsOn: boolean;
  leftNeon: string;
  rightNeon: string;
  leftLamp: string;
  rightLamp: string;
  neonIntensity: number;
  asphalt: string;
  /** Base reflectivity 0..1 (dry day road ≈ 0.25, wet neon night ≈ 1). */
  reflect: number;
  /** Puddle coverage bias 0..1. */
  wetness: number;
  concrete: string;
  /** Road-side barrier look (visual only; the drivable width is the same). */
  wallStyle?: 'concrete' | 'guardrail' | 'glass' | 'snowbank' | 'rail';
  /** Street-light model. */
  lampStyle?: 'arm' | 'post' | 'none';
  /** Barrier / rail colour for guardrail & glass styles. */
  railColor?: string;
}

export interface LevelBuildContext {
  scene: THREE.Scene;
  track: LoopTrack;
  seed: number;
  quality: 'low' | 'medium' | 'high';
  /** Register a per-frame updater (time in seconds, dt). */
  onUpdate(fn: (time: number, dt: number) => void): void;
  /** The player's car in track coordinates (for creatures that follow you). */
  player(): { s: number; x: number; v: number };
  /** Play a one-shot level sound effect (e.g. dolphin whistle). */
  sound?(kind: 'dolphin'): void;
}

/** What a level's build() returns for the shared systems. */
export interface LevelBuildResult {
  /** Rooftop billboard candidates. */
  roofSpots?: { x: number; z: number; y: number; w: number; d: number; yaw: number }[];
  /** Screens mounted on building faces. */
  faceSpots?: { pos: THREE.Vector3; normal: THREE.Vector3; w: number; h: number }[];
  /** Rooftop searchlight positions. */
  searchlights?: THREE.Vector3[];
}

export interface LevelDef {
  id: string;
  name: string;
  tagline: string;
  /** Card gradient for the level-select menu. */
  cardColors: [string, string];
  time: TimeOfDay;
  seed: number;
  track: {
    points: [number, number][];
    length: number;
    height: number;
    width: number;
    lanes: number;
    sections: TrackSection[];
    /** Road pillars down to the ground (elevated tracks only). */
    pillars: boolean;
    /** Rolling hills along the track: [cycles per lap, amplitude m, phase]. */
    hills?: [number, number, number][];
  };
  sky: SkyParams;
  atmosphere: AtmosphereParams;
  lighting: LightingParams;
  road: RoadStyleParams;
  weathers: WeatherName[];
  defaultWeather: WeatherName;
  /** Weather for races on this level until the player picks one (the title-screen background keeps defaultWeather). */
  firstWeather?: WeatherName;
  billboards: BillboardDesign[];
  /** 'neon' roadside screens (default) or 'underwater' floating boards (buoys, chains, bubbles). */
  billboardStyle?: 'neon' | 'underwater';
  ambience: AmbienceKind;
  /** Default music track id for this level. */
  music: string;
  /** Precipitation look for rain / storm weather. */
  precipitation?: 'rain' | 'snow' | 'bubbles';
  /** Builds the level-specific scenery. */
  build(ctx: LevelBuildContext): LevelBuildResult;
}
