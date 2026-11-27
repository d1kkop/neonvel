/**
 * Neon Velocity game server on Cloudflare (Worker entry).
 *  - WebSocket /ws (or any path)  → the Lobby Durable Object (matchmaking, quick-race lap timing)
 *  - WebSocket /room/<matchId>   → that race's Room Durable Object (started near the players)
 *  - /auth/*      sign in with Google or Discord (OAuth), session tokens; developer sign-in when not https
 *  - /store/*     Stripe Checkout (with Stripe Tax), test mode without a Stripe key
 *  - /stripe/webhook  Stripe tells the server a checkout is paid (signature checked)
 *  - /leaderboard, /laptimes
 * Everything else is the game itself (static files from ../dist, see wrangler.jsonc).
 */
import { CARS } from '../../src/game/car/catalog';
import { LEVEL_NAMES, LEVEL_PRICES } from '../../src/game/products';
import { accountPlayer, config, grant, lapBoard, leaderboard, newSession, owned, playerFor, randomToken, type Env, type PlayerRow } from './db';
import { hmacHex, safeEqual } from './ticket';

export { Lobby } from './lobby';
export { Room } from './room';

const PRODUCTS = new Map<string, { name: string; price: number }>([
  ...CARS.filter((c) => c.price > 0).map((c) => [c.id, { name: c.name, price: c.price }] as const),
  ...Object.entries(LEVEL_PRICES).filter(([, p]) => p > 0).map(([id, p]) => [`level:${id}`, { name: `Level: ${LEVEL_NAMES[id] ?? id}`, price: p }] as const),
]);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });

function oauth(env: Env) {
  return {
    google: {
      id: env.GOOGLE_CLIENT_ID ?? '', secret: env.GOOGLE_CLIENT_SECRET ?? '',
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
      me: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid profile',
    },
    discord: {
      id: env.DISCORD_CLIENT_ID ?? '', secret: env.DISCORD_CLIENT_SECRET ?? '',
      authorize: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token',
      me: 'https://discord.com/api/users/@me', scope: 'identify',
    },
  };
}
type Provider = 'google' | 'discord';

function providers(env: Env): Record<string, boolean> {
  const o = oauth(env);
  return { google: !!(o.google.id && o.google.secret), discord: !!(o.discord.id && o.discord.secret), dev: config(env).DEV_LOGIN };
}

/** Where a finished sign-in may send the browser back to: the game's own address (local ones in development). */
function safeReturn(env: Env, ret: string): string {
  const { PUBLIC_URL, IS_PROD } = config(env);
  try {
    const u = new URL(ret);
    if (u.origin === new URL(PUBLIC_URL).origin) return u.origin + u.pathname;
    if (!IS_PROD && /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$/.test(u.hostname)) return u.origin + u.pathname;
    if (!IS_PROD && u.hostname.endsWith('.trycloudflare.com')) return u.origin + u.pathname; // phone test through a tunnel
  } catch { /* fall through */ }
  return PUBLIC_URL;
}

async function profile(env: Env, p: PlayerRow) {
  return { id: p.id, name: p.name, rating: p.rating, games: p.games, owned: await owned(env.DB, p.id) };
}

async function stripe(env: Env, method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = await res.json<any>();
  if (!res.ok) throw new Error(body?.error?.message ?? `Stripe error ${res.status}`);
  return body;
}

/** Start a purchase: a Stripe Checkout URL, or granted at once in test mode. Prices come from the catalogue. */
async function checkout(env: Env, player: PlayerRow, item: string): Promise<Record<string, unknown>> {
  const cfg = config(env);
  const product = PRODUCTS.get(item);
  if (!product) return { error: 'Unknown item.' };
  if ((await owned(env.DB, player.id)).includes(item)) return { granted: true, owned: await owned(env.DB, player.id) };
  if (cfg.STRIPE_KEY) {
    const session = await stripe(env, 'POST', 'checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': cfg.CURRENCY,
      // Stripe works out and adds the right VAT / sales tax for the buyer's country (Stripe Tax).
      ...(cfg.STRIPE_TAX ? { 'automatic_tax[enabled]': 'true', 'line_items[0][price_data][tax_behavior]': 'exclusive', 'line_items[0][price_data][product_data][tax_code]': 'txcd_10201000' } : {}),
      client_reference_id: player.id,
      ...(cfg.IS_PROD ? { 'line_items[0][price_data][product_data][images][0]': `${cfg.PUBLIC_URL}store/${item.startsWith('level:') ? `levels/${item.slice(6)}` : `cars/${item}`}.png` } : {}),
      'line_items[0][price_data][unit_amount]': String(product.price),
      'line_items[0][price_data][product_data][name]': `Neon Velocity — ${product.name}`,
      'metadata[player_id]': player.id,
      'metadata[item]': item,
      success_url: `${cfg.PUBLIC_URL}?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cfg.PUBLIC_URL}?purchase=cancelled`,
    });
    return { url: session.url };
  }
  if (!cfg.TEST_MODE) return { error: 'Store is not configured.' };
  await grant(env.DB, player.id, item, 'test', null);
  return { granted: true, test: true, owned: await owned(env.DB, player.id) };
}

