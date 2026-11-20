/** Shared types + D1 queries (players, sessions, lap records, purchases). */
import { START_RATING } from '../../src/net/elo';

export interface Env {
  DB: D1Database;
  LOBBY: DurableObjectNamespace;
  ROOM: DurableObjectNamespace;
  ASSETS?: Fetcher;
  PUBLIC_URL: string;
  API_URL?: string;
  STORE_CURRENCY?: string;
  STRIPE_TAX?: string;
  STORE_TEST_MODE?: string;
  AUTH_DEV?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  /** Signs match tickets (lobby -> room). Any long random string. */
  TICKET_SECRET?: string;
}

export interface PlayerRow { id: string; name: string; rating: number; games: number; wins: number }

export const LEVELS = ['neon-skyway', 'palm-coast', 'desert-mirage', 'harbor-docks', 'snow-pass', 'cyber-grid', 'orbit-run', 'deep-blue'];

/** Settings derived from the environment. */
export function config(env: Env) {
  const PUBLIC_URL = (env.PUBLIC_URL || 'http://localhost:5173/').replace(/\/?$/, '/');
  const IS_PROD = PUBLIC_URL.startsWith('https://');
  const STRIPE_KEY = env.STRIPE_SECRET_KEY ?? '';
  return {
    PUBLIC_URL,
    IS_PROD,
    API_URL: (env.API_URL || (IS_PROD ? new URL(PUBLIC_URL).origin : 'http://localhost:8787')).replace(/\/$/, ''),
    STRIPE_KEY,
    STRIPE_TAX: env.STRIPE_TAX !== '0',
    CURRENCY: (env.STORE_CURRENCY ?? 'usd').toLowerCase(),
    TEST_MODE: !STRIPE_KEY && env.STORE_TEST_MODE !== '0',
    DEV_LOGIN: !IS_PROD && env.AUTH_DEV !== '0',
    storeMode: STRIPE_KEY ? 'stripe' : !STRIPE_KEY && env.STORE_TEST_MODE !== '0' ? 'test' : 'off',
  };
}

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const PLAYER_COLS = 'id, name, rating, games, wins';

export async function playerById(db: D1Database, id: string): Promise<PlayerRow | null> {
  return db.prepare(`SELECT ${PLAYER_COLS} FROM players WHERE id = ?`).bind(id).first<PlayerRow>();
}

/** The signed-in player for a session token, or null. */
export async function playerFor(db: D1Database, token: unknown): Promise<PlayerRow | null> {
  if (typeof token !== 'string' || token.length < 20) return null;
  const row = await db.prepare(`SELECT p.id, p.name, p.rating, p.games, p.wins FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?`).bind(token).first<PlayerRow>();
  if (!row) return null;
  await db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').bind(Date.now(), token).run();
  return row;
}

export async function newSession(db: D1Database, playerId: string): Promise<string> {
  const token = randomToken();
  await db.prepare('INSERT INTO sessions (token, player_id, created, last_seen) VALUES (?, ?, ?, ?)').bind(token, playerId, Date.now(), Date.now()).run();
  return token;
}

async function nameTaken(db: D1Database, name: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 FROM players WHERE name = ?').bind(name).first());
}

/** A free display name based on `base` (letters, digits, space . - _), adding digits when it is taken. */
export async function freeName(db: D1Database, base: string): Promise<string> {
  const name = base.replace(/[^\w .\-]/g, '').trim().slice(0, 16) || 'Driver';
  if (!(await nameTaken(db, name))) return name;
  for (let i = 0; i < 50; i++) {
    const n = `${name.slice(0, 12)}${Math.floor(Math.random() * 9000 + 1000)}`;
    if (!(await nameTaken(db, n))) return n;
  }
  return `Driver${randomToken(3)}`;
}

