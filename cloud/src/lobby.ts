/**
 * Lobby (one Durable Object for everyone): hello / sign-in check, the live list of player-hosted lobbies,
 * leaderboard requests, and lap timing for quick races against the AI. The host starts a race from a lobby;
 * the match is handed to the players as a signed ticket and runs in a Room (see room.ts) near the players.
 */
import { DurableObject } from 'cloudflare:workers';
import { CARS } from '../../src/game/car/catalog';
import { LEVEL_PRICES } from '../../src/game/products';
import { config, leaderboard, LEVELS, owned, playerById, playerFor, type Env, type PlayerRow } from './db';
import { judgeLap, startTiming, timeProgress, type LapTiming } from './timing';
import { signTicket, type TicketPlayer } from './ticket';

const WEATHERS = ['clear', 'rain', 'storm'];

interface Client {
  ws: WebSocket;
  player: PlayerRow | null;
  inMatch: boolean;
  car: { id: string; paint: string } | null;
  tm: LapTiming | null;
  ttLevel?: string;
  ttCar?: string;
  /** Owned items, read when joining / hosting (which levels and cars may be picked). */
  owned: string[];
  party: Party | null;
  ready: boolean;
}

/** A player-hosted lobby. */
interface Party {
  id: string;
  host: Client;
  level: string;
  laps: number;
  weather: string;
  max: number;
  status: 'waiting' | 'racing';
  members: Client[];
}

export function ticketSecret(env: Env): string {
  if (env.TICKET_SECRET) return env.TICKET_SECRET;
  if (config(env).IS_PROD) throw new Error('TICKET_SECRET is not set');
  return 'local-development-ticket-secret';
}

export class Lobby extends DurableObject<Env> {
  private readonly clients = new Set<Client>();
  private readonly parties = new Map<string, Party>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const c: Client = { ws: server, player: null, inMatch: false, car: null, tm: null, owned: [], party: null, ready: false };
    this.clients.add(c);
    // One message at a time per player, in order (database calls are async: 'host' must not overtake 'hello').
    let chain: Promise<void> = Promise.resolve();
    server.addEventListener('message', (ev) => {
      const raw = String(ev.data);
      chain = chain.then(() => this.onMessage(c, raw)).catch((e) => console.log('lobby message error', (e as Error).message));
    });
    const gone = () => { this.leaveParty(c, false); this.clients.delete(c); this.pushList(); };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  private send(c: Client, msg: Record<string, unknown>): void {
    try { c.ws.send(JSON.stringify(msg)); } catch { /* closed */ }
  }

  private online(): number {
    return [...this.clients].filter((c) => c.player).length;
  }

  private partyView(p: Party, members = false): Record<string, unknown> {
    return {
      id: p.id, host: p.host.player!.name, hostId: p.host.player!.id, level: p.level, laps: p.laps, weather: p.weather,
      max: p.max, status: p.status, n: p.members.length,
      ...(members ? { members: p.members.map((m) => ({ id: m.player!.id, name: m.player!.name, car: m.car, ready: m === p.host || m.ready })) } : {}),
    };
  }

  /** The lobby list goes to everybody who is signed in and not inside a lobby. */
  private pushList(): void {
    const lobbies = [...this.parties.values()].map((p) => this.partyView(p));
    const online = this.online();
    for (const c of this.clients) if (c.player && !c.party) this.send(c, { t: 'lobbies', lobbies, online });
  }

  private pushParty(p: Party): void {
    const view = this.partyView(p, true);
    for (const m of p.members) this.send(m, { t: 'lobby', lobby: view });
  }

  private leaveParty(c: Client, tell = true): void {
    const p = c.party;
    if (!p) return;
    c.party = null;
    c.ready = false;
    p.members = p.members.filter((m) => m !== c);
    if (!p.members.length) this.parties.delete(p.id);
    else {
      if (p.host === c) p.host = p.members[0]; // the next player becomes host
      this.pushParty(p);
    }
    if (tell) this.send(c, { t: 'lobby', lobby: null });
  }

