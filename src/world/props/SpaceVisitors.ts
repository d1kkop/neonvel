import * as THREE from 'three';
import { applyAtmosphere } from '../../render/atmosphere';
import { buildCar, haloTexture } from '../../game/car/CarBuilder';
import { LoopTrack, makeFrame } from '../../track/Track';

/**
 * Orbit Run guests that show up near the player now and then:
 *  - a red roadster drifting through space with an astronaut at the wheel,
 *  - a two-stage rocket blasting across the sky,
 *  - a little alien pedalling a flying bike alongside you.
 */

type Player = { s: number; x: number; v: number };

const std = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) =>
  applyAtmosphere(new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...o }));
const glowMat = (color: THREE.ColorRepresentation, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });

/** Cylinder from a to b (radius r), reusing one unit cylinder geometry. */
const UNIT_CYL = () => new THREE.CylinderGeometry(1, 1, 1, 32).translate(0, 0.5, 0);
const _a = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function stretch(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number): void {
  _a.copy(b).sub(a);
  const len = _a.length() || 1e-4;
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(_up, _a.divideScalar(len));
  mesh.scale.set(r, len, r);
}

/** Shared timing: wait, appear, live, vanish. */
abstract class Encounter {
  readonly group = new THREE.Group();
  protected active = false;
  protected age = 0;
  protected readonly frame = makeFrame();
  protected readonly playerPos = new THREE.Vector3();
  protected readonly playerFwd = new THREE.Vector3();

  constructor(protected readonly track: LoopTrack, protected timer: number, private readonly every: [number, number]) {
    this.group.visible = false;
  }

  update(time: number, dt: number, player: Player): void {
    this.track.frameAt(player.s, this.frame);
    this.playerPos.copy(this.frame.position).addScaledVector(this.frame.right, player.x);
    this.playerFwd.copy(this.frame.forward);
    if (!this.active) {
      this.timer -= dt;
      if (this.timer > 0 || player.v < 8 || !this.spawn(player)) return;
      this.active = true;
      this.age = 0;
      this.group.visible = true;
    }
    this.age += dt;
    if (!this.tick(time, dt, player)) {
      this.active = false;
      this.group.visible = false;
      this.timer = this.every[0] + Math.random() * (this.every[1] - this.every[0]);
    }
  }

  /** Place for a new appearance; false = try again next frame. */
  protected abstract spawn(player: Player): boolean;
  /** Animate; false = done. */
  protected abstract tick(time: number, dt: number, player: Player): boolean;

  protected behindPlayer(p: THREE.Vector3, margin: number): boolean {
    return _a.copy(p).sub(this.playerPos).dot(this.playerFwd) < -margin;
  }
}

// ------------------------------------------------------------------ astronaut + roadster

function astronaut(): THREE.Group {
  const g = new THREE.Group();
  const suit = std('#f2f2ee', { roughness: 0.75 });
  const dark = std('#2a2a30', { roughness: 0.6 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.42, 6, 14), suit);
  torso.position.set(0, 0.55, 0);
  torso.rotation.x = -0.18; // leaning back in the seat
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.2), suit);
  pack.position.set(0, 0.6, 0.27);
  pack.rotation.x = -0.18;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 18), suit);
  helmet.position.set(0, 1.12, 0.02);
  // Mirrored gold visor on the front of the helmet.
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.255, 24, 14, Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.3, Math.PI * 0.38),
    std('#c89a40', { metalness: 1, roughness: 0.08 }),
  );
  visor.rotation.y = Math.PI; // the open phi range faces -Z (forward)
  visor.position.copy(helmet.position);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 12, 48).rotateX(Math.PI / 2), dark);
  ring.position.set(0, 0.9, 0.02);
  g.add(torso, pack, helmet, visor, ring);
  // Arms: one on the wheel, one resting on the door.
  const cyl = UNIT_CYL();
  const arm = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const up = new THREE.Mesh(cyl, suit), lo = new THREE.Mesh(cyl, suit);
    stretch(up, a, b, 0.08);
    stretch(lo, b, c, 0.07);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), dark);
    glove.position.copy(c);
    g.add(up, lo, glove);
  };
  arm(new THREE.Vector3(-0.27, 0.8, 0), new THREE.Vector3(-0.3, 0.6, -0.3), new THREE.Vector3(-0.12, 0.72, -0.55));
  arm(new THREE.Vector3(0.27, 0.8, 0), new THREE.Vector3(0.48, 0.58, -0.1), new THREE.Vector3(0.62, 0.62, -0.32));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 12, 48), dark);
  wheel.position.set(0, 0.74, -0.58);
  wheel.rotation.x = -0.5;
  g.add(wheel);
  return g;
}