export async function accountPlayer(db: D1Database, provider: string, providerId: string, suggested: string): Promise<PlayerRow> {
  const found = await db.prepare(`SELECT ${PLAYER_COLS} FROM players WHERE provider = ? AND provider_id = ?`).bind(provider, providerId).first<PlayerRow>();
  if (found) return found;
  const id = crypto.randomUUID(), name = await freeName(db, suggested);
  await db.prepare('INSERT INTO players (id, name, rating, games, wins, created, provider, provider_id) VALUES (?, ?, ?, 0, 0, ?, ?, ?)')
    .bind(id, name, START_RATING, Date.now(), provider, providerId).run();
  return { id, name, rating: START_RATING, games: 0, wins: 0 };
}

export async function owned(db: D1Database, playerId: string): Promise<string[]> {
  const r = await db.prepare('SELECT item FROM purchases WHERE player_id = ?').bind(playerId).all<{ item: string }>();
  return r.results.map((x) => x.item);
}

export async function grant(db: D1Database, playerId: string, item: string, source: string, ref: string | null): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO purchases (player_id, item, source, ref, created) VALUES (?, ?, ?, ?, ?)').bind(playerId, item, source, ref, Date.now()).run();
}

export async function leaderboard(db: D1Database) {
  const r = await db.prepare('SELECT name, rating, games, wins FROM players WHERE games > 0 ORDER BY rating DESC LIMIT 50').all<{ name: string; rating: number; games: number; wins: number }>();
  return r.results;
}

// ------------------------------------------------------------------ track records

/** Shortest believable lap per level (ms): lap length (m) at 150 m/s. */
const MIN_LAP_M: Record<string, number> = {
  'neon-skyway': 2790, 'palm-coast': 3200, 'desert-mirage': 3000, 'harbor-docks': 3000, 'snow-pass': 3190, 'cyber-grid': 2560, 'orbit-run': 2990, 'deep-blue': 2900,
};

/** Store a checked lap (kept only if it is this driver's best on the track). */
export async function submitLap(db: D1Database, player: PlayerRow, level: string, ms: number, car: string): Promise<Record<string, unknown>> {
  if (!LEVELS.includes(level)) return { error: 'Unknown level.' };
  if (!Number.isFinite(ms) || ms < (MIN_LAP_M[level] / 150) * 1000 || ms > 30 * 60 * 1000) return { error: 'Lap time rejected.' };
  const get = db.prepare('SELECT ms FROM lap_times WHERE player_id = ? AND level = ?').bind(player.id, level);
  const before = (await get.first<{ ms: number }>())?.ms;
  await db.prepare(`INSERT INTO lap_times (player_id, level, ms, car, created) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (player_id, level) DO UPDATE SET ms = excluded.ms, car = excluded.car, created = excluded.created WHERE excluded.ms < lap_times.ms`)
    .bind(player.id, level, Math.round(ms), car.slice(0, 24), Date.now()).run();
  const best = (await get.first<{ ms: number }>())!.ms;
  const rank = (await db.prepare('SELECT COUNT(*) AS n FROM lap_times WHERE level = ? AND ms < ?').bind(level, best).first<{ n: number }>())!.n + 1;
  return { best, improved: before === undefined || best < before, rank };
}

/** Top 50 of a track, plus where the player stands (also outside the top 50). */
export async function lapBoard(db: D1Database, level: string, player: PlayerRow | null): Promise<Record<string, unknown>> {
  const top = (await db.prepare('SELECT p.name AS name, l.ms AS ms, l.car AS car FROM lap_times l JOIN players p ON p.id = l.player_id WHERE l.level = ? ORDER BY l.ms ASC, l.created ASC LIMIT 50').bind(level).all()).results;
  let me: { rank: number; ms: number } | null = null;
  if (player) {
    const row = await db.prepare('SELECT ms FROM lap_times WHERE player_id = ? AND level = ?').bind(player.id, level).first<{ ms: number }>();
    if (row) me = { rank: (await db.prepare('SELECT COUNT(*) AS n FROM lap_times WHERE level = ? AND ms < ?').bind(level, row.ms).first<{ n: number }>())!.n + 1, ms: row.ms };
  }
  const total = (await db.prepare('SELECT COUNT(*) AS n FROM lap_times WHERE level = ?').bind(level).first<{ n: number }>())!.n;
  return { level, top, me, total };
}
