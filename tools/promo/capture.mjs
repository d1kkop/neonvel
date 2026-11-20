// Promo video, step 1: renders every frame of the promo from the running game (dev server on :5173) into
// renders/promo/frames/00001.jpg … at exactly 30 fps of game time (the game loop is driven by hand, so the
// motion is perfectly even however slow the capture is). Step 2 (encode.mjs) adds the music and makes the MP4.
//
// Usage: node tools/promo/capture.mjs   (needs: npm run dev, Chrome, puppeteer-core in .tmp/node_modules)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMELINE, FPS, W, H } from './timeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, '.tmp/node_modules/'));
const puppeteer = require('puppeteer-core');
const OUT = path.join(root, 'renders/promo/frames');
fs.mkdirSync(OUT, { recursive: true });
// Old frames go, unless KEEP=1 (re-render only the ONLY= shots in place, at their own frame numbers).
const KEEP = process.env.KEEP === '1';
if (!KEEP) for (const f of fs.readdirSync(OUT)) if (f.endsWith('.jpg')) fs.unlinkSync(path.join(OUT, f));
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // test single scenes: ONLY=title,cars

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  userDataDir: path.join(root, '.tmp/profiles/promo'),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', `--window-size=${W},${H}`],
  env: { ...process.env, TEMP: path.join(root, '.tmp/tmp'), TMP: path.join(root, '.tmp/tmp') },
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));
const cdp = await page.createCDPSession();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await sleep(4000);
await page.evaluate(async () => {
  const a = window.__app;
  const { CARS } = await import('/src/game/car/catalog.ts');
  const { LEVELS } = await import('/src/levels/index.ts');
  a.settings.ownedCars = [...CARS.map((c) => c.id), ...LEVELS.map((l) => `level:${l.id}`)];
  window.__carNames = Object.fromEntries(CARS.map((c) => [c.id, c.name.toUpperCase()]));
  a.settings.vhs = false;
  a.settings.qualityAuto = false;
  a.settings.quality = 'high';
  a.settings.lighting = 1;
  a.loop.manual = true;
  // Hide the game's menus / HUD; the promo draws its own captions.
  document.getElementById('ui').style.display = 'none';
  const ov = document.createElement('div');
  ov.id = 'promo';
  ov.innerHTML = `
    <style>
      #promo { position: fixed; inset: 0; pointer-events: none; font-family: Orbitron, sans-serif; color: #fff; z-index: 99; }
      #promo .flash { position: absolute; inset: 0; background: #fff; opacity: 0; }
      #promo .shade { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(5,0,15,0) 40%, rgba(5,0,15,.65) 100%); opacity: 0; }
      #promo .black { position: absolute; inset: 0; background: #05010d; opacity: 0; }
      #promo .logo { position: absolute; left: 0; right: 0; top: 34%; text-align: center; line-height: .9; opacity: 0; }
      #promo .logo .l1 { font-size: 150px; font-weight: 900; font-style: italic; letter-spacing: .04em;
        background: linear-gradient(180deg, #e8f6ff 0%, #9fc8ff 45%, #2a0a5a 50%, #ff7ad8 75%, #ffe0f6 100%);
        -webkit-background-clip: text; background-clip: text; color: transparent;
        filter: drop-shadow(0 0 18px rgba(0,229,255,.7)) drop-shadow(0 6px 0 #3a0060); }
      #promo .logo .l2 { font-family: 'Brush Script MT', cursive; font-size: 96px; color: #ff2bd6; transform: rotate(-6deg); display: inline-block;
        text-shadow: 0 0 10px #ff2bd6, 0 0 30px #ff2bd6; margin-top: .05em; }
      #promo .cap { position: absolute; left: 0; right: 0; top: 11%; text-align: center; font-size: 72px; font-weight: 900; font-style: italic;
        letter-spacing: .08em; text-shadow: 0 0 14px #00e5ff, 0 0 34px #00e5ff; opacity: 0; }
      #promo .name { position: absolute; left: 90px; bottom: 90px; font-size: 54px; font-weight: 900; font-style: italic; letter-spacing: .06em;
        text-shadow: 0 0 12px #ff2bd6, 0 0 28px #ff2bd6; opacity: 0; }
      #promo .name small { display: block; font-size: 22px; letter-spacing: .3em; color: #00e5ff; text-shadow: 0 0 10px #00e5ff; margin-bottom: 8px; }
      #promo .lock { position: absolute; right: 90px; bottom: 96px; padding: 12px 22px; border: 2px solid #ffe14d; color: #ffe14d; font-size: 30px;
        letter-spacing: .2em; background: rgba(0,0,0,.45); box-shadow: 0 0 18px rgba(255,225,77,.5); opacity: 0; }
      #promo .feat { position: absolute; left: 0; right: 0; top: 33%; text-align: center; opacity: 0; }
      #promo .feat .f1 { font-size: 118px; font-weight: 900; font-style: italic; letter-spacing: .06em; color: #fff;
        text-shadow: 0 0 18px #00e5ff, 0 0 46px #00e5ff, 0 6px 0 #3a0060; }
      #promo .feat .f2 { margin-top: 18px; font-size: 40px; font-weight: 900; letter-spacing: .16em; color: #ffe14d;
        text-shadow: 0 0 12px #ff2bd6, 0 0 28px #ff2bd6; }
      #promo .end { position: absolute; left: 0; right: 0; top: 64%; text-align: center; opacity: 0; }
      #promo .end .a { font-size: 52px; font-weight: 900; font-style: italic; letter-spacing: .12em; color: #ffe14d; text-shadow: 0 0 14px #ff2bd6, 0 0 30px #ff2bd6; }
      #promo .end .b { margin-top: 18px; font-size: 40px; letter-spacing: .14em; text-shadow: 0 0 12px #00e5ff; }
      #promo .end .c { margin-top: 14px; font-size: 24px; letter-spacing: .3em; color: #00e5ff; }
    </style>
    <div class="shade"></div><div class="black"></div>
    <div class="logo"><div class="l1">NEON VELOCITY</div><div class="l2">Retro Racer</div></div>
    <div class="cap"></div><div class="feat"><div class="f1"></div><div class="f2"></div></div><div class="name"></div><div class="lock">🔒 LOCKED</div>
    <div class="end"><div class="a">PLAY FREE</div><div class="b">lumiogames.nl</div><div class="c">PC · MOBILE · ONLINE RACES</div></div>
    <div class="flash"></div>`;
  document.body.appendChild(ov);
  // Keep a scripted camera inside the road corridor: between the rails, above the road, low under roofs/tunnels.
  window.__clampCam = (cam, w) => {
    const t = w.track, V = cam.position.constructor;
    const d = t.nearestSample(cam.position.x, cam.position.z) * t.sampleStep;
    const fr = { position: new V(), forward: new V(), right: new V(), up: new V() };
    t.frameAt(d, fr);
    const lat = cam.position.clone().sub(fr.position).dot(fr.right);
    const hw = t.width / 2 - 1.3;
    if (Math.abs(lat) > hw) cam.position.addScaledVector(fr.right, Math.sign(lat) * hw - lat);
    cam.position.y = Math.max(cam.position.y, fr.position.y + 0.45);
    if (t.sectionAt(d, 8)) cam.position.y = Math.min(cam.position.y, fr.position.y + 3.6);
  };
});

