# Neon Velocity on Cloudflare

One Cloudflare Worker serves everything:

| Part | Cloudflare product | Code |
|---|---|---|
| The game files (`dist/`) | Workers static assets | `wrangler.jsonc` → `assets` |
| Sign-in (Google / Discord), store, Stripe webhook, leaderboards | Worker | `src/index.ts` |
| Matchmaking + lap checks in quick races | Durable Object `Lobby` (one) | `src/lobby.ts` |
| Each online race (relay, start, checks, Elo) | Durable Object `Room` (one per race, started near the players) | `src/room.ts` |
| Players, sessions, lap records, purchases | D1 (SQLite) | `migrations/` |

The lobby never opens a room itself: it gives the players a signed ticket (`src/ticket.ts`), and the first
player who joins with it creates the room — so the room runs in the Cloudflare location nearest the players.

## Local development

```
npm run dev        # the game on http://localhost:5173
npm run server     # the Worker on http://localhost:8787 (local D1 + Durable Objects)
```

Local secrets live in `cloud/.dev.vars` (git-ignored), e.g. `STRIPE_SECRET_KEY=sk_test_…`, `TICKET_SECRET=…`.
To try the production setup locally: `npm run build`, then open http://localhost:8787/ (the Worker serves the game).

## Going live (one time)

1. **Cloudflare account** (free) → `npx wrangler login`.
2. **Database:** `npx wrangler d1 create neon-velocity` → copy the printed `database_id` into `wrangler.jsonc`.
3. **Address:** set `PUBLIC_URL` in `wrangler.jsonc` to the game's address, e.g. `https://neonvelocity.com/`
   (or the free `https://neon-velocity.<account>.workers.dev/`). For your own domain: add it to Cloudflare and
   attach it to the Worker (Workers → neon-velocity → Settings → Domains & Routes).
4. **Secrets** (asked for one by one, never stored in the code):
   ```
   npx wrangler secret put TICKET_SECRET          -c cloud/wrangler.jsonc   (any long random text)
   npx wrangler secret put STRIPE_SECRET_KEY      -c cloud/wrangler.jsonc   (sk_live_… — the live key)
   npx wrangler secret put STRIPE_WEBHOOK_SECRET  -c cloud/wrangler.jsonc   (whsec_… from step 5)
   npx wrangler secret put GOOGLE_CLIENT_ID       -c cloud/wrangler.jsonc
   npx wrangler secret put GOOGLE_CLIENT_SECRET   -c cloud/wrangler.jsonc
   npx wrangler secret put DISCORD_CLIENT_ID      -c cloud/wrangler.jsonc
   npx wrangler secret put DISCORD_CLIENT_SECRET  -c cloud/wrangler.jsonc
   ```
5. **Stripe:** Dashboard → Developers → Webhooks → add endpoint `https://<your address>/stripe/webhook` with the
   events `checkout.session.completed` and `checkout.session.async_payment_succeeded`; copy its signing secret
   (step 4). Turn on Stripe Tax (Settings → Tax).
6. **Google / Discord:** add the redirect URIs `https://<your address>/auth/google/callback` and
   `https://<your address>/auth/discord/callback` in their developer consoles.
7. **Deploy:** `npm run deploy` (builds the game, applies database migrations, uploads the Worker).

Developer sign-in ("Dev sign-in") switches off by itself once `PUBLIC_URL` is https.

## Costs

Free plan: 100,000 requests a day (incoming WebSocket messages count 20:1 — roughly 20 player-hours of
online racing a day). Beyond that: Workers Paid, $5/month (1M requests included, then $0.15 per million).
D1 has point-in-time restore (30 days) built in, so no backup scripts are needed.
