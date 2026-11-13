import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyAtmosphere, ATMOS_PARS, atmosphere } from '../render/atmosphere';
import { LoopTrack, makeFrame, TrackFrame, TrackSection } from '../track/Track';
import { ROAD_STYLE } from './Road';
import { extrude, neonStripMaterial, rectProfile } from './trackGeometry';

// Section neon colours (set per level by the constructor).
const CYAN = new THREE.Color('#00e5ff');
const MAGENTA = new THREE.Color('#ff2bd6');

/** Collects oriented boxes, then builds one InstancedMesh. */
class BoxBatch {
  private readonly mats: THREE.Matrix4[] = [];
  private readonly cols: THREE.Color[] = [];
  private static readonly back = new THREE.Vector3();

  /** Box centred at lateral `lat`, height `y`, `along` metres ahead of the frame; size w (lateral) x h x depth (along). */
  add(f: TrackFrame, lat: number, y: number, along: number, w: number, h: number, depth: number, color?: THREE.Color): void {
    const back = BoxBatch.back.copy(f.forward).negate();
    const m = new THREE.Matrix4().makeBasis(f.right, f.up, back).scale(new THREE.Vector3(w, h, depth));
    m.setPosition(
      f.position.x + f.right.x * lat + f.forward.x * along,
      f.position.y + y,
      f.position.z + f.right.z * lat + f.forward.z * along,
    );
    this.mats.push(m);
    this.cols.push(color ?? new THREE.Color(1, 1, 1));
  }

  build(material: THREE.Material, useColors = false): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, Math.max(1, this.mats.length));
    this.mats.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      if (useColors) mesh.setColorAt(i, this.cols[i]);
    });
    mesh.count = this.mats.length;
    mesh.computeBoundingSphere();
    return mesh;
  }
}

