// Promo video, sound effects: renders the game's own engine / boost / whoosh sounds offline (OfflineAudioContext
// in the browser, the same Sfx class the game uses), timed to the promo timeline → renders/promo/sfx.wav.
// Usage: node tools/promo/sfx.mjs   (dev server on :5173)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMELINE, FPS } from './timeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, '.tmp/node_modules/'));
const puppeteer = require('puppeteer-core');
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  userDataDir: path.join(root, '.tmp/profiles/promo-sfx'), args: ['--mute-audio'],
  env: { ...process.env, TEMP: path.join(root, '.tmp/tmp'), TMP: path.join(root, '.tmp/tmp') },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
// Shot list in frames.
let f = 0;
const shots = TIMELINE.map((s) => { const n = Math.round(s.dur * FPS); const o = { ...s, f0: f, n }; f += n; return o; });
const total = f / FPS;
const wavB64 = await page.evaluate(async (shots, total, FPS) => {
  const { Sfx } = await import('/src/audio/Sfx.ts');
  const { ENGINES } = await import('/src/audio/engineProfiles.ts');
  const SR = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (total + 0.5)), SR);
  const sfx = new Sfx(ctx, ctx.destination);
  sfx.setEngineProfile(ENGINES.w16);
  sfx.engineOn = false;
  const step = 1 / FPS;
  const { CARS } = await import('/src/game/car/catalog.ts');
  const engineOf = (car) => ENGINES[CARS.find((c) => c.id === car)?.engine ?? 'w16'] ?? ENGINES.w16;
  const shotAt = (fr) => shots.find((s) => fr >= s.f0 && fr < s.f0 + s.n);
  const engine = sfx.engine; // driven directly (garage-demo mode: each gear revs out before a shift)
  let fr = 0, prevShot = null, profileCar = 'aurum', speed = 0.8;
  const tick = () => {
    const s = shotAt(fr);
    if (s) {
      const t = fr * step;
      // Whoosh on the big moments only (title, feature cards, end), not on every cut.
      if (s !== prevShot && prevShot && (s.flash ?? 0) > 0) sfx.whoosh(Math.floor(t / 2) % 2 ? -0.6 : 0.6, 0.6, 0.7);
      // A different car: only the engine's voice changes, the revs carry on (it is already at speed).
      if (s.car !== profileCar && !s.logo) { engine.setProfile(engineOf(s.car)); profileCar = s.car; }
      prevShot = s;
      const driving = !s.logo && !s.end;
      // Already at speed the whole time, never restarting at a cut: the revs swell and ease (a shift up or down
      // now and then), and climb while boosting. Smoothed, so a cut never makes the sound jump.
      const target = 0.76 + 0.12 * Math.sin((t / 9) * Math.PI * 2) + (s.boost ? 0.08 : 0);
      speed += (target - speed) * (1 - Math.exp(-step * 1.5));
      engine.previewing = true;
      engine.setActive(driving);
      engine.update({ rpm: 900, throttle: driving ? 1 : 0, gear: 1, slip: s.attract === 3 && ((fr - s.f0) / s.n) > 0.55 && ((fr - s.f0) / s.n) < 0.7 ? 0.45 : 0, speed01: Math.min(1, speed) }, driving, step);
      sfx.setBoost(!!s.boost && (fr - s.f0) / s.n > 0.15, 0.9);
    }
    fr++;
    if (fr * step < total) ctx.suspend(fr * step).then(tick).then(() => ctx.resume());
  };
  ctx.suspend(0).then(tick).then(() => ctx.resume());
  const buf = await ctx.startRendering();
  // 16-bit stereo WAV.
  const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1);
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, SR, true); out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}, shots, total, FPS);
fs.mkdirSync(path.join(root, 'renders/promo'), { recursive: true });
fs.writeFileSync(path.join(root, 'renders/promo/sfx.wav'), Buffer.from(wavB64, 'base64'));
console.log(`sfx.wav: ${total.toFixed(1)} s`);
await browser.close();
