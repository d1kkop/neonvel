import type { Quality } from '../game/World';
import type { WeatherName } from '../world/weather/Weather';
import { START_RATING } from '../net/elo';
import type { AiDifficulty } from '../game/CarPhysics';

export interface Settings {
  playerName: string;
  quality: Quality;
  volume: { master: number; music: number; sfx: number; ambience: number };
  /** Selected garage car + per-car paint choice. */
  carId: string;
  carPaint: Record<string, string>;
  /** Cache of purchased cars (the server is authoritative). */
  ownedCars: string[];
  levelId: string;
  weather: Record<string, WeatherName>;
  /** Ground fog on/off per level (added on top of any weather). */
  fog: Record<string, boolean>;
  laps: number;
  /** Laps picked per level in Quick Race (unset = the level's default: 2 top row, 3 below). */
  lapsByLevel: Record<string, number>;
  /** Personal fastest lap per level in milliseconds (kept locally; the server has the shared boards). */
  bestLaps: Record<string, number>;
  /** 'auto' = the level's own ambience, otherwise a fixed ambience kind (or 'none'). */
  ambience: string;
  /** 'auto' = level track, 'shuffle', or a fixed track id. */
  music: string;
  /** 'grip' = planted, 'drift' = held slides with brake/handbrake + steer. */
  driveMode: 'grip' | 'drift';
  opponents: number;
  /** Quick Race game mode. */
  mode: 'race' | 'highway';
  /** Overall lighting / glow, 0.5 (toned down) .. 1 (as designed). */
  lighting: number;
  /** VHS look (scanlines, tape wobble). */
  vhs: boolean;
  /** AI opponent strength. */
  difficulty: AiDifficulty;
  /** Netplay: seconds to wait for a full 4-driver lobby before racing with fewer. */
  matchWait: 15 | 30 | 45;
  serverUrl: string;
  /** Local cache of the online profile (server is authoritative). */
  rating: number;
  games: number;
  /** Settings schema version (for one-time migrations). */
  version: number;
}

const KEY = 'neon-velocity-settings-v1';

const DEFAULTS: Settings = {
  playerName: '',
  quality: 'high',
  volume: { master: 0.8, music: 0.8, sfx: 0.45, ambience: 0.12 },
  carId: 'vortex',
  carPaint: {},
  ownedCars: [],
  levelId: 'neon-skyway',
  weather: {},
  fog: {},
  laps: 3,
  lapsByLevel: {},
  bestLaps: {},
  ambience: 'auto',
  music: 'auto',
  driveMode: 'grip',
  opponents: 3,
  mode: 'race',
  lighting: 1,
  vhs: false, // optional (Options → VHS look)
  difficulty: 'normal',
  matchWait: 30,
  serverUrl: `ws://${location.hostname || 'localhost'}:8787`,
  rating: START_RATING,
  games: 0,
  version: 5,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s: Settings = { ...DEFAULTS, ...JSON.parse(raw) };
      // v2: music louder than effects by default.
      if (!s.version || s.version < 2) {
        s.volume = { ...DEFAULTS.volume, master: s.volume?.master ?? DEFAULTS.volume.master };
        s.version = 2;
      }
      s.volume.ambience ??= DEFAULTS.volume.ambience;
      // The Heat (police chase) mode was removed.
      if ((s.mode as string) === 'heat') s.mode = 'race';
      s.fog ??= {};
      s.bestLaps ??= {};
      // Fog used to be a weather of its own: turn it into clear + fog.
      for (const [id, w] of Object.entries(s.weather)) if (w === 'fog') { s.weather[id] = 'clear'; s.fog[id] = true; }
      // v3: ambience is just a quiet background layer.
      if (s.version < 3) {
        s.volume.ambience = Math.min(s.volume.ambience, 0.12);
        s.version = 3;
      }
      // v4: forget remembered weather picks once, so every level opens in its own default weather again
      // (Palm Coast sunny, …); fog is now a separate toggle.
      if (s.version < 4) {
        s.weather = {};
        s.fog = {};
        s.version = 4;
      }
      // v5: the VHS distortion is optional now and off by default.
      if (s.version < 5) {
        s.vhs = false;
        s.version = 5;
      }
      return s;
    }
  } catch {
    /* storage unavailable */
  }
  return structuredClone(DEFAULTS);
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
