import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural retro car generator.
 * The body and cabin are lofted: a superellipse cross-section is swept from nose to tail,
 * its width/top/bottom interpolated between "stations". Wheel wells are pushed into the mesh.
 * Car local axes: -Z forward, +Y up, +X right. Origin at ground level, centre of the car.
 */

/** [t (0 = nose, 1 = tail), top (m), bottom (m), half-width factor (0..1 of W/2)] */
export type Station = [number, number, number, number];

export interface CarStyle {
  name: string;
  length: number;
  width: number;
  body: Station[];
  bodyExp: number;
  bodyTumble: number;
  cabin: Station[];
  cabinExp: number;
  cabinTumble: number;
  wheelRadius: number;
  wheelT: [number, number];
  strakes: boolean;
  spoiler: 'wing' | 'ducktail' | 'none';
  /** Cross-section resolution (low = angular, low-poly) and how faceted the shading is (0 smooth … 1 flat). */
  around?: number;
  facet?: number;
  /** Rear wheels bigger than the fronts (muscle stance). */
  rearWheelScale?: number;
  /** Signature details that set the silhouettes apart. */
  features?: ('popups' | 'hoodScoop' | 'chromeBumpers' | 'rearSkirt' | 'flares' | 'roofSpoiler' | 'fin' | 'fenderPods')[];
}

export const CAR_STYLES: Record<string, CarStyle> = {
  /** 80s doorstop wedge: razor nose, flat sloped bonnet, pop-up lamps, side strakes, big wing. */
  wedge: {
    name: 'wedge',
    length: 4.4,
    width: 1.96,
    body: [[0.0, 0.42, 0.22, 0.78], [0.06, 0.55, 0.18, 0.92], [0.3, 0.74, 0.18, 1.0], [0.62, 0.86, 0.18, 1.0], [0.9, 0.9, 0.2, 1.0], [1.0, 0.88, 0.3, 0.95]],
    bodyExp: 7,
    bodyTumble: 0.1,
    cabin: [[0.36, 0.82, 0.76, 0.72], [0.46, 1.1, 0.78, 0.7], [0.6, 1.13, 0.82, 0.68], [0.72, 1.0, 0.86, 0.66], [0.8, 0.9, 0.86, 0.6]],
    cabinExp: 6,
    cabinTumble: 0.3,
    wheelRadius: 0.35,
    wheelT: [0.2, 0.79],
    strakes: true,
    spoiler: 'wing',
    features: ['popups'],
  },
  /** Muscle car: long bonnet with a scoop, slab sides, upright cabin far back, chrome bumpers, fat rears. */
  muscle: {
    name: 'muscle',
    length: 4.9,
    width: 1.98,
    body: [[0.0, 0.7, 0.28, 0.95], [0.02, 0.82, 0.24, 0.99], [0.4, 0.92, 0.22, 1.0], [0.8, 0.9, 0.22, 1.0], [0.98, 0.86, 0.26, 1.0], [1.0, 0.78, 0.32, 0.98]],
    bodyExp: 10,
    bodyTumble: 0.04,
    cabin: [[0.46, 0.9, 0.86, 0.82], [0.53, 1.36, 0.88, 0.8], [0.74, 1.38, 0.88, 0.8], [0.82, 1.2, 0.88, 0.8], [0.88, 0.92, 0.88, 0.78]],
    cabinExp: 8,
    cabinTumble: 0.12,
    wheelRadius: 0.37,
    wheelT: [0.17, 0.8],
    strakes: false,
    spoiler: 'ducktail',
    rearWheelScale: 1.1,
    features: ['hoodScoop', 'chromeBumpers'],
  },
  /** Flowing round coupé: teardrop cabin, rear wheels hidden behind skirts. */
  coupe: {
    name: 'coupe',
    length: 4.3,
    width: 1.86,
    body: [[0.0, 0.46, 0.28, 0.6], [0.06, 0.6, 0.22, 0.86], [0.28, 0.72, 0.2, 0.97], [0.55, 0.84, 0.2, 1.0], [0.85, 0.86, 0.22, 0.95], [1.0, 0.66, 0.34, 0.62]],
    bodyExp: 2.4,
    bodyTumble: 0.2,
    cabin: [[0.28, 0.74, 0.7, 0.76], [0.4, 1.12, 0.74, 0.72], [0.58, 1.16, 0.78, 0.68], [0.8, 0.98, 0.8, 0.6], [0.96, 0.8, 0.78, 0.4]],
    cabinExp: 2.8,
    cabinTumble: 0.3,
    wheelRadius: 0.34,
    wheelT: [0.19, 0.79],
    strakes: false,
    spoiler: 'none',
    facet: 0.15,
    features: ['rearSkirt'],
  },
  /** Short, tall rally hot hatch: boxy, square tailgate, bolted-on flares, roof spoiler. */
  hatch: {
    name: 'hatch',
    length: 3.75,
    width: 1.82,
    body: [[0.0, 0.58, 0.28, 0.85], [0.05, 0.74, 0.24, 0.97], [0.25, 0.84, 0.22, 1.0], [0.9, 0.9, 0.22, 1.0], [1.0, 0.9, 0.28, 0.98]],
    bodyExp: 8,
    bodyTumble: 0.06,
    cabin: [[0.3, 0.86, 0.82, 0.86], [0.4, 1.38, 0.84, 0.84], [0.93, 1.42, 0.86, 0.84], [1.0, 1.4, 0.86, 0.84]],
    cabinExp: 9,
    cabinTumble: 0.1,
    wheelRadius: 0.32,
    wheelT: [0.17, 0.83],
    strakes: false,
    spoiler: 'none',
    features: ['flares', 'roofSpoiler'],
  },
  /** Long, low grand tourer: endless bonnet, cabin pushed far back into a fastback. */
  gt: {
    name: 'gt',
    length: 5.1,
    width: 1.98,
    body: [[0.0, 0.5, 0.24, 0.74], [0.05, 0.64, 0.2, 0.9], [0.4, 0.76, 0.18, 0.97], [0.7, 0.84, 0.18, 1.0], [0.92, 0.86, 0.2, 0.98], [1.0, 0.76, 0.3, 0.86]],
    bodyExp: 3.4,
    bodyTumble: 0.15,
    cabin: [[0.44, 0.78, 0.72, 0.78], [0.54, 1.12, 0.76, 0.74], [0.66, 1.14, 0.78, 0.7], [0.88, 0.9, 0.8, 0.62], [1.0, 0.8, 0.8, 0.5]],
    cabinExp: 3.6,
    cabinTumble: 0.3,
    wheelRadius: 0.37,
    wheelT: [0.15, 0.8],
    strakes: false,
    spoiler: 'none',
  },
  /** Le Mans prototype: narrow central tub, separate fender pods, slim canopy, shark fin, huge wing. */
  proto: {
    name: 'proto',
    length: 4.8,
    width: 2.0,
    body: [[0.0, 0.34, 0.18, 0.92], [0.06, 0.46, 0.15, 0.98], [0.2, 0.54, 0.14, 0.9], [0.38, 0.6, 0.14, 0.62], [0.62, 0.74, 0.14, 0.7], [0.8, 0.82, 0.16, 1.0], [1.0, 0.8, 0.28, 0.98]],
    bodyExp: 4,
    bodyTumble: 0.1,
    cabin: [[0.3, 0.62, 0.58, 0.42], [0.4, 0.98, 0.6, 0.38], [0.55, 1.02, 0.64, 0.34], [0.7, 0.86, 0.7, 0.3], [0.78, 0.74, 0.7, 0.26]],
    cabinExp: 3.2,
    cabinTumble: 0.35,
    wheelRadius: 0.36,
    wheelT: [0.17, 0.82],
    strakes: false,
    spoiler: 'wing',
    features: ['fenderPods', 'fin'],
  },
  /** Mid-engine hypercar: pinched waist, big rear haunches, bubble canopy far forward, fin. */
  hyper: {
    name: 'hyper',
    length: 4.7,
    width: 2.06,
    body: [[0.0, 0.38, 0.2, 0.84], [0.06, 0.5, 0.17, 0.95], [0.22, 0.6, 0.16, 1.0], [0.45, 0.7, 0.16, 0.86], [0.75, 0.9, 0.18, 1.0], [0.92, 0.88, 0.2, 0.98], [1.0, 0.8, 0.3, 0.92]],
    bodyExp: 5,
    bodyTumble: 0.14,
    cabin: [[0.24, 0.62, 0.6, 0.6], [0.34, 1.0, 0.62, 0.56], [0.5, 1.06, 0.66, 0.5], [0.66, 0.92, 0.74, 0.44], [0.74, 0.84, 0.76, 0.36]],
    cabinExp: 4,
    cabinTumble: 0.34,
    wheelRadius: 0.36,
    wheelT: [0.2, 0.8],
    strakes: false,
    spoiler: 'wing',
    features: ['fin'],
  },
  /** Origami wedge: all hard flat planes, low-poly octagonal sections, fully faceted. */
  razor: {
    name: 'razor',
    length: 4.5,
    width: 2.0,
    body: [[0.0, 0.36, 0.2, 0.8], [0.08, 0.48, 0.17, 0.94], [0.35, 0.66, 0.16, 1.0], [0.65, 0.84, 0.17, 1.0], [0.95, 0.86, 0.2, 1.0], [1.0, 0.84, 0.3, 0.97]],
    bodyExp: 2,
    bodyTumble: 0.25,
    cabin: [[0.3, 0.68, 0.62, 0.7], [0.42, 1.0, 0.64, 0.62], [0.6, 1.04, 0.7, 0.56], [0.76, 0.9, 0.76, 0.5], [0.84, 0.8, 0.78, 0.4]],
    cabinExp: 2,
    cabinTumble: 0.3,
    wheelRadius: 0.36,
    wheelT: [0.19, 0.8],
    strakes: true,
    spoiler: 'wing',
    around: 8,
    facet: 1,
  },
};

