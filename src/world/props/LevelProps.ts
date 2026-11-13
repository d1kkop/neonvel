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
      uniform float uTime;
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

/** Flat-topped mesas with horizontal rock strata. */
export function createMesas(list: { x: number; y: number; z: number; r: number; h: number; yaw: number }[]): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(0.42, 0.5, 1, 9, 6).translate(0, 0.5, 0);
  // Jitter the silhouette.
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const k = 1 + Math.sin(a * 3 + p.getY(i) * 2) * 0.08 + Math.sin(a * 7) * 0.05;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  withColors(geo, [new THREE.Color('#b8502e'), new THREE.Color('#a8442a'), new THREE.Color('#c86a3a')], list.length);
  const mat = propShader(/* glsl */ `
    float strata = sin(vWorld.y * 0.9 + vnoise(vWorld.xz * 0.05) * 3.0) * 0.5 + 0.5;
    col = mix(col * 0.75, col * 1.1, strata);
    col = mix(col, vec3(0.9, 0.6, 0.4), smoothstep(0.75, 0.95, n.y) * 0.5);
  `);
  return scaledInstances(geo, mat, list.map((m) => ({ x: m.x, y: m.y, z: m.z, sx: m.r * 2, sy: m.h, sz: m.r * 2, yaw: m.yaw })));
}

/** Saguaro cacti (trunk + two arms). */
export function createCacti(list: Placement[]): THREE.InstancedMesh {
  const parts = [
    new THREE.CylinderGeometry(0.35, 0.4, 5, 8).translate(0, 2.5, 0),
    new THREE.CylinderGeometry(0.25, 0.25, 1.6, 7).rotateZ(Math.PI / 2).translate(0.8, 2.2, 0),
    new THREE.CylinderGeometry(0.25, 0.25, 1.8, 7).translate(1.45, 3.0, 0),
    new THREE.CylinderGeometry(0.22, 0.22, 1.2, 7).rotateZ(Math.PI / 2).translate(-0.7, 3.0, 0),
    new THREE.CylinderGeometry(0.22, 0.22, 1.4, 7).translate(-1.2, 3.6, 0),
  ].map((g) => g.toNonIndexed());
  return instanced(mergeGeometries(parts), std('#3f7a3a'), list);
}

// ------------------------------------------------------------------ harbor

const CONTAINER_COLORS = ['#c0392b', '#1f6fb2', '#e67e22', '#27ae60', '#8e44ad', '#d4ac0d', '#7f8c8d', '#16a085'].map((c) => new THREE.Color(c));

/** Shipping containers with corrugated walls. */
export function createContainers(list: Placement[]): THREE.InstancedMesh {
  const geo = withColors(new THREE.BoxGeometry(12, 2.6, 2.45).translate(0, 1.3, 0), CONTAINER_COLORS, list.length);
  const mat = propShader(/* glsl */ `
    float rc = vLocal.x * 3.0;
    float rib = smoothstep(0.3, 0.5, abs(fract(rc) - 0.5));
    rib = mix(rib, 0.45, smoothstep(0.25, 0.7, fwidth(rc))); // no shimmer at distance
    col *= 0.8 + 0.25 * rib;
    col *= 0.85 + 0.15 * vnoise(vWorld.xz * 2.0 + vWorld.y);
  `);
  const mesh = instanced(geo, mat, list);
  return mesh;
}

