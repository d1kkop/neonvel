/**
 * Neon Velocity matchmaking server.
 *  - WebSocket (default port 8787) for hello / queue / race relay / results / leaderboard
 *  - HTTP GET /leaderboard for a JSON leaderboard
 *  - SQLite (node:sqlite, no native deps) stores players + ratings + race history
 *  - Elo matchmaking: the search window widens the longer you wait
 *  - Accounts: sign in with Google or Discord (OAuth); a session token identifies the player
 *  - Store: Stripe Checkout (with Stripe Tax) + webhook; test mode without a Stripe key
 *  - Track records: the server times every lap itself from the car's progress reports
 *
 * Environment (all optional for local development):
 *   PORT, DB_PATH
 *   PUBLIC_URL            where the game is served (https://… in production)
 *   API_URL               public address of this server (OAuth callbacks); default: PUBLIC_URL's origin in
 *                         production (same domain, behind the reverse proxy), else http://localhost:PORT
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_TAX (default on), STORE_CURRENCY (default usd)
 *   STORE_TEST_MODE=0     no free test purchases when Stripe is not configured
 *   AUTH_DEV=0            no developer sign-in (it is only ever offered when PUBLIC_URL is not https)
 *
 * Run: npm run server   (Node 22.6+ with TypeScript type-stripping; Node 24 recommended)
 */
import http from 'node:http';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer, WebSocket } from 'ws';
import { rateRace, START_RATING } from '../src/net/elo.ts';
import { CARS, specFor, classOf } from '../src/game/car/catalog.ts';
import { BOOST } from '../src/game/boostRules.ts';
import { LEVEL_NAMES, LEVEL_PRICES, TRACK_LENGTHS } from '../src/game/products.ts';
import { defaultLaps } from '../src/game/laps.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? new URL('./neon.db', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LEVELS = ['neon-skyway', 'palm-coast', 'desert-mirage', 'harbor-docks', 'snow-pass', 'cyber-grid', 'orbit-run', 'deep-blue'];
const WEATHERS = ['clear', 'clear', 'rain', 'storm'];
const MAX_PLAYERS = 4;

// ------------------------------------------------------------------ database

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL COLLATE NOCASE,
    rating INTEGER NOT NULL,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS races (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    finished INTEGER NOT NULL,
    result TEXT NOT NULL
  );
`);
// Accounts: a player row can belong to a Google or Discord account (provider + the provider's user id).
{
  const cols = (db.prepare('PRAGMA table_info(players)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('provider')) db.exec('ALTER TABLE players ADD COLUMN provider TEXT');
  if (!cols.includes('provider_id')) db.exec('ALTER TABLE players ADD COLUMN provider_id TEXT');
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS players_account ON players (provider, provider_id) WHERE provider IS NOT NULL;
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    player_id TEXT NOT NULL,
    created INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
`);
const qFind = db.prepare('SELECT id, name, rating, games, wins FROM players WHERE name = ?');
const qByAccount = db.prepare('SELECT id, name, rating, games, wins FROM players WHERE provider = ? AND provider_id = ?');
const qInsertAccount = db.prepare('INSERT INTO players (id, name, rating, games, wins, created, provider, provider_id) VALUES (?, ?, ?, 0, 0, ?, ?, ?)');
const qById = db.prepare('SELECT id, name, rating, games, wins FROM players WHERE id = ?');
const qSession = db.prepare('SELECT player_id FROM sessions WHERE token = ?');
const qSessionNew = db.prepare('INSERT INTO sessions (token, player_id, created, last_seen) VALUES (?, ?, ?, ?)');
const qSessionSeen = db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?');
const qSessionDel = db.prepare('DELETE FROM sessions WHERE token = ?');
const qRename = db.prepare('UPDATE players SET name = ? WHERE id = ?');
const qInsert = db.prepare('INSERT INTO players (id, name, rating, games, wins, created) VALUES (?, ?, ?, 0, 0, ?)');
const qUpdate = db.prepare('UPDATE players SET rating = ?, games = games + 1, wins = wins + ? WHERE id = ?');
const qTop = db.prepare('SELECT name, rating, games, wins FROM players WHERE games > 0 ORDER BY rating DESC LIMIT 50');
const qRace = db.prepare('INSERT INTO races (id, level, finished, result) VALUES (?, ?, ?, ?)');

