import * as THREE from 'three';

/**
 * Third-person chase camera. Position is locked to the car (no positional lag at speed);
 * only the heading is smoothed, which gives the nice "swing" through corners.
 */
export class ChaseCamera {
  distance = 7.5;
  height = 2.4;
  lookAhead = 10;
  /** Aim point height above the car origin. */
  lookHeight = 0.8;
  private readonly heading = new THREE.Vector3();
  private initialized = false;
  private readonly carFwd = new THREE.Vector3();
  private readonly lookDir = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** `travel` (optional) = direction of travel; follows that instead of the body (so drifts don't swing the camera). */
  update(target: THREE.Object3D, speed01: number, dt: number, travel?: THREE.Vector3): void {
    if (travel) this.carFwd.copy(travel);
    else this.carFwd.set(0, 0, -1).applyQuaternion(target.quaternion);
    this.carFwd.y = 0;
    this.carFwd.normalize();
    if (!this.initialized) {
      this.heading.copy(this.carFwd);
      this.lookDir.copy(this.carFwd);
      this.initialized = true;
    }
    this.heading.lerp(this.carFwd, 1 - Math.exp(-dt * 5)).normalize();
    // Aim is smoothed too (faster): a wall knock snaps the travel direction, which used to jerk the whole view.
    this.lookDir.lerp(this.carFwd, 1 - Math.exp(-dt * 9)).normalize();

    this.camera.position.copy(target.position).addScaledVector(this.heading, -this.distance);
    this.camera.position.y += this.height;
    this.look.copy(target.position).addScaledVector(this.lookDir, this.lookAhead);
    this.look.y += this.lookHeight;
    this.camera.lookAt(this.look);

    const fov = 60 + speed01 * 14;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }
}
