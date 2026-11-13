import { driveCurve, noiseSource } from './dsp';
import { ENGINES, EngineProfile } from './engineProfiles';

/**
 * Engine sound built the way racing games do it: a few seamless engine loops recorded
 * (here: synthesised) at fixed RPMs, crossfaded and pitch-shifted by the current RPM.
 *
 * The synthetic loops are made of individual V8 firing pulses (exhaust pressure waves with
 * fixed resonances and uneven per-cylinder strength → burble). Because each loop is only
 * pitch-shifted a little, the resonances stay put and it doesn't sound like a chipmunk saw.
 *
 * Real recordings can replace the synthetic loops: put files in /public/audio/engine/ and
 * list them in engine.json as [{ "file": "low.ogg", "rpm": 1500 }, ...].
 */
interface Layer {
  rpm: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/** RBJ peaking-EQ biquad coefficients. */
function peaking(sr: number, f: number, q: number, dB: number): number[] {
  const A = Math.pow(10, dB / 40), w = (2 * Math.PI * f) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const a0 = 1 + al / A;
  return [(1 + al * A) / a0, (-2 * c) / a0, (1 - al * A) / a0, (-2 * c) / a0, (1 - al / A) / a0];
}

/** Run a filter over a circular buffer twice (first pass warms the state) → seamless loop. */
function circular(d: Float32Array, step: (x: number) => number): void {
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < d.length; i++) {
    const y = step(d[i]);
    if (pass === 1) d[i] = y;
  }
}

/**
 * One seamless engine loop at `rpm`: exhaust pressure pulses per firing (with per-cylinder strength),
 * a little combustion noise, then an exhaust-pipe comb resonance and resonance peaks.
 */
function synthLoop(ctx: BaseAudioContext, rpm: number, p: EngineProfile): { buffer: AudioBuffer; rpm: number } {
  const sr = ctx.sampleRate;
  const fire = (rpm / 60) * (p.cylinders / 2); // 4-stroke: each cylinder fires every 2 revolutions
  const P = Math.max(8, Math.round(sr / fire));
  const realRpm = (sr / P / (p.cylinders / 2)) * 60;
  const pat = p.firing.length;
  const firings = pat * Math.max(2, Math.round((0.5 * sr) / (P * pat)));
  const len = P * firings;
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let seed = 98765 + Math.round(rpm) * 7 + p.cylinders * 131;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const pulseLen = Math.min(P * 3, Math.round(sr * 0.006));
  for (let k = 0; k < firings; k++) {
    const amp = p.firing[k % pat] * (0.94 + 0.06 * Math.sin(k * 2.3));
    const jitter = Math.round(Math.sin(k * 1.9) * P * 0.015); // tiny timing irregularity
    const start = k * P + jitter;
    for (let i = 0; i < pulseLen; i++) {
      const t = i / sr;
      // Asymmetric pressure pulse (fast rise, slower fall) + a short combustion noise burst.
      const pulse = (1 - Math.exp(-t / 0.00025)) * Math.exp(-t / 0.0011) - 0.35 * Math.exp(-t / 0.0028) * (1 - Math.exp(-t / 0.0012));
      const noise = rnd() * Math.exp(-t / 0.0016) * p.rasp * 0.5;
      d[((start + i) % len + len) % len] += amp * (pulse + noise);
    }
  }
  // Exhaust pipe: comb resonance y[n] = x[n] + g * y[n - D].
  const D = Math.max(2, Math.round((p.pipeMs / 1000) * sr));
  const hist = new Float32Array(D);
  let hi = 0;
  circular(d, (x) => {
    const y = x + p.pipeFeedback * hist[hi];
    hist[hi] = y;
    hi = (hi + 1) % D;
    return y;
  });
  // Resonance peaks (muffler / intake box).
  for (const [f, dB] of p.resonances) {
    const [b0, b1, b2, a1, a2] = peaking(sr, f, 1.4, dB);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    circular(d, (x) => {
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      return y;
    });
  }
  // Remove DC, soft-saturate (more rasp = more grit), normalise.
  let mean = 0;
  for (let i = 0; i < len; i++) mean += d[i];
  mean /= len;
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i] - mean));
  const drive = 1.2 + p.rasp * 2.2;
  for (let i = 0; i < len; i++) d[i] = Math.tanh(((d[i] - mean) / peak) * drive) / Math.tanh(drive) * 0.9;
  return { buffer: buf, rpm: realRpm };
}

