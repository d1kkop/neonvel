import type { LeaderRow } from '../app/Menu';

export interface NetPlayer {
  id: string;
  name: string;
  rating: number;
  car: { id: string; paint: string };
}

/** Car state sent ~15x per second during an online race. */
export interface NetCarState {
  /** 1 while boosting (so the others see the flames / trails). */
  b?: number;
  s: number;
  x: number;
  psi: number;
  phi: number;
  v: number;
  steer: number;
  drift: number;
}

/** Messages exchanged with the matchmaking server (see /server). */
export type ServerMsg =
  | { t: 'welcome'; id: string; name: string; rating: number; games: number; owned?: string[] }
  | { t: 'queued'; size: number; range: number; found?: number; max?: number; waited?: number; wait?: number }
  | { t: 'match'; matchId: string; levelId: string; weather: string; laps: number; you: string; players: NetPlayer[]; ticket?: string }
  | { t: 'joined'; matchId: string }
  | { t: 'go'; matchId: string; countdown: number }
  | { t: 'state'; id: string; s: NetCarState }
  | { t: 'left'; id: string }
  | { t: 'result'; matchId: string; ratings: Record<string, number>; order: string[]; times: Record<string, number>; dq?: string[] }
  | { t: 'warn'; message: string }
  | { t: 'leaderboard'; rows: { name: string; rating: number; games: number }[] }
  | { t: 'lap'; level: string; lap?: number; ms: number; best?: number; improved?: boolean; rank?: number; rejected?: string; error?: string }
  | { t: 'error'; message: string; code?: string };

/** Messages that belong to a running online race: they go to the race room (when the server uses rooms). */
const ROOM_MSGS = new Set(['ready', 'state', 'finish', 'leave', 'lapstart', 'lapdone']);

/**
 * Thin WebSocket client for matchmaking + leaderboard. The server is authoritative for ratings.
 * Two connections: the lobby (always) and, during an online race, that race's room. The Cloudflare server
 * hands out a signed ticket with the match; the room then starts in the data centre nearest the players.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private room: WebSocket | null = null;
  private roomQueue: string[] = [];
  private token = '';
  private connecting: Promise<void> | null = null;
  onMessage?: (m: ServerMsg) => void;
  onClose?: () => void;

  constructor(private url: string) {}

  setUrl(url: string): void {
    if (url !== this.url) {
      this.close();
      this.url = url;
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(timeoutMs = 3000): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this.connecting = null;
        reject(e);
        return;
      }
      const timer = window.setTimeout(() => {
        ws.close();
        this.connecting = null;
        reject(new Error('timeout'));
      }, timeoutMs);
      ws.onopen = () => {
        window.clearTimeout(timer);
        this.ws = ws;
        this.connecting = null;
        resolve();
      };
      ws.onerror = () => {
        window.clearTimeout(timer);
        this.connecting = null;
        reject(new Error('connection failed'));
      };
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        this.onClose?.();
      };
      ws.onmessage = (ev) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return; // ignore malformed
        }
        if (m.t === 'match' && m.ticket) this.openRoom(m.matchId, m.ticket);
        this.onMessage?.(m);
      };
    });
    return this.connecting;
  }

  send(msg: Record<string, unknown>): void {
    if (msg.t === 'hello' && typeof msg.token === 'string') this.token = msg.token;
    if (this.room && ROOM_MSGS.has(String(msg.t))) {
      const s = JSON.stringify(msg);
      if (this.room.readyState === WebSocket.OPEN) this.room.send(s);
      else if (this.room.readyState === WebSocket.CONNECTING) this.roomQueue.push(s);
      if (msg.t === 'leave') this.closeRoom();
      return;
    }
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  /** Join the race room for a match (address: the lobby's, with /room/<matchId>). */
  private openRoom(matchId: string, ticket: string): void {
    this.closeRoom();
    const base = this.url.replace(/\/ws\/?$/, '').replace(/\/$/, '');
    const ws = new WebSocket(`${base}/room/${matchId}`);
    this.room = ws;
    this.roomQueue = [JSON.stringify({ t: 'join', ticket, token: this.token })];
    ws.onopen = () => {
      for (const s of this.roomQueue) ws.send(s);
      this.roomQueue = [];
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (m.t === 'joined') return;
      this.onMessage?.(m);
      if (m.t === 'result') window.setTimeout(() => { if (this.room === ws) this.closeRoom(); }, 500);
    };
    ws.onclose = () => {
      if (this.room === ws) this.room = null;
    };
  }

  private closeRoom(): void {
    const r = this.room;
    this.room = null;
    this.roomQueue = [];
    if (r) window.setTimeout(() => r.close(), 300); // let a last message (leave) go out first
  }

  close(): void {
    this.closeRoom();
    this.ws?.close();
    this.ws = null;
  }

  static toRows(rows: { name: string; rating: number; games: number }[], me: string): LeaderRow[] {
    return rows.map((r, i) => ({ rank: i + 1, name: r.name, rating: r.rating, games: r.games, isMe: r.name === me }));
  }
}
