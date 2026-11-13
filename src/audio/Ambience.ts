import { noiseSource } from './dsp';

export type AmbienceKind = 'city' | 'beach' | 'desert' | 'harbor' | 'snow' | 'grid' | 'space' | 'underwater' | 'none';

/** Human-readable names for every ambience bed (shown in Options and the now-playing panel). */
export const AMBIENCE_LABELS: Record<AmbienceKind, string> = {
  city: 'City night — traffic, horns & sirens',
  beach: 'Beach — surf, waves & seagulls',
  desert: 'Desert — gusting wind, hawk & crickets',
  harbor: 'Harbor — water, clanks & ship horns',
  snow: 'Mountain — howling wind',
  grid: 'Cyber — digital drone & blips',
  space: 'Deep space — drone & radio beeps',
  underwater: 'Underwater — bubbles & whale song',
  none: 'Off',
};

/**
 * Per-ambience loudness trim so every bed sits at the same level (~4 dB under the music).
 * Calibrated by measuring the RMS of each bed in the browser.
 */
const LEVEL_TRIM: Record<Exclude<AmbienceKind, 'none'>, number> = {
  city: 2.3, beach: 0.88, desert: 1.95, harbor: 3.4, snow: 3.45, grid: 1.7, space: 0.55, underwater: 1.9,
};

/**
 * Procedural background ambience per level, each with a recognisable character:
 * a continuous bed (noise / drones with slow modulation) plus random one-shot events.
 */
