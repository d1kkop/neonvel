import type { InputState } from './Input';
import { Minimap } from './Minimap';

/** In-race HUD: lap / position / time, speedometer, countdown, messages, touch stick. */
export class Hud {
  readonly el: HTMLDivElement;
  private readonly lap: HTMLElement;
  private readonly pos: HTMLElement;
  private readonly time: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly bar: HTMLElement[] = [];
  private readonly countdown: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly lapTime: HTMLElement;
  private readonly best: HTMLElement;
  readonly minimap = new Minimap();
  private readonly boostFill: HTMLElement;
  private readonly boostBox: HTMLElement;
  private readonly lines: HTMLElement;
  private linesK = 0;
  /** Touch boost button held. */
  boostHeld = false;
  private msgTimer = 0;
  /** Touch stick output (null when not touching). */
  touch: InputState | null = null;
  onPause?: () => void;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div class="hud-tl"><div class="hud-small">LAP</div><div class="hud-big" data-lap>1/3</div>
        <div class="hud-small" style="margin-top:8px">TIME</div><div class="hud-big" data-time>0:00.00</div>
        <div class="hud-laptime"><span class="hud-small">LAP</span> <span data-laptime>0:00.00</span></div>
        <div class="hud-laptime"><span class="hud-small">BEST</span> <span data-best>—</span></div></div>
      <div class="hud-tr"><div class="hud-small">POS</div><div class="hud-big" data-pos>1/4</div></div>
      <div class="hud-speed"><span class="v" data-speed>0</span><span class="u">KM/H</span><div class="hud-bar" data-bar></div></div>
      <div class="speedlines" data-lines></div>
      <div class="hud-boost" data-boostbox><div class="hud-small">BOOST</div><div class="boost-track"><div class="boost-fill" data-boost></div></div></div>
      <button class="boost-btn" data-boostbtn>BOOST</button>
      <div class="countdown" data-count></div>
      <div class="hud-msg" data-msg></div>
      <div class="stick" data-stick><div class="knob"></div></div>
      <button class="btn small pause-btn" data-pause>II</button>`;
    parent.appendChild(this.el);
    const q = (s: string) => this.el.querySelector<HTMLElement>(s)!;
    this.lap = q('[data-lap]');
    this.pos = q('[data-pos]');
    this.time = q('[data-time]');
    this.speed = q('[data-speed]');
    this.countdown = q('[data-count]');
    this.msg = q('[data-msg]');
    this.lapTime = q('[data-laptime]');
    this.best = q('[data-best]');
    this.el.appendChild(this.minimap.el);
    this.boostFill = q('[data-boost]');
    this.boostBox = q('[data-boostbox]');
    this.lines = q('[data-lines]');
    const bb = q('[data-boostbtn]');
    const hold = (on: boolean) => (e: Event) => { e.preventDefault(); this.boostHeld = on; bb.classList.toggle('held', on); };
    bb.addEventListener('pointerdown', hold(true));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) bb.addEventListener(ev, hold(false));
    const bar = q('[data-bar]');
    for (let i = 0; i < 16; i++) {
      const b = document.createElement('i');
      bar.appendChild(b);
      this.bar.push(b);
    }
    q('[data-pause]').addEventListener('click', () => this.onPause?.());
    this.setupStick(q('[data-stick]'));
  }

  show(on: boolean): void {
    this.el.classList.toggle('active', on);
  }

  update(d: { lap: number; laps: number; pos: number; total: number; time: number; kmh: number; speed01: number; boost?: number; boosting?: boolean; dt?: number; lapTime?: number; best?: number }): void {
    if (d.lapTime !== undefined) this.lapTime.textContent = formatTime(Math.max(0, d.lapTime));
    this.best.textContent = d.best !== undefined && Number.isFinite(d.best) ? formatTime(d.best) : '—';
    const b = d.boost ?? 0;
    this.boostFill.style.width = `${(b * 100).toFixed(1)}%`;
    this.boostBox.classList.toggle('full', b > 0.98);
    this.boostBox.classList.toggle('low', !!d.boosting && b < 0.2);
    this.boostBox.classList.toggle('firing', !!d.boosting);
    this.linesK += ((d.boosting ? 1 : 0) - this.linesK) * Math.min(1, (d.dt ?? 1 / 60) * 6);
    this.lines.style.opacity = (this.linesK * 0.6).toFixed(3);
    this.lap.textContent = `${Math.min(d.lap, d.laps)}/${d.laps}`;
    this.pos.textContent = `${d.pos}/${d.total}`;
    this.time.textContent = formatTime(d.time);
    this.speed.textContent = String(Math.round(d.kmh));
    const n = Math.round(d.speed01 * this.bar.length);
    this.bar.forEach((b, i) => {
      b.classList.toggle('on', i < n);
      b.classList.toggle('hot', i >= this.bar.length * 0.75);
    });
  }

  setCountdown(text: string | null): void {
    this.countdown.style.display = text ? 'block' : 'none';
    if (text) {
      this.countdown.textContent = text;
      this.countdown.animate([{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 250, easing: 'ease-out' });
    }
  }

  message(text: string, seconds = 1.8): void {
    this.msg.textContent = text;
    this.msg.style.opacity = '1';
    window.clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => (this.msg.style.opacity = '0'), seconds * 1000);
  }

  /** On-screen joystick: up/down = throttle/brake, left/right = steer. */
  private setupStick(stick: HTMLElement): void {
    const knob = stick.querySelector<HTMLElement>('.knob')!;
    let id: number | null = null;
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      knob.style.transform = `translate(${dx * r.width * 0.35}px, ${dy * r.height * 0.35}px)`;
      const dead = 0.15;
      const steer = Math.abs(dx) > dead ? dx : 0;
      this.touch = { steer, throttle: dy < -dead ? Math.min(1, -dy * 1.3) : 0, brake: dy > dead ? Math.min(1, dy * 1.3) : 0 };
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      this.touch = null;
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
