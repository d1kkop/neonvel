import * as THREE from 'three';
import type { AtmosphereParams, TimeOfDay } from '../../levels/types';
import { atmosphere } from '../../render/atmosphere';
import { beamUniforms } from './Beams';
import { Rain } from './Rain';

export type WeatherName = 'clear' | 'rain' | 'fog' | 'storm';

export const WEATHER_LABELS: Record<WeatherName, string> = { clear: 'Clear', rain: 'Rain', fog: 'Fog', storm: 'Storm' };

/** Weather presets are modifiers applied on top of a level's base atmosphere. */
interface WeatherMod {
  rain: number;
  clouds: number;
  fogMul: number;
  /** 0..1 blend of the fog colour toward the level's overcast colour. */
  overcast: number;
  hazeTopAdd: number;
  beam: number;
  lightning: number;
  /** Ground mist over the track: 0 = none, 1 = thick. */
  mist: number;
}

export const WEATHER_PRESETS: Record<WeatherName, WeatherMod> = {
  clear: { rain: 0, clouds: 0, fogMul: 1, overcast: 0, hazeTopAdd: 0, beam: 0.18, lightning: 0, mist: 0 },
  rain: { rain: 0.75, clouds: 0.85, fogMul: 1.9, overcast: 0.6, hazeTopAdd: 30, beam: 0.6, lightning: 0, mist: 0.25 },
  fog: { rain: 0, clouds: 0.5, fogMul: 2.0, overcast: 0.7, hazeTopAdd: 60, beam: 1.6, lightning: 0, mist: 1 },
  storm: { rain: 1, clouds: 1, fogMul: 2.3, overcast: 0.8, hazeTopAdd: 60, beam: 0.85, lightning: 1, mist: 0.35 },
};

export interface WeatherTargets {
  road: { uRain: { value: number }; uReflectStrength: { value: number }; uWetBias: { value: number } };
  sky: { uClouds: { value: number }; uFlash: { value: number } };
  hemi: THREE.HemisphereLight;
}

interface Current {
  rain: number;
  clouds: number;
  fogDensity: number;
  fogColor: THREE.Color;
  hazeTop: number;
  beam: number;
  lightning: number;
  mist: number;
}

/** Blends between weather presets and drives every weather-dependent uniform. */
export class Weather {
  readonly rain: Rain;
  name: WeatherName = 'clear';
  /** Called when lightning strikes (hook for thunder sound). Arg: delay in seconds until thunder. */
  onLightning?: (thunderDelay: number) => void;

  private readonly cur: Current;
  private flash = 0;
  private nextStrike = 4;
  private strikeQueue: number[] = [];
  private cover = 0;
  private readonly hemiBase: number;
  private readonly baseFog: THREE.Color;
  private readonly overcast: THREE.Color;
  private readonly beamScale: number;
  private readonly tmpColor = new THREE.Color();
  private readonly baseReflect: number;
  private readonly baseWet: number;

  /** How wet the road is from rain right now (0..1; snow / underwater bubbles don't count). */
  /** Mist amount 0..1 (1 = thick fog) — lights glow / bloom more in it. */
  get mist(): number {
    return Math.min(1, this.cur.mist);
  }

  /** Rain / snow / bubbles amount right now (0..1). */
  get precipAmount(): number {
    return this.cur.rain;
  }

  get roadWet(): number {
    return this.precipitation === 'rain' ? this.cur.rain : 0;
  }

  constructor(private readonly t: WeatherTargets, private readonly base: AtmosphereParams, time: TimeOfDay, initial: WeatherName, readonly precipitation: 'rain' | 'snow' | 'bubbles' = 'rain') {
    this.rain = new Rain(precipitation === 'rain' ? 20000 : 12000, precipitation);
    this.baseFog = new THREE.Color(base.fogColor);
    this.overcast = new THREE.Color(base.overcastColor);
    this.beamScale = time === 'day' ? 0.35 : 1;
    this.hemiBase = t.hemi.intensity;
    this.baseReflect = t.road.uReflectStrength.value;
    this.baseWet = t.road.uWetBias.value;
    this.name = initial;
    // Start directly at the chosen weather (no fade-in on level load).
    const m = WEATHER_PRESETS[initial];
    this.cur = {
      rain: m.rain,
      clouds: m.clouds,
      fogDensity: base.fogDensity * m.fogMul,
      fogColor: this.baseFog.clone().lerp(this.overcast, m.overcast),
      hazeTop: base.hazeTop + m.hazeTopAdd,
      beam: m.beam * this.beamScale,
      lightning: m.lightning,
      mist: m.mist,
    };
  }

