// Builds the car models from the bought "90s Sports Cars Pack" (assets-src/cars90s, licensed: keep it private):
// Blender (headless, tools/blender/import90s.py) → raw .glb → gltfpack (quantised + meshopt) → public/models/cars/.
// Every car gets a full model (<style>.glb) and a light one (<style>_lo.glb: phones, weak GPUs, AI cars).
// Usage: node tools/build-cars.mjs [style ...]   (default: all)
// Needs: Blender at BLENDER (env) or E:\Tools\blender-5.3.0-windows-x64, gltfpack in .tmp/node_modules.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const BLENDER = process.env.BLENDER ?? 'E:/Tools/blender-5.3.0-windows-x64/blender.exe';
const GLTFPACK = path.join(root, '.tmp/node_modules/.bin/gltfpack.cmd');
const BLEND = path.join(root, 'assets-src/cars90s/Car_Pack_Blender/91s_Car_Pack.blend');
const SCRIPT = path.join(root, 'tools/blender/import90s.py');
const TMP = path.join(root, '.tmp/cars');
const OUT = path.join(root, 'public/models/cars');
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const env = { ...process.env, TEMP: TMP, TMP };

/** Game body style → the car's object name in the pack (or [object, .blend] for cars from elsewhere). */
const CARS = {
  asti: 'Asti', phoenix: 'Phoenix', gallo: 'Gallo_99', duke: 'Duke_69', duntov: 'Duntov', cheetah: 'Cheetah', nfr: 'NFR',
  // Classic Vehicle Set (Fab, Unreal-only): tools/unreal/export_classic.py, then tools/blender/prep_classic.py.
  classic: ['Classic', path.join(root, 'assets-src/classicvehicle/classic.blend')],
};

const wanted = process.argv.slice(2);
for (const [style, entry] of Object.entries(CARS)) {
  const [object, blend] = Array.isArray(entry) ? entry : [entry, BLEND];
  if (wanted.length && !wanted.includes(style)) continue;
  for (const lo of [false, true]) {
    const raw = path.join(TMP, `${style}${lo ? '_lo' : ''}.raw.glb`);
    const out = path.join(OUT, `${style}${lo ? '_lo' : ''}.glb`);
    const log = execFileSync(BLENDER, ['--background', blend, '--python', SCRIPT, '--', object, raw, ...(lo ? ['lo'] : [])], { env, stdio: 'pipe' }).toString();
    const info = /IMPORT90 .*/.exec(log)?.[0] ?? '(no report)';
    // -cc: meshopt compression, quantised attributes; -kn/-km: keep node + material names (the game maps them by name).
    execFileSync(GLTFPACK, ['-i', raw, '-o', out, '-cc', '-kn', '-km', '-vn', '12'], { env, stdio: 'pipe', shell: true });
    console.log(`${style}${lo ? '_lo' : ''}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB  ${info}`);
  }
}
