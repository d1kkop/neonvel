/**
 * Elo rating helpers, shared by client and (later) the matchmaking server.
 * Multiplayer races are scored as pairwise duels: every finisher "beats" everyone behind them.
 */
export const START_RATING = 1000;

/** Expected score of A against B (0..1). */
export function expected(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/** K-factor: new players move faster, veterans are more stable. */
export function kFactor(gamesPlayed: number, rating: number): number {
  if (gamesPlayed < 10) return 40;
  if (rating > 2000) return 16;
  return 24;
}

/**
 * New ratings after a race. `order` = player ids in finishing order (index 0 = winner).
 * Each pair is a duel; the K-factor is split over the number of opponents so a race
 * against 5 people moves you about as much as one duel.
 */
export function rateRace(
  order: string[],
  players: Record<string, { rating: number; games: number }>,
): Record<string, number> {
  const delta: Record<string, number> = {};
  const n = order.length;
  for (const id of order) delta[id] = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = players[order[i]], b = players[order[j]];
      const ea = expected(a.rating, b.rating);
      const ka = kFactor(a.games, a.rating) / (n - 1);
      const kb = kFactor(b.games, b.rating) / (n - 1);
      delta[order[i]] += ka * (1 - ea);
      delta[order[j]] += kb * (0 - (1 - ea));
    }
  }
  const out: Record<string, number> = {};
  for (const id of order) out[id] = Math.round(players[id].rating + delta[id]);
  return out;
}

/** Rank title shown next to the rating. */
export function rankName(rating: number): string {
  if (rating >= 2000) return 'NEON LEGEND';
  if (rating >= 1700) return 'CHROME';
  if (rating >= 1450) return 'PLATINUM';
  if (rating >= 1250) return 'GOLD';
  if (rating >= 1100) return 'SILVER';
  return 'BRONZE';
}