// Track records: every driver's fastest single lap per level (milliseconds), from any race, online or
// against the AI. Reported by the game itself, so only a sanity check is possible (no lap faster than the
// track's length at 150 m/s).
db.exec(`
  CREATE TABLE IF NOT EXISTS lap_times (
    player_id TEXT NOT NULL,
    level TEXT NOT NULL,
    ms INTEGER NOT NULL,
    car TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    PRIMARY KEY (player_id, level)
  );
  CREATE INDEX IF NOT EXISTS lap_times_level ON lap_times (level, ms);
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);
// Lap rules version: bumped when the handling or the tracks change so much that old lap times can't be compared
// (v2: smoothed corners + new handling, 2026-11-19). The boards start empty again.
const LAP_RULES = '2';
if ((db.prepare("SELECT v FROM meta WHERE k = 'lap_rules'").get() as { v?: string } | undefined)?.v !== LAP_RULES) {
  db.exec('DELETE FROM lap_times');
  db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('lap_rules', ?)").run(LAP_RULES);
}
const qLapGet = db.prepare('SELECT ms FROM lap_times WHERE player_id = ? AND level = ?');
const qLapSet = db.prepare(`INSERT INTO lap_times (player_id, level, ms, car, created) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (player_id, level) DO UPDATE SET ms = excluded.ms, car = excluded.car, created = excluded.created WHERE excluded.ms < lap_times.ms`);
const qLapTop = db.prepare('SELECT p.name AS name, l.ms AS ms, l.car AS car FROM lap_times l JOIN players p ON p.id = l.player_id WHERE l.level = ? ORDER BY l.ms ASC, l.created ASC LIMIT 50');
const qLapRank = db.prepare('SELECT COUNT(*) AS n FROM lap_times WHERE level = ? AND ms < ?');
const qLapCount = db.prepare('SELECT COUNT(*) AS n FROM lap_times WHERE level = ?');
/** Shortest believable lap per level (ms): lap length (m) at 150 m/s. */
const MIN_LAP_MS: Record<string, number> = {
  'neon-skyway': 2800, 'palm-coast': 3200, 'desert-mirage': 3000, 'harbor-docks': 3000, 'snow-pass': 3000, 'cyber-grid': 2600, 'orbit-run': 3000, 'deep-blue': 3000,
};

/** Store a lap the server has timed itself (kept only if it is this driver's best on the track). */
function submitLap(player: PlayerRow, level: string, ms: number, car: string): Record<string, unknown> {
  if (!LEVELS.includes(level)) return { error: 'Unknown level.' };
  if (!Number.isFinite(ms) || ms < (MIN_LAP_MS[level] / 150) * 1000 || ms > 30 * 60 * 1000) return { error: 'Lap time rejected.' };
  const before = (qLapGet.get(player.id, level) as { ms: number } | undefined)?.ms;
  qLapSet.run(player.id, level, Math.round(ms), car.slice(0, 24), Date.now());
  const best = (qLapGet.get(player.id, level) as { ms: number }).ms;
  return { best, improved: before === undefined || best < before, rank: (qLapRank.get(level, best) as { n: number }).n + 1 };
}

/** Top 50 of a track, plus where `name` stands (also when outside the top 50). */
function lapBoard(level: string, player: PlayerRow | null): Record<string, unknown> {
  const top = qLapTop.all(level) as { name: string; ms: number; car: string }[];
  let me: { rank: number; ms: number } | null = null;
  if (player) {
    const row = qLapGet.get(player.id, level) as { ms: number } | undefined;
    if (row) me = { rank: (qLapRank.get(level, row.ms) as { n: number }).n + 1, ms: row.ms };
  }
  return { level, top, me, total: (qLapCount.get(level) as { n: number }).n };
}

// ------------------------------------------------------------------ store (car purchases)
//
// Prices come from the shared catalogue (never from the client).
// - STRIPE_SECRET_KEY set → real payments via Stripe Checkout; a purchase is only granted after the
//   server has verified with Stripe that the session is paid.
// - no key → TEST MODE: purchases are granted immediately and stored with source 'test'.
//   Set STORE_TEST_MODE=0 to disable test purchases.
db.exec(`
  CREATE TABLE IF NOT EXISTS purchases (
    player_id TEXT NOT NULL,
    item TEXT NOT NULL,
    source TEXT NOT NULL,
    ref TEXT,
    created INTEGER NOT NULL,
    PRIMARY KEY (player_id, item)
  );
`);
const qOwned = db.prepare('SELECT item FROM purchases WHERE player_id = ?');
const qGrant = db.prepare('INSERT OR IGNORE INTO purchases (player_id, item, source, ref, created) VALUES (?, ?, ?, ?, ?)');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const STRIPE_TAX = process.env.STRIPE_TAX !== '0';
const CURRENCY = (process.env.STORE_CURRENCY ?? 'usd').toLowerCase();
const TEST_MODE = !STRIPE_KEY && process.env.STORE_TEST_MODE !== '0';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? 'http://localhost:5173/').replace(/\/?$/, '/');
const IS_PROD = PUBLIC_URL.startsWith('https://');
const API_URL = (process.env.API_URL ?? (IS_PROD ? new URL(PUBLIC_URL).origin : `http://localhost:${PORT}`)).replace(/\/$/, '');
const PRODUCTS = new Map<string, { name: string; price: number }>([
  ...CARS.filter((c) => c.price > 0).map((c) => [c.id, { name: c.name, price: c.price }] as const),
  ...Object.entries(LEVEL_PRICES).filter(([, p]) => p > 0).map(([id, p]) => [`level:${id}`, { name: `Level: ${LEVEL_NAMES[id] ?? id}`, price: p }] as const),
]);

function owned(playerId: string): string[] {
  return (qOwned.all(playerId) as { item: string }[]).map((r) => r.item);
}

async function stripe(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `Stripe error ${res.status}`);
  return json;
}

/** Start a purchase. Returns a Stripe Checkout URL, or grants directly in test mode. */
async function checkout(player: PlayerRow, item: string): Promise<Record<string, unknown>> {
  const product = PRODUCTS.get(item);
  if (!product) return { error: 'Unknown item.' };
  if (owned(player.id).includes(item)) return { granted: true, owned: owned(player.id) };
  if (STRIPE_KEY) {
    const session = await stripe('POST', 'checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': CURRENCY,
      // Stripe works out and adds the right VAT / sales tax for the buyer's country (Stripe Tax).
      ...(STRIPE_TAX ? { 'automatic_tax[enabled]': 'true', 'line_items[0][price_data][tax_behavior]': 'exclusive', 'line_items[0][price_data][product_data][tax_code]': 'txcd_10201000' } : {}),
      client_reference_id: player.id,
      // Product picture on the checkout page (public/store/…; Stripe fetches it, so only on the public site).
      ...(IS_PROD ? { 'line_items[0][price_data][product_data][images][0]': `${PUBLIC_URL}store/${item.startsWith('level:') ? `levels/${item.slice(6)}` : `cars/${item}`}.png` } : {}),
      'line_items[0][price_data][unit_amount]': String(product.price),
      'line_items[0][price_data][product_data][name]': `Neon Velocity — ${product.name}`,
      'metadata[player_id]': player.id,
      'metadata[item]': item,
      success_url: `${PUBLIC_URL}?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_URL}?purchase=cancelled`,
    });
    return { url: session.url };
  }
  if (!TEST_MODE) return { error: 'Store is not configured.' };
  qGrant.run(player.id, item, 'test', null, Date.now());
  console.log(`store: TEST purchase ${item} for ${player.name}`);
  return { granted: true, test: true, owned: owned(player.id) };
}

