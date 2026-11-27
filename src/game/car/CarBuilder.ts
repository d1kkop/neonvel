import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { carModelFor, rimModelFor, RIM_MODEL_RADIUS } from './carModels';

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
  features?: ('popups' | 'hoodScoop' | 'chromeBumpers' | 'rearSkirt' | 'flares' | 'roofSpoiler' | 'fin' | 'fenderPods' | 'vinylRoof' | 'chromeTrim' | 'louvers' | 'tailFins')[];
  /** Wheel-arch shape: 2 = round, 4–6 = squared-off 70s/80s arches. */
  archSquare?: number;
  /** Rim design. */
  rim?: RimStyle;
  /** Bought / hand-made model (public/models/cars/<name>.glb) brings its own body, wheels and lamps: real proportions, not raised. */
  model?: boolean;
}

/**
 * A style for a complete model: length / width / wheels are the model's real measurements (the wheels and lamps
 * are read from the model itself); the station tables only matter if the model failed to load.
 */
function modelStyle(name: string, length: number, width: number, wheelRadius: number, wheelT: [number, number]): CarStyle {
  return {
    name, model: true, length, width, wheelRadius, wheelT, rim: 'star5',
    body: [[0.0, 0.55, 0.3, 0.9], [0.04, 0.68, 0.26, 0.98], [0.3, 0.78, 0.25, 1.0], [0.65, 0.82, 0.25, 1.0], [0.96, 0.84, 0.27, 1.0], [1.0, 0.8, 0.34, 0.97]],
    bodyExp: 10, bodyTumble: 0.1,
    cabin: [[0.34, 0.8, 0.74, 0.8], [0.44, 1.18, 0.76, 0.76], [0.7, 1.2, 0.78, 0.74], [0.8, 0.98, 0.79, 0.72], [0.84, 0.84, 0.8, 0.7]],
    cabinExp: 9, cabinTumble: 0.2, strakes: false, spoiler: 'none',
  };
}

