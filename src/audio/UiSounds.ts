import { env } from './dsp';

/** Short synth UI sounds for menus: hover tick, select, back, start, and a finish fanfare. */
export class UiSounds {
  private readonly out: GainNode;

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.5;
    this.out.connect(destination);
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', peak = 0.12, slideTo?: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 4000;
    const g = ctx.createGain();
    env(g.gain, start, peak, 0.005, dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  hover(): void {
    this.tone(1800, this.ctx.currentTime, 0.04, 'square', 0.05);
  }

  select(): void {
    const t = this.ctx.currentTime;
    this.tone(660, t, 0.08, 'square', 0.1);
    this.tone(990, t + 0.07, 0.12, 'square', 0.1);
  }

  back(): void {
    const t = this.ctx.currentTime;
    this.tone(700, t, 0.08, 'square', 0.09);
    this.tone(440, t + 0.07, 0.12, 'square', 0.09);
  }

  /** Big "let's go" sweep when a race is launched. */
  start(): void {
    const t = this.ctx.currentTime;
    this.tone(220, t, 0.5, 'sawtooth', 0.12, 880);
    this.tone(330, t + 0.05, 0.45, 'sawtooth', 0.08, 1320);
  }

  /** Victory arpeggio. */
  fanfare(win = true): void {
    const t = this.ctx.currentTime;
    const notes = win ? [523, 659, 784, 1047, 784, 1047] : [440, 392, 349, 330];
    notes.forEach((f, i) => this.tone(f, t + i * 0.13, 0.22, 'square', 0.1));
    if (win) this.tone(1047, t + notes.length * 0.13, 0.8, 'triangle', 0.12);
  }
}