/** After the Stripe redirect: verify the session is paid, then grant (idempotent). */
async function confirm(sessionId: string): Promise<Record<string, unknown>> {
  if (!STRIPE_KEY) return { error: 'Store is in test mode.' };
  const s = await stripe('GET', `checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (s.payment_status !== 'paid') return { error: 'Payment not completed.' };
  const playerId = s.metadata?.player_id, item = s.metadata?.item;
  if (!playerId || !PRODUCTS.has(item)) return { error: 'Invalid session.' };
  qGrant.run(playerId, item, 'stripe', s.id, Date.now());
  return { granted: true, item, owned: owned(playerId) };
}

/**
 * Stripe webhook (POST /stripe/webhook): Stripe tells the server a checkout is paid, so the item is granted
 * even if the buyer closes the browser before coming back to the game. The signature is checked with
 * STRIPE_WEBHOOK_SECRET (Stripe-Signature header: t=<time>,v1=<HMAC-SHA256 of "t.body">).
 */
function stripeWebhook(raw: Buffer, sigHeader: string): { status: number; body: Record<string, unknown> } {
  if (!STRIPE_WEBHOOK_SECRET) return { status: 400, body: { error: 'Webhook secret not configured.' } };
  const parts = Object.fromEntries(sigHeader.split(',').map((kv) => kv.split('=') as [string, string]).filter((kv) => kv.length === 2 && kv[0] !== 'v1'));
  const sigs = sigHeader.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return { status: 400, body: { error: 'Bad timestamp.' } };
  const expected = createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${t}.`).update(raw).digest('hex');
  const ok = sigs.some((v) => v.length === expected.length && timingSafeEqual(Buffer.from(v), Buffer.from(expected)));
  if (!ok) return { status: 400, body: { error: 'Bad signature.' } };
  const event = JSON.parse(raw.toString('utf8'));
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const sess = event.data?.object ?? {};
    const playerId = sess.metadata?.player_id, item = sess.metadata?.item;
    if (sess.payment_status === 'paid' && playerId && PRODUCTS.has(item)) {
      qGrant.run(playerId, item, 'stripe', sess.id, Date.now());
      console.log(`store: PAID ${item} for ${playerId} (${sess.id})`);
    }
  }
  return { status: 200, body: { received: true } };
}

