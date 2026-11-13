import * as THREE from 'three';
import { buildCar, BuiltCar } from '../game/car/CarBuilder';
import type { CarModel } from '../game/car/catalog';
import { createEnvironment } from '../render/Renderer';

/**
 * Small 3D turntable for the garage: its own renderer + scene (created on open, disposed on close).
 */
export class GaragePreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 100);
  private car: BuiltCar | null = null;
  private readonly turntable = new THREE.Group();
  private readonly env: THREE.WebGLRenderTarget;
  private raf = 0;
  private angle = 0.6;
  private last = performance.now();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.env = createEnvironment(this.renderer);
    this.scene.environment = this.env.texture;
    this.scene.add(new THREE.HemisphereLight('#8a6aff', '#ff2f7a', 0.8));
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    key.position.set(4, 6, 3);
    this.scene.add(key);
    // Floor disc with a neon ring.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.6, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#100a1e', metalness: 0.15, roughness: 0.55, envMapIntensity: 0.25 }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.03, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#00e5ff').multiplyScalar(2.5) }));
    ring.position.y = 0.01;
    this.scene.add(floor, ring, this.turntable);
    this.camera.position.set(0, 2.1, 9.2);
    this.camera.lookAt(0, 0.6, 0);
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.angle += dt * 0.45;
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
