/**
 * Client side of the car store. The server owns prices and decides what a player owns;
 * this only asks. Free cars never need the server.
 */
export type StoreMode = 'stripe' | 'test' | 'off' | 'offline';

export class Store {
  constructor(private serverUrl: string) {}

  setServer(url: string): void {
    this.serverUrl = url;
  }

  /** ws://host:port → http://host:port */
  private get base(): string {
    return this.serverUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/$/, '');
  }

  async mode(): Promise<StoreMode> {
    try {
      const r = await fetch(`${this.base}/store/info`, { signal: AbortSignal.timeout(2500) });
      return ((await r.json()) as { mode: StoreMode }).mode;
    } catch {
      return 'offline';
    }
  }

  async leaderboard(): Promise<{ name: string; rating: number; games: number }[] | null> {
    try {
      const r = await fetch(`${this.base}/leaderboard`, { signal: AbortSignal.timeout(2500) });
      return (await r.json()) as { name: string; rating: number; games: number }[];
    } catch {
      return null;
    }
  }

  async owned(name: string): Promise<string[] | null> {
    if (!name) return [];
    try {
      const r = await fetch(`${this.base}/store/owned?name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(2500) });
      return ((await r.json()) as { owned: string[] }).owned;
    } catch {
      return null;
    }
  }

  /** Starts a purchase. Stripe: redirects to checkout. Test mode: granted immediately. */
  async buy(name: string, item: string): Promise<{ granted?: boolean; test?: boolean; owned?: string[]; error?: string; redirected?: boolean }> {
    try {
      const r = await fetch(`${this.base}/store/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, item }),
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
