import * as THREE from 'three';
import { applyAtmosphere, ATMOS_PARS, atmosphere, NOISE_GLSL } from '../render/atmosphere';
import { LoopTrack } from '../track/Track';
import { Rng } from '../util/random';

const ACCENTS = ['#ff2bd6', '#00e5ff', '#ff3b5c', '#a64dff', '#ffb000', '#3dff9e', '#ff6a00', '#4d7cff'].map(
  (c) => new THREE.Color(c),
);

// Style flags (bitmask in aStyle.w)
const F_CORNERS = 1; // vertical neon strips on the corners
const F_BANDS = 2; // horizontal neon bands every N metres
const F_CROWN = 4; // neon crown ring at the top + roof edge glow
const F_CURTAIN = 8; // glass curtain wall: vertical light lines instead of windows
const F_PLAIN = 16; // no windows (rooftop machinery, spires)

// Window styles (aStyle2.x)
const W_GRID = 0;
const W_RIBBON = 1;
const W_SLITS = 2;
const W_PANES = 3;
const W_IRREGULAR = 4;

type Shape = 'box' | 'cyl' | 'hex' | 'spire' | 'pyramid';

/** Shared look parameters for a whole building (all its parts). */
interface Look {
  seed: number;
  accent: THREE.Color;
  winW: number;
  floorH: number;
  lit: number;
  flags: number;
  winStyle: number;
  tone: number;
}

interface BuildingDef extends Look {
  shape: Shape;
  x: number;
  z: number;
  baseY: number;
  w: number;
  h: number;
  d: number;
  yaw: number;
}

export interface RoofSpot {
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  yaw: number;
}

/** A screen mounted flat on a building face. pos = bottom centre. */
export interface FaceSpot {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  w: number;
  h: number;
}

export class City {
  readonly group = new THREE.Group();
  /** Roofs below road level near the track: candidates for rooftop billboards. */
  readonly roofSpots: RoofSpot[] = [];
  /** Building faces near the road suitable for big screens. */
  readonly faceSpots: FaceSpot[] = [];
  /** Rooftops that get sweeping searchlights. */
  readonly searchlightSpots: THREE.Vector3[] = [];

  private readonly defs: BuildingDef[] = [];
  private readonly antennas: { x: number; z: number; y: number; h: number }[] = [];
  private readonly blinkers: THREE.Vector3[] = [];
  private readonly halos: { x: number; z: number; y: number; r: number; color: THREE.Color }[] = [];

  constructor(private readonly track: LoopTrack, seed: number, opts: { minDist?: number; margin?: number } = {}) {
    const rng = new Rng(seed);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.samples) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const margin = opts.margin ?? 1500;
    const cell = 52;
    const roadH = track.height;
    const clearance = track.width / 2 + 10;

