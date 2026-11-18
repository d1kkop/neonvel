import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyAtmosphere, atmosphere } from '../../render/atmosphere';

/**
 * People on the Palm Coast beach:
 *  - beach volleyball: two-a-side games on a sand court with a net; the rally never ends (dig, set, jump and
 *    spike, over the net, dig, set, spike …), players run to the ball and face it;
 *  - dancers around the beach bars, bouncing to the music's beat, some with a drink in hand;
 *  - sunbathers on loungers (on their back with a knee up, on their front, or sitting up), and cocktail tables.
 * Figures are original, built from simple rounded shapes: athletic men in swim shorts (broad chest, defined
 * abs and arms) and women in bikinis. Animated figures are a small skeleton of rigid parts; sunbathers are
 * posed once and merged into a few instanced meshes.
 */

export interface Look {
  female: boolean;
  skin: string;
  suit: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'pony' | 'bun';
  shades?: boolean;
}

// Paler and less saturated than real skin: the level's low red sun and warm haze add the tan.
const SKINS = ['#f2ceac', '#e2b692', '#f6dcc0', '#c8946c', '#ecc09c', '#a8785a'];
const SUITS = ['#ff2bd6', '#00c8d8', '#ffd23f', '#ff5a3c', '#3dff9e', '#a64dff', '#ffffff', '#ff8a20', '#1f6fe0', '#e02a4a'];
const HAIRS = ['#2a1a10', '#5a3418', '#e8c060', '#1a1214', '#b05a28', '#f0e0b0'];

/** A look picked from an index (same index = same person). */
export function lookFor(i: number, female: boolean): Look {
  const styles: Look['hairStyle'][] = female ? ['long', 'pony', 'bun', 'long'] : ['short', 'short', 'short', 'bun'];
  return {
    female,
    skin: SKINS[(i * 5 + (female ? 2 : 0)) % SKINS.length],
    suit: SUITS[(i * 3 + (female ? 0 : 5)) % SUITS.length],
    hair: HAIRS[(i * 7 + 1) % HAIRS.length],
    hairStyle: styles[i % styles.length],
    shades: i % 3 === 1,
  };
}

// ------------------------------------------------------------------ building a figure

type Paint = [THREE.BufferGeometry, string][];

/** Merge painted shapes into one vertex-coloured geometry. */
function merged(parts: Paint): THREE.BufferGeometry {
  const list = parts.map(([g0, color]) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    return g;
  });
  return mergeGeometries(list)!;
}

interface Detail { cap: number; radial: number; sw: number; sh: number }
const HI: Detail = { cap: 4, radial: 12, sw: 14, sh: 10 };
const LO: Detail = { cap: 2, radial: 8, sw: 9, sh: 6 };

