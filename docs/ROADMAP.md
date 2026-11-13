# Neon Skyway — Roadmap

Retro neon racer in Three.js + TypeScript (Vite). Elevated skyway high above a procedural city.

## Design decisions
- **Levels**: Level 1 = closed loop (~2.8 km, ~40 s per lap at top speed). Later level = endless road (`EndlessTrack` implementing the same `Track` interface).
- **Opponents**: AI racers first; architecture prepared for **netplay** later:
  - fixed 60 Hz simulation step (`core/GameLoop.ts`), rendering interpolates;
  - level generated from a seed (`util/random.ts`) → identical world on every client;
  - all control goes through one `InputState` (throttle / brake / steer) regardless of source (keyboard, gamepad, touch, network).
- **Controls**: keyboard, gamepad, mobile virtual stick (one circle: up/down = accelerate/brake, left/right = steer).
- **Camera**: chase cam only + **rear-view mirror** strip at top of screen (second camera, scissor viewport).
- **Road** is flat (constant height) so the planar reflection is exact.

## Milestones
1. ✅ **World & mood** — sky, fog/haze, bloom, reflective wet road, deck/walls/neon, pillars, street lights, procedural city (instanced, per-building shader variation), billboards (procedural atlas + custom images), placeholder cars auto-driving, chase/free camera, debug panel.
1b. ✅ **Feedback round** — less bloom; city variety (round/hex towers, spires, pyramids, twin towers + skybridge, L-shapes, slabs, needles, 5 window styles, facade tones, halo rings, face-mounted screens); covered road sections (grid canopies + tunnels with portals); procedural car generator (lofted body, 3 styles); weather (clear/rain/fog/storm: GPU rain, road ripples, volumetric lamp/headlight/searchlight beams, clouds, lightning); audio (procedural synthwave + CC0 track, procedural SFX — see src/audio/README.md).
1c. ✅ **Game shell** — level system (`src/levels/`, one `LevelDef` per level: track, sky, light, road style, weather, billboards, scenery), start screen + Quick Race (level/weather/l
aps/opponents/car) + Options + Pause + Results, race flow (countdown, laps, positions, HUD, touch stick), on-rails player control, Palm Coast (day beach), procedural pin-up posters, menu/ambience sounds, netplay server (`server/`, Elo matchmaking, SQLite leaderboard).
2. ✅ **Driving** (arcade physics: grip-limited steering, drift/handbrake, 6-speed gearbox, wall/car collisions, AI racing line, rear-view mirror, crossfaded-RPM engine sound + tyre squeal) — `InputState` + keyboard/gamepad/touch stick, arcade car physics on the track (lateral position, speed, drift feel, wall scraping), chase cam tuning, rear-view mirror, tail-light trails.
3. **Race** — AI opponents (racing lines, rubber-banding, overtaking), collisions, laps/positions, countdown, results, start/finish gantry.
4. **HUD & audio** — neon speedometer, lap timer, position, minimap; engine sound, synthwave music, whoosh effects.
5. **Car model** — load user-provided GLB, paint/emissive setup.
5b. ✅ **More levels** — Desert Mirage, Harbor Docks, Snow Pass, Cyber Grid, Orbit Run, Deep Blue (8 levels total).
6. **Endless level** — chunk-streamed track + city, score by distance.
7. **Netplay racing** — server + matchmaking + Elo + leaderboard done; remaining: in-race state sync (server already relays `state`/`finish`), ghost cars for remote players, interpolation, accounts/auth before public hosting.
8. **Polish & performance** — quality presets, LOD, mobile tuning.

## Custom billboard images
Put images in `public/billboards/` and list them in `public/billboards/manifest.json` (`"images": ["a.jpg", "b.png"]`). 2:1 images look best; they replace the procedural designs in order (max 8).

## Running
- `npm run dev` — game at http://localhost:5173
- `npm run server` — netplay server on ws://localhost:8787 (SQLite db at `server/neon.db`; `PORT` / `DB_PATH` env vars)

## Engine sound samples (optional)
Put CC0 engine loops in `public/audio/engine/` and list them in `public/audio/engine/engine.json` as `[{ "file": "low.ogg", "rpm": 1500 }, { "file": "mid.ogg", "rpm": 3500 }, { "file": "high.ogg", "rpm": 6500 }]`. They replace the synthesised loops automatically.

## Car store (Garage purchases)
- Prices live in `src/game/car/catalog.ts` (cars) and `src/game/products.ts` (levels, item id `level:<id>`), in cents; the server reads them from there, never from the client.
- **Test mode** (default, no key): `npm run server` grants purchases instantly and stores them as `source = 'test'`. Disable with `STORE_TEST_MODE=0`.
- **Real payments**: set `STRIPE_SECRET_KEY` (use a `sk_test_…` key first) and `PUBLIC_URL` (where the game is hosted). The server creates a Stripe Checkout session; after the redirect back it verifies `payment_status = paid` with Stripe before unlocking.
- Before going live: add real player accounts (purchases are currently tied to the driver name only) and a Stripe webhook (`checkout.session.completed`) as a backup to the redirect confirmation.
