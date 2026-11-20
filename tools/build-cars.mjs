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
const wantedArgs = process.argv.slice(2).filter((a) => a !== '--lods');
const lodsOnly = process.argv.includes('--lods');
if (!lodsOnly && (!wantedArgs.length || wantedArgs.includes('rims'))) {
  const raw = path.join(TMP, 'rims.raw.glb');
  const outDir = path.join(root, 'public/models/wheels');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'rims.glb');
  execFileSync(BLENDER, ['--background', '--python', path.join(root, 'tools/blender/rims.py'), '--', raw], { env, stdio: 'pipe' });
  execFileSync(GLTFPACK, ['-i', raw, '-o', out, '-cc', '-kn', '-km'], { env, stdio: 'pipe', shell: true });
  console.log(`rims: raw ${(fs.statSync(raw).size / 1024).toFixed(0)} KB → ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

const scripts = fs.readdirSync(path.join(root, 'tools/blender')).filter((f) => /^car_.*\.py$/.test(f));
const wanted = wantedArgs;
for (const file of scripts) {
  const name = file.replace(/^car_|\.py$/g, '');
  if (lodsOnly || (wanted.length && !wanted.includes(name))) continue;
  const raw = path.join(TMP, `${name}.raw.glb`);
  const out = path.join(OUT, `${name}.glb`);
  execFileSync(BLENDER, ['--background', '--python', path.join(root, 'tools/blender', file), '--', raw], { env, stdio: 'pipe' });
  // -cc: meshopt compression (high), quantised attributes; -kn/-km: keep node + material names (the game maps materials by name).
  execFileSync(GLTFPACK, ['-i', raw, '-o', out, '-cc', '-kn', '-km'], { env, stdio: 'pipe', shell: true });
  console.log(`${name}: raw ${(fs.statSync(raw).size / 1024).toFixed(0)} KB → ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  lowLod(name, raw);
}

// Light version (~16k triangles, at most a quarter of the full one) for phones / weak GPUs and the AI cars at medium quality.
function triangles(glb) {
  const b = fs.readFileSync(glb);
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  let n = 0;
  for (const m of j.meshes) for (const p of m.primitives) n += p.indices !== undefined ? j.accessors[p.indices].count / 3 : 0;
  return n;
}
function lowLod(name, raw) {
  const lo = path.join(OUT, `${name}_lo.glb`);
  const ratio = Math.min(0.25, 16000 / triangles(raw)).toFixed(3);
  // -sa (aggressive) only for the detailed models: lets the simplifier merge across small parts.
  execFileSync(GLTFPACK, ['-i', raw, '-o', lo, '-cc', '-kn', '-km', '-si', ratio, ...(+ratio < 0.25 ? ['-sa'] : [])], { env, stdio: 'pipe', shell: true });
  console.log(`${name}_lo: ${(fs.statSync(lo).size / 1024).toFixed(0)} KB`);
}
// Only the light versions, from the raw .glb files of the last build: node tools/build-cars.mjs --lods
if (process.argv.includes('--lods')) for (const f of fs.readdirSync(TMP).filter((f) => /^(?!rims)[a-z]+\.raw\.glb$/.test(f))) lowLod(f.replace('.raw.glb', ''), path.join(TMP, f));
