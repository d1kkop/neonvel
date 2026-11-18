import * as THREE from 'three';
import { atmosphere } from '../../render/atmosphere';

/**
 * GPU rain: instanced streak quads that wrap around the camera inside a box.
 * Each streak is stretched along its velocity relative to the camera, so driving fast
 * makes the rain slant toward you.
 */
export class Rain {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uIntensity: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uCamVel: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector2(2.5, 1.0) },
    uFall: { value: 24 },
    uBox: { value: new THREE.Vector3(50, 30, 50) },
  };

  private readonly lastCam = new THREE.Vector3();
  private hasLast = false;

  constructor(count = 20000, readonly mode: 'rain' | 'snow' | 'bubbles' = 'rain') {
    const base = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0); // y: 0..1 along the streak
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const offsets = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      offsets[i * 4] = Math.random();
      offsets[i * 4 + 1] = Math.random();
      offsets[i * 4 + 2] = Math.random();
      offsets[i * 4 + 3] = Math.random(); // per-drop random (speed / brightness / threshold)
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 4));
    geo.instanceCount = count;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, // quad orientation depends on view; never cull
      defines: { MODE: mode === 'rain' ? 0 : mode === 'snow' ? 1 : 2 },
      uniforms: { ...this.uniforms, uTime: atmosphere.uTime, uHazeColor: atmosphere.uHazeColor },
      vertexShader: /* glsl */ `
        attribute vec4 aOffset;
        uniform float uTime, uIntensity, uFall;
        uniform vec3 uCamPos, uCamVel, uBox;
        uniform vec2 uWind;
        varying float vAlpha;
        varying vec2 vUv;
        varying vec3 vFlake; // snow: x = length / width of the flake's streak, y = how much of a crystal shows, z = spin
        void main() {
          vFlake = vec3(1.0, 0.0, 0.0);
          // Thin out the rain by intensity: drops above the threshold are collapsed.
          float keep = step(aOffset.w, uIntensity);
          float fall = uFall * (0.85 + 0.3 * aOffset.w);
          vec3 vel = vec3(uWind.x, -fall, uWind.y);
          #if MODE == 1
            vel = vec3(uWind.x * 0.6, -fall * 0.09, uWind.y * 0.6);
          #elif MODE == 2
            vel = vec3(0.0, fall * 0.12, 0.0);
          #endif
          vec3 p = aOffset.xyz * uBox + vel * uTime;
          #if MODE == 1
            // Snow drifts together: slow gusts that sweep through the whole fall (neighbouring flakes move alike),
            // and only a small flutter of each flake's own. (Big independent wobbles made it look like noise.)
            vec3 home = aOffset.xyz * uBox;
            vec2 gust = vec2(sin(uTime * 0.45 + home.z * 0.05 + home.y * 0.08), cos(uTime * 0.37 + home.x * 0.05 + home.y * 0.06));
            p.xz += gust * 1.5;
            p.x += sin(uTime * 2.1 + aOffset.w * 40.0) * 0.12;
            p.z += cos(uTime * 1.7 + aOffset.w * 31.0) * 0.12;
          #elif MODE == 2
            p.x += sin(uTime * 3.0 + aOffset.w * 40.0) * 0.15;
          #endif
          // Wrap into a box centred on the camera.
          p = mod(p - uCamPos + uBox * 0.5, uBox) + uCamPos - uBox * 0.5;

          vec3 rel = vel - uCamVel * 0.3; // partial: keeps streaks readable at speed
          float speed = length(rel);
          vec3 dir = rel / max(speed, 1e-3);
          float len = clamp(speed * 0.022, 0.25, 2.2);
          float halfW = (MODE == 0 ? 0.011 : 0.045) * (1.0 + length(cameraPosition - p) * 0.02);
          #if MODE == 2
            len = 0.09 + aOffset.w * 0.05;
          #elif MODE == 1
            // Flakes: mostly small, some medium, a few big soft ones. Driving fast, every flake becomes a short
            // streak along the way it rushes past the car, so the snow visibly streams toward and around you.
            float kind = fract(aOffset.w * 7.31);
            float size = kind > 0.94 ? 0.085 : mix(0.022, 0.045, kind);
            halfW = size * (1.0 + length(cameraPosition - p) * 0.035);
            rel = vel - uCamVel * 0.6;
            speed = length(rel);
            dir = rel / max(speed, 1e-3);
            len = max(halfW * 2.0, min(speed * 0.009, 0.7));
            vFlake = vec3(len / (halfW * 2.0), kind > 0.94 ? 1.0 : smoothstep(0.5, 0.9, kind) * 0.6, aOffset.w * 6.283 + uTime * (0.6 + aOffset.z));
          #endif
          vec3 toCam = normalize(cameraPosition - p);
          vec3 sc = cross(dir, toCam);
          vec3 side = sc / max(length(sc), 1e-4) * halfW;
          vec3 world = p - dir * len * (position.y - (MODE == 1 ? 0.5 : 0.0)) + side * position.x * 2.0;
          vUv = uv;
          float dist = length(cameraPosition - p);
          vAlpha = keep * (1.0 - smoothstep(14.0, 24.0, dist)) * smoothstep(0.5, 2.0, dist) * (0.4 + 0.6 * aOffset.w);
          #if MODE == 1
            // A streak spreads the same light over more pixels.
            vAlpha *= mix(1.0, 0.5, clamp((vFlake.x - 1.0) / 5.0, 0.0, 1.0)) * 1.15;
          #endif
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHazeColor;
        varying float vAlpha;
        varying vec2 vUv;
        varying vec3 vFlake;
        void main() {
          #if MODE == 1
            // A soft round flake stretched into a capsule along its streak; slow flakes show a six-armed crystal.
            vec2 q = vec2((vUv.x - 0.5) * 2.0, (vUv.y - 0.5) * 2.0 * vFlake.x);
            q.y = sign(q.y) * max(abs(q.y) - (vFlake.x - 1.0), 0.0);
            float rr = length(q);
            float body = 1.0 - smoothstep(0.0, 1.0, rr);
            body = body * body * (0.7 + 0.5 * (1.0 - smoothstep(0.0, 0.4, rr)));    // bright heart, soft edge
            // A streak is brightest at its head and thins out toward its tail.
            body *= mix(1.0, 0.35 + 0.65 * vUv.y, clamp(vFlake.x - 1.0, 0.0, 1.0));
            float ang = atan(q.y, q.x) + vFlake.z;
            float arms = pow(abs(cos(ang * 3.0)), 14.0) * (1.0 - smoothstep(0.1, 0.95, rr));
            float crystal = vFlake.y * (1.0 - clamp((vFlake.x - 1.0) * 1.5, 0.0, 1.0));
            float shape = mix(body, body * 0.45 + arms * 1.3, crystal);
            gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * shape * vAlpha, 1.0);
            return;
          #endif
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float along = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
          vec3 c = mix(vec3(0.6, 0.7, 1.0), uHazeColor, 0.2) * 0.75;
          #if MODE != 0
            float r = length(vUv - 0.5) * 2.0;
            along = 1.0;
            across = MODE == 1 ? 1.0 - smoothstep(0.3, 1.0, r) : (1.0 - smoothstep(0.7, 1.0, r)) * (0.4 + smoothstep(0.6, 0.9, r));
            c = MODE == 1 ? vec3(0.9) : vec3(0.7, 0.95, 1.0) * 0.8;
          #endif
          gl_FragColor = vec4(c * across * along * vAlpha, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  /** `cover` 0..1 hides rain (under tunnels / canopies). */
  update(camera: THREE.Camera, dt: number, intensity: number, cover: number): void {
    const u = this.uniforms;
    u.uCamPos.value.copy(camera.position);
    if (this.hasLast && dt > 0) {
      const v = camera.position.clone().sub(this.lastCam).divideScalar(dt);
      if (v.length() < 200) u.uCamVel.value.lerp(v, 0.3);
    }
    this.lastCam.copy(camera.position);
    this.hasLast = true;
    u.uIntensity.value = intensity * (1 - cover);
    this.mesh.visible = u.uIntensity.value > 0.002;
  }
}
