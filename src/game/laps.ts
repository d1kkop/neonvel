/**
 * Default lap count per level: the four levels in the top row of the level select are 2 laps, the ones below
 * are 3. Shared by the client (quick race) and the server (online matches), so this file has no imports.
 */
const TWO_LAP_LEVELS = ['neon-skyway', 'palm-coast', 'desert-mirage', 'harbor-docks'];

export function defaultLaps(levelId: string): number {
  return TWO_LAP_LEVELS.includes(levelId) ? 2 : 3;
}