const BONES = ['hips', 'torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'thighL', 'thighR', 'shinL', 'shinR'] as const;
type Bone = (typeof BONES)[number];

/** Shapes of every body part, each in its own joint's frame (the joint is at the origin, the limb hangs down -Y). */
function bodyParts(look: Look, d: Detail): Record<Bone, Paint> {
  const f = look.female;
  const skin = look.skin, suit = look.suit, hair = look.hair;
  const ball = (rx: number, ry: number, rz: number, x: number, y: number, z: number) => new THREE.SphereGeometry(1, d.sw, d.sh).scale(rx, ry, rz).translate(x, y, z);
  /** Capsule from y0 down/up to y1 (ends included), radius r, optionally squashed front to back. */
  const cap = (r: number, y0: number, y1: number, x = 0, z = 0, flat = 1) =>
    new THREE.CapsuleGeometry(r, Math.max(0.001, Math.abs(y1 - y0) - 2 * r), d.cap, d.radial).scale(1, 1, flat).translate(x, (y0 + y1) / 2, z);

  const hips: Paint = [];
  if (f) {
    hips.push([ball(0.172, 0.118, 0.122, 0, 0, 0), skin]);
    hips.push([ball(0.176, 0.07, 0.127, 0, -0.012, 0), suit]);                         // bikini bottom
  } else {
    hips.push([ball(0.168, 0.125, 0.12, 0, 0, 0), suit]);                              // shorts
  }

  const torso: Paint = [];
  if (f) {
    torso.push([ball(0.118, 0.17, 0.088, 0, 0.12, 0), skin]);                          // slim waist
    torso.push([ball(0.15, 0.15, 0.104, 0, 0.35, 0), skin]);                           // ribcage
    for (const sx of [-1, 1]) torso.push([ball(0.066, 0.062, 0.058, sx * 0.07, 0.37, 0.072), suit]); // bikini top
    torso.push([new THREE.CylinderGeometry(0.153, 0.153, 0.03, d.radial * 2, 1, true).scale(1, 1, 0.7).translate(0, 0.345, 0), suit]);
    for (const sx of [-1, 1]) torso.push([ball(0.05, 0.05, 0.05, sx * 0.168, 0.455, 0), skin]);
    torso.push([cap(0.037, 0.47, 0.62), skin]);
  } else {
    torso.push([ball(0.146, 0.18, 0.1, 0, 0.12, 0), skin]);                            // waist
    torso.push([ball(0.2, 0.17, 0.128, 0, 0.35, 0), skin]);                            // broad chest and back
    for (const sx of [-1, 1]) {
      torso.push([ball(0.088, 0.062, 0.05, sx * 0.088, 0.395, 0.088), skin]);          // chest muscles
      torso.push([ball(0.07, 0.068, 0.07, sx * 0.218, 0.455, 0), skin]);               // shoulders
      for (let r = 0; r < 3; r++) torso.push([ball(0.04, 0.033, 0.024, sx * 0.043, 0.25 - r * 0.07, 0.09 - r * 0.004), skin]); // abs
      torso.push([ball(0.06, 0.1, 0.05, sx * 0.165, 0.27, -0.03), skin]);              // lats: the V shape
    }
    torso.push([ball(0.13, 0.05, 0.065, 0, 0.51, -0.01), skin]);                       // traps
    torso.push([cap(0.05, 0.47, 0.62), skin]);
  }

  const head: Paint = [];
  head.push([ball(0.092, 0.115, 0.1, 0, 0.105, 0), skin]);
  head.push([ball(0.099, 0.1, 0.108, 0, 0.14, -0.02), hair]);
  head.push([ball(0.016, 0.022, 0.02, 0, 0.09, 0.098), skin]);                         // nose
  if (look.shades) {
    for (const sx of [-1, 1]) head.push([ball(0.04, 0.03, 0.014, sx * 0.042, 0.122, 0.092), '#08080c']); // lenses
    head.push([new THREE.BoxGeometry(0.185, 0.012, 0.02).translate(0, 0.134, 0.086), '#08080c']);            // brow bar
    for (const sx of [-1, 1]) head.push([new THREE.BoxGeometry(0.01, 0.012, 0.1).translate(sx * 0.094, 0.13, 0.04), '#08080c']); // arms
  }
  else for (const sx of [-1, 1]) head.push([ball(0.013, 0.013, 0.01, sx * 0.034, 0.118, 0.092), '#1a1210']);
  if (look.hairStyle === 'long') head.push([ball(0.1, 0.2, 0.06, 0, 0.0, -0.075), hair]);
  if (look.hairStyle === 'pony') {
    head.push([ball(0.04, 0.04, 0.04, 0, 0.17, -0.115), hair]);
    head.push([new THREE.CapsuleGeometry(0.03, 0.2, d.cap, d.radial).rotateX(0.35).translate(0, 0.06, -0.16), hair]);
  }
  if (look.hairStyle === 'bun') head.push([ball(0.05, 0.05, 0.05, 0, 0.21, -0.07), hair]);

  const upperArm = (): Paint => (f
    ? [[cap(0.037, 0.02, -0.3), skin]]
    : [[cap(0.05, 0.03, -0.3), skin], [ball(0.058, 0.1, 0.06, 0, -0.12, 0.008), skin]]);  // biceps / triceps
  const forearm = (): Paint => [
    [cap(f ? 0.031 : 0.043, 0.02, -0.26), skin],
    [ball(0.036, 0.055, 0.024, 0, -0.3, 0), skin],                                     // hand
  ];
  const thigh = (): Paint => {
    const p: Paint = [[cap(f ? 0.076 : 0.08, 0.05, -0.47), skin]];
    if (!f) p.push([new THREE.CylinderGeometry(0.086, 0.094, 0.24, d.radial, 1, true).translate(0, -0.1, 0), suit]); // shorts leg
    return p;
  };
  const shin = (): Paint => [
    [cap(f ? 0.047 : 0.055, 0.04, -0.42), skin],
    [ball(f ? 0.05 : 0.06, 0.1, 0.055, 0, -0.14, -0.012), skin],                       // calf
    [ball(0.044, 0.034, 0.105, 0, -0.425, 0.055), skin],                               // foot
  ];
  return { hips, torso, head, armL: upperArm(), armR: upperArm(), foreL: forearm(), foreR: forearm(), thighL: thigh(), thighR: thigh(), shinL: shin(), shinR: shin() };
}

/** Joint angles (radians). Arms / legs: x = swing forward (negative) or back (positive), z = out to the side. */
export interface Pose {
  y: number;          // hips up / down from standing (m)
  lean: number;       // whole body pitch forward (+)
  torso: number;      // torso pitch forward (+) on top of that
  twist: number;      // torso yaw
  head: number;       // head pitch (+ = down)
  armL: [number, number]; armR: [number, number];
  foreL: number; foreR: number;
  thighL: [number, number]; thighR: [number, number];
  shinL: number; shinR: number;
}

const pose = (p: Partial<Pose>): Pose => ({ y: 0, lean: 0, torso: 0, twist: 0, head: 0, armL: [0, 0.12], armR: [0, 0.12], foreL: -0.15, foreR: -0.15, thighL: [0, 0.04], thighR: [0, 0.04], shinL: 0, shinR: 0, ...p });

function mixPose(a: Pose, b: Pose, w: number, out: Pose): Pose {
  const l = (x: number, y: number) => x + (y - x) * w;
  out.y = l(a.y, b.y); out.lean = l(a.lean, b.lean); out.torso = l(a.torso, b.torso); out.twist = l(a.twist, b.twist); out.head = l(a.head, b.head);
  out.foreL = l(a.foreL, b.foreL); out.foreR = l(a.foreR, b.foreR); out.shinL = l(a.shinL, b.shinL); out.shinR = l(a.shinR, b.shinR);
  for (const k of ['armL', 'armR', 'thighL', 'thighR'] as const) { out[k][0] = l(a[k][0], b[k][0]); out[k][1] = l(a[k][1], b[k][1]); }
  return out;
}

/** An articulated person, 1.8 m (men) / 1.68 m (women) tall, standing on y = 0 and facing +Z. */
export class Figure {
  readonly root = new THREE.Group();
  readonly bones = {} as Record<Bone, THREE.Mesh>;
  readonly female: boolean;

  constructor(look: Look, mat: THREE.Material, detail: Detail = HI) {
    this.female = look.female;
    const parts = bodyParts(look, detail);
    for (const b of BONES) this.bones[b] = new THREE.Mesh(merged(parts[b]), mat);
    const B = this.bones, f = look.female;
    const sx = f ? 0.178 : 0.228;
    B.hips.position.set(0, 0.94, 0);
    B.torso.position.set(0, 0.06, 0);
    B.head.position.set(0, 0.6, 0);
    B.armL.position.set(sx, 0.46, 0); B.armR.position.set(-sx, 0.46, 0);
    B.foreL.position.set(0, -0.3, 0); B.foreR.position.set(0, -0.3, 0);
    B.thighL.position.set(0.09, -0.03, 0); B.thighR.position.set(-0.09, -0.03, 0);
    B.shinL.position.set(0, -0.46, 0); B.shinR.position.set(0, -0.46, 0);
    this.root.add(B.hips);
    B.hips.add(B.torso, B.thighL, B.thighR);
    B.torso.add(B.head, B.armL, B.armR);
    B.armL.add(B.foreL); B.armR.add(B.foreR);
    B.thighL.add(B.shinL); B.thighR.add(B.shinR);
    this.root.scale.setScalar(f ? 0.935 : 1);
  }

  apply(p: Pose): void {
    const B = this.bones;
    B.hips.position.y = 0.94 + p.y;
    B.hips.rotation.x = p.lean;
    B.torso.rotation.set(p.torso, p.twist, 0);
    B.head.rotation.x = p.head - p.torso * 0.6 - p.lean * 0.6; // the head stays level-ish, eyes on the ball
    B.armL.rotation.set(p.armL[0], 0, p.armL[1]); B.armR.rotation.set(p.armR[0], 0, -p.armR[1]);
    B.foreL.rotation.x = p.foreL; B.foreR.rotation.x = p.foreR;
    // The legs stay under the body when it leans.
    B.thighL.rotation.set(p.thighL[0] - p.lean, 0, p.thighL[1]); B.thighR.rotation.set(p.thighR[0] - p.lean, 0, -p.thighR[1]);
    B.shinL.rotation.x = p.shinL; B.shinR.rotation.x = p.shinR;
  }

  /** Put something in the left hand (it moves with the forearm). */
  hold(obj: THREE.Object3D): void {
    obj.position.set(0, -0.33, 0.03);
    this.bones.foreL.add(obj);
  }
}

function figureMaterial(): THREE.MeshStandardMaterial {
  return applyAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }));
}

