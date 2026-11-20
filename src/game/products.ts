/**
 * Level prices (US cents). Shared by the client UI and the store server.
 * Store item ids: car ids as-is, levels as `level:<id>`.
 */
export const LEVEL_PRICES: Record<string, number> = {
  'neon-skyway': 0,
  'palm-coast': 0,
  'desert-mirage': 0,
  'harbor-docks': 0,
  // Locked: the four special worlds.
  'cyber-grid': 100,
  'snow-pass': 100,
  'orbit-run': 100,
  'deep-blue': 150,
};

export const LEVEL_NAMES: Record<string, string> = {
  'neon-skyway': 'Neon Skyway', 'palm-coast': 'Palm Coast', 'desert-mirage': 'Desert Mirage', 'harbor-docks': 'Harbor Docks',
  'snow-pass': 'Snow Pass', 'cyber-grid': 'Cyber Grid', 'orbit-run': 'Orbit Run', 'deep-blue': 'Deep Blue',
};

/** Test builds (the frozen snapshot) set VITE_UNLOCK_ALL=1: every car and level is playable without buying. */
export const UNLOCK_ALL = import.meta.env?.VITE_UNLOCK_ALL === '1'; // ?. : the Node server imports this file too

export function levelItem(id: string): string {
  return `level:${id}`;
}

export function levelPrice(id: string): number {
  return LEVEL_PRICES[id] ?? 0;
}

/**
 * Lap length of every level in metres, exactly as the game builds the track (measured from LoopTrack; update
 * these when a track changes). The server times laps with them.
 */
export const TRACK_LENGTHS: Record<string, number> = {
  'neon-skyway': 2794.312, 'palm-coast': 3200.358, 'desert-mirage': 3000.312, 'harbor-docks': 3000.376,
  'snow-pass': 3193.768, 'cyber-grid': 2564.818, 'orbit-run': 2999.400, 'deep-blue': 2900.250,
};
