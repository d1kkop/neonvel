import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { atmosphere } from '../../render/atmosphere';

/**
 * Cyber Grid set pieces:
 *  - code rain: holographic panels of falling green characters (screens in the air, tall pillars far away);
 *  - the Trojan horse: a giant wooden-toy horse on wheels, drawn in neon outlines, code running over its flanks,
 *    green light leaking from the hatch in its belly;
 *  - the worm: a long spiked, segmented virus that winds through the air above the track.
 * Everything is unlit and glows through the bloom pass; nothing here can be driven into.
 */

// ------------------------------------------------------------------ code rain

const GLYPHS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ{}<>[]()/\\;:=+-*#$%&@!?^~|_.,'; // 64 characters
let glyphTex: THREE.CanvasTexture | null = null;

/** 8 x 8 atlas of white characters on black. */
function glyphAtlas(): THREE.CanvasTexture {
  if (glyphTex) return glyphTex;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#fff';
  g.font = 'bold 50px Consolas, "Courier New", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 64; i++) g.fillText(GLYPHS[i % GLYPHS.length], (i % 8) * 64 + 32, Math.floor(i / 8) * 64 + 34);
  glyphTex = new THREE.CanvasTexture(c);
  glyphTex.userData.persistent = true; // shared between level loads
  glyphTex.generateMipmaps = true;
  glyphTex.minFilter = THREE.LinearMipmapLinearFilter;
  return glyphTex;
}

export interface CodePanel {
  x: number; y: number; z: number;
  /** Width and height in metres. */
  w: number; h: number;
  yaw: number;
  /** Character height in metres. */
  glyph: number;
  color: THREE.Color;
}

/**
 * Falling-code panels, one draw call. Each column falls at its own speed with a bright head and a fading
 * tail; the characters keep changing. The beat makes the heads flare.
 */
