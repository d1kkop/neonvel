/**
 * Neon Velocity matchmaking server.
 *  - WebSocket (default port 8787) for hello / queue / race relay / results / leaderboard
 *  - HTTP GET /leaderboard for a JSON leaderboard
 *  - SQLite (node:sqlite, no native deps) stores players + ratings + race history
 *  - Elo matchmaking: the search window widens the longer you wait
 *
 * Run: npm run server   (Node 22.6+ with TypeScript type-stripping; Node 24 recommended)
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer, WebSocket } from 'ws';
import { rateRace, START_RATING } from '../src/net/elo.ts';
import { CARS, specFor, classOf } from '../src/game/car/catalog.ts';
import { BOOST } from '../src/game/boostRules.ts';
import { LEVEL_NAMES, LEVEL_PRICES } from '../src/game/products.ts';

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
const qFind = db.prepare('SELECT id, name, rating, games, wins FROM players WHERE name = ?');
const qInsert = db.prepare('INSERT INTO players (id, name, rating, games, wins, created) VALUES (?, ?, ?, 0, 0, ?)');
const qUpdate = db.prepare('UPDATE players SET rating = ?, games = games + 1, wins = wins + ? WHERE id = ?');
const qTop = db.prepare('SELECT name, rating, games, wins FROM players WHERE games > 0 ORDER BY rating DESC LIMIT 25');
const qRace = db.prepare('INSERT INTO races (id, level, finished, result) VALUES (?, ?, ?, ?)');

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
const TEST_MODE = !STRIPE_KEY && process.env.STORE_TEST_MODE !== '0';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? 'http://localhost:5173/').replace(/\/?$/, '/');
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
async function checkout(name: string, item: string): Promise<Record<string, unknown>> {
  const product = PRODUCTS.get(item);
  if (!product) return { error: 'Unknown item.' };
  const player = getOrCreate(name);
  if (owned(player.id).includes(item)) return { granted: true, owned: owned(player.id) };
  if (STRIPE_KEY) {
    const session = await stripe('POST', 'checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
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

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 10_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}

interface PlayerRow { id: string; name: string; rating: number; games: number; wins: number }

function getOrCreate(name: string): PlayerRow {
  const found = qFind.get(name) as PlayerRow | undefined;
  if (found) return found;
  const id = randomUUID();
  qInsert.run(id, name, START_RATING, Date.now());
  return { id, name, rating: START_RATING, games: 0, wins: 0 };
}

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
  for (const c of group) send(c, { t: 'match', matchId: m.id, levelId: m.level, weather, laps: 3, players, you: c.player!.id });
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
      const name = String(msg.name ?? '').trim().replace(/[^\w .\-]/g, '').slice(0, 16) || `Guest${Math.floor(Math.random() * 9999)}`;
      c.player = getOrCreate(name);
      send(c, { t: 'welcome', id: c.player.id, name: c.player.name, rating: c.player.rating, games: c.player.games, owned: owned(c.player.id), storeMode: STRIPE_KEY ? 'stripe' : TEST_MODE ? 'test' : 'off' });
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const json = (o: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  try {
    if (url.pathname === '/store/info') return json({ mode: STRIPE_KEY ? 'stripe' : TEST_MODE ? 'test' : 'off' });
    if (url.pathname === '/store/owned') {
      const name = String(url.searchParams.get('name') ?? '').trim().slice(0, 16);
      return json({ owned: name ? owned(getOrCreate(name).id) : [] });
    }
    if (url.pathname === '/store/checkout' && req.method === 'POST') {
      const body = await readJson(req);
      const name = String(body.name ?? '').trim().replace(/[^\w .\-]/g, '').slice(0, 16);
      if (!name) return json({ error: 'Enter a driver name first (Netplay screen).' }, 400);
      return json(await checkout(name, String(body.item ?? '')));
    }
    if (url.pathname === '/store/confirm') return json(await confirm(String(url.searchParams.get('session_id') ?? '')));
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
  const c: Client = { ws, player: null, queuedAt: null, wait: 30, matchId: null, car: null, chk: null };
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

httpServer.listen(PORT, () => console.log(`Neon Velocity server on ws://localhost:${PORT}  (db: ${DB_PATH})  store: ${STRIPE_KEY ? 'STRIPE (live/test key)' : TEST_MODE ? 'TEST MODE (purchases are free test grants)' : 'off'}`));
