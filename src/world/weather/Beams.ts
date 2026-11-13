import * as THREE from 'three';
import { atmosphere } from '../../render/atmosphere';
import { haloTexture } from '../../game/car/CarBuilder';

/** Shared intensity for all volumetric beams (driven by fog / rain). */
export const beamUniforms = {
  uBeam: { value: 0.25 },
};

/** Open cone, apex at origin, opening downward along -Y, height 1, radius 1. */
function coneGeometry(): THREE.BufferGeometry {
  return new THREE.ConeGeometry(1, 1, 32, 8, true).translate(0, -0.5, 0); // apex at 0, base at y=-1
}

/**
 * Additive "light shaft" material. Brightest near the apex and along the cone axis,
 * soft at the silhouette edges (view-dependent), fades into fog.
 */
function beamMaterial(instanced: boolean, color = new THREE.Color(1, 1, 1)): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    defines: instanced ? { BEAM_INSTANCED: 1 } : {},
    uniforms: { ...beamUniforms, uColor: { value: color }, uFogDensity: atmosphere.uFogDensity, uTime: atmosphere.uTime },
    vertexShader: /* glsl */ `
      #ifdef BEAM_INSTANCED
        attribute vec3 aColor;
      #endif
      varying vec3 vColor;
      varying float vAxial;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        #ifdef BEAM_INSTANCED
          mat4 m = modelMatrix * instanceMatrix;
          vColor = aColor;
        #else
          mat4 m = modelMatrix;
          vColor = vec3(1.0);
        #endif
        vAxial = clamp(-position.y, 0.0, 1.0);
        vNormalW = mat3(m) * normal;
        vec4 w = m * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uBeam, uFogDensity, uTime;
      varying vec3 vColor;
      varying float vAxial;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vec3 v = normalize(cameraPosition - vWorld);
        // Safe normalize: near the apex interpolated normals can cancel out to ~0 (NaN would
        // poison the whole frame through bloom).
        float nl = length(vNormalW);
        float facing = nl > 1e-4 ? abs(dot(vNormalW / nl, v)) : 0.0;
        float edge = pow(facing, 2.0);
        float fade = pow(clamp(1.0 - vAxial, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.12, vAxial);
        // Slight dust shimmer.
        float dust = 0.85 + 0.15 * sin(vWorld.y * 3.0 + vWorld.x * 2.0 + uTime * 1.5);
        float d = length(cameraPosition - vWorld) * uFogDensity;
        float fogFade = exp(-d * d * 0.8);
        float camDist = length(cameraPosition - vWorld);
        float nearFade = smoothstep(3.0, 14.0, camDist); // don't fog up the lens
        vec3 c = uColor * vColor * edge * fade * dust * uBeam * fogFade * nearFade;
        gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
      }`,
  });
}

/** Light cones under every street lamp. */
export function createLampBeams(lamps: { pos: THREE.Vector3; color: THREE.Color }[], radius = 3.2, length = 8.6, colorScale = 0.5): THREE.InstancedMesh {
  const geo = coneGeometry();
  const colors = new Float32Array(lamps.length * 3);
  const mesh = new THREE.InstancedMesh(geo, beamMaterial(true), Math.max(1, lamps.length));
  const m = new THREE.Matrix4();
  lamps.forEach((l, i) => {
    m.makeScale(radius, length, radius).setPosition(l.pos);
    mesh.setMatrixAt(i, m);
    colors.set([l.color.r * colorScale, l.color.g * colorScale, l.color.b * colorScale], i * 3);
  });
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
  mesh.count = lamps.length;
  mesh.computeBoundingSphere();
  mesh.renderOrder = 5;
  return mesh;
}

/**
 * Headlights, as a child of a car (car local: -Z forward):
 *  - a soft light pool on the road (two overlapping lobes with a crisp far cut-off, like low beams),
 *  - a pair of horizontal volumetric fans (gaussian across, fading with distance; stronger in fog/rain),
 *  - a glow halo on each lamp.
 * `strength` scales it for daylight (0.35) vs night (1).
 */
