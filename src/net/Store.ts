/**
 * Client side of the car store. The server owns prices and decides what a player owns;
 * this only asks. Free cars never need the server.
 */
import { serverHttp } from './serverUrl';

export type StoreMode = 'stripe' | 'test' | 'off' | 'offline';

export interface LapBoard {
  level: string;
  /** Fastest first, at most 50. */
  top: { name: string; ms: number; car: string }[];
  /** The asking driver's own place and time (also when outside the top 50); null = no lap on this track yet. */
  me: { rank: number; ms: number } | null;
  total: number;
}

export interface Profile { id: string; name: string; rating: number; games: number; owned: string[] }

export class Store {
  private readonly base = serverHttp();

  /** Sign-in options the server offers. */
  async providers(): Promise<{ google: boolean; dev: boolean } | null> {
    try {
      return (await (await fetch(`${this.base}/auth/providers`, { signal: AbortSignal.timeout(2500) })).json()) as { google: boolean; dev: boolean };
    } catch {
      return null;
    }
  }

  /** Go to the sign-in page (Google); it comes back to this page with the session in the address. */
  signIn(provider: 'google' | 'dev', devName = ''): void {
    const ret = window.location.origin + window.location.pathname;
    window.location.href = `${this.base}/auth/${provider}/start?return=${encodeURIComponent(ret)}${provider === 'dev' ? `&name=${encodeURIComponent(devName)}` : ''}`;
  }

  /** The signed-in player (null = token no longer valid, undefined = server offline). */
  async me(token: string, timeoutMs = 10000): Promise<Profile | null | undefined> {
    try {
      const r = await fetch(`${this.base}/auth/me?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(timeoutMs) });
      return r.status === 401 ? null : ((await r.json()) as Profile);
    } catch {
      return undefined;
    }
  }

  async rename(token: string, name: string): Promise<{ name?: string; error?: string }> {
    try {
      const r = await fetch(`${this.base}/auth/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, name }), signal: AbortSignal.timeout(4000) });
      return (await r.json()) as { name?: string; error?: string };
    } catch {
      return { error: 'Server offline.' };
    }
  }

  async signOut(token: string): Promise<void> {
    try {
      await fetch(`${this.base}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(3000) });
    } catch { /* offline: forget it locally anyway */ }
  }

  async mode(): Promise<StoreMode> {
    try {
      const r = await fetch(`${this.base}/store/info`, { signal: AbortSignal.timeout(2500) });
      return ((await r.json()) as { mode: StoreMode }).mode;
    } catch {
      return 'offline';
    }
  }

  async leaderboard(token = ''): Promise<{ name: string; rating: number; games: number; rank?: number }[] | null> {
    try {
      const r = await fetch(`${this.base}/leaderboard${token ? `?token=${encodeURIComponent(token)}` : ''}`, { signal: AbortSignal.timeout(2500) });
      return (await r.json()) as { name: string; rating: number; games: number }[];
    } catch {
      return null;
    }
  }

  /** A track's fastest-lap board: the top 50 and where `name` stands. null = server offline. */
  async lapBoard(level: string, token: string): Promise<LapBoard | null> {
    try {
      const r = await fetch(`${this.base}/laptimes?level=${encodeURIComponent(level)}&token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(2500) });
      return (await r.json()) as LapBoard;
    } catch {
      return null;
    }
  }

  async owned(token: string): Promise<string[] | null> {
    if (!token) return [];
    try {
      const r = await fetch(`${this.base}/store/owned?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(2500) });
      return ((await r.json()) as { owned: string[] }).owned;
    } catch {
      return null;
    }
  }

  /** Starts a purchase. Stripe: redirects to checkout. Test mode: granted immediately. */
  async buy(token: string, item: string): Promise<{ granted?: boolean; test?: boolean; owned?: string[]; error?: string; redirected?: boolean }> {
    try {
      const r = await fetch(`${this.base}/store/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, item }),
        signal: AbortSignal.timeout(8000),
      });
      const res = (await r.json()) as { url?: string; granted?: boolean; test?: boolean; owned?: string[]; error?: string };
      if (res.url) {
        window.location.href = res.url; // Stripe Checkout
        return { redirected: true };
      }
      return res;
    } catch {
      return { error: 'Store server offline. Start it with "npm run server".' };
    }
  }

  /** Call on page load: completes a Stripe purchase after the redirect back. */
  async confirmFromUrl(): Promise<{ item?: string; owned?: string[]; error?: string; cancelled?: boolean } | null> {
    const q = new URLSearchParams(window.location.search);
    const status = q.get('purchase');
    if (!status) return null;
    history.replaceState(null, '', window.location.pathname);
    if (status === 'cancelled') return { cancelled: true };
    const id = q.get('session_id');
    if (!id) return { error: 'Missing payment session.' };
    try {
      const r = await fetch(`${this.base}/store/confirm?session_id=${encodeURIComponent(id)}`);
      return (await r.json()) as { item?: string; owned?: string[]; error?: string };
    } catch {
      return { error: 'Could not confirm the purchase (server offline). It will appear once the server is reachable.' };
    }
  }
}
