import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATMOS_PARS, atmosphere, NOISE_GLSL } from '../../render/atmosphere';

export type HotelVariant = 'deco' | 'stepped' | 'curved' | 'condo' | 'lighthouse' | 'house' | 'motel';
export const HOTEL_VARIANTS: HotelVariant[] = ['deco', 'stepped', 'curved', 'condo', 'lighthouse', 'house', 'motel'];

export interface HotelSpec {
  x: number; y: number; z: number; w: number; h: number; d: number; yaw: number;
  color: THREE.Color; trim: THREE.Color; variant: HotelVariant;
}

// Part ids (per vertex): 0 facade, 1 neon trim (unlit), 2 roof/plain, 3 lighthouse stripes, 4 dark glass.
type Piece = THREE.BufferGeometry;
function tag(g: Piece, part: number): Piece {
  const n = g.toNonIndexed();
  n.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n.getAttribute('position').count).fill(part), 1));
  return n;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, part = 0) =>
  tag(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), part);
const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number, part = 0, sx = 1, seg = 24, arc = Math.PI * 2, start = 0) =>
  tag(new THREE.CylinderGeometry(rt, rb, h, seg, 1, false, start, arc).scale(sx, 1, 1).translate(x, y + h / 2, z), part);

function build(v: HotelVariant): Piece {
  const p: Piece[] = [];
  switch (v) {
    case 'deco':
      p.push(box(0.76, 1, 1, 0, 0, 0), cyl(0.5, 0.5, 1, -0.38, 0, 0, 0, 0.24), cyl(0.5, 0.5, 1, 0.38, 0, 0, 0, 0.24));
      p.push(box(1.02, 0.025, 1.02, 0, 0.97, 0, 1), box(1.02, 0.012, 1.02, 0, 0.9, 0, 1), box(1.02, 0.012, 1.02, 0, 0.12, 0, 1));
      p.push(box(0.5, 0.1, 0.7, 0, 1, 0), box(0.5, 0.012, 0.7, 0, 1.08, 0, 1));
      p.push(box(0.05, 0.22, 0.05, 0, 1.1, 0, 1), box(0.14, 1.0, 1.04, 0, 0, 0, 1)); // central neon fin
      break;
    case 'stepped':
      p.push(box(1, 0.5, 1, 0, 0, 0), box(0.78, 0.3, 0.8, 0, 0.5, -0.05), box(0.55, 0.2, 0.6, 0, 0.8, -0.1));
      p.push(box(1.03, 0.02, 1.03, 0, 0.5, 0, 1), box(0.81, 0.02, 0.83, 0, 0.8, -0.05, 1), box(0.58, 0.02, 0.63, 0, 1.0, -0.1, 1));
      p.push(box(1.0, 0.04, 0.2, 0, 0.5, 0.45, 2), box(0.78, 0.04, 0.2, 0, 0.8, 0.35, 2));
      break;
    case 'curved': {
      // Half-cylinder front (+z), box back.
      p.push(box(1, 1, 0.45, 0, 0, -0.275), cyl(0.5, 0.5, 1, 0, 0, -0.05, 0, 1, 32, Math.PI, 0));
      p.push(box(1.0, 0.03, 0.46, 0, 0.98, -0.275, 1));
      for (const y of [0.99, 0.35]) p.push(tag(new THREE.TorusGeometry(0.5, 0.012, 6, 32, Math.PI).rotateX(Math.PI / 2).translate(0, y, -0.05), 1));
      p.push(box(0.6, 0.12, 0.4, 0, 1, -0.3), box(0.6, 0.012, 0.4, 0, 1.12, -0.3, 1));
      break;
    }
    case 'condo':
      p.push(box(1, 1, 1, 0, 0, 0), box(0.7, 0.05, 0.7, 0, 1, 0, 2), box(0.2, 0.06, 0.2, 0.1, 1.05, -0.1, 2));
      for (let i = 1; i < 14; i++) p.push(box(1.05, 0.006, 1.05, 0, (i / 14) * 0.98, 0, 2)); // balcony slabs
      p.push(box(0.03, 0.15, 0.03, 0, 1.05, 0.2, 1), box(1.04, 0.015, 1.04, 0, 0.99, 0, 1));
      break;
    case 'lighthouse':
      p.push(cyl(0.3, 0.5, 0.8, 0, 0, 0, 3, 1, 28), cyl(0.7, 0.7, 0.03, 0, 0.8, 0, 2, 1, 28));
      p.push(cyl(0.22, 0.22, 0.12, 0, 0.83, 0, 4, 1, 24), cyl(0.3, 0.2, 0.03, 0, 0.95, 0, 2, 1, 24));
      p.push(cyl(0.15, 0.15, 0.04, 0, 0.98, 0, 1, 1, 16), cyl(0, 0.2, 0.1, 0, 1.02, 0, 2, 1, 24));
      p.push(cyl(0.6, 0.65, 0.07, 0, 0, 0, 2, 1, 28));
      break;
    case 'house':
      p.push(box(1, 0.55, 1, 0, 0, 0));
      p.push(tag(new THREE.ConeGeometry(0.75, 0.4, 4).rotateY(Math.PI / 4).translate(0, 0.75, 0), 2));
      p.push(box(1.06, 0.06, 0.28, 0, 0.4, 0.6, 1), box(0.55, 0.14, 0.04, -0.2, 0.62, 0.52, 1));
      break;
    case 'motel':
      p.push(box(1, 0.45, 0.4, 0, 0, -0.3), box(0.3, 0.45, 0.5, 0.35, 0, 0.25));
      p.push(box(1.04, 0.04, 0.44, 0, 0.45, -0.3, 2), box(0.34, 0.04, 0.54, 0.35, 0.45, 0.25, 2));
      p.push(box(1.04, 0.02, 0.06, 0, 0.42, -0.08, 1), box(1.04, 0.015, 0.44, 0, 0.49, -0.3, 1));
      // Sign pylon + neon board.
      p.push(box(0.025, 0.7, 0.025, -0.32, 0, 0.3, 2), box(0.3, 0.2, 0.03, -0.32, 0.6, 0.3, 1), box(0.34, 0.24, 0.02, -0.32, 0.58, 0.29, 2));
      break;
  }
  return mergeGeometries(p)!;
}

