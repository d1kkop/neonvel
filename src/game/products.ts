/**
 * Level prices (US cents). Shared by the client UI and the store server.
 * Store item ids: car ids as-is, levels as `level:<id>`.
 */
export const LEVEL_PRICES: Record<string, number> = {
  'neon-skyway': 0,
  'palm-coast': 0,
  'desert-mirage': 200,
  'harbor-docks': 200,
  'snow-pass': 200,
  'cyber-grid': 200,
  'orbit-run': 200,
  'deep-blue': 300,
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
