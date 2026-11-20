// Clip pack for editing (Clipchamp, DaVinci Resolve, Shotcut…): every clip folder → renders/clips/<id>.mp4
// (1920×1080, 30 fps, H.264, no sound), plus the music, the logo as a transparent PNG and a short read-me.
// Usage: CLIPS=1 node tools/promo/capture.mjs && node tools/promo/clips-encode.mjs
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FF = process.env.FFMPEG ?? 'E:/Tools/ffmpeg/ffmpeg-9.1-essentials_build/bin/ffmpeg.exe';
const SRC = path.join(root, 'renders/promo/clipframes');
const OUT = path.join(root, 'renders/clips');
fs.mkdirSync(OUT, { recursive: true });

for (const id of fs.readdirSync(SRC).filter((d) => fs.statSync(path.join(SRC, d)).isDirectory())) {
  const out = path.join(OUT, `${id}.mp4`);
  execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', '30', '-i', path.join(SRC, id, '%05d.jpg'),
    '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-color_range', 'tv',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-maxrate', '16M', '-bufsize', '32M', '-movflags', '+faststart', out]);
  console.log(`${id}.mp4  ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
}

// Music (CC0) + credits.
fs.copyFileSync(path.join(root, 'public/audio/space_city_bpm115.mp3'), path.join(OUT, 'music-space-city-115bpm.mp3'));

// Logo: the game's title, rendered with a transparent background.
const require = createRequire(path.join(root, '.tmp/node_modules/'));
const puppeteer = require('puppeteer-core');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  userDataDir: path.join(root, '.tmp/profiles/promo-logo'), env: { ...process.env, TEMP: path.join(root, '.tmp/tmp'), TMP: path.join(root, '.tmp/tmp') } });
const page = await browser.newPage();
await page.setViewport({ width: 1800, height: 520, deviceScaleFactor: 2 });
await page.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&display=swap" rel="stylesheet">
  <style>html,body{margin:0;background:transparent}
  .logo{width:1800px;height:520px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:.9;font-family:Orbitron,sans-serif}
  .l1{font-size:150px;font-weight:900;font-style:italic;letter-spacing:.04em;
    background:linear-gradient(180deg,#e8f6ff 0%,#9fc8ff 45%,#2a0a5a 50%,#ff7ad8 75%,#ffe0f6 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
    filter:drop-shadow(0 0 18px rgba(0,229,255,.7)) drop-shadow(0 6px 0 #3a0060)}
  .l2{font-family:'Brush Script MT',cursive;font-size:96px;color:#ff2bd6;transform:rotate(-6deg);text-shadow:0 0 10px #ff2bd6,0 0 30px #ff2bd6;margin-top:.05em}
  </style></head><body><div class="logo"><div class="l1">NEON VELOCITY</div><div class="l2">Retro Racer</div></div></body></html>`, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(OUT, 'logo-neon-velocity.png'), omitBackground: true });
await browser.close();

fs.writeFileSync(path.join(OUT, 'LEESMIJ.txt'), `Neon Velocity - clips voor je eigen promovideo

- *.mp4: schone clips van 5 s (1920x1080, 30 fps, zonder geluid en tekst).
  car-*    close-ups en rondjes om de auto's
  <wereld>-crane   kraanshot van hoog naar laag
  <wereld>-drone   hoog, van bovenaf
  <wereld>-flyby   camera staat stil langs de weg, de auto raast voorbij
  <wereld>-low     laag over het asfalt, voor de auto
  <wereld>-chase   achtervolgingscamera
- music-space-city-115bpm.mp3: muziek "Space City" van MintoDog, CC0 (rechtenvrij).
  115 BPM: een tel = 0,52 s, een maat = 2,09 s. Knip op de maat voor een strakke video.
- logo-neon-velocity.png: het logo met transparante achtergrond (leg het over een clip).

Clipchamp (gratis in Windows 11): Nieuwe video -> sleep deze map erin -> zet clips achter elkaar op de tijdlijn,
muziek eronder, logo bovenop; Exporteren -> 1080p.
`);
console.log(`clip pack ready: ${OUT}`);