/** A posed figure baked into one geometry (for instancing), in the frame of `frame` (default: its own root). */
function bakeFigure(look: Look, p: Pose, place: (root: THREE.Group) => void): THREE.BufferGeometry {
  const fig = new Figure(look, new THREE.MeshBasicMaterial(), LO);
  fig.apply(p);
  place(fig.root);
  fig.root.updateMatrixWorld(true);
  const geos = BONES.map((b) => fig.bones[b].geometry.clone().applyMatrix4(fig.bones[b].matrixWorld));
  const g = mergeGeometries(geos)!;
  for (const b of BONES) fig.bones[b].geometry.dispose();
  return g;
}

// ------------------------------------------------------------------ poses

const STAND = pose({});
const READY = pose({ y: -0.13, lean: 0.32, torso: 0.1, armL: [-0.75, 0.2], armR: [-0.75, 0.2], foreL: -0.7, foreR: -0.7, thighL: [-0.75, 0.16], thighR: [-0.75, 0.16], shinL: 1.05, shinR: 1.05 });
/** Dig: low, arms locked straight out in front, hands together. */
const DIG = pose({ y: -0.26, lean: 0.42, torso: 0.15, armL: [-1.25, -0.32], armR: [-1.25, -0.32], foreL: -0.05, foreR: -0.05, thighL: [-1.05, 0.22], thighR: [-0.85, 0.22], shinL: 1.45, shinR: 1.3, head: 0.15 });
/** Set: under the ball, both hands above the forehead. */
const SET = pose({ y: -0.04, lean: -0.05, torso: -0.12, armL: [-2.75, 0.22], armR: [-2.75, 0.22], foreL: -0.95, foreR: -0.95, thighL: [-0.25, 0.1], thighR: [-0.25, 0.1], shinL: 0.4, shinR: 0.4, head: -0.5 });
/** Spike, wound up: hitting arm (right) cocked back overhead, left arm reaching up at the ball, legs trailing. */
const SPIKE_UP = pose({ lean: -0.18, torso: -0.2, twist: -0.35, armL: [-2.5, 0.25], armR: [-3.5, 0.5], foreL: -0.2, foreR: -1.4, thighL: [0.25, 0.06], thighR: [0.1, 0.06], shinL: 0.95, shinR: 0.7, head: -0.35 });
/** Spike, follow-through: arm snapped down through the ball, body folding forward. */
const SPIKE_HIT = pose({ lean: 0.2, torso: 0.3, twist: 0.3, armL: [-0.6, 0.3], armR: [-1.35, 0.1], foreL: -0.6, foreR: -0.15, thighL: [-0.35, 0.06], thighR: [-0.2, 0.06], shinL: 0.6, shinR: 0.5, head: 0.1 });