export function createHeadlightBeams(width: number, length: number, frontZ: number, y: number, strength = 1): THREE.Group {
  const g = new THREE.Group();
  const hx = width * 0.3;
  const L = length;

  // Road pool.
  const poolW = 9;
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(poolW, L, 1, 1).rotateX(-Math.PI / 2).translate(0, 0.045, frontZ - L / 2),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { uStrength: { value: strength }, uHx: { value: hx }, uFront: { value: frontZ }, uLen: { value: L } },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uStrength, uHx, uFront, uLen;
        varying vec2 vP;
        float lobe(float x, float d) {
          float w = 0.45 + d * 0.12;
          return exp(-x * x / (w * w));
        }
        void main() {
          float d = uFront - vP.y; // metres ahead of the bumper
          float i = lobe(vP.x - uHx, d) + lobe(vP.x + uHx, d);
          i *= smoothstep(0.0, 3.0, d) * (1.0 / (1.0 + d * 0.09)) * smoothstep(uLen, uLen - 5.0, d);
          vec3 col = mix(vec3(1.0, 0.93, 0.8), vec3(0.8, 0.9, 1.0), smoothstep(0.0, uLen, d));
          gl_FragColor = vec4(col * i * 0.11 * uStrength, 1.0);
        }`,
    }),
  );
  pool.renderOrder = 4;
  g.add(pool);

  // Volumetric fans: a trapezoid from the lamp outward, slightly dipped toward the road.
  const fanGeo = new THREE.BufferGeometry();
  const near = 0.16, far = 3.4, segs = 12;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, w = near + (far - near) * t;
    pos.push(-w, 0, -t * L, w, 0, -t * L);
    uv.push(0, t, 1, t);
    if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  fanGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fanGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fanGeo.setIndex(idx);
  const fanMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { ...beamUniforms, uStrength: { value: strength }, uTime: atmosphere.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uBeam, uStrength, uTime;
      varying vec2 vUv; varying vec3 vWorld;
      void main() {
        float x = (vUv.x - 0.5) * 2.0;
        float across = exp(-x * x * 3.2);
        float along = smoothstep(0.0, 0.05, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.6);
        float dust = 0.85 + 0.15 * sin(vWorld.x * 1.7 + vWorld.z * 1.3 + uTime * 1.2);
        float nearFade = smoothstep(2.0, 7.0, length(cameraPosition - vWorld));
        float k = across * along * dust * nearFade * (0.03 + uBeam * 0.35) * uStrength;
        gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * k, 1.0);
      }`,
  });
  for (const side of [-1, 1]) {
    const fan = new THREE.Mesh(fanGeo, fanMat);
    fan.position.set(side * hx, y, frontZ);
    fan.rotation.x = 0.004; // level (a downward dip made it cut into the road ahead, worse uphill)
    fan.renderOrder = 5;
    g.add(fan);
  }

  // Lamp halos.
  const haloMat = new THREE.SpriteMaterial({
    map: haloTexture(), color: new THREE.Color(0.85, 0.92, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 + 0.35 * strength,
  });
  for (const side of [-1, 1]) {
    const h = new THREE.Sprite(haloMat);
    h.position.set(side * hx, y, frontZ - 0.12);
    h.scale.setScalar(0.62);
    g.add(h);
  }
  return g;
}

/** Sweeping searchlights from rooftops — the classic premiere look in fog. */
export class Searchlights {
  readonly mesh: THREE.InstancedMesh;
  private readonly bases: { pos: THREE.Vector3; phase: number; speed: number; tilt: number }[];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3(14, 900, 14);

  constructor(positions: THREE.Vector3[]) {
    this.bases = positions.map((pos, i) => ({ pos, phase: i * 1.7, speed: 0.15 + (i % 3) * 0.07, tilt: 0.35 + (i % 4) * 0.08 }));
    const geo = coneGeometry();
    const colors = new Float32Array(positions.length * 3);
    positions.forEach((_, i) => colors.set(i % 3 === 0 ? [0.25, 0.5, 0.6] : i % 3 === 1 ? [0.6, 0.25, 0.55] : [0.5, 0.5, 0.55], i * 3));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    this.mesh = new THREE.InstancedMesh(geo, beamMaterial(true), Math.max(1, positions.length));
    this.mesh.count = positions.length;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.update(0);
  }

  update(time: number): void {
    this.bases.forEach((b, i) => {
      const yaw = b.phase + time * b.speed;
      const tilt = b.tilt + Math.sin(time * 0.3 + b.phase) * 0.12;
      // Cone axis is -Y; rotate it to point up and outward.
      this.e.set(Math.PI - tilt, yaw, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.m.compose(b.pos, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