/** Dark interior panels with seams and a soft glow near the ceiling lights. */
function tunnelPanelMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld;
      ${ATMOS_PARS}
      void main() {
        vec2 p = vec2(vUv.x / 1.6, vUv.y / 4.0);
        vec2 f = abs(fract(p) - 0.5);
        float seam = smoothstep(0.47, 0.5, max(f.x, f.y));
        vec3 col = vec3(0.012, 0.011, 0.02) * (1.0 - seam * 0.7);
        // Light wash from the dashed ceiling strips (stronger near the ceiling, u is metres along profile).
        float dash = 0.6 + 0.4 * sin(vUv.y / 6.0 * 6.2831);
        float nearCeil = smoothstep(4.0, 7.5, vUv.x) * (1.0 - smoothstep(18.0, 21.5, vUv.x));
        col += vec3(1.0, 0.7, 0.45) * (0.006 + 0.02 * nearCeil) * dash;
        gl_FragColor = vec4(applyAtmos(col, vWorld), 1.0);
      }`,
  });
}

export class Structures {
  readonly group = new THREE.Group();
  private readonly metal = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#1c1a26', roughness: 0.45, metalness: 0.7 }));
  private readonly concrete = applyAtmosphere(new THREE.MeshStandardMaterial({ color: '#24222f', roughness: 0.8, metalness: 0.15 }));
  private readonly neonBatch = new BoxBatch();
  private readonly metalBatch = new BoxBatch();
  private readonly concreteBatch = new BoxBatch();

  /** Height the posts / tunnel walls start at: on top of solid road walls, else on the deck itself. */
  private readonly base: number;

  constructor(private readonly track: LoopTrack, colors?: { concrete: string; metal: string; neonA: string; neonB: string; solidWalls?: boolean }) {
    this.base = colors?.solidWalls === false ? 0 : ROAD_STYLE.wallHeight;
    if (colors) {
      (this.concrete as THREE.MeshStandardMaterial).color.set(colors.concrete);
      (this.metal as THREE.MeshStandardMaterial).color.set(colors.metal);
      CYAN.set(colors.neonA);
      MAGENTA.set(colors.neonB);
    }
    for (const s of track.sections) {
      if (s.type === 'tunnel') this.buildTunnel(s);
      else this.buildCanopy(s);
    }
    this.group.add(
      this.neonBatch.build(applyAtmosphere(new THREE.MeshBasicMaterial({ color: '#ffffff' })), true),
      this.metalBatch.build(this.metal),
      this.concreteBatch.build(this.concrete),
    );
  }

  private buildTunnel(s: TrackSection): void {
    const track = this.track;
    const hw = track.width / 2;
    const t = ROAD_STYLE.wallThickness;
    const wh = this.base;
    const dd = ROAD_STYLE.deckDepth;
    const H = 7.5;
    const outer = hw + t + 0.6;
    const range = { d0: s.start, d1: s.end, step: 3 };

    // Interior shell (chamfered box).
    this.group.add(
      new THREE.Mesh(
        extrude(track, [[-hw, wh], [-hw, H - 1.2], [-hw + 1.6, H], [hw - 1.6, H], [hw, H - 1.2], [hw, wh]], range),
        tunnelPanelMaterial(),
      ),
    );
    // Outer shell.
    this.group.add(new THREE.Mesh(extrude(track, [[-outer, -dd], [-outer, H + 0.9], [outer, H + 0.9], [outer, -dd]], range), this.concrete));

    // Interior lights: dashed warm ceiling strips + continuous side neon.
    const warm = neonStripMaterial('#ffc58a', 3.2, [6, 0.6]);
    this.group.add(new THREE.Mesh(extrude(track, [[-3.5, H - 0.08], [-2.5, H - 0.08]], range), warm));
    this.group.add(new THREE.Mesh(extrude(track, [[2.5, H - 0.08], [3.5, H - 0.08]], range), warm));
    this.group.add(new THREE.Mesh(extrude(track, [[-hw + 0.08, 3.0], [-hw + 0.08, 3.3]], range), neonStripMaterial(CYAN, 2.5)));
    this.group.add(new THREE.Mesh(extrude(track, [[hw - 0.08, 3.0], [hw - 0.08, 3.3]], range), neonStripMaterial(MAGENTA, 2.5)));
    // Speed markers: short bright dashes low on the walls.
    const dashes = neonStripMaterial('#ffffff', 2.0, [12, 0.15]);
    this.group.add(new THREE.Mesh(extrude(track, [[-hw + 0.08, 1.6], [-hw + 0.08, 1.75]], range), dashes));
    this.group.add(new THREE.Mesh(extrude(track, [[hw - 0.08, 1.6], [hw - 0.08, 1.75]], range), dashes));

    // Outside: glowing window band + neon roof edges (reads as a lit tube from across the city).
    const windows = neonStripMaterial('#ffb070', 1.4, [5, 0.7]);
    this.group.add(new THREE.Mesh(extrude(track, [[-outer - 0.08, 2.5], [-outer - 0.08, 4.8]], range), windows));
    this.group.add(new THREE.Mesh(extrude(track, [[outer + 0.08, 2.5], [outer + 0.08, 4.8]], range), windows));
    this.group.add(new THREE.Mesh(extrude(track, rectProfile(-outer, H + 0.9, 0.25, 0.25), { ...range, closedProfile: true }), neonStripMaterial(CYAN, 3)));
    this.group.add(new THREE.Mesh(extrude(track, rectProfile(outer, H + 0.9, 0.25, 0.25), { ...range, closedProfile: true }), neonStripMaterial(MAGENTA, 3)));

    // Portals at both ends.
    const f = makeFrame();
    for (const [d, dir] of [[s.start, -1], [s.end, 1]] as const) {
      track.frameAt(d, f);
      const postW = 2.4;
      const top = H + 2.6;
      const postH = top + dd;
      for (const side of [-1, 1]) {
        this.concreteBatch.add(f, side * (hw + postW / 2), top - postH / 2, 0, postW, postH, 1.8);
        // Neon outline on the opening.
        this.neonBatch.add(f, side * (hw + 0.12), (wh + H - 0.4) / 2, dir * 0.95, 0.2, H - 0.4 - wh, 0.12, (side < 0 ? CYAN : MAGENTA).clone().multiplyScalar(4));
      }
      this.concreteBatch.add(f, 0, (H - 0.4 + top) / 2, 0, 2 * (hw + postW), top - (H - 0.4), 1.8);
      this.neonBatch.add(f, 0, H - 0.45, dir * 0.95, 2 * hw, 0.2, 0.12, new THREE.Color('#ffb000').multiplyScalar(4));
      // Chevron of lights on the lintel face.
      for (let i = -6; i <= 6; i++) {
        this.neonBatch.add(f, i * 1.4, H + 1.2, dir * 0.95, 0.7, 0.5, 0.12, new THREE.Color(i % 2 ? '#ff2bd6' : '#00e5ff').multiplyScalar(3));
      }
    }
  }

  private buildCanopy(s: TrackSection): void {
    const track = this.track;
    const hw = track.width / 2;
    const t = ROAD_STYLE.wallThickness;
    const wh = this.base;
    const H = 8;
    const f = makeFrame();
    const postLat = hw + t / 2;

    // Arches every 5 m; every 20 m (aligned with road shader) a neon arch.
    for (let d = Math.ceil(s.start / 5) * 5; d <= s.end; d += 5) {
      track.frameAt(d, f);
      for (const side of [-1, 1]) this.metalBatch.add(f, side * postLat, (wh + H) / 2, 0, 0.4, H - wh, 0.4);
      this.metalBatch.add(f, 0, H, 0, 2 * postLat + 0.4, 0.5, 0.4);
      // Diagonal knee braces.
      for (const side of [-1, 1]) this.metalBatch.add(f, side * (postLat - 0.9), H - 0.9, 0, 0.18, 2.2, 0.18);
      if (d % 20 === 0) {
        const c = (Math.floor(d / 20) % 2 === 0 ? CYAN : MAGENTA).clone().multiplyScalar(4);
        this.neonBatch.add(f, 0, H - 0.32, 0, 2 * hw - 0.4, 0.1, 0.18, c);
        for (const side of [-1, 1]) this.neonBatch.add(f, side * (hw - 0.08), (wh + H) / 2 + 0.3, 0, 0.1, H - wh - 1.6, 0.18, c);
      }
    }

    // Longitudinal beams forming the roof grid.
    const range = { d0: s.start, d1: s.end, step: 4, closedProfile: true };
    const beams: THREE.BufferGeometry[] = [];
    for (let lat = -hw; lat <= hw + 0.01; lat += 3) beams.push(extrude(track, rectProfile(lat, H + 0.1, 0.22, 0.3), range));
    this.group.add(new THREE.Mesh(mergeGeometries(beams), this.metal));

    // Cross bracing between beams (makes it a real grid / lattice).
    for (let d = Math.ceil(s.start / 5) * 5 + 2.5; d <= s.end; d += 5) {
      track.frameAt(d, f);
      for (let lat = -hw + 1.5; lat <= hw; lat += 3) this.metalBatch.add(f, lat, H + 0.1, 0, 3, 0.1, 0.1);
    }

    // Tinted glass roof.
    const glass = applyAtmosphere(
      new THREE.MeshStandardMaterial({
        color: '#1a2a55', metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    this.group.add(new THREE.Mesh(extrude(track, [[-postLat, H + 0.28], [postLat, H + 0.28]], { d0: s.start, d1: s.end, step: 4 }), glass));
    // Neon trim along the canopy edges.
    this.group.add(new THREE.Mesh(extrude(track, rectProfile(-postLat, H + 0.4, 0.15, 0.15), range), neonStripMaterial(CYAN, 3)));
    this.group.add(new THREE.Mesh(extrude(track, rectProfile(postLat, H + 0.4, 0.15, 0.15), range), neonStripMaterial(MAGENTA, 3)));
  }
}
