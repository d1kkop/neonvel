/**
 * Room: one Durable Object per online race. Created by the first player who joins with the match ticket, so
 * Cloudflare starts it near the players. It relays car states between the players, starts the countdown
 * when everyone has loaded, checks boost / speed plausibility, times laps for the track records, and settles
 * the race (Elo) when everyone has finished or left.
 */
import { DurableObject } from 'cloudflare:workers';
import { CARS, specFor } from '../../src/game/car/catalog';
import { BOOST } from '../../src/game/boostRules';
import { rateRace } from '../../src/net/elo';
import { playerFor, type Env, type PlayerRow } from './db';
import { readTicket, type Ticket } from './ticket';
import { ticketSecret } from './lobby';
import { judgeLap, startTiming, timeProgress, type LapTiming } from './timing';

/** Server's own generous estimate of a car's boost meter and the fastest it could possibly go. */
interface RaceCheck {
  meter: number; top: number; allowedV: number; lastT: number; lastNear: number;
  last: { s: number; x: number } | null;
  violation: number; // seconds of implausible reports
  warned: boolean;
}

interface Member {
  id: string;
  player: PlayerRow;
  ws: WebSocket | null;
  chk: RaceCheck;
  tm: LapTiming | null;
  car: string;
}

const DQ_SECONDS = 2.5;

