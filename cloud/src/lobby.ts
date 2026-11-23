/**
 * Lobby (one Durable Object for everyone): hello / sign-in check, matchmaking queue, leaderboard requests,
 * and lap timing for quick races against the AI. A found match is handed to the players as a signed ticket;
 * the race itself runs in a Room (see room.ts) near the players.
 *
 * Elo matchmaking: the oldest waiting player picks the closest-rated compatible players; the rating window
 * widens the longer you wait (±100 at once, +25 per second, max ±600). A full lobby (4) starts at once,
 * otherwise after each player's chosen wait time (15 / 30 / 45 s).
 */
import { DurableObject } from 'cloudflare:workers';
import { CARS, classOf } from '../../src/game/car/catalog';
import { LEVEL_PRICES } from '../../src/game/products';
import { defaultLaps } from '../../src/game/laps';
import { config, leaderboard, LEVELS, owned, playerById, playerFor, type Env, type PlayerRow } from './db';
import { judgeLap, startTiming, timeProgress, type LapTiming } from './timing';
import { signTicket, type TicketPlayer } from './ticket';

const WEATHERS = ['clear', 'clear', 'rain', 'storm'];
const MAX_PLAYERS = 4;

interface Client {
  ws: WebSocket;
  player: PlayerRow | null;
  queuedAt: number | null;
  wait: number;
  inMatch: boolean;
  car: { id: string; paint: string } | null;
  tm: LapTiming | null;
  ttLevel?: string;
  ttCar?: string;
  /** Owned items, read when queueing (which levels the lobby may pick). */
  owned: string[];
}

export function ticketSecret(env: Env): string {
  if (env.TICKET_SECRET) return env.TICKET_SECRET;
  if (config(env).IS_PROD) throw new Error('TICKET_SECRET is not set');
  return 'local-development-ticket-secret';
}

export class Lobby extends DurableObject<Env> {
  private readonly clients = new Set<Client>();
  private timer: ReturnType<typeof setInterval> | null = null;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const c: Client = { ws: server, player: null, queuedAt: null, wait: 30, inMatch: false, car: null, tm: null, owned: [] };
    this.clients.add(c);
    // One message at a time per player, in order (database calls are async: 'queue' must not overtake 'hello').
    let chain: Promise<void> = Promise.resolve();
    server.addEventListener('message', (ev) => {
      const raw = String(ev.data);
      chain = chain.then(() => this.onMessage(c, raw)).catch((e) => console.log('lobby message error', (e as Error).message));
    });
    const gone = () => { this.clients.delete(c); if (!this.queue().length) this.stopTimer(); };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  private send(c: Client, msg: Record<string, unknown>): void {
    try { c.ws.send(JSON.stringify(msg)); } catch { /* closed */ }
  }

  private queue(): Client[] {
    return [...this.clients].filter((c) => c.queuedAt !== null && c.player && !c.inMatch);
  }

