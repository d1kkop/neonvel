import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { detectGpu } from './gpuTier';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);

/** WebGL renderer + post-processing chain (render → bloom → tone map / sRGB output). */
export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  /**
   * Player's "Lighting" option, 0.5 (toned down) .. 1 (as designed, the default): scales the glow (bloom) of
   * every light and, a little, the overall exposure. Applied by World every frame.
   */
  lighting = 1;
  private readonly renderPass: RenderPass;
  /** VHS look (after the output pass): strength 0 = off, rewind 0..1 = heavy tape distortion. */
  readonly vhs: ShaderPass;

  constructor(container: HTMLElement, scene: THREE.Scene, camera: THREE.Camera) {
    this.webgl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.webgl.setPixelRatio(isMobile ? Math.min(window.devicePixelRatio, 1.5) : Math.min(Math.max(window.devicePixelRatio, 1.5), 2));
    this.maxRatio = this.webgl.getPixelRatio();
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    // Checking shader errors forces every compile to finish synchronously; only do it while developing
    // (production then compiles all level shaders in parallel).
    this.webgl.debug.checkShaderErrors = import.meta.env.DEV;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.1;
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.webgl.domElement);

    const size = this.webgl.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: isMobile || detectGpu().tier === 'low' ? 0 : 4 }); // no MSAA on phones / weak GPUs
    this.composer = new EffectComposer(this.webgl, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    // Safety net: a single NaN / infinite pixel (from any shader) would be smeared over the whole frame
    // by the bloom blur and turn the screen black. Scrub those (and absurd HDR values) first.
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          bool bad = any(isnan(c)) || any(isinf(c)) || !(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b);
          gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(clamp(c.rgb, 0.0, 64.0), c.a);
        }`,
    }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.3, 1.15);
    // Sun glow: the sky marks the sun's disc with alpha 0 (see Sky). Marked pixels always pass the bloom's
    // brightness cut, scaled by uSunBoost. A deep-red sun is far too dark in luminance to bloom on its own, and
    // simply making it brighter lets the filmic tone mapping bleach it to yellow-white.
    const hp = this.bloom.materialHighPassFilter;
    hp.uniforms.uSunBoost = { value: 0 };
    const hpSrc = hp.fragmentShader;
    hp.fragmentShader = hpSrc
      .replace('uniform float smoothWidth;', 'uniform float smoothWidth;\nuniform float uSunBoost;')
      .replace('float v = luminance( texel.xyz );',
        'float sunK = uSunBoost > 0.0 ? clamp( 1.0 - texel.a, 0.0, 1.0 ) : 0.0;\n' +
        'texel = vec4( texel.rgb * mix( 1.0, uSunBoost, sunK ), 1.0 );\n' +
        'float v = luminance( texel.xyz );')
      .replace('float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );',
        'float alpha = max( smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v ), sunK );');
    if (hp.fragmentShader === hpSrc || !hp.fragmentShader.includes('sunK );')) console.warn('Sun glow: bloom shader patch did not apply');
    hp.needsUpdate = true;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.vhs = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uStrength: { value: 0 }, uRewind: { value: 0 }, uRes: { value: new THREE.Vector2(size.x, size.y) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform float uTime, uStrength, uRewind; uniform vec2 uRes;
        varying vec2 vUv;
        float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }
        float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 uv = vUv;
          float k = uStrength;
          // Tape wobble + an occasional rolling tracking band (much stronger while rewinding).
          float band = fract(uTime * (0.07 + uRewind * 1.6));
          float inBand = smoothstep(0.04, 0.0, abs(uv.y - band)) * (0.25 + uRewind * 3.0);
          float line = floor(uv.y * uRes.y * 0.5);
          uv.x += (h11(line + floor(uTime * 30.0)) - 0.5) * (0.0012 * k + inBand * 0.02 * max(k, uRewind) + uRewind * 0.01);
          uv.x += sin(uv.y * 40.0 + uTime * 3.0) * 0.0006 * k;
          // Chroma bleed: red and blue drift apart horizontally.
          float ca = (1.2 + uRewind * 6.0) / uRes.x * k + uRewind * 3.0 / uRes.x;
          vec3 col;
          col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
          col.g = texture2D(tDiffuse, uv).g;
          col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;
          // Slightly soft, warm, a touch desaturated (old tape), scanlines, grain, vignette.
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(col, vec3(lum), 0.08 * k);
          col *= mix(vec3(1.0), vec3(1.03, 1.0, 0.95), k);
          col *= 1.0 - k * 0.08 * (0.5 + 0.5 * sin(uv.y * uRes.y * 1.5708));
          col += (h21(uv * uRes + uTime * 60.0) - 0.5) * (0.035 * k + uRewind * 0.1);
          col += inBand * 0.06 * vec3(0.8, 0.9, 1.0) * max(k, uRewind);
          vec2 d = vUv - 0.5;
          col *= 1.0 - k * 0.35 * dot(d, d) * 2.2;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.vhs.enabled = false;
    this.composer.addPass(this.vhs);
  }

  /** VHS look on/off (0..1) and the rewind distortion (0..1). */
  setVhs(strength: number, rewind: number, time: number): void {
    const u = this.vhs.uniforms;
    u.uStrength.value = strength;
    u.uRewind.value = rewind;
    u.uTime.value = time;
    this.vhs.enabled = strength > 0.001 || rewind > 0.001;
  }

  /** Sun glow strength for this level (0 = off): how bright the sun's disc counts for the bloom. */
  setSunBoost(v: number): void {
    this.bloom.materialHighPassFilter.uniforms.uSunBoost.value = v;
  }

  setScene(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.webgl.setSize(w, h);
    this.composer.setPixelRatio(this.webgl.getPixelRatio());
    this.composer.setSize(w, h);
    this.webgl.getDrawingBufferSize(this.vhs.uniforms.uRes.value);
  }

  render(): void {
    this.composer.render();
  }

  /**
   * Compile every shader the scene needs in the background (parallel where the browser supports it).
   * The game draws into the bloom chain's off-screen buffer, and three.js builds a different program variant
   * for that than for the screen (no tone mapping, linear output) — so the compile must target that buffer,
   * or the first real frame compiles everything a second time, synchronously.
   */
  async precompile(scene: THREE.Scene, camera: THREE.Camera, budgetMs = 25): Promise<unknown> {
    // In small portions, one object per material at a time, yielding between portions: compiling a whole
    // level in one go blocks the page (and the music scheduling) for seconds on a first visit / on phones.
    const seen = new Set<string>();
    const todo: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      const mats = Array.isArray(m) ? m : [m];
      const kind = `${(o as THREE.InstancedMesh).isInstancedMesh ? 'i' : ''}${(o as THREE.Points).isPoints ? 'p' : ''}${(o as THREE.Line).isLine ? 'l' : ''}${(o as THREE.Sprite).isSprite ? 's' : ''}`;
      const key = mats.map((x) => x.uuid).join(',') + kind;
      if (seen.has(key)) return;
      seen.add(key);
      todo.push(o);
    });
    const prev = this.webgl.getRenderTarget();
    let t0 = performance.now();
    for (const o of todo) {
      this.webgl.setRenderTarget(this.composer.readBuffer);
      try { this.webgl.compile(o, camera, scene); } catch { /* compiled lazily then */ }
      this.webgl.setRenderTarget(prev);
      if (performance.now() - t0 > budgetMs) {
        await new Promise((r) => setTimeout(r, 0));
        t0 = performance.now();
      }
    }
    // Then wait for the (parallel) compiles to finish.
    this.webgl.setRenderTarget(this.composer.readBuffer);
    try {
      return await this.webgl.compileAsync(scene, camera);
    } finally {
      this.webgl.setRenderTarget(prev);
    }
  }

  private maxRatio: number;
  private minRatio = 1;

  /** Range the dynamic resolution may move in (weak GPUs may drop below 1x). */
  get maxPixelRatio(): number {
    return this.maxRatio;
  }

  setRatioRange(min: number, max: number): void {
    this.minRatio = min;
    this.maxRatio = max;
  }
  private slowFor = 0;
  private fastFor = 0;
  private avgMs = 16;
  /** A resolution that was too slow (frame rate dropped) is not tried again until this time (performance.now ms). */
  private failedRatio = Infinity;
  private failedUntil = 0;
  /** Lowest frame rate the dynamic resolution accepts (phones: 30, sharper picture; desktop: ~42). */
  private minFps = 42;

  setMinFps(fps: number): void {
    this.minFps = fps;
  }

  /**
   * Dynamic resolution (call once per frame with the real frame time): when the game stays under ~42 fps the
   * render resolution steps down (to the quality's minimum), and steps back up when there is clear headroom again.
   * Steps are rare (resizing the buffers costs a frame), so it settles instead of flapping.
   */
  adaptResolution(dtMs: number): void {
    if (dtMs > 250) return; // tab switch / loading hitch
    this.avgMs += (dtMs - this.avgMs) * 0.05;
    const ratio = this.webgl.getPixelRatio();
    // Below the minimum frame rate: lower the resolution. Clearly above it: raise it (gap = no flapping).
    const slowMs = 1000 / this.minFps, fastMs = this.minFps <= 30 ? 1000 / 37 : 18;
    this.slowFor = this.avgMs > slowMs ? this.slowFor + dtMs : 0;
    // Steady at the screen's refresh (60 Hz = 16.7 ms, or faster): there is room to sharpen the picture.
    this.fastFor = this.avgMs < fastMs ? this.fastFor + dtMs : 0;
    const now = performance.now();
    if (now > this.failedUntil) this.failedRatio = Infinity;
    const step = (r: number) => (r > 1 ? 0.25 : 0.125);
    let next = ratio;
    if (this.slowFor > 2000 && ratio > this.minRatio) {
      next = Math.max(this.minRatio, ratio - step(ratio - 0.01));
      this.failedRatio = ratio; // too slow here: stay below it for a while (no flapping up and down)
      this.failedUntil = now + 60000;
    } else if (this.fastFor > 4000 && ratio < this.maxRatio) {
      const up = Math.min(this.maxRatio, ratio + step(ratio));
      if (up < this.failedRatio - 0.01) next = up;
    }
    if (next !== ratio) {
      this.slowFor = this.fastFor = 0;
      this.avgMs = 17;
      this.webgl.setPixelRatio(next);
      this.resize();
    }
  }
}

/**
 * A small synthetic environment for metallic reflections (car paint etc.), coloured per level.
 * Returns the PMREM render target: dispose the *target* (not just its texture) to free GPU memory.
 */
export function createEnvironment(
  renderer: THREE.WebGLRenderer,
  env: { top: string; horizon: string; ground: string; panels: string[] } = {
    top: '#05030d', horizon: '#ff3c8e', ground: '#991a59', panels: ['#00e5ff', '#ff2bd6', '#ffae5c', '#ffffff'],
  },
): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uTop: { value: new THREE.Color(env.top) }, uHor: { value: new THREE.Color(env.horizon) }, uGround: { value: new THREE.Color(env.ground) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uTop, uHor, uGround; varying vec3 vP; void main(){
        float y = normalize(vP).y;
        vec3 c = mix(uHor, uTop, smoothstep(0.0, 0.7, y));
        c = mix(c, uGround, smoothstep(0.0, -0.3, y));
        gl_FragColor = vec4(c, 1.0); }`,
    }),
  );
  scene.add(sky);
  const panelPos: [number, number, number][] = [[-20, 5, 0], [20, 5, 0], [0, 20, 0], [0, 8, -30]];
  const panelScale: [number, number, number][] = [[1, 3, 30], [1, 3, 30], [4, 1, 40], [20, 6, 1]];
  // Studio softbox strips (long, thin, very bright): they draw the sharp highlight lines along the car
  // panels that make paint look expensive. Slightly tinted towards the level's own light colours.
  const strip = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color, k: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(k) }));
    m.position.set(x, y, z);
    scene.add(m);
  };
  const white = new THREE.Color('#ffffff');
  const tint = new THREE.Color(env.panels[0] ?? '#ffffff').lerp(white, 0.6);
  for (const x of [-6, 0, 6]) strip(x, 24, 0, 0.6, 0.2, 46, white, 6);
  for (const s of [-1, 1]) {
    strip(s * 26, 9, 0, 0.3, 0.8, 40, tint, 5);
    strip(s * 26, 4, 0, 0.3, 0.3, 40, white, 3);
  }
  strip(0, 6, 30, 30, 0.4, 0.3, tint, 4);
  env.panels.slice(0, 4).forEach((c, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(4) }));
    m.position.set(...panelPos[i]);
    m.scale.set(...panelScale[i]);
    scene.add(m);
  });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
  return target;
}

