import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyAtmosphere } from '../../render/atmosphere';
import { instanced, Placement } from './BeachProps';

/**
 * Beach party dressing: reed-roofed drinks bars (bamboo posts, shaggy thatch with a hanging fringe, a reed-fronted
 * counter with stools, a lit bottle shelf, lanterns under the roof and a glowing DRINKS sign), and festoon
 * lighting: poles with sagging wires carrying coloured bulbs that glow (bloom) at dusk, plus tiki torches.
 * Everything is instanced / merged: a handful of draw calls for the whole beach.
 */

function noise3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Reed thatch: three overlapping tiers (each a shallow cone ending in a ragged hanging fringe), thousands of fine
 * radial straw streaks in the vertex colours, lumpy bundles, and a bound tuft on top.
 */
function thatchGeometry(radius: number, height: number, eaveY: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers = 3;
  for (let t = 0; t < tiers; t++) {
    const r0 = radius * (1 - t * 0.3);            // tier outer radius
    const y0 = eaveY + (height * t) / tiers;       // its eave height
    const h = height * (1 - t / tiers) + 0.12;     // up to the apex
    const cone = new THREE.ConeGeometry(r0, h, 96, 6, true).translate(0, y0 + h / 2, 0);
    const fringe = new THREE.CylinderGeometry(r0 * 0.99, r0 * 1.04, 0.42, 160, 3, true).translate(0, y0 - 0.17, 0);
    const fg = fringe.toNonIndexed();
    fg.userData.fringeBottom = y0 - 0.17 - 0.21;
    parts.push(cone.toNonIndexed(), fg);
  }
  parts.push(new THREE.ConeGeometry(0.22, 0.5, 16, 2, true).translate(0, eaveY + height + 0.3, 0).toNonIndexed()); // top tuft
  for (const g of parts) {
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const r = Math.hypot(x, z);
      // Bundles: the reed is laid in lumpy bundles around the roof.
      const bundle = Math.sin(a * 46) * 0.025 + (noise3(Math.round(a * 46), Math.round(y * 3), 1) - 0.5) * 0.05;
      if (r > 0.05) { const k = 1 + bundle / Math.max(r, 0.4); pos.setX(i, x * k); pos.setZ(i, z * k); }
      // Ragged fringe: bottom-ring vertices hang down by different amounts.
      const fr = noise3(Math.round(a * 160), 3, 7);
      if (g.userData.fringeBottom !== undefined && y < g.userData.fringeBottom + 0.01) pos.setY(i, y - fr * 0.32);
      // Straw colour: fine streaks (light ends, darker stems), sun-bleached top, darker underside.
      const streak = 0.62 + 0.5 * noise3(Math.round(a * 260), Math.round(y * 2), 5);
      const bleach = 0.9 + 0.15 * Math.min(1, Math.max(0, (y - eaveY) / height));
      const k = streak * bleach;
      const tint = 0.85 + 0.25 * (k - 0.62);
      col.set([1.05 * tint, 1.0 * tint, 0.92 * tint], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
  }
  return mergeGeometries(parts)!;
}

let strawTex: THREE.CanvasTexture | null = null;
/** Fine straw: thousands of thin reed strands (light ends, darker stems and gaps), tiled around the roof. */
function strawTexture(): THREE.CanvasTexture {
  if (strawTex) return strawTex;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6e5430'; g.fillRect(0, 0, 512, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * 512, y = rnd() * 256 - 40, len = 50 + rnd() * 150, w = 1 + rnd() * 2.2;
    const l = 150 + rnd() * 100;
    g.strokeStyle = `rgb(${l}, ${l * 0.8}, ${l * 0.48})`;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 8, y + len); g.stroke();
  }
  // Darker binding rows (the reed is tied on in courses).
  for (const y of [60, 190]) { g.fillStyle = 'rgba(40, 28, 14, 0.45)'; g.fillRect(0, y, 512, 4); }
  strawTex = new THREE.CanvasTexture(c);
  strawTex.colorSpace = THREE.SRGBColorSpace;
  strawTex.wrapS = strawTex.wrapT = THREE.RepeatWrapping;
  strawTex.repeat.set(10, 1.5);
  strawTex.anisotropy = 8;
  return strawTex;
}