export interface CarOptions {
  style?: keyof typeof CAR_STYLES | CarStyle;
  paint?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  /** Paint / neon finish: free = standard, pro = deep metallic clear-coat, elite = iridescent pearl. */
  tier?: 'free' | 'pro' | 'elite';
}

export interface BuiltCar {
  group: THREE.Group;
  /** Wheel pivots: [frontLeft, frontRight, rearLeft, rearRight]. Rotate .rotation.x to spin, front .rotation.y to steer. */
  wheels: THREE.Object3D[];
  style: CarStyle;
  /** Brake lights: 0 = normal tail lights (dim glow), 1 = braking (bright red glow). */
  setBrake(k: number): void;
  /** Local positions of the exhaust tips and the two tail-light units (for boost effects). */
  exhausts: THREE.Vector3[];
  tailLights: THREE.Vector3[];
}

// ---------------------------------------------------------------- loft

function interpStations(st: Station[], t: number): { top: number; bottom: number; hw: number } {
  if (t <= st[0][0]) return { top: st[0][1], bottom: st[0][2], hw: st[0][3] };
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1];
    if (t <= b[0]) {
      let k = (t - a[0]) / (b[0] - a[0]);
      k = k * k * (3 - 2 * k); // smooth
      return { top: a[1] + (b[1] - a[1]) * k, bottom: a[2] + (b[2] - a[2]) * k, hw: a[3] + (b[3] - a[3]) * k };
    }
  }
  const l = st[st.length - 1];
  return { top: l[1], bottom: l[2], hw: l[3] };
}

/** Superellipse point. Returns [x, y] in unit space (-1..1), with tumblehome applied to x. */
function sectionPoint(a: number, exp: number, tumble: number): [number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  const px = Math.sign(c) * Math.pow(Math.abs(c), 2 / exp);
  const py = Math.sign(s) * Math.pow(Math.abs(s), 2 / exp);
  return [px * (1 - tumble * Math.max(py, 0)), py];
}

interface LoftOpts {
  length: number;
  halfWidth: number;
  exp: number;
  tumble: number;
  along?: number;
  around?: number;
  /** Add the `aSec` attribute (t, uy, ux, cap) used by the car-body paint detail. */
  sections?: boolean;
  /** Optional per-vertex deformation (x, y, z) -> x. */
  deform?: (x: number, y: number, z: number) => number;
}