/**
 * Rear-view mirror: renders the scene from a rear camera into a small HDR target, then draws it
 * (tone-mapped, horizontally flipped like a real mirror) into a strip at the top of the screen.
 */
export class Mirror {
  readonly camera = new THREE.PerspectiveCamera(42, 4, 0.1, 3000);
  private readonly rt: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new THREE.Vector2();
  /** Mirror rectangle in CSS pixels (top-left origin). */
  rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(512, 128, { type: THREE.HalfFloatType });
    this.rt.texture.wrapS = THREE.RepeatWrapping;
    this.rt.texture.repeat.set(-1, 1);
    this.rt.texture.offset.set(1, 0);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.rt.texture, depthTest: false }));
    this.quadScene.add(quad);
  }

  layout(): void {
    const w = Math.min(window.innerWidth * 0.34, 460);
    const h = Math.round(w / 4.2);
    this.rect = { x: Math.round((window.innerWidth - w) / 2), y: 12, w: Math.round(w), h };
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const { x, y, w, h } = this.rect;
    if (w <= 0) return;
    const dpr = renderer.getPixelRatio();
    const tw = Math.max(64, Math.round(w * dpr)), th = Math.max(16, Math.round(h * dpr));
    if (this.rt.width !== tw || this.rt.height !== th) this.rt.setSize(tw, th);
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(null);
    renderer.getSize(this.size);
    renderer.setScissorTest(true);
    renderer.setViewport(x, this.size.y - y - h, w, h);
    renderer.setScissor(x, this.size.y - y - h, w, h);
    renderer.render(this.quadScene, this.quadCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.size.x, this.size.y);
  }

  dispose(): void {
    this.rt.dispose();
  }
}