export class Room extends DurableObject<Env> {
  private ticket: Ticket | null = null;
  private readonly members = new Map<string, Member>();
  private readonly finishes = new Map<string, number>();
  private readonly ready = new Set<string>();
  private readonly left = new Set<string>();
  private created = 0;
  private started = false;
  private done = false;
  private firstFinish: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const matchId = request.headers.get('X-Match-Id') ?? '';
    let me: Member | null = null;
    // One message at a time per player, in order ('ready' must not overtake the async 'join').
    let chain: Promise<void> = Promise.resolve();
    server.addEventListener('message', (ev) => {
      const raw = String(ev.data);
      chain = chain.then(async () => {
        let msg: { t?: string; [k: string]: unknown };
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.t === 'join') { me = await this.join(server, msg, matchId); return; }
        if (me) await this.onMessage(me, msg);
      }).catch((e) => console.log('room message error', (e as Error).message));
    });
    const gone = () => { if (me && me.ws === server) { me.ws = null; this.playerLeft(me); } };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  private send(m: Member, msg: Record<string, unknown>): void {
    try { m.ws?.send(JSON.stringify(msg)); } catch { /* closed */ }
  }

  private broadcast(msg: Record<string, unknown>, except?: Member): void {
    const s = JSON.stringify(msg);
    for (const m of this.members.values()) if (m !== except && m.ws) try { m.ws.send(s); } catch { /* closed */ }
  }

  /** A player arrives with the ticket + their session token. */
  private async join(ws: WebSocket, msg: Record<string, unknown>, matchId: string): Promise<Member | null> {
    const fail = (message: string) => { try { ws.send(JSON.stringify({ t: 'error', message })); ws.close(1008, message.slice(0, 100)); } catch { /* */ } return null; };
    const t = await readTicket(msg.ticket, ticketSecret(this.env));
    if (!t) return fail('Invalid or expired match ticket.');
    if (t.matchId !== matchId || (this.ticket && this.ticket.matchId !== t.matchId)) return fail('Wrong room.');
    const player = await playerFor(this.env.DB, msg.token);
    const entry = player && t.players.find((p) => p.id === player.id);
    if (!player || !entry) return fail('You are not in this match.');
    if (this.done) return fail('This race is over.');
    if (!this.ticket) {
      this.ticket = t;
      this.created = Date.now();
      this.timer = setInterval(() => this.tick(), 1000);
    }
    let m = this.members.get(player.id);
    if (!m) {
      const model = CARS.find((x) => x.id === entry.car.id) ?? CARS[0];
      const top = specFor(model).topSpeed;
      m = { id: player.id, player: { ...player, rating: entry.rating, games: entry.games }, ws, car: model.id, tm: null,
        chk: { meter: 1, top, allowedV: top, lastT: 0, lastNear: 0, last: null, violation: 0, warned: false } };
      this.members.set(player.id, m);
    } else m.ws = ws; // reconnect
    this.send(m, { t: 'joined', matchId: t.matchId });
    return m;
  }

  private async onMessage(m: Member, msg: { t?: string; [k: string]: unknown }): Promise<void> {
    const t = this.ticket!;
    switch (msg.t) {
      case 'ready':
        this.ready.add(m.id);
        this.maybeStart();
        break;
      case 'lapstart':
        m.tm = startTiming(t.level, m.car);
        break;
      case 'lapdone': {
        const lap = Number(msg.lap), ms = Number(msg.ms);
        if (!m.tm || !Number.isInteger(lap) || lap < 1 || !Number.isFinite(ms)) return;
        m.tm.claims.set(lap, Math.round(ms));
        await judgeLap(m.tm, lap, this.env.DB, m.player, (x) => this.send(m, x));
        break;
      }
      case 'state': {
        const st = msg.s as { s?: number; x?: number; v?: number; drift?: number; b?: number } | undefined;
        const legal = this.started && st ? this.checkState(m, st) : true;
        if (this.started && st && legal && m.tm) {
          const lap = timeProgress(m.tm, Number(st.s), Number(st.v));
          if (lap !== null) await judgeLap(m.tm, lap, this.env.DB, m.player, (x) => this.send(m, x));
        }
        // An implausible boost isn't shown to the others.
        this.broadcast({ t: 'state', id: m.id, s: legal || !st ? msg.s : { ...st, b: 0 } }, m);
        break;
      }
      case 'finish': {
        if (this.finishes.has(m.id)) return;
        const time = Number(msg.time);
        if (!Number.isFinite(time) || time <= 0) return;
        this.finishes.set(m.id, time);
        this.firstFinish ??= Date.now();
        if (this.racing().length === 0) await this.settle();
        break;
      }
      case 'leave':
        this.playerLeft(m);
        break;
    }
  }

  /** Players still racing: in the ticket, not finished, not left. */
  private racing(): string[] {
    return this.ticket ? this.ticket.players.map((p) => p.id).filter((id) => !this.finishes.has(id) && !this.left.has(id)) : [];
  }

  private maybeStart(): void {
    if (this.started || !this.ticket) return;
    if (this.ticket.players.every((p) => this.ready.has(p.id) || this.left.has(p.id))) this.startRace();
  }

  private startRace(): void {
    if (this.started || !this.ticket) return;
    this.started = true;
    // Whoever never showed up is out.
    for (const p of this.ticket.players) if (!this.members.has(p.id)) this.left.add(p.id);
    this.broadcast({ t: 'go', matchId: this.ticket.matchId, countdown: 3 });
    console.log(`race ${this.ticket.matchId.slice(0, 8)} started`);
  }

  private playerLeft(m: Member): void {
    if (this.left.has(m.id) || this.done) return;
    this.left.add(m.id);
    this.broadcast({ t: 'left', id: m.id }, m);
    if (this.racing().length === 0) void this.settle();
    else this.maybeStart();
  }

  private tick(): void {
    const now = Date.now();
    if (!this.started && now - this.created > 20_000) this.startRace(); // don't wait forever for slow loaders
    if (this.firstFinish && now - this.firstFinish > 60_000) void this.settle();
    if (this.done && [...this.members.values()].every((m) => !m.ws)) { if (this.timer) clearInterval(this.timer); this.timer = null; }
  }

  /** Plausibility check of one reported state. Returns false when the reported boost isn't possible. */
  private checkState(m: Member, st: { s?: number; x?: number; v?: number; drift?: number; b?: number }): boolean {
    const k = m.chk;
    if (typeof st.s !== 'number' || typeof st.v !== 'number') return true;
    const now = Date.now();
    const dt = k.lastT ? Math.min(0.5, (now - k.lastT) / 1000) : 0;
    k.lastT = now;
    const boosting = st.b === 1;
    let near = false;
    for (const o of this.members.values()) {
      if (o === m || !o.chk.last) continue;
      if (Math.abs(o.chk.last.s - st.s) < 7 && Math.abs(o.chk.last.x - (st.x ?? 0)) < 3.2) near = true;
    }
    if (near && now - k.lastNear > BOOST.hitCooldown * 1000) k.meter = Math.min(1, k.meter + BOOST.hitGain * 1.15);
    if (near) k.lastNear = now;
    if (Math.abs(st.drift ?? 0) > 0.1 && st.v > 15) k.meter = Math.min(1, k.meter + BOOST.driftGain * 1.25 * dt);
    if (!boosting && st.v > BOOST.cruiseSpeed * 0.9) k.meter = Math.min(1, k.meter + BOOST.cruiseGain * 1.25 * dt);
    if (boosting) k.meter -= BOOST.burn * 0.85 * dt;
    k.meter = Math.max(-0.3, k.meter);
    const illegalBoost = boosting && k.meter < -0.12;
    const base = k.top * 1.04 + 3 + (now - k.lastNear < 1000 ? 8 : 0);
    if (boosting && !illegalBoost) k.allowedV = Math.max(k.allowedV, k.top * BOOST.top * 1.04 + BOOST.kick + 3);
    else k.allowedV = base + Math.max(0, k.allowedV - base) * Math.exp(-1.3 * dt);
    k.allowedV = Math.max(k.allowedV, base);
    let bad = illegalBoost || st.v > k.allowedV;
    if (k.last && dt > 0 && Math.abs(st.s - k.last.s) > k.allowedV * Math.max(dt, 0.05) * 1.6 + 15) { bad = true; k.violation += 0.5; }
    if (bad) k.violation += dt;
    k.last = { s: st.s, x: st.x ?? 0 };
    if (!k.warned && k.violation > 1) {
      k.warned = true;
      this.send(m, { t: 'warn', message: 'Boost / speed check failed — keep it up and you will be disqualified.' });
    }
    return !illegalBoost;
  }

  /** Rank by finish time (DNF behind, disqualified last), update Elo in the database, tell everyone. */
  private async settle(): Promise<void> {
    if (this.done || !this.ticket) return;
    this.done = true;
    const t = this.ticket;
    const ids = t.players.map((p) => p.id);
    const isDq = (id: string) => (this.members.get(id)?.chk.violation ?? 0) > DQ_SECONDS;
    const finished = ids.filter((id) => this.finishes.has(id) && !this.left.has(id) && !isDq(id)).sort((a, b) => this.finishes.get(a)! - this.finishes.get(b)!);
    const dnf = ids.filter((id) => (!this.finishes.has(id) || this.left.has(id)) && !isDq(id));
    const dq = ids.filter(isDq);
    const order = [...finished, ...dnf, ...dq];
    const table: Record<string, { rating: number; games: number }> = {};
    for (const p of t.players) table[p.id] = { rating: p.rating, games: p.games };
    const ratings = rateRace(order, table);
    const db = this.env.DB;
    await db.batch([
      ...ids.map((id) => db.prepare('UPDATE players SET rating = ?, games = games + 1, wins = wins + ? WHERE id = ?').bind(ratings[id], order[0] === id ? 1 : 0, id)),
      db.prepare('INSERT OR IGNORE INTO races (id, level, finished, result) VALUES (?, ?, ?, ?)').bind(t.matchId, t.level, Date.now(), JSON.stringify({ order, ratings, times: Object.fromEntries(this.finishes) })),
    ]);
    this.broadcast({ t: 'result', matchId: t.matchId, order, ratings, times: Object.fromEntries(this.finishes), dq });
    console.log(`result ${t.matchId.slice(0, 8)}: ${order.map((id) => `${t.players.find((p) => p.id === id)?.name}→${ratings[id]}`).join(', ')}`);
  }
}