/** Scripted cameras (run inside the page, set per shot). */
const CAMS = {
  // Slow orbit around the player's car (showroom on the move).
  orbit: `(cam, w, dt, alpha, t, o) => {
    const p = w.player.car.group.position, f = w.player.car.group;
    const ang = (o.a0 ?? 0.6) + t * (o.speed ?? 0.45);
    const yaw = f.rotation.y;
    const r = o.r ?? 6.2;
    cam.position.set(p.x + Math.sin(yaw + ang) * r, p.y + (o.h ?? 1.35), p.z + Math.cos(yaw + ang) * r);
    window.__clampCam(cam, w);
    cam.lookAt(p.x, p.y + 0.55, p.z);
    if (cam.fov !== (o.fov ?? 40)) { cam.fov = o.fov ?? 40; cam.updateProjectionMatrix(); }
    return true;
  }`,
  // Low, fast tracking shot ahead of the car looking back at it.
  lowfront: `(cam, w, dt, alpha, t, o) => {
    const ph = w.player.phys, a = window.__app;
    const s = ph.ps + (ph.s - ph.ps) * alpha, x = ph.px + (ph.x - ph.px) * alpha;
    const fr = a.frame; w.track.frameAt(s + (o.ahead ?? 9) - t * (o.drift ?? 1.2), fr);
    cam.position.copy(fr.position).addScaledVector(fr.right, x + (o.lat ?? 2.2)); cam.position.y += o.h ?? 0.7;
    window.__clampCam(cam, w);
    const p = w.player.car.group.position; cam.lookAt(p.x, p.y + 0.6, p.z);
    if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
    return true;
  }`,
};

