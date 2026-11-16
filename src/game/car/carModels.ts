import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Hand-modelled (Blender) car bodies, loaded as small compressed .glb files from public/models/cars/.
 * Optional: a car style without a model (or a failed download) keeps its procedural body.
 */
const AVAILABLE = ['wedge', 'muscle', 'coupe', 'hatch', 'gt', 'razor', 'proto', 'hyper', 'bus']; // body styles with a model (tools/blender/car_<style>.py)
const STYLE_FOR: Record<string, string> = {}; // body style → model file (default: same name)

const models = new Map<string, THREE.Object3D>();
let loading: Promise<void> | null = null;

/** Start (or join) loading every model. Resolves when all have loaded or failed. */
export function preloadCarModels(): Promise<void> {
  if (!loading) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const base = import.meta.env.BASE_URL;
    loading = Promise.all(
      AVAILABLE.map((name) =>
        loader.loadAsync(`${base}models/cars/${name}.glb`)
          .then((g) => {
            // gltfpack stores quantised (normalized int) attributes: turn them back into plain floats so the
            // car builder can merge them with its own procedural parts.
            g.scene.traverse((o) => {
              const m = o as THREE.Mesh;
              if (!m.isMesh) return;
              for (const [key, attr] of Object.entries(m.geometry.attributes)) {
                const a = attr as THREE.BufferAttribute;
                if (a.array instanceof Float32Array && !a.normalized) continue;
                const f = new Float32Array(a.count * a.itemSize);
                for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
                m.geometry.setAttribute(key, new THREE.BufferAttribute(f, a.itemSize));
              }
            });
            models.set(name, g.scene);
          })
          .catch(() => undefined), // fall back to the procedural body
      ),
    ).then(() => undefined);
  }
  return loading;
}

/** A fresh copy of the model for a body style, or null when there is none (yet). */
export function carModelFor(styleName: string): THREE.Object3D | null {
  const m = models.get(STYLE_FOR[styleName] ?? styleName);
  return m ? m.clone(true) : null;
}
