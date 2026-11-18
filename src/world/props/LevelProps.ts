import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyAtmosphere, ATMOS_PARS, atmosphere, NOISE_GLSL } from '../../render/atmosphere';
import { instanced, Placement } from './BeachProps';

export type { Placement };

const std = (color: string, opts: THREE.MeshStandardMaterialParameters = {}) =>
  applyAtmosphere(new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));

/** Generic per-instance lit shader with optional custom colour code. */
function propShader(frag: string, opts: { vertex?: string; uniforms?: Record<string, THREE.IUniform>; side?: THREE.Side; transparent?: boolean } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    uniforms: { ...atmosphere, ...(opts.uniforms ?? {}) },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      varying vec3 vColor; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNormalW; varying vec2 vUv;
      uniform float uTime, uBeatPulse, uBeatHit;
      void main() {
        vColor = aColor; vLocal = position; vUv = uv;
        vec3 p = position;
        vec3 inst = instanceMatrix[3].xyz;
        float phase = inst.x * 0.37 + inst.z * 0.21;
        ${opts.vertex ?? ''}
        mat4 m = modelMatrix * instanceMatrix;
        vec4 w = m * vec4(p, 1.0);
        vWorld = w.xyz;
        vNormalW = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNormalW; varying vec2 vUv;
      ${ATMOS_PARS}
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vNormalW);
        if (!gl_FrontFacing) n = -n;
        float diff = max(dot(n, normalize(uMoonDir)), 0.0);
        vec3 col = vColor;
        vec3 emissive = vec3(0.0);
        ${frag}
        vec3 lit = col * (0.35 + 0.8 * diff) + emissive;
        gl_FragColor = vec4(applyAtmos(lit, vWorld), 1.0);
      }`,
  });
}

function withColors(geo: THREE.BufferGeometry, colors: THREE.Color[], n: number): THREE.BufferGeometry {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = colors[i % colors.length];
    a.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(a, 3));
  return geo;
}

function scaledInstances(geo: THREE.BufferGeometry, mat: THREE.Material, list: { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number }[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((p, i) => {
    q.setFromAxisAngle(up, p.yaw);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx, p.sy, p.sz));
    mesh.setMatrixAt(i, m);
  });
  mesh.count = list.length;
  mesh.computeBoundingSphere();
  return mesh;
}

// ------------------------------------------------------------------ desert

/** Flat-topped mesas: terraced ledges, vertical gullies and a talus foot; layered strata in the shader. */
/** Mesa outline: how far the wall is pushed out (x 1 = the plain cone) at angle a (rad) and height y (0 foot .. 1 top). */
function mesaBulge(a: number, y: number): number {
  const sm = (lo: number, hi: number, x: number) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
  // Silhouette lobes.
  let k = 1 + Math.sin(a * 3 + y * 2) * 0.08 + Math.sin(a * 7 + 1.3) * 0.04 + Math.sin(a * 13 - y * 3) * 0.02;
  // Terraces: harder layers stick out as ledges.
  const s = y * 7 + Math.sin(a * 2 + 0.7) * 0.4;
  const t = s - Math.floor(s);
  k += 0.035 * sm(0.6, 0.92, t) - 0.02 * sm(0.92, 1.0, t);
  // Vertical gullies cut by run-off, wandering a little with height.
  k -= 0.06 * Math.pow(Math.max(0, Math.sin(a * 11 + Math.sin(y * 5 + a) * 0.7)), 6) * sm(0.05, 0.3, y);
  k -= 0.03 * Math.pow(Math.max(0, Math.sin(a * 23 + 2.1 + y * 1.5)), 8);
  // Talus slope at the foot.
  k += 0.16 * Math.pow(1 - sm(0.0, 0.28, y), 2);
  return k;
}

/**
 * Distance from a mesa's centre to the edge of its flat top, in the world direction (dx, dz) (unit vector).
 * For things that sit on the rim.
 */
export function mesaTopRadius(m: { r: number; yaw: number }, dx: number, dz: number): number {
  // World direction -> the mesa's own frame (it is rotated by yaw about Y).
  const lx = dx * Math.cos(m.yaw) - dz * Math.sin(m.yaw), lz = dx * Math.sin(m.yaw) + dz * Math.cos(m.yaw);
  return 0.42 * 2 * m.r * mesaBulge(Math.atan2(lz, lx), 1);
}

export function createMesas(list: { x: number; y: number; z: number; r: number; h: number; yaw: number }[]): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(0.42, 0.5, 1, 96, 48).translate(0, 0.5, 0);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = mesaBulge(Math.atan2(z, x), y);
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  withColors(geo, [new THREE.Color('#b8502e'), new THREE.Color('#a8442a'), new THREE.Color('#c86a3a')], list.length);
  const mat = propShader(/* glsl */ `
    float px = max(length(fwidth(vWorld)), 1e-4);
    #define LAYER(f) (1.0 - smoothstep(0.25, 0.9, (f) * px))
    // Strata: bands of different rock, each with its own tint, at three scales.
    float yb = vWorld.y + vnoise(vWorld.xz * 0.05) * 3.0;
    float band = floor(yb * 0.45);
    vec3 tint = mix(vec3(0.82, 0.62, 0.55), vec3(1.15, 0.95, 0.8), hash11(band * 7.13));
    col *= tint;
    float strata = sin(yb * 0.9) * 0.5 + 0.5;
    col = mix(col * 0.78, col * 1.1, strata);
    col *= 1.0 + 0.12 * (sin(yb * 4.3 + vnoise(vWorld.xz * 0.4) * 2.0)) * LAYER(4.3);
    col *= 1.0 + 0.08 * (sin(yb * 17.0 + vnoise(vWorld.xz * 2.0) * 2.0)) * LAYER(17.0);
    // Grain, pitting and desert-varnish streaks running down the walls.
    col *= 1.0 + 0.14 * (vnoise(vWorld.xz * 1.3 + vWorld.y * 0.7) - 0.5) * LAYER(1.3);
    col *= 1.0 + 0.12 * (vnoise(vec2(vWorld.x + vWorld.z, vWorld.y) * 6.0) - 0.5) * LAYER(6.0);
    float ang = atan(vLocal.z, vLocal.x);
    float varnish = smoothstep(0.55, 0.85, vnoise(vec2(ang * 18.0, vWorld.y * 0.04))) * smoothstep(0.85, 0.3, vLocal.y);
    col = mix(col, col * vec3(0.45, 0.32, 0.3), varnish * 0.55);
    // Overhangs darker, ledges and the flat top dusted with sand.
    col *= 0.75 + 0.25 * smoothstep(-0.4, 0.2, n.y);
    col = mix(col, vec3(0.92, 0.62, 0.42), smoothstep(0.55, 0.9, n.y) * 0.55);
    // Warm rim from the low sun behind.
    vec3 V = normalize(cameraPosition - vWorld);
    emissive = vec3(1.0, 0.55, 0.3) * pow(clamp(1.0 - dot(n, V), 0.0, 1.0), 4.0) * pow(max(dot(-V, normalize(uMoonDir)), 0.0), 3.0) * 0.25;
  `);
  return scaledInstances(geo, mat, list.map((m) => ({ x: m.x, y: m.y, z: m.z, sx: m.r * 2, sy: m.h, sz: m.r * 2, yaw: m.yaw })));
}

// Cacti: real ribbed geometry (grooves pushed in along the normal), a per-vertex attribute aPart
// (x = groove depth 0..1, y = flower / fruit) and a waxy shader: hard low sun, warm ground bounce,
// a glossy highlight on the ridges and a backlit rim, like the space level's rocks.

/** Push grooves into a surface whose uv `axis` runs around it (0..1); returns it non-indexed with aPart. */
function ribbed(geo: THREE.BufferGeometry, ribs: number, depth: number, axis: 'u' | 'v'): THREE.BufferGeometry {
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
  const part = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const a = axis === 'u' ? uv.getX(i) : uv.getY(i);
    const g = Math.pow(0.5 - 0.5 * Math.cos(a * Math.PI * 2 * ribs), 1.4);
    pos.setXYZ(i, pos.getX(i) - nor.getX(i) * depth * g, pos.getY(i) - nor.getY(i) * depth * g, pos.getZ(i) - nor.getZ(i) * depth * g);
    part[i * 2] = g;
  }
  geo.setAttribute('aPart', new THREE.BufferAttribute(part, 2));
  geo.computeVertexNormals();
  geo.deleteAttribute('uv');
  return geo.index ? geo.toNonIndexed() : geo;
}

/** Plain part (no grooves): pads, fruit, flowers. */
function smoothPart(geo: THREE.BufferGeometry, flower = 0): THREE.BufferGeometry {
  const n = geo.getAttribute('position').count;
  const part = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) part[i * 2 + 1] = flower;
  geo.setAttribute('aPart', new THREE.BufferAttribute(part, 2));
  geo.deleteAttribute('uv');
  return geo.index ? geo.toNonIndexed() : geo;
}

const RIBS = 11;
const RSEG = RIBS * 3;

/** Ribbed column from y0 to y1 with a domed top. */
function column(x: number, z: number, y0: number, y1: number, r: number): THREE.BufferGeometry[] {
  const h = y1 - y0;
  return [
    ribbed(new THREE.CylinderGeometry(r, r * 1.08, h, RSEG, Math.max(2, Math.round(h * 1.5)), true).translate(x, y0 + h / 2, z), RIBS, r * 0.16, 'u'),
    ribbed(new THREE.SphereGeometry(r, RSEG, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, y1, z), RIBS, r * 0.16, 'u'),
  ];
}

/** Saguaro arm: elbow out of the trunk at height h, bending up to a domed tip. */
function arm(h: number, out: number, up: number, r: number, yaw: number): THREE.BufferGeometry[] {
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, h, 0), new THREE.Vector3(out, h - 0.2, 0), new THREE.Vector3(out, h + 0.9, 0));
  const parts = [ribbed(new THREE.TubeGeometry(curve, 10, r, RSEG, false), RIBS, r * 0.16, 'v'), ...column(out, 0, h + 0.88, h + 0.9 + up, r)];
  for (const g of parts) g.rotateY(yaw);
  return parts;
}

function saguaro(height: number, arms: [number, number, number, number][]): THREE.BufferGeometry {
  const parts = column(0, 0, -0.5, height, 0.38);
  for (const [h, out, up, yaw] of arms) parts.push(...arm(h, out, up, 0.26, yaw));
  return mergeGeometries(parts);
}

const DESERT_LIGHT = () => ({
  uSky: { value: new THREE.Color('#7a5aa8') },
  uBounce: { value: new THREE.Color('#c87a4a') },
  uSun: { value: new THREE.Color('#ffc890') },
});

const PROP_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  #ifdef PARTS
  attribute vec2 aPart;
  #endif
  varying vec3 vColor; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vN; varying vec2 vPart; varying vec3 vInst;
  void main() {
    vColor = aColor; vLocal = position;
    #ifdef PARTS
    vPart = aPart;
    #else
    vPart = vec2(0.0);
    #endif
    vInst = instanceMatrix[3].xyz;
    mat4 m = modelMatrix * instanceMatrix;
    vec4 w = m * vec4(position, 1.0);
    vWorld = w.xyz;
    vN = normalize(mat3(m) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

function cactusMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { PARTS: '' },
    uniforms: { ...atmosphere, ...DESERT_LIGHT() },
    vertexShader: PROP_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uSky, uBounce, uSun;
      varying vec3 vColor; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vN; varying vec2 vPart; varying vec3 vInst;
      ${ATMOS_PARS}
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vN);
        vec3 L = normalize(uMoonDir);
        vec3 V = normalize(cameraPosition - vWorld);
        float groove = vPart.x;
        // Skin: darker in the grooves, mottled, a little dusty and yellowed near the ground.
        vec3 col = vColor * (1.0 - 0.5 * groove);
        col *= 0.88 + 0.22 * vnoise(vLocal.xz * 3.0 + vLocal.y * 1.1);
        col = mix(col, col * vec3(1.25, 1.1, 0.75), smoothstep(0.7, 0.0, vLocal.y) * 0.45);
        // Areoles / spines: pale specks on the ridges, faded out where they would shimmer.
        vec3 sq = vLocal * 70.0;
        float spk = step(0.9, vnoise(sq.xy + sq.z * 1.7)) * smoothstep(0.25, 0.05, groove) * (1.0 - vPart.y);
        spk *= 1.0 - smoothstep(0.4, 1.2, length(fwidth(sq)));
        col = mix(col, vec3(0.95, 0.9, 0.75), spk * 0.5);
        // Flowers / fruit: magenta or yellow per plant.
        vec3 flowerCol = mix(vec3(1.0, 0.18, 0.55), vec3(1.0, 0.8, 0.2), step(0.55, hash21(vInst.xz)));
        col = mix(col, flowerCol, vPart.y);
        float diff = max(dot(n, L), 0.0);
        vec3 amb = mix(uBounce * 0.6, uSky * 0.55, n.y * 0.5 + 0.5) + vec3(0.1, 0.16, 0.08);
        // Soft fill from the viewer's side so backlit plants stay green instead of going brown.
        amb += vec3(0.3, 0.34, 0.32) * max(dot(n, V), 0.0);
        // Waxy cuticle: tight glossy highlight on the ridges, a broad sheen and a backlit rim.
        vec3 H = normalize(L + V);
        float nh = max(dot(n, H), 0.0);
        float gloss = pow(nh, 48.0) * (1.0 - 0.7 * groove);
        float sheen = pow(nh, 8.0) * 0.12;
        float fres = pow(clamp(1.0 - dot(n, V), 0.0, 1.0), 4.0);
        float back = pow(max(dot(-V, L), 0.0), 4.0);
        vec3 lit = col * (uSun * diff * 1.25 + amb)
          + uSun * (gloss * 0.7 + sheen) * (1.0 - vPart.y * 0.5)
          + mix(uSky, uSun, back) * fres * (0.18 + 0.5 * back)
          + flowerCol * vPart.y * 0.5;
        gl_FragColor = vec4(applyAtmos(lit, vWorld), 1.0);
      }`,
  });
}