export const CAR_STYLES: Record<string, CarStyle> = {
  /** 80s notchback sports coupé: flat bonnet and slab sides, pop-up lamps, short boot with a lip. */
  wedge: {
    name: 'wedge',
    rim: 'turbofan',
    length: 4.4,
    width: 1.86,
    body: [[0.0, 0.5, 0.26, 0.86], [0.03, 0.6, 0.22, 0.97], [0.3, 0.7, 0.21, 1.0], [0.62, 0.78, 0.21, 1.0], [0.95, 0.8, 0.22, 1.0], [1.0, 0.76, 0.3, 0.97]],
    bodyExp: 12,
    bodyTumble: 0.06,
    cabin: [[0.36, 0.76, 0.7, 0.8], [0.45, 1.06, 0.72, 0.78], [0.68, 1.08, 0.74, 0.77], [0.76, 0.94, 0.75, 0.76], [0.8, 0.8, 0.75, 0.74]],
    cabinExp: 9,
    cabinTumble: 0.2,
    wheelRadius: 0.33,
    wheelT: [0.17, 0.81],
    strakes: false,
    spoiler: 'ducktail',
    archSquare: 4,
    features: ['popups'],
  },
  /** 70s muscle land yacht: endless bonnet with a scoop, slab sides, vinyl roof, chrome bumpers, fat rears. */
  muscle: {
    name: 'muscle',
    rim: 'star5',
    length: 5.2,
    width: 2.0,
    body: [[0.0, 0.74, 0.3, 0.97], [0.02, 0.84, 0.26, 1.0], [0.45, 0.88, 0.24, 1.0], [0.82, 0.86, 0.24, 1.0], [0.99, 0.84, 0.28, 1.0], [1.0, 0.78, 0.34, 0.99]],
    bodyExp: 16,
    bodyTumble: 0.03,
    cabin: [[0.46, 0.88, 0.82, 0.84], [0.52, 1.28, 0.84, 0.82], [0.76, 1.3, 0.84, 0.82], [0.84, 1.12, 0.84, 0.82], [0.88, 0.9, 0.84, 0.8]],
    cabinExp: 12,
    cabinTumble: 0.1,
    wheelRadius: 0.36,
    wheelT: [0.16, 0.8],
    strakes: false,
    spoiler: 'ducktail',
    rearWheelScale: 1.08,
    archSquare: 5,
    features: ['hoodScoop', 'chromeBumpers', 'vinylRoof'],
  },
  /** Mid-80s two-seat kammback: low wedge nose, flush lamps, long sloping glass hatch, chopped tail. */
  coupe: {
    name: 'coupe',
    rim: 'dish',
    length: 3.9,
    width: 1.74,
    body: [[0.0, 0.5, 0.24, 0.9], [0.04, 0.58, 0.21, 0.97], [0.3, 0.68, 0.2, 1.0], [0.9, 0.78, 0.21, 1.0], [1.0, 0.76, 0.28, 0.97]],
    bodyExp: 10,
    bodyTumble: 0.06,
    cabin: [[0.3, 0.68, 0.66, 0.8], [0.46, 1.06, 0.7, 0.76], [0.6, 1.06, 0.72, 0.74], [0.9, 0.84, 0.76, 0.72], [0.93, 0.78, 0.76, 0.7]],
    cabinExp: 8,
    cabinTumble: 0.18,
    wheelRadius: 0.31,
    wheelT: [0.17, 0.79],
    strakes: false,
    spoiler: 'none',
    archSquare: 3,
    features: [],
  },
  /** Late-80s German-style sport sedan: two-door three-box, box flares, quad round lamps, boot wing. */
  hatch: {
    name: 'hatch',
    rim: 'mesh',
    length: 4.35,
    width: 1.84,
    body: [[0.0, 0.6, 0.26, 0.9], [0.03, 0.74, 0.23, 0.97], [0.25, 0.8, 0.22, 1.0], [0.8, 0.84, 0.22, 1.0], [1.0, 0.82, 0.28, 0.98]],
    bodyExp: 12,
    bodyTumble: 0.04,
    cabin: [[0.3, 0.82, 0.8, 0.86], [0.42, 1.24, 0.82, 0.8], [0.66, 1.26, 0.84, 0.8], [0.76, 0.98, 0.84, 0.78], [0.78, 0.86, 0.84, 0.76]],
    cabinExp: 10,
    cabinTumble: 0.1,
    wheelRadius: 0.32,
    wheelT: [0.18, 0.8],
    strakes: false,
    spoiler: 'wing',
    archSquare: 4,
    features: ['flares'],
  },
  /** 80s personal-luxury coupé: very long and square, formal upright roof, vinyl top, chrome everywhere. */
  gt: {
    name: 'gt',
    rim: 'mesh',
    length: 5.3,
    width: 1.98,
    body: [[0.0, 0.66, 0.26, 0.94], [0.02, 0.76, 0.23, 0.99], [0.4, 0.82, 0.22, 1.0], [0.78, 0.82, 0.22, 1.0], [0.98, 0.8, 0.26, 1.0], [1.0, 0.74, 0.32, 0.98]],
    bodyExp: 14,
    bodyTumble: 0.04,
    cabin: [[0.42, 0.82, 0.78, 0.8], [0.5, 1.18, 0.8, 0.78], [0.72, 1.2, 0.8, 0.78], [0.8, 1.06, 0.8, 0.78], [0.84, 0.84, 0.8, 0.76]],
    cabinExp: 10,
    cabinTumble: 0.12,
    wheelRadius: 0.35,
    wheelT: [0.16, 0.8],
    strakes: false,
    spoiler: 'none',
    archSquare: 5,
    features: ['chromeBumpers', 'vinylRoof', 'chromeTrim'],
  },
  /** Boxy endurance racer: flat-sided tub, square fender boxes, slim canopy, tail fins, big wing. */
  proto: {
    name: 'proto',
    rim: 'turbofan',
    length: 4.8,
    width: 2.04,
    body: [[0.0, 0.36, 0.18, 0.94], [0.05, 0.46, 0.15, 0.99], [0.2, 0.54, 0.14, 0.92], [0.38, 0.6, 0.14, 0.66], [0.62, 0.72, 0.14, 0.72], [0.8, 0.8, 0.16, 1.0], [1.0, 0.8, 0.26, 1.0]],
    bodyExp: 9,
    bodyTumble: 0.08,
    cabin: [[0.3, 0.6, 0.56, 0.42], [0.4, 0.96, 0.58, 0.38], [0.55, 1.0, 0.62, 0.34], [0.7, 0.84, 0.68, 0.3], [0.78, 0.72, 0.68, 0.26]],
    cabinExp: 5,
    cabinTumble: 0.3,
    wheelRadius: 0.36,
    wheelT: [0.17, 0.82],
    strakes: false,
    spoiler: 'wing',
    archSquare: 4,
    features: ['fenderPods', 'tailFins'],
  },
  /** Angular mid-engine wedge: pinched waist, tall rear haunches, louvred engine cover, fin. */
  hyper: {
    name: 'hyper',
    rim: 'star5',
    length: 4.6,
    width: 2.1,
    body: [[0.0, 0.4, 0.2, 0.86], [0.06, 0.5, 0.17, 0.96], [0.22, 0.6, 0.16, 1.0], [0.45, 0.68, 0.16, 0.88], [0.75, 0.9, 0.18, 1.0], [0.94, 0.9, 0.2, 1.0], [1.0, 0.86, 0.3, 0.96]],
    bodyExp: 9,
    bodyTumble: 0.12,
    cabin: [[0.24, 0.62, 0.6, 0.62], [0.34, 1.0, 0.62, 0.58], [0.5, 1.04, 0.66, 0.52], [0.62, 0.92, 0.72, 0.46], [0.68, 0.84, 0.74, 0.4]],
    cabinExp: 7,
    cabinTumble: 0.3,
    wheelRadius: 0.36,
    wheelT: [0.2, 0.8],
    strakes: true,
    spoiler: 'wing',
    archSquare: 3,
    features: ['fin', 'louvers'],
  },
  /** 80s city bus: a long box with a glass band, big wheels. */
  bus: {
    name: 'bus',
    rim: 'dish',
    length: 11,
    width: 2.5,
    body: [[0.0, 2.7, 0.45, 0.96], [0.012, 2.95, 0.42, 1.0], [0.985, 2.95, 0.42, 1.0], [1.0, 2.8, 0.45, 0.97]],
    bodyExp: 18,
    bodyTumble: 0.02,
    cabin: [[0.005, 2.55, 1.35, 1.03], [0.995, 2.55, 1.35, 1.03]], // window band stands slightly proud of the sides
    cabinExp: 20,
    cabinTumble: 0,
    wheelRadius: 0.52,
    wheelT: [0.17, 0.76],
    strakes: false,
    spoiler: 'none',
    archSquare: 4,
  },
  /** Origami wedge: all hard flat planes, low-poly octagonal sections, fully faceted. */
  razor: {
    name: 'razor',
    rim: 'mesh',
    length: 4.5,
    width: 2.06,
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
  // The 90s pack (tools/build-cars.mjs): real sizes, measured by tools/blender/import90s.py.
  asti: modelStyle('asti', 4.31, 2.03, 0.33, [0.18, 0.83]),
  phoenix: modelStyle('phoenix', 5.06, 2.16, 0.35, [0.18, 0.8]),
  gallo: modelStyle('gallo', 5.16, 2.18, 0.35, [0.18, 0.8]),
  duke: modelStyle('duke', 5.56, 2.09, 0.37, [0.2, 0.8]),
  duntov: modelStyle('duntov', 5.02, 2.01, 0.35, [0.18, 0.8]),
  cheetah: modelStyle('cheetah', 5.03, 2.14, 0.35, [0.18, 0.8]),
  nfr: modelStyle('nfr', 4.9, 2.18, 0.35, [0.18, 0.8]),
  classic: modelStyle('classic', 4.44, 1.81, 0.36, [0.2, 0.8]),
};

export interface CarOptions {
  style?: keyof typeof CAR_STYLES | CarStyle;
  paint?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  /** Paint / neon finish: free = standard, pro = deep metallic clear-coat, elite = iridescent pearl. */
  tier?: 'free' | 'pro' | 'elite';
  /** Always use the procedural body (e.g. the space roadster, which removes its greenhouse). */
  procedural?: boolean;
  /** Use the light body model (phones / weak GPUs / AI cars). */
  lowDetail?: boolean;
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
const sidewallMat = () => (sidewall ??= new THREE.MeshStandardMaterial({ color: '#141417', roughness: 0.85, side: THREE.DoubleSide }));
let disc: THREE.MeshStandardMaterial | null = null;
const discMat = () => (disc ??= new THREE.MeshStandardMaterial({ color: '#8a8d96', metalness: 0.95, roughness: 0.28 }));
/** Sidewall lettering (light grey, raised-rubber look), drawn once and shared by every tyre. */
let sidewallText: THREE.MeshStandardMaterial | null = null;
function sidewallTextMat(): THREE.MeshStandardMaterial {
  if (sidewallText) return sidewallText;
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.translate(S / 2, S / 2);
  g.fillStyle = '#d6d8de';
  g.font = `900 ${Math.round(S * 0.05)}px Orbitron, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Text around the ring (the ring mesh maps the canvas flat: radius 0.5 S = outer edge of the band).
  const words = ['NEON VELOCITY', '· RACING SLICK ·', 'NV-R  245/35 R19', '· RACING SLICK ·'];
  const r = S * 0.455;
  words.forEach((w, wi) => {
    const a0 = (wi / words.length) * Math.PI * 2;
    const step = 0.045;
    for (let i = 0; i < w.length; i++) {
      const a = a0 + (i - w.length / 2) * step;
      g.save();
      g.rotate(a);
      g.translate(0, -r);
      g.fillText(w[i], 0, 0);
      g.restore();
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  sidewallText = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.75, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return sidewallText;
}
const sidewallRings = new Map<string, THREE.BufferGeometry>();
/** The lettering ring on the tyre's outer sidewall (rr = rim radius). Not merged: it carries a texture. */
function sidewallRing(rr: number): THREE.Mesh {
  const key = rr.toFixed(4);
  let geo = sidewallRings.get(key);
  if (!geo) {
    // Letters sit at 0.91 of the ring's outer radius (see the canvas), i.e. on the middle of the sidewall band.
    geo = new THREE.RingGeometry(rr * 1.06, (rr * 1.15) / 0.91, 72).rotateY(Math.PI / 2).translate(0.1436, 0, 0);
    sidewallRings.set(key, geo);
  }
  const m = new THREE.Mesh(geo, sidewallTextMat());
  m.name = 'sidewall'; // keep it out of mergeStaticParts
  return m;
}

export type RimStyle = 'turbofan' | 'mesh' | 'star5' | 'spokes' | 'dish' | 'wire';

let barrel: THREE.MeshStandardMaterial | null = null;
const barrelMat = () => (barrel ??= new THREE.MeshStandardMaterial({ color: '#202228', metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide }));
let lip: THREE.MeshStandardMaterial | null = null;
const lipMat = () => (lip ??= new THREE.MeshStandardMaterial({ color: '#e4e7ee', metalness: 1, roughness: 0.06, envMapIntensity: 1.5, side: THREE.DoubleSide }));
let cap: THREE.MeshStandardMaterial | null = null;
const capMat = () => (cap ??= new THREE.MeshStandardMaterial({ color: '#101014', metalness: 0.5, roughness: 0.3, side: THREE.DoubleSide }));
const accentMats = new Map<number, THREE.MeshBasicMaterial>();
const accentMat = (c: THREE.Color) => {
  const key = c.getHex();
  let m = accentMats.get(key);
  if (!m) accentMats.set(key, (m = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.2) })));
  return m;
};

/** A part placed radially on the wheel face: geometry built pointing up (+Y) from the centre, rotated about X. */
function radial(geo: THREE.BufferGeometry, angle: number, x: number): THREE.BufferGeometry {
  return geo.clone().rotateX(angle).translate(x, 0, 0);
}

let wheelMaterial: THREE.MeshStandardMaterial | null = null;
/**
 * One material for every wheel in the game: colour, metalness / roughness and the neon glow come from vertex
 * attributes (see bakeWheel), so a whole wheel is a single draw call instead of ten.
 */
function wheelMat(): THREE.MeshStandardMaterial {
  if (wheelMaterial) return wheelMaterial;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 1.35 });
  m.name = 'wheel';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aMR;\nattribute vec3 aEm;\nvarying vec2 vMR;\nvarying vec3 vEm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMR = aMR;\nvEm = aEm;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMR;\nvarying vec3 vEm;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vMR.y;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMR.x;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vEm;');
  };
  return (wheelMaterial = m);
}

const bakedWheels = new Map<string, THREE.BufferGeometry>();
/**
 * Collapse a built wheel (tyre, sidewall, disc, barrel, lip, face, cap, nuts, neon ring: one mesh per material)
 * into a single mesh. Each part's material is written into its vertices: colour, metalness + roughness, and
 * unlit (glowing) parts as emissive. Identical wheels share one geometry (cached by `key`).
 */
function bakeWheel(g: THREE.Group, key: string): THREE.Group {
  let geo = bakedWheels.get(key);
  if (!geo) {
    const parts: THREE.BufferGeometry[] = [];
    for (const o of g.children) {
      const m = o as THREE.Mesh;
      if (!m.isMesh) continue;
      m.updateMatrix();
      let pg = m.geometry.clone().applyMatrix4(m.matrix);
      if (pg.index) pg = pg.toNonIndexed();
      for (const k of Object.keys(pg.attributes)) if (k !== 'position' && k !== 'normal') pg.deleteAttribute(k);
      const n = pg.getAttribute('position').count;
      const mat = m.material as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
      const lit = (mat as THREE.Material).type !== 'MeshBasicMaterial';
      const col = new Float32Array(n * 3), mr = new Float32Array(n * 2), em = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        if (lit) {
          col.set([mat.color.r, mat.color.g, mat.color.b], i * 3);
          mr.set([mat.metalness ?? 0, mat.roughness ?? 1], i * 2);
        } else {
          mr.set([0, 1], i * 2);
          em.set([mat.color.r, mat.color.g, mat.color.b], i * 3);
        }
      }
      pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      pg.setAttribute('aMR', new THREE.BufferAttribute(mr, 2));
      pg.setAttribute('aEm', new THREE.BufferAttribute(em, 3));
      parts.push(pg);
    }
    geo = mergeGeometries(parts)!;
    parts.forEach((x) => x.dispose());
    bakedWheels.set(key, geo);
  }
  const out = new THREE.Group();
  out.add(new THREE.Mesh(geo, wheelMat()));
  return out;
}

/**
 * Wheel with a period rim: low-profile tyre with a sidewall band, a deep rim barrel and lip, and one of five 80s
 * faces (turbofan, cross-spoke mesh, 5-star, multi-spoke, slotted dish), plus a brake disc. The outer face is +X.
 */
function buildWheel(radius: number, accent: THREE.Color, tireMat: THREE.Material, rimMat: THREE.Material, style: RimStyle = 'star5'): THREE.Group {
  const g = new THREE.Group();
  const r = radius;
  const rm = rimMat as THREE.MeshStandardMaterial;
  const key = [r.toFixed(4), style, rm.color.getHexString(), rm.roughness, accent.getHexString(), rimModelFor(style) ? 'm' : 'p'].join('|');
  const rr = r * 0.7; // rim radius (low-profile tyre)
  const withSidewall = (w: THREE.Group) => { w.add(sidewallRing(rr)); return w; };
  if (bakedWheels.has(key)) return withSidewall(bakeWheel(g, key));
  // Low-profile tyre with three circumferential tread grooves in the running surface.
  const gr = r * 0.975;
  const prof = [[rr, -0.13], [r * 0.95, -0.14], [r * 0.995, -0.11], [r, -0.085], [r, -0.06], [gr, -0.058], [gr, -0.046], [r, -0.044],
    [r, -0.008], [gr, -0.006], [gr, 0.006], [r, 0.008], [r, 0.044], [gr, 0.046], [gr, 0.058], [r, 0.06], [r, 0.085], [r * 0.995, 0.11], [r * 0.95, 0.14], [rr, 0.13]]
    .map(([a, b]) => new THREE.Vector2(a, b));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 72).rotateZ(Math.PI / 2), tireMat));
  const band = new THREE.Mesh(new THREE.RingGeometry(rr * 1.08, rr * 1.22, 64).rotateY(Math.PI / 2), sidewallMat());
  band.position.x = 0.142;
  g.add(band);
  // Barrel (dark inside), polished lip, brake disc behind the face.
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.99, rr * 0.99, 0.24, 40, 1, true).rotateZ(Math.PI / 2), barrelMat()));
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rr * 0.97, 0.014, 10, 64).rotateY(Math.PI / 2), rimMat);
  lip.position.x = 0.125;
  g.add(lip);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.82, rr * 0.82, 0.024, 48).rotateZ(Math.PI / 2), discMat());
  disc.position.x = 0.02;
  // Cross-drilled disc: two staggered rings of holes, and the dark centre hat.
  const holes: THREE.BufferGeometry[] = [];
  const hole = new THREE.CylinderGeometry(rr * 0.022, rr * 0.022, 0.026, 8).rotateZ(Math.PI / 2);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2, rad = rr * (i % 2 ? 0.66 : 0.74);
    holes.push(hole.clone().translate(0.021, Math.cos(a) * rad, Math.sin(a) * rad).toNonIndexed());
  }
  holes.push(new THREE.CylinderGeometry(rr * 0.4, rr * 0.4, 0.03, 32).rotateZ(Math.PI / 2).translate(0.022, 0, 0).toNonIndexed());
  const discHoles = new THREE.Mesh(mergeGeometries(holes.map((h) => { for (const k of Object.keys(h.attributes)) if (k !== 'position' && k !== 'normal') h.deleteAttribute(k); return h; })), barrelMat());
  g.add(discHoles);
  // Modelled rim (Blender): replaces the procedural barrel, lip and face.
  const model = rimModelFor(style);
  if (model) {
    g.remove(g.children[g.children.length - 2], g.children[g.children.length - 1]); // procedural barrel + lip
    g.add(disc);
    const byName: Record<string, THREE.Material> = { rim: rimMat, lip: lipMat(), barrel: barrelMat(), cap: capMat(), nut: lipMat(), accent: accentMat(accent) };
    const k = rr / RIM_MODEL_RADIUS;
    for (const part of model) {
      const name = (part.material as THREE.Material).name.replace(/\.\d+$/, '');
      const m = new THREE.Mesh(part.geometry, byName[name] ?? rimMat);
      m.name = 'rim'; // keep the shared geometry out of mergeStaticParts
      m.scale.set(1, k, k);
      g.add(m);
    }
    return withSidewall(bakeWheel(g, key));
  }
  g.add(disc);
  const face: THREE.BufferGeometry[] = [];
  const x = 0.112;
  if (style === 'turbofan') {
    face.push(new THREE.CylinderGeometry(rr * 0.92, rr * 0.92, 0.018, 40).rotateZ(Math.PI / 2).translate(x - 0.012, 0, 0));
    const blade = new THREE.BoxGeometry(0.028, rr * 0.46, rr * 0.13).rotateY(0.55).translate(0, rr * 0.6, 0);
    for (let i = 0; i < 14; i++) face.push(radial(blade, (i / 14) * Math.PI * 2, x));
  } else if (style === 'mesh' || style === 'wire') {
    face.push(new THREE.TorusGeometry(rr * 0.9, 0.018, 10, 64).rotateY(Math.PI / 2).translate(x, 0, 0));
    const bar = new THREE.BoxGeometry(0.016, rr * 1.8, 0.018);
    for (let i = 0; i < 8; i++) {
      face.push(radial(bar.clone().translate(0, 0, rr * 0.18), (i / 8) * Math.PI * 2, x));
      face.push(radial(bar.clone().translate(0, 0, -rr * 0.18), (i / 8) * Math.PI * 2 + Math.PI / 8, x + 0.006));
    }
  } else if (style === 'spokes') {
    const sp = new THREE.BoxGeometry(0.02, rr * 0.86, 0.032).translate(0, rr * 0.47, 0);
    for (let i = 0; i < 10; i++) face.push(radial(sp, (i / 10) * Math.PI * 2, x));
  } else if (style === 'dish') {
    face.push(new THREE.CylinderGeometry(rr * 0.93, rr * 0.85, 0.03, 40).rotateZ(Math.PI / 2).translate(x - 0.006, 0, 0));
  } else {
    // 5-star: wide tapered spokes.
    const sp = new THREE.CylinderGeometry(rr * 0.055, rr * 0.11, rr * 0.86, 4).rotateY(Math.PI / 4).scale(0.6, 1, 1.2).translate(0, rr * 0.47, 0);
    for (let i = 0; i < 5; i++) face.push(radial(sp, (i / 5) * Math.PI * 2, x));
  }
  face.push(new THREE.CylinderGeometry(rr * 0.2, rr * 0.22, 0.05, 20).rotateZ(Math.PI / 2).translate(x + 0.01, 0, 0)); // centre cap
  g.add(new THREE.Mesh(mergeGeometries(face.map((f) => (f.index ? f.toNonIndexed() : f)).map((f) => { for (const k of Object.keys(f.attributes)) if (k !== 'position' && k !== 'normal') f.deleteAttribute(k); return f; })), rimMat));
  if (style === 'dish') {
    // Slots in the dish.
    const slot = new THREE.CylinderGeometry(rr * 0.11, rr * 0.11, 0.035, 12).rotateZ(Math.PI / 2).translate(0, rr * 0.56, 0);
    const slots: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) slots.push(radial(slot, (i / 8) * Math.PI * 2, x + 0.004).toNonIndexed());
    g.add(new THREE.Mesh(mergeGeometries(slots), barrelMat()));
  }
  // Thin neon line on the lip (the game's glow).
  const ring = new THREE.Mesh(new THREE.TorusGeometry(rr * 0.99, 0.008, 8, 64).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(2.2) }));
  ring.position.x = 0.13;
  g.add(ring);
  return withSidewall(bakeWheel(g, key));
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

let beamTex: THREE.CanvasTexture | null = null;
/**
 * Headlight beams on the road, seen from above: two soft cones that start narrow at the bumper (bottom of the
 * texture) and fan out and fade with distance (top). Drawn additively, so they only ever brighten the road.
 */
function beamTexture(): THREE.CanvasTexture {
  if (beamTex) return beamTex;
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const d = 1 - y / (H - 1); // 0 at the bumper, 1 far ahead
    const fade = Math.pow(Math.min(1, d / 0.08), 1.2) * Math.pow(1 - d, 1.7); // soft start, long fall-off
    for (let x = 0; x < W; x++) {
      const u = (x / (W - 1)) * 2 - 1; // -1..1 across
      let a = 0;
      for (const cx of [-0.42, 0.42]) {
        const half = 0.1 + d * 0.5; // cone half-width grows with distance
        const k = Math.max(0, 1 - Math.abs(u - cx * (1 - d * 0.55)) / half);
        a = Math.max(a, k * k * (3 - 2 * k));
      }
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * fade * 255);
    }
  }
  g.putImageData(img, 0, 0);
  beamTex = new THREE.CanvasTexture(c);
  return beamTex;
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
  const [ux] = sectionPoint(Math.sign(uy) * Math.asin(Math.pow(Math.abs(uy), style.bodyExp / 2)), style.bodyExp, style.bodyTumble); // works below the middle too
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
    // Keep uv only when every part has it (hand-modelled bodies come without).
    const keep = meshes.every((m) => m.geometry.getAttribute('uv')) ? ['position', 'normal', 'uv'] : ['position', 'normal'];
    // Baked AO (vertex colours) must survive the merge, or AO materials would turn black.
    if (meshes.every((m) => m.geometry.getAttribute('color'))) {
      keep.push('color');
      for (const m of meshes) {
        const c = m.geometry.getAttribute('color') as THREE.BufferAttribute;
        if (c.itemSize === 4) { // RGBA → RGB, so every part matches
          const rgb = new Float32Array(c.count * 3);
          for (let i = 0; i < c.count; i++) { rgb[i * 3] = c.getX(i); rgb[i * 3 + 1] = c.getY(i); rgb[i * 3 + 2] = c.getZ(i); }
          m.geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
        }
      }
    }
    const geos = meshes.map((m) => {
      m.updateMatrix();
      let g = m.geometry.clone().applyMatrix4(m.matrix);
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
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

/**
 * Real-car proportions: the base station tables were drawn low (F1-ish). Road cars get noticeably taller
 * bodies, roofs and more ground clearance; the race cars only a little. Wheels grow a bit with them.
 */
const HEIGHT_SCALE: Record<string, number> = { bus: 1, wedge: 1.14, muscle: 1.16, coupe: 1.16, hatch: 1.12, gt: 1.14, proto: 1.05, hyper: 1.07, razor: 1.12 };
const WHEEL_GROW = 1; // v8 experiment (1.07) reverted with the v6 models
export function raiseStyle(st: CarStyle): CarStyle {
  if (st.model) return st;
  const k = HEIGHT_SCALE[st.name] ?? 1.15;
  const lift = (rows: Station[]): Station[] => rows.map(([t, top, bottom, hw]) => [t, top * k, bottom * (1 + (k - 1) * 1.3), hw]);
  // v8: bigger wheels that fill the arches (the Blender bodies are cut for the same size, see styles.json).
  const grow = st.name === 'bus' ? 1 : WHEEL_GROW;
  return { ...st, body: lift(st.body), cabin: lift(st.cabin), wheelRadius: st.wheelRadius * (1 + (k - 1) * 0.7) * grow };
}

/**
 * Car materials for the detailed (v5) models: vertex-colour ambient occlusion (baked in Blender) darkens the
 * creases AND their reflections, and car paint gets tiny metallic flakes under the smooth clear coat (they fade
 * out with distance, so they sparkle up close without shimmering far away).
 */
function enhanceCarMaterial(mat: THREE.MeshStandardMaterial, flakes: boolean): void {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vObjPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vObjPos = position;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vObjPos;
float nvHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }`);
    if (flakes) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 cell = floor(vObjPos * 1400.0);
  vec3 rnd = vec3(nvHash(cell), nvHash(cell + 3.1), nvHash(cell + 7.7)) - 0.5;
  float px = length(fwidth(vObjPos)) * 1400.0; // flake cells per pixel: gone well before they could turn into noise
  normal = normalize(normal + rnd * 0.1 * clamp(1.0 - px * 1.6, 0.0, 1.0));
}`);
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#ifdef USE_COLOR
  reflectedLight.indirectSpecular *= mix(1.0, vColor.r, 0.85);
  reflectedLight.directSpecular *= mix(1.0, vColor.r, 0.5);
#endif`);
  };
  mat.customProgramCacheKey = () => `nv-car-${flakes ? 1 : 0}`;
}

