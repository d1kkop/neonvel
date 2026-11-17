import * as THREE from 'three';
import { buildCar, BuiltCar } from '../game/car/CarBuilder';
import type { CarModel } from '../game/car/catalog';
import { createEnvironment } from '../render/Renderer';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

/**
 * Small 3D turntable for the garage: its own renderer + scene (created on open, disposed on close).
 */
export class GaragePreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 100);
  private car: BuiltCar | null = null;
  private readonly turntable = new THREE.Group();
  private readonly env: THREE.WebGLRenderTarget;
  private raf = 0;
  angle = 0.6;
  spin = 0.45;
  private last = performance.now();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.env = createEnvironment(this.renderer);
    this.scene.environment = this.env.texture;
    // Studio: soft fill, a strong key, two coloured rim lights, a polished mirror floor and a dark backdrop
    // with vertical light bars so the paint and glass have something to reflect.
    this.scene.add(new THREE.HemisphereLight('#c8c0ff', '#2a1030', 0.55));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(3, 7, 4);
    const rimL = new THREE.SpotLight('#ff3fa8', 60, 18, 0.6, 0.6);
    rimL.position.set(-6, 3.5, -4);
    const rimR = new THREE.SpotLight('#2ee6ff', 60, 18, 0.6, 0.6);
    rimR.position.set(6, 3.5, -4);
    const top = new THREE.SpotLight('#ffffff', 40, 14, 0.7, 0.8);
    top.position.set(0, 7, 0);
    this.scene.add(key, rimL, rimR, top);
    const mirror = new Reflector(new THREE.CircleGeometry(4.2, 64), {
      textureWidth: 1024, textureHeight: 512, color: new THREE.Color('#4a4a5c'),
    });
    mirror.rotation.x = -Math.PI / 2;
    const gloss = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#05030a', transparent: true, opacity: 0.62 }),
    );
    gloss.position.y = 0.003;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.03, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#00e5ff').multiplyScalar(2.5) }));
    ring.position.y = 0.01;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 14, 12, 64, 1, true, Math.PI * 0.6, Math.PI * 0.8),
      new THREE.MeshBasicMaterial({ color: '#07050e', side: THREE.BackSide }),
    );
    wall.position.y = 4;
    const barMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(1.4) });
    for (let i = -4; i <= 4; i++) {
      const a = Math.PI + i * 0.14;
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5), barMat);
      bar.position.set(Math.sin(a) * 13.8, 3.2, Math.cos(a) * 13.8);
      bar.lookAt(0, 3.2, 0);
      this.scene.add(bar);
    }
    this.scene.add(mirror, gloss, ring, wall, this.turntable);
    if (import.meta.env.DEV) (window as unknown as { __garage: GaragePreview }).__garage = this;
    this.camera.layers.enable(1);
    this.camera.layers.enable(2);
    this.camera.position.set(0, 1.9, 8.0);
    this.camera.lookAt(0, 0.55, 0);
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.angle += dt * this.spin;
      this.turntable.rotation.y = this.angle;
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  resize(): void {
    const w = this.canvas.clientWidth || 640;
    const h = this.canvas.clientHeight || 360;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  show(model: CarModel, paint: string, _locked = false): void {
    if (this.car) {
      this.turntable.remove(this.car.group);
      this.car.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((x) => x.dispose());
      });
    }
    this.car = buildCar({ style: model.style, paint, accent: model.accent, tier: model.tier });
    this.turntable.add(this.car.group);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.show = () => {};
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((x) => x.dispose());
    });
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