let material: THREE.ShaderMaterial | undefined;
function getMaterial(): THREE.ShaderMaterial {
  if (material) return material;
  material = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute vec3 aTrim; attribute float aPart;
      varying vec3 vColor; varying vec3 vTrim; varying float vPart; varying vec3 vMeters; varying vec3 vSize; varying vec3 vNormalL; varying vec3 vNormalW; varying vec3 vWorld;
      void main() {
        vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vSize = size; vMeters = position * size; vNormalL = normal; vColor = aColor; vTrim = aTrim; vPart = aPart;
        mat4 m = modelMatrix * instanceMatrix;
        vNormalW = normalize(mat3(m) * normal);
        vec4 w = m * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying vec3 vTrim; varying float vPart; varying vec3 vMeters; varying vec3 vSize; varying vec3 vNormalL; varying vec3 vNormalW; varying vec3 vWorld;
      ${ATMOS_PARS}
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vNormalL);
        vec3 col = vColor;
        float lum = 1.0;
        float part = floor(vPart + 0.5);
        if (part > 3.5) { col = vec3(0.08, 0.16, 0.26); }
        else if (part > 2.5) {
          float s = fract(vMeters.y / max(vSize.y * 0.14, 1.0));
          col = mix(vec3(0.96), vec3(0.85, 0.12, 0.14), step(0.5, s));
        } else if (part > 1.5) { col = mix(vec3(0.95), vColor, 0.35); }
        else if (part > 0.5) { col = vTrim * 1.15; lum = 0.0; }
        else if (n.y < 0.5) {
          float u = abs(n.x) > abs(n.z) ? vMeters.z : vMeters.x;
          float v = vMeters.y;
          float floorH = 3.4;
          float f = fract(v / floorH);
          vec2 fw = max(fwidth(vec2(u, v / floorH)), vec2(1e-4));
          float band = 1.0 - smoothstep(0.12 - fw.y, 0.12 + fw.y, f);
          float win = smoothstep(0.3 - fw.y, 0.3 + fw.y, f) * (1.0 - smoothstep(0.85 - fw.y, 0.85 + fw.y, f));
          float mull = smoothstep(0.04, 0.08, abs(fract(u / 2.2) - 0.5));
          vec3 glass = mix(vec3(0.25, 0.5, 0.75), vec3(0.75, 0.9, 1.0), clamp(v / vSize.y, 0.0, 1.0)) * (0.8 + 0.4 * vnoise(vec2(u, v) * 0.1));
          col = mix(col, glass, win * mull * step(3.0, v));
          col = mix(col, vec3(0.97), band * step(3.0, v));
        } else { col *= 0.85; }
        float diff = max(dot(normalize(vNormalW), normalize(uMoonDir)), 0.0);
        vec3 lit = lum > 0.5 ? col * (0.5 + 0.7 * diff) : col;
        gl_FragColor = vec4(applyAtmos(lit, vWorld), 1.0);
      }`,
  });
  return material;
}

/** Several distinct 80s Miami building shapes: one merged geometry + one InstancedMesh per variant. */
export function createHotelVariants(list: HotelSpec[]): THREE.Group {
  const g = new THREE.Group();
  const mat = getMaterial();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const v of HOTEL_VARIANTS) {
    const items = list.filter((b) => b.variant === v);
    if (!items.length) continue;
    const geo = build(v);
    const col = new Float32Array(items.length * 3), trim = new Float32Array(items.length * 3);
    items.forEach((b, i) => { col.set([b.color.r, b.color.g, b.color.b], i * 3); trim.set([b.trim.r, b.trim.g, b.trim.b], i * 3); });
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    geo.setAttribute('aTrim', new THREE.InstancedBufferAttribute(trim, 3));
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((b, i) => {
      q.setFromAxisAngle(up, b.yaw);
      m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(i, m);
    });
    mesh.computeBoundingSphere();
    g.add(mesh);
  }
  return g;
}