    for (let gx = minX - margin; gx < maxX + margin; gx += cell) {
      for (let gz = minZ - margin; gz < maxZ + margin; gz += cell) {
        if (rng.chance(0.16)) continue;
        // Footprint + jitter always stays inside the 52 m cell (>= 4 m gap): no interpenetrating towers.
        const x = gx + rng.range(-4, 4);
        const z = gz + rng.range(-4, 4);
        const w = rng.range(14, 36);
        const d = rng.range(14, 36);
        const distRoad = Math.sqrt(track.distanceSqTo(x, z));
        if (distRoad < clearance + Math.hypot(w, d) / 2 * 1.15 || distRoad < (opts.minDist ?? 0)) continue;

        const near = distRoad < 320;
        let h: number;
        if (near) {
          h = rng.chance(0.45) ? rng.range(roadH + 25, roadH + 300) : rng.range(30, roadH - 25);
        } else {
          h = 35 + Math.pow(rng.next(), 1.7) * 380;
          if (rng.chance(0.03)) h += 220;
        }

        const look = this.randomLook(rng);
        const yaw = rng.chance(0.2) && Math.hypot(w, d) < 40 ? rng.range(-0.8, 0.8) : 0;
        const r = rng.next();
        let topY: number;
        if (r < 0.42) topY = this.boxTower(rng, x, z, w, d, h, yaw, look, near, distRoad);
        else if (r < 0.54) topY = this.roundTower(rng, x, z, Math.min(w, d), h, look, 'cyl');
        else if (r < 0.63) topY = this.roundTower(rng, x, z, Math.min(w, d), h, look, 'hex');
        else if (r < 0.72) topY = this.twinTowers(rng, x, z, w, d, h, yaw, look);
        else if (r < 0.81) topY = this.lShape(rng, x, z, w, d, h, yaw, look);
        else if (r < 0.92) topY = this.slab(rng, x, z, w, d, Math.min(h, near ? roadH - 30 : 90), yaw, look);
        else topY = this.needle(rng, x, z, Math.min(w, d), h + 60, look);

        // Roof clutter + rooftop billboard candidates for roofs we look down on.
        if (topY < roadH && near) {
          const nBoxes = rng.int(1, 4);
          for (let b = 0; b < nBoxes; b++) {
            this.push('box', x + rng.range(-w * 0.25, w * 0.25), z + rng.range(-d * 0.25, d * 0.25), topY, rng.range(3, w * 0.3), rng.range(2, 5), rng.range(3, d * 0.3), yaw, { ...look, flags: F_PLAIN });
          }
          if (distRoad < 180 && w > 18 && rng.chance(0.5)) this.roofSpots.push({ x, z, y: topY, w: w * 0.8, d: d * 0.8, yaw });
        }
        // Searchlights (hash-based so it doesn't disturb the layout RNG).
        const hs = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
        if (topY > roadH + 50 && distRoad < 700 && hs < 0.07 && this.searchlightSpots.length < 16) {
          this.searchlightSpots.push(new THREE.Vector3(x, topY + 1, z));
        }
        if (topY > roadH + 40 && rng.chance(0.4)) {
          const ah = rng.range(12, 45);
          this.antennas.push({ x, z, y: topY, h: ah });
          this.blinkers.push(new THREE.Vector3(x, topY + ah, z));
        }
        if (topY > roadH + 80 && rng.chance(0.5)) {
          this.blinkers.push(new THREE.Vector3(x + w / 3, topY + 0.5, z + d / 3), new THREE.Vector3(x - w / 3, topY + 0.5, z - d / 3));
        }
      }
    }