/** Glowing text label (canvas) for a sprite. */
function nameTag(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  g.font = 'italic 900 72px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#ff2bd6';
  g.shadowBlur = 18;
  g.fillStyle = '#ffffff';
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A red open-top roadster tumbling slowly through space, astronaut at the wheel. */
export class FloatingRoadster extends Encounter {
  private readonly body = new THREE.Group();
  private readonly axis = new THREE.Vector3();

  constructor(track: LoopTrack) {
    super(track, 6, [18, 28]);
    this.group.name = 'visitor-roadster';
    const car = buildCar({ style: 'coupe', paint: '#d0102a', accent: '#ffffff', tier: 'pro', procedural: true });
    car.group.getObjectByName('cabin')?.removeFromParent(); // convertible
    car.group.getObjectByName('shadow')?.removeFromParent(); // floating: no road under it
    car.setBrake(0);
    // Space is dark: make the paint glow a little so the red reads.
    car.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
      if (m && 'emissive' in m && m.color && m.color.r > 0.5 && m.color.g < 0.2) m.emissive.set('#5a0410');
    });
    const key = new THREE.PointLight('#fff2e0', 40, 14, 1.5);
    key.position.set(2, 4, -1);
    car.group.add(key);
    // Low windscreen.
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.32), std('#9ad8ff', { metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ws.position.set(0, 1.0, -car.style.length * 0.12);
    ws.rotation.x = -0.6;
    car.group.add(ws);
    const man = astronaut();
    man.position.set(-0.38, 0.42, 0.05);
    car.group.add(man);
    car.group.position.y = -0.6; // rotate around the car's middle
    this.body.add(car.group);
    this.body.scale.setScalar(2.0); // readable from the road
    this.group.add(this.body);
    // Bobbing neon arrow + name tag over the car (does not tumble with it).
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd23a').multiplyScalar(2.2) }));
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag('SPACE CADET'), transparent: true, depthWrite: false }));
    tag.scale.set(6, 1.5, 1);
    tag.position.y = 1.9;
    this.marker.add(arrow, tag);
    this.group.add(this.marker);
  }

  private readonly marker = new THREE.Group();

  private side = 1;
  private readonly q = new THREE.Quaternion();

  protected spawn(player: Player): boolean {
    // Needs open road ahead (no tunnel / canopy hiding it).
    if (this.track.sectionAt(player.s + 40, 90)) return false;
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.axis.set(Math.random() - 0.5, 2, Math.random() - 0.5).normalize();
    this.track.frameAt(player.s + 70, this.frame);
    // Nose toward the road, slightly angled, so you see the astronaut as you come up to it.
    this.body.quaternion.setFromAxisAngle(_up, Math.atan2(this.frame.forward.x, this.frame.forward.z) + Math.PI + this.side * 0.9);
    return true;
  }

  protected tick(time: number, dt: number, player: Player): boolean {
    // Glides by right beside the road: starts ~80 m ahead, you slowly overtake it over ~11 s.
    const dur = 11;
    const along = 80 - (this.age / dur) * 120;
    const hw = this.track.width / 2;
    this.track.frameAt(player.s + along, this.frame);
    this.group.position.copy(this.frame.position).addScaledVector(this.frame.right, this.side * (hw + 9 + Math.sin(time * 0.3) * 1.5));
    this.group.position.y += 5.5 + Math.sin(time * 0.5) * 1.2;
    this.body.quaternion.premultiply(this.q.setFromAxisAngle(this.axis, 0.14 * dt));
    this.marker.position.y = 5.2 + Math.sin(time * 3.2) * 0.6;
    this.marker.children[0].rotation.y += dt * 1.5;
    return this.age < dur;
  }
}