  /** The car (if the player may drive it) with a valid hex paint: never an empty colour. */
  private resolveCar(c: Client, car: unknown): { id: string; paint: string } {
    const raw = car as { id?: unknown; paint?: unknown } | undefined;
    const fallback = CARS.find((x) => x.id === 'vortex')!;
    const asked = CARS.find((x) => x.id === String(raw?.id ?? ''));
    const model = asked && (asked.price === 0 || c.owned.includes(asked.id)) ? asked : fallback;
    const paint = String(raw?.paint ?? '');
    return { id: model.id, paint: model === asked && /^#[0-9a-f]{6}$/i.test(paint) ? paint.toLowerCase() : model.paint };
  }

  private async refresh(c: Client): Promise<void> {
    c.player = (await playerById(this.env.DB, c.player!.id)) ?? c.player;
    c.owned = await owned(this.env.DB, c.player!.id);
  }

  private levelOk(c: Client, level: unknown): level is string {
    return typeof level === 'string' && LEVELS.includes(level) && ((LEVEL_PRICES[level] ?? 0) === 0 || c.owned.includes(`level:${level}`));
  }

  private lapsOf(v: unknown, fallback: number): number {
    const n = Math.round(Number(v));
    return n >= 1 && n <= 5 ? n : fallback;
  }

  private async onMessage(c: Client, raw: string): Promise<void> {
    let msg: { t?: string; [k: string]: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    const db = this.env.DB;
    switch (msg.t) {
      case 'hello': {
        const p = await playerFor(db, msg.token);
        if (!p) return this.send(c, { t: 'error', code: 'auth', message: 'Sign in with Google first.' });
        c.player = p;
        c.owned = await owned(db, p.id);
        this.send(c, { t: 'welcome', id: p.id, name: p.name, rating: p.rating, games: p.games, owned: c.owned, storeMode: config(this.env).storeMode });
        this.pushList();
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
      case 'host': {
        if (!c.player) return this.send(c, { t: 'error', message: 'Say hello first.' });
        await this.refresh(c);
        this.leaveParty(c, false);
        if (!this.levelOk(c, msg.level)) return this.send(c, { t: 'error', message: 'That level is not unlocked.' });
        c.car = this.resolveCar(c, msg.car);
        c.ready = false;
        const max = Math.round(Number(msg.max));
        const p: Party = {
          id: crypto.randomUUID().slice(0, 8), host: c, level: msg.level, laps: this.lapsOf(msg.laps, 2),
          weather: WEATHERS.includes(String(msg.weather)) ? String(msg.weather) : 'clear',
          max: max >= 2 && max <= 8 ? max : 8, status: 'waiting', members: [c],
        };
        c.party = p;
        this.parties.set(p.id, p);
        this.pushParty(p);
        this.pushList();
        break;
      }
      case 'join': {
        if (!c.player) return this.send(c, { t: 'error', message: 'Say hello first.' });
        const p = this.parties.get(String(msg.id));
        if (!p || p.status !== 'waiting' || p.members.length >= p.max) return this.send(c, { t: 'error', message: 'That lobby is full or already racing.' });
        if (c.party === p) return;
        await this.refresh(c);
        this.leaveParty(c, false);
        c.car = this.resolveCar(c, msg.car);
        c.ready = false;
        c.party = p;
        p.members.push(c);
        this.pushParty(p);
        this.pushList();
        break;
      }
      case 'lcar': {
        const p = c.party;
        if (!p || !c.player || p.status !== 'waiting') return;
        c.owned = await owned(db, c.player.id);
        c.car = this.resolveCar(c, msg.car);
        this.pushParty(p);
        break;
      }
      case 'lready': {
        const p = c.party;
        if (!p || p.status !== 'waiting') return;
        c.ready = !!msg.ready;
        this.pushParty(p);
        break;
      }
      case 'lset': {
        const p = c.party;
        if (!p || p.host !== c || p.status !== 'waiting') return;
        if (msg.level !== undefined && this.levelOk(c, msg.level)) p.level = msg.level;
        if (msg.laps !== undefined) p.laps = this.lapsOf(msg.laps, p.laps);
        if (WEATHERS.includes(String(msg.weather))) p.weather = String(msg.weather);
        this.pushParty(p);
        this.pushList();
        break;
      }
      case 'lstart': {
        const p = c.party;
        if (!p || p.host !== c || p.status !== 'waiting') return;
        if (!p.members.every((m) => m === c || m.ready)) return this.send(c, { t: 'error', message: 'Not everybody is ready yet.' });
        await this.startMatch(p);
        break;
      }
      case 'lback': {
        // Back from the race results: the lobby opens again with everybody not ready.
        const p = c.party;
        c.inMatch = false;
        if (!p || p.status !== 'racing') return;
        p.status = 'waiting';
        for (const m of p.members) m.ready = false;
        this.pushParty(p);
        this.pushList();
        break;
      }
      case 'lleave':
        this.leaveParty(c);
        c.inMatch = false;
        this.send(c, { t: 'lobbies', lobbies: [...this.parties.values()].map((x) => this.partyView(x)), online: this.online() });
        this.pushList();
        break;
      case 'leaderboard':
        this.send(c, { t: 'leaderboard', rows: await leaderboard(db, c.player ?? null) });
        break;
    }
  }

  private async startMatch(p: Party): Promise<void> {
    for (const m of p.members) await this.refresh(m); // fresh ratings
    const matchId = crypto.randomUUID();
    const players: TicketPlayer[] = p.members.map((c) => ({ id: c.player!.id, name: c.player!.name, rating: c.player!.rating, games: c.player!.games, car: c.car ?? this.resolveCar(c, null) }));
    const ticket = await signTicket({ matchId, level: p.level, weather: p.weather, laps: p.laps, players, exp: Date.now() + 10 * 60_000 }, ticketSecret(this.env));
    p.status = 'racing';
    for (const c of p.members) {
      c.inMatch = true;
      c.tm = null;
      this.send(c, { t: 'match', matchId, levelId: p.level, weather: p.weather, laps: p.laps, players: players.map(({ games: _g, ...q }) => q), you: c.player!.id, ticket });
    }
    this.pushParty(p);
    this.pushList();
    console.log(`match ${matchId.slice(0, 8)} ${p.level}: ${players.map((q) => `${q.name}(${q.rating})`).join(' vs ')}`);
  }
}