// ------------------------------------------------------------------ volleyball

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Touch times within one rally cycle (s): side A digs, sets, spikes; then side B. */
const TOUCH_T = [0, 1.1, 2.3, 3.2, 4.3, 5.5];
const CYCLE = 6.4;
/** Ball arc height above the straight line between two touches, per touch it leaves from. */
const ARC = [2.3, 1.2, 0.5, 2.3, 1.2, 0.5];

interface Player { fig: Figure; team: number; slot: number; x: number; z: number; yaw: number; run: number; pose: Pose }

function netTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 64);
  g.strokeStyle = 'rgba(20,20,24,0.95)';
  g.lineWidth = 1.5;
  for (let x = 0; x <= 512; x += 8) { g.beginPath(); g.moveTo(x, 6); g.lineTo(x, 58); g.stroke(); }
  for (let y = 8; y <= 56; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 7);
  g.fillRect(0, 57, 512, 7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  const cols = ['#ffd21f', '#1f6fe0', '#ffffff'];
  for (let i = 0; i < 6; i++) { g.fillStyle = cols[i % 3]; g.fillRect((i * 128) / 6, 0, 128 / 6 + 1, 64); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A beach volleyball game. Court frame: x along the court (net at x = 0, 8 m to each end), z across (±4 m),
 * y up from the sand. The group is placed by the level; `scale` makes the whole scene larger than life so it
 * reads from the road.
 */
export class VolleyballCourt {
  readonly group = new THREE.Group();
  private readonly players: Player[] = [];
  private readonly ball: THREE.Mesh;
  private readonly bp = new THREE.Vector3();
  private readonly tp = new THREE.Vector3();
  private readonly tmpB = pose({});
  private readonly phase: number;

  /**
   * @param sandMaterial the beach's own ground material (CoastTerrain), so the level pad the court stands on
   *                     looks like the sand around it; without it a plain sand colour is used.
   */
  constructor(seed: number, sandMaterial?: THREE.Material) {
    this.group.name = 'volleyball';
    this.phase = hash(seed) * CYCLE;
    const g = this.group;
    // Level pad of sand (the beach slopes; the court does not), boundary tapes, posts, net.
    const padGeo = new THREE.BoxGeometry(18.5, 2, 10.4).translate(0, -1, 0);
    // The terrain material tells beach from grass by this attribute (0 = beach).
    padGeo.setAttribute('aLand', new THREE.BufferAttribute(new Float32Array(padGeo.getAttribute('position').count), 1));
    g.add(new THREE.Mesh(padGeo, sandMaterial ?? applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#ecd6a2', roughness: 1 }))));
    const tape = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#2a6ad8', roughness: 0.7 }));
    const lines: THREE.BufferGeometry[] = [];
    for (const z of [-4, 4]) lines.push(new THREE.BoxGeometry(16.1, 0.02, 0.07).translate(0, 0.012, z).toNonIndexed());
    for (const x of [-8, 8]) lines.push(new THREE.BoxGeometry(0.07, 0.02, 8.1).translate(x, 0.012, 0).toNonIndexed());
    g.add(new THREE.Mesh(mergeGeometries(lines), tape));
    const postMat = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.5, metalness: 0.3 }));
    const posts: THREE.BufferGeometry[] = [];
    for (const z of [-4.7, 4.7]) {
      posts.push(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 12).translate(0, 1.3, z).toNonIndexed());
      posts.push(new THREE.CylinderGeometry(0.11, 0.11, 1.5, 12).translate(0, 0.75, z).toNonIndexed()); // padding
    }
    g.add(new THREE.Mesh(mergeGeometries(posts), postMat));
    const net = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 1).rotateY(Math.PI / 2).translate(0, 1.93, 0),
      applyAtmosphere(new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide })));
    g.add(net);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), applyAtmosphere(new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.5 })));
    g.add(this.ball);
    // Two a side: a man and a woman in each team; slot 0 digs and spikes this rally, slot 1 sets (they swap each rally).
    const mat = figureMaterial();
    for (let team = 0; team < 2; team++) for (let slot = 0; slot < 2; slot++) {
      const fig = new Figure({ ...lookFor(seed * 4 + team * 2 + slot, (team + slot) % 2 === 0), shades: true }, mat);
      g.add(fig.root);
      const sign = team ? 1 : -1;
      this.players.push({ fig, team, slot, x: sign * (slot ? 2.6 : 5), z: slot ? 1.6 : -1.6, yaw: 0, run: 0, pose: pose({}) });
    }
  }

  /** Where touch k of rally cycle c happens (court frame) and who plays it. */
  private touch(c: number, k: number, out: THREE.Vector3): { team: number; slot: number } {
    const team = k < 3 ? 0 : 1, kind = k % 3;
    const sign = team ? 1 : -1;
    const h = (j: number) => hash(c * 13.7 + k * 3.1 + j);
    if (kind === 0) out.set(sign * (5.2 + h(1) * 1.4), 0.78, (h(2) - 0.5) * 5.2);
    else if (kind === 1) out.set(sign * 1.9, 2.2, (h(1) - 0.5) * 3.4);
    else out.set(sign * 0.85, 2.85, (hash(c * 13.7 + (k - 1) * 3.1 + 1) - 0.5) * 3.4 + (h(2) - 0.5) * 1.6);
    // The digger also spikes; the roles swap from rally to rally.
    const slot = kind === 1 ? 1 : 0;
    return { team, slot: (slot + c) % 2 };
  }

  update(time: number, dt: number): void {
    const t = time + this.phase;
    const c = Math.floor(t / CYCLE), u = t - c * CYCLE;
    // Ball: on the arc between the last touch and the next one.
    let k = 5;
    while (k > 0 && TOUCH_T[k] > u) k--;
    const t0 = TOUCH_T[k], t1 = k < 5 ? TOUCH_T[k + 1] : CYCLE;
    const f = (u - t0) / (t1 - t0);
    this.touch(c, k, this.bp);
    this.touch(k < 5 ? c : c + 1, (k + 1) % 6, this.tp);
    this.bp.lerp(this.tp, f);
    this.bp.y += 4 * ARC[k] * f * (1 - f);
    this.ball.position.copy(this.bp);
    this.ball.rotation.x += dt * 9;
    this.ball.rotation.z += dt * 4;

    for (const p of this.players) {
      // This player's nearest touches: the one just played and the one coming up.
      let nextIn = Infinity, sinceLast = Infinity, nextKind = 0, lastKind = 0, nextX = 0, nextZ = 0;
      for (let cc = c - 1; cc <= c + 1; cc++) for (let kk = 0; kk < 6; kk++) {
        const who = this.touch(cc, kk, this.tp);
        if (who.team !== p.team || who.slot !== p.slot) continue;
        const dtT = (cc - c) * CYCLE + TOUCH_T[kk] - u;
        if (dtT >= 0 && dtT < nextIn) { nextIn = dtT; nextKind = kk % 3; nextX = this.tp.x; nextZ = this.tp.z; }
        if (dtT < 0 && -dtT < sinceLast) { sinceLast = -dtT; lastKind = kk % 3; }
      }
      const sign = p.team ? 1 : -1;
      // Where to stand: at the coming touch when it is near (a step back from the ball, away from the net),
      // otherwise back at the base position.
      let tx = sign * (p.slot ? 2.6 : 5), tz = p.slot ? 1.6 : -1.6;
      if (nextIn < 1.7) {
        const back = nextKind === 0 ? 0.5 : nextKind === 1 ? 0.3 : 0.55;
        tx = nextX + sign * back;
        tz = nextZ;
      }
      const dx = tx - p.x, dz = tz - p.z;
      const dist = Math.hypot(dx, dz);
      const step = Math.min(dist, Math.min(6.5, dist * 5 + 0.6) * dt);
      if (dist > 1e-4) { p.x += (dx / dist) * step; p.z += (dz / dist) * step; }
      p.run += (Math.min(1, (step / Math.max(dt, 1e-4)) / 4) - p.run) * Math.min(1, dt * 10);
      // Body: ready stance, blended into the action around the moment of the touch.
      const bell = (x: number, w: number) => Math.max(0, 1 - Math.abs(x) / w);
      let w = 0, kind = 0, rel = 0;
      if (nextIn < 0.45) { w = bell(nextIn, 0.45); kind = nextKind; rel = -nextIn; }
      if (sinceLast < 0.35 && bell(sinceLast, 0.35) > w) { w = bell(sinceLast, 0.35); kind = lastKind; rel = sinceLast; }
      let jump = 0;
      const P = p.pose;
      if (kind === 2 && w > 0) {
        // Jump: off the ground from 0.35 s before the hit to 0.35 s after; the arm snaps through at the hit.
        const j = (rel + 0.02) / 0.36;
        jump = Math.max(0, 1 - j * j) * 0.78;
        mixPose(SPIKE_UP, SPIKE_HIT, THREE.MathUtils.smoothstep(rel, -0.06, 0.1), this.tmpB);
        mixPose(READY, this.tmpB, Math.min(1, w * 1.8), P);
      } else {
        mixPose(READY, kind === 0 ? DIG : SET, w * w * (3 - 2 * w), P);
        if (kind === 1 && w > 0) jump = bell(rel, 0.25) * 0.12; // a little hop into the set
      }
      // Running: legs and arms swing with the step rate.
      if (p.run > 0.05) {
        const s = Math.sin(time * 13 + p.slot * 2 + p.team), r = p.run * (1 - w);
        P.thighL[0] += s * 0.7 * r; P.thighR[0] -= s * 0.7 * r;
        P.shinL += Math.max(0, -s) * 0.9 * r; P.shinR += Math.max(0, s) * 0.9 * r;
        P.armL[0] -= s * 0.5 * r; P.armR[0] += s * 0.5 * r;
      }
      // Idle: a light bounce on the toes.
      P.y += Math.sin(time * 5.5 + p.slot * 1.7 + p.team * 0.9) * 0.012 * (1 - w);
      p.fig.apply(P);
      // Face the ball.
      const want = Math.atan2(this.bp.x - p.x, this.bp.z - p.z);
      let dy = want - p.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.yaw += dy * Math.min(1, dt * 9);
      p.fig.root.position.set(p.x, jump, p.z);
      p.fig.root.rotation.y = p.yaw;
    }
  }
}