// ------------------------------------------------------------------ rocket

function rocketMesh(): { group: THREE.Group; flame: THREE.Mesh; trail: THREE.Mesh } {
  const g = new THREE.Group();
  // Body profile (radius, y) from the engine section up to the nose; y along +Y = flight direction.
  const R = 1.8;
  const prof: [number, number][] = [[0, 0], [R * 0.9, 0], [R, 1], [R, 26], [R * 0.98, 27], [R, 28], [R, 36], [R * 1.12, 38], [R * 1.12, 44], [R * 0.9, 47], [R * 0.45, 49.5], [0, 50.5]];
  const white = std('#f4f5f7', { roughness: 0.4, metalness: 0.15 });
  const black = std('#16161a', { roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 32), white);
  g.add(body);
  // Interstage + engine section bands.
  const band = (y: number, h: number) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.01, R * 1.01, h, 32, 1, true), black);
    b.position.y = y;
    g.add(b);
  };
  band(27, 2.2);
  band(1.4, 2.4);
  // Grid fins + landing legs (folded) + engine bells.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 0.12), black);
    fin.position.set(Math.cos(a) * (R + 0.6), 25.2, Math.sin(a) * (R + 0.6));
    fin.rotation.y = -a + Math.PI / 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.25), black);
    leg.position.set(Math.cos(a + Math.PI / 4) * (R + 0.1), 5.5, Math.sin(a + Math.PI / 4) * (R + 0.1));
    leg.rotation.y = -(a + Math.PI / 4) + Math.PI / 2;
    g.add(fin, leg);
  }
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 1.6, 16, 1, true), std('#3a3634', { metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }));
  bell.position.y = -0.7;
  g.add(bell);
  // Engine flame: additive, flickering; long fading exhaust trail.
  const flameMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uFlick: { value: 1 } },
    vertexShader: `varying float vT; void main(){ vT = -position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uFlick; varying float vT;
      void main(){ float t = clamp(vT, 0.0, 1.0);
        vec3 c = mix(vec3(1.0, 0.95, 0.8) * 3.0, vec3(1.0, 0.45, 0.1) * 1.6, smoothstep(0.0, 0.5, t));
        gl_FragColor = vec4(c * (1.0 - t) * uFlick, 1.0); }`,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 20, 1, true).rotateX(Math.PI).translate(0, -0.5, 0), flameMat);
  flame.position.y = -1.4;
  flame.scale.set(1.3, 14, 1.3);
  g.add(flame);
  const trailMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying float vT; void main(){ vT = -position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vT;
      void main(){ float t = clamp(vT, 0.0, 1.0);
        gl_FragColor = vec4(vec3(0.75, 0.8, 0.9) * pow(clamp(1.0 - t, 0.0, 1.0), 2.0) * smoothstep(0.0, 0.03, t) * 0.35, 1.0); }`,
  });
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.4, 1, 16, 1, true).translate(0, -0.5, 0), trailMat);
  trail.position.y = -6;
  trail.scale.set(5, 260, 5);
  g.add(trail);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: '#ffb060', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.position.y = -3;
  glow.scale.setScalar(16);
  g.add(glow);
  return { group: g, flame, trail };
}

/** A rocket blasting across the sky in front of you, climbing, with a long exhaust trail. */
export class RocketFlyby extends Encounter {
  private readonly rocket = rocketMesh();
  private readonly vel = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  constructor(track: LoopTrack) {
    super(track, 15, [30, 45]);
    this.group.name = 'visitor-rocket';
    this.group.add(this.rocket.group);
  }

  protected spawn(player: Player): boolean {
    const s0 = player.s + 380 + Math.random() * 160;
    this.track.frameAt(s0, this.frame);
    const side = Math.random() < 0.5 ? -1 : 1;
    this.group.position.copy(this.frame.position).addScaledVector(this.frame.right, side * 320);
    this.group.position.y += 40 + Math.random() * 50;
    // Across the road, climbing ~25 degrees.
    const pitch = 0.3 + Math.random() * 0.25;
    this.vel.copy(this.frame.right).multiplyScalar(-side * Math.cos(pitch)).addScaledVector(_up, Math.sin(pitch)).addScaledVector(this.frame.forward, Math.random() * 0.4 - 0.2).normalize();
    this.q.setFromUnitVectors(_up, this.vel);
    this.rocket.group.quaternion.copy(this.q);
    this.rocket.group.scale.setScalar(1.6);
    this.vel.multiplyScalar(120);
    return true;
  }

  protected tick(time: number, dt: number): boolean {
    this.group.position.addScaledVector(this.vel, dt);
    (this.rocket.flame.material as THREE.ShaderMaterial).uniforms.uFlick.value = 0.85 + 0.15 * Math.sin(time * 47) * Math.sin(time * 31);
    this.rocket.flame.scale.y = 13 + Math.sin(time * 23) * 1.5;
    // The trail grows from the launch point.
    this.rocket.trail.scale.y = Math.min(260, 30 + this.age * 120);
    return this.age < 9;
  }
}

// ------------------------------------------------------------------ alien on a flying bike

/** Little teal alien (original design: one big glowing eye, antennae, goggles) pedalling a bike. */
export class AlienCyclist extends Encounter {
  private readonly rig = new THREE.Group();
  private readonly crank = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly legs: { thigh: THREE.Mesh; shin: THREE.Mesh; foot: THREE.Mesh; side: number }[] = [];
  private readonly hip = new THREE.Vector3(0, 1.02, 0.18);
  private side = 1;
  private readonly pos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private pedal = 0;

  constructor(track: LoopTrack) {
    super(track, 25, [34, 50]);
    this.group.name = 'visitor-alien';
    const frameMat = std('#ff3c8e', { metalness: 0.6, roughness: 0.3 });
    const dark = std('#1a1a22', { roughness: 0.7 });
    const chrome = std('#c8ccd4', { metalness: 1, roughness: 0.2 });
    const skin = std('#3fd6b0', { roughness: 0.45 });
    const cyl = UNIT_CYL();
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const tube = (a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) => {
      const t = new THREE.Mesh(cyl, m);
      stretch(t, a, b, r);
      this.rig.add(t);
    };
    // Bike (z forward is -Z).
    const rearHub = V(0, 0.36, 0.52), frontHub = V(0, 0.36, -0.56), bb = V(0, 0.32, 0.04), seat = V(0, 0.9, 0.18), head = V(0, 0.88, -0.42);
    tube(rearHub, bb, 0.022, frameMat);
    tube(rearHub, seat, 0.022, frameMat);
    tube(bb, seat, 0.028, frameMat);
    tube(bb, head, 0.03, frameMat);
    tube(seat.clone().setY(0.84), head, 0.026, frameMat);
    tube(head, frontHub, 0.024, chrome);
    tube(head, V(0, 1.05, -0.38), 0.02, chrome);
    tube(V(-0.28, 1.05, -0.38), V(0.28, 1.05, -0.38), 0.018, chrome);
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.26), dark);
    saddle.position.set(0, 0.94, 0.18);
    this.rig.add(saddle);
    for (const hub of [rearHub, frontHub]) {
      const w = new THREE.Group();
      w.position.copy(hub);
      w.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 12, 64).rotateY(Math.PI / 2), dark));
      w.add(new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.012, 10, 64).rotateY(Math.PI / 2), chrome));
      for (let i = 0; i < 8; i++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.62, 0.006), chrome);
        sp.rotation.x = (i / 8) * Math.PI;
        w.add(sp);
      }
      // Glowing hub (it's a flying bike).
      w.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glowMat('#7afcff', 4)));
      this.rig.add(w);
      this.wheels.push(w);
    }
    this.crank.position.copy(bb);
    this.crank.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 16).rotateZ(Math.PI / 2), chrome));
    this.rig.add(this.crank);
    // Rider.
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), skin);
    torso.scale.set(1, 1.25, 0.9);
    torso.position.set(0, 1.28, 0.06);
    torso.rotation.x = 0.35;
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.27, 22, 16), skin);
    headM.position.set(0, 1.72, -0.08);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), glowMat('#fff6a0', 2.2));
    eye.position.set(0, 1.74, -0.31);
    eye.scale.z = 0.5;
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: '#101010' }));
    pupil.position.set(0, 1.74, -0.37);
    const goggles = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.025, 12, 64), dark);
    goggles.position.copy(headM.position);
    goggles.rotation.x = 0.1;
    this.rig.add(torso, headM, eye, pupil, goggles);
    for (const sx of [-1, 1]) {
      const ant = new THREE.Mesh(cyl, skin);
      stretch(ant, V(sx * 0.1, 1.92, -0.05), V(sx * 0.25, 2.25, 0.05), 0.018);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glowMat('#ff4fd8', 4));
      tip.position.set(sx * 0.25, 2.25, 0.05);
      // Arms to the handlebar.
      const up = new THREE.Mesh(cyl, skin), lo = new THREE.Mesh(cyl, skin);
      stretch(up, V(sx * 0.2, 1.42, 0.0), V(sx * 0.26, 1.22, -0.2), 0.045);
      stretch(lo, V(sx * 0.26, 1.22, -0.2), V(sx * 0.26, 1.06, -0.38), 0.04);
      this.rig.add(ant, tip, up, lo);
      const thigh = new THREE.Mesh(cyl, skin), shin = new THREE.Mesh(cyl, skin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.2), dark);
      this.rig.add(thigh, shin, foot);
      this.legs.push({ thigh, shin, foot, side: sx });
    }
    this.rig.scale.setScalar(1.8);
    this.group.add(this.rig);
  }

  protected spawn(player: Player): boolean {
    if (this.track.sectionAt(player.s, 60)) return false;
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.prev.set(0, 0, 0);
    return true;
  }

  protected tick(time: number, dt: number, player: Player): boolean {
    const dur = 13;
    const arrive = THREE.MathUtils.smoothstep(this.age, 0, 2.5);
    const leave = THREE.MathUtils.smoothstep(this.age, dur, dur + 4);
    const hw = this.track.width / 2;
    // Ride alongside, a little ahead, bobbing — then soar up and away.
    const along = -25 * (1 - arrive) + 9 + Math.sin(time * 0.6) * 2 + leave * 40;
    const lateral = this.side * (hw + 5 + Math.sin(time * 0.45) * 1.2 + leave * 10);
    const height = 3 + Math.sin(time * 1.3) * 0.5 + leave * leave * 60;
    this.track.frameAt(player.s + along, this.frame);
    this.pos.copy(this.frame.position).addScaledVector(this.frame.right, lateral);
    this.pos.y += height;
    if (this.prev.lengthSq() > 0 && dt > 0) {
      this.fwd.copy(this.pos).sub(this.prev);
      if (this.fwd.lengthSq() > 1e-4) this.fwd.normalize();
      else this.fwd.copy(this.frame.forward);
    } else this.fwd.copy(this.frame.forward);
    this.prev.copy(this.pos);
    this.group.position.copy(this.pos);
    this.group.lookAt(this.look.copy(this.pos).sub(this.fwd)); // -Z (front) along the motion
    // Pedalling and spinning wheels.
    this.pedal += dt * 6;
    this.crank.rotation.x = -this.pedal;
    for (const w of this.wheels) w.rotation.x = -this.pedal * 2.2;
    for (const L of this.legs) {
      const a = -this.pedal + (L.side > 0 ? Math.PI : 0);
      const foot = new THREE.Vector3(L.side * 0.12, 0.32 + Math.sin(a) * 0.17, 0.04 - Math.cos(a) * 0.17);
      const hip = this.hip.clone().setX(L.side * 0.1);
      // Two-bone leg: knee pushed forward.
      const d = foot.distanceTo(hip), seg = 0.42;
      const mid = hip.clone().lerp(foot, 0.5);
      const h = Math.sqrt(Math.max(0, seg * seg - (d * d) / 4));
      const dir = foot.clone().sub(hip).normalize();
      const fwdPerp = new THREE.Vector3(0, -dir.z, dir.y).multiplyScalar(-1); // perpendicular in the YZ plane, toward -Z
      if (fwdPerp.z > 0) fwdPerp.negate();
      const knee = mid.addScaledVector(fwdPerp, h);
      stretch(L.thigh, hip, knee, 0.06);
      stretch(L.shin, knee, foot, 0.05);
      L.foot.position.copy(foot);
    }
    return this.age < dur + 4;
  }
}
