import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { applyAtmosphere, ATMOS_PARS, atmosphere, NOISE_GLSL } from '../render/atmosphere';
import type { RoadStyleParams } from '../levels/types';
import { LoopTrack, makeFrame } from '../track/Track';
import { extrude, rectProfile } from './trackGeometry';

/** Road cross-section dimensions (shared with tunnels / canopies). */
export const ROAD_STYLE = {
  lightSpacing: 40,
  wallHeight: 1.0,
  wallThickness: 0.5,
  deckDepth: 2.2,
};

export const roadUniforms = {
  uReflectStrength: { value: 1.0 },
  /** Hilly tracks: the mirror plane (a point on it + normal); reflections fade where the road leaves it. */
  uMirrorP: { value: new THREE.Vector3(0, 0, 0) },
  uMirrorN: { value: new THREE.Vector3(0, 1, 0) },
  uMirrorFade: { value: 0 },
  uRoadWidth: { value: 18 },
  uLanes: { value: 4 },
  uLightSpacing: { value: ROAD_STYLE.lightSpacing },
  uLeftLamp: { value: new THREE.Color('#7fd8ff') },
  uRightLamp: { value: new THREE.Color('#ffae5c') },
  /** Rain amount 0..1 (ripples, more puddles). */
  uRain: { value: 0 },
  uAsphalt: { value: new THREE.Color(0.022, 0.02, 0.032) },
  uWetBias: { value: 0 },
  uLampsOn: { value: 1 },
  /** Covered sections: (start, end, type 1=tunnel 2=canopy, 0). Max 6. */
  uSections: { value: Array.from({ length: 6 }, () => new THREE.Vector4(-1, -1, 0, 0)) },
};