let frame = 0;
let prev = null;
for (const shot0 of TIMELINE) {
  if (ONLY && !ONLY.includes(shot0.id) && !ONLY.includes(shot0.scene)) { if (KEEP) frame += Math.round(shot0.dur * FPS); prev = shot0; continue; }
  // Flash / fade only when the level changes; within a level the shot just cuts and the captions stay up.
  const sameLevel = !!prev && prev.level === shot0.level;
  const shot = { ...shot0, flash: sameLevel ? 0 : (shot0.flash ?? (prev ? 0.35 : 0)), keepName: sameLevel && prev.name === shot0.name, keepCap: sameLevel && prev.caption === shot0.caption };
  const next = TIMELINE[TIMELINE.indexOf(shot0) + 1];
  shot.nextSameName = !!next && next.level === shot0.level && next.name === shot0.name && !!shot0.name;
  shot.nextSameCap = !!next && next.level === shot0.level && next.caption === shot0.caption && !!shot0.caption;
  prev = shot0;
  const n = Math.round(shot.dur * FPS);
  console.log(`${shot.id.padEnd(14)} ${shot.level ?? ''} ${shot.car ?? ''} ${n} frames (${shot.dur.toFixed(2)} s)`);
  // Set up the world (only when the level or car changes).
  await page.evaluate(async (shot) => {
    const a = window.__app;
    const { levelById } = await import('/src/levels/index.ts');
    const want = `${shot.level}|${shot.car}|${shot.weather ?? ''}`;
    if (window.__promoWorld !== want) {
      a.settings.carId = shot.car;
      if (shot.weather) a.settings.weather[shot.level] = shot.weather;
      a.loadMenuWorld(levelById(shot.level), !shot.weather);
      window.__promoWorld = want;
      window.__promoFresh = true;
    } else window.__promoFresh = false;
  }, shot);
  // Wait for the shaders (compiled in the background), then let the cars roll a while before filming.
  for (let i = 0; i < 600 && (await page.evaluate(() => window.__app.compiling)); i++) await sleep(100);
  await page.evaluate((shot, cams) => {
    const a = window.__app;
    a.loop.manual = true;
    const preroll = window.__promoFresh ? (shot.preroll ?? 3) : 0;
    a.captureCam = undefined;
    for (let i = 0; i < preroll * 30; i++) a.loop.advance(1 / 30);
    if (shot.skipTo !== undefined && window.__promoFresh) {
      // Jump the cars to a nicer part of the track (sky / scenery).
      for (const c of a.world.cars) { const d = shot.skipTo - a.world.player.phys.s; c.phys.s += d; c.phys.ps = c.phys.s; }
    }
    // Camera for this shot: a scripted one, or one of the game's own attract shots.
    const t0 = { t: 0 };
    if (shot.cam && cams[shot.cam]) {
      const fn = eval(cams[shot.cam]);
      a.captureCam = (cam, w, dt, alpha) => { t0.t += dt; return fn(cam, w, dt, alpha, t0.t, shot.camOpts ?? {}); };
    } else {
      a.shot = shot.attract ?? 0;
      a.shotTimer = shot.shotStart ?? 0;
      if (a.camera.fov !== 62) { a.camera.fov = 62; a.camera.updateProjectionMatrix(); }
    }
    // Boost for show (the player's car fires its boost through this shot).
    if (shot.boost) { const p = a.world.player; p.phys.boost = 1; window.__promoBoost = true; } else window.__promoBoost = false;
  }, shot, CAMS);
  for (let i = 0; i < n; i++) {
    const u = i / n, ts = i / FPS;
    await page.evaluate((shot, u, ts, n, i) => {
      const a = window.__app, q = (s) => document.querySelector(`#promo ${s}`);
      if (window.__promoBoost) { const ph = a.world.player.phys; ph.boost = 1; if (i % 2 === 0) ph.v = Math.min(ph.v + 1.2, a.world.player.spec.topSpeed * 1.25); }
      // Captions: fade in over 0.25 s, out over the last 0.2 s.
      const inK = Math.min(1, ts / 0.25), outK = Math.min(1, (n - i) / 6);
      const k = Math.min(inK, outK);
      // Captions that continue into the next shot of the same level don't fade (and don't fade in again).
      const nk = shot.keepName ? (shot.nextSameName ? 1 : outK) : shot.nextSameName ? inK : k;
      const ck = shot.keepCap ? (shot.nextSameCap ? 1 : outK) : shot.nextSameCap ? inK : k;
      q('.logo').style.opacity = shot.logo ? String(k) : '0';
      q('.logo').style.top = shot.end ? '22%' : '34%'; // end card: logo higher, above PLAY FREE
      q('.logo').style.transform = `scale(${1 + u * 0.06})`;
      q('.cap').textContent = shot.caption ?? '';
      q('.cap').style.opacity = shot.caption ? String(ck) : '0';
      q('.cap').style.transform = `translateY(${(shot.keepCap ? 0 : 1 - inK) * 20}px)`;
      q('.name').innerHTML = shot.name ? `<small>${shot.sub ?? window.__carNames?.[shot.car] ?? ''}</small>${shot.name}` : '';
      // Big feature card (centre of the screen) with a little zoom.
      q('.feat .f1').textContent = shot.feature ?? '';
      q('.feat .f1').style.fontSize = `${Math.min(118, Math.floor(1640 / (Math.max(1, (shot.feature ?? '').length) * 0.86)))}px`; // always fits
      q('.feat .f2').textContent = shot.featureSub ?? '';
      q('.feat').style.opacity = shot.feature ? String(k) : '0';
      q('.feat').style.transform = `scale(${0.92 + 0.08 * inK + u * 0.04})`;
      q('.name').style.opacity = shot.name ? String(nk) : '0';
      q('.name').style.transform = `translateX(${(shot.keepName ? 0 : 1 - inK) * -40}px)`;
      q('.lock').style.opacity = '0';
      q('.end').style.opacity = shot.end ? String(Math.min(1, Math.max(0, (ts - 0.5) / 0.6))) : '0';
      q('.shade').style.opacity = shot.logo || shot.end || shot.feature ? '1' : '0.5';
      q('.black').style.opacity = String(shot.fadeIn ? Math.max(0, 1 - ts / 1.2) : shot.fadeOut ? Math.min(0.85, Math.max(0, (ts - (n / 30 - 1.4)) / 1.4)) : 0);
      // White flash on the cut (first 3 frames), stronger for the locked-level flashes.
      q('.flash').style.opacity = String(i < 4 ? shot.flash * (1 - i / 4) : 0);
      a.loop.advance(1 / 30);
    }, shot, u, ts, n, i);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, optimizeForSpeed: true });
    frame++;
    fs.writeFileSync(path.join(OUT, `${String(frame).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    if (frame % 150 === 0) console.log(`  ${frame} frames`);
  }
}
console.log(`done: ${frame} frames (${(frame / FPS).toFixed(1)} s) in ${OUT}`);
await browser.close();
