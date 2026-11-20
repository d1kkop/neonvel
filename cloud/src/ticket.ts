/**
 * Match tickets: the lobby never contacts a race room itself (that would start the room next to the lobby).
 * It hands every player a signed ticket with the match setup instead; the first player to show up with it
 * creates the room, so the room starts in the Cloudflare location nearest to the players.
 */
export interface TicketPlayer { id: string; name: string; rating: number; games: number; car: { id: string; paint: string } }
export interface Ticket { matchId: string; level: string; weather: string; laps: number; players: TicketPlayer[]; exp: number }

const enc = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function signTicket(t: Ticket, secret: string): Promise<string> {
  const body = b64(enc.encode(JSON.stringify(t)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  return `${body}.${b64(sig)}`;
}

export async function readTicket(s: unknown, secret: string): Promise<Ticket | null> {
  if (typeof s !== 'string' || s.length > 20000) return null;
  const [body, sig] = s.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), unb64(sig), enc.encode(body));
    if (!ok) return null;
    const t = JSON.parse(new TextDecoder().decode(unb64(body))) as Ticket;
    return t.exp > Date.now() ? t : null;
  } catch {
    return null;
  }
}

/** Constant-time comparison of two hex / text signatures. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(data));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
