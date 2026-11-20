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
  private readonly beatDot: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly vcr: HTMLElement;
  private vcrTimer = 0;
  private readonly posBox: HTMLElement;
  private readonly beatPopEl: HTMLElement;
  private beatPopTimer = 0;
  private linesK = 0;
  /** Touch boost button held. */
  boostHeld = false;
  private msgTimer = 0;
  /** Touch controls output (null on devices without touch). */
  touch: InputState | null = null;
  /** Touch scheme: on-screen ◀ ▶ buttons, a steering stick, or tilting the phone; autoGas = throttle unless braking. */
  private touchMode: 'buttons' | 'stick' | 'tilt' = 'buttons';
  private autoGas = true;
  private readonly held = new Map<number, Set<string>>(); // pointer id -> the buttons under that finger
  private stickX = 0;
  private tiltX = 0;
  private readonly isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
  onPause?: () => void;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div class="hud-tl"><div class="hud-small">LAP</div><div class="hud-big" data-lap>1/3</div>
        <div class="hud-small" style="margin-top:8px">TIME</div><div class="hud-big" data-time>0:00.00</div>
        <div class="hud-laptime"><span class="hud-small">LAP</span> <span data-laptime>0:00.00</span></div>
        <div class="hud-laptime"><span class="hud-small">BEST</span> <span data-best>—</span></div></div>
      <div class="hud-tr"><div data-posbox><div class="hud-small">POS</div><div class="hud-big" data-pos>1/4</div></div><div class="hud-mode" data-mode></div></div>
      <div class="hud-speed"><span class="v" data-speed>0</span><span class="u">KM/H</span><div class="hud-bar" data-bar></div></div>
      <div class="speedlines" data-lines></div>
      <div class="beat-pop" data-beatpop></div>
      <div class="vcr-osd" data-vcr></div>
      <div class="hud-boost" data-boostbox><div class="hud-small"><span class="beat-dot" data-beatdot></span>BOOST</div><div class="boost-track"><div class="boost-fill" data-boost></div></div></div>
      <button class="boost-btn" data-boostbtn>BOOST</button>
      <div class="countdown" data-count></div>
      <div class="hud-msg" data-msg></div>
      <div class="tc-steer"><button class="tc-btn tc-left" data-k="left">◀</button><button class="tc-btn tc-right" data-k="right">▶</button></div>
      <div class="stick" data-stick><div class="knob"></div></div>
      <div class="tc-pedals"><button class="tc-btn tc-drift" data-k="drift">DRIFT</button><button class="tc-btn tc-brake" data-k="brake">BRAKE</button><button class="tc-btn tc-gas" data-k="gas">GAS</button></div>
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
    this.beatDot = q('[data-beatdot]');
    this.modeEl = q('[data-mode]');
    this.vcr = q('[data-vcr]');
    this.posBox = q('[data-posbox]');
    this.beatPopEl = q('[data-beatpop]');
    const bb = q('[data-boostbtn]');
    // Touch boost is a tap switch: it burns until the bar is empty (or a second tap), so the thumb is free for DRIFT.
    bb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.boostHeld = !this.boostHeld;
      bb.classList.toggle('held', this.boostHeld);
      navigator.vibrate?.(this.boostHeld ? 15 : 8);
    });
    this.boostBtn = bb;
    const bar = q('[data-bar]');
    for (let i = 0; i < 16; i++) {
      const b = document.createElement('i');
      bar.appendChild(b);
      this.bar.push(b);
    }
    q('[data-pause]').addEventListener('click', () => this.onPause?.());
    this.setupStick(q('[data-stick]'));
    this.setupButtons();
    window.addEventListener('deviceorientation', (e) => this.onTilt(e));
    this.setTouchMode('buttons', true);
  }

  /** Pick the touch scheme (Options). */
  setTouchMode(mode: 'buttons' | 'stick' | 'tilt', autoGas: boolean): void {
    this.touchMode = mode;
    this.autoGas = autoGas;
    this.el.classList.remove('tc-buttons', 'tc-stick', 'tc-tilt');
    this.el.classList.add(`tc-${mode}`);
    this.el.classList.toggle('autogas', autoGas);
    this.recompute();
  }

  private boostBtn: HTMLElement | null = null;

  /**
   * Thumb-friendly touch zones. Every finger is tracked on its own (steer + pedals at once), a finger may slide
   * from button to button, and on the right a thumb presses every button within a thumb's reach — rest it on
   * the edge between DRIFT and BRAKE and both work. The steering zone picks the nearest arrow (never both).
   */
  private setupButtons(): void {
    for (const zone of this.el.querySelectorAll<HTMLElement>('.tc-steer, .tc-pedals')) {
      const btns = [...zone.querySelectorAll<HTMLElement>('.tc-btn')];
      const pedals = zone.classList.contains('tc-pedals');
      const REACH = 28; // px around a pedal that still counts (a thumb is wider than its touch point)
      const hit = (x: number, y: number): Set<string> => {
        const out = new Set<string>();
        let best = '', bd = Infinity;
        for (const b of btns) {
          if (b.offsetParent === null) continue; // hidden (GAS with auto gas)
          const r = b.getBoundingClientRect();
          const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
          if (pedals) { if (d <= REACH) out.add(b.dataset.k!); } else if (d < bd) { bd = d; best = b.dataset.k!; }
        }
        if (!pedals && best && bd < 80) out.add(best);
        return out;
      };
      const set = (e: PointerEvent) => {
        const prev = this.held.get(e.pointerId);
        const now = hit(e.clientX, e.clientY);
        if ([...now].some((k) => !prev?.has(k))) navigator.vibrate?.(8);
        this.held.set(e.pointerId, now);
        this.paintButtons();
        this.recompute();
      };
      zone.addEventListener('pointerdown', (e) => { e.preventDefault(); zone.setPointerCapture(e.pointerId); set(e); });
      zone.addEventListener('pointermove', (e) => { if (this.held.has(e.pointerId)) set(e); });
      const up = (e: PointerEvent) => { if (this.held.delete(e.pointerId)) { this.paintButtons(); this.recompute(); } };
      zone.addEventListener('pointerup', up);
      zone.addEventListener('pointercancel', up);
      zone.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  private heldKeys(): Set<string> {
    const keys = new Set<string>();
    for (const s of this.held.values()) for (const k of s) keys.add(k);
    return keys;
  }

  private paintButtons(): void {
    const keys = this.heldKeys();
    this.el.querySelectorAll<HTMLElement>('.tc-btn').forEach((b) => b.classList.toggle('held', keys.has(b.dataset.k!)));
  }

  /** Tilt steering: the phone held in landscape like a wheel (about 25 degrees = full lock). */
  private onTilt(e: DeviceOrientationEvent): void {
    if (this.touchMode !== 'tilt' || e.beta === null) return;
    const angle = screen.orientation?.angle ?? (window.orientation as number | undefined) ?? 90;
    const raw = (angle === 90 ? 1 : angle === 270 || angle === -90 ? -1 : 0) * e.beta + (angle === 0 ? e.gamma ?? 0 : 0);
    const dead = 2;
    const v = Math.abs(raw) < dead ? 0 : (raw - Math.sign(raw) * dead) / 23;
    this.tiltX = Math.max(-1, Math.min(1, v));
    this.recompute();
  }

  private recompute(): void {
    if (!this.isTouch) { this.touch = null; return; }
    const keys = this.heldKeys();
    let steer = 0;
    if (this.touchMode === 'buttons') steer = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    else if (this.touchMode === 'stick') steer = this.stickX;
    else steer = this.tiltX;
    const brake = keys.has('brake') ? 1 : 0;
    const throttle = brake ? 0 : this.autoGas || keys.has('gas') ? 1 : 0;
    this.touch = { steer, throttle, brake, handbrake: keys.has('drift') ? 1 : 0 };
  }

  show(on: boolean): void {
    this.el.classList.toggle('active', on);
  }

  update(d: { lap: number; laps: number; pos: number; total: number; time: number; kmh: number; speed01: number; boost?: number; boosting?: boolean; dt?: number; lapTime?: number; best?: number }): void {
    if (d.lapTime !== undefined) this.lapTime.textContent = formatTime(Math.max(0, d.lapTime));
    this.best.textContent = d.best !== undefined && Number.isFinite(d.best) ? formatTime(d.best) : '—';
    const b = d.boost ?? 0;
    // Touch boost switch: off again once the bar is empty.
    if (this.boostHeld && b < 0.01 && !d.boosting) { this.boostHeld = false; this.boostBtn?.classList.remove('held'); }
    this.boostFill.style.width = `${(b * 100).toFixed(1)}%`;
    this.boostBox.classList.toggle('full', b > 0.98);
    this.boostBox.classList.toggle('low', !!d.boosting && b < 0.2);
    this.boostBox.classList.toggle('firing', !!d.boosting);
    this.linesK += ((d.boosting ? 1 : 0) - this.linesK) * Math.min(1, (d.dt ?? 1 / 60) * 6);
    this.lines.style.opacity = (this.linesK * 0.6).toFixed(3);
    this.lap.textContent = Number.isFinite(d.laps) ? `${Math.min(d.lap, d.laps)}/${d.laps}` : String(d.lap);
    this.pos.textContent = `${d.pos}/${d.total}`;
    this.time.textContent = formatTime(d.time);
    this.speed.textContent = String(Math.round(d.kmh));
    const n = Math.round(d.speed01 * this.bar.length);
    this.bar.forEach((b, i) => {
      b.classList.toggle('on', i < n);
      b.classList.toggle('hot', i >= this.bar.length * 0.75);
    });
  }

  /** VCR on-screen text ("◀◀ REW", "▶ PLAY"); seconds = 0 keeps it until replaced. */
  vcrText(text: string, seconds = 1.6): void {
    this.vcr.textContent = text;
    this.vcr.style.opacity = text ? '1' : '0';
    window.clearTimeout(this.vcrTimer);
    if (text && seconds > 0) this.vcrTimer = window.setTimeout(() => (this.vcr.style.opacity = '0'), seconds * 1000);
  }

  /** Game-mode lines (null = normal race: show the position instead). */
  setModeLines(lines: string[] | null): void {
    this.posBox.style.display = lines ? 'none' : '';
    const html = lines ? lines.filter(Boolean).map((l) => `<div>${l}</div>`).join('') : '';
    if (this.modeEl.innerHTML !== html) this.modeEl.innerHTML = html;
  }

  /** Beat indicator: k = 0..1 pulse; `window` = currently inside the on-beat window. */
  setBeat(k: number, inWindow: boolean): void {
    this.beatDot.style.opacity = (0.25 + 0.75 * k).toFixed(2);
    this.beatDot.style.transform = `scale(${(0.8 + 0.6 * k).toFixed(2)})`;
    this.beatDot.classList.toggle('window', inWindow);
  }

  /** Short popup for an on-beat move ("ON BEAT ×3"). */
  beatPop(text: string, good: boolean): void {
    const el = this.beatPopEl;
    el.textContent = text;
    el.classList.toggle('miss', !good);
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
    window.clearTimeout(this.beatPopTimer);
    this.beatPopTimer = window.setTimeout(() => el.classList.remove('show'), 900);
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
      knob.style.transform = `translate(${dx * r.width * 0.35}px, ${dy * r.height * 0.12}px)`;
      // Steering only (gas / brake are buttons): a small dead zone, then a slightly progressive curve.
      const dead = 0.12;
      const ax = Math.max(0, Math.abs(dx) - dead) / (1 - dead);
      this.stickX = Math.sign(dx) * ax ** 1.3;
      this.recompute();
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      this.stickX = 0;
      this.recompute();
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
