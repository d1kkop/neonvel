import { cyberGrid } from './cyberGrid';
import { deepBlue } from './deepBlue';
import { desertMirage } from './desertMirage';
import { harborDocks } from './harborDocks';
import { neonSkyway } from './neonSkyway';
import { orbitRun } from './orbitRun';
import { palmCoast } from './palmCoast';
import { snowPass } from './snowPass';
import type { LevelDef } from './types';

/** All playable levels, in menu order. */
export const LEVELS: LevelDef[] = [neonSkyway, palmCoast, desertMirage, harborDocks, snowPass, cyberGrid, orbitRun, deepBlue];

/** Placeholder cards for levels that aren't built yet (none right now). */
export const UPCOMING: { name: string; tagline: string; cardColors: [string, string] }[] = [];

export function levelById(id: string): LevelDef {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}
