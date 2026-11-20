import { env, makeReverb, noiseSource } from './dsp';
import { EngineSound } from './EngineSound';
import type { EngineProfile } from './engineProfiles';

export type AudioEnv = 'open' | 'tunnel' | 'canopy';

/** Reverb send level and ambience per environment. */
const ENV_PARAMS: Record<AudioEnv, { wet: number; lowpass: number; rumble: number }> = {
  open: { wet: 0.06, lowpass: 9000, rumble: 0.0 },
  canopy: { wet: 0.22, lowpass: 8000, rumble: 0.015 },
  tunnel: { wet: 0.7, lowpass: 5200, rumble: 0.06 },
};

/**
 * Procedural retro sound effects. Everything is synthesised (no assets).
 * Continuous: engine + wind + environment ambience. One-shots: whoosh, countdown, scrape, impact, boost, blip, thunder.
 */
export class Sfx {
  private readonly out: GainNode;
  private readonly reverbSend: GainNode;
  private readonly envFilter: BiquadFilterNode;
  private env: AudioEnv = 'open';

  private readonly engine: EngineSound;
  private readonly windFilter: BiquadFilterNode;
  private readonly windGain: GainNode;
  private readonly rumbleGain: GainNode;
  private readonly boostGain: GainNode;
  private readonly boostFilter: BiquadFilterNode;
  private boostOn = false;
  /** When false the engine + wind are silenced (menus). */
  engineOn = true;

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    const t = ctx.currentTime;
    // Environment chain: everything → envFilter → out (dry) + reverb send.
    this.out = ctx.createGain();
    this.out.connect(destination);
    this.envFilter = ctx.createBiquadFilter();
    this.envFilter.type = 'lowpass';
    this.envFilter.frequency.value = ENV_PARAMS.open.lowpass;
    this.envFilter.connect(this.out);
    const reverb = makeReverb(ctx, 1.8, 2.5);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = ENV_PARAMS.open.wet;
    this.envFilter.connect(this.reverbSend);
    this.reverbSend.connect(reverb);
    reverb.connect(this.out);

    // --- Engine (crossfaded RPM loops + tyre squeal).
    this.engine = new EngineSound(ctx, this.envFilter);

