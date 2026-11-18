import * as THREE from 'three';
import { applyAtmosphere, ATMOS_PARS, atmosphere } from '../render/atmosphere';
import { LoopTrack, makeFrame } from '../track/Track';
import { Rng } from '../util/random';
import { ATLAS_COLS, ATLAS_ROWS, BillboardDesign, drawAtlas, drawImageIntoCell } from './billboardArt';
import type { LevelBuildResult } from '../levels/types';
type RoofSpot = NonNullable<LevelBuildResult['roofSpots']>[number];
type FaceSpot = NonNullable<LevelBuildResult['faceSpots']>[number];

interface Placement {
  pos: THREE.Vector3; // bottom-centre
  normal: THREE.Vector3; // facing direction (horizontal)
  w: number;
  h: number;
  /** height of support poles below the board */
  poleH: number;
}

/** Atlases by design list: drawn and uploaded once, reused by every race (World.dispose skips them). */
const atlasCache = new Map<string, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();

const FRAME_COLORS = ['#ff2bd6', '#00e5ff', '#ffb000', '#a64dff', '#3dff9e'].map((c) => new THREE.Color(c));

export class Billboards {
  readonly group = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;

  private readonly designCount: number;

  /** Where every board hangs: centre, width and height (for things that fly around and must not pass through). */
  readonly spots: { pos: THREE.Vector3; w: number; h: number }[] = [];

  /** Per-frame animation (underwater boards bob in the current); undefined for static neon boards. */
  update?: (time: number) => void;

  constructor(track: LoopTrack, roofSpots: RoofSpot[], faceSpots: FaceSpot[], seed: number, designList: BillboardDesign[], private readonly style: 'neon' | 'underwater' = 'neon',
    /** Stretches of roadside (track metres) where no board may stand; side -1 / 1, or 0 for both sides. */
    keepOut: { d0: number; d1: number; side: number }[] = []) {
    const rng = new Rng(seed ^ 0xb111b0a7);
    this.designCount = Math.max(1, Math.min(designList.length, ATLAS_COLS * ATLAS_ROWS));
    const key = designList.map((d) => d.name).join("|");
    let atlas = atlasCache.get(key);
    const fresh = !atlas;
    if (!atlas) {
      const canvas = drawAtlas(designList);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 16;
      texture.userData.persistent = true;
      atlas = { canvas, texture };
      atlasCache.set(key, atlas);
    }
    this.canvas = atlas.canvas;
    this.texture = atlas.texture;

    const placements: Placement[] = [];
    const frame = makeFrame();
    const hw = track.width / 2;

    // Roadside boards on poles, alternating sides, angled toward oncoming traffic.
    const spacing = 230;
    const count = Math.floor(track.length / spacing);
    const blocked = (d: number, side: number) => !!track.sectionAt(d, 30) || keepOut.some((k) => (k.side === 0 || k.side === side) && d > k.d0 && d < k.d1);
    for (let i = 0; i < count; i++) {
      let side = i % 2 === 0 ? 1 : -1;
      let d = i * spacing + 60;
      // Something else stands here (a crane, a bridge, a service lane): try the other side, then further along.
      let found = false;
      for (const off of [0, 30, -30, 60, -60, 90, -90]) {
        for (const sd of [side, -side]) if (!found && !blocked(d + off, sd)) { d += off; side = sd; found = true; }
        if (found) break;
      }
      if (!found) continue;
      track.frameAt(d, frame);
      const lat = side * (hw + 8);
      const pos = frame.position.clone().addScaledVector(frame.right, lat);
      pos.y += 4;
      const angle = THREE.MathUtils.degToRad(28);
      const normal = frame.forward.clone().negate().multiplyScalar(Math.cos(angle)).addScaledVector(frame.right, -side * Math.sin(angle)).normalize();
      placements.push({ pos, normal, w: 22, h: 11, poleH: 4 + frame.position.y });
    }

    // Rooftop boards on buildings below the skyway, facing the nearest road point.
    const roofs = roofSpots.slice(0, 28);
    for (const r of roofs) {
      const idx = track.nearestSample(r.x, r.z);
      const target = track.samples[idx];
      const normal = new THREE.Vector3(target.x - r.x, 0, target.z - r.z).normalize();
      const w = Math.min(r.w * 0.9, 42);
      placements.push({ pos: new THREE.Vector3(r.x, r.y + 4, r.z), normal, w, h: w / 2, poleH: 4 });
    }

    // Screens mounted on tower faces (no legs).
    for (const f of faceSpots.slice(0, 30)) {
      placements.push({ pos: f.pos, normal: f.normal, w: f.w, h: f.h, poleH: 0 });
    }

    for (const pl of placements) this.spots.push({ pos: pl.pos.clone(), w: pl.w, h: pl.h });
    if (this.style === 'underwater') this.buildUnderwater(placements, rng);
    else this.build(placements, rng);
    if (fresh) void this.loadCustomImages();
  }