// ------------------------------------------------------------------ dancers

/** People dancing near a bar: they bounce on the music's beat, sway and wave their arms; some hold a drink. */
export class Dancers {
  readonly group = new THREE.Group();
  private readonly list: { fig: Figure; ph: number; style: number; x: number; z: number; yaw: number }[] = [];
  private readonly p = pose({});

  /** `spots`: where each dancer stands (x, z in the group's frame, y = ground height there). */
  constructor(spots: { x: number; y: number; z: number }[], seed: number, scale = 1) {
    this.group.name = 'dancers';
    const mat = figureMaterial();
    const cupMat = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#ff5a8a', roughness: 0.3, emissive: '#ff2a6a', emissiveIntensity: 0.6 }));
    spots.forEach((s, i) => {
      const fig = new Figure({ ...lookFor(seed * 9 + i * 2 + 1, i % 2 === 0), shades: true }, mat);
      fig.root.scale.multiplyScalar(scale);
      fig.root.position.set(s.x, s.y, s.z);
      const yaw = hash(seed + i * 3.3) * Math.PI * 2;
      fig.root.rotation.y = yaw;
      if (i % 3 === 0) fig.hold(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.11, 10), cupMat));
      this.group.add(fig.root);
      this.list.push({ fig, ph: hash(seed * 1.7 + i) * 6.283, style: i % 3, x: s.x, z: s.z, yaw });
    });
  }

  update(time: number): void {
    const beat = atmosphere.uBeatPulse.value; // 1 on the beat, decaying
    for (const d of this.list) {
      const t = time * 2.1 + d.ph;              // about one sway per bar at dance tempo
      const s = Math.sin(t), c = Math.cos(t);
      const P = this.p;
      mixPose(STAND, STAND, 0, P);
      P.y = -0.05 - 0.06 * beat - 0.02 * Math.abs(s);
      P.lean = 0.05;
      P.twist = 0.3 * s;
      P.head = -0.1 + 0.08 * c;
      P.thighL = [-0.25 - 0.2 * Math.max(0, s), 0.1]; P.thighR = [-0.25 - 0.2 * Math.max(0, -s), 0.1];
      P.shinL = 0.45 + 0.35 * Math.max(0, s); P.shinR = 0.45 + 0.35 * Math.max(0, -s);
      if (d.style === 0) {
        // Drink in the left hand held up, the right arm pumping.
        P.armL = [-1.2, 0.35]; P.foreL = -1.3;
        P.armR = [-2.3 + 0.5 * c, 0.3]; P.foreR = -0.6 - 0.4 * beat;
      } else if (d.style === 1) {
        // Both hands in the air, waving side to side.
        P.armL = [-2.7, 0.35 + 0.3 * s]; P.armR = [-2.7, 0.35 - 0.3 * s]; P.foreL = -0.35 - 0.3 * beat; P.foreR = -0.35 - 0.3 * beat;
      } else {
        // Elbows out, shoulders rolling.
        P.armL = [-0.7 + 0.5 * s, 0.7]; P.armR = [-0.7 - 0.5 * s, 0.7]; P.foreL = -1.5; P.foreR = -1.5;
      }
      d.fig.apply(P);
      d.fig.root.rotation.y = d.yaw + 0.25 * Math.sin(t * 0.5);
      d.fig.root.rotation.z = 0.06 * s;
      d.fig.root.position.x = d.x + 0.12 * s;
    }
  }
}

