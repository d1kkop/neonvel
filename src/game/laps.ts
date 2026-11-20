/**
 * Default lap count per level: 2 laps on Neon Skyway, Palm Coast, Desert Mirage and Harbor Docks, 3 everywhere else.
 * Shared by the client (quick race) and the server (online matches), so this file has no imports.
 */
const TWO_LAP_LEVELS = ['neon-skyway', 'palm-coast', 'desert-mirage', 'harbor-docks'];

export function defaultLaps(levelId: string): number {
  return TWO_LAP_LEVELS.includes(levelId) ? 2 : 3;
}