export class Ambience {
  readonly out: GainNode;
  private bed: AudioNode[] = [];
  private bedGain: GainNode | null = null;
  private timer: number | null = null;
  kind: AmbienceKind = 'none';

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(destination);
  }

  set(kind: AmbienceKind): void {
    if (kind === this.kind) return;
    this.kind = kind;
    const t = this.ctx.currentTime;
    // Fade the old bed out on its own gain, then free it.
    const oldGain = this.bedGain;
    const oldNodes = this.bed;
    if (oldGain) oldGain.gain.setTargetAtTime(0, t, 0.25);
    window.setTimeout(() => {
      for (const n of oldNodes) {
        try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* already stopped */ }
        n.disconnect();
      }
      oldGain?.disconnect();
    }, 1500);
    this.bed = [];
    this.bedGain = null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (kind !== 'none') this.start(kind);
  }

  // ------------------------------------------------------------------ helpers

  private g(value: number, dest: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    this.bed.push(g);
    return g;
  }

  private filter(type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    this.bed.push(f);
    return f;
  }

  private noise(dest: AudioNode): AudioBufferSourceNode {
    const n = noiseSource(this.ctx, true);
    n.playbackRate.value = 0.9 + Math.random() * 0.2;
    n.connect(dest);
    n.start();
    this.bed.push(n);
    return n;
  }

  private osc(type: OscillatorType, freq: number, dest: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(dest);
    o.start();
    this.bed.push(o);
    return o;
  }

  /** Slow LFO modulating an AudioParam around its current value. */
  private lfo(param: AudioParam, rate: number, depth: number, type: OscillatorType = 'sine'): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
    this.bed.push(o, g);
  }

  private panner(pan: number): StereoPannerNode {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.bedGain ?? this.out);
    return p;
  }

  /** One-shot filtered noise burst with an envelope (waves, whooshes, clanks...). */
  private burst(o: { type: BiquadFilterType; freq: number; q: number; peak: number; attack: number; decay: number; pan?: number; sweepTo?: number }): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const n = noiseSource(ctx);
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.attack + o.decay);
    f.Q.value = o.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.peak, t + o.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.decay);
    n.connect(f).connect(g).connect(this.panner(o.pan ?? 0));
    n.start(t);
    n.stop(t + o.attack + o.decay + 0.1);
  }

  /** One-shot tone with pitch glide. */
  private tone(o: { type: OscillatorType; from: number; to: number; peak: number; attack: number; decay: number; pan?: number; delay?: number }): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02 + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + o.attack + o.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.peak, t + o.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.decay);
    osc.connect(g).connect(this.panner(o.pan ?? 0));
    osc.start(t);
    osc.stop(t + o.attack + o.decay + 0.05);
  }

  // ------------------------------------------------------------------ beds

  private start(kind: AmbienceKind): void {
    const ctx = this.ctx;
    this.bedGain = ctx.createGain();
    this.bedGain.gain.setValueAtTime(0, ctx.currentTime);
    this.bedGain.gain.setTargetAtTime(LEVEL_TRIM[kind as Exclude<AmbienceKind, 'none'>] ?? 1, ctx.currentTime, 0.6);
    this.bedGain.connect(this.out);
    const out = this.bedGain;

    switch (kind) {
      case 'city': {
        // Low traffic rumble + neon hum.
        const lp = this.filter('lowpass', 220, 0.7, this.g(0.5, out));
        this.noise(lp);
        this.lfo(lp.frequency, 0.07, 60);
        this.osc('sine', 120, this.g(0.012, out));
        this.osc('sine', 240, this.g(0.006, out));
        break;
      }
      case 'beach': {
        // Rolling surf with deep swell + sea breeze.
        const surfGain = this.g(0.35, out);
        const lp = this.filter('lowpass', 750, 0.6, surfGain);
        this.noise(lp);
        this.lfo(surfGain.gain, 0.085, 0.3);
        this.lfo(lp.frequency, 0.085, 350);
        const breeze = this.filter('bandpass', 2400, 0.5, this.g(0.06, out));
        this.noise(breeze);
        break;
      }
      case 'desert': {
        const windGain = this.g(0.28, out);
        const bp = this.filter('bandpass', 600, 1.2, windGain);
        this.noise(bp);
        this.lfo(bp.frequency, 0.05, 300);
        this.lfo(windGain.gain, 0.11, 0.18);
        break;
      }
      case 'harbor': {
        const water = this.g(0.3, out);
        const lp = this.filter('lowpass', 420, 1.0, water);
        this.noise(lp);
        this.lfo(water.gain, 0.6, 0.12); // lapping
        this.lfo(lp.frequency, 0.23, 120);
        break;
      }
      case 'snow': {
        // Howling wind: resonant band sweeping slowly, plus a hiss layer.
        const howl = this.g(0.22, out);
        const bp = this.filter('bandpass', 700, 9, howl);
        this.noise(bp);
        this.lfo(bp.frequency, 0.045, 380);
        this.lfo(howl.gain, 0.13, 0.15);
        const hiss = this.filter('highpass', 3000, 0.5, this.g(0.05, out));
        this.noise(hiss);
        break;
      }
      case 'grid': {
        const drone = this.filter('lowpass', 300, 2, this.g(0.08, out));
        this.osc('sawtooth', 55, drone);
        this.osc('sawtooth', 55.4, drone);
        this.lfo(drone.frequency, 0.1, 180);
        break;
      }
      case 'space': {
        const d = this.g(0.2, out);
        this.osc('sine', 41, d);
        this.osc('sine', 61.7, this.g(0.12, out));
        const pad = this.filter('bandpass', 1800, 4, this.g(0.05, out));
        this.noise(pad);
        this.lfo(pad.frequency, 0.03, 900);
        break;
      }
      case 'underwater': {
        const rumble = this.g(0.55, out);
        const lp = this.filter('lowpass', 160, 1.5, rumble);
        this.noise(lp);
        this.lfo(rumble.gain, 0.07, 0.2);
        break;
      }
    }
    this.timer = window.setInterval(() => this.event(kind), 400);
  }

  // ------------------------------------------------------------------ events

  private event(kind: AmbienceKind): void {
    const r = Math.random();
    const pan = Math.random() * 1.6 - 0.8;
    switch (kind) {
      case 'city':
        if (r < 0.09) this.burst({ type: 'bandpass', freq: 500, q: 0.8, peak: 0.22, attack: 0.9, decay: 1.2, pan, sweepTo: 220 }); // car passing
        else if (r < 0.105) this.honk(pan);
        else if (r < 0.11) this.siren(pan);
        break;
      case 'beach':
        if (r < 0.05) this.burst({ type: 'lowpass', freq: 1800, q: 0.5, peak: 0.4, attack: 0.5, decay: 2.8, pan: pan * 0.5, sweepTo: 400 }); // wave crash
        else if (r < 0.12) this.gull(pan);
        break;
      case 'desert':
        if (r < 0.06) this.burst({ type: 'bandpass', freq: 400, q: 1, peak: 0.28, attack: 1.2, decay: 2.0, pan, sweepTo: 1100 }); // gust
        else if (r < 0.075) this.tone({ type: 'sine', from: 2200, to: 1400, peak: 0.08, attack: 0.05, decay: 1.1, pan }); // hawk
        else if (r < 0.2) for (let k = 0; k < 3; k++) this.tone({ type: 'square', from: 4300, to: 4300, peak: 0.012, attack: 0.005, decay: 0.03, pan, delay: k * 0.06 }); // cricket
        break;
      case 'harbor':
        if (r < 0.04) this.burst({ type: 'bandpass', freq: 2600, q: 18, peak: 0.25, attack: 0.002, decay: 0.6, pan }); // metal clank
        else if (r < 0.05) this.shipHorn(pan);
        else if (r < 0.07) this.gull(pan);
        break;
      case 'snow':
        if (r < 0.06) this.burst({ type: 'bandpass', freq: 500, q: 6, peak: 0.25, attack: 1.5, decay: 2.5, pan, sweepTo: 1300 }); // gust howl
        break;
      case 'grid':
        if (r < 0.35) {
          const notes = [440, 523.25, 587.33, 659.25, 783.99, 880];
          this.tone({ type: 'square', from: notes[Math.floor(Math.random() * notes.length)], to: 0, peak: 0.035, attack: 0.005, decay: 0.25, pan }); // blip
        } else if (r < 0.4) this.burst({ type: 'highpass', freq: 5000, q: 1, peak: 0.08, attack: 0.002, decay: 0.08, pan }); // glitch
        break;
      case 'space':
        if (r < 0.06) for (let k = 0; k < 4; k++) this.tone({ type: 'sine', from: 1250, to: 1250, peak: 0.04, attack: 0.005, decay: 0.08, pan, delay: k * 0.14 }); // radio beeps
        break;
      case 'underwater':
        if (r < 0.25) for (let k = 0; k < 5; k++) this.tone({ type: 'sine', from: 300 + Math.random() * 300, to: 900 + Math.random() * 600, peak: 0.05, attack: 0.005, decay: 0.07, pan, delay: k * 0.05 + Math.random() * 0.04 }); // bubbles
        else if (r < 0.27) this.tone({ type: 'sine', from: 240, to: 620, peak: 0.1, attack: 1.2, decay: 2.2, pan }); // whale
        break;
    }
  }

  /** Dolphin chatter: quick rising/falling whistles and a burst of clicks. */
  dolphin(): void {
    const pan = Math.random() * 1.2 - 0.6;
    for (let i = 0; i < 4; i++) {
      const f = 2500 + Math.random() * 1500;
      this.tone({ type: 'sine', from: f, to: f * (i % 2 ? 0.6 : 1.8), peak: 0.07, attack: 0.02, decay: 0.22, pan, delay: i * 0.28 });
    }
    for (let k = 0; k < 12; k++) this.tone({ type: 'square', from: 3200, to: 3000, peak: 0.04, attack: 0.001, decay: 0.012, pan, delay: 1.25 + k * 0.035 });
  }

  private gull(pan: number): void {
    const calls = 2 + Math.floor(Math.random() * 3);
    const f0 = 1500 + Math.random() * 500;
    for (let i = 0; i < calls; i++) this.tone({ type: 'triangle', from: f0 * 1.4, to: f0 * 0.7, peak: 0.1, attack: 0.03, decay: 0.17, pan, delay: i * 0.22 });
  }

  private honk(pan: number): void {
    for (const f of [392, 494]) this.tone({ type: 'sawtooth', from: f, to: f * 0.98, peak: 0.03, attack: 0.02, decay: 0.35, pan });
  }

  private siren(pan: number): void {
    for (let i = 0; i < 4; i++) {
      this.tone({ type: 'triangle', from: 650, to: 950, peak: 0.03, attack: 0.4, decay: 0.4, pan, delay: i * 0.8 });
    }
  }

  private shipHorn(pan: number): void {
    for (const f of [73, 110]) this.tone({ type: 'sawtooth', from: f, to: f, peak: 0.07, attack: 0.3, decay: 2.6, pan: pan * 0.4 });
  }
}