// ------------------------------------------------------------------ loungers, sunbathers, tables

export interface Lounger { x: number; y: number; z: number; yaw: number; color: THREE.Color; person: number }

// Lying on the back: the torso is bent up by the back rest's angle (0.42 rad), one knee up, a hand behind the head.
const LYING_BACK = pose({ torso: 0.42, head: 0.2, armL: [0.1, 0.25], armR: [-2.7, 0.5], foreL: -0.2, foreR: -1.9, thighL: [-0.75, 0.08], thighR: [0, 0.1], shinL: 1.5, shinR: 0.05 });
const LYING_BACK2 = pose({ torso: 0.42, head: 0.15, armL: [-2.6, 0.6], armR: [-2.6, 0.6], foreL: -2.0, foreR: -2.0, thighL: [0, 0.12], thighR: [-0.5, 0.1], shinL: 0.05, shinR: 1.0 });
// On the front: the back arched up the rest, chin on the folded arms, one foot in the air.
const LYING_FRONT = pose({ torso: -0.42, head: -0.45, armL: [-2.4, 0.8], armR: [-2.4, 0.8], foreL: -2.2, foreR: -2.2, thighL: [0.05, 0.1], thighR: [0.05, 0.14], shinL: 0.1, shinR: 1.1 });
// Sitting up on the seat: legs out along it, one knee pulled up, leaning back on the hands.
const SITTING = pose({ torso: -0.1, head: 0.05, armL: [0.7, 0.25], armR: [0.7, 0.25], foreL: 0.1, foreR: 0.1, thighL: [-1.5, 0.08], thighR: [-1.15, 0.1], shinL: 0.1, shinR: 1.2 });

