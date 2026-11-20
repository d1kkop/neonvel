/**
 * Unified control state from keyboard, gamepad and touch.
 * Every source writes into the same InputState (this is also what netplay will send).
 */
export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake?: number; // 0..1
  boost?: number; // 0..1 (held)
}

export class Input {
  readonly state: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0 };
  /** On-screen boost button held (touch). */
  touchBoost = false;
  private readonly keys = new Set<string>();
  /** Touch stick (set by the on-screen joystick). */
  touch: InputState | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  poll(): InputState {
    const k = this.keys;
    let throttle = k.has('ArrowUp') || k.has('KeyW') ? 1 : 0;
    let brake = k.has('ArrowDown') || k.has('KeyS') ? 1 : 0;
    let handbrake = k.has('Space') ? 1 : 0;
    let boost = k.has('ShiftLeft') || k.has('ShiftRight') || this.touchBoost ? 1 : 0;
    let steer = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);

    // Gamepad (standard mapping): left stick / d-pad steer, RT/A throttle, LT/B brake.
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const ax = Math.abs(p.axes[0]) > 0.15 ? p.axes[0] : 0;
      if (ax) steer = ax;
      if (p.buttons[14]?.pressed) steer = -1;
      if (p.buttons[15]?.pressed) steer = 1;
      throttle = Math.max(throttle, p.buttons[7]?.value ?? 0, p.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, p.buttons[6]?.value ?? 0, p.buttons[1]?.pressed ? 1 : 0);
      if (p.buttons[2]?.pressed || p.buttons[5]?.pressed) handbrake = 1;
      if (p.buttons[3]?.pressed || p.buttons[4]?.pressed) boost = 1; // Y / LB
    }
    if (this.touch) {
      throttle = Math.max(throttle, this.touch.throttle);
      brake = Math.max(brake, this.touch.brake);
      if (this.touch.steer) steer = this.touch.steer;
      if (this.touch.handbrake) handbrake = 1;
    }
    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.steer = Math.max(-1, Math.min(1, steer));
    this.state.handbrake = handbrake;
    this.state.boost = boost;
    return this.state;
  }
}