export class EngineSound {
  readonly out: GainNode;
  private readonly layers: Layer[] = [];
  private readonly drive: WaveShaperNode;
  private readonly tone: BiquadFilterNode;
  private readonly body: GainNode;
  private readonly limiter: GainNode;
  private readonly whine: OscillatorNode;
  private readonly whineGain: GainNode;
  private readonly squealA: BiquadFilterNode;
  private readonly squealB: BiquadFilterNode;
  private readonly squealGain: GainNode;
  private lastThrottle = 0;
  private lastGear = 1;
  private highThrottleTime = 0;
  private crackleUntil = 0;
  private nextCrackle = 0;
  private limiterPhase = 0;
  private profile: EngineProfile = ENGINES.flat12;
  private usingSamples = false;
  private previewTimer = 0;
  private previewing = false;

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);

    // Engine chain: layers → body gain → limiter stutter → drive → tone filter → out.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.9;
    this.tone.frequency.value = 2000;
    this.drive = ctx.createWaveShaper();
    this.drive.curve = driveCurve(1.8);
    this.drive.oversample = '2x';
    this.limiter = ctx.createGain();
    this.body = ctx.createGain();
    this.body.connect(this.limiter).connect(this.drive).connect(this.tone).connect(this.out);
    // A touch of low-end weight.
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 160;
    lowShelf.gain.value = 5;
    this.tone.disconnect();
    this.tone.connect(lowShelf).connect(this.out);

    this.setProfile(ENGINES.flat12);
    void this.tryLoadSamples();

    // Supercharger whine.
    this.whine = ctx.createOscillator();
    this.whine.type = 'triangle';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.out);
    this.whine.start();

    // Tyre squeal: two resonant noise bands, slightly wobbling.
    const n = noiseSource(ctx, true);
    this.squealA = ctx.createBiquadFilter();
    this.squealA.type = 'bandpass';
    this.squealA.frequency.value = 1900;
    this.squealA.Q.value = 9;
    this.squealB = ctx.createBiquadFilter();
    this.squealB.type = 'bandpass';
    this.squealB.frequency.value = 2700;
    this.squealB.Q.value = 12;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    n.connect(this.squealA).connect(this.squealGain);
    n.connect(this.squealB).connect(this.squealGain);
    this.squealGain.connect(destination);
    n.start();
  }

  private addLayer(buffer: AudioBuffer, rpm: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.body);
    src.start(this.ctx.currentTime + Math.random() * 0.05);
    this.layers.push({ rpm, src, gain });
    this.layers.sort((a, b) => a.rpm - b.rpm);
  }

  /** Replace the synthetic loops with recordings, if /audio/engine/engine.json exists. */
  private async tryLoadSamples(): Promise<void> {
    try {
      const base = `${import.meta.env.BASE_URL}audio/engine/`;
      const res = await fetch(`${base}engine.json`);
      if (!res.ok) return;
      const list = (await res.json()) as { file: string; rpm: number }[];
      const loaded = await Promise.all(
        list.map(async (e) => ({ rpm: e.rpm, buffer: await this.ctx.decodeAudioData(await (await fetch(base + e.file)).arrayBuffer()) })),
      );
      if (!loaded.length) return;
      this.usingSamples = true;
      for (const l of this.layers) { l.src.stop(); l.gain.disconnect(); }
      this.layers.length = 0;
      for (const l of loaded) this.addLayer(l.buffer, l.rpm);
    } catch {
      /* keep synthetic loops */
    }
  }

  /** Switch engine character: rebuild the rpm loops for this profile. */
  setProfile(p: EngineProfile): void {
    if (this.usingSamples) return;
    this.profile = p;
    for (const l of this.layers) {
      l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      const old = l;
      window.setTimeout(() => { try { old.src.stop(); } catch { /* */ } old.gain.disconnect(); }, 400);
    }
    this.layers.length = 0;
    for (const f of [0.16, 0.42, 0.8]) {
      const { buffer, rpm } = synthLoop(this.ctx, p.redline * f, p);
      this.addLayer(buffer, rpm);
    }
  }

  /** Garage: rev the engine once (idle → near redline → lift-off crackles → idle). */
  preview(p: EngineProfile): void {
    this.setProfile(p);
    window.clearInterval(this.previewTimer);
    this.previewing = true;
    const t0 = performance.now();
    this.setActive(true);
    this.previewTimer = window.setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      const up = Math.min(1, t / 0.9);
      const down = Math.max(0, Math.min(1, (t - 1.15) / 1.1));
      const r = 0.12 + 0.8 * (up * up) * (1 - down);
      const thr = t < 1.15 ? 1 : 0;
      this.update({ rpm: 7600 * r, throttle: thr, gear: 1, slip: 0, speed01: 0 }, true, 0.03);
      if (t > 2.6) {
        window.clearInterval(this.previewTimer);
        this.previewing = false;
        this.setActive(false);
      }
    }, 30);
  }

  get isPreviewing(): boolean {
    return this.previewing;
  }

  setActive(on: boolean): void {
    this.out.gain.setTargetAtTime(on ? 0.4 : 0, this.ctx.currentTime, 0.15);
    if (!on) this.squealGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  update(s: { rpm: number; throttle: number; gear: number; slip: number; speed01: number }, active: boolean, dt: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // Gearbox rpm (idle..7600) mapped onto this engine's own idle..redline range.
    const P = this.profile;
    const rpm = Math.max(P.idle * 0.8, P.idle + ((s.rpm - 900) / (7600 - 900)) * (P.redline - P.idle));
    const thr = Math.max(0, Math.min(1, s.throttle));

    // Crossfade layers in log-rpm space; each layer is pitch-shifted to the current rpm.
    const lr = Math.log(rpm);
    const L = this.layers;
    for (let i = 0; i < L.length; i++) {
      const c = Math.log(L[i].rpm);
      const left = i > 0 ? Math.log(L[i - 1].rpm) : c - 10;
      const right = i < L.length - 1 ? Math.log(L[i + 1].rpm) : c + 10;
      let w = 0;
      if (lr <= c) w = lr <= left ? 0 : (lr - left) / (c - left);
      else w = lr >= right ? 0 : (right - lr) / (right - c);
      w = Math.sin((Math.max(0, Math.min(1, w)) * Math.PI) / 2); // equal-power
      L[i].gain.gain.setTargetAtTime(w, t, 0.03);
      L[i].src.playbackRate.setTargetAtTime(Math.max(0.4, Math.min(2.5, rpm / L[i].rpm)), t, 0.03);
    }

    // Load: on-throttle = louder, brighter; off = muffled burble.
    const load = thr;
    this.body.gain.setTargetAtTime(0.35 + 0.65 * load, t, 0.06);
    this.tone.frequency.setTargetAtTime((500 + load * 3200 + (rpm / P.redline) * 1800) * (0.7 + P.bright * 0.8), t, 0.06);

    // Rev limiter stutter near redline.
    if (rpm > P.redline * 0.97 && thr > 0.5) {
      this.limiterPhase += dt * 16;
      this.limiter.gain.setTargetAtTime(Math.sin(this.limiterPhase * Math.PI * 2) > 0 ? 1 : 0.25, t, 0.005);
    } else {
      this.limiter.gain.setTargetAtTime(1, t, 0.02);
    }

    // Gear change: short torque cut.
    if (s.gear !== this.lastGear) {
      if (s.gear > this.lastGear && active) {
        this.body.gain.cancelScheduledValues(t);
        this.body.gain.setTargetAtTime(0.15, t, 0.01);
        this.body.gain.setTargetAtTime(0.35 + 0.65 * load, t + 0.07, 0.04);
        this.pop(0.5);
      }
      this.lastGear = s.gear;
    }

    // Lift-off after hard driving: crackles + blow-off hiss.
    if (thr > 0.7) this.highThrottleTime += dt;
    if (this.lastThrottle > 0.6 && thr < 0.2 && rpm > 3500 && active) {
      if (this.highThrottleTime > 1.0 && P.turbo > 0.3) this.blowOff();
      this.crackleUntil = t + 1.1;
      this.highThrottleTime = 0;
    }
    if (thr < 0.2 && t < this.crackleUntil && t > this.nextCrackle && active && Math.random() < P.crackle) {
      this.pop((0.25 + Math.random() * 0.35) * (0.6 + P.crackle * 0.6));
      this.nextCrackle = t + 0.05 + Math.random() * 0.16;
    }
    this.lastThrottle = thr;

    this.whine.frequency.setTargetAtTime((rpm / 60) * 9, t, 0.03);
    this.whineGain.gain.setTargetAtTime(active ? (0.002 + thr * 0.03 * (rpm / P.redline)) * P.turbo : 0, t, 0.1);

    // Tyres.
    const sq = active ? Math.pow(Math.max(0, s.slip - 0.15) / 0.85, 1.3) * Math.min(1, s.speed01 * 3) : 0;
    this.squealGain.gain.setTargetAtTime(sq * 0.32, t, 0.05);
    const wob = Math.sin(t * 13) * 60 + Math.sin(t * 7.3) * 40;
    this.squealA.frequency.setTargetAtTime(1800 + wob + s.speed01 * 300, t, 0.05);
    this.squealB.frequency.setTargetAtTime(2600 - wob + s.speed01 * 200, t, 0.05);
  }

  /** Exhaust pop / crackle. */
  private pop(strength: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500 + Math.random() * 1400;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(strength * 0.9, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04 + Math.random() * 0.03);
    n.connect(bp).connect(g).connect(this.out);
    n.start(t);
    n.stop(t + 0.1);
  }

  /** Turbo blow-off valve "pssh". */
  private blowOff(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.Q.value = 0.8;
    hp.frequency.setValueAtTime(4500, t);
    hp.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    n.connect(hp).connect(g).connect(this.out);
    n.start(t);
    n.stop(t + 0.45);
  }
}
