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

const FRAME_COLORS = ['#ff2bd6', '#00e5ff', '#ffb000', '#a64dff', '#3dff9e'].map((c) => new THREE.Color(c));

export class Billboards {
  readonly group = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;

  private readonly designCount: number;

  constructor(track: LoopTrack, roofSpots: RoofSpot[], faceSpots: FaceSpot[], seed: number, designList: BillboardDesign[]) {
    const rng = new Rng(seed ^ 0xb111b0a7);
    this.designCount = Math.max(1, Math.min(designList.length, ATLAS_COLS * ATLAS_ROWS));
    this.canvas = drawAtlas(designList);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    const placements: Placement[] = [];
    const frame = makeFrame();
    const hw = track.width / 2;

    // Roadside boards on poles, alternating sides, angled toward oncoming traffic.
    const spacing = 230;
    const count = Math.floor(track.length / spacing);
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      if (track.sectionAt(i * spacing + 60, 30)) continue;
      track.frameAt(i * spacing + 60, frame);
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

    this.build(placements, rng);
    void this.loadCustomImages();
  }

  private build(list: Placement[], rng: Rng): void {
    const n = list.length;
    const plane = new THREE.PlaneGeometry(1, 1);
    const cells = new Float32Array(n);
    const seeds = new Float32Array(n);
    const frameCols = new Float32Array(n * 3);

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...atmosphere, uAtlas: { value: this.texture } },
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
          vec2 inset = vUv * 0.98 + 0.01;
          vec2 auv = vec2((col + inset.x) / ${ATLAS_COLS}.0, (${ATLAS_ROWS}.0 - 1.0 - row + inset.y) / ${ATLAS_ROWS}.0);
          vec3 c = texture2D(uAtlas, auv).rgb * 1.6;
          // Scanlines + occasional flicker.
          c *= 0.88 + 0.12 * sin(vUv.y * 300.0);
          float t = floor(uTime * 14.0);
          float flick = h1(t + vSeed * 91.0) > 0.985 ? 0.25 : 1.0;
          c *= flick;
          // Neon frame.
          vec2 e = min(vUv, 1.0 - vUv);
          float border = 1.0 - smoothstep(0.0, 0.025, min(e.x, e.y * 2.0));
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
      const back = center.clone().addScaledVector(p.normal, -0.35);
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