/** After the Stripe redirect: verify the session is paid, then grant (idempotent). */
async function confirm(env: Env, sessionId: string): Promise<Record<string, unknown>> {
  if (!env.STRIPE_SECRET_KEY) return { error: 'Store is in test mode.' };
  const s = await stripe(env, 'GET', `checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (s.payment_status !== 'paid') return { error: 'Payment not completed.' };
  const playerId = s.metadata?.player_id, item = s.metadata?.item;
  if (!playerId || !PRODUCTS.has(item)) return { error: 'Invalid session.' };
  await grant(env.DB, playerId, item, 'stripe', s.id);
  return { granted: true, item, owned: await owned(env.DB, playerId) };
}

/** Stripe webhook: Stripe-Signature = t=<time>,v1=<HMAC-SHA256 of "t.body"> with STRIPE_WEBHOOK_SECRET. */
async function stripeWebhook(env: Env, raw: string, sigHeader: string): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Webhook secret not configured.' }, 400);
  const items = sigHeader.split(',').map((kv) => kv.trim());
  const t = Number(items.find((kv) => kv.startsWith('t='))?.slice(2));
  const sigs = items.filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return json({ error: 'Bad timestamp.' }, 400);
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${raw}`);
  if (!sigs.some((v) => safeEqual(v, expected))) return json({ error: 'Bad signature.' }, 400);
  const event = JSON.parse(raw);
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const sess = event.data?.object ?? {};
    const playerId = sess.metadata?.player_id, item = sess.metadata?.item;
    if (sess.payment_status === 'paid' && playerId && PRODUCTS.has(item)) {
      await grant(env.DB, playerId, item, 'stripe', sess.id);
      console.log(`store: PAID ${item} for ${playerId} (${sess.id})`);
    }
  }
  return json({ received: true });
}

async function oauthCallback(env: Env, provider: Provider, code: string, state: string): Promise<string> {
  const db = env.DB;
  const pend = await db.prepare('SELECT provider, ret, created FROM oauth_states WHERE state = ?').bind(state).first<{ provider: string; ret: string; created: number }>();
  await db.prepare('DELETE FROM oauth_states WHERE state = ? OR created < ?').bind(state, Date.now() - 10 * 60_000).run();
  if (!pend || pend.provider !== provider || Date.now() - pend.created > 10 * 60_000) throw new Error('Sign-in expired, please try again.');
  const cfg = oauth(env)[provider];
  const tok = await fetch(cfg.token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: cfg.id, client_secret: cfg.secret, redirect_uri: `${config(env).API_URL}/auth/${provider}/callback`, grant_type: 'authorization_code' }).toString(),
  }).then((r) => r.json<any>());
  if (!tok.access_token) throw new Error('Sign-in failed.');
  const me = await fetch(cfg.me, { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json<any>());
  const pid = String(provider === 'google' ? me.sub : me.id ?? '');
  if (!pid || pid === 'undefined') throw new Error('Sign-in failed.');
  const suggested = provider === 'google' ? me.given_name ?? me.name ?? '' : me.global_name ?? me.username ?? '';
  const player = await accountPlayer(db, provider, pid, suggested);
  return `${pend.ret}#auth=${await newSession(db, player.id)}`;
}

async function body(req: Request): Promise<any> {
  try { return JSON.parse((await req.text()).slice(0, 10_000) || '{}'); } catch { return {}; }
}