  /** Matchmaking runs every second while anyone is queued (and stops when the queue is empty). */
  private startTimer(): void {
    this.timer ??= setInterval(() => void this.matchmake().catch((e) => console.log('matchmake error', (e as Error).message)), 1000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async onMessage(c: Client, raw: string): Promise<void> {
    let msg: { t?: string; [k: string]: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    const db = this.env.DB;
    switch (msg.t) {
      case 'hello': {
        const p = await playerFor(db, msg.token);
        if (!p) return this.send(c, { t: 'error', code: 'auth', message: 'Sign in with Google or Discord first.' });
        c.player = p;
        c.owned = await owned(db, p.id);
        this.send(c, { t: 'welcome', id: p.id, name: p.name, rating: p.rating, games: p.games, owned: c.owned, storeMode: config(this.env).storeMode });
        break;
      }
      case 'timing': {
        // A quick race is about to start (level + car); 'lapstart' marks the green light, 'tt' reports follow.
        if (!c.player) return;
        c.tm = null;
        c.ttLevel = String(msg.level ?? '');
        c.ttCar = String(msg.car ?? '');
        break;
      }
      case 'lapstart': {
        if (!c.player || !c.ttLevel) return;
        c.tm = startTiming(c.ttLevel, c.ttCar ?? 'vortex');
        break;
      }
      case 'tt': {
        if (!c.player || !c.tm) return;
        const lap = timeProgress(c.tm, Number(msg.s), Number(msg.v));
        if (lap !== null) await judgeLap(c.tm, lap, db, c.player, (m) => this.send(c, m));
        break;
      }
      case 'lapdone': {
        const k = c.tm;
        const lap = Number(msg.lap), ms = Number(msg.ms);
        if (!k || !c.player || !Number.isInteger(lap) || lap < 1 || !Number.isFinite(ms)) return;
        k.claims.set(lap, Math.round(ms));
        await judgeLap(k, lap, db, c.player, (m) => this.send(c, m));
        break;
      }
      case 'queue': {
        if (!c.player) return this.send(c, { t: 'error', message: 'Say hello first.' });
        // Fresh rating + purchases (they change after every race / buy).
        c.player = (await playerById(db, c.player.id)) ?? c.player;
        c.owned = await owned(db, c.player.id);
        const carId = String((msg.car as { id?: string } | undefined)?.id ?? 'vortex');
        const paint = String((msg.car as { paint?: string } | undefined)?.paint ?? '').slice(0, 9);
        const model = CARS.find((x) => x.id === carId);
        const allowed = model && (model.price === 0 || c.owned.includes(carId));
        c.car = { id: allowed ? carId : 'vortex', paint: /^#[0-9a-f]{6}$/i.test(paint) ? paint : '' };
        const wait = Number(msg.wait);
        c.wait = [15, 30, 45].includes(wait) ? wait : 30;
        // Already searching (e.g. the wait time was changed): keep the time waited so far.
        if (c.queuedAt === null || c.inMatch) c.queuedAt = Date.now();
        c.inMatch = false;
        this.startTimer();
        await this.matchmake();
        break;
      }
      case 'cancel':
        c.queuedAt = null;
        break;
      case 'leave':
        c.inMatch = false;
        break;
      case 'leaderboard':
        this.send(c, { t: 'leaderboard', rows: await leaderboard(db) });
        break;
    }
  }

  private async matchmake(): Promise<void> {
    const now = Date.now();
    const windowFor = (c: Client) => Math.min(600, 100 + ((now - (c.queuedAt ?? now)) / 1000) * 25);
    const waitedFor = (c: Client) => (now - (c.queuedAt ?? now)) / 1000;
    const waiting = this.queue().sort((a, b) => a.queuedAt! - b.queuedAt!);
    if (!waiting.length) return this.stopTimer();
    const used = new Set<Client>();
    for (const anchor of waiting) {
      if (used.has(anchor)) continue;
      const ra = anchor.player!.rating;
      const candidates = waiting
        .filter((o) => o !== anchor && !used.has(o))
        .filter((o) => classOf(o.car?.id ?? 'vortex') === classOf(anchor.car?.id ?? 'vortex')) // buses only race buses
        .filter((o) => { const d = Math.abs(o.player!.rating - ra); return d <= windowFor(anchor) && d <= windowFor(o); })
        .sort((a, b) => Math.abs(a.player!.rating - ra) - Math.abs(b.player!.rating - ra));
      if (!candidates.length) continue;
      // A full lobby starts at once. Otherwise the SHORTEST wait time in the group counts: as soon as everybody
      // has waited that long, they race (30 s + 15 s → the race starts once both have waited 15 s).
      const group = [anchor, ...candidates.slice(0, MAX_PLAYERS - 1)];
      if (group.length < MAX_PLAYERS) {
        const minWait = Math.min(...group.map((c) => c.wait));
        if (!group.every((c) => waitedFor(c) >= minWait)) continue;
      }
      group.forEach((c) => used.add(c));
      await this.startMatch(group);
    }
    const left = this.queue();
    for (const c of left) {
      const found = 1 + left.filter((o) => o !== c && Math.abs(o.player!.rating - c.player!.rating) <= Math.min(windowFor(c), windowFor(o))).length;
      this.send(c, { t: 'queued', size: left.length, range: Math.round(windowFor(c)), found: Math.min(MAX_PLAYERS, found), max: MAX_PLAYERS, waited: Math.floor(waitedFor(c)), wait: c.wait });
    }
  }

  private async startMatch(group: Client[]): Promise<void> {
    // Only levels every player in the lobby can race on.
    const ok = LEVELS.filter((l) => (LEVEL_PRICES[l] ?? 0) === 0 || group.every((c) => c.owned.includes(`level:${l}`)));
    const level = ok[Math.floor(Math.random() * ok.length)];
    const weather = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
    const matchId = crypto.randomUUID();
    const players: TicketPlayer[] = group.map((c) => ({ id: c.player!.id, name: c.player!.name, rating: c.player!.rating, games: c.player!.games, car: c.car ?? { id: 'vortex', paint: '' } }));
    const laps = defaultLaps(level);
    const ticket = await signTicket({ matchId, level, weather, laps, players, exp: Date.now() + 10 * 60_000 }, ticketSecret(this.env));
    for (const c of group) {
      c.queuedAt = null;
      c.inMatch = true;
      c.tm = null;
      this.send(c, { t: 'match', matchId, levelId: level, weather, laps, players: players.map(({ games: _g, ...p }) => p), you: c.player!.id, ticket });
    }
    console.log(`match ${matchId.slice(0, 8)} ${level}: ${players.map((p) => `${p.name}(${p.rating})`).join(' vs ')}`);
  }
}
