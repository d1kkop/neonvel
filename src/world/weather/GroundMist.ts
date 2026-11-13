import * as THREE from 'three';
import { atmosphere, ATMOS_PARS } from '../../render/atmosphere';
import { LoopTrack, makeFrame } from '../../track/Track';

/**
 * Ground mist: soft, slowly drifting layers of mist lying low over the track (fog weather; a little in
 * rain / storm). The world beyond stays clear — this only hugs the road.
 * Camera-facing (upright) billboards scattered along the track around the player and recycled ahead.
 */
const COUNT = 220;
const BEHIND = 60;
const AHEAD = 340;

export class GroundMist {
  readonly mesh: THREE.Mesh;
  private readonly centers: THREE.InstancedBufferAttribute;
  private readonly s: Float32Array = new Float32Array(COUNT);
  private readonly frame = makeFrame();
  private readonly mat: THREE.ShaderMaterial;
  private init = false;

  constructor(private readonly track: LoopTrack) {
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0); // bottom edge at the centre point
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.centers = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const size = new Float32Array(COUNT * 2);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      size[i * 2] = 12 + Math.random() * 16;
      size[i * 2 + 1] = 1.8 + Math.random() * 2.2;
      seed[i] = Math.random();
    }
    g.setAttribute('aCenter', this.centers);
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.instanceCount = COUNT;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { ...atmosphere, uAmount: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aCenter; attribute vec2 aSize; attribute float aSeed;
        uniform float uTime;
        varying vec2 vUv; varying float vSeed; varying vec3 vWorld; varying float vDist;
        void main() {
          vUv = uv; vSeed = aSeed;
          vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
          vec3 c = aCenter + right * sin(uTime * 0.15 + aSeed * 40.0) * 2.0;
          vec3 p = c + right * position.x * aSize.x + vec3(0.0, position.y * aSize.y, 0.0);
          vWorld = p;
          vDist = length(c - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${ATMOS_PARS}
        uniform float uAmount;
        varying vec2 vUv; varying float vSeed; varying vec3 vWorld; varying float vDist;
        float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vn(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        void main() {
          vec2 q = vUv * vec2(4.0, 1.6) + vec2(vSeed * 19.0 + uTime * 0.04, vSeed * 7.0);
          float n = vn(q) * 0.6 + vn(q * 2.3 + uTime * 0.03) * 0.4;
          // Soft on every edge; densest just above the road, thinning upward.
          float ex = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
          float ey = smoothstep(0.0, 0.22, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.4);
          float near = smoothstep(3.0, 12.0, vDist);
          float far = 1.0 - smoothstep(220.0, 330.0, vDist);
          float a = ex * ey * smoothstep(0.25, 0.85, n) * uAmount * 0.62 * near * far;
          if (a < 0.003) discard;
          vec3 col = applyAtmos(uMistColor * (0.85 + 0.3 * n), vWorld);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  private place(i: number, s: number): void {
    this.s[i] = s;
    this.track.frameAt(s, this.frame);
    const x = (Math.random() * 2 - 1) * (this.track.width * 0.5 + 4);
    const p = this.frame.position;
    this.centers.setXYZ(i, p.x + this.frame.right.x * x, p.y - 0.3, p.z + this.frame.right.z * x);
  }

  /** `amount` 0..1 (weather mist), `playerS` = player's track distance. */
  update(amount: number, playerS: number): void {
    this.mat.uniforms.uAmount.value = amount;
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return;
    const L = this.track.length;
    let dirty = false;
    for (let i = 0; i < COUNT; i++) {
      let rel = this.s[i] - playerS;
      rel -= Math.round(rel / L) * L;
      if (!this.init) {
        this.place(i, playerS - BEHIND + Math.random() * (BEHIND + AHEAD));
        dirty = true;
      } else if (rel < -BEHIND || rel > AHEAD + 40) {
        this.place(i, playerS + AHEAD - Math.random() * 60);
        dirty = true;
      }
    }
    this.init = true;
    if (dirty) this.centers.needsUpdate = true;
  }
}