/**
 * Sun loungers (frame + coloured cushion) and the people on them. `person`: -1 = empty, otherwise picks one of
 * the sunbather variants. A lounger's head end points along its local -Z.
 */
export function createLoungers(list: Lounger[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'loungers';
  if (!list.length) return g;
  // Frame: two rails, slatted seat, raised back rest (hinged 0.3 m behind the middle), four legs.
  const frame: THREE.BufferGeometry[] = [];
  const b = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z).toNonIndexed();
  for (const sx of [-0.33, 0.33]) frame.push(b(0.05, 0.06, 1.3, sx, 0.3, 0.35));
  for (let i = 0; i < 9; i++) frame.push(b(0.66, 0.025, 0.11, 0, 0.335, -0.22 + i * 0.145));
  const tilt = 0.42, backLen = 0.78;
  for (const sx of [-0.33, 0.33]) frame.push(b(0.05, 0.06, backLen, sx, 0.3 + Math.sin(tilt) * backLen / 2, -0.3 - Math.cos(tilt) * backLen / 2, tilt));
  for (let i = 0; i < 5; i++) {
    const t = 0.08 + i * 0.15;
    frame.push(b(0.66, 0.025, 0.11, 0, 0.335 + Math.sin(tilt) * t, -0.3 - Math.cos(tilt) * t, tilt));
  }
  for (const sx of [-0.3, 0.3]) for (const sz of [-0.2, 0.9]) frame.push(b(0.05, 0.3, 0.05, sx, 0.15, sz));
  for (const sx of [-0.3, 0.3]) frame.push(b(0.04, 0.4, 0.04, sx, 0.33, -0.8, -0.5)); // back-rest prop
  // Cushion: seat part + back part.
  const cushion = mergeGeometries([
    b(0.6, 0.06, 1.28, 0, 0.38, 0.35),
    b(0.6, 0.06, backLen - 0.04, 0, 0.385 + Math.sin(tilt) * backLen / 2, -0.3 - Math.cos(tilt) * backLen / 2, tilt),
  ]);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const put = (mesh: THREE.InstancedMesh, items: Lounger[], color: boolean) => {
    items.forEach((l, i) => {
      q.setFromAxisAngle(up, l.yaw);
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(l.x, l.y, l.z), q, one));
      if (color) mesh.setColorAt(i, l.color);
    });
    mesh.count = items.length;
    mesh.computeBoundingSphere();
    g.add(mesh);
  };
  put(new THREE.InstancedMesh(mergeGeometries(frame), applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.55 })), list.length), list, false);
  put(new THREE.InstancedMesh(cushion, applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 })), list.length), list, true);
  // Sunbathers: a few baked variants (pose x person), each one instanced over the loungers that use it.
  // The body lies along the lounger: hips on the seat, the torso up the back rest (which is tilted by `tilt`).
  // Standing figure (feet at the origin, head up +Y, facing +Z) laid down with its feet toward the foot end (+Z)
  // and its head up the back rest (-Z): face up = tipped backward; face down = tipped forward and turned round.
  const lie = (faceUp: boolean) => (root: THREE.Group) => {
    if (faceUp) root.rotation.set(-Math.PI / 2, 0, 0);
    else root.rotation.set(Math.PI / 2, Math.PI, 0, 'YXZ');
    root.position.set(0, faceUp ? 0.51 : 0.55, 0.62);
  };
  const sit = (root: THREE.Group) => { root.position.set(0, -0.4, 0.1); root.rotation.x = -0.28; };
  const variants: [Pose, (root: THREE.Group) => void, boolean][] = [
    [LYING_BACK, lie(true), true], [LYING_BACK2, lie(true), true], [LYING_BACK, lie(true), false], [LYING_FRONT, lie(false), true],
    [SITTING, sit, true], [LYING_BACK2, lie(true), false], [LYING_FRONT, lie(false), false], [SITTING, sit, false],
  ];
  const mat = figureMaterial();
  variants.forEach(([p, placeFn, female], v) => {
    const items = list.filter((l) => l.person >= 0 && l.person % variants.length === v);
    if (!items.length) return;
    // Two different people per variant, alternating.
    for (let alt = 0; alt < 2; alt++) {
      const sub = items.filter((_, i) => i % 2 === alt);
      if (!sub.length) continue;
      const geo = bakeFigure({ ...lookFor(v * 2 + alt + 3, female), shades: true }, p, placeFn);
      put(new THREE.InstancedMesh(geo, mat, sub.length), sub, false);
    }
  });
  return g;
}