const CACTUS_GREENS = ['#4a9a44', '#5aa04a', '#3f8a4c', '#64a456', '#4a8c52'].map((c) => new THREE.Color(c));

/** Big saguaros in four shapes; `variant` picks the shape (0..3). */
export function createSaguaros(list: (Placement & { variant: number })[]): THREE.Group {
  const shapes = [
    saguaro(5.4, [[2.2, 1.15, 1.4, 0], [3.0, 1.0, 1.1, Math.PI]]),
    saguaro(6.2, [[2.7, 1.2, 1.6, 0.3], [3.8, 0.85, 0.8, Math.PI * 0.55]]),
    saguaro(3.8, []),
    saguaro(6.8, [[2.0, 1.25, 2.0, 0], [2.9, 1.1, 1.5, Math.PI * 0.9], [4.1, 0.9, 1.0, Math.PI * 1.5]]),
  ];
  const mat = cactusMaterial();
  const g = new THREE.Group();
  shapes.forEach((geo, v) => {
    const sub = list.filter((p) => p.variant % shapes.length === v);
    if (!sub.length) return;
    g.add(instanced(withColors(geo, CACTUS_GREENS, sub.length), mat, sub));
  });
  return g;
}

/** Small cacti: ribbed barrel cacti with a flower crown, and prickly-pear pad clusters with fruit. */
export function createSmallCacti(barrels: Placement[], pears: Placement[]): THREE.Group {
  const mat = cactusMaterial();
  const g = new THREE.Group();
  if (barrels.length) {
    const BR = 15;
    const parts = [ribbed(new THREE.SphereGeometry(0.5, BR * 3, 14).scale(1, 1.25, 1).translate(0, 0.42, 0), BR, 0.06, 'u')];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      parts.push(smoothPart(new THREE.SphereGeometry(0.045, 12, 8).scale(1, 0.6, 1).translate(Math.cos(a) * 0.13, 1.02, Math.sin(a) * 0.13), 1));
    }
    const colors = ['#5a9a44', '#6aa046', '#7a9c4a', '#4c8a46'].map((c) => new THREE.Color(c));
    g.add(instanced(withColors(mergeGeometries(parts), colors, barrels.length), mat, barrels));
  }
  if (pears.length) {
    const parts: THREE.BufferGeometry[] = [];
    const pad = (x: number, y: number, z: number, s: number, tilt: number, yaw: number) => {
      parts.push(smoothPart(new THREE.SphereGeometry(1, 32, 20).scale(0.42 * s, 0.55 * s, 0.1 * s).rotateZ(tilt).rotateY(yaw).translate(x, y, z)));
      // Fruit along the top rim of the bigger pads.
      if (s < 0.85) return;
      const top = new THREE.Vector3(0, 0.55 * s, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), tilt);
      for (const f of [-0.22, 0, 0.22]) {
        const q = new THREE.Vector3(f * s + top.x, top.y, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        parts.push(smoothPart(new THREE.SphereGeometry(0.06, 12, 8).scale(1, 1.3, 1).translate(x + q.x, y + q.y, z + q.z), 1));
      }
    };
    pad(0, 0.45, 0, 1, 0.1, 0);
    pad(0.55, 0.4, 0.2, 0.85, -0.4, 0.9);
    pad(-0.5, 0.38, -0.15, 0.8, 0.5, -0.6);
    pad(0.1, 1.2, 0.05, 0.9, -0.25, 0.3);
    pad(0.75, 1.0, 0.25, 0.7, -0.7, 1.1);
    pad(-0.3, 1.15, -0.2, 0.75, 0.45, -0.9);
    const colors = ['#6aa052', '#78a858', '#5c9450'].map((c) => new THREE.Color(c));
    g.add(instanced(withColors(mergeGeometries(parts), colors, pears.length), mat, pears));
  }
  return g;
}

