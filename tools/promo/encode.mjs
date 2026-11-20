// Promo video, step 2: frames + music ("Space City", CC0) + the game's sound effects → renders/neon-velocity-promo.mp4
// (1920×1080, 30 fps, H.264 high quality + AAC). Usage: node tools/promo/encode.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FPS } from './timeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FF = process.env.FFMPEG ?? 'E:/Tools/ffmpeg/ffmpeg-9.1-essentials_build/bin/ffmpeg.exe';
const frames = fs.readdirSync(path.join(root, 'renders/promo/frames')).filter((f) => f.endsWith('.jpg')).length;
const T = frames / FPS;
const out = path.join(root, 'renders/neon-velocity-promo.mp4');
const music = path.join(root, 'public/audio/space_city_bpm115.mp3');
const sfx = path.join(root, 'renders/promo/sfx.wav');
const fade = 2.5;
const audio = fs.existsSync(sfx)
  ? `[1:a]atrim=0:${T},afade=t=in:d=0.8,afade=t=out:st=${(T - fade).toFixed(3)}:d=${fade},volume=0.85[m];` +
    `[2:a]atrim=0:${T},afade=t=out:st=${(T - fade).toFixed(3)}:d=${fade},volume=0.32[s];[m][s]amix=inputs=2:normalize=0,alimiter=limit=0.92[a]`
  : `[1:a]atrim=0:${T},afade=t=in:d=0.8,afade=t=out:st=${(T - fade).toFixed(3)}:d=${fade},volume=0.9[a]`;
execFileSync(FF, [
  '-y', '-hide_banner', '-loglevel', 'error', '-stats',
  '-framerate', String(FPS), '-i', path.join(root, 'renders/promo/frames/%05d.jpg'),
  '-i', music, ...(fs.existsSync(sfx) ? ['-i', sfx] : []),
  '-filter_complex', audio,
  '-map', '0:v', '-map', '[a]',
  // Video range (the JPEG frames are full range) + a bitrate cap that suits YouTube / TikTok / Instagram uploads.
  '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-color_range', 'tv',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', '14M', '-bufsize', '28M', '-profile:v', 'high', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', T.toFixed(3),
  out,
], { stdio: 'inherit' });
console.log(`${out}: ${T.toFixed(1)} s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
