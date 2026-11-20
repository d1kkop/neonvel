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
/** Light versions (`<style>_lo.glb`, about a third of the triangles): phones, weak GPUs, AI cars. */
const lowModels = new Map<string, THREE.Object3D>();
let loadingHigh: Promise<void> | null = null;
/** Rim designs (tools/blender/rims.py): style → its meshes (one per material), modelled for RIM_MODEL_RADIUS. */
const rims = new Map<string, THREE.Mesh[]>();
/** Lip radius the rims were modelled at (the car builder scales them to its own rim radius). */
export const RIM_MODEL_RADIUS = 0.27;
let loading: Promise<void> | null = null;

/** gltfpack stores quantised (normalized int) attributes: turn them back into plain floats. */
function dequantise(root: THREE.Object3D): void {
  root.traverse((o) => {
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
}

/**
 * Start (or join) loading the models. `withHigh` = also the full-detail bodies (not needed at low quality:
 * phones then only download the light ones). Resolves when all have loaded or failed.
 */
export function preloadCarModels(withHigh = true): Promise<void> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const base = import.meta.env.BASE_URL;
  if (withHigh && !loadingHigh) {
    loadingHigh = Promise.all(AVAILABLE.map((name) =>
      loader.loadAsync(`${base}models/cars/${name}.glb`)
        .then((g) => { dequantise(g.scene); models.set(name, g.scene); })
        .catch(() => undefined))).then(() => undefined);
  }
  if (!loading) {
    loading = Promise.all(
      AVAILABLE.map((name) =>
        loader.loadAsync(`${base}models/cars/${name}_lo.glb`)
          .then((g) => {
            dequantise(g.scene); // so the car builder can merge them with its own procedural parts
            lowModels.set(name, g.scene);
          })
          .catch(() => undefined), // fall back to the procedural body
      ).concat(
        loader.loadAsync(`${base}models/wheels/rims.glb`)
          .then((g) => {
            dequantise(g.scene);
            g.scene.updateMatrixWorld(true);
            g.scene.traverse((o) => {
              const style = /^rim_([a-z0-9]+)/.exec(o.name)?.[1];
              if (!style || rims.has(style)) return;
              // The rim's meshes (one per material), with their transform baked in.
              const parts: THREE.Mesh[] = [];
              o.traverse((c) => {
                const m = c as THREE.Mesh;
                if (!m.isMesh) return;
                const mesh = new THREE.Mesh(m.geometry.clone().applyMatrix4(m.matrixWorld), m.material);
                parts.push(mesh);
              });
              if (parts.length) rims.set(style, parts);
            });
          })
          .catch(() => undefined), // fall back to the procedural rims
      ),
    ).then(() => undefined);
  }
  return withHigh ? Promise.all([loading, loadingHigh]).then(() => undefined) : loading;
}

/** A fresh copy of the model for a body style (`low` = the light version), or null when there is none (yet). */
export function carModelFor(styleName: string, low = false): THREE.Object3D | null {
  const key = STYLE_FOR[styleName] ?? styleName;
  const m = low ? lowModels.get(key) ?? models.get(key) : models.get(key) ?? lowModels.get(key);
  return m ? m.clone(true) : null;
}

/** The modelled rim for a rim style (shared geometry: do not modify), or null when there is none. */
export function rimModelFor(style: string): THREE.Mesh[] | null {
  return rims.get(style) ?? null;
}