/** Sandstone boulders: lumpy, flat-bottomed, banded, with a glossy desert-varnish sheen. */
export function createBoulders(list: Placement[]): THREE.InstancedMesh {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 4);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const p = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let k = 1 + Math.sin(v.x * 2.3 + v.z * 1.1) * 0.18 + Math.sin(v.z * 4.7 - v.y * 2.9) * 0.1 + Math.sin(v.y * 8.3 + v.x * 6.1) * 0.04;
    k += Math.max(0, Math.sin(v.x * 3.7 - v.z * 5.1)) * 0.06; // a few ledges
    v.multiplyScalar(k);
    p.setXYZ(i, v.x * 1.15, Math.max(-0.25, v.y * 0.72), v.z * 0.95);
  }
  geo.computeVertexNormals();
  geo.translate(0, 0.2, 0);
  withColors(geo, ['#c06a42', '#cc8055', '#a85a3c', '#d49060', '#b06a4c'].map((c) => new THREE.Color(c)), list.length);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere, ...DESERT_LIGHT() },
    vertexShader: PROP_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uSky, uBounce, uSun;
      varying vec3 vColor; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vN; varying vec2 vPart; varying vec3 vInst;
      ${ATMOS_PARS}
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vN);
        vec3 L = normalize(uMoonDir);
        vec3 V = normalize(cameraPosition - vWorld);
        // Sandstone: strata bands, mottling, dark varnish streaks running down from the top.
        float bands = sin(vLocal.y * 14.0 + vnoise(vLocal.xz * 3.0 + vInst.xz) * 4.0) * 0.5 + 0.5;
        float mott = vnoise(vLocal.xz * 6.0 + vLocal.y * 3.0) * 0.6 + vnoise(vLocal.xy * 17.0) * 0.4;
        vec3 col = vColor * (0.75 + 0.2 * bands + 0.35 * mott);
        float varnish = smoothstep(0.55, 0.85, vnoise(vec2(atan(vLocal.z, vLocal.x) * 5.0, vLocal.y * 1.5))) * smoothstep(-0.1, 0.6, vLocal.y);
        col = mix(col, vec3(0.18, 0.1, 0.09), varnish * 0.6);
        col = mix(col, vec3(0.85, 0.6, 0.42), smoothstep(0.7, 0.95, n.y) * 0.3); // sand dusting on top
        float diff = max(dot(n, L), 0.0);
        vec3 amb = mix(uBounce * 0.5, uSky * 0.55, n.y * 0.5 + 0.5) + vec3(0.3, 0.28, 0.3) * max(dot(n, V), 0.0);
        vec3 H = normalize(L + V);
        // Polished, varnished stone: tight highlight plus a broad sheen toward the sun.
        float nh = max(dot(n, H), 0.0);
        float spec = pow(nh, 30.0) * (0.35 + 0.6 * varnish) + pow(nh, 6.0) * 0.08;
        float rim = pow(clamp(1.0 - dot(n, V), 0.0, 1.0), 3.0);
        vec3 lit = col * (uSun * diff * 1.2 + amb) + uSun * spec + mix(uSky, uSun, pow(max(dot(-V, L), 0.0), 4.0)) * rim * 0.3;
        gl_FragColor = vec4(applyAtmos(lit, vWorld), 1.0);
      }`,
  });
  return instanced(geo, mat, list);
}

// ------------------------------------------------------------------ harbor

/** Cargo ships: hull + superstructure with lit windows. */
export function createShips(list: Placement[]): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.BoxGeometry(18, 9, 120).translate(0, 1.5, 0);
  const bridge = new THREE.BoxGeometry(16, 14, 12).translate(0, 13, 48);
  g.add(instanced(mergeGeometries([hull.toNonIndexed(), bridge.toNonIndexed()]), std('#2a2f3a', { metalness: 0.3 }), list));
  const windows = new THREE.BoxGeometry(16.2, 1.2, 12.2).translate(0, 15, 48);
  g.add(instanced(windows, applyAtmosphere(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd28a').multiplyScalar(2.2) })), list));
  const stack = new THREE.CylinderGeometry(2, 2.4, 8, 48).translate(0, 24, 50);
  g.add(instanced(stack, std('#c0392b'), list));
  return g;
}

// ------------------------------------------------------------------ snow

/** Pine trees: stacked cones with snow on the upper sides. */
export function createPines(list: Placement[]): THREE.InstancedMesh {
  const parts = [
    new THREE.CylinderGeometry(0.25, 0.35, 2.5, 16).translate(0, 1.25, 0),
    new THREE.ConeGeometry(2.6, 4.5, 24, 3).translate(0, 4.2, 0),
    new THREE.ConeGeometry(2.0, 3.8, 24, 3).translate(0, 6.4, 0),
    new THREE.ConeGeometry(1.3, 3.2, 24, 3).translate(0, 8.4, 0),
  ].map((g) => g.toNonIndexed());
  const geo = withColors(mergeGeometries(parts), [new THREE.Color('#1f3d2a'), new THREE.Color('#244a30'), new THREE.Color('#1a3424')], list.length);
  const mat = propShader(/* glsl */ `
    if (vLocal.y < 2.4) col = vec3(0.25, 0.16, 0.1);
    float snow = smoothstep(0.35, 0.7, n.y) * smoothstep(0.3, 0.7, vnoise(vWorld.xz * 1.5 + vLocal.y));
    col = mix(col, vec3(0.92, 0.95, 1.0), snow);
  `);
  return instanced(geo, mat, list);
}

// ------------------------------------------------------------------ cyber

/** Floating, slowly rotating neon shapes with glowing rims. */
export function createFloatingShapes(list: { x: number; y: number; z: number; scale: number; color: THREE.Color; kind: number }[]): THREE.Group {
  const g = new THREE.Group();
  const geos = [new THREE.IcosahedronGeometry(1, 0), new THREE.TorusGeometry(1, 0.25, 16, 64), new THREE.OctahedronGeometry(1, 0), new THREE.BoxGeometry(1.4, 1.4, 1.4)];
  geos.forEach((geo, kind) => {
    const items = list.filter((s) => s.kind === kind);
    if (!items.length) return;
    withColors(geo, items.map((s) => s.color), items.length);
    const mat = propShader(/* glsl */ `
      vec3 v = normalize(cameraPosition - vWorld);
      float rim = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 2.5);
      col = vec3(0.01, 0.0, 0.03);
      emissive = vColor * (rim * 3.0 + 0.15) * (1.0 + 0.7 * uBeatPulse + 0.8 * uBeatHit);
    `, { vertex: /* glsl */ `
      // Every shape swells on the beat (each by its own amount, 12-30 %) and jumps further on the hard hits.
      p *= 1.0 + (0.12 + 0.18 * fract(phase * 0.618)) * uBeatPulse + 0.22 * uBeatHit;
      float a = uTime * 0.3 + phase;
      mat3 r = mat3(cos(a), 0.0, sin(a), 0.0, 1.0, 0.0, -sin(a), 0.0, cos(a));
      mat3 r2 = mat3(1.0, 0.0, 0.0, 0.0, cos(a * 0.7), -sin(a * 0.7), 0.0, sin(a * 0.7), cos(a * 0.7));
      p = r * r2 * p;
      p.y += sin(uTime * 0.5 + phase) * 0.3;
    ` });
    g.add(instanced(geo, mat, items.map((s) => ({ x: s.x, y: s.y, z: s.z, yaw: 0, scale: s.scale }))));
  });
  return g;
}

// ------------------------------------------------------------------ space

export type PlanetKind = 'gas' | 'rocky' | 'ice' | 'lava' | 'terran';
const PLANET_KINDS: PlanetKind[] = ['gas', 'rocky', 'ice', 'lava', 'terran'];

/**
 * Planet (+ optional detailed ring). Kinds: gas giant (turbulent bands + storm), rocky moon (craters with rims
 * and rays), ice world (glossy cracked shell, frosted poles), lava world (glowing fissures that light up the
 * night side) and an Earth-like world (oceans with a sun glint, continents, ice caps, drifting clouds, city
 * lights at night). All share the same soft terminator, per-pixel normals and atmosphere limb.
 */
export function createPlanet(pos: THREE.Vector3, radius: number, a: string, b: string, ring = false, kind: PlanetKind = 'gas', seed = 0): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere, uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uKind: { value: PLANET_KINDS.indexOf(kind) }, uSeed: { value: seed } },
    vertexShader: `varying vec3 vP; varying vec3 vW; varying vec3 vN; void main(){ vP = position; vN = mat3(modelMatrix) * normalize(position); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uA, uB; uniform float uKind, uSeed; varying vec3 vP; varying vec3 vW; varying vec3 vN; ${ATMOS_PARS} ${NOISE_GLSL}
      // Seamless noise on the sphere: three planar projections blended by the normal.
      float tri(vec3 p, float k) {
        vec3 w = abs(p); w = w * w; w /= (w.x + w.y + w.z);
        return fbm(p.yz * k + uSeed) * w.x + fbm(p.zx * k + uSeed * 1.7) * w.y + fbm(p.xy * k + uSeed * 2.3) * w.z;
      }
      float triN(vec3 p, float k) {
        vec3 w = abs(p); w = w * w; w /= (w.x + w.y + w.z);
        return vnoise(p.yz * k + uSeed) * w.x + vnoise(p.zx * k + uSeed) * w.y + vnoise(p.xy * k + uSeed) * w.z;
      }
      vec3 hdir(float i) { return normalize(vec3(sin(i * 12.9898 + uSeed), sin(i * 78.233 + uSeed * 0.7), sin(i * 37.719 + 1.3))); }
      void main(){
        vec3 p = normalize(vP);
        // Per-pixel normal (a sphere's normal is its position): smooth at any distance.
        vec3 n = normalize(vN);
        vec3 L = normalize(uMoonDir);
        vec3 v = normalize(cameraPosition - vW);
        float ndl = dot(n, L);
        float diff = smoothstep(-0.12, 0.5, ndl);
        float night = 1.0 - smoothstep(-0.2, 0.1, ndl);
        float limb = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 4.0);
        vec3 col; vec3 glow = vec3(0.0); float spec = 0.0; float shade = 1.0;
        vec3 atmo = mix(uA, vec3(1.0), 0.3); float atmoK = 0.9;
        float t = uTime * 0.004;
        if (uKind < 0.5) {
          // Gas giant: flowing turbulence, stretched along the bands, with a big oval storm.
          float n1 = fbm(vec2(p.x * 3.0 + p.z * 1.7 + t, p.y * 20.0));
          float n2 = fbm(vec2(p.z * 8.0 - p.x * 2.0 - t * 2.0, p.y * 48.0 + p.x * 2.0));
          float lat = p.y + (n1 - 0.5) * 0.06 + (n2 - 0.5) * 0.02;
          float broad = sin(lat * 24.0) * 0.5 + 0.5;
          float fine = sin(lat * 95.0 + n2 * 4.0) * 0.5 + 0.5;
          vec3 cream = mix(uA, vec3(1.0, 0.95, 0.85), 0.55);
          col = mix(uA, uB, smoothstep(0.25, 0.75, broad));
          col = mix(col, cream, smoothstep(0.6, 1.0, fine) * 0.35);
          col *= 0.88 + 0.24 * n2;
          vec2 sp = vec2((atan(p.z, p.x) - 0.8) * 1.6, (p.y + 0.32) * 6.0);
          float storm = smoothstep(1.0, 0.6, length(sp));
          col = mix(col, mix(uB, vec3(0.75, 0.3, 0.18), 0.5), storm * (0.6 + 0.4 * sin(length(sp) * 14.0 - uTime * 0.3)));
        } else if (uKind < 1.5) {
          // Rocky moon: maria (dark plains), highlands, craters with bright rims, central peaks and ray streaks.
          float h = tri(p, 3.0);
          col = mix(uB, uA, smoothstep(0.35, 0.62, h));
          col *= 0.8 + 0.4 * triN(p, 40.0);
          for (int i = 0; i < 28; i++) {
            vec3 c = hdir(float(i));
            float r = 0.05 + 0.16 * fract(sin(float(i) * 4.1 + uSeed) * 43758.5);
            float d = acos(clamp(dot(p, c), -1.0, 1.0)) / r;
            if (d < 2.5) {
              float bowl = smoothstep(1.0, 0.0, d);
              float rim = smoothstep(0.75, 1.0, d) * smoothstep(1.3, 1.0, d);
              float peak = smoothstep(0.18, 0.0, d);
              vec3 tx = normalize(cross(c, vec3(0.0, 1.0, 0.0)));
              float ang = atan(dot(p, tx), dot(p, cross(c, tx)));
              float rays = smoothstep(0.6, 1.0, vnoise(vec2(ang * 9.0, float(i) * 3.1))) * smoothstep(2.5, 1.0, d) * step(1.0, d);
              col *= 1.0 - bowl * 0.35 + rim * 0.45 + peak * 0.4;
              col += uA * rays * 0.12;
              // Bowls are shaded on the side facing away from the light.
              shade *= 1.0 - bowl * 0.4 * clamp(dot(normalize(p - c * dot(p, c)), L) + 0.3, 0.0, 1.0);
            }
          }
          atmoK = 0.15; // airless: only a faint limb
        } else if (uKind < 2.5) {
          // Ice world: glossy pale shell, dark-blue fracture lines, frosted poles.
          float h = tri(p, 2.5);
          col = mix(uA, uB, smoothstep(0.3, 0.7, h));
          float cr1 = 1.0 - smoothstep(0.0, 0.035, abs(tri(p, 5.0) - 0.5));
          float cr2 = 1.0 - smoothstep(0.0, 0.02, abs(tri(p * 1.3 + 2.0, 11.0) - 0.5));
          col = mix(col, uB * 0.45, max(cr1, cr2 * 0.6) * 0.7);
          col = mix(col, vec3(0.97, 0.98, 1.0), smoothstep(0.7, 0.9, abs(p.y) + (h - 0.5) * 0.2));
          spec = 0.35;
          atmo = mix(uA, vec3(0.8, 0.9, 1.0), 0.5); atmoK = 0.6;
        } else if (uKind < 3.5) {
          // Lava world: black crust plates; glowing fissures and lava lakes that light the night side.
          float h = tri(p, 3.0);
          float plates = abs(tri(p, 6.0) - 0.5);
          float crack = 1.0 - smoothstep(0.0, 0.05, plates);
          float lake = smoothstep(0.62, 0.7, h);
          col = mix(vec3(0.06, 0.05, 0.05), vec3(0.18, 0.13, 0.12), triN(p, 30.0)) * (0.8 + 0.4 * h);
          float heat = max(crack, lake) * (0.75 + 0.25 * sin(uTime * 0.6 + h * 30.0));
          glow = mix(uB, uA, heat) * heat * (1.6 + 2.4 * night);
          col = mix(col, uB * 0.6, heat * 0.5);
          atmo = uA * 0.8; atmoK = 0.7;
        } else {
          // Earth-like: oceans / continents (forests, deserts, mountains), ice caps, clouds, city lights.
          float h = tri(p, 2.2) * 0.75 + tri(p, 7.0) * 0.25;
          float land = smoothstep(0.5, 0.52, h);
          vec3 ocean = mix(vec3(0.02, 0.08, 0.25), vec3(0.05, 0.3, 0.5), smoothstep(0.38, 0.5, h));
          float dry = triN(p, 4.0);
          vec3 ground = mix(vec3(0.12, 0.3, 0.1), vec3(0.6, 0.5, 0.3), smoothstep(0.45, 0.7, dry - abs(p.y) * 0.3 + 0.1));
          ground = mix(ground, vec3(0.42, 0.38, 0.35), smoothstep(0.62, 0.72, h));
          col = mix(ocean, ground, land);
          col = mix(col, vec3(0.95, 0.97, 1.0), smoothstep(0.72, 0.82, abs(p.y) + (h - 0.5) * 0.3));
          spec = (1.0 - land) * 0.9;
          float cl = tri(p + vec3(t * 3.0, 0.0, t), 4.0) * 0.7 + tri(p * 2.0 - t, 9.0) * 0.3;
          float clouds = smoothstep(0.5, 0.68, cl);
          col = mix(col, vec3(1.0), clouds * 0.9);
          spec *= 1.0 - clouds;
          float city = step(0.86, triN(p, 90.0)) * land * (1.0 - clouds) * smoothstep(0.75, 0.6, abs(p.y));
          glow = vec3(1.0, 0.75, 0.35) * city * night * 1.4;
          atmo = vec3(0.35, 0.6, 1.0); atmoK = 1.3;
        }
        vec3 lit = col * (0.03 + 1.15 * diff * shade) + glow;
        if (spec > 0.0) lit += vec3(1.0, 0.95, 0.85) * pow(max(dot(reflect(-L, n), v), 0.0), 60.0) * spec * diff * 1.5;
        lit += atmo * limb * (0.15 + 0.85 * smoothstep(-0.3, 0.4, ndl)) * atmoK;
        gl_FragColor = vec4(lit, 1.0);
      }`,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 192, 112), mat);
  g.add(sphere);
  if (ring) {
    const rIn = radius * 1.35, rOut = radius * 2.35;
    const rg = new THREE.RingGeometry(rIn, rOut, 256, 4).rotateX(-Math.PI / 2 + 0.35);
    const rm = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false,
      uniforms: { ...atmosphere, uA: { value: new THREE.Color(b) }, uC: { value: new THREE.Color(a) }, uIn: { value: rIn }, uOut: { value: rOut }, uR: { value: radius } },
      vertexShader: `varying vec3 vP; varying vec3 vW; varying vec3 vC; void main(){ vP = position; vC = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uA, uC; uniform float uIn, uOut, uR; varying vec3 vP; varying vec3 vW; varying vec3 vC; ${ATMOS_PARS} ${NOISE_GLSL}
        void main(){
          float r = length(vP);
          float u = (r - uIn) / (uOut - uIn);
          // Many fine ringlets, a couple of clear gaps, denser in the middle.
          float ringlets = 0.55 + 0.25 * sin(u * 180.0) * sin(u * 67.0) + 0.2 * (vnoise(vec2(u * 400.0, 0.5)) - 0.5);
          float gap = smoothstep(0.0, 0.012, abs(u - 0.62)) * smoothstep(0.0, 0.006, abs(u - 0.31));
          float density = ringlets * gap * smoothstep(0.0, 0.05, u) * smoothstep(1.0, 0.85, u) * (0.6 + 0.4 * sin(u * 3.14));
          vec3 col = mix(uA, mix(uC, vec3(1.0, 0.95, 0.85), 0.5), vnoise(vec2(u * 60.0, 1.0)));
          // Shadow of the planet on the ring (behind it, away from the light).
          vec3 L = normalize(uMoonDir);
          vec3 d = vW - vC;
          float along = dot(d, -L);
          float perp = length(d + L * along);
          float shadow = along > 0.0 ? smoothstep(uR * 0.96, uR * 1.04, perp) : 1.0;
          gl_FragColor = vec4(col * (0.15 + 0.95 * shadow), clamp(density, 0.0, 1.0) * 0.85);
        }`,
    });
    g.add(new THREE.Mesh(rg, rm));
  }
  g.position.copy(pos);
  return g;
}

/**
 * Tumbling asteroids: smooth, lumpy rock with craters. Normals rotate with the tumble (they used to
 * stay fixed, so the light slid over the rock) and the lighting is a hard sun + cool fill + rim.
 */
export function createAsteroids(list: Placement[]): THREE.InstancedMesh {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 5);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo); // shared vertices → smooth normals
  const p = geo.getAttribute('position');
  const v = new THREE.Vector3();
  const craters = Array.from({ length: 9 }, (_, i) => ({
    c: new THREE.Vector3(Math.sin(i * 2.4) * Math.cos(i * 1.3), Math.cos(i * 2.4), Math.sin(i * 2.4) * Math.sin(i * 1.3)).normalize(),
    r: 0.22 + (i % 3) * 0.12,
  }));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let k = 1 + Math.sin(v.x * 3.1 + v.y * 1.7) * 0.16 + Math.sin(v.z * 5.3 - v.x * 2.1) * 0.09 + Math.sin(v.y * 9.1 + v.z * 7.3) * 0.03;
    for (const cr of craters) {
      const d = v.distanceTo(cr.c) / cr.r;
      if (d < 1.4) k += d < 1 ? -(1 - d * d) * cr.r * 0.35 : Math.sin((d - 1) / 0.4 * Math.PI) * cr.r * 0.08; // bowl + raised rim
    }
    v.multiplyScalar(k);
    p.setXYZ(i, v.x * 1.1, v.y * 0.78, v.z);
  }
  geo.computeVertexNormals();
  withColors(geo, [new THREE.Color('#6a625a'), new THREE.Color('#7a6c60'), new THREE.Color('#57524e'), new THREE.Color('#6e6058')], list.length);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      uniform float uTime;
      varying vec3 vColor; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vN;
      void main() {
        vColor = aColor; vLocal = position;
        vec3 inst = instanceMatrix[3].xyz;
        float phase = inst.x * 0.37 + inst.z * 0.21;
        float a = uTime * 0.15 + phase, b = uTime * 0.09 + phase * 1.7;
        mat3 rz = mat3(cos(a), sin(a), 0.0, -sin(a), cos(a), 0.0, 0.0, 0.0, 1.0);
        mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(b), sin(b), 0.0, -sin(b), cos(b));
        mat3 r = rx * rz;
        mat4 m = modelMatrix * instanceMatrix;
        vec4 w = m * vec4(r * position, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(m) * (r * normal));
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vN;
      ${ATMOS_PARS}
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vN);
        // Rock albedo: mottled, with darker crater floors and pale dust specks.
        float mott = vnoise(vLocal.xy * 5.0 + vLocal.z * 3.0) * 0.6 + vnoise(vLocal.yz * 13.0) * 0.4;
        float lowness = smoothstep(0.95, 0.7, length(vLocal * vec3(0.91, 1.28, 1.0)));
        vec3 col = vColor * (0.7 + 0.5 * mott) * (1.0 - 0.35 * lowness);
        col += step(0.93, vnoise(vLocal.xz * 40.0)) * 0.12;
        vec3 L = normalize(vec3(0.6, 0.45, -0.65));
        vec3 V = normalize(cameraPosition - vWorld);
        float diff = max(dot(n, L), 0.0);
        float fill = 0.5 + 0.5 * dot(n, normalize(vec3(-0.5, -0.3, 0.6)));
        float rim = pow(clamp(1.0 - dot(n, V), 0.0, 1.0), 3.0);
        float spec = pow(max(dot(n, normalize(L + V)), 0.0), 24.0) * 0.15;
        vec3 lit = col * (vec3(1.0, 0.95, 0.88) * diff * 1.15 + vec3(0.12, 0.15, 0.24) * fill + 0.04) + spec + vec3(0.25, 0.35, 0.6) * rim * 0.18;
        gl_FragColor = vec4(applyAtmos(lit, vWorld), 1.0);
      }`,
  });
  return instanced(geo, mat, list);
}