  set(name: WeatherName): void {
    this.name = name;
  }

  /** Ground fog on the track, independent of the weather (rain + fog, storm + fog …). */
  fog = false;

  setFog(on: boolean, instant = false): void {
    this.fog = on;
    if (instant) {
      this.cur.mist = Math.max(WEATHER_PRESETS[this.name].mist, on ? 1 : 0);
      this.cur.beam = this.beamTarget();
    }
  }

  private beamTarget(): number {
    const m = WEATHER_PRESETS[this.name];
    return (this.fog ? Math.max(m.beam, WEATHER_PRESETS.fog.beam) : m.beam) * this.beamScale;
  }

  cycle(): WeatherName {
    const names = Object.keys(WEATHER_PRESETS) as WeatherName[];
    this.name = names[(names.indexOf(this.name) + 1) % names.length];
    return this.name;
  }

  /** `covered` = camera is under a tunnel / canopy. */
  update(dt: number, camera: THREE.Camera, covered: boolean): void {
    const m = WEATHER_PRESETS[this.name];
    const k = 1 - Math.exp(-dt / 1.2);
    const c = this.cur;
    c.rain += (m.rain - c.rain) * k;
    c.clouds += (m.clouds - c.clouds) * k;
    c.fogDensity += (this.base.fogDensity * m.fogMul - c.fogDensity) * k;
    c.hazeTop += (this.base.hazeTop + m.hazeTopAdd - c.hazeTop) * k;
    c.beam += (this.beamTarget() - c.beam) * k;
    c.lightning += (m.lightning - c.lightning) * k;
    c.mist += (Math.max(m.mist, this.fog ? 1 : 0) - c.mist) * k;
    c.fogColor.lerp(this.tmpColor.copy(this.baseFog).lerp(this.overcast, m.overcast), k);

    this.cover += ((covered ? 1 : 0) - this.cover) * (1 - Math.exp(-dt * 4));

    // Lightning: random strikes, each a quick double flicker.
    if (c.lightning > 0.5) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.nextStrike = 3 + Math.random() * 7;
        this.strikeQueue = [0, 0.12 + Math.random() * 0.1, 0.35 + Math.random() * 0.2];
        this.onLightning?.(0.4 + Math.random() * 2.0);
      }
    }
    if (this.strikeQueue.length) {
      this.strikeQueue = this.strikeQueue.map((s) => s - dt);
      while (this.strikeQueue.length && this.strikeQueue[0] <= 0) {
        this.strikeQueue.shift();
        this.flash = 0.7 + Math.random() * 0.5;
      }
    }
    this.flash *= Math.exp(-dt * 9);

    atmosphere.uFogDensity.value = c.fogDensity;
    atmosphere.uFogColor.value.copy(c.fogColor).lerp(this.tmpColor.setRGB(0.5, 0.5, 0.75), this.flash * 0.35);
    atmosphere.uHazeTop.value = c.hazeTop;
    atmosphere.uHazeStrength.value = this.base.hazeStrength;
    atmosphere.uHazeColor.value.set(this.base.hazeColor);
    atmosphere.uMist.value = c.mist;
    // Mist is lit fog: the level's fog colour pulled toward its glowing haze and lifted (it scatters light).
    {
      const mc = atmosphere.uMistColor.value.copy(c.fogColor).lerp(atmosphere.uHazeColor.value, 0.15);
      const lum = mc.r * 0.3 + mc.g * 0.55 + mc.b * 0.15;
      mc.lerp(this.tmpColor.setRGB(lum, lum, lum * 1.05), 0.45).multiplyScalar(1.25).addScalar(0.03); // greyish, lifted
    }
    atmosphere.uMistColor.value.lerp(this.tmpColor.setRGB(0.6, 0.6, 0.8), this.flash * 0.4);
    beamUniforms.uBeam.value = c.beam;
    this.t.road.uRain.value = c.rain;
    // Dry-ish road in clear weather, a wet mirror once it rains.
    const wetness = Math.min(1, c.rain * 1.4);
    this.t.road.uReflectStrength.value = this.baseReflect * (0.3 + 0.7 * wetness);
    this.t.road.uWetBias.value = this.baseWet - 0.35 * (1 - wetness); // fewer puddles when dry
    this.t.sky.uClouds.value = c.clouds;
    this.t.sky.uFlash.value = this.flash;
    this.t.hemi.intensity = this.hemiBase * (1 - c.clouds * 0.35) + this.flash * 2.5 * (1 - this.cover);
    this.rain.update(camera, dt, c.rain, this.cover);
  }
}
