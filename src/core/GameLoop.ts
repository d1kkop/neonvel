/**
 * Fixed-timestep simulation with variable-rate rendering.
 * The simulation always advances in exact STEP increments (deterministic, netplay friendly);
 * rendering receives an interpolation factor `alpha` between the last two sim states.
 */
export const SIM_HZ = 60;
export const STEP = 1 / SIM_HZ;

export class GameLoop {
  private acc = 0;
  private last = 0;
  private running = false;
  /** Total simulated time in seconds. */
  simTime = 0;
  /** Video capture: the real clock is ignored and frames only advance through advance(). */
  manual = false;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  /** One frame of exactly frameDt seconds (video capture: perfectly even motion however slow the machine is). */
  advance(frameDt: number): void {
    this.acc += frameDt;
    while (this.acc >= STEP - 1e-9) {
      this.update(STEP);
      this.simTime += STEP;
      this.acc -= STEP;
    }
    this.render(Math.max(0, this.acc) / STEP, frameDt);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    if (this.manual) {
      this.last = now;
      requestAnimationFrame(this.frame);
      return;
    }
    // Clamp to avoid a spiral of death after tab switches.
    const frameDt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.acc += frameDt;
    while (this.acc >= STEP) {
      this.update(STEP);
      this.simTime += STEP;
      this.acc -= STEP;
    }
    this.render(this.acc / STEP, frameDt);
    requestAnimationFrame(this.frame);
  };
}
