import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyAtmosphere, ATMOS_PARS, atmosphere, NOISE_GLSL } from '../../render/atmosphere';

export interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale?: number;
}

export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: Placement[], colors?: THREE.Color[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  list.forEach((pl, i) => {
    q.setFromAxisAngle(up, pl.yaw);
    m.compose(p.set(pl.x, pl.y, pl.z), q, s.setScalar(pl.scale ?? 1));
    mesh.setMatrixAt(i, m);
    if (colors) mesh.setColorAt(i, colors[i % colors.length]);
  });
  mesh.count = list.length;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Striped beach umbrellas (stripes via vertex colours, tint via instance colour). */
export function createUmbrellas(list: Placement[]): THREE.Group {
  const g = new THREE.Group();
  const canopy = new THREE.ConeGeometry(1.7, 0.55, 12, 1, true).toNonIndexed();
  canopy.translate(0, 2.3, 0);
  const cols = new Float32Array(canopy.getAttribute('position').count * 3);
  for (let tri = 0; tri < cols.length / 9; tri++) {
    const c = tri % 2 ? 1 : 0.35;
    for (let v = 0; v < 3; v++) cols.set([c, c, c], tri * 9 + v * 3);
  }
  canopy.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  canopy.computeVertexNormals();
  const canopyMat = applyAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  const palette = ['#ff2bd6', '#00c8d8', '#ffd23f', '#ff6a3c', '#ffffff'].map((c) => new THREE.Color(c));
  g.add(instanced(canopy, canopyMat, list, palette));
  const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6).translate(0, 1.2, 0);
  g.add(instanced(pole, applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#f0f0f0' })), list));
  // Towels next to them.
  const towel = new THREE.BoxGeometry(0.9, 0.03, 1.9).translate(1.2, 0.02, 0.3);
  const towelMat = applyAtmosphere(new THREE.MeshStandardMaterial({ roughness: 1 }));
  g.add(instanced(towel, towelMat, list, palette.slice().reverse()));
  return g;
}

/** Classic lifeguard towers: stilts, cabin, striped roof. */
export function createLifeguardTowers(list: Placement[]): THREE.Group {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    parts.push(new THREE.BoxGeometry(0.15, 2.6, 0.15).translate(x, 1.3, z));
  }
  parts.push(new THREE.BoxGeometry(2.4, 0.15, 2.4).translate(0, 2.6, 0));
  parts.push(new THREE.BoxGeometry(2.0, 1.6, 2.0).translate(0, 3.45, 0));
  parts.push(new THREE.BoxGeometry(0.15, 2.6, 0.6).rotateX(0.5).translate(0, 1.2, 1.6)); // ramp
  const base = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  const roof = new THREE.ConeGeometry(1.8, 0.7, 4).rotateY(Math.PI / 4).translate(0, 4.6, 0);
  const g = new THREE.Group();
  g.add(instanced(base, applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.7 })), list));
  g.add(instanced(roof, applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#e8344e', roughness: 0.6 })), list));
  return g;
}

/** Pastel art-deco hotels with balcony bands and sky-reflecting windows (daytime). */
export function createHotels(list: { x: number; y: number; z: number; w: number; h: number; d: number; yaw: number; color: THREE.Color }[]): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const colors = new Float32Array(list.length * 3);
  list.forEach((b, i) => colors.set([b.color.r, b.color.g, b.color.b], i * 3));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      varying vec3 vColor; varying vec3 vMeters; varying vec3 vSize; varying vec3 vNormalL; varying vec3 vNormalW; varying vec3 vWorld;
      void main() {
        vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vSize = size; vMeters = position * size; vNormalL = normal; vColor = aColor;
        mat4 m = modelMatrix * instanceMatrix;
        vNormalW = normalize(mat3(m) * normal);
        vec4 w = m * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying vec3 vMeters; varying vec3 vSize; varying vec3 vNormalL; varying vec3 vNormalW; varying vec3 vWorld;
      ${ATMOS_PARS}
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vNormalL);
        vec3 col = vColor;
        if (n.y < 0.5) {
          bool xf = abs(n.x) > 0.5;
          float u = xf ? vMeters.z : vMeters.x;
          float v = vMeters.y;
          float floorH = 3.4;
          float f = fract(v / floorH);
          vec2 fw = max(fwidth(vec2(u, v / floorH)), vec2(1e-4));
          // White balcony band at each floor, window strip above it.
          float band = 1.0 - smoothstep(0.12 - fw.y, 0.12 + fw.y, f);
          float win = smoothstep(0.3 - fw.y, 0.3 + fw.y, f) * (1.0 - smoothstep(0.85 - fw.y, 0.85 + fw.y, f));
          float mull = smoothstep(0.04, 0.08, abs(fract(u / 2.2) - 0.5));
          vec3 glass = mix(vec3(0.25, 0.5, 0.75), vec3(0.75, 0.9, 1.0), clamp(v / vSize.y, 0.0, 1.0)) * (0.8 + 0.4 * vnoise(vec2(u, v) * 0.1));
          col = mix(col, glass, win * mull * step(3.0, v));
          col = mix(col, vec3(0.97), band * step(3.0, v));
          // Ground floor shade + rounded deco "fins" at the corners.
          float corner = smoothstep(1.2, 0.0, (xf ? vSize.z : vSize.x) * 0.5 - abs(u));
          col = mix(col, vec3(0.98), corner * 0.6);
        }
        float diff = max(dot(normalize(vNormalW), normalize(uMoonDir)), 0.0);
        vec3 lit = col * (0.5 + 0.7 * diff);
        gl_FragColor = vec4(applyAtmos(lit, vWorld), 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  list.forEach((b, i) => {
    q.setFromAxisAngle(up, b.yaw);
    m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
    mesh.setMatrixAt(i, m);
  });
  mesh.count = list.length;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Seagulls circling above the beach (all motion in the vertex shader). */
export function createSeagulls(centres: THREE.Vector3[]): THREE.InstancedMesh {
  // Simple gull: body + two wings with tips (flap via vertex y).
  const pos = [
    0, 0, -0.35, 0, 0.05, 0.35, 0.08, 0, 0, // body
    0, 0, -0.1, 0, 0, 0.15, -0.6, 0, 0.05, // left inner
    -0.6, 0, 0.05, 0, 0, 0.15, -1.1, 0, 0.2, // left tip
    0, 0, -0.1, 0.6, 0, 0.05, 0, 0, 0.15, // right inner
    0.6, 0, 0.05, 1.1, 0, 0.2, 0, 0, 0.15, // right tip
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const data = new Float32Array(centres.length * 4);
  centres.forEach((c, i) => data.set([c.x, c.y, c.z, i * 1.37], i * 4));
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      attribute vec4 aData;
      uniform float uTime;
      varying vec3 vWorld;
      void main() {
        vec3 p = position;
        float ph = aData.w;
        float flap = sin(uTime * 7.0 + ph * 3.0);
        p.y += abs(p.x) * flap * 0.55;
        float r = 25.0 + mod(ph * 13.0, 30.0);
        float a = uTime * (0.25 + mod(ph, 0.2)) + ph;
        vec3 c = aData.xyz + vec3(cos(a) * r, sin(uTime * 0.5 + ph) * 3.0, sin(a) * r);
        // Face along the circle tangent.
        vec3 fwd = normalize(vec3(-sin(a), 0.0, cos(a)));
        vec3 right = vec3(fwd.z, 0.0, -fwd.x);
        vec3 world = c + right * p.x * 1.4 + vec3(0.0, p.y, 0.0) * 1.4 + fwd * p.z * 1.4;
        vWorld = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      ${ATMOS_PARS}
      void main() { gl_FragColor = vec4(applyAtmos(vec3(0.92, 0.92, 0.95), vWorld), 1.0); }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, centres.length));
  mesh.count = centres.length;
  mesh.frustumCulled = false;
  return mesh;
}