export function loft(stations: Station[], o: LoftOpts): THREE.BufferGeometry {
  const along = o.along ?? 64;
  const around = o.around ?? 48;
  const t0 = stations[0][0];
  const t1 = stations[stations.length - 1][0];
  const pos: number[] = [];
  const sec: number[] = []; // per vertex: t (0 nose..1 tail), section uy, section ux, 1 on end caps
  const idx: number[] = [];
  const rings: [number, number, number][][] = [];
  const ringSec: [number, number][] = [];
  for (let i = 0; i <= along; i++) {
    const t = t0 + ((t1 - t0) * i) / along;
    const z = -o.length / 2 + t * o.length;
    const st = interpStations(stations, t);
    const mid = (st.top + st.bottom) / 2;
    const hh = (st.top - st.bottom) / 2;
    const ring: [number, number, number][] = [];
    for (let j = 0; j < around; j++) {
      const [ux, uy] = sectionPoint((j / around) * Math.PI * 2, o.exp, o.tumble);
      let x = ux * st.hw * o.halfWidth;
      const y = mid + uy * hh;
      if (o.deform) x = o.deform(x, y, z);
      ring.push([x, y, z]);
      pos.push(x, y, z);
      sec.push(t, uy, ux, 0);
      if (i === 0) ringSec.push([uy, ux]);
    }
    rings.push(ring);
  }
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * around + j;
      const b = i * around + ((j + 1) % around);
      const c = (i + 1) * around + j;
      const d = (i + 1) * around + ((j + 1) % around);
      idx.push(a, b, c, b, d, c);
    }
  }
  // End caps with their own vertices (flat normals).
  for (const [ri, front] of [[0, true], [along, false]] as const) {
    const ring = rings[ri];
    const centre = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]).map((v) => v / ring.length);
    const base = pos.length / 3;
    const tc = front ? t0 : t1;
    pos.push(centre[0], centre[1], centre[2]);
    sec.push(tc, 0, 0, 1);
    ring.forEach((p, j) => {
      pos.push(p[0], p[1], p[2]);
      sec.push(tc, ringSec[j][0], ringSec[j][1], 1);
    });
    for (let j = 0; j < around; j++) {
      const p0 = base + 1 + j;
      const p1 = base + 1 + ((j + 1) % around);
      if (front) idx.push(base, p1, p0);
      else idx.push(base, p0, p1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (o.sections) g.setAttribute('aSec', new THREE.Float32BufferAttribute(sec, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- parts

let sidewall: THREE.MeshStandardMaterial | null = null;
const sidewallMat = () => (sidewall ??= new THREE.MeshStandardMaterial({ color: '#26262c', roughness: 0.9, side: THREE.DoubleSide }));
let disc: THREE.MeshStandardMaterial | null = null;
const discMat = () => (disc ??= new THREE.MeshStandardMaterial({ color: '#5a5c64', metalness: 0.9, roughness: 0.35 }));

function buildWheel(radius: number, accent: THREE.Color, tireMat: THREE.Material, rimMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const r = radius;
  // Tyre: lathe of a rounded profile around the X axis.
  const prof = [
    [r * 0.62, -0.13], [r * 0.9, -0.145], [r * 0.99, -0.11], [r, -0.05], [r, 0.05], [r * 0.99, 0.11], [r * 0.9, 0.145], [r * 0.62, 0.13],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, 28).rotateZ(Math.PI / 2), tireMat);
  g.add(tyre);
  // Sidewall lettering band (slightly lighter rubber) and a drilled-look brake disc behind the spokes.
  const band = new THREE.Mesh(new THREE.RingGeometry(r * 0.74, r * 0.84, 32).rotateY(Math.PI / 2), sidewallMat());
  band.position.x = 0.148;
  g.add(band);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.02, 24).rotateZ(Math.PI / 2), discMat());
  disc.position.x = 0.07;
  g.add(disc);
  // Rim dish.
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.64, r * 0.6, 0.22, 24).rotateZ(Math.PI / 2), rimMat);
  g.add(rim);
  // Spokes (5) on the outer face.
  const spokeGeo = new THREE.BoxGeometry(0.03, r * 1.15, 0.07);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(spokeGeo, rimMat);
    s.rotation.x = (i / 5) * Math.PI;
    s.position.x = 0.115;
    g.add(s);
  }
  // Neon rim ring (glows, nice motion blur feel through bloom).
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(r * 0.63, 0.012, 6, 32).rotateY(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(3) }),
  );
  ring.position.x = 0.12;
  g.add(ring);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12).rotateZ(Math.PI / 2), rimMat);
  hub.position.x = 0.125;
  g.add(hub);
  mergeStaticParts(g);
  return g;
}

function airfoilGeometry(chord: number, thick: number, span: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  // Shape in (x = along car z, y = up); leading edge at x = 0 (front).
  s.moveTo(0, 0);
  s.bezierCurveTo(chord * 0.05, thick * 0.9, chord * 0.35, thick, chord, thick * 0.2);
  s.lineTo(chord, 0);
  s.bezierCurveTo(chord * 0.6, -thick * 0.15, chord * 0.1, -thick * 0.3, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false, curveSegments: 10 });
  g.rotateY(-Math.PI / 2); // shape x -> car z, extrusion -> car -x
  g.translate(span / 2, 0, -chord / 2);
  return g;
}

// ---------------------------------------------------------------- builder

let halo: THREE.CanvasTexture | null = null;
/** Shared soft radial glow (for light halos). */
export function haloTexture(): THREE.CanvasTexture {
  if (halo) return halo;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  halo = new THREE.CanvasTexture(c);
  return halo;
}

let plateTex: THREE.CanvasTexture | null = null;
/** Generic number plate (made-up code), shared. */
function plateTexture(): THREE.CanvasTexture {
  if (plateTex) return plateTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8e6dc'; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#222'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 56);
  g.fillStyle = '#16161c'; g.font = 'bold 40px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('NV-1985', 128, 35);
  plateTex = new THREE.CanvasTexture(c);
  plateTex.colorSpace = THREE.SRGBColorSpace;
  plateTex.anisotropy = 4;
  return plateTex;
}