async function api(req: Request, env: Env, url: URL): Promise<Response | null> {
  const db = env.DB;
  const cfg = config(env);
  const tokenQ = url.searchParams.get('token');
  const path = url.pathname;
  if (path === '/stripe/webhook' && req.method === 'POST') return stripeWebhook(env, await req.text(), req.headers.get('stripe-signature') ?? '');
  if (path === '/auth/providers') return json(providers(env));
  const start = /^\/auth\/(google|discord|dev)\/start$/.exec(path);
  if (start) {
    const ret = safeReturn(env, url.searchParams.get('return') ?? cfg.PUBLIC_URL);
    if (start[1] === 'dev') {
      if (!cfg.DEV_LOGIN) return json({ error: 'Not available.' }, 404);
      const name = (url.searchParams.get('name') ?? 'Tester').replace(/[^\w .\-]/g, '').slice(0, 16) || 'Tester';
      const player = await accountPlayer(db, 'dev', name.toLowerCase(), name);
      return redirect(`${ret}#auth=${await newSession(db, player.id)}`);
    }
    const provider = start[1] as Provider;
    if (!providers(env)[provider]) return json({ error: `${provider} sign-in is not configured.` }, 404);
    const state = randomToken(18);
    await db.prepare('INSERT INTO oauth_states (state, provider, ret, created) VALUES (?, ?, ?, ?)').bind(state, provider, ret, Date.now()).run();
    const o = oauth(env)[provider];
    const q = new URLSearchParams({ client_id: o.id, redirect_uri: `${cfg.API_URL}/auth/${provider}/callback`, response_type: 'code', scope: o.scope, state, prompt: provider === 'google' ? 'select_account' : 'none' });
    return redirect(`${o.authorize}?${q}`);
  }
  const cb = /^\/auth\/(google|discord)\/callback$/.exec(path);
  if (cb) {
    try {
      return redirect(await oauthCallback(env, cb[1] as Provider, url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? ''));
    } catch (e) {
      return redirect(`${cfg.PUBLIC_URL}#autherror=${encodeURIComponent((e as Error).message)}`);
    }
  }
  if (path === '/auth/me') {
    const p = await playerFor(db, tokenQ);
    return p ? json(await profile(env, p)) : json({ error: 'Not signed in.' }, 401);
  }
  if (path === '/auth/rename' && req.method === 'POST') {
    const b = await body(req);
    const p = await playerFor(db, b.token);
    if (!p) return json({ error: 'Not signed in.' }, 401);
    const name = String(b.name ?? '').replace(/[^\w .\-]/g, '').trim().slice(0, 16);
    if (name.length < 2) return json({ error: 'Pick a name of at least 2 letters.' }, 400);
    const taken = await db.prepare('SELECT id FROM players WHERE name = ?').bind(name).first<{ id: string }>();
    if (taken && taken.id !== p.id) return json({ error: 'That name is taken.' }, 409);
    await db.prepare('UPDATE players SET name = ? WHERE id = ?').bind(name, p.id).run();
    return json(await profile(env, { ...p, name }));
  }
  if (path === '/auth/logout' && req.method === 'POST') {
    const b = await body(req);
    if (typeof b.token === 'string') await db.prepare('DELETE FROM sessions WHERE token = ?').bind(b.token).run();
    return json({ ok: true });
  }
  if (path === '/store/info') return json({ mode: cfg.storeMode });
  if (path === '/store/owned') {
    const p = await playerFor(db, tokenQ);
    return json({ owned: p ? await owned(db, p.id) : [] });
  }
  if (path === '/store/checkout' && req.method === 'POST') {
    const b = await body(req);
    const p = await playerFor(db, b.token);
    if (!p) return json({ error: 'Sign in with Google or Discord first (Netplay screen).' }, 401);
    return json(await checkout(env, p, String(b.item ?? '')));
  }
  if (path === '/store/confirm') return json(await confirm(env, url.searchParams.get('session_id') ?? ''));
  if (path === '/laptimes') return json(await lapBoard(db, url.searchParams.get('level') ?? '', await playerFor(db, tokenQ)));
  if (path === '/leaderboard') return json(await leaderboard(db, await playerFor(db, tokenQ)));
  return null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.headers.get('Upgrade') === 'websocket') {
      const room = /^\/room\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (room) {
        // The room only accepts tickets for its own match id (set here by the Worker, a client can't choose it).
        const fwd = new Request(req);
        fwd.headers.set('X-Match-Id', room[1]);
        return env.ROOM.get(env.ROOM.idFromName(room[1])).fetch(fwd);
      }
      return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(req);
    }
    try {
      const r = await api(req, env, url);
      if (r) return r;
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response('Neon Velocity server. Connect via WebSocket; GET /leaderboard for rankings.\n', { headers: { 'Content-Type': 'text/plain', ...CORS } });
  },
} satisfies ExportedHandler<Env>;
