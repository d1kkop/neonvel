// Builds the car models: Blender (headless) → raw .glb → gltfpack (quantised + meshopt) → public/models/cars/.
// Usage: node tools/build-cars.mjs [carName ...]   (default: every tools/blender/car_*.py)
// Needs: Blender at BLENDER (env) or E:\Tools\blender-5.3.0-windows-x64, gltfpack in .tmp/node_modules.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const BLENDER = process.env.BLENDER ?? 'E:/Tools/blender-5.3.0-windows-x64/blender.exe';
const GLTFPACK = path.join(root, '.tmp/node_modules/.bin/gltfpack.cmd');
const TMP = path.join(root, '.tmp/cars');
const OUT = path.join(root, 'public/models/cars');
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const env = { ...process.env, TEMP: TMP, TMP };

// Rims (one .glb with every design): built when asked for by name ('rims') or when building everything.
const wantedArgs = process.argv.slice(2);
if (!wantedArgs.length || wantedArgs.includes('rims')) {
  const raw = path.join(TMP, 'rims.raw.glb');
  const outDir = path.join(root, 'public/models/wheels');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'rims.glb');
  execFileSync(BLENDER, ['--background', '--python', path.join(root, 'tools/blender/rims.py'), '--', raw], { env, stdio: 'pipe' });
  execFileSync(GLTFPACK, ['-i', raw, '-o', out, '-cc', '-kn', '-km'], { env, stdio: 'pipe', shell: true });
  console.log(`rims: raw ${(fs.statSync(raw).size / 1024).toFixed(0)} KB → ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

const scripts = fs.readdirSync(path.join(root, 'tools/blender')).filter((f) => /^car_.*\.py$/.test(f));
const wanted = process.argv.slice(2);
for (const file of scripts) {
  const name = file.replace(/^car_|\.py$/g, '');
  if (wanted.length && !wanted.includes(name)) continue;
  const raw = path.join(TMP, `${name}.raw.glb`);
  const out = path.join(OUT, `${name}.glb`);
  execFileSync(BLENDER, ['--background', '--python', path.join(root, 'tools/blender', file), '--', raw], { env, stdio: 'pipe' });
  // -cc: meshopt compression (high), quantised attributes; -kn/-km: keep node + material names (the game maps materials by name).
  execFileSync(GLTFPACK, ['-i', raw, '-o', out, '-cc', '-kn', '-km'], { env, stdio: 'pipe', shell: true });
  console.log(`${name}: raw ${(fs.statSync(raw).size / 1024).toFixed(0)} KB → ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
