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

export function levelItem(id: string): string {
  return `level:${id}`;
}

export function levelPrice(id: string): number {
  return LEVEL_PRICES[id] ?? 0;
}