export function createCodePanels(list: CodePanel[]): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  const info = new Float32Array(list.length * 4); // columns, rows, seed, unused
  const col = new Float32Array(list.length * 3);
  list.forEach((p, i) => {
    info.set([Math.max(1, Math.round(p.w / (p.glyph * 0.62))), Math.max(1, Math.round(p.h / p.glyph)), (i * 0.618 + p.x * 0.013) % 1, 0], i * 4);
    col.set([p.color.r, p.color.g, p.color.b], i * 3);
  });
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { ...atmosphere, uGlyphs: { value: glyphAtlas() } },
    vertexShader: /* glsl */ `
      attribute vec4 aInfo; attribute vec3 aColor;
      varying vec2 vUv; varying vec4 vInfo; varying vec3 vColor; varying float vDist;
      void main() {
        vUv = uv; vInfo = aInfo; vColor = aColor;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vDist = length(w.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uGlyphs; uniform float uTime, uBeatPulse;
      varying vec2 vUv; varying vec4 vInfo; varying vec3 vColor; varying float vDist;
      float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main() {
        vec2 grid = vInfo.xy;
        vec2 uv = vec2(vUv.x, 1.0 - vUv.y) * grid;   // rows counted from the top
        vec2 cell = floor(uv);
        vec2 f = fract(uv);
        float cs = h21(vec2(cell.x + 0.5, vInfo.z * 91.0));
        // Head position of this column's drop (rows from the top), wrapping with a gap before the next drop.
        float trail = 6.0 + cs * 14.0;
        float speed = 5.0 + 11.0 * h21(vec2(cell.x + 7.3, vInfo.z * 37.0));
        float cycle = grid.y + trail + cs * 7.0;
        float head = mod(uTime * speed + cs * 53.0, cycle);
        float d = head - cell.y;                      // rows behind the head
        float lit = d >= 0.0 && d < trail ? 1.0 - d / trail : 0.0;
        if (lit <= 0.0) discard;
        // The character in a cell changes a few times a second (faster near the head).
        float tick = floor(uTime * (2.0 + 6.0 * h21(cell + vInfo.z)) + h21(cell) * 10.0);
        float idx = floor(h21(cell + tick * 0.37 + vInfo.z * 3.0) * 64.0);
        // Readable from both sides: seen from behind, each character is flipped back.
        if (!gl_FrontFacing) f.x = 1.0 - f.x;
        // Atlas cell (column, row from the top of the canvas); the texture's v axis runs the other way.
        vec2 guv = (vec2(mod(idx, 8.0), floor(idx / 8.0)) + vec2(0.12 + f.x * 0.76, f.y)) / 8.0;
        guv.y = 1.0 - guv.y;
        float g = texture2D(uGlyphs, guv).r;
        float headK = 1.0 - smoothstep(0.0, 1.2, d);
        // The trail glows in the panel's colour (bright enough to bloom a little); the head is white-hot.
        vec3 col = mix(vColor * 2.2, vec3(0.85, 1.0, 0.92) * 4.5, headK) * (1.0 + 0.6 * uBeatPulse * headK);
        float fade = 1.0 - smoothstep(1000.0, 1900.0, vDist);
        float a = g * (0.25 + 0.75 * lit) * fade;
        // A faint glow behind the characters, so a column reads as a streak of light even where the
        // characters are too small to see.
        a += lit * mix(0.05, 0.16, smoothstep(40.0, 300.0, vDist)) * fade;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((p, i) => {
    q.setFromAxisAngle(up, p.yaw);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.w, p.h, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.count = list.length;
  mesh.computeBoundingSphere();
  mesh.renderOrder = 5;
  return mesh;
}

// ------------------------------------------------------------------ shared: neon solids + labels

/** Near-black faces with glowing edges (the level's wireframe look). */
function neonSolid(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, k = 2.6, face = '#04060c'): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: face, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) })));
  return g;
}

function label(text: string, color: string, height: number): THREE.Sprite {
  const font = 'bold 96px Consolas, "Courier New", monospace';
  const c = document.createElement('canvas');
  let g = c.getContext('2d')!;
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 80;
  c.height = 160;
  g = c.getContext('2d')!;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 24;
  g.fillStyle = color;
  g.fillText(text, c.width / 2, 84);
  g.shadowBlur = 6;
  g.fillStyle = '#ffffff';
  g.fillText(text, c.width / 2, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(height * (c.width / c.height), height, 1);
  return s;
}

// ------------------------------------------------------------------ Trojan horse

/**
 * The wooden gift horse, 1 unit = 1 m at scale 1 (about 16 m tall): platform on four wheels, plank body with a
 * hatch, neck, head with ears, mane and tail. Faces +X.
 */
export function createTrojanHorse(codeColor = '#3dff9e'): THREE.Group {
  const g = new THREE.Group();
  g.name = 'trojan-horse';
  const wood = '#00e5ff';
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, rz = 0, color: THREE.ColorRepresentation = wood) => {
    const b = neonSolid(new THREE.BoxGeometry(w, h, d), color);
    b.position.set(x, y, z);
    b.rotation.z = rz;
    g.add(b);
    return b;
  };
  // Platform and wheels.
  box(15, 0.7, 6.4, 0, 1.9, 0, 0, '#ff2bd6');
  for (const [x, z] of [[-5.2, 3.5], [5.2, 3.5], [-5.2, -3.5], [5.2, -3.5]] as const) {
    const w = neonSolid(new THREE.CylinderGeometry(1.5, 1.5, 0.6, 16).rotateX(Math.PI / 2), '#ffe14d');
    w.position.set(x, 1.5, z);
    w.name = 'wheel';
    g.add(w);
  }
  // Legs (slightly splayed), barrel body, chest and rump blocks.
  for (const [x, z, rz] of [[-3.8, 1.7, -0.06], [3.6, 1.7, 0.06], [-3.8, -1.7, -0.06], [3.6, -1.7, 0.06]] as const) box(1.1, 5.2, 1.1, x, 4.8, z, rz);
  box(10.5, 4.2, 4.6, 0, 9.2, 0);
  box(2.2, 3.4, 4.2, 5.6, 9.6, 0, 0.25);
  box(2.0, 3.6, 4.2, -5.7, 9.3, 0, -0.2);
  // Neck, head, muzzle, ears.
  box(2.6, 6.2, 2.6, 6.1, 13.6, 0, -0.5);
  box(4.6, 2.5, 2.4, 8.9, 16.4, 0, -0.3);
  box(2.0, 1.7, 2.0, 11.2, 15.5, 0, -0.3);
  for (const z of [-0.8, 0.8]) {
    const ear = neonSolid(new THREE.ConeGeometry(0.45, 1.5, 4), wood);
    ear.position.set(7.6, 18.2, z);
    g.add(ear);
  }
  // Mane (a comb of planks down the neck) and tail.
  for (let i = 0; i < 6; i++) box(0.5, 1.5, 0.5, 6.4 - i * 0.62 + 0.9, 17.3 - i * 1.05, 0, -0.5 + 0.9, '#ff2bd6');
  box(0.8, 4.6, 0.8, -7.4, 8.6, 0, -0.45, '#ff2bd6');
  // Plank lines on the flanks are the box edges; the hatch in the belly leaks green light.
  for (const z of [2.32, -2.32]) {
    const hatch = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(codeColor).multiplyScalar(2.2), side: THREE.DoubleSide }));
    hatch.position.set(-1.2, 8.8, z);
    g.add(hatch);
  }
  // Code runs over both flanks.
  const panels: CodePanel[] = [];
  const c = new THREE.Color(codeColor).multiplyScalar(1.4);
  for (const z of [2.36, -2.36]) panels.push({ x: 0.4, y: 9.3, z: z * 1.01, w: 10.2, h: 4.0, yaw: 0, glyph: 0.42, color: c });
  g.add(createCodePanels(panels));
  // Eyes.
  for (const z of [-1.22, 1.22]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a4a').multiplyScalar(4) }));
    eye.position.set(9.6, 16.9, z);
    g.add(eye);
  }
  const tag = label('TROJAN.EXE', '#00e5ff', 3.2);
  tag.position.set(1, 22.5, 0);
  g.add(tag);
  return g;
}

// ------------------------------------------------------------------ virus worm

const WORM_SEGMENTS = 52;

/** One body segment: a squashed ball with a ring of spikes; vertex attribute aGlow marks the glowing parts. */
function wormSegmentGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const mark = (geo: THREE.BufferGeometry, glow: number) => {
    geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(glow), 1));
    return geo.index ? geo.toNonIndexed() : geo;
  };
  // Slightly long along the body (z) so neighbouring segments overlap into one continuous worm.
  parts.push(mark(new THREE.SphereGeometry(1, 22, 14).scale(1, 1, 1.25), 0));
  parts.push(mark(new THREE.TorusGeometry(1.0, 0.13, 8, 28), 1)); // glowing band round the middle
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spike = new THREE.ConeGeometry(0.14, 0.7, 6).translate(0, 1.25, 0).rotateZ(a);
    parts.push(mark(spike, 1));
  }
  return mergeGeometries(parts)!;
}

/**
 * The worm: a chain of spiked segments following a looping path over the track, a head with glowing eyes and
 * mandibles in front, "WORM.EXE" floating above it. Call update(time) every frame.
 */
export class VirusWorm {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly head = new THREE.Group();
  private readonly jaws: THREE.Object3D[] = [];
  private readonly tag: THREE.Sprite;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly p2 = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly look = new THREE.Matrix4();
  private readonly qRoll = new THREE.Quaternion();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  /**
   * @param center  middle of the loop it flies (world)
   * @param radius  size of the loop (m)
   * @param height  base flying height above `center.y`
   */
  constructor(private readonly center: THREE.Vector3, private readonly radius: number, private readonly height: number, color = '#ff2a4a', private readonly size = 3.2) {
    this.group.name = 'virus-worm';
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...atmosphere, uColor: { value: new THREE.Color(color) } },
      vertexShader: /* glsl */ `
        attribute float aGlow;
        varying float vGlow; varying vec3 vN; varying vec3 vW;
        void main() {
          vGlow = aGlow;
          mat4 m = modelMatrix * instanceMatrix;
          vec4 w = m * vec4(position, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(m) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uBeatPulse, uTime;
        varying float vGlow; varying vec3 vN; varying vec3 vW;
        void main() {
          vec3 v = normalize(cameraPosition - vW);
          float rim = pow(clamp(1.0 - abs(dot(normalize(vN), v)), 0.0, 1.0), 2.2);
          // Lit body (not a dark silhouette): base colour, bright rim, and data pulses running down the worm.
          float run = pow(0.5 + 0.5 * sin(dot(vW, vec3(0.09, 0.05, 0.07)) * 3.0 - uTime * 6.0), 6.0);
          vec3 body = uColor * (0.32 + rim * 2.2 + run * 0.9);
          vec3 glow = uColor * (3.0 + 1.6 * uBeatPulse) + vec3(0.4);
          gl_FragColor = vec4(mix(body, glow, vGlow), 1.0);
        }`,
    });
    this.body = new THREE.InstancedMesh(wormSegmentGeometry(), mat, WORM_SEGMENTS);
    this.body.frustumCulled = false;
    this.group.add(this.body);
    // Head: a bigger ball, two eyes, two mandibles that open and close.
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1.35, 24, 16).scale(1, 0.9, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) }));
    const rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.6) });
    const crest = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.1, 8, 32), rimMat);
    this.head.add(skull, crest);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe14d').multiplyScalar(4) }));
      eye.position.set(sx * 0.62, 0.5, -1.25);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicMaterial({ color: '#000000' }));
      pupil.position.set(sx * 0.66, 0.5, -1.62);
      const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.28, 2.0, 6).rotateX(-Math.PI / 2).translate(0, 0, -1.0), rimMat);
      jaw.position.set(sx * 0.7, -0.35, -1.2);
      this.head.add(pupil);
      this.jaws.push(jaw);
      this.head.add(eye, jaw);
    }
    this.head.scale.setScalar(size);
    this.group.add(this.head);
    this.tag = label('WORM.EXE', color, size * 2.2);
    this.group.add(this.tag);
  }

  /**
   * Optional: fly along the road instead of the loop. `at(s, out)` gives the point to fly through at track
   * distance s (m); `headS(time, dt)` says where the head is now. The path parameter is then metres along the road.
   */
  follow: { at: (s: number, out: THREE.Vector3) => THREE.Vector3; headS: (time: number, dt: number) => number } | null = null;

  /** Point on the worm's path at parameter u (radians); a closed, knotted loop that also bobs up and down. */
  private path(u: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.follow) return this.follow.at(u, out);
    const R = this.radius;
    return out.set(
      this.center.x + R * Math.sin(u) + R * 0.35 * Math.sin(u * 3 + 0.8),
      this.center.y + this.height + this.height * 0.45 * Math.sin(u * 2 + 1.1) + 4 * Math.sin(u * 7),
      this.center.z + R * 0.8 * Math.cos(u) + R * 0.3 * Math.cos(u * 2 + 0.4),
    );
  }

  update(time: number, dt = 0): void {
    const speed = 0.055; // radians of the loop per second
    const u0 = this.follow ? this.follow.headS(time, dt) : time * speed;
    const gap = this.follow ? this.size * 1.05 : (this.size * 1.05) / (this.radius * 1.15); // path parameter between segments
    const du = this.follow ? 1 : 0.004;
    const place = (u: number, scale: number, out: THREE.Matrix4, roll: number) => {
      this.path(u, this.p);
      this.path(u + du, this.p2);
      // Segments ripple sideways like a crawling worm.
      this.look.lookAt(this.p, this.p2, THREE.Object3D.DEFAULT_UP);
      this.q.setFromRotationMatrix(this.look);
      this.q.multiply(this.qRoll.setFromAxisAngle(this.zAxis, roll));
      this.s.setScalar(scale);
      return out.compose(this.p, this.q, this.s);
    };
    for (let i = 0; i < WORM_SEGMENTS; i++) {
      const t = i / (WORM_SEGMENTS - 1);
      // Fat in the first third, tapering to the tail; a pulse of thickness runs down the body.
      const girth = (0.7 + 0.3 * Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.9))) * (1 - 0.55 * t * t);
      const pulse = 1 + 0.12 * Math.sin(time * 5 - i * 0.7);
      this.body.setMatrixAt(i, place(u0 - (i + 1) * gap, this.size * girth * pulse, this.m, i * 0.4 + time * 0.6));
    }
    this.body.instanceMatrix.needsUpdate = true;
    place(u0, this.size, this.m, 0);
    this.head.position.copy(this.p);
    this.head.quaternion.copy(this.q);
    // lookAt() with (eye, target) aims -Z from eye to target: the head's face is on its -Z side.
    const bite = 0.25 + 0.25 * Math.sin(time * 6);
    this.jaws[0].rotation.y = -bite;
    this.jaws[1].rotation.y = bite;
    this.tag.position.copy(this.p).setY(this.p.y + this.size * 2.6);
  }
}

// ------------------------------------------------------------------ hacker

/**
 * An 80s hacker as a neon wireframe: shades, mullet, hunched over a CRT computer, typing like mad; "ACCESS
 * GRANTED" blinks above him. About 2.6 m tall at scale 1, seen side-on (he faces +X). Call update(time).
 */
export class Hacker {
  readonly group = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly head = new THREE.Group();
  private readonly granted: THREE.Sprite;

  constructor() {
    const g = this.group;
    g.name = 'hacker';
    const CY = '#00e5ff', PK = '#ff2bd6', YE = '#ffe14d';
    const box = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: string, rz = 0) => {
      const b = neonSolid(new THREE.BoxGeometry(w, h, d), color);
      b.position.set(x, y, z);
      b.rotation.z = rz;
      parent.add(b);
      return b;
    };
    // Desk, chair, computer.
    box(g, 1.7, 0.08, 2.0, 1.15, 1.4, 0, PK);
    for (const [x, z] of [[0.4, 0.9], [1.9, 0.9], [0.4, -0.9], [1.9, -0.9]] as const) box(g, 0.08, 1.36, 0.08, x, 0.68, z, PK);
    box(g, 0.9, 0.12, 0.9, -0.25, 0.9, 0, CY);
    box(g, 0.12, 1.1, 0.9, -0.72, 1.5, 0, CY, 0.08);
    box(g, 0.1, 0.85, 0.1, -0.25, 0.45, 0, CY);
    box(g, 1.0, 0.85, 1.0, 1.55, 1.9, 0, YE);           // CRT body
    box(g, 0.5, 0.6, 0.7, 2.25, 1.85, 0, YE);            // its back
    box(g, 0.32, 0.05, 0.95, 0.72, 1.47, 0, YE);         // keyboard
    const screen = createCodePanels([{ x: 1.04, y: 1.92, z: 0, w: 0.8, h: 0.62, yaw: -Math.PI / 2, glyph: 0.07, color: new THREE.Color('#3dff9e').multiplyScalar(2) }]);
    g.add(screen);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.62), new THREE.MeshBasicMaterial({ color: new THREE.Color('#3dff9e').multiplyScalar(0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.position.set(1.035, 1.92, 0);
    glow.rotation.y = -Math.PI / 2;
    g.add(glow);
    // Body: hunched torso, legs under the desk.
    box(g, 0.45, 0.85, 0.7, -0.2, 1.42, 0, CY, -0.22);
    for (const z of [-0.18, 0.18]) {
      box(g, 0.8, 0.22, 0.24, 0.15, 1.05, z, CY);
      box(g, 0.2, 0.85, 0.2, 0.52, 0.55, z, CY);
      box(g, 0.34, 0.1, 0.22, 0.62, 0.08, z, PK);
    }
    // Head: face, shades, flat top and the mullet.
    this.head.position.set(0.02, 2.08, 0);
    g.add(this.head);
    box(this.head, 0.38, 0.44, 0.36, 0, 0, 0, CY);
    box(this.head, 0.44, 0.12, 0.4, -0.02, 0.27, 0, PK);
    box(this.head, 0.18, 0.55, 0.38, -0.24, -0.12, 0, PK);
    const shades = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.44), new THREE.MeshBasicMaterial({ color: new THREE.Color(PK).multiplyScalar(3) }));
    shades.position.set(0.2, 0.06, 0);
    this.head.add(shades);
    // Arms: shoulder pivots, forearms down onto the keyboard; they hammer the keys in update().
    for (const z of [-0.36, 0.36]) {
      const arm = new THREE.Group();
      arm.position.set(-0.08, 1.78, z);
      box(arm, 0.55, 0.13, 0.13, 0.27, 0, 0, CY);
      box(arm, 0.5, 0.12, 0.12, 0.72, -0.12, -Math.sign(z) * 0.1, CY, -0.5);
      g.add(arm);
      this.arms.push(arm);
    }
    const tag = label('HACKER.EXE', CY, 0.5);
    tag.position.set(0.6, 3.2, 0);
    g.add(tag);
    this.granted = label('ACCESS GRANTED', '#3dff9e', 0.42);
    this.granted.position.set(0.6, 2.72, 0);
    g.add(this.granted);
  }

  update(time: number): void {
    this.arms.forEach((a, i) => { a.rotation.z = -0.35 + 0.12 * Math.abs(Math.sin(time * 14 + i * 1.7)); });
    this.head.rotation.z = -0.1 + 0.05 * Math.sin(time * 7);
    this.head.position.y = 2.08 + 0.02 * Math.abs(Math.sin(time * 7));
    this.granted.visible = Math.floor(time * 2.5) % 3 !== 0;
  }
}