let shadowTex: THREE.CanvasTexture | null = null;
/** Soft rectangular contact shadow under the car. */
function shadowTexture(): THREE.CanvasTexture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = Math.max(0, Math.abs(x - 31.5) / 31.5 - 0.55) / 0.45;
      const dy = Math.max(0, Math.abs(y - 63.5) / 63.5 - 0.7) / 0.3;
      const d = Math.min(1, Math.hypot(dx, dy));
      const i = (y * 64 + x) * 4;
      img.data[i + 3] = Math.round(Math.pow(1 - d, 1.6) * 0.75 * 255);
    }
  }
  g.putImageData(img, 0, 0);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

let carbonTex: THREE.CanvasTexture | null = null;
/** Woven carbon-fibre look for the diffuser / splitter / skirts. */
function carbonTexture(): THREE.CanvasTexture {
  if (carbonTex) return carbonTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const odd = (x + y) % 2;
      const grad = odd ? g.createLinearGradient(x * 8, 0, x * 8 + 8, 0) : g.createLinearGradient(0, y * 8, 0, y * 8 + 8);
      grad.addColorStop(0, '#101014'); grad.addColorStop(0.5, '#2c2c34'); grad.addColorStop(1, '#101014');
      g.fillStyle = grad;
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  carbonTex = new THREE.CanvasTexture(c);
  carbonTex.wrapS = carbonTex.wrapT = THREE.RepeatWrapping;
  carbonTex.repeat.set(10, 2);
  carbonTex.colorSpace = THREE.SRGBColorSpace;
  return carbonTex;
}

/**
 * Body paint detail: panel seams (bonnet, doors, boot) cut into the paint, darker lower body so the shape
 * reads, and a fine metallic flake in the roughness. Uses the loft's `aSec` attribute (t, uy, ux, cap).
 * seams = [bonnet end t, door front t, door rear t, boot start t] (> 1 = none).
 */
function applyBodyDetail(mat: THREE.MeshPhysicalMaterial, seams: [number, number, number, number], L: number, hw: number, flake: number, facet = 0.4): void {
  const uniforms = { uSeam: { value: new THREE.Vector4(...seams) }, uL: { value: L }, uHW: { value: hw }, uFlake: { value: flake }, uFacet: { value: facet } };
  mat.customProgramCacheKey = () => 'car-body-detail-v2';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSec;\nvarying vec4 vSec;\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSec = aSec;\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
uniform vec4 uSeam; uniform float uL, uHW, uFlake, uFacet;
varying vec4 vSec; varying vec3 vLocal;
float gSeam = 0.0;
float seamLine(float d) {
  float w = max(fwidth(d), 1e-5);
  return (1.0 - smoothstep(0.0035, 0.0035 + w * 1.5, abs(d))) * smoothstep(0.03, 0.008, w);
}
float flakeHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
{
  float tt = vSec.x, uy = vSec.y, ux = vSec.z, body = 1.0 - vSec.w;
  float topM = smoothstep(0.5, 0.65, uy) * body;
  float sideBand = smoothstep(0.8, 0.9, abs(ux)) * body;
  float sideM = sideBand * smoothstep(0.66, 0.58, uy) * smoothstep(-0.62, -0.54, uy);
  float g = 0.0;
  g = max(g, topM * seamLine((tt - uSeam.x) * uL));
  g = max(g, topM * step(tt, uSeam.x) * step(0.05, tt) * seamLine((abs(ux) - 0.72) * uHW));
  g = max(g, topM * seamLine((tt - uSeam.w) * uL));
  g = max(g, topM * step(uSeam.w, tt) * step(tt, 0.985) * seamLine((abs(ux) - 0.72) * uHW));
  g = max(g, sideM * seamLine((tt - uSeam.y) * uL));
  g = max(g, sideM * seamLine((tt - uSeam.z) * uL));
  g = max(g, sideBand * step(uSeam.y, tt) * step(tt, uSeam.z) * seamLine((uy + 0.54) * 0.25));
  gSeam = g;
  float lower = mix(0.5, 1.0, smoothstep(-0.95, 0.25, uy));
  diffuseColor.rgb *= lower * (1.0 - 0.8 * g);
}`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
{
  // Slightly faceted: mix the smooth normal with the flat facet normal, so the panels read as crisp planes.
  vec3 fn = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  if (dot(fn, normal) < 0.0) fn = -fn;
  normal = normalize(mix(normal, fn, uFacet));
}`)
      .replace('#include <lights_physical_fragment>', /* glsl */ `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
material.clearcoat *= 1.0 - 0.9 * gSeam;
#endif
{
  float fw = fwidth(vLocal.x) + fwidth(vLocal.y) + fwidth(vLocal.z);
  float fl = flakeHash(floor(vLocal * 700.0));
  material.roughness = clamp(mix(material.roughness, 0.85, gSeam) + (fl - 0.5) * uFlake * (1.0 - smoothstep(0.001, 0.004, fw)), 0.05, 1.0);
}`);
  };
}

/** Section-surface point on the body at loft position t and section height uy (for placing small parts). */
function bodySurface(style: CarStyle, hwm: number, t: number, uy: number): [number, number, number] {
  const st = interpStations(style.body, t);
  const [ux] = sectionPoint(Math.asin(Math.pow(uy, style.bodyExp / 2)), style.bodyExp, style.bodyTumble);
  return [ux * st.hw * hwm, (st.top + st.bottom) / 2 + uy * (st.top - st.bottom) / 2, -style.length / 2 + t * style.length];
}

/**
 * Merge the car's static child meshes that share a material into one mesh per material (fewer draw calls).
 * Wheels (pivots), sprites, the cabin, the contact shadow and the body keep their own objects; brake-light
 * materials stay shared, so animating their colour still works.
 */
function mergeStaticParts(car: THREE.Object3D): void {
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  for (const o of car.children) {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.name || Array.isArray(m.material) || m.geometry.getAttribute('aSec')) continue;
    const list = groups.get(m.material) ?? [];
    list.push(m);
    groups.set(m.material, list);
  }
  for (const [mat, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      m.updateMatrix();
      let g = m.geometry.clone().applyMatrix4(m.matrix);
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      return g;
    });
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    for (const m of meshes) {
      car.remove(m);
      m.geometry.dispose();
    }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.renderOrder = Math.max(...meshes.map((m) => m.renderOrder));
    car.add(mesh);
  }
}