  private build(list: Placement[], rng: Rng): void {
    const n = list.length;
    const plane = new THREE.PlaneGeometry(1, 1);
    const cells = new Float32Array(n);
    const seeds = new Float32Array(n);
    const frameCols = new Float32Array(n * 3);

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...atmosphere, uAtlas: { value: this.texture } },
      // Pulled toward the camera in depth so it never fights the back panel far away.
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      vertexShader: /* glsl */ `
        attribute float aCell;
        attribute float aSeed;
        attribute vec3 aFrame;
        varying vec2 vUv;
        flat varying float vCell;
        flat varying float vSeed;
        flat varying vec3 vFrame;
        varying vec3 vWorld;
        void main() {
          vUv = uv; vCell = aCell; vSeed = aSeed; vFrame = aFrame;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying vec2 vUv;
        flat varying float vCell;
        flat varying float vSeed;
        flat varying vec3 vFrame;
        varying vec3 vWorld;
        ${ATMOS_PARS}
        float h1(float p) { return fract(sin(p * 127.1) * 43758.5453); }
        void main() {
          float col = mod(vCell, ${ATLAS_COLS}.0);
          float row = floor(vCell / ${ATLAS_COLS}.0);
          // Keep samples away from the neighbouring atlas cells (more margin at low mip levels far away).
          float m = clamp(max(fwidth(vUv.x), fwidth(vUv.y)) * 3.0, 0.01, 0.12);
          vec2 inset = vUv * (1.0 - 2.0 * m) + m;
          vec2 auv = vec2((col + inset.x) / ${ATLAS_COLS}.0, (${ATLAS_ROWS}.0 - 1.0 - row + inset.y) / ${ATLAS_ROWS}.0);
          vec3 c = texture2D(uAtlas, auv).rgb * 1.6;
          // Scanlines (faded out once they get finer than a pixel: no shimmer at a distance) + occasional flicker.
          float sl = vUv.y * 300.0;
          float slFade = 1.0 - smoothstep(0.15, 0.45, fwidth(sl) / 6.2832);
          c *= mix(0.94, 0.88 + 0.12 * sin(sl), slFade);
          float t = floor(uTime * 14.0);
          // A tired neon tube blinking now and then: only on boards close by (from far away a whole board
          // blinking reads as a rendering glitch), and a dip rather than a blackout.
          float nearK = 1.0 - smoothstep(90.0, 220.0, distance(cameraPosition, vWorld));
          float flick = h1(t + vSeed * 91.0) > 0.985 ? 0.55 : 1.0;
          c *= mix(1.0, flick, nearK);
          // Neon frame.
          vec2 e = min(vUv, 1.0 - vUv);
          float ed = min(e.x, e.y * 2.0);
          float bw = max(0.025, fwidth(ed) * 1.5); // never thinner than ~1.5 px (anti-aliased)
          float border = 1.0 - smoothstep(bw * 0.6, bw, ed);
          c = mix(c, vFrame * 4.0, border);
          gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
        }`,
    });
    const boards = new THREE.InstancedMesh(plane, mat, n);

    const box = new THREE.BoxGeometry(1, 1, 1);
    const metal = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#16141e', roughness: 0.6, metalness: 0.5 }));
    const structure = new THREE.InstancedMesh(box, metal, n * 3);

    const m = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3();
    const s = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    list.forEach((p, i) => {
      xAxis.crossVectors(up, p.normal).normalize();
      const center = tmp.copy(p.pos).addScaledVector(up, p.h / 2);
      m.makeBasis(xAxis, up, p.normal).scale(s.set(p.w, p.h, 1)).setPosition(center);
      boards.setMatrixAt(i, m);
      // Back panel.
      const back = center.clone().addScaledVector(p.normal, -0.6); // front face 30 cm behind the screen
      m.makeBasis(xAxis, up, p.normal).scale(s.set(p.w + 0.6, p.h + 0.6, 0.6)).setPosition(back);
      structure.setMatrixAt(i * 3, m);
      // Two legs.
      for (let k = 0; k < 2; k++) {
        if (p.poleH <= 0) {
          structure.setMatrixAt(i * 3 + 1 + k, m.makeScale(0, 0, 0));
          continue;
        }
        const legX = (k === 0 ? -1 : 1) * p.w * 0.3;
        const legPos = p.pos.clone().addScaledVector(xAxis, legX).addScaledVector(p.normal, -0.4);
        legPos.y -= p.poleH / 2;
        m.makeBasis(xAxis, up, p.normal).scale(s.set(0.7, p.poleH, 0.7)).setPosition(legPos);
        structure.setMatrixAt(i * 3 + 1 + k, m);
      }
      cells[i] = (this.designCount % 7 ? i * 7 : i) % this.designCount;
      seeds[i] = rng.next();
      const fc = rng.pick(FRAME_COLORS);
      frameCols.set([fc.r, fc.g, fc.b], i * 3);
    });
    plane.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1));
    plane.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    plane.setAttribute('aFrame', new THREE.InstancedBufferAttribute(frameCols, 3));
    boards.computeBoundingSphere();
    structure.computeBoundingSphere();
    this.group.add(boards, structure);
  }

  /**
   * Underwater boards: a weathered sign in a rusty frame, held up by two orange buoys and anchored by a chain
   * into the depths. No neon — the art looks printed, a bit faded and algae-stained, and bubbles rise from it.
   * Each board bobs and sways gently in the current.
   */
  private buildUnderwater(list: Placement[], rng: Rng): void {
    const rust = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#6b4a34', roughness: 0.9, metalness: 0.3 }));
    const buoyMat = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#ff7020', roughness: 0.5, emissive: '#5a1800', emissiveIntensity: 0.4 }));
    const bandMat = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.6 }));
    const chainMat = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.8, metalness: 0.6 }));
    const boards: { g: THREE.Group; base: THREE.Vector3; phase: number }[] = [];
    const bubbleMats: THREE.ShaderMaterial[] = [];
    list.forEach((p, i) => {
      const w = p.w * 0.8, h = p.h * 0.8;
      const g = new THREE.Group();
      const cell = (this.designCount % 7 ? i * 7 : i) % this.designCount;
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...atmosphere, uAtlas: { value: this.texture }, uCell: { value: cell }, uSeed: { value: rng.next() } },
        vertexShader: 'varying vec2 vUv; varying vec3 vWorld; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: /* glsl */ `
          uniform sampler2D uAtlas; uniform float uCell, uSeed;
          varying vec2 vUv; varying vec3 vWorld;
          ${ATMOS_PARS}
          float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
          void main() {
            float col = mod(uCell, ${ATLAS_COLS}.0);
            float row = floor(uCell / ${ATLAS_COLS}.0);
            vec2 inset = vUv * 0.98 + 0.01;
            vec2 auv = vec2((col + inset.x) / ${ATLAS_COLS}.0, (${ATLAS_ROWS}.0 - 1.0 - row + inset.y) / ${ATLAS_ROWS}.0);
            vec3 c = texture2D(uAtlas, auv).rgb;
            // Printed and sun-faded under water: less saturated, tinted by the sea.
            float l = dot(c, vec3(0.3, 0.55, 0.15));
            c = mix(c, vec3(l), 0.25) * vec3(0.85, 1.0, 1.05) * 0.95;
            // Algae and grime creeping up from the bottom edge, darker towards the corners.
            float n = vn(vUv * vec2(18.0, 9.0) + uSeed * 40.0) * 0.6 + vn(vUv * 50.0) * 0.4;
            float algae = smoothstep(0.42, 0.0, vUv.y + n * 0.25 - 0.08);
            c = mix(c, vec3(0.08, 0.2, 0.12), algae * 0.75);
            vec2 e = min(vUv, 1.0 - vUv);
            c *= 0.65 + 0.35 * smoothstep(0.0, 0.18, min(e.x, e.y * 2.0));
            gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
          }`,
      });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      g.add(board);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, h + 0.5, 0.35), rust);
      back.position.z = -0.45; // front face well behind the sign (no depth fighting far away)
      g.add(back);
      for (const [fw, fh, fx, fy] of [[w + 0.9, 0.35, 0, h / 2 + 0.3], [w + 0.9, 0.35, 0, -h / 2 - 0.3], [0.35, h + 0.9, w / 2 + 0.3, 0], [0.35, h + 0.9, -w / 2 - 0.3, 0]]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.5), rust);
        f.position.set(fx, fy, 0);
        g.add(f);
      }
      for (const sx of [-1, 1]) {
        const buoy = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 32), buoyMat);
        buoy.position.set(sx * w * 0.36, h / 2 + 1.4, 0);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.3, 48), bandMat);
        band.position.copy(buoy.position);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 16), chainMat);
        rope.position.set(sx * w * 0.36, h / 2 + 0.55, 0);
        g.add(buoy, band, rope);
      }
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 40, 16), chainMat);
      chain.position.set(0, -h / 2 - 20, -0.2);
      g.add(chain);
      // Bubbles rising from the board (simulated in the vertex shader, looping).
      const N = 26;
      const bpos = new Float32Array(N * 3), bseed = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        bpos.set([(rng.next() - 0.5) * w, -h / 2 + rng.next() * h * 0.4, (rng.next() - 0.5) * 1.5 + 0.6], k * 3);
        bseed[k] = rng.next();
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
      bg.setAttribute('aSeed', new THREE.BufferAttribute(bseed, 1));
      const bmat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uTime: atmosphere.uTime, uRise: { value: h + 6 } },
        vertexShader: `attribute float aSeed; uniform float uTime, uRise; varying float vA;
          void main() {
            float t = fract(uTime * (0.12 + aSeed * 0.1) + aSeed);
            vec3 p = position + vec3(sin(uTime * 2.0 + aSeed * 30.0) * 0.15, t * uRise, 0.0);
            vA = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.75, 1.0, t));
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = (2.0 + aSeed * 3.0) * 170.0 / max(-mv.z, 1.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `varying float vA;
          void main() { float r = length(gl_PointCoord - 0.5); float ring = smoothstep(0.3, 0.42, r) * smoothstep(0.5, 0.44, r) + 0.5 * smoothstep(0.14, 0.0, length(gl_PointCoord - vec2(0.36, 0.34)));
            if (ring * vA < 0.02) discard; gl_FragColor = vec4(vec3(0.8, 0.95, 1.0), ring * vA * 0.8); }`,
      });
      bubbleMats.push(bmat);
      const bubbles = new THREE.Points(bg, bmat);
      bubbles.frustumCulled = false;
      g.add(bubbles);
      // Orient like the neon board would face, a bit higher: it floats.
      const up = new THREE.Vector3(0, 1, 0);
      const xAxis = new THREE.Vector3().crossVectors(up, p.normal).normalize();
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, up, p.normal));
      const base = p.pos.clone().addScaledVector(up, h / 2 + 3);
      g.position.copy(base);
      this.group.add(g);
      boards.push({ g, base, phase: rng.next() * Math.PI * 2 });
    });
    const tmpQ = new THREE.Quaternion();
    const baseQ = boards.map((b) => b.g.quaternion.clone());
    const sway = new THREE.Euler();
    this.update = (time: number) => {
      boards.forEach((b, i) => {
        b.g.position.y = b.base.y + Math.sin(time * 0.6 + b.phase) * 0.7;
        sway.set(Math.sin(time * 0.45 + b.phase) * 0.03, 0, Math.sin(time * 0.37 + b.phase * 1.3) * 0.05);
        b.g.quaternion.copy(baseQ[i]).multiply(tmpQ.setFromEuler(sway));
      });
    };
  }

  /** Replace atlas cells with images listed in public/billboards/manifest.json. */
  private async loadCustomImages(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}billboards/manifest.json`);
      if (!res.ok) return;
      const manifest = (await res.json()) as { images?: string[] };
      const files = (manifest.images ?? []).slice(0, ATLAS_COLS * ATLAS_ROWS);
      await Promise.all(
        files.map(
          (file, i) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                drawImageIntoCell(this.canvas, img, i);
                this.texture.needsUpdate = true;
                resolve();
              };
              img.onerror = () => resolve();
              img.src = `${import.meta.env.BASE_URL}billboards/${file}`;
            }),
        ),
      );
    } catch {
      /* no custom images */
    }
  }
}
