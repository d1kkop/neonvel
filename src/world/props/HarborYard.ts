import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyAtmosphere, ATMOS_PARS, atmosphere, NOISE_GLSL } from '../../render/atmosphere';
import type { LoopTrack } from '../../track/Track';
import { extrude, rectProfile } from '../trackGeometry';
import { makeFrame } from '../../track/Track';
import type { Rng } from '../../util/random';
import { insideTrack } from '../coast/Coast';
import { MAST_GRID, MAST_LIGHT_GLSL } from '../harborLights';

/**
 * Harbor Docks: a working container terminal.
 *  - Containers with real detail (corrugated walls that catch the light, corner posts, doors with locking bars,
 *    stripes, ID labels, rust and grime), lit by floodlight masts standing on a grid over the yard.
 *  - A few ship-to-shore cranes of different sizes on the waterfront: legs in one colour, the boom and machinery
 *    in another; the trolley runs out over the ship, lowers the spreader, lifts a container and brings it ashore.
 *  - Yard cranes straddling the container rows, rolling along them and restacking containers.
 *  - Conveyor bridges over the road: a quay crane sets a container down at the foot of a tower, a hoist lifts it
 *    to a roller deck high above the road, it rolls across over the traffic and is lowered onto a stack in the yard.
 *  - Conveyor belts between the rows, carrying containers from one end housing to the other.
 *  - Robot carriers (flat driverless platforms): loops through the yard, and service lanes hung on the side of
 *    the road where they drive along next to you with a container on board.
 * Everything moving is driven from update(time); nothing here can be driven into (the road is on pillars above).
 */

export const CONTAINER = { length: 12, height: 2.6, width: 2.45 };
const CONTAINER_COLORS = ['#c0392b', '#1f6fb2', '#e67e22', '#27ae60', '#8e44ad', '#d4ac0d', '#7f8c8d', '#16a085', '#b8442c', '#2a5a8a'].map((c) => new THREE.Color(c));
const QUAY = MAST_GRID.quayY;
/** Container ships: deck height above the water (world y), length and beam (m). */
const SHIP_DECK_Y = 12;
const SHIP_L = 290;
const SHIP_B = 42;
/** Tiers stacked in the docked ship's loading bay (the quay crane sets boxes down on top of them). */
const LOAD_TIERS = 2;
/** How far from the road's centre line the quay cranes stand (the quay ends 45 m out). */
const QUAY_CRANE_LAT = 34;

// ------------------------------------------------------------------ containers

function containerMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      varying vec3 vColor; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vN; varying vec3 vNl; varying vec3 vTx; varying vec3 vTz; varying float vSeed;
      void main() {
        vColor = aColor; vLocal = position; vNl = normal;
        mat4 m = modelMatrix * instanceMatrix;
        vec4 w = m * vec4(position, 1.0);
        vWorld = w.xyz;
        mat3 m3 = mat3(m);
        vN = normalize(m3 * normal); vTx = normalize(m3 * vec3(1.0, 0.0, 0.0)); vTz = normalize(m3 * vec3(0.0, 0.0, 1.0));
        vSeed = fract(float(gl_InstanceID) * 0.61803 + aColor.r * 3.7 + aColor.b * 1.3);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vN; varying vec3 vNl; varying vec3 vTx; varying vec3 vTz; varying float vSeed;
      ${ATMOS_PARS}
      ${NOISE_GLSL}
      ${MAST_LIGHT_GLSL}
      // Corrugation: flat crest, slope, flat trough. Returns (height 0..1, slope -1 / 0 / +1).
      vec2 corrugation(float c) {
        float f = fract(c) - 0.5;
        float tri = abs(f) * 2.0;
        return vec2(smoothstep(0.25, 0.75, tri), sign(f) * (step(0.25, tri) - step(0.75, tri)));
      }
      void main() {
        vec3 n = normalize(vN);
        vec3 p = vLocal;                       // x: -6..6 along, y: 0..2.6 up, z: -1.225..1.225 across
        vec3 an = abs(vNl);
        float px = max(length(fwidth(vWorld)), 1e-4);
        #define LAYER(f) (1.0 - smoothstep(0.25, 0.9, (f) * px))
        float ribL = LAYER(3.4);
        vec3 col = vColor;
        float frame = 0.0;                     // corner posts and rails: flat steel
        vec2 rib = vec2(0.5, 0.0);
        vec3 ribDir = vTx;
        float detail = 0.0;                    // dark line work (door seams, bars)
        if (an.z > 0.5) {
          // Long sides.
          frame = clamp(step(5.82, abs(p.x)) + step(p.y, 0.16) + step(2.44, p.y), 0.0, 1.0);
          rib = corrugation(p.x * 3.4);
        } else if (an.x > 0.5) {
          frame = clamp(step(1.08, abs(p.z)) + step(p.y, 0.16) + step(2.44, p.y), 0.0, 1.0);
          if (vNl.x > 0.0) {
            // Door end: two leaves, four locking bars with handles and brackets.
            float seam = 1.0 - smoothstep(0.0, 0.02, abs(p.z));
            float bars = 1.0 - smoothstep(0.018, 0.03, min(abs(abs(p.z) - 0.3), abs(abs(p.z) - 0.8)));
            float brackets = bars * step(0.4, fract(p.y * 1.6)) * 0.0 + (1.0 - smoothstep(0.05, 0.07, min(abs(abs(p.z) - 0.3), abs(abs(p.z) - 0.8)))) * (1.0 - smoothstep(0.03, 0.05, abs(fract(p.y * 1.25) - 0.5)));
            float handle = (1.0 - smoothstep(0.1, 0.12, min(abs(abs(p.z) - 0.42), abs(abs(p.z) - 0.68)))) * (1.0 - smoothstep(0.02, 0.035, abs(p.y - 1.15)));
            detail = max(seam, 0.0);
            float steel = max(max(bars, brackets), handle) * (1.0 - frame) * LAYER(12.0);
            col = mix(col, vec3(0.62, 0.64, 0.68), steel * 0.85);
            rib = vec2(0.5, 0.0);
          } else {
            rib = corrugation(p.z * 3.4);
            ribDir = vTz;
          }
        } else {
          // Roof (and floor): corrugated across.
          frame = clamp(step(5.82, abs(p.x)) + step(1.08, abs(p.z)), 0.0, 1.0);
          rib = corrugation(p.x * 3.4);
        }
        rib = mix(vec2(0.5, 0.0), rib, ribL * (1.0 - frame));
        // The corrugation tilts the surface: each rib gets a lit and a shaded flank.
        n = normalize(n - ribDir * rib.y * 0.6);
        col *= mix(1.0, 0.8, frame);
        col *= 0.88 + 0.16 * rib.x;
        col *= 1.0 - 0.7 * detail;
        if (an.z > 0.5) {
          // A white band on some containers, and an ID plate of small "characters" near the top corner.
          float band = step(0.62, vSeed) * step(abs(p.y - 1.5), 0.24) * step(abs(p.x), 4.7) * (1.0 - frame);
          col = mix(col, vec3(0.9, 0.9, 0.88), band * 0.85);
          vec2 lab = vec2(p.x * sign(vNl.z) - 3.9, p.y - 2.08);
          float inLab = step(abs(lab.x), 1.2) * step(abs(lab.y), 0.17) * (1.0 - frame);
          float glyph = step(0.45, hash21(floor(vec2(lab.x * 9.0 + vSeed * 40.0, lab.y * 6.0)))) * LAYER(9.0);
          col = mix(col, vec3(0.95), inLab * glyph * 0.85);
        }
        // Weathering: rust running down from the roof rail and creeping up from the floor, sun-faded patches,
        // grime along the bottom, scuffs.
        float streak = vnoise(vec2((p.x + p.z * 3.0) * 2.6 + vSeed * 50.0, p.y * 0.35 + vSeed * 9.0));
        float rust = smoothstep(0.58, 0.85, streak) * smoothstep(0.9, 2.5, p.y) * (0.4 + 0.6 * vnoise(p.xy * 1.7 + vSeed * 31.0));
        rust = max(rust, smoothstep(0.5, 0.0, p.y) * smoothstep(0.45, 0.75, vnoise(p.xz * 2.2 + vSeed * 17.0)));
        rust = max(rust, frame * smoothstep(0.55, 0.8, vnoise(p.xy * 3.1 + p.z + vSeed * 5.0)) * 0.8);
        col = mix(col, vec3(0.3, 0.12, 0.045) * (0.7 + 0.6 * vnoise(p.xy * 9.0 + p.z * 7.0)), rust * 0.65 * LAYER(1.7));
        col *= 0.86 + 0.26 * vnoise(vec2(p.x * 0.5 + p.z, p.y * 0.8) + vSeed * 23.0);
        col *= 1.0 + 0.1 * (vnoise(p.xy * 14.0 + p.z * 11.0) - 0.5) * LAYER(14.0);
        col *= mix(0.72, 1.0, smoothstep(0.0, 0.55, p.y));
        // Contact shadow where boxes sit on each other / on the ground.
        float ao = (0.62 + 0.38 * smoothstep(0.0, 0.35, p.y)) * (0.82 + 0.18 * smoothstep(0.0, 0.3, 2.6 - p.y));
        // Light: night sky from above, warm bounce from the lit quay below, the moon, and the floodlight masts.
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 moon = normalize(uMoonDir);
        vec3 amb = mix(vec3(0.2, 0.15, 0.12), vec3(0.13, 0.18, 0.3), n.y * 0.5 + 0.5);
        vec3 light = amb * ao + vec3(0.42, 0.52, 0.8) * max(dot(n, moon), 0.0) * 0.55 + mastLight(vWorld, n) * ao;
        float spec = mastSpec(vWorld, n, V, 26.0) * 0.55 + pow(max(dot(n, normalize(moon + V)), 0.0), 40.0) * 0.2;
        vec3 lit = col * light + MAST_COLOR * spec * (0.25 + 0.5 * rib.x) * (1.0 - 0.6 * rust);
        gl_FragColor = vec4(applyAtmos(lit, vWorld), 1.0);
      }`,
  });
}

export interface BoxPlacement { x: number; y: number; z: number; yaw: number }

function containerMesh(count: number, mat: THREE.ShaderMaterial): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(CONTAINER.length, CONTAINER.height, CONTAINER.width).translate(0, CONTAINER.height / 2, 0);
  const col = new Float32Array(Math.max(1, count) * 3);
  for (let i = 0; i < count; i++) {
    const c = CONTAINER_COLORS[(i * 7 + ((i / 3) | 0)) % CONTAINER_COLORS.length];
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
  return new THREE.InstancedMesh(geo, mat, Math.max(1, count));
}

/** Containers that move (on cranes, belts and carriers): numbered slots, placed every frame. */
class MovingBoxes {
  readonly mesh: THREE.InstancedMesh;
  private used = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(capacity: number, mat: THREE.ShaderMaterial) {
    this.mesh = containerMesh(capacity, mat);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.m);
  }

  alloc(): number {
    return this.used++;
  }

  /** Put slot i at a world position (bottom centre), turned by yaw; `show` false hides it. */
  set(i: number, x: number, y: number, z: number, yaw: number, show = true): void {
    this.q.setFromAxisAngle(this.up, yaw);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.setScalar(show ? 1 : 0));
    this.mesh.setMatrixAt(i, this.m);
  }

  commit(): void {
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ steel helpers

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();

/** A square beam from a to b. */
function beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number): THREE.BufferGeometry {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(t, len, t);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  const mid = a.add(b).multiplyScalar(0.5);
  return g.translate(mid.x, mid.y, mid.z).toNonIndexed();
}

/** Painted steel lit by the masts: standard material plus the mast light as an emissive-like term. */
function steel(color: string): THREE.MeshStandardMaterial {
  const m = applyAtmosphere(new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35 }));
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${MAST_LIGHT_GLSL}`)
      .replace('#include <opaque_fragment>', `outgoingLight += diffuseColor.rgb * mastLight(vAtmosWorld, normalize((vec4(normal, 0.0) * viewMatrix).xyz)) * 0.5;\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'harbor-steel';
  return m;
}

const lampMat = (color: string, k: number) => applyAtmosphere(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }));

/** Red warning light that blinks (all of them roughly together, a little out of step by position). */
function blinkMaterial(color = new THREE.Vector3(1.0, 0.08, 0.06), rate = 0.7): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...atmosphere, uColor: { value: color }, uRate: { value: rate } },
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `${ATMOS_PARS}
      uniform vec3 uColor; uniform float uRate; varying vec3 vW;
      void main() { float on = step(0.5, fract(uTime * uRate + vW.x * 0.013 + vW.z * 0.007)); gl_FragColor = vec4(applyAtmos(uColor * (0.4 + 5.0 * on), vW), 1.0); }`,
  });
}

// ------------------------------------------------------------------ ship-to-shore crane

const STS_SCHEMES: [legs: string, upper: string][] = [['#1f4e8a', '#e8b10e'], ['#a8261c', '#e9e6dc'], ['#2f6a4a', '#f08a1a'], ['#30343c', '#d93a2a']];

/**
 * Ship-to-shore crane, built at scale 1 (portal 34 m high, boom out to 62 m over the water along +Z) and
 * scaled per crane. The legs / portal and the upper works (boom, A-frame, machinery house) are painted in
 * different colours. The trolley, ropes and spreader move; `slot` is its slot for the container it carries.
 */
class QuayCrane {
  readonly group = new THREE.Group();
  private readonly trolley = new THREE.Group();
  private readonly ropes: THREE.Mesh[] = [];
  private readonly spreader: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();
  private static readonly H = 34;
  private static readonly BOOM_Y = 40;

  constructor(x: number, z: number, private readonly yaw: number, private readonly scale: number, scheme: number, private readonly phase: number, private readonly slot: number,
    /** How far out along the boom the ship's deck is (crane-local metres), and the deck's height above the quay. */
    private readonly shipZ: number, private readonly deckY: number,
    /** Where it sets containers down (crane-local z; negative = behind the portal, toward the road). */
    private readonly dropZ = 9) {
    const H = QuayCrane.H, by = QuayCrane.BOOM_Y;
    const [legColor, upperColor] = STS_SCHEMES[scheme % STS_SCHEMES.length];
    const legs = [[-9, -7], [9, -7], [-9, 7], [9, 7]] as const;
    const lower: THREE.BufferGeometry[] = [], upper: THREE.BufferGeometry[] = [];
    for (const [lx, lz] of legs) {
      lower.push(box(1.5, H, 1.5, lx, H / 2, lz));
      lower.push(box(3.2, 1.6, 4.2, lx, 0.8, lz)); // wheel bogie on the quay rail
    }
    // Portal: sill beams low down, top girders, X-bracing on both sides.
    lower.push(box(20, 2.2, 1.6, 0, H, -7), box(20, 2.2, 1.6, 0, H, 7), box(1.6, 2.2, 16, -9, H, 0), box(1.6, 2.2, 16, 9, H, 0));
    for (const lx of [-9, 9]) lower.push(beam(lx, 8, -7, lx, H - 2, 7, 0.6), beam(lx, 8, 7, lx, H - 2, -7, 0.6), box(0.8, 1.2, 14, lx, 8, 0));
    lower.push(box(18, 1.2, 0.8, 0, 12, -7), box(18, 1.2, 0.8, 0, 12, 7));
    // Boom: two chords with diagonals, from behind the portal (backreach) far out over the water.
    const z0 = -26, z1 = 62;
    for (const bx of [-1.6, 1.6]) {
      upper.push(box(0.9, 0.9, z1 - z0, bx, by, (z0 + z1) / 2), box(0.7, 0.7, z1 - z0, bx, by - 3, (z0 + z1) / 2));
      for (let bz = z0; bz < z1; bz += 6) upper.push(beam(bx, by - 3, bz, bx, by, bz + 6, 0.35));
    }
    for (let bz = z0; bz <= z1; bz += 12) upper.push(box(3.6, 0.4, 0.4, 0, by, bz));
    // A-frame + stay cables to the boom, machinery house on the backreach.
    upper.push(beam(-1.6, H, -6, 0, H + 26, 0, 1.0), beam(1.6, H, -6, 0, H + 26, 0, 1.0), beam(-1.6, H, 6, 0, H + 26, 0, 1.0), beam(1.6, H, 6, 0, H + 26, 0, 1.0));
    for (const sz of [22, 40, 58]) upper.push(beam(0, H + 26, 0, 0, by, sz, 0.18));
    upper.push(beam(0, H + 26, 0, 0, by, -24, 0.18), box(6, 5, 9, 0, by + 2.5, -20));
    this.group.add(new THREE.Mesh(mergeGeometries(lower), steel(legColor)));
    this.group.add(new THREE.Mesh(mergeGeometries(upper), steel(upperColor)));
    // Work lights along the boom, floodlights on the portal.
    const lights: THREE.BufferGeometry[] = [];
    for (let bz = z0 + 3; bz < z1; bz += 5) lights.push(box(0.5, 0.25, 0.5, 0, by - 3.6, bz));
    for (const [lx, lz] of legs) lights.push(box(0.9, 0.4, 0.9, lx, H - 1.6, lz));
    this.group.add(new THREE.Mesh(mergeGeometries(lights), lampMat('#ffe2a8', 4)));
    const warn = mergeGeometries([new THREE.SphereGeometry(0.7, 16, 12).translate(0, H + 27, 0).toNonIndexed(), new THREE.SphereGeometry(0.5, 16, 12).translate(0, by + 0.8, z1).toNonIndexed()]);
    this.group.add(new THREE.Mesh(warn, blinkMaterial()));
    // Trolley with the operator's cabin (lit window), hoist ropes and the spreader.
    const tro = new THREE.Mesh(mergeGeometries([box(4.4, 1.2, 4.2, 0, 0, 0), box(2.2, 2.2, 2.4, 0, -1.7, 1.4)]), steel(upperColor));
    const win = new THREE.Mesh(box(2.3, 0.9, 0.1, 0, -1.6, 2.62), lampMat('#bfe6ff', 2.6));
    this.trolley.add(tro, win);
    const ropeGeo = new THREE.BoxGeometry(0.12, 1, 0.12).translate(0, -0.5, 0);
    const ropeMat = steel('#1a1a1e');
    for (const [rx, rz] of [[-1.5, -0.8], [1.5, -0.8], [-1.5, 0.8], [1.5, 0.8]]) {
      const r = new THREE.Mesh(ropeGeo, ropeMat);
      r.position.set(rx, -0.6, rz);
      this.ropes.push(r);
      this.trolley.add(r);
    }
    this.spreader = new THREE.Mesh(mergeGeometries([box(CONTAINER.length + 0.3, 0.5, 2.6, 0, 0.25, 0), box(3, 0.9, 1.6, 0, 0.95, 0)]), steel('#e8c21a'));
    this.trolley.add(this.spreader);
    this.trolley.position.y = by - 4.4;
    this.group.add(this.trolley);
    this.group.position.set(x, QUAY, z);
    this.group.rotation.y = yaw;
    this.group.scale.setScalar(scale);
    this.group.updateMatrixWorld(true);
  }

  update(time: number, boxes: MovingBoxes): void {
    // Loading the ship, one box per 30 s: down to the box waiting at the foot of the conveyor tower, grab, hoist,
    // trolley out over the ship, lower into the loading bay (a different row every time), let go, back.
    const T = 30, tt = time + this.phase, cyc = Math.floor(tt / T), u = tt - cyc * T;
    const row = ((cyc * 7) % 13) / 12 - 0.5;                            // -0.5 .. 0.5 across the ship
    const zShip = this.shipZ + (row * (SHIP_B - 6)) / this.scale, zQuay = this.dropZ;
    const top = -7;                                                      // spreader hanging just under the trolley
    const boxH = CONTAINER.height / this.scale;
    const down = (levelAboveQuay: number) => levelAboveQuay / this.scale - (QuayCrane.BOOM_Y - 4.4); // spreader y (trolley-local) for a world level
    const overShip = down(this.deckY + CONTAINER.height), onQuay = down(1.5 + CONTAINER.height);
    const ease = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    let z: number, y: number;
    let where: 'quay' | 'hook' | 'ship';
    if (u < 4) { z = zQuay; y = THREE.MathUtils.lerp(top, onQuay, ease(0, 4, u)); where = 'quay'; }
    else if (u < 5) { z = zQuay; y = onQuay; where = 'hook'; }
    else if (u < 9) { z = zQuay; y = THREE.MathUtils.lerp(onQuay, top, ease(5, 9, u)); where = 'hook'; }
    else if (u < 15) { z = THREE.MathUtils.lerp(zQuay, zShip, ease(9, 15, u)); y = top; where = 'hook'; }
    else if (u < 19) { z = zShip; y = THREE.MathUtils.lerp(top, overShip, ease(15, 19, u)); where = 'hook'; }
    else if (u < 20) { z = zShip; y = overShip; where = 'ship'; }
    else if (u < 24) { z = zShip; y = THREE.MathUtils.lerp(overShip, top, ease(20, 24, u)); where = 'ship'; }
    else { z = THREE.MathUtils.lerp(zShip, zQuay, ease(24, 30, u)); y = top; where = 'ship'; }
    this.trolley.position.z = z;
    this.spreader.position.y = y;
    for (const r of this.ropes) r.scale.y = -0.6 - (y + 1.4);
    // The container: waiting on the quay, hanging under the spreader, or set down in the ship.
    if (where === 'hook') this.tmp.set(0, QuayCrane.BOOM_Y - 4.4 + y - boxH, z);
    else if (where === 'quay') this.tmp.set(0, QuayCrane.BOOM_Y - 4.4 + onQuay - boxH, zQuay);
    else this.tmp.set(0, QuayCrane.BOOM_Y - 4.4 + overShip - boxH, zShip);
    this.group.localToWorld(this.tmp);
    boxes.set(this.slot, this.tmp.x, this.tmp.y, this.tmp.z, this.yaw, true);
  }
}

// ------------------------------------------------------------------ yard crane (straddles a container row)

const RTG_SCHEMES: [legs: string, upper: string][] = [['#e0661a', '#e9e6dc'], ['#1f5a9a', '#f0c21a'], ['#c8261c', '#3a3e46'], ['#2a7a5a', '#e9e6dc']];

/** Rubber-tyred gantry: rolls along the row (x), the trolley crosses it (z), the spreader lifts a container. */
class YardCrane {
  readonly group = new THREE.Group();
  private readonly trolley = new THREE.Group();
  private readonly ropes: THREE.Mesh[] = [];
  private readonly spreader: THREE.Mesh;
  private readonly wheels: THREE.Object3D[] = [];
  private static readonly H = 21;
  private static readonly SPAN = 7.2; // half span (legs at z = ±SPAN)

  constructor(private readonly x0: number, private readonly z: number, private readonly travel: number, private readonly scale: number, scheme: number, private readonly phase: number, private readonly slot: number) {
    const H = YardCrane.H, S = YardCrane.SPAN;
    const [legColor, upperColor] = RTG_SCHEMES[scheme % RTG_SCHEMES.length];
    const lower: THREE.BufferGeometry[] = [], upper: THREE.BufferGeometry[] = [];
    for (const lz of [-S, S]) {
      for (const lx of [-5, 5]) lower.push(box(0.9, H - 1.6, 0.9, lx, (H - 1.6) / 2 + 1.6, lz));
      lower.push(box(13, 1.0, 1.1, 0, 2.1, lz));                                 // sill beam over the wheels
      lower.push(beam(-5, 3, lz, 0, H - 3, lz, 0.4), beam(5, 3, lz, 0, H - 3, lz, 0.4)); // A-bracing
      lower.push(box(11, 0.8, 0.8, 0, H - 2.4, lz));
    }
    // Two main girders across the row (the trolley rides on them), end ties, machinery box, stair tower.
    for (const gx of [-2.3, 2.3]) upper.push(box(1.1, 1.8, S * 2 + 3, gx, H, 0));
    upper.push(box(5.6, 0.6, 0.8, 0, H + 0.6, -S - 1.1), box(5.6, 0.6, 0.8, 0, H + 0.6, S + 1.1), box(3.2, 2.4, 2.6, 0, H + 2.1, -S + 1.4));
    this.group.add(new THREE.Mesh(mergeGeometries(lower), steel(legColor)));
    this.group.add(new THREE.Mesh(mergeGeometries(upper), steel(upperColor)));
    // Wheels (two per corner).
    const tyre = new THREE.CylinderGeometry(0.8, 0.8, 0.55, 16).rotateX(Math.PI / 2);
    const tyreMat = steel('#111114');
    for (const lz of [-S, S]) for (const wx of [-5.6, -4.2, 4.2, 5.6]) {
      const w = new THREE.Mesh(tyre, tyreMat);
      w.position.set(wx, 0.8, lz);
      this.wheels.push(w);
      this.group.add(w);
    }
    const lights: THREE.BufferGeometry[] = [];
    for (const lz of [-S + 0.6, S - 0.6]) for (const lx of [-2.3, 2.3]) lights.push(box(0.6, 0.25, 0.6, lx, H - 1.1, lz));
    this.group.add(new THREE.Mesh(mergeGeometries(lights), lampMat('#fff0c8', 4)));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8).translate(0, H + 3.6, -S + 1.4), blinkMaterial(new THREE.Vector3(1.0, 0.55, 0.05), 1.4));
    this.group.add(beacon);
    const tro = new THREE.Mesh(mergeGeometries([box(5.4, 1.0, 3.2, 0, 0, 0), box(2.0, 2.0, 2.0, 1.9, -1.5, 0)]), steel(upperColor));
    const win = new THREE.Mesh(box(0.1, 0.8, 1.7, 2.92, -1.4, 0), lampMat('#bfe6ff', 2.6));
    this.trolley.add(tro, win);
    const ropeGeo = new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, -0.5, 0);
    const ropeMat = steel('#1a1a1e');
    for (const [rx, rz] of [[-2, -0.7], [2, -0.7], [-2, 0.7], [2, 0.7]]) {
      const r = new THREE.Mesh(ropeGeo, ropeMat);
      r.position.set(rx, -0.5, rz);
      this.ropes.push(r);
      this.trolley.add(r);
    }
    this.spreader = new THREE.Mesh(mergeGeometries([box(CONTAINER.length + 0.3, 0.45, 2.6, 0, 0.22, 0), box(2.6, 0.8, 1.4, 0, 0.85, 0)]), steel('#e8c21a'));
    this.trolley.add(this.spreader);
    this.trolley.position.y = H + 1.4;
    this.group.add(this.trolley);
    this.group.position.set(x0, QUAY, z);
    this.group.scale.setScalar(scale);
  }

  update(time: number, boxes: MovingBoxes): void {
    const t = time + this.phase;
    // Rolls slowly up and down its stretch of the row; the wheels turn with it.
    const gx = this.x0 + Math.sin(t * 0.07) * this.travel;
    const v = Math.cos(t * 0.07) * 0.07 * this.travel;
    this.group.position.x = gx;
    for (const w of this.wheels) w.rotation.z -= (v / (0.8 * this.scale)) * (1 / 60);
    // Restacking: across to one side, down onto the stack, up with a box, across, down, and so on.
    const S = YardCrane.SPAN - 2.6;
    const tz = Math.sin(t * 0.23) * S;
    const lift = 0.5 + 0.5 * Math.sin(t * 0.46 + 1.2);                   // 0 = low over the stack, 1 = hoisted
    const lowY = (2 * CONTAINER.height + CONTAINER.height + 0.6) / this.scale - (YardCrane.H + 1.4); // box bottom two layers up
    const y = THREE.MathUtils.lerp(lowY, -6.2, lift * lift * (3 - 2 * lift));
    this.trolley.position.z = tz;
    this.spreader.position.y = y;
    for (const r of this.ropes) r.scale.y = -0.5 - (y + 1.2);
    const s = this.scale;
    boxes.set(this.slot, gx, QUAY + (YardCrane.H + 1.4 + y) * s - CONTAINER.height, this.z + tz * s, 0, true);
  }
}

// ------------------------------------------------------------------ robot carriers

interface Loop { x0: number; z0: number; x1: number; z1: number }
const LOOP_R = 9;

function loopLength(L: Loop): number {
  return 2 * (L.x1 - L.x0 - 2 * LOOP_R) + 2 * (L.z1 - L.z0 - 2 * LOOP_R) + 2 * Math.PI * LOOP_R;
}

/** Point `s` metres round the rounded rectangle (anticlockwise seen in x→z), with the heading (rad, 0 = +x). */
function loopPoint(L: Loop, s: number, out: { x: number; z: number; h: number }): void {
  const R = LOOP_R, w = L.x1 - L.x0 - 2 * R, d = L.z1 - L.z0 - 2 * R, arc = (Math.PI * R) / 2;
  const P = loopLength(L);
  s = ((s % P) + P) % P;
  const corner = (cx: number, cz: number, a0: number, t: number) => {
    const a = a0 + t / R;
    out.x = cx + R * Math.sin(a); out.z = cz - R * Math.cos(a); out.h = a;
  };
  if (s < w) { out.x = L.x0 + R + s; out.z = L.z0; out.h = 0; return; }
  s -= w;
  if (s < arc) return corner(L.x1 - R, L.z0 + R, 0, s);
  s -= arc;
  if (s < d) { out.x = L.x1; out.z = L.z0 + R + s; out.h = Math.PI / 2; return; }
  s -= d;
  if (s < arc) return corner(L.x1 - R, L.z1 - R, Math.PI / 2, s);
  s -= arc;
  if (s < w) { out.x = L.x1 - R - s; out.z = L.z1; out.h = Math.PI; return; }
  s -= w;
  if (s < arc) return corner(L.x0 + R, L.z1 - R, Math.PI, s);
  s -= arc;
  if (s < d) { out.x = L.x0; out.z = L.z1 - R - s; out.h = Math.PI * 1.5; return; }
  s -= d;
  corner(L.x0 + R, L.z0 + R, Math.PI * 1.5, s);
}

/** Flat driverless carrier, 14 m long along +X: deck, bumpers, eight wheels; lights in a separate mesh. */
function carrierGeometry(): { body: THREE.BufferGeometry; lights: THREE.BufferGeometry } {
  const paint = (g: THREE.BufferGeometry, c: string) => {
    const col = new THREE.Color(c);
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(box(14, 0.55, 3.0, 0, 1.15, 0), '#f2c21a'));                // deck
  parts.push(paint(box(13.2, 0.5, 2.2, 0, 0.75, 0), '#2a2c32'));               // chassis
  for (const ex of [-7, 7]) parts.push(paint(box(0.35, 0.8, 3.1, ex, 0.95, 0), '#1a1a1e')); // bumpers
  for (const sx of [-6.2, 6.2]) parts.push(paint(box(0.5, 0.12, 3.02, sx, 1.44, 0), '#1a1a1e')); // hazard stripes on the deck ends
  for (const wx of [-5.2, -3.6, 3.6, 5.2]) for (const wz of [-1.25, 1.25]) {
    parts.push(paint(new THREE.CylinderGeometry(0.6, 0.6, 0.5, 14).rotateX(Math.PI / 2).translate(wx, 0.6, wz).toNonIndexed(), '#0c0c0e'));
  }
  for (const cx of [-5.5, -1.8, 1.8, 5.5]) for (const cz of [-1.1, 1.1]) parts.push(paint(box(0.5, 0.18, 0.5, cx, 1.5, cz), '#3a3c44')); // twist-lock cones
  parts.push(paint(box(0.12, 1.5, 0.12, 6.6, 2.1, 1.3), '#2a2c32'));           // beacon mast
  for (const g of parts) g.deleteAttribute('uv');
  const lightParts: THREE.BufferGeometry[] = [];
  for (const wz of [-1.0, 1.0]) {
    lightParts.push(paint(box(0.08, 0.2, 0.5, 7.2, 1.0, wz), '#ffffff'));
    lightParts.push(paint(box(0.08, 0.2, 0.5, -7.2, 1.0, wz), '#ff2010'));
  }
  lightParts.push(paint(new THREE.SphereGeometry(0.22, 10, 8).translate(6.6, 2.95, 1.3).toNonIndexed(), '#ff9a10'));
  for (let i = -3; i <= 3; i++) for (const wz of [-1.52, 1.52]) lightParts.push(paint(box(0.5, 0.06, 0.04, i * 1.9, 1.1, wz), '#30e0ff')); // status strip along the sides
  for (const g of lightParts) g.deleteAttribute('uv');
  return { body: mergeGeometries(parts), lights: mergeGeometries(lightParts) };
}

// ------------------------------------------------------------------ conveyors

interface Belt { x0: number; x1: number; z: number; dir: number }
const BELT_Y = 1.45; // belt surface above the quay
const BELT_SPEED = 3.2;
const BELT_GAP = 26; // metres between containers on a belt

function beltMeshes(belts: Belt[]): THREE.Object3D[] {
  const frame: THREE.BufferGeometry[] = [], housing: THREE.BufferGeometry[] = [];
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  belts.forEach((b) => {
    const len = b.x1 - b.x0, cx = (b.x0 + b.x1) / 2;
    frame.push(box(len, 0.3, 3.4, cx, QUAY + BELT_Y - 0.2, b.z));
    for (const sz of [-1.75, 1.75]) frame.push(box(len, 0.55, 0.14, cx, QUAY + BELT_Y + 0.12, b.z + sz));
    for (let x = b.x0 + 2; x < b.x1; x += 7) for (const sz of [-1.5, 1.5]) frame.push(box(0.28, BELT_Y - 0.3, 0.28, x, QUAY + (BELT_Y - 0.3) / 2, b.z + sz));
    // A housing at each end: containers come out of one and vanish into the other.
    for (const hx of [b.x0, b.x1]) {
      housing.push(box(9, 0.4, 5.2, hx, QUAY + 5.1, b.z), box(9, 4.9, 0.4, hx, QUAY + 2.45, b.z - 2.6), box(9, 4.9, 0.4, hx, QUAY + 2.45, b.z + 2.6));
      housing.push(box(0.4, 4.9, 5.2, hx + (hx === b.x0 ? -4.5 : 4.5), QUAY + 2.45, b.z));
    }
    // Belt surface strip: uv.x = metres along the direction of travel, uv.y across.
    const base = pos.length / 3;
    pos.push(b.x0, QUAY + BELT_Y, b.z - 1.55, b.x1, QUAY + BELT_Y, b.z - 1.55, b.x1, QUAY + BELT_Y, b.z + 1.55, b.x0, QUAY + BELT_Y, b.z + 1.55);
    const u0 = b.dir > 0 ? 0 : len, u1 = b.dir > 0 ? len : 0;
    uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  });
  const surface = new THREE.BufferGeometry();
  surface.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  surface.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  surface.setIndex(idx);
  const beltMat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere, uSpeed: { value: BELT_SPEED } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `
      uniform float uSpeed; varying vec2 vUv; varying vec3 vW;
      ${ATMOS_PARS}
      ${MAST_LIGHT_GLSL}
      void main() {
        // Rollers: a row of steel tubes across the belt, each with a highlight; yellow tick marks ride along
        // with the load, so you can see it running.
        float along = vUv.x - uTime * uSpeed;
        float r = fract(vUv.x * 2.0);                                 // one roller every 0.5 m (they stay put)
        float tube = sin(r * 3.14159);
        vec3 col = mix(vec3(0.05, 0.055, 0.06), vec3(0.42, 0.44, 0.48), tube * tube);
        float mark = step(0.82, fract(along * 0.25)) * step(abs(vUv.y - 0.5), 0.42);
        col = mix(col, vec3(0.95, 0.75, 0.1), mark * 0.8);
        float edge = step(0.94, abs(vUv.y - 0.5) * 2.0);
        col = mix(col, vec3(0.9, 0.2, 0.1), edge);
        vec3 n = vec3(0.0, 1.0, 0.0);
        vec3 V = normalize(cameraPosition - vW);
        vec3 lit = col * (vec3(0.14, 0.18, 0.28) + mastLight(vW, n)) + MAST_COLOR * mastSpec(vW, n, V, 30.0) * tube * 0.5;
        gl_FragColor = vec4(applyAtmos(lit, vW), 1.0);
      }`,
  });
  const top = new THREE.Mesh(surface, beltMat);
  top.name = 'belts';
  return [new THREE.Mesh(mergeGeometries(frame), steel('#2c3038')), new THREE.Mesh(mergeGeometries(housing), steel('#4a5868')), top];
}

// ------------------------------------------------------------------ conveyor bridge over the road

const BRIDGE_OUT = 18;   // sea-side tower: metres from the road's centre line, on the crane's side
const BRIDGE_IN = -21;   // yard-side tower
const BRIDGE_CLEAR = 11.5; // roller deck above the road surface (lamp posts are 9 m)
const BRIDGE_SPEED = 3.2;  // m/s along the conveyor
const BRIDGE_PER_LANE = 4; // containers riding on each lane at once
const LANE_Z = 7;          // the two lanes sit side by side along the road, ±7 m

/**
 * A two-lane container bridge over the road. Local frame: x = across the road (+ = the sea side), z = along
 * the road, y = up (world heights). One lane carries containers from the yard out to the ship side, the other
 * brings them in: each box rises up its tower's hoistway, rolls across over the traffic and is lowered at the
 * far tower. There are always boxes on the move, so you see them whenever you pass. A container's long side
 * lies along the road, so it crosses broadside-on.
 */
class ConveyorBridge {
  readonly group = new THREE.Group();
  private readonly deckY: number;
  private readonly v = new THREE.Vector3();
  private readonly pathLen: number;

  constructor(x: number, z: number, dirX: number, dirZ: number, roadY: number, private readonly yaw: number, private readonly phase: number, private readonly slots: number[], scheme: number) {
    this.group.name = 'conveyor-bridge';
    const deckY = (this.deckY = roadY + BRIDGE_CLEAR);
    this.pathLen = 2 * (deckY - (QUAY + 1.5)) + (BRIDGE_OUT - BRIDGE_IN);
    const half = LANE_Z + CONTAINER.length / 2 + 0.6;           // half the deck's width (along the road)
    const frame: THREE.BufferGeometry[] = [], rollers: THREE.BufferGeometry[] = [], lights: THREE.BufferGeometry[] = [];
    const topY = deckY + 7.2;
    for (const tx of [BRIDGE_OUT, BRIDGE_IN]) {
      // Tower: posts round the two hoistways, ties, X-bracing, a head frame with the winch house.
      for (const px of [-2.1, 2.1]) for (const pz of [-half, 0, half]) frame.push(box(0.6, topY - QUAY, 0.6, tx + px, (topY + QUAY) / 2, pz));
      for (let y = QUAY + 6; y < topY; y += 6) for (const pz of [-half, half]) frame.push(box(4.4, 0.35, 0.35, tx, y, pz));
      for (const pz of [-half, half]) for (let y = QUAY + 0.5; y + 6 < topY; y += 6) frame.push(beam(tx - 2.1, y, pz, tx + 2.1, y + 6, pz, 0.22));
      frame.push(box(4.8, 0.6, half * 2 + 0.6, tx, topY, 0), box(3, 1.8, 6, tx, topY + 1.2, 0));
      for (const pz of [-half + 1, half - 1]) lights.push(box(0.5, 0.25, 0.5, tx, topY - 0.45, pz));
      // Static hoist frames at the top of each hoistway.
      for (const pz of [-LANE_Z, LANE_Z]) frame.push(box(3.2, 0.4, CONTAINER.length + 0.4, tx, topY - 1.2, pz));
    }
    // Set-down plinths at the foot of both towers.
    for (const tx of [BRIDGE_OUT, BRIDGE_IN]) frame.push(box(3.4, 1.5, half * 2 - 0.6, tx, QUAY + 0.75, 0));
    // Roller deck: side girders with a truss above, a middle girder between the lanes, rollers across.
    const len = BRIDGE_OUT - BRIDGE_IN, mid = (BRIDGE_OUT + BRIDGE_IN) / 2;
    for (const pz of [-half, 0, half]) {
      frame.push(box(len, 0.7, 0.45, mid, deckY - 0.35, pz));
      if (pz !== 0) {
        frame.push(box(len, 0.35, 0.35, mid, deckY + 3.4, pz));
        for (let bx = BRIDGE_IN + 2.1; bx + 5.4 <= BRIDGE_OUT - 2; bx += 5.4) frame.push(beam(bx, deckY, pz, bx + 2.7, deckY + 3.4, pz, 0.2), beam(bx + 2.7, deckY + 3.4, pz, bx + 5.4, deckY, pz, 0.2));
      }
    }
    for (let bx = BRIDGE_IN + 2.6; bx < BRIDGE_OUT - 2.2; bx += 1.3) for (const pz of [-LANE_Z, LANE_Z]) rollers.push(new THREE.CylinderGeometry(0.16, 0.16, CONTAINER.length + 0.6, 8).rotateX(Math.PI / 2).translate(bx, deckY - 0.16, pz).toNonIndexed());
    for (let bx = BRIDGE_IN + 6; bx < BRIDGE_OUT - 4; bx += 8) for (const pz of [-half, half]) lights.push(box(0.45, 0.2, 0.45, bx, deckY - 0.85, pz));
    const colors = ['#e8b10e', '#d94a2a', '#3a8ac8', '#e9e6dc'];
    this.group.add(new THREE.Mesh(mergeGeometries(frame), steel(colors[scheme % colors.length])));
    this.group.add(new THREE.Mesh(mergeGeometries(rollers), steel('#9aa0aa')));
    this.group.add(new THREE.Mesh(mergeGeometries(lights), lampMat('#ffe2a8', 4)));
    this.group.add(new THREE.Mesh(mergeGeometries([BRIDGE_OUT, BRIDGE_IN].map((tx) => new THREE.SphereGeometry(0.45, 12, 8).translate(tx, topY + 2.4, 0).toNonIndexed())), blinkMaterial()));
    this.group.position.set(x, 0, z);
    this.group.rotation.y = Math.atan2(-dirZ, dirX);
    this.group.updateMatrixWorld(true);
  }

  /** Slots needed: two lanes of BRIDGE_PER_LANE boxes. */
  static get slotCount(): number {
    return BRIDGE_PER_LANE * 2;
  }

  update(time: number, boxes: MovingBoxes): void {
    const ground = QUAY + 1.5, rise = this.deckY - ground, cross = BRIDGE_OUT - BRIDGE_IN, P = this.pathLen;
    for (let lane = 0; lane < 2; lane++) {
      // Lane 0: yard -> ship side; lane 1: ship side -> yard.
      const from = lane === 0 ? BRIDGE_IN : BRIDGE_OUT, to = lane === 0 ? BRIDGE_OUT : BRIDGE_IN;
      const laneZ = lane === 0 ? -LANE_Z : LANE_Z;
      for (let k = 0; k < BRIDGE_PER_LANE; k++) {
        let d = ((time + this.phase) * BRIDGE_SPEED + (k * P) / BRIDGE_PER_LANE + lane * 11) % P;
        if (d < 0) d += P;
        let bx: number, by: number;
        if (d < rise) { bx = from; by = ground + d; }
        else if (d < rise + cross) { bx = from + (to - from) * ((d - rise) / cross); by = this.deckY; }
        else { bx = to; by = this.deckY - (d - rise - cross); }
        this.group.localToWorld(this.v.set(bx, by, laneZ));
        boxes.set(this.slots[lane * BRIDGE_PER_LANE + k], this.v.x, this.v.y, this.v.z, this.yaw, true);
      }
    }
  }
}

// ------------------------------------------------------------------ container ships

const HULL_COLORS = ['#0c1424', '#141418', '#3a0e0e', '#0c2420']; // dark: the floodlights lift them a lot
const FUNNEL_COLORS = ['#e8b10e', '#d94a2a', '#e9e6dc', '#2a7ae0'];

/**
 * A big container ship (290 m, 42 m beam, deck 12 m above the water), bow toward local -Z: a hull with a
 * pointed bow and a red boot-top, the accommodation block with lit window bands and bridge wings near the
 * stern, a funnel, and over a thousand containers stacked in bays along the deck (highest in the middle rows).
 * `loadingBay`: the bay amidships is kept low (the quay crane sets boxes down there).
 */
function containerShip(mat: THREE.ShaderMaterial, scheme: number, rng: Rng, loadingBay: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = 'container-ship';
  const L = SHIP_L, B = SHIP_B, D = SHIP_DECK_Y;
  // Hull: a top-view outline extruded upward, coloured by height (boot-top red under the waterline).
  const sh = new THREE.Shape();
  sh.moveTo(-B / 2 + 4, -L / 2);
  sh.lineTo(B / 2 - 4, -L / 2);
  sh.quadraticCurveTo(B / 2, -L / 2, B / 2, -L / 2 + 8);
  sh.lineTo(B / 2, L / 2 - 70);
  sh.bezierCurveTo(B / 2, L / 2 - 30, B / 4, L / 2 - 6, 0, L / 2);
  sh.bezierCurveTo(-B / 4, L / 2 - 6, -B / 2, L / 2 - 30, -B / 2, L / 2 - 70);
  sh.lineTo(-B / 2, -L / 2 + 8);
  sh.quadraticCurveTo(-B / 2, -L / 2, -B / 2 + 4, -L / 2);
  const hullGeo = new THREE.ExtrudeGeometry(sh, { depth: D + 8, bevelEnabled: false, curveSegments: 12 }).rotateX(-Math.PI / 2).translate(0, -8, 0).toNonIndexed();
  hullGeo.computeVertexNormals();
  const hp = hullGeo.getAttribute('position'), hn = hullGeo.getAttribute('normal');
  const col = new Float32Array(hp.count * 3);
  const hullC = new THREE.Color(HULL_COLORS[scheme % HULL_COLORS.length]), red = new THREE.Color('#a8261c'), deckC = new THREE.Color('#3a4a3a'), white = new THREE.Color('#e9e6dc');
  for (let i = 0; i < hp.count; i++) {
    const y = hp.getY(i);
    const c = hn.getY(i) > 0.9 ? deckC : y < 1.2 ? red : y > D - 1.4 ? white : hullC;
    col.set([c.r, c.g, c.b], i * 3);
  }
  hullGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  hullGeo.deleteAttribute('uv');
  g.add(new THREE.Mesh(hullGeo, steelVertexColors()));
  // Accommodation block near the stern (+Z is the stern: the bow points to -Z after the extrude), bridge wings,
  // window bands, a funnel behind it, a mast on the bow.
  // (The outline's pointed end, +y, became world -z when the extrusion was stood up: the bow.)
  const sternZ = L / 2 - 36;
  const white2 = steel('#e9e6dc');
  g.add(new THREE.Mesh(mergeGeometries([
    box(32, 30, 16, 0, D + 15, sternZ),
    box(B + 4, 2.6, 7, 0, D + 29, sternZ - 4.5),
    box(10, 4, 10, 0, D + 32, sternZ),
  ]), white2));
  const windows: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) windows.push(box(30, 1.2, 0.2, 0, D + 4 + k * 3.6, sternZ - 8.05));
  windows.push(box(B + 3, 1.1, 0.2, 0, D + 29.4, sternZ - 8.05));
  g.add(new THREE.Mesh(mergeGeometries(windows), lampMat('#ffd9a0', 2.4)));
  g.add(new THREE.Mesh(box(9, 13, 12, 0, D + 36, sternZ + 14), steel(FUNNEL_COLORS[scheme % FUNNEL_COLORS.length])));
  g.add(new THREE.Mesh(mergeGeometries([box(0.8, 16, 0.8, 0, D + 8, -L / 2 + 14), box(6, 0.5, 0.5, 0, D + 14, -L / 2 + 14)]), steel('#d8d8d8')));
  g.add(new THREE.Mesh(mergeGeometries([new THREE.SphereGeometry(0.6, 10, 8).translate(0, D + 16.6, -L / 2 + 14).toNonIndexed(), new THREE.SphereGeometry(0.6, 10, 8).translate(0, D + 43, sternZ + 14).toNonIndexed()]), blinkMaterial(new THREE.Vector3(1, 1, 1), 0.5)));
  // Containers: bays 13 m apart from the bow to the accommodation, 15 rows across, stacked 3-7 high.
  const list: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2); // long side along the ship
  const one = new THREE.Vector3(1, 1, 1);
  const rows = 15, pitch = 2.6;
  for (let bz = -L / 2 + 32; bz < sternZ - 16; bz += 13) {
    const nearBow = bz < -L / 2 + 60;
    for (let r = 0; r < rows; r++) {
      const across = (r - (rows - 1) / 2) * pitch;
      if (nearBow && Math.abs(across) > B / 2 - 6 - (L / 2 - 60 + bz) * -0.15) continue; // the bow narrows
      const centre = 1 - Math.abs(across) / (B / 2);
      let tiers = Math.round(3 + 4 * centre + rng.range(-1.2, 0.8));
      if (loadingBay && Math.abs(bz) < 7) tiers = LOAD_TIERS;
      for (let t = 0; t < tiers; t++) list.push(new THREE.Matrix4().compose(new THREE.Vector3(across, D + t * 2.65, bz), q, one));
    }
  }
  const boxes = containerMesh(list.length, mat);
  list.forEach((m, i) => boxes.setMatrixAt(i, m));
  boxes.count = list.length;
  boxes.computeBoundingSphere();
  g.add(boxes);
  return g;
}

// ------------------------------------------------------------------ service lanes beside the road

interface Lane { d0: number; d1: number; lat: number }
const LANE_SPEED = 21; // m/s: slower than the race, so you overtake the carriers

/** The lane itself: a deck hung on the side of the road, kerbs, props down to the quay, a portal at each end. */
function laneMeshes(track: LoopTrack, lanes: Lane[]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const deck = steel('#3c4048'), kerb = steel('#e8b10e'), portalMat = steel('#4a5868');
  const f = makeFrame();
  const props: THREE.BufferGeometry[] = [], portals: THREE.BufferGeometry[] = [], lights: THREE.BufferGeometry[] = [];
  for (const L of lanes) {
    const range = { d0: L.d0, d1: L.d1, step: 2, closedProfile: true };
    out.push(new THREE.Mesh(extrude(track, rectProfile(L.lat, -0.4, 5.6, 0.5), range), deck));
    const sd = Math.sign(L.lat);
    out.push(new THREE.Mesh(extrude(track, rectProfile(L.lat + sd * 2.65, 0.05, 0.3, 0.5), range), kerb));
    const place = (g: THREE.BufferGeometry, d: number, lat: number, y: number) => {
      track.frameAt(d, f);
      g.rotateY(Math.atan2(-f.forward.z, f.forward.x));
      g.translate(f.position.x + f.right.x * lat, f.position.y + y, f.position.z + f.right.z * lat);
      return g.toNonIndexed();
    };
    for (let d = L.d0 + 10; d < L.d1; d += 24) {
      track.frameAt(d, f);
      const h = f.position.y - 0.65 - QUAY;
      props.push(place(new THREE.BoxGeometry(0.7, h, 0.7), d, L.lat + sd * 1.6, -0.65 - h / 2));
    }
    for (const d of [L.d0, L.d1]) {
      // Portal: a hooded gate the carriers come out of / drive into.
      portals.push(place(new THREE.BoxGeometry(9, 0.5, 6.4), d, L.lat, 4.6), place(new THREE.BoxGeometry(9, 4.6, 0.4), d, L.lat + 3, 2.2), place(new THREE.BoxGeometry(9, 4.6, 0.4), d, L.lat - 3, 2.2));
      portals.push(place(new THREE.BoxGeometry(0.4, 4.6, 6.4), d + (d === L.d0 ? -4.5 : 4.5), L.lat, 2.2));
      lights.push(place(new THREE.BoxGeometry(0.3, 0.3, 5.6), d + (d === L.d0 ? 4.4 : -4.4), L.lat, 4.2));
    }
  }
  if (props.length) out.push(new THREE.Mesh(mergeGeometries(props), deck));
  if (portals.length) out.push(new THREE.Mesh(mergeGeometries(portals), portalMat));
  if (lights.length) out.push(new THREE.Mesh(mergeGeometries(lights), lampMat('#30e0ff', 3)));
  return out;
}

// ------------------------------------------------------------------ floodlight masts

function mastMeshes(points: { x: number; z: number }[]): THREE.Object3D[] {
  const H = MAST_GRID.height;
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(0.22, 0.42, H, 12).translate(0, H / 2, 0).toNonIndexed(),
    new THREE.CylinderGeometry(1.5, 1.5, 0.25, 20).translate(0, H + 0.2, 0).toNonIndexed(),
    new THREE.CylinderGeometry(0.7, 0.9, 0.9, 12).translate(0, 0.45, 0).toNonIndexed(),
  ]);
  const lamps: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    lamps.push(new THREE.BoxGeometry(0.7, 0.3, 0.45).rotateY(-a).translate(Math.cos(a) * 1.25, H - 0.05, Math.sin(a) * 1.25).toNonIndexed());
  }
  const place = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, points.length));
    const m = new THREE.Matrix4();
    points.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, QUAY, p.z)));
    mesh.count = points.length;
    mesh.computeBoundingSphere();
    return mesh;
  };
  return [place(pole, applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#50545c', roughness: 0.6, metalness: 0.5 }))), place(mergeGeometries(lamps), lampMat('#ffd9a0', 5))];
}

// ------------------------------------------------------------------ the yard

export interface HarborYard {
  group: THREE.Group;
  update(time: number): void;
  /** Roadside stretches taken by cranes, conveyor bridges and service lanes (no billboards there). */
  noBoards: { d0: number; d1: number; side: number }[];
  /** Ships to draw (the caller owns the ship model): docked under the quay cranes, plus a few at anchor. */
  ships: { x: number; y: number; z: number; yaw: number }[];
}

export function buildHarborYard(track: LoopTrack, rng: Rng, quality: 'low' | 'medium' | 'high'): HarborYard {
  const group = new THREE.Group();
  group.name = 'harbor-yard';
  const samples = track.samples;
  const nearest = (x: number, z: number) => {
    let b = Infinity;
    for (let k = 0; k < samples.length; k += 4) b = Math.min(b, Math.hypot(samples[k].x - x, samples[k].z - z));
    return b;
  };
  /** On the quay inside the loop, at least `clear` metres from the road above. */
  const free = (x: number, z: number, clear: number) => insideTrack(track, x, z) && nearest(x, z) >= clear;

  // Container rows run along x: one row every ROW metres in z, a box every COL metres along it.
  const ROW = 34, COL = 16, Z0 = -50, X0 = -200, X1 = 1150, ROWS = 14;
  const rowZ = (k: number) => Z0 + k * ROW;
  // Between two rows: the conveyor line (12 m past the row) and the carriers' lane (24 m past it).
  const beltZ = (k: number) => rowZ(k) + 12, laneZ = (k: number) => rowZ(k) + 24;

  // --- Carrier loops: rectangles of lanes; containers are kept out of their cross aisles.
  const loops: Loop[] = [];
  for (let tries = 0; tries < 400 && loops.length < (quality === 'low' ? 2 : 4); tries++) {
    const k0 = rng.int(0, ROWS - 3), k1 = k0 + rng.int(1, 3);
    // Cross aisles lie between two container columns; every sixth of those gaps has a floodlight mast in it.
    const mastGap = Math.round(MAST_GRID.cellX / COL);
    let n0 = rng.int(2, 70), n1 = n0 + rng.int(9, 22);
    if (n0 % mastGap === 0) n0++;
    if (n1 % mastGap === 0) n1++;
    const x0 = X0 + n0 * COL + COL / 2, x1 = X0 + n1 * COL + COL / 2;
    const L: Loop = { x0, z0: laneZ(k0), x1, z1: laneZ(k1) };
    if (loops.some((o) => !(L.x1 < o.x0 - 30 || L.x0 > o.x1 + 30 || L.z1 < o.z0 - 20 || L.z0 > o.z1 + 20))) continue;
    let ok = true;
    const P = loopLength(L), pt = { x: 0, z: 0, h: 0 };
    for (let s = 0; s < P && ok; s += 6) { loopPoint(L, s, pt); ok = free(pt.x, pt.z, 24); }
    if (ok) loops.push(L);
  }
  const inAisle = (x: number, z: number, pad: number) => loops.some((L) => z > L.z0 - 6 && z < L.z1 + 6 && (Math.abs(x - L.x0) < pad || Math.abs(x - L.x1) < pad));

  // --- Conveyor belts: the longest clear run in every third gap between rows.
  const belts: Belt[] = [];
  for (let k = 1; k < ROWS - 1; k += 3) {
    const z = beltZ(k);
    let best: [number, number] | null = null, start: number | null = null;
    for (let x = X0; x <= X1 + 4; x += 4) {
      const ok = x <= X1 && free(x, z, 30) && free(x, z - 3, 26) && free(x, z + 3, 26) && !inAisle(x, z, 9);
      if (ok && start === null) start = x;
      if (!ok && start !== null) {
        if (!best || x - 4 - start > best[1] - best[0]) best = [start, x - 4];
        start = null;
      }
    }
    if (best && best[1] - best[0] >= 90) {
      const len = Math.min(280, best[1] - best[0] - 16);
      const mid = (best[0] + best[1]) / 2;
      belts.push({ x0: mid - len / 2, x1: mid + len / 2, z, dir: belts.length % 2 ? -1 : 1 });
    }
  }

  // --- Static containers: stacks along the rows (not in the carriers' cross aisles).
  const stacks: BoxPlacement[] = [];
  for (let k = 0; k < ROWS; k++) {
    const gz = rowZ(k);
    for (let gx = X0; gx < X1; gx += COL) {
      if (!free(gx, gz, 24) || inAisle(gx, gz, 11) || rng.chance(0.22)) continue;
      const n = rng.int(1, 4);
      for (let i = 0; i < n; i++) stacks.push({ x: gx, y: QUAY + i * 2.65, z: gz, yaw: 0 });
      const double = rng.chance(0.5);
      if (double) for (let i = 0; i < n; i++) stacks.push({ x: gx, y: QUAY + i * 2.65, z: gz + 2.6, yaw: 0 });
    }
  }

  // --- Yard cranes over the rows: where a row has a long run of stacks, clear of the cross aisles.
  const yardSpots: { x: number; z: number; travel: number }[] = [];
  for (let k = 0; k < ROWS && yardSpots.length < (quality === 'low' ? 3 : 6); k += 2) {
    const gz = rowZ(k) + 1.3;
    const cands: number[] = [];
    for (let gx = X0 + 40; gx < X1 - 40; gx += COL) {
      let ok = true;
      for (let dx = -36; dx <= 36 && ok; dx += 12) ok = free(gx + dx, gz - 8, 26) && free(gx + dx, gz + 8, 26) && !inAisle(gx + dx, gz, 16);
      if (ok && !belts.some((b) => Math.abs(b.z - gz) < 12 && gx > b.x0 - 40 && gx < b.x1 + 40)) cands.push(gx);
    }
    if (cands.length) yardSpots.push({ x: cands[rng.int(0, cands.length - 1)], z: gz, travel: 20 });
  }

  // --- Quay cranes: a handful on the waterfront, well apart, in three sizes, each with a ship under its boom.
  const frame = makeFrame();
  const quaySpots: { x: number; z: number; yaw: number; scale: number; d: number; side: number }[] = [];
  const ships: HarborYard['ships'] = [];
  const maxQuay = quality === 'low' ? 4 : 7;
  let lastD = -1e9;
  for (let d = 40; d < track.length && quaySpots.length < maxQuay; d += 35) {
    if (d - lastD < 330) continue;
    track.frameAt(d, frame);
    for (const side of [-1, 1]) {
      const at = (lat: number) => [frame.position.x + frame.right.x * side * lat, frame.position.z + frame.right.z * side * lat] as const;
      // Needs quay under it (the quay edge is 45 m from the road; the crane's legs reach 8 m either way) and
      // open water beyond. Its backreach then hangs over the road, well above it.
      const [cx, cz] = at(QUAY_CRANE_LAT);
      if (insideTrack(track, cx, cz) || nearest(cx, cz) < QUAY_CRANE_LAT - 4) continue;
      let water = true;
      for (const lat of [70, 95, 120, 150]) { const [wx, wz] = at(lat); if (insideTrack(track, wx, wz) || nearest(wx, wz) < 58) water = false; }
      if (!water) continue;
      // Big cranes for big ships: the trolley has to clear seven tiers of containers on a 12 m deck.
      const scale = [1.1, 1.25, 1.4][quaySpots.length % 3];
      const yaw = Math.atan2(frame.right.x * side, frame.right.z * side); // the boom (+Z) points out over the water
      quaySpots.push({ x: cx, z: cz, yaw, scale, d, side });
      // The ship lies alongside, its near side just past the crane's sea-side legs, its length along the quay.
      const [sx, sz] = at(QUAY_CRANE_LAT + 7 * scale + 6 + SHIP_B / 2);
      ships.push({ x: sx, y: 0, z: sz, yaw: yaw + Math.PI / 2 });
      lastD = d;
      break;
    }
  }
  // Two more ships lying at anchor further out.
  for (let i = 0; i < 2; i++) {
    track.frameAt(rng.range(0, track.length), frame);
    for (const side of [-1, 1]) {
      const x = frame.position.x + frame.right.x * side * 330, z = frame.position.z + frame.right.z * side * 330;
      if (!insideTrack(track, x, z) && nearest(x, z) > 250) { ships.push({ x, y: 0, z, yaw: rng.range(0, Math.PI) }); break; }
    }
  }

  // --- Floodlight masts on every grid point that stands on the quay (not under the road).
  const masts: { x: number; z: number }[] = [];
  for (let gx = MAST_GRID.originX - MAST_GRID.cellX * 2; gx < X1 + 200; gx += MAST_GRID.cellX) {
    for (let gz = MAST_GRID.originZ - MAST_GRID.cellZ * 3; gz < 620; gz += MAST_GRID.cellZ) {
      const d = nearest(gx, gz);
      if (d < 15 || !(insideTrack(track, gx, gz) || d < 44)) continue;
      if (quaySpots.some((q) => Math.hypot(q.x - gx, q.z - gz) < 16)) continue; // not between a crane's legs
      masts.push({ x: gx, z: gz });
    }
  }

  // --- Build it.
  const mat = containerMaterial();
  // The ships themselves (docked ones get a low loading bay amidships, under their crane).
  ships.forEach((sp, i) => {
    const ship = containerShip(mat, i, rng, i < quaySpots.length);
    ship.position.set(sp.x, 0, sp.z);
    ship.rotation.y = sp.yaw;
    group.add(ship);
  });
  const staticBoxes = containerMesh(stacks.length, mat);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  stacks.forEach((p, i) => {
    q4.setFromAxisAngle(up, p.yaw);
    staticBoxes.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, p.y, p.z), q4, one));
  });
  staticBoxes.count = stacks.length;
  staticBoxes.computeBoundingSphere();
  group.add(staticBoxes);
  for (const o of mastMeshes(masts)) group.add(o);
  if (belts.length) for (const o of beltMeshes(belts)) group.add(o);

  // Conveyor bridges over the road at every other quay crane (clear of the tunnel / canopy).
  const bridged = quaySpots.map((q) => !track.sectionAt(q.d, 25));
  // Service lanes on the yard side of the road: three stretches of 380 m, away from roofs.
  const lanes: Lane[] = [];
  for (let k = 0; k < 3; k++) {
    for (let tries = 0; tries < 12; tries++) {
      const d0 = ((k + 0.15) * track.length) / 3 + tries * 45, d1 = d0 + 380;
      let ok = d1 < track.length - 20;
      for (let d = d0 - 30; d <= d1 + 30 && ok; d += 20) ok = !track.sectionAt(d, 10);
      if (!ok) continue;
      track.frameAt((d0 + d1) / 2, frame);
      const inner = insideTrack(track, frame.position.x + frame.right.x * 40, frame.position.z + frame.right.z * 40) ? 1 : -1;
      lanes.push({ d0, d1, lat: inner * (track.width / 2 + 6.2) });
      break;
    }
  }
  const laneCarriers: { lane: Lane; offset: number; box: number }[] = [];
  for (const L of lanes) for (let o = 0; o < L.d1 - L.d0; o += 76) laneCarriers.push({ lane: L, offset: o, box: -1 });

  // Carriers: one every ~75 m of loop.
  const carriers: { loop: Loop; s0: number; box: number; loaded: boolean }[] = [];
  const beltLoads: { belt: Belt; offset: number; box: number }[] = [];
  let slots = quaySpots.length + yardSpots.length;
  for (const L of loops) {
    const n = Math.max(2, Math.round(loopLength(L) / 75));
    for (let i = 0; i < n; i++) carriers.push({ loop: L, s0: (i / n) * loopLength(L) + rng.range(-8, 8), box: -1, loaded: rng.chance(0.7) });
  }
  for (const b of belts) for (let o = 0; o < b.x1 - b.x0; o += BELT_GAP) beltLoads.push({ belt: b, offset: o, box: -1 });
  slots += carriers.length + beltLoads.length + laneCarriers.length + bridged.filter(Boolean).length * ConveyorBridge.slotCount;
  const boxes = new MovingBoxes(slots, mat);
  group.add(boxes.mesh);
  const quayCranes = quaySpots.map((q, i) => new QuayCrane(q.x, q.z, q.yaw, q.scale, i, i * 7.3, boxes.alloc(), (7 * q.scale + 6 + SHIP_B / 2) / q.scale,
    SHIP_DECK_Y + LOAD_TIERS * 2.65 - QUAY, bridged[i] ? -(QUAY_CRANE_LAT - BRIDGE_OUT) / q.scale : 9));
  const bridges: ConveyorBridge[] = [];
  quaySpots.forEach((q, i) => {
    if (!bridged[i]) return;
    track.frameAt(q.d, frame);
    const b = new ConveyorBridge(frame.position.x, frame.position.z, frame.right.x * q.side, frame.right.z * q.side, frame.position.y, q.yaw, i * 7.3, Array.from({ length: ConveyorBridge.slotCount }, () => boxes.alloc()), i);
    bridges.push(b);
    group.add(b.group);
  });
  for (const o of laneMeshes(track, lanes)) group.add(o);
  for (const c of laneCarriers) c.box = boxes.alloc();
  const yardCranes = yardSpots.map((y, i) => new YardCrane(y.x, y.z, y.travel, [1, 0.88, 1.15][i % 3], i + 1, i * 11.7, boxes.alloc()));
  for (const c of [...quayCranes, ...yardCranes]) group.add(c.group);
  for (const c of carriers) c.box = boxes.alloc();
  for (const b of beltLoads) b.box = boxes.alloc();
  const cg = carrierGeometry();
  const carrierCount = carriers.length + laneCarriers.length;
  const carrierBody = new THREE.InstancedMesh(cg.body, steelVertexColors(), Math.max(1, carrierCount));
  const carrierLights = new THREE.InstancedMesh(cg.lights, applyAtmosphere(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(3.2, 3.2, 3.2) })), Math.max(1, carrierCount));
  carrierBody.name = 'carriers';
  for (const mesh of [carrierBody, carrierLights]) {
    mesh.count = carrierCount;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
  }

  const pt = { x: 0, z: 0, h: 0 };
  const pos = new THREE.Vector3();
  const update = (time: number) => {
    for (const c of quayCranes) c.update(time, boxes);
    for (const c of yardCranes) c.update(time, boxes);
    for (const b of bridges) b.update(time, boxes);
    // Carriers on the service lanes: along the road, at lane level, each with a container.
    laneCarriers.forEach((c, i) => {
      const len = c.lane.d1 - c.lane.d0;
      const d = c.lane.d0 + ((((c.offset + time * LANE_SPEED) % len) + len) % len);
      track.frameAt(d, frame);
      const x = frame.position.x + frame.right.x * c.lane.lat, z = frame.position.z + frame.right.z * c.lane.lat, y = frame.position.y - 0.15;
      const h = Math.atan2(frame.forward.z, frame.forward.x);
      q4.setFromAxisAngle(up, -h);
      m4.compose(pos.set(x, y, z), q4, one);
      carrierBody.setMatrixAt(carriers.length + i, m4);
      carrierLights.setMatrixAt(carriers.length + i, m4);
      boxes.set(c.box, x, y + 1.45, z, -h, true);
    });
    carriers.forEach((c, i) => {
      loopPoint(c.loop, c.s0 + time * 6.5, pt);
      q4.setFromAxisAngle(up, -pt.h);
      m4.compose(pos.set(pt.x, QUAY, pt.z), q4, one);
      carrierBody.setMatrixAt(i, m4);
      carrierLights.setMatrixAt(i, m4);
      boxes.set(c.box, pt.x, QUAY + 1.45, pt.z, -pt.h, c.loaded);
    });
    carrierBody.instanceMatrix.needsUpdate = true;
    carrierLights.instanceMatrix.needsUpdate = true;
    for (const b of beltLoads) {
      const len = b.belt.x1 - b.belt.x0;
      const along = (((b.offset + time * BELT_SPEED) % len) + len) % len;
      const x = b.belt.dir > 0 ? b.belt.x0 + along : b.belt.x1 - along;
      boxes.set(b.box, x, QUAY + BELT_Y, b.belt.z, 0, true);
    }
    boxes.commit();
  };
  update(0);
  // A quay crane's backreach and a bridge reach right across the road: nothing else within 45 m either side.
  // A service lane takes its own side of the road for its whole length.
  const noBoards = [
    ...quaySpots.map((q) => ({ d0: q.d - 45, d1: q.d + 45, side: 0 })),
    ...lanes.map((L) => ({ d0: L.d0 - 22, d1: L.d1 + 22, side: Math.sign(L.lat) })),
  ];
  return { group, update, ships: [], noBoards };
}

/** Vertex-coloured painted steel (the carriers), lit by the masts like the rest. */
function steelVertexColors(): THREE.MeshStandardMaterial {
  const m = steel('#ffffff');
  m.vertexColors = true;
  m.customProgramCacheKey = () => 'harbor-steel-vc';
  return m;
}
