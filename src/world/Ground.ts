import * as THREE from 'three';
import { ATMOS_PARS, atmosphere, NOISE_GLSL } from '../render/atmosphere';

/** City floor far below: dark blocks with glowing street grid and moving car-light streaks, mostly hidden by haze. */
export function createGround(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(14000, 14000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      ${ATMOS_PARS}
      ${NOISE_GLSL}
      float line(float c, float w) {
        float d = abs(fract(c) - 0.5);
        float fw = max(fwidth(c), 1e-4);
        return smoothstep(w + fw, w - fw, d);
      }
      void main() {
        vec2 p = vWorld.xz / 90.0;
        float streets = max(line(p.x + 0.5, 0.06), line(p.y + 0.5, 0.06));
        vec3 col = vec3(0.01, 0.005, 0.02);
        col += vec3(1.0, 0.45, 0.15) * streets * 0.35;
        // Moving traffic streaks along streets.
        float tx = fract(vWorld.x / 37.0 - uTime * 0.6 + hash11(floor(p.y + 0.5)) * 10.0);
        float tz = fract(vWorld.z / 41.0 + uTime * 0.5 + hash11(floor(p.x + 0.5)) * 10.0);
        col += vec3(1.0, 0.2, 0.25) * line(p.y + 0.5, 0.02) * smoothstep(0.9, 1.0, tx) * 2.0;
        col += vec3(0.9, 0.95, 1.0) * line(p.x + 0.5, 0.02) * smoothstep(0.9, 1.0, tz) * 2.0;
        gl_FragColor = vec4(applyAtmos(col, vWorld), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0;
  return mesh;
}