export function buildCar(opts: CarOptions = {}): BuiltCar {
  const style = raiseStyle(typeof opts.style === 'object' ? opts.style : CAR_STYLES[opts.style ?? 'wedge']);
  const accent = new THREE.Color(opts.accent ?? '#00e5ff');
  const L = style.length;
  const W = style.width;
  const hwm = W / 2;
  let R = style.wheelRadius;

  const tier = opts.tier ?? 'free';
  const paint = new THREE.MeshPhysicalMaterial({
    color: opts.paint ?? '#c8ff00', metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.09, envMapIntensity: 1.25,
    ...(tier === 'pro' ? { metalness: 0.75, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.07 } : {}),
    ...(tier === 'elite' ? { metalness: 0.85, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 820] as [number, number] } : {}),
  });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#05070d', metalness: 0.92, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 1.6 });
  const trim = new THREE.MeshStandardMaterial({ color: '#0a090e', metalness: 0.4, roughness: 0.45 });
  const tyre = new THREE.MeshStandardMaterial({ color: '#08080a', metalness: 0.0, roughness: 0.88 });
  // Silver rims that stand out against the black rubber (the dearer the car, the brighter the polish).
  const rimMat = new THREE.MeshStandardMaterial({ color: tier === 'elite' ? '#e6e9ef' : tier === 'pro' ? '#d4d8df' : '#c4c8d0', metalness: 1, roughness: tier === 'elite' ? 0.07 : tier === 'pro' ? 0.11 : 0.16, envMapIntensity: 1.6 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: tier === 'free' ? '#3a3c44' : new THREE.Color(accent).lerp(new THREE.Color('#ff2a3a'), 0.5), metalness: 0.4, roughness: 0.35 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d8dce6', metalness: 1, roughness: 0.07, envMapIntensity: 1.4 });
  const soot = new THREE.MeshBasicMaterial({ color: '#020203' });
  const sootIn = new THREE.MeshBasicMaterial({ color: '#020203', side: THREE.BackSide });
  const carbon = new THREE.MeshStandardMaterial({ color: '#ffffff', map: carbonTexture(), metalness: 0.3, roughness: 0.35 });
  const smoked = new THREE.MeshPhysicalMaterial({ color: '#12060a', metalness: 0.2, roughness: 0.08, clearcoat: 1 });
  // Lights are not dimmed by fog (they shine through it; the fog halos below add the glow).
  const glow = (c: THREE.ColorRepresentation, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), fog: false });

  const car = new THREE.Group();
  car.name = `car-${style.name}`;

  const wheelZ = style.wheelT.map((t) => -L / 2 + t * L);
  let wheelX = hwm - 0.13;
  const archR = R + 0.09;
  const feat = new Set(style.features ?? []);
  const wheelR = [R, R * (style.rearWheelScale ?? 1)];
  const archRs = wheelR.map((r) => r + 0.09);
  // Rear skirts: no rear wheel well, the body hangs over the top of the wheel.
  const wells = feat.has('rearSkirt') ? [0] : [0, 1];
  const archP = style.archSquare ?? 2;
  const archDist = (dz: number, dy: number) => (archP === 2 ? Math.hypot(dz, dy) : Math.pow(Math.abs(dz) ** archP + Math.abs(dy) ** archP, 1 / archP));

  // Body with wheel wells pushed in.
  const deform = (x: number, y: number, z: number): number => {
    let k = 1;
    for (const wi of wells) {
      const r = archDist(z - wheelZ[wi], y - wheelR[wi]);
      const inWell = 1 - THREE.MathUtils.smoothstep(r, archRs[wi] - 0.05, archRs[wi]);
      k = Math.min(k, 1 - inWell * 0.38);
    }
    // Only the sides are pushed, not the centre of the floor.
    return Math.abs(x) > hwm * 0.45 ? x * k : x;
  };
  const bodyGeo = loft(style.body, { length: L, halfWidth: hwm, exp: style.bodyExp, tumble: style.bodyTumble, along: 120, around: style.around ?? 72, deform, sections: true });
  // Vertex colours: paint everywhere, near-black inside the wheel wells.
  const bp = bodyGeo.getAttribute('position');
  const colors = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    let c = 1;
    if (Math.abs(x) > hwm * 0.45) {
      for (const wi of wells) {
        const r = archDist(z - wheelZ[wi], y - wheelR[wi]);
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
  applyBodyDetail(bodyPaint, [c0 - 0.01, doorF, doorR, c1 < 0.95 ? c1 + 0.015 : 2], L, hwm, tier === 'free' ? 0.18 : 0.3, style.facet ?? 0.22);
  // Hand-modelled body (Blender .glb) when there is one; otherwise the procedural loft body + greenhouse.
  const model = opts.procedural ? null : carModelFor(style.name, opts.lowDetail);
  // A complete model (Blender v2) has empties for its tail lights / exhausts and brings every detail itself.
  const full = !!model?.getObjectByName('tail_L');
  // The model's own wheels (wheel_F / wheel_R, modelled on the right side, axle along X): measured here and used
  // for all four pivots (the game spins and steers them).
  const modelWheels: (THREE.Group | null)[] = [null, null];
  if (model && full) {
    model.updateMatrixWorld(true);
    ['wheel_F', 'wheel_R'].forEach((n, wi) => {
      const node = model.getObjectByName(n);
      if (!node) return;
      // Measure the tyre only (the wheel node may also hold brake / suspension bits that would shift its centre).
      const box = new THREE.Box3();
      node.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (Array.isArray(m.material) ? m.material : [m.material]).some((x) => /tire|tyre/i.test(x.name))) box.expandByObject(m);
      });
      if (box.isEmpty()) box.setFromObject(node);
      const c = box.getCenter(new THREE.Vector3());
      const g = new THREE.Group();
      node.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mesh = new THREE.Mesh(m.geometry.clone().applyMatrix4(m.matrixWorld).translate(-c.x, -c.y, -c.z), m.material);
        g.add(mesh);
      });
      modelWheels[wi] = g;
      wheelZ[wi] = c.z;
      wheelR[wi] = (box.max.y - box.min.y) / 2;
      if (wi === 0) { wheelX = Math.abs(c.x); R = wheelR[0]; }
      node.removeFromParent();
    });
  }
  if (model && !full) {
    const byName: Record<string, THREE.Material> = { paint, glass, trim, chrome, well: soot };
    const greenhouse = new THREE.Group();
    greenhouse.name = 'cabin'; // the space roadster removes it to make a convertible
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => byName[x.name] ?? paint);
      const mesh = new THREE.Mesh(m.geometry, mats.length === 1 ? mats[0] : mats);
      mesh.applyMatrix4(m.matrixWorld);
      (/greenhouse|bpillar|windowline|louvre/.test(m.name) ? greenhouse : car).add(mesh);
    });
    car.add(greenhouse);
  } else if (!model) {
    const body = new THREE.Mesh(bodyGeo, bodyPaint);
    car.add(body);
    const lowPoly = (style.around ?? 40) < 16;
    const cabinGlass = lowPoly ? Object.assign(glass.clone(), { flatShading: true }) : glass;
    const cabin = new THREE.Mesh(loft(style.cabin, { length: L, halfWidth: hwm, exp: style.cabinExp, tumble: style.cabinTumble, along: lowPoly ? 8 : 72, around: lowPoly ? 8 : 64 }), cabinGlass);
    cabin.name = 'cabin';
    car.add(cabin);
  }

  // Wheel-well liners (dark arch lips).
  for (const wi of archP > 2.5 ? [] : wells) {
    for (const side of [-1, 1]) {
      const lip = new THREE.Mesh(new THREE.TorusGeometry(archRs[wi] - 0.02, 0.03, 12, 48, Math.PI).rotateY(Math.PI / 2), trim);
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
      const mw = modelWheels[wi];
      const wheel = mw ? mw.clone() : buildWheel(wheelR[wi], accent, tyre, rimMat, style.rim ?? 'star5');
      if (side < 0) wheel.rotation.y = Math.PI; // outer face outward
      pivot.add(wheel);
      if (mw) {
        // The model's wheel brings its own disc and caliper.
        car.add(pivot);
        wheels.push(pivot);
        continue;
      }
      // Brake caliper behind the spokes (rear-top of the disc): steers with the wheel but must not spin —
      // the game counter-rotates it (pivot.userData.caliper).
      const rr = wheelR[wi] * 0.7;
      // Modelled rims are concave (spokes ~5 cm deep at the hub): keep the caliper behind them.
      const deep = !!rimModelFor(style.rim ?? 'star5');
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(deep ? 0.06 : 0.08, rr * 0.44, rr * 0.66), caliperMat);
      caliper.position.set(side * (deep ? -0.004 : 0.045), rr * 0.5, rr * 0.48);
      caliper.rotation.x = -0.75;
      const calHolder = new THREE.Group();
      calHolder.add(caliper);
      pivot.add(calHolder);
      pivot.userData.caliper = calHolder;
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
  const TAIL_ON = 3.2, TAIL_BRAKE = 16; // brighter bar; braking flares it right up
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
  const haloMat = new THREE.SpriteMaterial({ map: haloTexture(), color: '#ff2a3a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5, fog: false });
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
    haloMat.opacity = 0.5 + 0.5 * k;
    for (const h of halos) h.scale.setScalar(0.7 + 0.9 * k);
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
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 10, 40), chrome);
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
    if (feat.has('vinylRoof')) {
      // Matte vinyl over the roof and C-pillars (a 70s/80s classic): a dark slab on top of the greenhouse.
      const cb = style.cabin;
      const t0 = cb[1][0], t1 = cb[cb.length - 2][0];
      const top = Math.min(cb[1][1], cb[cb.length - 2][1]);
      const vinyl = new THREE.MeshStandardMaterial({ color: '#1c1418', roughness: 0.9, metalness: 0 });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(W * cb[1][3] * 0.86, 0.04, (t1 - t0) * L * 1.02), vinyl);
      roof.position.set(0, top + 0.005, -L / 2 + ((t0 + t1) / 2) * L);
      car.add(roof);
      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.03, top - cb[cb.length - 1][2] - 0.02, 0.32), vinyl);
        pillar.position.set(side * (W / 2) * cb[cb.length - 2][3] * 0.96, (top + cb[cb.length - 1][2]) / 2, -L / 2 + t1 * L - 0.1);
        car.add(pillar);
      }
    }
    if (feat.has('chromeTrim')) {
      // Bright chrome strip along the flanks, just above the sills.
      for (const side of [-1, 1]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 30; i++) {
          const [x, y, z] = bodySurface(style, hwm, 0.06 + (0.88 * i) / 30, -0.35);
          pts.push(new THREE.Vector3(side * (x + 0.008), y, z));
        }
        car.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.014, 5), chrome));
      }
    }
    if (feat.has('louvers')) {
      // Slatted engine cover behind the canopy.
      const t0 = style.cabin[style.cabin.length - 1][0] + 0.02;
      for (let i = 0; i < 7; i++) {
        const t = t0 + (i / 7) * (0.95 - t0);
        const f = st(t);
        const slat = new THREE.Mesh(new THREE.BoxGeometry(W * f.hw * 0.62, 0.035, 0.07), trim);
        slat.position.set(0, f.top + 0.02, -L / 2 + t * L);
        slat.rotation.x = -0.35;
        car.add(slat);
      }
    }
    if (feat.has('tailFins')) {
      const rr = st(1);
      for (const side of [-1, 1]) {
        const finShape = new THREE.Shape();
        finShape.moveTo(0, 0); finShape.lineTo(1.0, 0); finShape.lineTo(1.0, 0.42); finShape.lineTo(0.3, 0.06); finShape.lineTo(0, 0);
        const f = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.03, bevelEnabled: false }).rotateY(-Math.PI / 2), paint);
        f.position.set(side * (hwm * rr.hw * 0.86) + 0.015, rr.top - 0.04, L / 2 - 1.0);
        car.add(f);
      }
    }
    if (feat.has('fenderPods')) {
      // Separate rounded pods over the wheels, standing proud of the narrow central tub.
      const pod = new THREE.BoxGeometry(2, 2, 2);
      for (let wi = 0; wi < 2; wi++) {
        for (const side of [-1, 1]) {
          const m = new THREE.Mesh(pod, paint);
          m.scale.set(0.2, wheelR[wi] * 0.5, archRs[wi] * 1.15);
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

  if (model && full) {
    // Complete model: keep only the game's wheels, contact shadow, underglow and light halos from the
    // procedural build, then add the model with the game's own materials (lamps animate with the brakes).
    const keep = new Set<THREE.Object3D>([...wheels, shadow, under]);
    for (const o of [...car.children]) if (!keep.has(o) && !(o as THREE.Sprite).isSprite) car.remove(o);
    const neonMat = glow(accent, tier === 'elite' ? 5 : tier === 'pro' ? 4 : 3);
    // v5 models (see-through glass panes + a cabin inside): clear tinted glass instead of the dark mirror glass.
    const seeThrough = !!model.getObjectByName('cabin_skin');
    const clearGlass = new THREE.MeshPhysicalMaterial({
      color: '#0d1420', metalness: 0, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.4,
      transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide,
    });
    // Tail lamp lens: red see-through cover over the light pipe (the glow shows through it).
    const lens = new THREE.MeshPhysicalMaterial({ color: '#7a0010', metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0, transparent: true, opacity: 0.55, depthWrite: false, envMapIntensity: 1.8 });
    const stripe = new THREE.MeshPhysicalMaterial({ color: '#eceef2', metalness: 0.1, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03 });
    const byName: Record<string, THREE.Material> = {
      lens, stripe,
      paint, glass: seeThrough ? clearGlass : glass, trim, chrome, well: soot, gap: soot, carbon, rubber: tyre,
      tail: tailMat, brake: cblMat, head: glow('#eaf6ff', 6), amber: glow('#ff9a20', 1.6), neon: neonMat, exhaust: glow('#ff7a20', 1.8),
    };
    const aoMats = new Map<THREE.Material, THREE.Material>();
    const aoVariant = (x: THREE.Material): THREE.Material => {
      if (!(x as THREE.MeshStandardMaterial).isMeshStandardMaterial || x === clearGlass || x === lens) return x;
      let c = aoMats.get(x);
      if (!c) {
        const cm = (x as THREE.MeshStandardMaterial).clone();
        cm.vertexColors = true;
        enhanceCarMaterial(cm, x === paint);
        aoMats.set(x, cm);
        c = cm;
      }
      return c;
    };
    // Bought models: k_* materials stay as authored (interior, underbody, plates...); the paint keeps its panel
    // normal map; the lamp atlas glows (head) or follows the brakes (tail).
    let modelPaint: THREE.Material | null = null;
    let modelHead: THREE.Material | null = null;
    const pick = (x: THREE.Material): THREE.Material => {
      const n = x.name.replace(/\.\d+$/, '');
      if (n.startsWith('k_')) return x;
      const src = x as THREE.MeshPhysicalMaterial;
      if (n === 'paint' && (src.normalMap || src.clearcoatNormalMap)) {
        if (!modelPaint) {
          const pm = paint.clone();
          pm.normalMap = src.normalMap ?? src.clearcoatNormalMap;
          pm.clearcoatNormalMap = src.clearcoatNormalMap ?? null;
          if (src.normalScale) pm.normalScale.copy(src.normalScale);
          // Game-ready bodies have few triangles: a mirror finish showed every facet as a wobble in the
          // reflections. A softer, less metallic paint (closer to the pack's own look) keeps the shine but not the waves.
          pm.metalness *= 0.5;
          pm.roughness = Math.max(0.34, pm.roughness * 1.4);
          pm.clearcoatRoughness = Math.max(0.12, pm.clearcoatRoughness * 1.8);
          pm.envMapIntensity = 1.0;
          modelPaint = pm;
        }
        return modelPaint;
      }
      if (n === 'head' && src.map) return (modelHead ??= new THREE.MeshBasicMaterial({ map: src.map, color: new THREE.Color('#ffffff').multiplyScalar(2.4), fog: false }));
      if (n === 'tail' && src.map && !tailMat.map) { tailMat.map = src.map; tailMat.needsUpdate = true; }
      return byName[n] ?? paint;
    };
    model.updateMatrixWorld(true);
    const empties: Record<string, THREE.Vector3> = {};
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (/^(tail|exhaust|head)_[LR]/.test(o.name)) empties[o.name.slice(0, o.name.indexOf('_') + 2)] = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      if (!m.isMesh) return;
      let mats = (Array.isArray(m.material) ? m.material : [m.material]).map(pick);
      // Baked ambient occlusion (vertex colours): every model mesh gets a colour attribute (white where none was baked)
      // and AO-aware copies of the lit materials (the procedural parts keep the plain ones).
      const geo = m.geometry;
      if (seeThrough) {
        if (!geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
        mats = mats.map((x) => aoVariant(x));
      }
      const mesh = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
      mesh.applyMatrix4(m.matrixWorld);
      if (mats.includes(clearGlass) || mats.includes(lens)) mesh.renderOrder = 2; // see-through parts after what is behind them
      car.add(mesh);
    });
    // Effects anchor on the model's own lamps / pipes.
    if (empties.tail_L && empties.tail_R) {
      tailLights.length = 0;
      tailLights.push(empties.tail_L, empties.tail_R);
      halos.forEach((h, i) => h.position.copy(tailLights[i]).add(new THREE.Vector3(0, 0, 0.06)));
    }
    if (empties.exhaust_L && empties.exhaust_R) {
      exhausts.length = 0;
      exhausts.push(empties.exhaust_L, empties.exhaust_R);
    }
    // Underglow between the axles only: the model cars stand taller, and a full-length bar showed under the sills.
    if (modelWheels[0]) {
      under.geometry.dispose();
      under.geometry = new THREE.BoxGeometry(W * 0.5, 0.02, Math.abs(wheelZ[1] - wheelZ[0]) * 0.75);
      under.position.set(0, 0.12, (wheelZ[0] + wheelZ[1]) / 2);
    }
    // Imposing headlights: a bright soft glow on each lamp plus a faint horizontal streak (anamorphic flare).
    if (empties.head_L && empties.head_R) {
      // Their light on the road ahead: two soft cones from the bumper.
      const front = Math.min(empties.head_L.z, empties.head_R.z);
      const beamLen = 16;
      const beam = new THREE.Mesh(
        new THREE.PlaneGeometry(W * 2.4, beamLen).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: beamTexture(), color: '#fff3dc', transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      );
      beam.name = 'beam';
      beam.position.set(0, 0.03, front - beamLen / 2 + 0.2);
      beam.renderOrder = 3;
      car.add(beam);
      const glowMat = new THREE.SpriteMaterial({ map: haloTexture(), color: '#dfeeff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85, fog: false });
      const streakMat = new THREE.SpriteMaterial({ map: haloTexture(), color: '#9fd4ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.45, fog: false });
      for (const p of [empties.head_L, empties.head_R]) {
        const g = new THREE.Sprite(glowMat);
        g.position.copy(p);
        g.scale.setScalar(0.42);
        const st = new THREE.Sprite(streakMat);
        st.position.copy(p).add(new THREE.Vector3(0, 0, 0.02));
        st.scale.set(2.6, 0.07, 1);
        car.add(g, st);
      }
    }
  }

  mergeStaticParts(car);
  car.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = false;
  });
  // Glow sprites live on layer 1: drawn by the main and mirror cameras, skipped by the road reflection.
  car.traverse((o) => { if ((o as THREE.Sprite).isSprite || o.name === 'beam') o.layers.set(1); });
  return { group: car, wheels, style: R === style.wheelRadius ? style : { ...style, wheelRadius: R }, setBrake, exhausts, tailLights };
}
