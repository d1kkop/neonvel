import * as THREE from 'three';
import { createPlanet } from './LevelProps';

interface Moon { mesh: THREE.Object3D; center: THREE.Vector3; r: number; speed: number; phase: number; tilt: number }

/** Soft round glow (radial gradient) for coronas and halos. */
function glowTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A red hypergiant: boiling granulated surface, dark limb, soft corona that pulses slowly. It is drawn like the
 * sky: kept at a fixed distance from the camera in direction `dir` (no parallax, so it reads as unimaginably far
 * away) and behind everything else, however huge it is.
 */
function createHyperGiant(dir: THREE.Vector3, dist: number, radius: number): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    fog: false,
    depthTest: false,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vP; varying vec3 vN; void main(){ vP = position; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; varying vec3 vP; varying vec3 vN;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){
        vec3 p = normalize(vP);
        float t = uTime * 0.02;
        // Big convection cells plus fine granules, both drifting.
        float cells = vn(p * 3.0 + t) * 0.5 + vn(p * 7.0 - t * 1.5) * 0.25 + vn(p * 14.0 + t * 3.0) * 0.12
                    + vn(p * 30.0 - t * 4.0) * 0.08 + vn(p * 64.0 + t * 6.0) * 0.05;
        // Fine granulation: small bright cells with dark lanes.
        float gran = vn(p * 120.0 + t * 8.0);
        cells += (gran - 0.5) * 0.12;
        float spots = smoothstep(0.62, 0.78, vn(p * 2.2 + 9.0 + t * 0.5));
        float mu = clamp(vN.z, 0.0, 1.0);
        float limb = 0.2 + 0.8 * pow(mu, 0.8);
        vec3 deep = vec3(0.16, 0.0, 0.0), mid = vec3(0.62, 0.015, 0.0), hot = vec3(0.95, 0.16, 0.02);
        vec3 col = mix(deep, mid, smoothstep(0.3, 0.6, cells));
        col = mix(col, hot, smoothstep(0.62, 0.85, cells) * 0.9);
        col = mix(col, deep * 0.4, spots * 0.85);
        gl_FragColor = vec4(col * limb * 1.15, 1.0);
      }`,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 96), mat);
  sphere.renderOrder = -900; // right after the sky (-1000), before everything else
  sphere.frustumCulled = false;
  // Follow the camera (also the road-reflection camera) before it is drawn; the halos are drawn later in the frame.
  sphere.onBeforeRender = (_r, _s, cam) => {
    group.position.copy(cam.position).addScaledVector(dir, dist);
    group.updateMatrixWorld(true);
  };
  group.add(sphere);
  const mk = (stops: [number, string][], scale: number) => {
    // Not 'transparent': drawn in the opaque pass right after the star, so planets and rocks still cover it.
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(stops), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: false, fog: false }));
    s.scale.setScalar(radius * scale);
    s.renderOrder = -899;
    s.frustumCulled = false;
    group.add(s);
    return s;
  };
  const inner = mk([[0.5, 'rgba(255,60,20,1)'], [0.62, 'rgba(255,35,10,0.85)'], [0.8, 'rgba(210,15,5,0.4)'], [1, 'rgba(100,0,0,0)']], 2.6);
  const outer = mk([[0, 'rgba(255,70,20,0.7)'], [0.25, 'rgba(230,45,10,0.35)'], [0.6, 'rgba(160,20,5,0.07)'], [1, 'rgba(80,0,0,0)']], 5);
  return {
    group,
    update(t) {
      const pulse = 1 + 0.035 * Math.sin(t * 0.35) + 0.015 * Math.sin(t * 0.93);
      sphere.scale.setScalar(pulse);
      inner.scale.setScalar(radius * 2.6 * pulse * pulse);
      outer.scale.setScalar(radius * 5 * (1 + 0.05 * Math.sin(t * 0.35 + 1)));
      mat.uniforms.uTime.value = t;
    },
  };
}

/** Far-off enormous bodies (gas giants, a ringed giant, a red hypergiant) plus moons that circle them. */
export function createSpaceGiants(scene: THREE.Scene): (time: number, dt: number) => void {
  const spinners: { obj: THREE.Object3D; rate: number }[] = [];
  // Moons sit close to their planet and go round fast enough to see them move (one orbit in ~20-50 s).
  const moons: Moon[] = [];
  const add = (p: THREE.Group, rate: number) => { scene.add(p); spinners.push({ obj: p, rate }); return p; };
  const moon = (center: THREE.Vector3, r: number, size: number, speed: number, phase: number, tilt: number, a: string, b: string, kind: 'rocky' | 'ice', seed: number) => {
    const m = createPlanet(new THREE.Vector3(), size, a, b, false, kind, seed);
    scene.add(m);
    moons.push({ mesh: m, center, r, speed, phase, tilt });
  };

  // Jupiter-like banded giant with a storm spot.
  const jPos = new THREE.Vector3(-3300, 1100, -4300);
  add(createPlanet(jPos, 2400, '#e8b878', '#a8541e', false, 'gas', 2.7), 0.004);
  moon(jPos, 3700, 200, 0.16, 0.5, 0.15, '#d8c8a0', '#7a6a50', 'rocky', 1.2);
  moon(jPos, 3100, 130, 0.24, 2.4, -0.25, '#e8e4f0', '#6a8ab0', 'ice', 4.4);
  moon(jPos, 4200, 110, 0.12, 4.4, 0.3, '#c8704a', '#5a2a18', 'rocky', 7.7);

  // Ringed giant, pale gold and cream.
  const sPos = new THREE.Vector3(3400, 1500, 3000);
  const saturn = add(createPlanet(sPos, 1500, '#f0d8a0', '#b88a50', true, 'gas', 6.1), 0.003);
  saturn.rotation.z = 0.3;
  moon(sPos, 2500, 140, 0.22, 1.0, 0.1, '#e8f0ff', '#8aa8d0', 'ice', 3.3);
  moon(sPos, 3000, 100, 0.15, 3.6, -0.2, '#a8a094', '#58544c', 'rocky', 9.9);

  // The old orange gas giant also gets moons now.
  const oPos = new THREE.Vector3(2600, 500, -3200);
  moon(oPos, 1350, 80, 0.3, 0.0, 0.2, '#b8b4ac', '#6a6660', 'rocky', 3.1);
  moon(oPos, 1750, 60, 0.21, 3.0, -0.3, '#e0eaff', '#5a8ac8', 'ice', 5.2);

  // Red hypergiant far in the back.
  const star = createHyperGiant(new THREE.Vector3(5000, 2400, -900).normalize(), 5600, 3300);
  scene.add(star.group);

  const tmp = new THREE.Vector3();
  return (time, dt) => {
    for (const s of spinners) s.obj.rotation.y += s.rate * dt;
    for (const m of moons) {
      const a = m.phase + time * m.speed;
      tmp.set(Math.cos(a) * m.r, Math.sin(a) * m.r * Math.sin(m.tilt), Math.sin(a) * m.r);
      m.mesh.position.copy(m.center).add(tmp);
      m.mesh.rotation.y += 0.05 * dt;
    }
    star.update(time);
  };
}