    this.buildMeshes();
  }

  private randomLook(rng: Rng): Look {
    let flags = 0;
    if (rng.chance(0.25)) flags |= F_CORNERS;
    if (rng.chance(0.18)) flags |= F_BANDS;
    if (rng.chance(0.3)) flags |= F_CROWN;
    if (rng.chance(0.12)) flags |= F_CURTAIN;
    const ws = rng.next();
    const winStyle = ws < 0.4 ? W_GRID : ws < 0.58 ? W_RIBBON : ws < 0.72 ? W_SLITS : ws < 0.86 ? W_PANES : W_IRREGULAR;
    return {
      seed: rng.next() * 1000,
      accent: rng.pick(ACCENTS),
      winW: rng.range(2.0, 4.2),
      floorH: rng.range(3.0, 4.4),
      lit: rng.range(0.12, 0.6),
      flags,
      winStyle,
      tone: Math.pow(rng.next(), 2),
    };
  }

  private push(shape: Shape, x: number, z: number, baseY: number, w: number, h: number, d: number, yaw: number, look: Look): void {
    this.defs.push({ ...look, shape, x, z, baseY, w, h, d, yaw, seed: look.seed + this.defs.length * 0.137 });
  }

  // --- Archetypes. Each returns the top height.

  private boxTower(rng: Rng, x: number, z: number, w: number, d: number, h: number, yaw: number, look: Look, near: boolean, distRoad: number): number {
    const tiers = h > 120 && rng.chance(0.55) ? rng.int(2, 3) : 1;
    let baseY = 0, tw = w, td = d, remaining = h;
    for (let t = 0; t < tiers; t++) {
      const th = t === tiers - 1 ? remaining : remaining * rng.range(0.5, 0.7);
      this.push('box', x, z, baseY, tw, th, td, yaw, { ...look, flags: t === tiers - 1 ? look.flags : look.flags & ~F_CROWN });
      if (t === 0 && near && distRoad < 260 && th > this.track.height + 30 && rng.chance(0.35)) this.addFaceSpot(rng, x, z, tw, td, yaw, th);
      baseY += th;
      remaining -= th;
      tw *= rng.range(0.6, 0.85);
      td *= rng.range(0.6, 0.85);
    }
    if (rng.chance(0.25)) {
      const ph = Math.min(tw, td) * rng.range(0.4, 0.9);
      this.push('pyramid', x, z, baseY, tw, ph, td, yaw, { ...look, flags: F_PLAIN | (look.flags & F_BANDS) });
      baseY += ph;
    }
    return baseY;
  }

  private roundTower(rng: Rng, x: number, z: number, size: number, h: number, look: Look, shape: 'cyl' | 'hex'): number {
    const dia = size * rng.range(0.85, 1.1);
    const tiers = h > 150 && rng.chance(0.5) ? 2 : 1;
    let baseY = 0, dd = dia, remaining = h;
    for (let t = 0; t < tiers; t++) {
      const th = t === tiers - 1 ? remaining : remaining * rng.range(0.55, 0.75);
      this.push(shape, x, z, baseY, dd, th, dd, 0, { ...look, flags: t === tiers - 1 ? look.flags : look.flags & ~F_CROWN });
      baseY += th;
      remaining -= th;
      dd *= rng.range(0.65, 0.85);
    }
    if (rng.chance(0.45)) {
      const sh = rng.range(20, 70);
      this.push(shape === 'hex' ? 'pyramid' : 'spire', x, z, baseY, dd * 0.9, sh, dd * 0.9, 0, { ...look, flags: F_PLAIN | F_BANDS });
      this.blinkers.push(new THREE.Vector3(x, baseY + sh, z));
      baseY += sh;
    }
    if (h > this.track.height && rng.chance(0.3)) {
      this.halos.push({ x, z, y: h * rng.range(0.6, 0.95), r: dia * 0.5 + rng.range(4, 10), color: look.accent });
    }
    return baseY;
  }

  private twinTowers(rng: Rng, x: number, z: number, w: number, d: number, h: number, yaw: number, look: Look): number {
    const tw = w * 0.42;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const off = w * 0.29;
    const h2 = h * rng.range(0.8, 1.0);
    this.push('box', x - off * c, z + off * s, 0, tw, h, d * 0.7, yaw, look);
    this.push('box', x + off * c, z - off * s, 0, tw, h2, d * 0.7, yaw, look);
    const by = Math.min(h, h2) * rng.range(0.5, 0.8);
    this.push('box', x, z, by, w * 0.2, rng.range(5, 9), d * 0.3, yaw, { ...look, winStyle: W_RIBBON, lit: 0.8 });
    return Math.max(h, h2);
  }

  private lShape(rng: Rng, x: number, z: number, w: number, d: number, h: number, yaw: number, look: Look): number {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.push('box', x, z, 0, w, h, d * 0.45, yaw, look);
    const h2 = h * rng.range(0.5, 1.2);
    // Offsets chosen so no faces are coplanar with the first box (avoids z-fighting).
    const ox = w * 0.27, oz = d * 0.25;
    this.push('box', x + ox * c + oz * s, z - ox * s + oz * c, 0, w * 0.4, h2, d * 1.02, yaw, { ...look, tone: Math.min(1, look.tone + 0.3) });
    return Math.max(h, h2);
  }

  private slab(rng: Rng, x: number, z: number, w: number, d: number, h: number, yaw: number, look: Look): number {
    const hh = Math.max(25, h * rng.range(0.4, 1.0));
    this.push('box', x, z, 0, w * 1.05, hh, d * 1.05, yaw, { ...look, winStyle: rng.chance(0.5) ? W_RIBBON : W_PANES });
    return hh;
  }

  private needle(rng: Rng, x: number, z: number, size: number, h: number, look: Look): number {
    const dia = size * 0.45;
    this.push(rng.chance(0.5) ? 'hex' : 'cyl', x, z, 0, dia, h, dia, 0, { ...look, flags: look.flags | F_BANDS });
    const sh = rng.range(30, 80);
    this.push('spire', x, z, h, dia * 0.6, sh, dia * 0.6, 0, { ...look, flags: F_PLAIN | F_BANDS });
    this.blinkers.push(new THREE.Vector3(x, h + sh, z));
    return h + sh;
  }

  /** Put a screen on the box face that looks most toward the road. */
  private addFaceSpot(rng: Rng, x: number, z: number, w: number, d: number, yaw: number, faceH: number): void {
    const target = this.track.samples[this.track.nearestSample(x, z)];
    const toRoad = new THREE.Vector2(target.x - x, target.z - z).normalize();
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // Local face normals (+x, -x, +z, -z) rotated by yaw about Y.
    const faces = [
      { n: new THREE.Vector3(c, 0, -s), half: w / 2, width: d },
      { n: new THREE.Vector3(-c, 0, s), half: w / 2, width: d },
      { n: new THREE.Vector3(s, 0, c), half: d / 2, width: w },
      { n: new THREE.Vector3(-s, 0, -c), half: d / 2, width: w },
    ];
    let best = faces[0], bestDot = -2;
    for (const f of faces) {
      const dot = f.n.x * toRoad.x + f.n.z * toRoad.y;
      if (dot > bestDot) { bestDot = dot; best = f; }
    }
    const sw = Math.min(best.width * 0.85, 40);
    const sh = sw / 2;
    const y = this.track.height + rng.range(4, Math.max(5, faceH - this.track.height - sh - 4));
    if (y + sh > faceH) return;
    this.faceSpots.push({ pos: new THREE.Vector3(x + best.n.x * (best.half + 0.5), y, z + best.n.z * (best.half + 0.5)), normal: best.n, w: sw, h: sh });
  }

  // --- Mesh building

  private buildMeshes(): void {
    const shapes: Record<Shape, { geo: THREE.BufferGeometry; round: number }> = {
      box: { geo: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), round: 0 },
      cyl: { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 28, 1).translate(0, 0.5, 0), round: 4 },
      hex: { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1).translate(0, 0.5, 0), round: 6 },
      spire: { geo: new THREE.ConeGeometry(0.5, 1, 12, 1).translate(0, 0.5, 0), round: 4 },
      pyramid: { geo: new THREE.ConeGeometry(0.7071, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0), round: 4 },
    };
    for (const key of Object.keys(shapes) as Shape[]) {
      const list = this.defs.filter((d) => d.shape === key);
      if (list.length === 0) continue;
      this.group.add(this.buildShape(list, shapes[key].geo, shapes[key].round));
    }
    this.group.add(this.buildAntennas());
    this.group.add(this.buildBlinkers());
    if (this.halos.length) this.group.add(this.buildHalos());
  }

  private buildShape(defs: BuildingDef[], geo: THREE.BufferGeometry, round: number): THREE.InstancedMesh {
    const n = defs.length;
    const seeds = new Float32Array(n);
    const accents = new Float32Array(n * 3);
    const styles = new Float32Array(n * 4);
    const styles2 = new Float32Array(n * 4);
    const mat = new THREE.ShaderMaterial({
      defines: round > 0 ? { ROUND: 1, CORNER_DIV: `${round}.0` } : {},
      uniforms: { ...atmosphere },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        attribute vec3 aAccent;
        attribute vec4 aStyle;
        attribute vec4 aStyle2;
        varying vec3 vMeters;
        varying vec3 vSize;
        varying vec3 vNormalL;
        varying vec3 vNormalW;
        varying vec3 vWorld;
        flat varying float vSeed;
        flat varying vec3 vAccent;
        flat varying vec4 vStyle;
        flat varying vec4 vStyle2;
        void main() {
          vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vSize = size;
          vMeters = position * size;
          vNormalL = normal;
          mat4 m = modelMatrix * instanceMatrix;
          vNormalW = normalize(mat3(m) * normal);
          vec4 w = m * vec4(position, 1.0);
          vWorld = w.xyz;
          vSeed = aSeed; vAccent = aAccent; vStyle = aStyle; vStyle2 = aStyle2;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vMeters;
        varying vec3 vSize;
        varying vec3 vNormalL;
        varying vec3 vNormalW;
        varying vec3 vWorld;
        flat varying float vSeed;
        flat varying vec3 vAccent;
        flat varying vec4 vStyle;
        flat varying vec4 vStyle2;
        ${ATMOS_PARS}
        ${NOISE_GLSL}

        bool hasFlag(float flags, float f) { return mod(floor(flags / f), 2.0) > 0.5; }
        float aaBand(float x, float halfW) {
          float fw = max(fwidth(x), 1e-4);
          return 1.0 - smoothstep(halfW - fw, halfW + fw, abs(x));
        }

        void main() {
          vec3 n = normalize(vNormalL);
          float flags = vStyle.w;
          float tone = vStyle2.y;
          // Facade: dark glass .. lighter tinted concrete.
          vec3 darkGlass = mix(vec3(0.014, 0.013, 0.025), vAccent * 0.025, 0.4);
          vec3 concrete = vec3(0.055, 0.05, 0.065) * mix(vec3(1.0), vAccent * 0.6 + 0.4, 0.3);
          vec3 facade = mix(darkGlass, concrete, tone) * (0.85 + 0.3 * hash11(vSeed));
          float moon = max(dot(normalize(vNormalW), normalize(uMoonDir)), 0.0);
          float uplight = 1.0 - smoothstep(0.0, 260.0, vWorld.y);
          vec3 lit = facade * (0.5 + 1.1 * moon) + uHazeColor * 0.05 * uplight;
          vec3 col;

          if (n.y > 0.6) {
            // Flat roof.
            col = lit * 0.7 + vec3(0.01, 0.01, 0.015);
            if (hasFlag(flags, ${F_CROWN}.0)) {
              #ifdef ROUND
                float e = 0.5 * min(vSize.x, vSize.z) - length(vMeters.xz);
              #else
                vec2 e2 = vSize.xz * 0.5 - abs(vMeters.xz);
                float e = min(e2.x, e2.y);
              #endif
              col += vAccent * (1.0 - smoothstep(0.0, 1.2, e)) * 2.0;
            }
          } else {
            #ifdef ROUND
              vec2 q = vMeters.xz / max(vSize.xz * 0.5, vec2(0.01));
              float ang = atan(q.y, q.x);
              float rad = 0.25 * (vSize.x + vSize.z);
              float u = ang * rad;
              float faceW = 6.2832 * rad;
              float faceId = floor((ang + 3.1416) / 1.5708);
              float seg = 6.2832 / CORNER_DIV;
              float cornerD = abs(fract(ang / seg) - 0.5) * seg * rad;
              cornerD = seg * rad * 0.5 - cornerD;
            #else
              bool xFace = abs(n.x) > 0.5;
              float u = xFace ? vMeters.z : vMeters.x;
              float faceW = xFace ? vSize.z : vSize.x;
              float faceId = dot(n, vec3(1.0, 2.0, 3.0));
              float cornerD = faceW * 0.5 - abs(u);
            #endif
            float v = vMeters.y;

            if (hasFlag(flags, ${F_PLAIN}.0)) {
              col = lit * 1.2;
            } else if (hasFlag(flags, ${F_CURTAIN}.0)) {
              float g = fract(u / 1.6);
              float mull = aaBand(g - 0.5, 0.04);
              float shimmer = fbm(vec2(u * 0.05, v * 0.02 + vSeed));
              col = lit * 0.6 + vec3(0.02, 0.03, 0.06) * shimmer + vAccent * mull * 0.2;
              col += vAccent * 0.06 * smoothstep(0.6, 1.0, shimmer);
            } else {
              float ws = vStyle2.x;
              float winW = vStyle.x, floorH = vStyle.y, litRatio = vStyle.z;
              vec2 lo = vec2(0.2, 0.2);
              vec2 hi = vec2(0.8, 0.75);
              float litGroup = 1.0;
              vec3 coolCol = vec3(0.55, 0.8, 1.0);
              if (ws == ${W_RIBBON}.0) { lo = vec2(-1.0, 0.3); hi = vec2(2.0, 0.78); litGroup = 4.0; }
              else if (ws == ${W_SLITS}.0) { lo = vec2(0.42, 0.06); hi = vec2(0.58, 0.94); winW *= 0.6; }
              else if (ws == ${W_PANES}.0) { lo = vec2(0.05, 0.08); hi = vec2(0.95, 0.92); winW *= 2.2; floorH *= 1.1; coolCol = vec3(0.7, 0.85, 1.0); }

              vec2 g = vec2((u + faceW * 0.5) / winW, v / floorH);
              vec2 cellId = floor(g);
              vec2 f = fract(g);
              vec2 litCell = vec2(floor(cellId.x / litGroup), cellId.y);
              float rnd = hash21(litCell + vec2(vSeed * 1.37 + faceId * 17.0, vSeed * 0.71));
              float rowRnd = hash21(vec2(cellId.y, vSeed + faceId));
              float colRnd = hash21(vec2(floor(cellId.x / 3.0) + faceId * 31.0, vSeed * 2.9));
              float on = step(rnd, litRatio * (0.4 + rowRnd * 1.2) * (0.6 + 0.8 * colRnd));
              // Fully lit office floors.
              float officeFloor = step(hash21(vec2(cellId.y * 0.37, vSeed)), ws == ${W_PANES}.0 ? 0.25 : 0.06);
              on = max(on, officeFloor);
              float rc = hash21(litCell * 1.7 + vSeed);
              vec3 wc = rc < 0.55 ? vec3(1.0, 0.72, 0.42) : (rc < 0.85 ? coolCol : vAccent);
              if (officeFloor > 0.5) wc = vec3(0.85, 0.92, 1.0);
              float bright = 0.5 + 1.1 * hash21(litCell + 3.1 + vSeed);
              float present = 1.0;
              if (ws == ${W_IRREGULAR}.0) present = step(0.35, hash21(cellId * 0.91 + vSeed * 4.0));
              vec2 fw = max(fwidth(g), vec2(1e-4));
              vec2 mm = smoothstep(lo, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi, f));
              float mask = mm.x * mm.y * present;
              vec3 glass = vec3(0.025, 0.025, 0.05);
              vec3 nearCol = mix(lit, mix(glass, wc * bright, on), mask);
              // Fade to an average once the *window* (not the cell) gets near pixel size.
              vec2 winFrac = clamp(hi - lo, vec2(0.05), vec2(1.0));
              vec2 winPx = fw / winFrac;
              float far = max(smoothstep(0.15, 0.42, max(winPx.x, winPx.y)), smoothstep(0.08, 0.24, max(fw.x, fw.y)));
              vec3 farCol = lit + vec3(1.0, 0.7, 0.5) * litRatio * winFrac.x * winFrac.y * 0.22 * (ws == ${W_IRREGULAR}.0 ? 0.65 : 1.0);
              col = mix(nearCol, farCol, far);
            }

            if (hasFlag(flags, ${F_CORNERS}.0)) col += vAccent * aaBand(cornerD - 0.5, 0.35) * 2.5;
            if (hasFlag(flags, ${F_BANDS}.0)) {
              float bv = mod(v + 12.0, 24.0) - 12.0;
              col += vAccent * aaBand(bv, 0.35) * 2.0;
            }
            if (hasFlag(flags, ${F_CROWN}.0)) col += vAccent * aaBand(v - (vSize.y - 2.0), 0.6) * 3.0;
          }
          gl_FragColor = vec4(applyAtmos(col, vWorld), 1.0);
        }`,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    defs.forEach((b, i) => {
      q.setFromAxisAngle(up, b.yaw);
      m.compose(p.set(b.x, b.baseY, b.z), q, s.set(b.w, b.h, b.d));
      mesh.setMatrixAt(i, m);
      seeds[i] = b.seed;
      accents.set([b.accent.r, b.accent.g, b.accent.b], i * 3);
      styles.set([b.winW, b.floorH, b.lit, b.flags], i * 4);
      styles2.set([b.winStyle, b.tone, 0, 0], i * 4);
    });
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.setAttribute('aAccent', new THREE.InstancedBufferAttribute(accents, 3));
    geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(styles, 4));
    geo.setAttribute('aStyle2', new THREE.InstancedBufferAttribute(styles2, 4));
    mesh.computeBoundingSphere();
    return mesh;
  }

  private buildAntennas(): THREE.InstancedMesh {
    const list = this.antennas;
    const geo = new THREE.CylinderGeometry(0.25, 0.6, 1, 6).translate(0, 0.5, 0);
    const mat = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#1a1822', metalness: 0.7, roughness: 0.4 }));
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const m = new THREE.Matrix4();
    list.forEach((a, i) => {
      m.makeScale(1, a.h, 1).setPosition(a.x, a.y, a.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = list.length;
    mesh.computeBoundingSphere();
    return mesh;
  }

  private buildHalos(): THREE.InstancedMesh {
    const geo = new THREE.TorusGeometry(1, 0.025, 6, 64).rotateX(Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, applyAtmosphere(new THREE.MeshBasicMaterial({ color: '#ffffff' })), this.halos.length * 2);
    const m = new THREE.Matrix4();
    let i = 0;
    for (const h of this.halos) {
      for (let k = 0; k < 2; k++) {
        const r = h.r + k * 2.5;
        // Tube radius scales with r: keep the ring ~0.4 m thick by scaling Y less.
        m.makeScale(r, r, r).setPosition(h.x, h.y - k * 3, h.z);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, h.color.clone().multiplyScalar(3));
        i++;
      }
    }
    mesh.computeBoundingSphere();
    return mesh;
  }

  private buildBlinkers(): THREE.Points {
    const points = this.blinkers;
    const rng = new Rng(points.length * 7919);
    const pos = new Float32Array(points.length * 3);
    const phase = new Float32Array(points.length);
    points.forEach((p, i) => {
      pos.set([p.x, p.y, p.z], i * 3);
      phase[i] = rng.next();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...atmosphere },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aPhase;
        varying float vBlink;
        varying vec3 vWorld;
        uniform float uTime;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vec4 mv = viewMatrix * w;
          float t = fract(uTime * 0.5 + aPhase);
          vBlink = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.25, 0.35, t));
          gl_PointSize = max(2.0, 2400.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vBlink;
        varying vec3 vWorld;
        ${ATMOS_PARS}
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = 1.0 - smoothstep(0.0, 0.5, d);
          vec3 c = vec3(1.0, 0.08, 0.05) * 4.0 * vBlink * a;
          float dist = length(vWorld - cameraPosition) * uFogDensity;
          c *= exp(-dist * dist * 0.6);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }
}