    // --- Wind / road noise rising with speed.
    const wind = noiseSource(ctx, true);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.envFilter);
    wind.start(t);

    // --- Tunnel / canopy low rumble.
    const rumble = noiseSource(ctx, true);
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 140;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(rf).connect(this.rumbleGain).connect(this.out);
    rumble.start(t);

    // --- Boost: a sustained jet roar (rushing noise + low afterburner growl) while boosting.
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    this.boostGain.connect(this.envFilter);
    const jet = noiseSource(ctx, true);
    this.boostFilter = ctx.createBiquadFilter();
    this.boostFilter.type = 'bandpass';
    this.boostFilter.frequency.value = 900;
    this.boostFilter.Q.value = 0.6;
    jet.connect(this.boostFilter).connect(this.boostGain);
    jet.start(t);
    const growlF = ctx.createBiquadFilter();
    growlF.type = 'lowpass';
    growlF.frequency.value = 320;
    const growlG = ctx.createGain();
    growlG.gain.value = 0.6;
    for (const [f, type] of [[46, 'sawtooth'], [46.7, 'square']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(growlF);
      o.start(t);
    }
    growlF.connect(growlG).connect(this.boostGain);
  }

  /** VHS rewind: a high, wobbly tape whine plus mechanical clunk. */
  rewind(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(2400, t + 0.9);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 18;
    const lg = ctx.createGain();
    lg.gain.value = 120;
    lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 2;
    const g = ctx.createGain();
    env(g.gain, t, 0.08, 0.05, 1.0);
    o.connect(f).connect(g).connect(this.envFilter);
    o.start(t); lfo.start(t);
    o.stop(t + 1.2); lfo.stop(t + 1.2);
    this.impact(0.25);
  }

  private rattleBuf: AudioBuffer | null = null;

  /**
   * A rattlesnake's rattle as recorded sound: a stream of dry clicks (~50 a second, never perfectly regular),
   * each a sharp knock that rings briefly high up, louder and quieter as the tail shakes. Built once.
   */
  private rattle(): AudioBuffer {
    if (this.rattleBuf) return this.rattleBuf;
    const sr = this.ctx.sampleRate, len = Math.round(sr * 1.5);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let t = 0.01, k = 0;
    while (t < 1.45) {
      const at = Math.round(t * sr);
      const amp = (0.55 + 0.45 * Math.random()) * (0.75 + 0.25 * Math.sin(k * 0.37));
      const f = 4200 + Math.random() * 2600, decay = 0.0012 + Math.random() * 0.0008;
      for (let i = 0; i < sr * 0.008 && at + i < len; i++) {
        const tt = i / sr;
        d[at + i] += amp * (Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt / decay) * 0.8 + (Math.random() * 2 - 1) * Math.exp(-tt / 0.0006) * 0.6);
      }
      t += 1 / (46 + Math.random() * 12);
      k++;
    }
    // Fade in and out so it starts and ends naturally.
    for (let i = 0; i < len; i++) d[i] *= Math.min(1, i / (sr * 0.06)) * Math.min(1, (len - i) / (sr * 0.25));
    this.rattleBuf = buf;
    return buf;
  }

  /**
   * A snake's hiss: one forced exhale. Breathy noise shaped into a broad band around 5-6 kHz that drifts a
   * little, rising fast, holding with an uneven flutter (air through a mouth is never steady) and dying away,
   * with the rattle under it, slightly off to one side.
   */
  hiss(): void {
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = 1.15 + Math.random() * 0.3;
    const n = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    hp.Q.value = 0.5;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(5000 + Math.random() * 600, t);
    band.frequency.linearRampToValueAtTime(6200 + Math.random() * 900, t + dur);
    const air = ctx.createBiquadFilter();
    air.type = 'peaking';
    air.frequency.value = 9000;
    air.Q.value = 0.7;
    air.gain.value = 4;
    const top = ctx.createBiquadFilter();
    top.type = 'lowpass';
    top.frequency.value = 11000;
    // The breath: a quick rise, an uneven hold (random-walk flutter), a long fade.
    const env = new Float32Array(96);
    let w = 0;
    for (let i = 0; i < env.length; i++) {
      const x = i / (env.length - 1);
      w += (Math.random() - 0.5) * 0.18 - w * 0.25;
      const shape = Math.min(1, x / 0.07) * (x < 0.55 ? 1 : Math.pow(1 - (x - 0.55) / 0.45, 1.6));
      env[i] = Math.max(0.0001, shape * (0.85 + w) * 0.55);
    }
    env[env.length - 1] = 0.0001;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueCurveAtTime(env, t, dur);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.3);
    n.connect(hp).connect(band).connect(air).connect(top).connect(g).connect(pan).connect(this.envFilter);
    // A little of the unfiltered breath too (the hiss is not a pure band).
    const breath = ctx.createGain();
    breath.gain.value = 0.18;
    hp.connect(breath).connect(g);
    n.start(t, Math.random());
    n.stop(t + dur + 0.05);
    // The rattle, a touch quieter, starting just before the hiss.
    const r = ctx.createBufferSource();
    r.buffer = this.rattle();
    r.playbackRate.value = 0.92 + Math.random() * 0.16;
    const rg = ctx.createGain();
    rg.gain.value = 0.2;
    const rbp = ctx.createBiquadFilter();
    rbp.type = 'highpass';
    rbp.frequency.value = 1800;
    r.connect(rbp).connect(rg).connect(pan);
    r.start(Math.max(ctx.currentTime, t - 0.05));
  }

  /** Boost roar on / off (called every frame); the roar brightens with speed. */
  setBoost(on: boolean, speed01 = 0.8): void {
    const t = this.ctx.currentTime;
    this.boostFilter.frequency.setTargetAtTime(700 + speed01 * 1400, t, 0.1);
    if (on === this.boostOn) return;
    this.boostOn = on;
    this.boostGain.gain.setTargetAtTime(on ? 0.32 : 0, t, on ? 0.05 : 0.25);
  }

  private lastT = 0;

  /** Engine character for the player's car. */
  setEngineProfile(p: EngineProfile): void {
    this.engine.setProfile(p);
  }

  /** Garage engine rev. */
  previewEngine(p: EngineProfile): void {
    this.engine.preview(p);
  }

  /** Per-frame update of the continuous sounds. */
  update(s: { speed01: number; throttle: number; environment: AudioEnv; rpm?: number; gear?: number; slip?: number }): void {
    const t = this.ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const speed = Math.max(0, Math.min(1, s.speed01));
    const on = this.engineOn ? 1 : 0;
    if (this.engine.isPreviewing) return;
    this.engine.setActive(this.engineOn);
    this.engine.update(
      { rpm: s.rpm ?? 900 + speed * 6000, throttle: s.throttle, gear: s.gear ?? 1, slip: s.slip ?? 0, speed01: speed },
      this.engineOn,
      dt,
    );
    this.windFilter.frequency.setTargetAtTime(400 + speed * 2200, t, 0.2);
    this.windGain.gain.setTargetAtTime(speed * speed * 0.14 * on, t, 0.2);
    this.setEnvironment(s.environment);
  }

  setEnvironment(e: AudioEnv): void {
    if (e === this.env) return;
    const prev = this.env;
    this.env = e;
    const t = this.ctx.currentTime;
    const p = ENV_PARAMS[e];
    this.reverbSend.gain.setTargetAtTime(p.wet, t, 0.15);
    this.envFilter.frequency.setTargetAtTime(p.lowpass, t, 0.15);
    this.rumbleGain.gain.setTargetAtTime(p.rumble, t, 0.2);
    // Entering / leaving a tunnel: big whoosh.
    if (e === 'tunnel' || prev === 'tunnel') this.whoosh(0, 1.0, 0.9);
  }

  // ------------------------------------------------------------ one-shots

  /** Filtered noise sweep. pan -1..1, strength 0..1, duration s. */
  whoosh(pan = 0, strength = 0.6, duration = 0.6): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = noiseSource(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + duration * 0.45);
    f.frequency.exponentialRampToValueAtTime(400, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * strength, t + duration * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(pan, t);
    p.pan.linearRampToValueAtTime(-pan * 0.5, t + duration);
    src.connect(f).connect(g).connect(p).connect(this.envFilter);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  /** Car passing by on the side (pan -1 = left). */
  passBy(pan = 0): void {
    this.whoosh(pan, 0.5, 0.5);
  }

  /** Countdown beep: n = 3, 2, 1 or 0 for GO. */
  countdown(n: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const go = n <= 0;
    for (const detune of [0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = go ? 880 : 440;
      o.detune.value = detune;
      const g = ctx.createGain();
      env(g.gain, t, 0.12, 0.005, go ? 0.9 : 0.25);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + (go ? 1 : 0.3));
    }
  }

  /** Sliding along a wall. intensity 0..1, duration s. */
  scrape(intensity = 0.7, duration = 0.4): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = noiseSource(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 6;
    f.frequency.value = 2200;
    // Jittery, metallic: LFO on the filter.
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 37;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 900;
    lfo.connect(lfoGain).connect(f.frequency);
    const g = ctx.createGain();
    env(g.gain, t, 0.4 * intensity, 0.01, duration);
    src.connect(f).connect(g).connect(this.envFilter);
    src.start(t, Math.random());
    lfo.start(t);
    src.stop(t + duration + 0.05);
    lfo.stop(t + duration + 0.05);
  }

  /** Crash / bump. strength 0..1. */
  impact(strength = 1): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const og = ctx.createGain();
    env(og.gain, t, 0.8 * strength, 0.003, 0.3);
    o.connect(og).connect(this.envFilter);
    o.start(t);
    o.stop(t + 0.35);
    const n = noiseSource(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3000;
    const ng = ctx.createGain();
    env(ng.gain, t, 0.5 * strength, 0.002, 0.18);
    n.connect(f).connect(ng).connect(this.envFilter);
    n.start(t, Math.random());
    n.stop(t + 0.25);
  }

  /** Nitro / boost: rising saw sweep + air burst. */
  boost(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.6);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(5000, t + 0.6);
    const g = ctx.createGain();
    env(g.gain, t, 0.32, 0.03, 0.7);
    o.connect(f).connect(g).connect(this.envFilter);
    o.start(t);
    o.stop(t + 0.8);
    this.whoosh(0, 1, 0.9);
  }

  /** UI blip. */
  blip(high = false): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(high ? 1320 : 660, t);
    o.frequency.exponentialRampToValueAtTime(high ? 1760 : 990, t + 0.06);
    const g = ctx.createGain();
    env(g.gain, t, 0.08, 0.002, 0.08);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.12);
  }

  /** Distant thunder rumble (for the weather system). delay s, strength 0..1. */
  thunder(delay = 0, strength = 1): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const n = noiseSource(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 2.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * strength, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.3 * strength, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    n.connect(f).connect(g).connect(this.out);
    n.connect(f).connect(g).connect(this.reverbSend);
    n.start(t, Math.random());
    n.stop(t + 3.3);
  }

}