const fogHalos = new Map<string, THREE.SpriteMaterial>();
/** Big soft light halos that only show in fog / mist (shared per colour; see setCarFogGlow). */
function fogHalo(color: string): THREE.SpriteMaterial {
  let m = fogHalos.get(color);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: haloTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false });
    m.visible = false;
    fogHalos.set(color, m);
  }
  return m;
}

/** 0..1 how much the car lights glow in the air (weather mist). */
export function setCarFogGlow(k: number): void {
  for (const m of fogHalos.values()) {
    m.opacity = 0.55 * k;
    m.visible = k > 0.02;
  }
}

export function buildCar(opts: CarOptions = {}): BuiltCar {
  const style = typeof opts.style === 'object' ? opts.style : CAR_STYLES[opts.style ?? 'wedge'];
  const accent = new THREE.Color(opts.accent ?? '#00e5ff');
  const L = style.length;
  const W = style.width;
  const hwm = W / 2;
  const R = style.wheelRadius;

  const tier = opts.tier ?? 'free';
  const paint = new THREE.MeshPhysicalMaterial({
    color: opts.paint ?? '#c8ff00', metalness: 0.5, roughness: 0.4, clearcoat: 0.85, clearcoatRoughness: 0.12,
    ...(tier === 'pro' ? { metalness: 0.75, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.07 } : {}),
    ...(tier === 'elite' ? { metalness: 0.85, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 820] as [number, number] } : {}),
  });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#04060c', metalness: 0.9, roughness: 0.04, clearcoat: 1 });
  const trim = new THREE.MeshStandardMaterial({ color: '#0a090e', metalness: 0.4, roughness: 0.45 });
  const tyre = new THREE.MeshStandardMaterial({ color: '#0c0c0f', metalness: 0.0, roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#2a2a33', metalness: 0.95, roughness: 0.2 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#c4c8d2', metalness: 1, roughness: 0.14 });
  const soot = new THREE.MeshBasicMaterial({ color: '#020203' });
  const sootIn = new THREE.MeshBasicMaterial({ color: '#020203', side: THREE.BackSide });
  const carbon = new THREE.MeshStandardMaterial({ color: '#ffffff', map: carbonTexture(), metalness: 0.3, roughness: 0.35 });
  const smoked = new THREE.MeshPhysicalMaterial({ color: '#12060a', metalness: 0.2, roughness: 0.08, clearcoat: 1 });
  // Lights are not dimmed by fog (they shine through it; the fog halos below add the glow).
  const glow = (c: THREE.ColorRepresentation, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), fog: false });

  const car = new THREE.Group();
  car.name = `car-${style.name}`;

  const wheelZ = style.wheelT.map((t) => -L / 2 + t * L);
  const wheelX = hwm - 0.16;
  const archR = R + 0.09;
  const feat = new Set(style.features ?? []);
  const wheelR = [R, R * (style.rearWheelScale ?? 1)];
  const archRs = wheelR.map((r) => r + 0.09);
  // Rear skirts: no rear wheel well, the body hangs over the top of the wheel.
  const wells = feat.has('rearSkirt') ? [0] : [0, 1];

  // Body with wheel wells pushed in.
  const deform = (x: number, y: number, z: number): number => {
    let k = 1;
    for (const wi of wells) {
      const r = Math.hypot(z - wheelZ[wi], y - wheelR[wi]);
      const inWell = 1 - THREE.MathUtils.smoothstep(r, archRs[wi] - 0.05, archRs[wi]);
      k = Math.min(k, 1 - inWell * 0.38);
    }
    // Only the sides are pushed, not the centre of the floor.
    return Math.abs(x) > hwm * 0.45 ? x * k : x;
  };
  const bodyGeo = loft(style.body, { length: L, halfWidth: hwm, exp: style.bodyExp, tumble: style.bodyTumble, along: 60, around: style.around ?? 40, deform, sections: true });
  // Vertex colours: paint everywhere, near-black inside the wheel wells.
  const bp = bodyGeo.getAttribute('position');
  const colors = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    let c = 1;
    if (Math.abs(x) > hwm * 0.45) {
      for (const wi of wells) {
        const r = Math.hypot(z - wheelZ[wi], y - wheelR[wi]);
        c = Math.min(c, 0.03 + 0.97 * THREE.MathUtils.smoothstep(r, archRs[wi] - 0.06, archRs[wi] - 0.01));
      }
    }
    colors.set([c, c, c], i * 3);
  }
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const bodyPaint = paint.clone();
  bodyPaint.vertexColors = true;
  // Panel seams: bonnet ends at the windscreen, doors between the wheel arches, boot lid behind the cabin.
  const c0 = style.cabin[0][0], c1 = style.cabin[style.cabin.length - 1][0];
  const archT = (archR + 0.04) / L;
  const doorF = Math.max(c0 + 0.05, style.wheelT[0] + archT + 0.02);
  const doorR = Math.min(c0 + (c1 - c0) * 0.62, style.wheelT[1] - archT - 0.03);
  applyBodyDetail(bodyPaint, [c0 - 0.01, doorF, doorR, c1 < 0.95 ? c1 + 0.015 : 2], L, hwm, tier === 'free' ? 0.18 : 0.3, style.facet ?? 0.4);
  const body = new THREE.Mesh(bodyGeo, bodyPaint);
  car.add(body);

  const lowPoly = (style.around ?? 40) < 16;
  const cabinGlass = lowPoly ? Object.assign(glass.clone(), { flatShading: true }) : glass;
  const cabin = new THREE.Mesh(loft(style.cabin, { length: L, halfWidth: hwm, exp: style.cabinExp, tumble: style.cabinTumble, along: lowPoly ? 8 : 40, around: lowPoly ? 8 : 40 }), cabinGlass);
  cabin.name = 'cabin';
  car.add(cabin);

  // Wheel-well liners (dark arch lips).
  for (const wi of wells) {
    for (const side of [-1, 1]) {
      const lip = new THREE.Mesh(new THREE.TorusGeometry(archRs[wi] - 0.02, 0.03, 6, 20, Math.PI).rotateY(Math.PI / 2), trim);
      lip.position.set(side * (hwm * 0.97), wheelR[wi], wheelZ[wi]);
      car.add(lip);
    }
  }

  // Wheels.
  const wheels: THREE.Object3D[] = [];
  for (let wi = 0; wi < 2; wi++) {
    const wz = wheelZ[wi];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * wheelX, wheelR[wi], wz);
      const wheel = buildWheel(wheelR[wi], accent, tyre, rimMat);
      if (side < 0) wheel.rotation.y = Math.PI; // outer face outward
      pivot.add(wheel);
      car.add(pivot);
      wheels.push(pivot);
    }
  }

  const rear = interpStations(style.body, 1);
  const front = interpStations(style.body, 0);

  const rh = rear.top - rear.bottom;
  const rz = L / 2;
  const rearHW = (W / 2) * rear.hw;

  // Tail lights: smoked-glass housing in a chrome surround, two lamp units with segments and brighter
  // inner elements, reversing lights, and a dim red reflector strip between the units.
  const tlY = rear.bottom + rh * 0.66;
  const tlW = W * rear.hw * 0.86;
  const tlH = Math.min(0.15, rh * 0.28);
  const TAIL_ON = 2.2, TAIL_BRAKE = 12;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(tlW + 0.05, tlH + 0.05, 0.05), smoked);
  housing.position.set(0, tlY, rz);
  car.add(housing);
  for (const [w, h, x, y] of [[tlW + 0.08, 0.012, 0, tlH / 2 + 0.03], [tlW + 0.08, 0.012, 0, -tlH / 2 - 0.03], [0.012, tlH + 0.07, tlW / 2 + 0.04, 0], [0.012, tlH + 0.07, -tlW / 2 - 0.04, 0]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), chrome);
    f.position.set(x, tlY + y, rz + 0.02);
    car.add(f);
  }
  const tailMat = glow('#ff1030', TAIL_ON);
  const bulbMat = glow('#ff2a3a', TAIL_ON * 1.6);
  const unitW = tlW * 0.34;
  const SEGS = 3;
  for (const side of [-1, 1]) {
    const cx = side * (tlW / 2 - unitW / 2);
    const unit = new THREE.Mesh(new THREE.BoxGeometry(unitW, tlH * 0.8, 0.02), tailMat);
    unit.position.set(cx, tlY, rz + 0.03);
    car.add(unit);
    for (let i = 0; i < SEGS; i++) {
      const bulb = new THREE.Mesh(new THREE.BoxGeometry((unitW / SEGS) * 0.5, tlH * 0.36, 0.02), bulbMat);
      bulb.position.set(cx + (i - (SEGS - 1) / 2) * (unitW / SEGS), tlY, rz + 0.036);
      car.add(bulb);
      if (i > 0) {
        const div = new THREE.Mesh(new THREE.BoxGeometry(0.01, tlH * 0.82, 0.025), smoked);
        div.position.set(cx + (i - SEGS / 2) * (unitW / SEGS), tlY, rz + 0.035);
        car.add(div);
      }
    }
    const rev = new THREE.Mesh(new THREE.BoxGeometry(0.07, tlH * 0.5, 0.02), glow('#ffffff', 0.5));
    rev.position.set(side * (tlW / 2 - unitW - 0.06), tlY, rz + 0.03);
    car.add(rev);
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.05, tlW - 2 * unitW - 0.26), tlH * 0.22, 0.02), glow('#ff1030', 0.6));
  strip.position.set(0, tlY, rz + 0.03);
  car.add(strip);
  // Soft red halos (always faintly on, bright when braking) + a third brake light.
  const haloMat = new THREE.SpriteMaterial({ map: haloTexture(), color: '#ff2a3a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35, fog: false });
  const halos: THREE.Sprite[] = [];
  for (const x of [-tlW / 2 + unitW / 2, tlW / 2 - unitW / 2]) {
    const fh = new THREE.Sprite(fogHalo('#ff2030'));
    fh.position.set(x, tlY, rz + 0.25);
    fh.scale.setScalar(2.2);
    car.add(fh);
    const h = new THREE.Sprite(haloMat);
    h.position.set(x, tlY, rz + 0.1);
    h.scale.setScalar(0.55);
    car.add(h);
    halos.push(h);
  }
  const cbl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.03), glow('#ff1030', 0));
  cbl.position.set(0, rear.top + 0.005, L / 2 - 0.12);
  car.add(cbl);
  const cblMat = cbl.material as THREE.MeshBasicMaterial;
  const red = new THREE.Color('#ff1030');
  let brakeK = -1;
  const setBrake = (k: number) => {
    k = Math.max(0, Math.min(1, k));
    if (Math.abs(k - brakeK) < 0.01) return;
    brakeK = k;
    tailMat.color.copy(red).multiplyScalar(TAIL_ON + (TAIL_BRAKE - TAIL_ON) * k);
    bulbMat.color.copy(red).multiplyScalar(TAIL_ON * 1.6 + (TAIL_BRAKE * 1.5 - TAIL_ON * 1.6) * k);
    cblMat.color.copy(red).multiplyScalar(10 * k);
    haloMat.opacity = 0.35 + 0.65 * k;
    for (const h of halos) h.scale.setScalar(0.55 + 0.75 * k);
  };
  setBrake(0);

  // Number plate in a dark recess, lit from above.
  const plY = rear.bottom + rh * 0.36;
  const recess = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.17, 0.03), soot);
  recess.position.set(0, plY, rz + 0.002);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.12), new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5, emissive: '#ffffff', emissiveMap: plateTexture(), emissiveIntensity: 0.25 }));
  plate.position.set(0, plY, rz + 0.02);
  const plLight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.02), glow('#ffffff', 1.2));
  plLight.position.set(0, plY + 0.08, rz + 0.02);
  car.add(recess, plate, plLight);

  // Rear bumper: dark lower band with corner vents and reflectors.
  const bumpH = Math.max(0.08, rh * 0.2);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(rearHW * 1.7, bumpH, 0.07), trim);
  bumper.position.set(0, rear.bottom + bumpH / 2 + 0.01, rz + 0.01);
  car.add(bumper);
  for (const side of [-1, 1]) {
    const vx = side * (rearHW * 0.9 - 0.16);
    const vy = rear.bottom + rh * 0.38;
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.02), soot);
    vent.position.set(vx, vy, rz + 0.004);
    car.add(vent);
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.008, 0.03), trim);
      slat.position.set(vx, vy - 0.03 + i * 0.03, rz + 0.012);
      car.add(slat);
    }
    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.02), glow('#ff1030', 0.9));
    refl.position.set(side * (rearHW * 0.85 - 0.1), rear.bottom + bumpH / 2 + 0.01, rz + 0.05);
    car.add(refl);
  }

  // Carbon diffuser with vertical fins.
  const dW = W * 0.72;
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(dW, 0.05, 0.42), carbon);
  diffuser.position.set(0, rear.bottom - 0.03, rz - 0.14);
  diffuser.rotation.x = -0.12;
  car.add(diffuser);
  for (let i = 0; i < 6; i++) {
    const x = (i / 5 - 0.5) * dW * 0.86;
    if (Math.abs(Math.abs(x) - 0.42) < 0.09) continue; // leave room for the exhausts
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.13, 0.36), carbon);
    fin.position.set(x, rear.bottom + 0.02, rz - 0.12);
    car.add(fin);
  }
  // Exhausts: chrome tips with a rolled lip, sooty inside, a glow deep in the pipe.
  const exhausts: THREE.Vector3[] = [];
  const tailLights = [-1, 1].map((side) => new THREE.Vector3(side * (tlW / 2 - unitW / 2), tlY, rz + 0.05));
  for (const x of [-0.42, 0.42]) {
    const ey = rear.bottom + 0.03;
    exhausts.push(new THREE.Vector3(x, ey, rz + 0.1));
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.28, 18, 1, true).rotateX(Math.PI / 2), chrome);
    pipe.position.set(x, ey, rz - 0.05);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 20), chrome);
    lip.position.set(x, ey, rz + 0.09);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.22, 16, 1, true).rotateX(Math.PI / 2), sootIn);
    inner.position.set(x, ey, rz - 0.03);
    const flame = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), glow('#ff7a20', 1.8));
    flame.position.set(x, ey, rz - 0.06);
    car.add(pipe, lip, inner, flame);
  }

  // Headlights in smoked housings, amber indicators, slatted intake.
  const hlY = front.bottom + (front.top - front.bottom) * 0.62;
  for (const side of [-1, 1]) {
    const hx = side * W * front.hw * 0.3;
    const hous = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.03), smoked);
    hous.position.set(hx, hlY, -L / 2 - 0.002);
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.07, 0.04), glow('#eaf6ff', 6));
    hl.position.set(hx, hlY, -L / 2 - 0.006);
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.03), glow('#ff9a20', 1.4));
    ind.position.set(hx + side * 0.3, hlY, -L / 2 - 0.004);
    car.add(hous, hl, ind);
    const fh = new THREE.Sprite(fogHalo('#e8f0ff'));
    fh.position.set(hx, hlY, -L / 2 - 0.25);
    fh.scale.setScalar(3.2);
    car.add(fh);
  }
  const intake = new THREE.Mesh(new THREE.BoxGeometry(W * front.hw * 0.7, 0.08, 0.04), soot);
  intake.position.set(0, front.bottom + 0.07, -L / 2 - 0.003);
  car.add(intake);
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(W * front.hw * 0.7, 0.008, 0.05), trim);
    slat.position.set(0, front.bottom + 0.045 + i * 0.025, -L / 2 - 0.005);
    car.add(slat);
  }
  // Carbon front splitter.
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.03, 0.25), carbon);
  splitter.position.set(0, front.bottom - 0.03, -L / 2 + 0.12);
  car.add(splitter);

  // Side strakes (classic 80s intakes).
  if (style.strakes) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.85), trim);
        st.position.set(side * (hwm + 0.005), 0.46 + i * 0.065, -L / 2 + 0.64 * L);
        car.add(st);
      }
    }
  }

  // Spoiler.
  if (style.spoiler === 'wing') {
    const wingY = rear.top + 0.24;
    const wing = new THREE.Mesh(airfoilGeometry(0.42, 0.08, W * 0.92), paint);
    wing.position.set(0, wingY, L / 2 - 0.28);
    wing.rotation.x = 0.08;
    car.add(wing);
    for (const x of [-0.55, 0.55]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.18), trim);
      strut.position.set(x, rear.top + 0.1, L / 2 - 0.28);
      car.add(strut);
    }
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.48), trim);
      plate.position.set(side * W * 0.46, wingY + 0.02, L / 2 - 0.28);
      car.add(plate);
    }
  } else if (style.spoiler === 'ducktail') {
    const lip = new THREE.Mesh(airfoilGeometry(0.3, 0.06, W * 0.9), paint);
    lip.position.set(0, rear.top - 0.01, L / 2 - 0.15);
    lip.rotation.x = -0.25;
    car.add(lip);
  }

  else {
    // Small boot-lid lip so the tail edge catches a highlight.
    const lip = new THREE.Mesh(airfoilGeometry(0.16, 0.035, W * rear.hw * 0.86), paint);
    lip.position.set(0, rear.top - 0.005, L / 2 - 0.07);
    lip.rotation.x = -0.18;
    car.add(lip);
  }

  // Side skirts between the wheels, door handles, fuel filler cap.
  {
    const z0 = wheelZ[0] + archR + 0.04, z1 = wheelZ[1] - archR - 0.04;
    const midSt = interpStations(style.body, 0.5);
    for (const side of [-1, 1]) {
      const sk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, z1 - z0), carbon);
      sk.position.set(side * hwm * midSt.hw * 0.94, midSt.bottom + 0.04, (z0 + z1) / 2);
      car.add(sk);
      const [hx, hy, hz] = bodySurface(style, hwm, doorR - 0.05, 0.35);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.14), chrome);
      handle.position.set(side * (hx + 0.008), hy, hz);
      car.add(handle);
    }
    const [fx, fy, fz] = bodySurface(style, hwm, Math.min(0.9, style.wheelT[1] + archT + 0.03), 0.45);
    const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 20).rotateZ(Math.PI / 2), chrome);
    filler.position.set(fx + 0.004, fy, fz);
    car.add(filler);
  }

  // Soft contact shadow on the road.
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.25, L * 1.12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), color: '#000000', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  shadow.name = 'shadow';
  shadow.position.y = 0.02;
  shadow.renderOrder = 2;
  car.add(shadow);

  // Signature details.
  {
    const st = (t: number) => interpStations(style.body, t);
    if (feat.has('popups')) {
      // Closed pop-up headlamp covers on the bonnet nose.
      const f = st(0.1);
      for (const side of [-1, 1]) {
        const pod = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.26), paint);
        pod.position.set(side * W * 0.27, f.top + 0.01, -L / 2 + 0.1 * L);
        pod.rotation.x = -0.18;
        car.add(pod);
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.012, 0.012), soot);
        seam.position.set(side * W * 0.27, f.top + 0.035, -L / 2 + 0.1 * L - 0.13);
        car.add(seam);
      }
    }
    if (feat.has('hoodScoop')) {
      const f = st(0.22);
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.13, 0.85), paint);
      scoop.position.set(0, f.top + 0.05, -L / 2 + 0.22 * L);
      scoop.rotation.x = -0.04;
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.02), soot);
      mouth.position.set(0, f.top + 0.07, -L / 2 + 0.22 * L - 0.43);
      car.add(scoop, mouth);
    }
    if (feat.has('chromeBumpers')) {
      const fr = st(0), rr = st(1);
      const fb = new THREE.Mesh(new THREE.BoxGeometry(W * fr.hw * 0.98, 0.1, 0.1), chrome);
      fb.position.set(0, fr.bottom + 0.1, -L / 2 - 0.03);
      const rb = new THREE.Mesh(new THREE.BoxGeometry(W * rr.hw * 0.96, 0.1, 0.1), chrome);
      rb.position.set(0, rr.bottom + 0.06, L / 2 + 0.05);
      car.add(fb, rb);
    }
    if (feat.has('flares')) {
      // Bolted-on boxy fender flares over every wheel.
      for (let wi = 0; wi < 2; wi++) {
        for (const side of [-1, 1]) {
          const fl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, archRs[wi] * 2.3), paint);
          fl.position.set(side * (hwm + 0.02), wheelR[wi] + archRs[wi] * 0.62, wheelZ[wi]);
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, archRs[wi] * 2.3), trim);
          edge.position.set(side * (hwm + 0.025), wheelR[wi] + archRs[wi] * 0.62 - 0.08, wheelZ[wi]);
          car.add(fl, edge);
        }
      }
    }
    if (feat.has('roofSpoiler')) {
      const last = style.cabin[style.cabin.length - 1];
      const sp = new THREE.Mesh(new THREE.BoxGeometry(W * last[3] * 0.92, 0.05, 0.32), paint);
      sp.position.set(0, last[1] + 0.03, -L / 2 + last[0] * L - 0.12);
      sp.rotation.x = 0.12;
      car.add(sp);
    }
    if (feat.has('fin')) {
      // Shark fin from the cabin back along the engine cover.
      const t0 = style.cabin[style.cabin.length - 1][0] - 0.06;
      const shape = new THREE.Shape();
      const len = (1 - t0) * L * 0.85;
      shape.moveTo(0, 0);
      shape.lineTo(len, 0);
      shape.lineTo(len, 0.32);
      shape.lineTo(len * 0.25, 0.08);
      shape.lineTo(0, 0);
      const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.0125, 0, 0), paint);
      fin.position.set(0, st(t0 + 0.05).top - 0.04, -L / 2 + t0 * L);
      car.add(fin);
    }
    if (feat.has('fenderPods')) {
      // Separate rounded pods over the wheels, standing proud of the narrow central tub.
      const pod = new THREE.SphereGeometry(1, 20, 12);
      for (let wi = 0; wi < 2; wi++) {
        for (const side of [-1, 1]) {
          const m = new THREE.Mesh(pod, paint);
          m.scale.set(0.26, wheelR[wi] * 0.7, archRs[wi] * 1.25);
          m.position.set(side * (hwm - 0.26), wheelR[wi] + 0.06, wheelZ[wi]);
          car.add(m);
        }
      }
    }
  }

  // Side mirrors.
  const mirrorT = style.cabin[0][0] + 0.06;
  const mz = -L / 2 + mirrorT * L;
  const mBody = interpStations(style.body, mirrorT);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.12), paint);
    // Attached to the cabin's A-pillar (narrow canopies kept them floating in the air before).
    const cs = interpStations(style.cabin, mirrorT);
    m.position.set(side * (hwm * Math.min(cs.hw, mBody.hw * 0.95) + 0.05), Math.max(mBody.top, cs.bottom) + 0.07, mz);
    car.add(m);
  }

  // Neon pinstripes along the shoulder line, following the loft surface.
  const py0 = 0.62;
  const sa = Math.asin(Math.pow(py0, style.bodyExp / 2));
  const [ux] = sectionPoint(sa, style.bodyExp, style.bodyTumble);
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = 0.05 + (0.9 * i) / 40;
      const st = interpStations(style.body, t);
      const z = -L / 2 + t * L;
      const y = (st.top + st.bottom) / 2 + py0 * (st.top - st.bottom) / 2;
      pts.push(new THREE.Vector3(side * (ux * st.hw * hwm + 0.006), y, z));
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.01, 5), glow(accent, tier === 'elite' ? 5 : tier === 'pro' ? 4 : 3));
    car.add(tube);
  }

  // Underglow.
  const under = new THREE.Mesh(new THREE.BoxGeometry(W * 0.75, 0.03, L * 0.75), glow(accent, tier === 'elite' ? 6 : tier === 'pro' ? 4 : 2.5));
  under.position.y = 0.16;
  car.add(under);

  mergeStaticParts(car);
  car.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = false;
  });
  return { group: car, wheels, style, setBrake, exhausts, tailLights };
}