function readRaw(req: http.IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (d: Buffer) => { n += d.length; if (n > limit) { req.destroy(); reject(new Error('too large')); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ------------------------------------------------------------------ accounts (Google / Discord sign-in)

const OAUTH = {
  google: {
    id: process.env.GOOGLE_CLIENT_ID ?? '', secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    me: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid profile',
  },
  discord: {
    id: process.env.DISCORD_CLIENT_ID ?? '', secret: process.env.DISCORD_CLIENT_SECRET ?? '',
    authorize: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token',
    me: 'https://discord.com/api/users/@me', scope: 'identify',
  },
} as const;
type Provider = keyof typeof OAUTH;
const DEV_LOGIN = !IS_PROD && process.env.AUTH_DEV !== '0';
const pendingLogins = new Map<string, { provider: Provider; ret: string; created: number }>();

function providers(): Record<string, boolean> {
  return { google: !!(OAUTH.google.id && OAUTH.google.secret), discord: !!(OAUTH.discord.id && OAUTH.discord.secret), dev: DEV_LOGIN };
}

/** Where a finished sign-in may send the browser back to: the game's own address (any local one in development). */
function safeReturn(ret: string): string {
  try {
    const u = new URL(ret);
    if (u.origin === new URL(PUBLIC_URL).origin) return u.origin + u.pathname;
    if (!IS_PROD && /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$/.test(u.hostname)) return u.origin + u.pathname;
    if (!IS_PROD && u.hostname.endsWith('.trycloudflare.com')) return u.origin + u.pathname; // phone test through a tunnel
  } catch { /* fall through */ }
  return PUBLIC_URL;
}

/** A free display name based on `base` (letters, digits, space . - _), adding digits when it is taken. */
function freeName(base: string): string {
  let name = base.replace(/[^\w .\-]/g, '').trim().slice(0, 16) || 'Driver';
  if (!qFind.get(name)) return name;
  for (let i = 0; i < 50; i++) {
    const n = `${name.slice(0, 12)}${Math.floor(Math.random() * 9000 + 1000)}`;
    if (!qFind.get(n)) return n;
  }
  return `Driver${randomBytes(3).toString('hex')}`;
}

function accountPlayer(provider: string, providerId: string, suggested: string): PlayerRow {
  const found = qByAccount.get(provider, providerId) as PlayerRow | undefined;
  if (found) return found;
  const id = randomUUID(), name = freeName(suggested);
  qInsertAccount.run(id, name, START_RATING, Date.now(), provider, providerId);
  return { id, name, rating: START_RATING, games: 0, wins: 0 };
}

function newSession(playerId: string): string {
  const token = randomBytes(32).toString('base64url');
  qSessionNew.run(token, playerId, Date.now(), Date.now());
  return token;
}

/** The signed-in player for a session token, or null. */
function playerFor(token: unknown): PlayerRow | null {
  if (typeof token !== 'string' || token.length < 20) return null;
  const row = qSession.get(token) as { player_id: string } | undefined;
  if (!row) return null;
  qSessionSeen.run(Date.now(), token);
  return (qById.get(row.player_id) as PlayerRow | undefined) ?? null;
}

async function oauthCallback(provider: Provider, code: string, state: string): Promise<string> {
  const pend = pendingLogins.get(state);
  pendingLogins.delete(state);
  if (!pend || pend.provider !== provider || Date.now() - pend.created > 10 * 60_000) throw new Error('Sign-in expired, please try again.');
  const cfg = OAUTH[provider];
  const tok = await fetch(cfg.token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: cfg.id, client_secret: cfg.secret, redirect_uri: `${API_URL}/auth/${provider}/callback`, grant_type: 'authorization_code' }).toString(),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error('Sign-in failed.');
  const me = await fetch(cfg.me, { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
  const pid = String(provider === 'google' ? me.sub : me.id ?? '');
  if (!pid) throw new Error('Sign-in failed.');
  const suggested = provider === 'google' ? me.given_name ?? me.name ?? '' : me.global_name ?? me.username ?? '';
  const player = accountPlayer(provider, pid, suggested);
  return `${pend.ret}#auth=${newSession(player.id)}`;
}

function profile(p: PlayerRow): Record<string, unknown> {
  return { id: p.id, name: p.name, rating: p.rating, games: p.games, owned: owned(p.id) };
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 10_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}

interface PlayerRow { id: string; name: string; rating: number; games: number; wins: number }
void qInsert;

function leaderboard() {
  return qTop.all() as { name: string; rating: number; games: number; wins: number }[];
}

// ------------------------------------------------------------------ clients, queue, matches

interface Client {
  ws: WebSocket;
  player: PlayerRow | null;
  queuedAt: number | null;
  /** Seconds this player is willing to wait for a full lobby before racing with fewer drivers (15/30/45). */
  wait: number;
  matchId: string | null;
  /** Car chosen for online races (validated against ownership when queueing). */
  car: { id: string; paint: string } | null;
  /** Server-side plausibility check of the reported car state (boost meter + speed). */
  chk: RaceCheck | null;
  /** Lap timing from this player's progress reports (quick races and online races). */
  tm: LapTiming | null;
  ttLevel?: string;
  ttCar?: string;
}

/**
 * Track records use the game's own lap time (what the driver saw), but only after the server has checked it:
 * the game reports its distance along the track ten times a second, and the server times the same lap on its
 * own clock from those reports (from the moment the race started, interpolated where the lap line was
 * crossed). A claimed lap time counts only if every report in that lap was possible for this car (no jumps
 * further than its boosted top speed allows) and the claim is not faster than the server's own measurement
 * allows (network jitter leaves a small margin; claiming a slower time is never a problem).
 */
interface LapTiming {
  level: string; L: number; car: string; maxV: number;
  lastS: number; lastT: number; lap: number; lapStart: number | null; clean: boolean;
  /** Server-measured lap times by lap number (null = that lap was not clean), and claims waiting for them. */
  measured: Map<number, number | null>;
  claims: Map<number, number>;
}
const LAP_TOLERANCE_MS = 350;

function startTiming(c: Client, level: string, carId: string): void {
  if (!c.player || !LEVELS.includes(level)) return;
  const model = CARS.find((x) => x.id === carId) ?? CARS[0];
  c.tm = {
    level, L: TRACK_LENGTHS[level], car: model.id, maxV: specFor(model).topSpeed * BOOST.top * 1.1 + 12,
    lastS: 0, lastT: Date.now(), lap: 0, lapStart: Date.now(), clean: true, measured: new Map(), claims: new Map(),
  };
}

/** Decide a claimed lap once both the claim and the server's measurement of that lap are known. */
function judgeLap(c: Client, lap: number): void {
  const k = c.tm;
  if (!k || !c.player || !k.claims.has(lap) || !k.measured.has(lap)) return;
  const claim = k.claims.get(lap)!, measured = k.measured.get(lap)!;
  k.claims.delete(lap);
  if (measured === null) return send(c, { t: 'lap', level: k.level, lap, ms: claim, rejected: 'This lap could not be checked (connection gap or impossible movement).' });
  if (claim < measured - LAP_TOLERANCE_MS - measured * 0.005) return send(c, { t: 'lap', level: k.level, lap, ms: claim, rejected: 'Lap time does not match the race (paused, or the clock ran fast).' });
  const r = submitLap(c.player, k.level, claim, k.car);
  send(c, { t: 'lap', level: k.level, lap, ms: claim, ...r });
}

function timeProgress(c: Client, s: number, v: number): void {
  const k = c.tm;
  if (!k || !c.player || !Number.isFinite(s)) return;
  const now = Date.now();
  const dt = (now - k.lastT) / 1000, ds = s - k.lastS;
  if (ds < -40 || ds > k.maxV * Math.max(dt, 0.05) * 1.5 + 20 || (Number.isFinite(v) && v > k.maxV * 1.1) || dt > 5) k.clean = false;
  const lap = Math.floor(Math.max(0, s) / k.L);
  if (lap > k.lap && ds > 0) {
    const tCross = k.lastT + (now - k.lastT) * Math.max(0, Math.min(1, (lap * k.L - k.lastS) / ds));
    if (k.lapStart !== null && lap === k.lap + 1) {
      k.measured.set(lap, k.clean ? tCross - k.lapStart : null);
      judgeLap(c, lap);
      if (k.measured.size > 20) k.measured.delete(Math.min(...k.measured.keys()));
    }
    k.lapStart = tCross;
    k.clean = true;
  }
  k.lap = lap;
  k.lastS = s;
  k.lastT = now;
}

/**
 * The server can't run the physics, but it can keep its own generous estimate of each car's boost meter
 * (it may only grow from drifting and car contact, and burns while boosting) and the highest speed the
 * car could possibly have. Reports beyond that count as violation time; too much → disqualified.
 */
interface RaceCheck {
  meter: number;
  top: number; // m/s, the car's spec top speed
  allowedV: number;
  lastT: number;
  lastNear: number;
  last: { s: number; x: number } | null;
  violation: number; // seconds of implausible reports
  warned: boolean;
}

const DQ_SECONDS = 2.5;

interface Match {
  id: string;
  level: string;
  players: Client[];
  finishes: Map<string, number>; // player id → race time
  firstFinish: number | null;
  done: boolean;
  /** Players that loaded the level, start signal sent, players that left. */
  ready: Set<string>;
  created: number;
  started: boolean;
  left: Set<string>;
}

const clients = new Set<Client>();
const matches = new Map<string, Match>();

function send(c: Client, msg: Record<string, unknown>): void {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}

/** Rating window grows with waiting time: ±100 immediately, +25 per second, max ±600. */
function windowFor(c: Client, now: number): number {
  const waited = (now - (c.queuedAt ?? now)) / 1000;
  return Math.min(600, 100 + waited * 25);
}

function waitedFor(c: Client, now: number): number {
  return (now - (c.queuedAt ?? now)) / 1000;
}

function queue(): Client[] {
  return [...clients].filter((c) => c.queuedAt !== null && c.player && !c.matchId);
}

/** Greedy matchmaker: oldest waiting player picks the closest-rated compatible players. */
function matchmake(): void {
  const now = Date.now();
  const waiting = queue().sort((a, b) => a.queuedAt! - b.queuedAt!);
  const used = new Set<Client>();
  for (const anchor of waiting) {
    if (used.has(anchor)) continue;
    const ra = anchor.player!.rating;
    const candidates = waiting
      .filter((o) => o !== anchor && !used.has(o))
      // Vehicle class: buses only race buses (totally different handling).
      .filter((o) => classOf(o.car?.id ?? 'vortex') === classOf(anchor.car?.id ?? 'vortex'))
      .filter((o) => {
        const diff = Math.abs(o.player!.rating - ra);
        return diff <= windowFor(anchor, now) && diff <= windowFor(o, now);
      })
      .sort((a, b) => Math.abs(a.player!.rating - ra) - Math.abs(b.player!.rating - ra));
    if (candidates.length === 0) continue;
    // A full lobby (4) starts right away. Otherwise wait until the anchor's chosen wait time is up, then race
    // with the drivers found so far — but only those whose own wait time is up too (they may want a full lobby).
    let group: Client[];
    if (candidates.length >= MAX_PLAYERS - 1) group = [anchor, ...candidates.slice(0, MAX_PLAYERS - 1)];
    else {
      if (waitedFor(anchor, now) < anchor.wait) continue;
      const ready = candidates.filter((o) => waitedFor(o, now) >= o.wait);
      if (ready.length === 0) continue;
      group = [anchor, ...ready];
    }
    group.forEach((c) => used.add(c));
    startMatch(group);
  }
  // Tell waiting players how the search is going.
  const left = queue();
  for (const c of left) {
    const found = 1 + left.filter((o) => o !== c && Math.abs(o.player!.rating - c.player!.rating) <= Math.min(windowFor(c, now), windowFor(o, now))).length;
    send(c, { t: 'queued', size: left.length, range: Math.round(windowFor(c, now)), found: Math.min(MAX_PLAYERS, found), max: MAX_PLAYERS, waited: Math.floor(waitedFor(c, now)), wait: c.wait });
  }
}

function startMatch(group: Client[]): void {
  const m: Match = {
    id: randomUUID(),
    level: (() => {
      // Only levels every player in the lobby can race on.
      const ok = LEVELS.filter((l) => (LEVEL_PRICES[l] ?? 0) === 0 || group.every((c) => owned(c.player!.id).includes(`level:${l}`)));
      return ok[Math.floor(Math.random() * ok.length)];
    })(),
    players: group,
    finishes: new Map(),
    firstFinish: null,
    done: false,
    ready: new Set(),
    created: Date.now(),
    started: false,
    left: new Set(),
  };
  matches.set(m.id, m);
  const weather = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
  for (const c of group) {
    c.queuedAt = null;
    c.matchId = m.id;
    const model = CARS.find((x) => x.id === (c.car?.id ?? 'vortex')) ?? CARS[0];
    const top = specFor(model).topSpeed;
    c.chk = { meter: 1, top, allowedV: top, lastT: 0, lastNear: 0, last: null, violation: 0, warned: false };
  }
  const players = group.map((c) => ({ id: c.player!.id, name: c.player!.name, rating: c.player!.rating, car: c.car ?? { id: 'vortex', paint: '' } }));
  for (const c of group) send(c, { t: 'match', matchId: m.id, levelId: m.level, weather, laps: defaultLaps(m.level), players, you: c.player!.id });
  console.log(`match ${m.id.slice(0, 8)} ${m.level}: ${players.map((p) => `${p.name}(${p.rating})`).join(' vs ')}`);
}

/** Plausibility check of one reported state. Returns false when the reported boost isn't possible. */
function checkState(c: Client, m: Match, st: { s?: number; x?: number; v?: number; drift?: number; b?: number }): boolean {
  const k = c.chk;
  if (!k || typeof st.s !== 'number' || typeof st.v !== 'number') return true;
  const now = Date.now();
  const dt = k.lastT ? Math.min(0.5, (now - k.lastT) / 1000) : 0;
  k.lastT = now;
  const boosting = st.b === 1;
  // Car contact with another player gives boost (and can shove you a little faster for a moment).
  let near = false;
  for (const o of m.players) {
    if (o === c || !o.chk?.last) continue;
    if (Math.abs(o.chk.last.s - st.s) < 7 && Math.abs(o.chk.last.x - (st.x ?? 0)) < 3.2) near = true;
  }
  if (near && now - k.lastNear > BOOST.hitCooldown * 1000) k.meter = Math.min(1, k.meter + BOOST.hitGain * 1.15);
  if (near) k.lastNear = now;
  // Drifting fills the meter (generous: the full drift rate whenever the body angle shows a drift).
  if (Math.abs(st.drift ?? 0) > 0.1 && st.v > 15) k.meter = Math.min(1, k.meter + BOOST.driftGain * 1.25 * dt);
  if (!boosting && st.v > BOOST.cruiseSpeed * 0.9) k.meter = Math.min(1, k.meter + BOOST.cruiseGain * 1.25 * dt);
  if (boosting) k.meter -= BOOST.burn * 0.85 * dt;
  k.meter = Math.max(-0.3, k.meter);
  const illegalBoost = boosting && k.meter < -0.12;
  // Speed: spec top speed (+ a little for downhills), boosted top while boosting, then decaying back.
  const base = k.top * 1.04 + 3 + (now - k.lastNear < 1000 ? 8 : 0);
  if (boosting && !illegalBoost) k.allowedV = Math.max(k.allowedV, k.top * BOOST.top * 1.04 + BOOST.kick + 3);
  else k.allowedV = base + Math.max(0, k.allowedV - base) * Math.exp(-1.3 * dt);
  k.allowedV = Math.max(k.allowedV, base);
  let bad = illegalBoost || st.v > k.allowedV;
  // Teleporting: moved much further than the allowed speed permits since the last report.
  if (k.last && dt > 0 && Math.abs(st.s - k.last.s) > k.allowedV * Math.max(dt, 0.05) * 1.6 + 15) {
    bad = true;
    k.violation += 0.5;
  }
  if (bad) k.violation += dt;
  k.last = { s: st.s, x: st.x ?? 0 };
  if (!k.warned && k.violation > 1) {
    k.warned = true;
    send(c, { t: 'warn', message: 'Boost / speed check failed — keep it up and you will be disqualified.' });
    console.log(`warn ${c.player?.name}: implausible boost/speed (meter ${k.meter.toFixed(2)}, v ${st.v.toFixed(1)} > ${k.allowedV.toFixed(1)})`);
  }
  return !illegalBoost;
}

/** Finish a match: rank by finish time (DNF last, in join order), update Elo, notify. */
function settle(m: Match): void {
  if (m.done) return;
  m.done = true;
  const finished = m.players.filter((c) => m.finishes.has(c.player!.id) && !m.left.has(c.player!.id)).sort((a, b) => m.finishes.get(a.player!.id)! - m.finishes.get(b.player!.id)!);
  const dnf = m.players.filter((c) => !m.finishes.has(c.player!.id) || m.left.has(c.player!.id));
  // Failed the boost / speed check: classified last, behind the DNFs.
  const isDq = (c: Client) => (c.chk?.violation ?? 0) > DQ_SECONDS;
  const dq = m.players.filter(isDq);
  const order = [...finished.filter((c) => !isDq(c)), ...dnf.filter((c) => !isDq(c)), ...dq].map((c) => c.player!.id);
  const table: Record<string, { rating: number; games: number }> = {};
  for (const c of m.players) table[c.player!.id] = { rating: c.player!.rating, games: c.player!.games };
  const ratings = rateRace(order, table);
  for (const c of m.players) {
    const p = c.player!;
    const won = order[0] === p.id ? 1 : 0;
    qUpdate.run(ratings[p.id], won, p.id);
    p.rating = ratings[p.id];
    p.games += 1;
    p.wins += won;
    c.matchId = null;
  }
  qRace.run(m.id, m.level, Date.now(), JSON.stringify({ order, ratings, times: Object.fromEntries(m.finishes) }));
  const times = Object.fromEntries(m.finishes);
  const dqIds = dq.map((c) => c.player!.id);
  for (const c of m.players) send(c, { t: 'result', matchId: m.id, order, ratings, times, dq: dqIds });
  if (dqIds.length) console.log(`  disqualified (boost/speed check): ${dq.map((c) => c.player!.name).join(', ')}`);
  matches.delete(m.id);
  console.log(`result ${m.id.slice(0, 8)}: ${order.map((id) => `${table[id] ? m.players.find((c) => c.player!.id === id)!.player!.name : id}→${ratings[id]}`).join(', ')}`);
}

/** Everyone loaded: start the countdown on all clients at the same moment. */
function startRace(m: Match): void {
  if (m.started) return;
  m.started = true;
  for (const c of m.players) send(c, { t: 'go', matchId: m.id, countdown: 3 });
  console.log(`race ${m.id.slice(0, 8)} started`);
}

/** A player quit or disconnected: DNF, tell the others, settle when nobody is left racing. */
function playerLeft(m: Match, c: Client): void {
  if (!c.player || m.left.has(c.player.id)) return;
  m.left.add(c.player.id);
  for (const o of m.players) if (o !== c) send(o, { t: 'left', id: c.player.id });
  const racing = m.players.filter((p) => !m.left.has(p.player!.id) && !m.finishes.has(p.player!.id));
  if (racing.length === 0) settle(m);
  else if (!m.started && m.players.every((p) => m.ready.has(p.player!.id) || m.left.has(p.player!.id))) startRace(m);
}

function onMessage(c: Client, raw: string): void {
  let msg: { t?: string; [k: string]: unknown };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  switch (msg.t) {
    case 'hello': {
      // Signed-in players only (Google / Discord): the session token says who this is.
      const p = playerFor(msg.token);
      if (!p) return send(c, { t: 'error', code: 'auth', message: 'Sign in with Google or Discord first.' });
      c.player = p;
      send(c, { t: 'welcome', id: p.id, name: p.name, rating: p.rating, games: p.games, owned: owned(p.id), storeMode: STRIPE_KEY ? 'stripe' : TEST_MODE ? 'test' : 'off' });
      break;
    }
    case 'timing': {
      // A quick race is about to start (level + car); 'lapstart' marks the green light, 'tt' reports follow.
      if (!c.player || c.matchId) return;
      c.tm = null;
      c.ttLevel = String(msg.level ?? '');
      c.ttCar = String(msg.car ?? '');
      break;
    }
    case 'lapstart': {
      // Green light (quick race or online race): lap 1 is timed from now.
      if (!c.player) return;
      const m = c.matchId ? matches.get(c.matchId) : undefined;
      if (m) startTiming(c, m.level, c.car?.id ?? 'vortex');
      else if (c.ttLevel) startTiming(c, c.ttLevel, c.ttCar ?? 'vortex');
      break;
    }
    case 'tt': {
      if (!c.player || c.matchId) return;
      timeProgress(c, Number(msg.s), Number(msg.v));
      break;
    }
    case 'lapdone': {
      // The game's own time for a finished lap: checked against the server's measurement of the same lap.
      const k = c.tm;
      const lap = Number(msg.lap), ms = Number(msg.ms);
      if (!k || !Number.isInteger(lap) || lap < 1 || !Number.isFinite(ms)) return;
      k.claims.set(lap, Math.round(ms));
      judgeLap(c, lap);
      break;
    }
    case 'queue': {
      if (!c.player) return send(c, { t: 'error', message: 'Say hello first.' });
      // Online car: must be free or owned, otherwise fall back to the free starter.
      const carId = String((msg.car as { id?: string } | undefined)?.id ?? 'vortex');
      const paint = String((msg.car as { paint?: string } | undefined)?.paint ?? '').slice(0, 9);
      const model = CARS.find((x) => x.id === carId);
      const allowed = model && (model.price === 0 || owned(c.player.id).includes(carId));
      c.car = { id: allowed ? carId : 'vortex', paint: /^#[0-9a-f]{6}$/i.test(paint) ? paint : '' };
      const wait = Number(msg.wait);
      c.wait = [15, 30, 45].includes(wait) ? wait : 30;
      if (!c.matchId) c.queuedAt = Date.now();
      matchmake();
      break;
    }
    case 'ready': {
      // Level loaded on this client; start when everyone is ready (or after a timeout, see tick).
      const m = c.matchId ? matches.get(c.matchId) : undefined;
      if (!m || !c.player) return;
      m.ready.add(c.player.id);
      if (!m.started && m.players.every((p) => m.ready.has(p.player!.id) || m.left.has(p.player!.id))) startRace(m);
      break;
    }
    case 'leave': {
      const m = c.matchId ? matches.get(c.matchId) : undefined;
      if (m && c.player) playerLeft(m, c);
      c.matchId = null;
      break;
    }
    case 'cancel':
      c.queuedAt = null;
      break;
    case 'leaderboard':
      send(c, { t: 'leaderboard', rows: leaderboard() });
      break;
    case 'state': {
      // Race relay: forward a player's car state to the others in the match.
      const m = c.matchId ? matches.get(c.matchId) : undefined;
      if (!m || !c.player) return;
      const st = msg.s as { s?: number; x?: number; v?: number; drift?: number; b?: number } | undefined;
      const legal = m.started && st ? checkState(c, m, st) : true;
      if (m.started && st && legal) timeProgress(c, Number(st.s), Number(st.v));
      // An implausible boost isn't shown to the others.
      const out = legal || !st ? msg.s : { ...st, b: 0 };
      for (const o of m.players) if (o !== c) send(o, { t: 'state', id: c.player.id, s: out });
      break;
    }
    case 'finish': {
      const m = c.matchId ? matches.get(c.matchId) : undefined;
      if (!m || !c.player || m.finishes.has(c.player.id)) return;
      const time = Number(msg.time);
      if (!Number.isFinite(time) || time <= 0) return;
      m.finishes.set(c.player.id, time);
      m.firstFinish ??= Date.now();
      if (m.players.every((p) => m.finishes.has(p.player!.id) || m.left.has(p.player!.id))) settle(m);
      break;
    }
  }
}

// ------------------------------------------------------------------ servers

const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Stripe-Signature');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const json = (o: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  try {
    const tokenQ = url.searchParams.get('token');
    if (url.pathname === '/stripe/webhook' && req.method === 'POST') {
      const r = stripeWebhook(await readRaw(req), String(req.headers['stripe-signature'] ?? ''));
      return json(r.body, r.status);
    }
    // --- sign-in
    if (url.pathname === '/auth/providers') return json(providers());
    const start = /^\/auth\/(google|discord|dev)\/start$/.exec(url.pathname);
    if (start) {
      const ret = safeReturn(String(url.searchParams.get('return') ?? PUBLIC_URL));
      if (start[1] === 'dev') {
        // Developer sign-in (local testing only, never with an https PUBLIC_URL): pick any name.
        if (!DEV_LOGIN) return json({ error: 'Not available.' }, 404);
        const name = String(url.searchParams.get('name') ?? 'Tester').replace(/[^\w .\-]/g, '').slice(0, 16) || 'Tester';
        const player = accountPlayer('dev', name.toLowerCase(), name);
        res.statusCode = 302;
        res.setHeader('Location', `${ret}#auth=${newSession(player.id)}`);
        return res.end();
      }
      const provider = start[1] as Provider;
      if (!providers()[provider]) return json({ error: `${provider} sign-in is not configured.` }, 404);
      const state = randomBytes(18).toString('base64url');
      pendingLogins.set(state, { provider, ret, created: Date.now() });
      for (const [k, v] of pendingLogins) if (Date.now() - v.created > 10 * 60_000) pendingLogins.delete(k);
      const cfg = OAUTH[provider];
      const q = new URLSearchParams({ client_id: cfg.id, redirect_uri: `${API_URL}/auth/${provider}/callback`, response_type: 'code', scope: cfg.scope, state, prompt: provider === 'google' ? 'select_account' : 'none' });
      res.statusCode = 302;
      res.setHeader('Location', `${cfg.authorize}?${q}`);
      return res.end();
    }
    const cb = /^\/auth\/(google|discord)\/callback$/.exec(url.pathname);
    if (cb) {
      let dest: string;
      try {
        dest = await oauthCallback(cb[1] as Provider, String(url.searchParams.get('code') ?? ''), String(url.searchParams.get('state') ?? ''));
      } catch (e) {
        dest = `${PUBLIC_URL}#autherror=${encodeURIComponent((e as Error).message)}`;
      }
      res.statusCode = 302;
      res.setHeader('Location', dest);
      return res.end();
    }
    if (url.pathname === '/auth/me') {
      const p = playerFor(tokenQ);
      return p ? json(profile(p)) : json({ error: 'Not signed in.' }, 401);
    }
    if (url.pathname === '/auth/rename' && req.method === 'POST') {
      const body = await readJson(req);
      const p = playerFor(body.token);
      if (!p) return json({ error: 'Not signed in.' }, 401);
      const name = String(body.name ?? '').replace(/[^\w .\-]/g, '').trim().slice(0, 16);
      if (name.length < 2) return json({ error: 'Pick a name of at least 2 letters.' }, 400);
      const taken = qFind.get(name) as PlayerRow | undefined;
      if (taken && taken.id !== p.id) return json({ error: 'That name is taken.' }, 409);
      qRename.run(name, p.id);
      return json(profile({ ...p, name }));
    }
    if (url.pathname === '/auth/logout' && req.method === 'POST') {
      const body = await readJson(req);
      if (typeof body.token === 'string') qSessionDel.run(body.token);
      return json({ ok: true });
    }
    // --- store
    if (url.pathname === '/store/info') return json({ mode: STRIPE_KEY ? 'stripe' : TEST_MODE ? 'test' : 'off' });
    if (url.pathname === '/store/owned') {
      const p = playerFor(tokenQ);
      return json({ owned: p ? owned(p.id) : [] });
    }
    if (url.pathname === '/store/checkout' && req.method === 'POST') {
      const body = await readJson(req);
      const p = playerFor(body.token);
      if (!p) return json({ error: 'Sign in with Google or Discord first (Netplay screen).' }, 401);
      return json(await checkout(p, String(body.item ?? '')));
    }
    if (url.pathname === '/store/confirm') return json(await confirm(String(url.searchParams.get('session_id') ?? '')));
    if (url.pathname === '/laptimes') return json(lapBoard(String(url.searchParams.get('level') ?? ''), playerFor(tokenQ)));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
  if (req.url === '/leaderboard') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(leaderboard()));
    return;
  }
  res.setHeader('Content-Type', 'text/plain');
  res.end('Neon Velocity server. Connect via WebSocket; GET /leaderboard for rankings.\n');
});

const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', (ws) => {
  const c: Client = { ws, player: null, queuedAt: null, wait: 30, matchId: null, car: null, chk: null, tm: null };
  clients.add(c);
  ws.on('message', (data) => onMessage(c, String(data)));
  ws.on('close', () => {
    clients.delete(c);
    // A disconnect mid-race counts as a DNF; settle once everyone else is done.
    const m = c.matchId ? matches.get(c.matchId) : undefined;
    if (m) playerLeft(m, c);
  });
});

// Matchmaking tick + finish timeouts (60 s after the first finisher, the rest are DNF).
setInterval(() => {
  matchmake();
  const now = Date.now();
  for (const m of matches.values()) {
    if (!m.started && now - m.created > 20_000) startRace(m); // don't wait forever for slow loaders
    if (m.firstFinish && now - m.firstFinish > 60_000) settle(m);
  }
}, 1000);

httpServer.listen(PORT, () => {
  const pv = providers();
  console.log(`Neon Velocity server on ws://localhost:${PORT}  (db: ${DB_PATH})  store: ${STRIPE_KEY ? `STRIPE${STRIPE_WEBHOOK_SECRET ? ' + webhook' : ' (no webhook secret!)'}${STRIPE_TAX ? ' + tax' : ''}` : TEST_MODE ? 'TEST MODE (purchases are free test grants)' : 'off'}`);
  console.log(`  sign-in: ${['google', 'discord', 'dev'].filter((k) => pv[k]).join(', ') || 'none configured'}   public: ${PUBLIC_URL}   api: ${API_URL}`);
});