const RoadShader = {
  name: 'WetRoadShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vRefl;
    varying vec2 vRoadUv;
    varying vec3 vWorld;
    void main() {
      vRefl = textureMatrix * vec4(position, 1.0);
      vRoadUv = uv;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uReflectStrength, uRoadWidth, uLanes, uLightSpacing;
    uniform vec3 uMirrorP, uMirrorN;
    uniform float uMirrorFade;
    uniform vec3 uLeftLamp, uRightLamp;
    uniform vec4 uSections[6];
    uniform float uRain, uWetBias, uLampsOn;
    uniform vec3 uAsphalt;


    varying vec4 vRefl;
    varying vec2 vRoadUv;
    varying vec3 vWorld;
    ${ATMOS_PARS}
    ${NOISE_GLSL}

    // Expanding rain-drop rings; returns a 2D normal offset.
    vec2 ripples(vec2 p, float t) {
      vec2 acc = vec2(0.0);
      for (int k = 0; k < 2; k++) {
        float fk = float(k);
        vec2 q = p * (1.4 + fk * 0.9) + fk * 7.3;
        vec2 id = floor(q);
        vec2 f = fract(q) - 0.5;
        float h = hash21(id + fk * 13.1);
        vec2 o = vec2(hash21(id + 1.7), hash21(id + 5.3)) - 0.5;
        vec2 dv = f - o * 0.5;
        float d = length(dv);
        float ph = fract(t * (0.9 + h * 0.7) + h);
        float r = ph * 0.45;
        float ring = sin(clamp((d - r) * 45.0, -3.1416, 3.1416)) * (1.0 - ph) * (1.0 - smoothstep(0.0, 0.08, abs(d - r)));
        acc += dv / max(d, 1e-3) * ring;
      }
      return acc;
    }

    float band(float x, float center, float halfW) {
      float fw = max(fwidth(x) * 0.75, 1e-4);
      return smoothstep(halfW + fw, halfW - fw, abs(x - center));
    }

    void main() {
      float hw = uRoadWidth * 0.5;
      float x = (vRoadUv.x - 0.5) * uRoadWidth; // metres from centre, + = right
      float along = vRoadUv.y;                  // metres along track

      // Puddle mask: sharp mirror puddles vs rougher wet asphalt.
      float wb = clamp(uRain + uWetBias, -1.0, 1.0);
      float wet = smoothstep(0.42 - 0.3 * wb, 0.62 - 0.22 * wb, fbm(vWorld.xz * 0.06));
      // Asphalt, layered from metres down to millimetres. Each layer fades out once it gets smaller
      // than a pixel (so the detail is sharp up close and never shimmers in the distance).
      vec2 wp = vWorld.xz;
      float px = max(length(fwidth(wp)), 1e-4); // metres per pixel here
      #define LAYER(freq) (1.0 - smoothstep(0.25, 0.9, (freq) * px))
      float grain = vnoise(wp * 4.0);
      float macro = fbm(wp * 0.045);                                     // big tone drift / resurfacing
      float mid = vnoise(wp * 11.0) * LAYER(11.0);
      float agg = (vnoise(wp * 37.0) - 0.5) * LAYER(37.0) + (vnoise(wp * 95.0) - 0.5) * 0.7 * LAYER(95.0);
      float stones = smoothstep(0.74, 0.86, vnoise(wp * 31.0 + 3.7)) * LAYER(31.0); // pale aggregate stones
      float pits = smoothstep(0.78, 0.9, vnoise(wp * 61.0 + 9.1)) * LAYER(61.0);   // dark pores
      vec3 base = uAsphalt * (0.72 + 0.35 * grain + 0.25 * (macro - 0.5) + 0.18 * (mid - 0.5) + 0.3 * agg);
      base = mix(base, uAsphalt * 1.7 + vec3(0.01), stones * 0.35);
      base *= 1.0 - pits * 0.45;
      // Repaired patches: slightly darker, fresher rectangles of asphalt.
      vec2 pc0 = floor(vec2(x * 0.35, along * 0.06));
      float patchOn = step(0.86, hash21(pc0 + 11.0));
      vec2 pf = fract(vec2(x * 0.35, along * 0.06));
      float inPatch = patchOn * step(0.12, pf.x) * step(pf.x, 0.88) * step(0.15, pf.y) * step(pf.y, 0.8);
      base *= 1.0 - 0.22 * inPatch;
      // Wheel tracks: two polished, darker bands per lane.
      float laneW0 = uRoadWidth / uLanes;
      float lx = mod(x + hw, laneW0) / laneW0;
      float wheel = exp(-pow((lx - 0.28) / 0.07, 2.0)) + exp(-pow((lx - 0.72) / 0.07, 2.0));
      base *= 1.0 - 0.14 * wheel * (0.6 + 0.4 * vnoise(wp * 0.3));
      // Cracks: thin dark meandering lines (sharp, anti-aliased).
      float cn = vnoise(wp * 0.32) + 0.5 * vnoise(wp * 1.1 + 4.0);
      float cw = fwidth(cn);
      float crack = 1.0 - smoothstep(0.004, 0.004 + cw * 1.5, abs(cn - 0.74));
      crack *= smoothstep(0.55, 0.8, vnoise(wp * 0.08 + 2.0)) * (1.0 - inPatch);
      base *= 1.0 - 0.4 * crack;

      // Fake lamp light pools (lamps staggered on both sides).
      float mR = mod(along, uLightSpacing);
      float sR = min(mR, uLightSpacing - mR);
      float mL = mod(along - uLightSpacing * 0.5, uLightSpacing);
      float sL = min(mL, uLightSpacing - mL);
      float dl = length(vec2(sL, x + hw - 2.5));
      float dr = length(vec2(sR, x - hw + 2.5));
      vec3 pools = (uLeftLamp * exp(-dl * dl / 40.0) + uRightLamp * exp(-dr * dr / 40.0)) * uLampsOn;

      // Covered sections replace the street lamps with their own lighting.
      float cover = 0.0;
      for (int i = 0; i < 6; i++) {
        vec4 s = uSections[i];
        if (along >= s.x && along <= s.y) cover = s.z;
      }
      if (cover > 0.5 && cover < 1.5) {
        // Tunnel: dashed warm ceiling strips at x = +-3.
        float dash = smoothstep(0.0, 0.3, sin(along / 6.0 * 6.2831) + 0.4);
        float strips = exp(-(x - 3.0) * (x - 3.0) / 10.0) + exp(-(x + 3.0) * (x + 3.0) / 10.0);
        pools = vec3(1.0, 0.75, 0.5) * strips * (0.4 + 0.6 * dash) * 0.35 + vec3(0.2, 0.6, 1.0) * exp(-(x + hw) * (x + hw) / 3.0) * 0.5
              + vec3(1.0, 0.2, 0.8) * exp(-(x - hw) * (x - hw) / 3.0) * 0.5;
      } else if (cover > 1.5) {
        // Canopy: neon arch every 20 m + grid shadow pattern.
        float ma = mod(along, 20.0);
        float da = min(ma, 20.0 - ma);
        vec3 archCol = mod(floor(along / 20.0 + 0.5), 2.0) < 0.5 ? vec3(0.0, 0.9, 1.0) : vec3(1.0, 0.17, 0.84);
        pools = archCol * exp(-da * da / 8.0) * 0.9;
      }
      base += pools * 0.12 * (1.0 - wet * 0.5);

      // Markings: orange solid edges, white dashed lanes.
      float edge = band(abs(x), hw - 0.9, 0.14);
      float laneW = uRoadWidth / uLanes;
      float dashes = 0.0;
      for (int i = 1; i < 8; i++) {
        if (float(i) >= uLanes) break;
        float cx = -hw + laneW * float(i);
        float dashOn = step(mod(along, 12.0), 6.0);
        dashes = max(dashes, band(x, cx, 0.09) * dashOn);
      }
      // Worn paint: patchy at the metre scale, speckled at the centimetre scale, darker where the stones show through.
      float wear = (0.72 + 0.28 * vnoise(vWorld.xz * 2.0)) * (1.0 - 0.35 * smoothstep(0.55, 0.8, vnoise(vWorld.xz * 30.0)) * LAYER(30.0)) * (1.0 - 0.5 * pits);
      vec3 markCol = vec3(1.0, 0.5, 0.1) * edge * 0.9 + vec3(0.75, 0.75, 0.8) * dashes * 0.45;
      float mark = max(edge, dashes) * wear;

      // Reflection with fake roughness (12-tap fixed spiral blur) + normal distortion.
      // Distortion fades with distance so far-away road doesn't turn into noise.
      float camDist = length(cameraPosition - vWorld);
      float near = 1.0 / (1.0 + camDist / 35.0);
      vec2 distort = (vec2(fbm(vWorld.xz * 0.5), fbm(vWorld.xz * 0.5 + 19.3)) - 0.5);
      float rough = mix(0.018, 0.003, wet);
      vec4 pc = vRefl;
      pc.xy += distort * mix(0.05, 0.01, wet) * near * pc.w;
      if (uRain > 0.01 && cover < 0.5) {
        float rnear = 1.0 / (1.0 + camDist / 18.0);
        pc.xy += ripples(vWorld.xz, uTime * 1.3) * 0.035 * uRain * rnear * pc.w;
      }
      vec3 refl = vec3(0.0);
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 2.39996;
        float r = sqrt((float(i) + 0.5) / 12.0) * rough;
        vec4 q = pc;
        q.xy += vec2(cos(a) * 0.6, sin(a) * 2.0) * r * pc.w; // stretched vertically = classic wet streaks
        refl += texture2DProj(tDiffuse, q).rgb;
      }
      refl /= 12.0;

      vec3 v = normalize(cameraPosition - vWorld);
      float fres = mix(0.18, 1.0, pow(1.0 - clamp(v.y, 0.0, 1.0), 3.0));
      float reflAmt = uReflectStrength * fres * mix(0.45, 1.0, wet) * (1.0 - mark * 0.8);
      // Hills: the mirror plane follows the road under the car; where the road bends away from that plane
      // the reflection would be wrong, so it fades out instead.
      if (uMirrorFade > 0.0) reflAmt *= 1.0 - smoothstep(0.6, 3.5, abs(dot(vWorld - uMirrorP, uMirrorN)));

      // Gutters darker/drier.
      float gutter = smoothstep(hw - 0.6, hw, abs(x));
      reflAmt *= 1.0 - gutter * 0.6;

      vec3 col = base * (1.0 - mark) + markCol * wear + refl * reflAmt;
      gl_FragColor = vec4(applyAtmos(col, vWorld), 1.0);
    }`,
};

const _zAxis = new THREE.Vector3(0, 0, 1);
const _one = new THREE.Vector3(1, 1, 1);

export class Road {
  readonly group = new THREE.Group();
  readonly surface: Reflector;
  readonly uniforms = roadUniforms;
  /** World positions + colours of street-lamp heads (for volumetric beams). */
  readonly lamps: { pos: THREE.Vector3; color: THREE.Color }[] = [];
  /** Neon strip materials + their base colour (they pulse to the music's beat) and how hard each one pulses. */
  readonly neonMats: { mat: THREE.MeshBasicMaterial; base: THREE.Color; gain: number; side: number }[] = [];
  /** 1 = only the left-hand neon strips pulse to the beat (default), 2 = both sides (player option). */
  beatSides = 1;

  /**
   * 0..1 beat pulse (1 right on the beat, decaying). Every strip gains the same amount of perceived brightness:
   * a dim hue (purple, blue) is multiplied up further than a bright one (green, yellow). With one multiplier
   * for all, a green strip pumped and bloomed while the purple one on the other side hardly changed.
   */
  setBeatPulse(k: number): void {
    for (const n of this.neonMats) n.mat.color.copy(n.base).multiplyScalar(this.beatSides === 1 && n.side > 0 ? 1 : 1 + n.gain * k);
  }

  constructor(track: LoopTrack, opts: { reflectionScale: number; style: RoadStyleParams; pillars: boolean }) {
    const hw = track.width / 2;
    const st = opts.style;
    const leftNeon = new THREE.Color(st.leftNeon);
    const rightNeon = new THREE.Color(st.rightNeon);
    roadUniforms.uLeftLamp.value.set(st.leftLamp);
    roadUniforms.uRightLamp.value.set(st.rightLamp);
    roadUniforms.uLampsOn.value = st.lampsOn ? 1 : 0;
    roadUniforms.uAsphalt.value.set(st.asphalt);
    roadUniforms.uReflectStrength.value = st.reflect;
    roadUniforms.uWetBias.value = st.wetness - 0.5;
    roadUniforms.uRain.value = 0;
    roadUniforms.uSections.value.forEach((v) => v.set(-1, -1, 0, 0));
    roadUniforms.uRoadWidth.value = track.width;
    roadUniforms.uLanes.value = track.lanes;
    track.sections.slice(0, 6).forEach((sec, i) => {
      roadUniforms.uSections.value[i].set(sec.start, sec.end, sec.type === 'tunnel' ? 1 : 2, 0);
    });

    // --- Road surface (planar reflector). Built in local XY plane, rotated flat.
    const n = track.samples.length;
    const frame = makeFrame();
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const step = track.length / n;
    for (let i = 0; i <= n; i++) {
      track.frameAt(i * step, frame);
      const p = frame.position;
      const r = frame.right;
      // local (x, y, z) = world (x, -z, y - base height)
      const lz = p.y - track.height;
      pos.push(p.x - r.x * hw, -(p.z - r.z * hw), lz);
      pos.push(p.x + r.x * hw, -(p.z + r.z * hw), lz);
      uv.push(0, i * step, 1, i * step);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    roadGeo.setIndex(idx);
    roadGeo.computeBoundingSphere();

    const dpr = Math.min(window.devicePixelRatio, 1.5);
    this.surface = new Reflector(roadGeo, {
      shader: RoadShader,
      textureWidth: Math.round(window.innerWidth * dpr * opts.reflectionScale),
      textureHeight: Math.round(window.innerHeight * dpr * opts.reflectionScale),
      clipBias: 0.003,
      multisample: 0,
    });
    const mat = this.surface.material as THREE.ShaderMaterial;
    Object.assign(mat.uniforms, atmosphere, roadUniforms);
    mat.side = THREE.DoubleSide;
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.position.y = track.height;
    this.group.add(this.surface);
    if (track.hilly) this.installMirrorTrick();

    // --- Concrete deck + barrier walls (one closed cross-section).
    const t = ROAD_STYLE.wallThickness;
    const wh = ROAD_STYLE.wallHeight;
    const dd = ROAD_STYLE.deckDepth;
    const concrete = applyAtmosphere(
      new THREE.MeshStandardMaterial({ color: st.concrete, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }),
      'concrete',
    );
    const wall = st.wallStyle ?? 'concrete';
    const neon = (c: THREE.Color, k: number) => {
      const m = applyAtmosphere(new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), side: THREE.DoubleSide }));
      const lum = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;
      this.neonMats.push({ mat: m, base: m.color.clone(), gain: THREE.MathUtils.clamp(1.2 / Math.max(lum, 0.05), 0.75, 2.8), side: c === leftNeon ? -1 : c === rightNeon ? 1 : 0 });
      return m;
    };
    const solidWalls = wall === 'concrete' || wall === 'snowbank';
    // Deck: with concrete walls, or a plain slab for the other styles.
    const deckProfile: [number, number][] = solidWalls
      ? [[-hw, -0.01], [-hw, wh], [-hw - t, wh], [-hw - t, -dd], [hw + t, -dd], [hw + t, wh], [hw, wh], [hw, -0.01]]
      : [[-hw - 0.01, -0.01], [-hw - t, -0.01], [-hw - t, -dd], [hw + t, -dd], [hw + t, -0.01], [hw + 0.01, -0.01]];
    this.group.add(new THREE.Mesh(extrude(track, deckProfile, { step: 1.5 }), concrete));

    if (solidWalls) {
      // Neon strips inside the walls and along the deck's outer edge (visible from across the city).
      this.group.add(new THREE.Mesh(extrude(track, [[-hw + 0.07, wh * 0.7], [-hw + 0.07, wh * 0.9]]), neon(leftNeon, 2.2 * st.neonIntensity)));
      this.group.add(new THREE.Mesh(extrude(track, [[hw - 0.07, wh * 0.7], [hw - 0.07, wh * 0.9]]), neon(rightNeon, 2.2 * st.neonIntensity)));
    }
    this.group.add(new THREE.Mesh(extrude(track, [[-hw - t - 0.07, -0.9], [-hw - t - 0.07, -0.6]]), neon(leftNeon, 2.5 * st.neonIntensity)));
    this.group.add(new THREE.Mesh(extrude(track, [[hw + t + 0.07, -0.9], [hw + t + 0.07, -0.6]]), neon(rightNeon, 2.5 * st.neonIntensity)));

    if (wall === 'snowbank') {
      // Lumpy snow piled against the outside of the walls and on top.
      const snow = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#f2f6ff', roughness: 0.95, side: THREE.DoubleSide }));
      for (const sd of [-1, 1]) {
        const prof: [number, number][] = [[sd * hw, wh + 0.02], [sd * (hw + 0.25), wh + 0.28], [sd * (hw + t + 0.4), wh + 0.18], [sd * (hw + t + 1.4), -0.4]];
        this.group.add(new THREE.Mesh(extrude(track, sd < 0 ? prof : prof.slice().reverse(), { step: 1.5 }), snow));
      }
    } else if (wall === 'guardrail') {
      this.buildGuardrails(track, new THREE.Color(st.railColor ?? '#d8dde4'));
    } else if (wall === 'glass') {
      const glass = applyAtmosphere(new THREE.MeshStandardMaterial({
        color: st.railColor ?? '#88d8ff', metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
      }));
      for (const sd of [-1, 1]) {
        this.group.add(new THREE.Mesh(extrude(track, [[sd * (hw + 0.15), 0], [sd * (hw + 0.15), 1.4]], { step: 1.5 }), glass));
        this.group.add(new THREE.Mesh(extrude(track, rectProfile(sd * (hw + 0.15), 1.45, 0.12, 0.1), { step: 1.5, closedProfile: true }), neon(sd < 0 ? leftNeon : rightNeon, 2.4 * st.neonIntensity)));
      }
    } else if (wall === 'rail') {
      // Cyber: no walls, just glowing light edges floating at the road border.
      for (const sd of [-1, 1]) {
        this.group.add(new THREE.Mesh(extrude(track, rectProfile(sd * (hw + 0.1), 0.06, 0.25, 0.12), { step: 1.5, closedProfile: true }), neon(sd < 0 ? leftNeon : rightNeon, 3.2 * st.neonIntensity)));
        this.group.add(new THREE.Mesh(extrude(track, rectProfile(sd * (hw + 0.1), 0.9, 0.06, 0.06), { step: 1.5, closedProfile: true }), neon(sd < 0 ? leftNeon : rightNeon, 2.0 * st.neonIntensity)));
      }
    }

    if (opts.pillars) this.buildPillars(track, concrete);
    if ((st.lampStyle ?? 'arm') === 'arm') this.buildStreetLights(track, st);
    else if (st.lampStyle === 'post') this.buildPostLamps(track, st);
  }

  private readonly mirrorMatrix = new THREE.Matrix4();
  private readonly mirrorInv = new THREE.Matrix4();
  private readonly mirrorQ = new THREE.Quaternion();
  private readonly realMatrix = new THREE.Matrix4();

  /**
   * Hilly roads: the Reflector's mirror plane normally sits at the mesh itself (one flat plane). Just before
   * the reflection renders, swap in a plane through the road under the car, tilted to its slope; then map
   * the texture projection back onto the real (non-flat) road mesh.
   */
  private installMirrorTrick(): void {
    roadUniforms.uMirrorFade.value = 1;
    const surface = this.surface;
    const original = surface.onBeforeRender;
    const textureMatrix = (surface.material as THREE.ShaderMaterial).uniforms.textureMatrix.value as THREE.Matrix4;
    surface.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      this.realMatrix.copy(surface.matrixWorld);
      surface.matrixWorld.copy(this.mirrorMatrix);
      original.call(surface, renderer, scene, camera, geometry, material, group);
      // textureMatrix = bias · P · V · mirrorMatrix  →  bias · P · V · realMatrix
      textureMatrix.multiply(this.mirrorInv).multiply(this.realMatrix);
      surface.matrixWorld.copy(this.realMatrix);
    };
  }

  /** Place the mirror plane at a road point with the road's normal (hilly tracks; call every frame). */
  setMirror(point: THREE.Vector3, normal: THREE.Vector3): void {
    roadUniforms.uMirrorP.value.copy(point);
    roadUniforms.uMirrorN.value.copy(normal);
    // The Reflector's plane normal is its local +Z.
    this.mirrorQ.setFromUnitVectors(_zAxis, normal);
    this.mirrorMatrix.compose(point, this.mirrorQ, _one);
    this.mirrorInv.copy(this.mirrorMatrix).invert();
  }

  /** W-beam crash barrier on posts (ground-level roads). */
  private buildGuardrails(track: LoopTrack, color: THREE.Color): void {
    const hw = track.width / 2;
    const metal = applyAtmosphere(new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide }), 'metal');
    const dark = applyAtmosphere(new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), metalness: 0.6, roughness: 0.45 }), 'metal');
    for (const sd of [-1, 1]) {
      // Smooth two-lobed W-beam (32 points) with the edges rolled back toward the posts.
      const L = sd * (hw + 0.35);
      const prof: [number, number][] = [];
      prof.push([L + sd * 0.03, 0.44], [L + sd * 0.012, 0.447]);
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        prof.push([L + sd * 0.085 * Math.pow(Math.sin(t * Math.PI * 2), 2), 0.45 + t * 0.34]);
      }
      prof.push([L + sd * 0.012, 0.793], [L + sd * 0.03, 0.8]);
      this.group.add(new THREE.Mesh(extrude(track, prof, { step: 1, smooth: true }), metal));
    }
    // Posts: I-section (web + two flanges), a spacer block to the beam and two bolt heads per post.
    const post = mergeGeometries([
      new THREE.BoxGeometry(0.012, 0.85, 0.15).translate(0, 0.425, 0),
      new THREE.BoxGeometry(0.1, 0.85, 0.012).translate(0, 0.425, 0.069),
      new THREE.BoxGeometry(0.1, 0.85, 0.012).translate(0, 0.425, -0.069),
      new THREE.BoxGeometry(0.06, 0.012, 0.15).translate(0, 0.85, 0), // cap
    ]);
    const block = new THREE.BoxGeometry(0.14, 0.26, 0.12).translate(0, 0.62, 0);
    const bolts = mergeGeometries([
      new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12).rotateZ(Math.PI / 2).translate(0, 0.62, 0.045),
      new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12).rotateZ(Math.PI / 2).translate(0, 0.62, -0.045),
    ]);
    const spacing = 4;
    const n = Math.floor(track.length / spacing) * 2;
    const posts = new THREE.InstancedMesh(post, dark, n);
    const blocks = new THREE.InstancedMesh(block, dark, n);
    const boltMesh = new THREE.InstancedMesh(bolts, metal, n);
    const f = makeFrame();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let k = 0;
    for (let d = 0; d < track.length; d += spacing) {
      if (track.sectionAt(d, 2)) continue;
      track.frameAt(d, f);
      q.setFromAxisAngle(up, Math.atan2(f.right.x, f.right.z) - Math.PI / 2); // local +x = across the road
      for (const sd of [-1, 1]) {
        const at = (lat: number) => p.set(f.position.x + f.right.x * lat, f.position.y, f.position.z + f.right.z * lat);
        posts.setMatrixAt(k, m.compose(at(sd * (hw + 0.56)), q, one));
        blocks.setMatrixAt(k, m.compose(at(sd * (hw + 0.44)), q, one));
        boltMesh.setMatrixAt(k, m.compose(at(sd * (hw + 0.35)), q, one));
        k++;
      }
    }
    for (const im of [posts, blocks, boltMesh]) {
      im.count = k;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  /** Short lantern posts (beach promenade style). */
  private buildPostLamps(track: LoopTrack, st: RoadStyleParams): void {
    const hw = track.width / 2;
    const sp = 30;
    const n = Math.floor(track.length / sp) * 2;
    const poleMat = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.5, metalness: 0.3 }), 'metal');
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.12, 4.2, 20).translate(0, 2.1, 0), poleMat, n);
    const headMat = applyAtmosphere(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 32, 20).translate(0, 4.4, 0), headMat, n);
    const f = makeFrame();
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < n / 2; i++) {
      for (const sd of [-1, 1]) {
        const d = i * sp + (sd < 0 ? sp / 2 : 0);
        if (track.sectionAt(d, 6)) continue;
        track.frameAt(d, f);
        const lat = sd * (hw + 1.3);
        m.makeTranslation(f.position.x + f.right.x * lat, f.position.y, f.position.z + f.right.z * lat);
        poles.setMatrixAt(k, m);
        heads.setMatrixAt(k, m);
        const c = new THREE.Color(sd < 0 ? st.leftLamp : st.rightLamp);
        heads.setColorAt(k, st.lampsOn ? c.clone().multiplyScalar(5) : new THREE.Color('#fff8ec'));
        if (st.lampsOn) this.lamps.push({ pos: new THREE.Vector3(f.position.x + f.right.x * lat, f.position.y + 4.2, f.position.z + f.right.z * lat), color: c });
        k++;
      }
    }
    poles.count = heads.count = k;
    poles.computeBoundingSphere();
    heads.computeBoundingSphere();
    this.group.add(poles, heads);
  }

  private buildPillars(track: LoopTrack, mat: THREE.Material): void {
    const spacing = 48;
    const count = Math.floor(track.length / spacing);
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const pillars = new THREE.InstancedMesh(box, mat, count * 2);
    const frame = makeFrame();
    const m = new THREE.Matrix4();
    const back = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      track.frameAt(i * spacing, frame);
      const top = frame.position.y - ROAD_STYLE.deckDepth; // follows hills
      back.copy(frame.forward).negate();
      // column
      m.makeBasis(frame.right, frame.up, back).scale(new THREE.Vector3(4, top - 0.4, 3));
      m.setPosition(frame.position.x, 0, frame.position.z);
      pillars.setMatrixAt(i * 2, m);
      // cross beam under deck
      m.makeBasis(frame.right, frame.up, back).scale(new THREE.Vector3(track.width + 2, 2, 3.2));
      m.setPosition(frame.position.x, top - 2.25, frame.position.z);
      pillars.setMatrixAt(i * 2 + 1, m);
    }
    pillars.computeBoundingSphere();
    this.group.add(pillars);
  }

  private buildStreetLights(track: LoopTrack, st: RoadStyleParams): void {
    const hw = track.width / 2;
    const sp = ROAD_STYLE.lightSpacing;
    const perSide = Math.floor(track.length / sp);
    const total = perSide * 2;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const metal = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#15131c', roughness: 0.5, metalness: 0.6 }), 'metal');
    const poles = new THREE.InstancedMesh(box, metal, total * 2);
    const heads = new THREE.InstancedMesh(box, applyAtmosphere(new THREE.MeshBasicMaterial({ color: '#ffffff' })), total);
    const frame = makeFrame();
    const m = new THREE.Matrix4();
    const back = new THREE.Vector3();
    const s = new THREE.Vector3();
    const wh = ROAD_STYLE.wallHeight;
    const poleH = 8;
    const armLen = 3.2;
    let k = 0;
    for (let side = -1; side <= 1; side += 2) {
      const lampBase = new THREE.Color(side < 0 ? st.leftLamp : st.rightLamp);
      const lamp = st.lampsOn ? lampBase.clone().multiplyScalar(6) : new THREE.Color('#d8dde6').multiplyScalar(0.6);
      for (let i = 0; i < perSide; i++) {
        // Left lamps offset by half spacing (matches road shader pools).
        const d = i * sp + (side < 0 ? sp * 0.5 : 0);
        if (track.sectionAt(d, 6)) continue;
        track.frameAt(d, frame);
        back.copy(frame.forward).negate();
        const lat = side * (hw + ROAD_STYLE.wallThickness * 0.5);
        const px = frame.position.x + frame.right.x * lat;
        const pz = frame.position.z + frame.right.z * lat;
        const baseY = frame.position.y + wh;
        // pole
        m.makeBasis(frame.right, frame.up, back).scale(s.set(0.25, poleH, 0.25));
        m.setPosition(px, baseY + poleH / 2, pz);
        poles.setMatrixAt(k * 2, m);
        // arm (reaches over the road)
        const armLat = lat - side * armLen / 2;
        m.makeBasis(frame.right, frame.up, back).scale(s.set(armLen, 0.18, 0.18));
        m.setPosition(frame.position.x + frame.right.x * armLat, baseY + poleH, frame.position.z + frame.right.z * armLat);
        poles.setMatrixAt(k * 2 + 1, m);
        // emissive head
        const headLat = lat - side * (armLen - 0.4);
        m.makeBasis(frame.right, frame.up, back).scale(s.set(1.4, 0.16, 0.5));
        m.setPosition(frame.position.x + frame.right.x * headLat, baseY + poleH - 0.12, frame.position.z + frame.right.z * headLat);
        heads.setMatrixAt(k, m);
        heads.setColorAt(k, lamp);
        if (st.lampsOn) {
          this.lamps.push({
            pos: new THREE.Vector3(frame.position.x + frame.right.x * headLat, baseY + poleH - 0.25, frame.position.z + frame.right.z * headLat),
            color: lampBase.clone(),
          });
        }
        k++;
      }
    }
    poles.count = k * 2;
    heads.count = k;
    poles.computeBoundingSphere();
    heads.computeBoundingSphere();
    this.group.add(poles, heads);
  }
}