// ------------------------------------------------------------------ underwater

/** Kelp: tall swaying ribbons. */
export function createKelp(list: Placement[]): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1.2, 22, 1, 16).translate(0, 11, 0);
  const g2 = geo.clone().rotateY(Math.PI / 2);
  const merged = mergeGeometries([geo, g2]);
  withColors(merged, [new THREE.Color('#2f6b2a'), new THREE.Color('#4d7d22'), new THREE.Color('#2a5a3a')], list.length);
  const mat = propShader(/* glsl */ `col *= 0.6 + 0.6 * vUv.y; col += vec3(0.0, 0.05, 0.03);`, {
    side: THREE.DoubleSide,
    vertex: /* glsl */ `float h = p.y / 22.0; p.x += sin(uTime * 0.9 + phase + h * 3.0) * h * h * 3.0; p.z += cos(uTime * 0.7 + phase) * h * h * 1.5;`,
  });
  return instanced(merged, mat, list);
}

/** Colourful coral clumps. */
export function createCoral(list: Placement[]): THREE.InstancedMesh {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(new THREE.CylinderGeometry(0.12, 0.3, 2 + (i % 3), 6).translate(0, 1 + (i % 3) * 0.5, 0).rotateZ(Math.sin(a) * 0.5).rotateX(Math.cos(a) * 0.5).toNonIndexed());
    parts.push(new THREE.SphereGeometry(0.35, 16, 12).translate(Math.sin(a) * 1.2, 2.4 + (i % 3) * 0.8, Math.cos(a) * 1.2).toNonIndexed());
  }
  const geo = withColors(mergeGeometries(parts), ['#ff4f7a', '#ffb000', '#a64dff', '#ff6a3c', '#3dffd0'].map((c) => new THREE.Color(c)), list.length);
  const mat = propShader(/* glsl */ `emissive = vColor * 0.12;`);
  return instanced(geo, mat, list);
}

/** Water surface seen from below (shimmering, bright). */
export function createWaterSurface(y: number, color: string): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(12000, 12000, 1, 1).rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...atmosphere, uC: { value: new THREE.Color(color) } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uC; varying vec3 vW; ${ATMOS_PARS} ${NOISE_GLSL}
      void main(){
        float n = fbm(vW.xz * 0.02 + uTime * 0.05) + fbm(vW.xz * 0.05 - uTime * 0.07);
        vec3 col = uC * (0.6 + 0.8 * smoothstep(0.7, 1.3, n)) + vec3(0.8, 1.0, 1.0) * smoothstep(1.2, 1.5, n);
        gl_FragColor = vec4(applyAtmos(col, vW), 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  return m;
}