let signTex: THREE.CanvasTexture | null = null;
function drinksSign(): THREE.CanvasTexture {
  if (signTex) return signTex;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#12061c'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#00e5ff'; g.lineWidth = 8; g.strokeRect(10, 10, 492, 140);
  g.font = 'italic 900 92px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#ff2bd6'; g.shadowBlur = 24;
  g.fillStyle = '#ff7ae6'; g.fillText('DRINKS', 256, 84);
  g.shadowBlur = 0; g.fillStyle = '#ffe6fb'; g.fillText('DRINKS', 256, 84);
  signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 8;
  return signTex;
}

/** Reed-roofed beach bars. Placement yaw: the counter faces local +Z. */
export function createBeachBars(list: Placement[]): THREE.Group {
  const g = new THREE.Group();
  if (!list.length) return g;
  const wood = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.85 }));
  const bamboo = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#c8a85a', roughness: 0.6 }));
  const st = strawTexture();
  const straw = applyAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, map: st, bumpMap: st, bumpScale: 2.5, roughness: 1, side: THREE.DoubleSide }));
  const reed = applyAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));

  // Bamboo posts with node rings.
  const posts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-1.9, -1.4], [1.9, -1.4], [-1.9, 1.4], [1.9, 1.4]]) {
    posts.push(new THREE.CylinderGeometry(0.08, 0.09, 2.95, 12).translate(x, 1.475, z));
    for (const y of [0.6, 1.3, 2.0, 2.6]) posts.push(new THREE.TorusGeometry(0.09, 0.018, 6, 14).rotateX(Math.PI / 2).translate(x, y, z));
  }
  g.add(instanced(mergeGeometries(posts.map((p) => p.toNonIndexed()))!, bamboo, list));

  // Thatched roof.
  g.add(instanced(thatchGeometry(3.3, 1.7, 2.95), straw, list));

  // Counter: wooden top, reed-faced front (vertical reed stripes via vertex colours), back shelf.
  const top = new THREE.BoxGeometry(3.4, 0.08, 0.6).translate(0, 1.12, 1.0);
  const shelf = new THREE.BoxGeometry(2.8, 0.06, 0.35).translate(0, 1.55, -1.1);
  const shelf2 = new THREE.BoxGeometry(2.8, 0.06, 0.35).translate(0, 1.95, -1.1);
  const back = new THREE.BoxGeometry(3.0, 1.6, 0.06).translate(0, 1.5, -1.3);
  g.add(instanced(mergeGeometries([top, shelf, shelf2, back].map((p) => p.toNonIndexed()))!, wood, list));
  const front = new THREE.BoxGeometry(3.3, 1.08, 0.5, 66, 1, 1).translate(0, 0.54, 1.0).toNonIndexed();
  {
    const pos = front.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let t = 0; t < pos.count / 3; t++) {
      const cx = (pos.getX(t * 3) + pos.getX(t * 3 + 1) + pos.getX(t * 3 + 2)) / 3;
      const k = 0.7 + 0.3 * Math.abs(Math.sin(cx * 60)) + (noise3(Math.round(cx * 20), 1, 2) - 0.5) * 0.15;
      for (let v = 0; v < 3; v++) col.set([0.78 * k, 0.62 * k, 0.36 * k], (t * 3 + v) * 3);
    }
    front.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g.add(instanced(front, reed, list));

  // Stools in front of the counter.
  const stools: THREE.BufferGeometry[] = [];
  for (const x of [-1.2, -0.4, 0.4, 1.2]) {
    stools.push(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 16).translate(x, 0.78, 1.75));
    stools.push(new THREE.CylinderGeometry(0.035, 0.05, 0.76, 8).translate(x, 0.38, 1.75));
  }
  g.add(instanced(mergeGeometries(stools.map((p) => p.toNonIndexed()))!, wood, list));

  // Lit bottles on the shelves (colour per bottle, unlit + bright so they glow a little).
  const bottles: THREE.BufferGeometry[] = [];
  const bcol: number[] = [];
  const tints = [[0.2, 1.6, 0.6], [1.8, 0.9, 0.2], [0.3, 0.9, 2.0], [1.9, 0.3, 1.2], [1.6, 1.5, 1.2]];
  for (const y of [1.58, 1.98]) {
    for (let i = 0; i < 12; i++) {
      const b = new THREE.CylinderGeometry(0.045, 0.05, 0.26, 10).translate(-1.25 + i * 0.23, y + 0.13, -1.08);
      const neck = new THREE.CylinderGeometry(0.018, 0.03, 0.1, 8).translate(-1.25 + i * 0.23, y + 0.31, -1.08);
      for (const part of [b, neck]) {
        const p = part.toNonIndexed();
        const t = tints[(i + (y > 1.7 ? 2 : 0)) % tints.length];
        for (let v = 0; v < p.getAttribute('position').count; v++) bcol.push(...t);
        bottles.push(p);
      }
    }
  }
  const bottleGeo = mergeGeometries(bottles)!;
  bottleGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bcol), 3));
  g.add(instanced(bottleGeo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true }), list));

  // Warm lanterns hanging under the roof + the DRINKS sign on the roof edge (bright enough to bloom).
  const lamps: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-1.2, 0.2], [0, -0.4], [1.2, 0.2]]) {
    lamps.push(new THREE.SphereGeometry(0.13, 16, 10).translate(x, 2.45, z));
    lamps.push(new THREE.CylinderGeometry(0.006, 0.006, 0.5, 4).translate(x, 2.8, z));
  }
  g.add(instanced(mergeGeometries(lamps.map((p) => p.toNonIndexed()))!, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb060').multiplyScalar(3.2) }), list));
  const sign = new THREE.PlaneGeometry(1.5, 0.47).translate(0, 2.6, -1.24);
  const signFrame = new THREE.BoxGeometry(1.6, 0.56, 0.05).translate(0, 2.6, -1.28);
  g.add(instanced(signFrame, wood, list));
  g.add(instanced(sign, new THREE.MeshBasicMaterial({ map: drinksSign(), color: new THREE.Color(2.4, 2.4, 2.4) }), list));
  return g;
}

/** One festoon string: two pole tops (world), sag in metres. */
export interface LightString { a: THREE.Vector3; b: THREE.Vector3; sag: number }

const BULB_COLORS = ['#ff2bd6', '#00e5ff', '#ffd23f', '#3dff9e', '#ff6a3c', '#a64dff', '#ffffff'].map((c) => new THREE.Color(c).multiplyScalar(2.3));

/** Party lights: wooden poles, sagging wires and glowing coloured bulbs (+ tiki torches). */
export function createPartyLights(poles: Placement[], strings: LightString[], torches: Placement[]): THREE.Group {
  const g = new THREE.Group();
  const wood = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#6e4a2c', roughness: 0.9 }));
  if (poles.length) {
    const pole = mergeGeometries([
      new THREE.CylinderGeometry(0.07, 0.09, 4.2, 10).translate(0, 2.1, 0),
      new THREE.BoxGeometry(0.5, 0.06, 0.06).translate(0, 4.0, 0),
    ].map((p) => p.toNonIndexed()))!;
    g.add(instanced(pole, wood, poles));
  }
  if (strings.length) {
    const wires: THREE.BufferGeometry[] = [];
    const bulbs: Placement[] = [];
    const cols: THREE.Color[] = [];
    let ci = 0;
    for (const s of strings) {
      const pts: THREE.Vector3[] = [];
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        pts.push(new THREE.Vector3().lerpVectors(s.a, s.b, u).add(new THREE.Vector3(0, -s.sag * 4 * u * (1 - u), 0)));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      wires.push(new THREE.TubeGeometry(curve, 24, 0.012, 5, false).toNonIndexed());
      const len = s.a.distanceTo(s.b);
      const count = Math.max(3, Math.round(len / 0.9));
      for (let i = 1; i < count; i++) {
        const p = curve.getPointAt(i / count);
        bulbs.push({ x: p.x, y: p.y - 0.09, z: p.z, yaw: 0 });
        cols.push(BULB_COLORS[ci++ % BULB_COLORS.length]);
      }
    }
    g.add(new THREE.Mesh(mergeGeometries(wires)!, new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 })));
    const bulb = new THREE.SphereGeometry(0.075, 12, 8);
    g.add(instanced(bulb, new THREE.MeshBasicMaterial({ color: '#ffffff' }), bulbs, cols));
  }
  if (torches.length) {
    const stick = new THREE.CylinderGeometry(0.035, 0.05, 1.8, 8).translate(0, 0.9, 0);
    const cup = new THREE.CylinderGeometry(0.11, 0.07, 0.22, 12).translate(0, 1.9, 0);
    g.add(instanced(mergeGeometries([stick, cup].map((p) => p.toNonIndexed()))!, wood, torches));
    const flame = new THREE.ConeGeometry(0.1, 0.38, 10).translate(0, 2.19, 0);
    g.add(instanced(flame, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8a24').multiplyScalar(3.5) }), torches));
  }
  return g;
}