/** Standing cocktail tables with a couple of drinks on them. */
export function createDrinkTables(list: { x: number; y: number; z: number }[]): THREE.InstancedMesh {
  const parts: Paint = [];
  parts.push([new THREE.CylinderGeometry(0.42, 0.42, 0.04, 20).translate(0, 1.05, 0), '#f4f0e6']);
  parts.push([new THREE.CylinderGeometry(0.035, 0.035, 1.02, 10).translate(0, 0.52, 0), '#c8c8cc']);
  parts.push([new THREE.CylinderGeometry(0.28, 0.3, 0.03, 16).translate(0, 0.015, 0), '#c8c8cc']);
  const drinks = ['#ff3a7a', '#ffd23f', '#3dff9e'];
  drinks.forEach((c, i) => {
    const a = i * 2.1;
    const x = Math.cos(a) * 0.2, z = Math.sin(a) * 0.2;
    parts.push([new THREE.CylinderGeometry(0.045, 0.03, 0.13, 10).translate(x, 1.135, z), c]);
    parts.push([new THREE.CylinderGeometry(0.004, 0.004, 0.16, 5).rotateZ(0.3).translate(x + 0.02, 1.2, z), '#ffffff']); // straw
  });
  const mesh = new THREE.InstancedMesh(merged(parts), applyAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 })), Math.max(1, list.length));
  const m = new THREE.Matrix4();
  list.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  mesh.count = list.length;
  mesh.computeBoundingSphere();
  mesh.name = 'drink-tables';
  return mesh;
}
