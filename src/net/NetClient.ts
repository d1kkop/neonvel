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
  | { t: 'match'; matchId: string; levelId: string; weather: string; laps: number; you: string; players: NetPlayer[] }
  | { t: 'go'; matchId: string; countdown: number }
  | { t: 'state'; id: string; s: NetCarState }
  | { t: 'left'; id: string }
  | { t: 'result'; matchId: string; ratings: Record<string, number>; order: string[]; times: Record<string, number>; dq?: string[] }
  | { t: 'warn'; message: string }
  | { t: 'leaderboard'; rows: { name: string; rating: number; games: number }[] }
  | { t: 'error'; message: string };

/**
 * Thin WebSocket client for matchmaking + leaderboard. The server is authoritative for ratings.
 */
export class NetClient {
  private ws: WebSocket | null = null;
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
        try {
          this.onMessage?.(JSON.parse(String(ev.data)) as ServerMsg);
        } catch {
          /* ignore malformed */
        }
      };
    });
    return this.connecting;
  }

  send(msg: Record<string, unknown>): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  static toRows(rows: { name: string; rating: number; games: number }[], me: string): LeaderRow[] {
    return rows.map((r, i) => ({ rank: i + 1, name: r.name, rating: r.rating, games: r.games, isMe: r.name === me }));
  }
}