/** Gantry cranes: four legs, a deck and a long boom, with a red warning light (emissive). */
export function createCranes(list: Placement[]): THREE.Group {
  const parts = [
    ...[[-6, -5], [6, -5], [-6, 5], [6, 5]].map(([x, z]) => new THREE.BoxGeometry(0.9, 34, 0.9).translate(x, 17, z)),
    new THREE.BoxGeometry(14, 2, 12).translate(0, 34, 0),
    new THREE.BoxGeometry(2, 1.6, 60).translate(0, 40, 14),
    new THREE.BoxGeometry(3, 4, 4).translate(0, 37, -4),
    new THREE.BoxGeometry(0.4, 10, 0.4).translate(0, 45, 0),
  ].map((g) => g.toNonIndexed());
  const g = new THREE.Group();
  g.add(instanced(mergeGeometries(parts), std('#d9a400', { roughness: 0.6, metalness: 0.4 }), list));
  const lamp = new THREE.SphereGeometry(0.6, 8, 6).translate(0, 50.5, 0);
  g.add(instanced(lamp, applyAtmosphere(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2020').multiplyScalar(5) })), list));
  return g;
}

/** Cargo ships: hull + superstructure with lit windows. */
export function createShips(list: Placement[]): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.BoxGeometry(18, 9, 120).translate(0, 1.5, 0);
  const bridge = new THREE.BoxGeometry(16, 14, 12).translate(0, 13, 48);
  g.add(instanced(mergeGeometries([hull.toNonIndexed(), bridge.toNonIndexed()]), std('#2a2f3a', { metalness: 0.3 }), list));
  const windows = new THREE.BoxGeometry(16.2, 1.2, 12.2).translate(0, 15, 48);
  g.add(instanced(windows, applyAtmosphere(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd28a').multiplyScalar(2.2) })), list));
  const stack = new THREE.CylinderGeometry(2, 2.4, 8, 10).translate(0, 24, 50);
  g.add(instanced(stack, std('#c0392b'), list));
  return g;
}

// ------------------------------------------------------------------ snow

/** Pine trees: stacked cones with snow on the upper sides. */
export function createPines(list: Placement[]): THREE.InstancedMesh {
  const parts = [
    new THREE.CylinderGeometry(0.25, 0.35, 2.5, 6).translate(0, 1.25, 0),
    new THREE.ConeGeometry(2.6, 4.5, 8).translate(0, 4.2, 0),
    new THREE.ConeGeometry(2.0, 3.8, 8).translate(0, 6.4, 0),
    new THREE.ConeGeometry(1.3, 3.2, 8).translate(0, 8.4, 0),
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
  const geos = [new THREE.IcosahedronGeometry(1, 0), new THREE.TorusGeometry(1, 0.25, 8, 24), new THREE.OctahedronGeometry(1, 0), new THREE.BoxGeometry(1.4, 1.4, 1.4)];
  geos.forEach((geo, kind) => {
    const items = list.filter((s) => s.kind === kind);
    if (!items.length) return;
    withColors(geo, items.map((s) => s.color), items.length);
    const mat = propShader(/* glsl */ `
      vec3 v = normalize(cameraPosition - vWorld);
      float rim = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 2.5);
      col = vec3(0.01, 0.0, 0.03);
      emissive = vColor * (rim * 3.0 + 0.15);
    `, { vertex: /* glsl */ `
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

/** Gas giant / planet with turbulent bands, storm spot, atmosphere limb (+ optional detailed ring). */
export function createPlanet(pos: THREE.Vector3, radius: number, a: string, b: string, ring = false): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere, uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) } },
    vertexShader: `varying vec3 vP; varying vec3 vW; varying vec3 vN; void main(){ vP = position; vN = mat3(modelMatrix) * normalize(position); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uA, uB; varying vec3 vP; varying vec3 vW; varying vec3 vN; ${ATMOS_PARS} ${NOISE_GLSL}
      void main(){
        vec3 p = normalize(vP);
        // Per-pixel normal (a sphere's normal is its position): smooth at any distance.
        vec3 n = normalize(vN);
        // Flowing turbulence, stretched along the bands.
        float t = uTime * 0.004;
        float n1 = fbm(vec2(p.x * 3.0 + p.z * 1.7 + t, p.y * 20.0));
        float n2 = fbm(vec2(p.z * 8.0 - p.x * 2.0 - t * 2.0, p.y * 48.0 + p.x * 2.0));
        float lat = p.y + (n1 - 0.5) * 0.06 + (n2 - 0.5) * 0.02;
        float broad = sin(lat * 24.0) * 0.5 + 0.5;
        float fine = sin(lat * 95.0 + n2 * 4.0) * 0.5 + 0.5;
        vec3 cream = mix(uA, vec3(1.0, 0.95, 0.85), 0.55);
        vec3 col = mix(uA, uB, smoothstep(0.25, 0.75, broad));
        col = mix(col, cream, smoothstep(0.6, 1.0, fine) * 0.35);
        col *= 0.88 + 0.24 * n2;
        // A big oval storm.
        vec2 sp = vec2((atan(p.z, p.x) - 0.8) * 1.6, (p.y + 0.32) * 6.0);
        float storm = smoothstep(1.0, 0.6, length(sp));
        col = mix(col, mix(uB, vec3(0.75, 0.3, 0.18), 0.5), storm * (0.6 + 0.4 * sin(length(sp) * 14.0 - uTime * 0.3)));
        // Lighting: soft terminator, dark night side, atmosphere glow on the limb.
        vec3 L = normalize(uMoonDir);
        float ndl = dot(n, L);
        float diff = smoothstep(-0.12, 0.5, ndl);
        vec3 v = normalize(cameraPosition - vW);
        float limb = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 4.0);
        vec3 lit = col * (0.03 + 1.15 * diff) + mix(uA, vec3(1.0), 0.3) * limb * (0.15 + 0.85 * smoothstep(-0.3, 0.4, ndl)) * 0.9;
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
    parts.push(new THREE.SphereGeometry(0.35, 6, 4).translate(Math.sin(a) * 1.2, 2.4 + (i % 3) * 0.8, Math.cos(a) * 1.2).toNonIndexed());
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
