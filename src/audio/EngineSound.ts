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

const WAVE_SIZE = 512; // harmonics of half an engine order: up to order 256

/**
 * This engine's note as a waveform: one period = two crank turns, so harmonic n is engine order n / 2. The loud
 * orders come from the profile; multiples of the profile's `note` order fall off by `tilt`; everything in between is
 * filled in at `fill` with scattered phases (roughness). `coast` = the off-throttle version: darker, lumpier.
 */
function engineWave(ctx: BaseAudioContext, p: EngineProfile, coast: boolean): PeriodicWave {
  const real = new Float32Array(WAVE_SIZE), imag = new Float32Array(WAVE_SIZE);
  const firing = p.note; // the order the note is built on
  let seed = 1234 + p.cylinders * 977 + Math.round(p.redline);
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const amp = new Float32Array(WAVE_SIZE);
  // Roughness between the orders, falling away upward.
  for (let n = 1; n < WAVE_SIZE; n++) amp[n] = (p.fill * (coast ? 1.8 : 1)) / Math.pow(1 + n / (firing * 2), 0.9);
  // The firing order and its multiples.
  for (let k = 1; k * firing * 2 < WAVE_SIZE; k++) amp[Math.round(k * firing * 2)] += 1 / Math.pow(k, p.tilt + (coast ? 0.9 : 0));
  // The engine's signature orders.
  for (const [order, a] of p.orders) {
    const n = Math.round(order * 2);
    if (n > 0 && n < WAVE_SIZE) amp[n] = Math.max(amp[n], a * (coast && order > firing ? 0.45 : 1));
  }
  for (let n = 1; n < WAVE_SIZE; n++) {
    // Firing multiples stay in step (distinct exhaust pulses); everything else gets its own phase.
    const onFiring = Math.abs(n / (firing * 2) - Math.round(n / (firing * 2))) < 1e-6;
    const ph = onFiring ? 0 : rnd() * Math.PI * 2;
    real[n] = amp[n] * Math.cos(ph);
    imag[n] = amp[n] * Math.sin(ph);
  }
  return ctx.createPeriodicWave(real, imag);
}

/** A train of short pulses, one per period: opens the noise gates once per firing. */
function pulseWave(ctx: BaseAudioContext): PeriodicWave {
  const n = 48;
  const real = new Float32Array(n), imag = new Float32Array(n);
  for (let i = 1; i < n; i++) real[i] = 1;
  return ctx.createPeriodicWave(real, imag);
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
  private readonly fanGain: GainNode;
  private readonly fanFilter: BiquadFilterNode;
  private readonly turboOsc: OscillatorNode;
  private readonly turboGain: GainNode;
  private readonly formants: BiquadFilterNode[] = [];
  private readonly howl: BiquadFilterNode;
  private readonly howlGain: GainNode;
  private readonly sub: OscillatorNode;
  private readonly subGain: GainNode;
  private readonly gearOsc: OscillatorNode;
  private readonly gearGain: GainNode;
  // The engine note: two voices (a second one slightly detuned: the other cylinder bank), each with an
  // on-throttle and an off-throttle waveform; combustion rasp, diesel knock and rushing air ride on top.
  private readonly voices: { load: OscillatorNode; coast: OscillatorNode; detune: number }[] = [];
  private readonly loadGain: GainNode;
  private readonly coastGain: GainNode;
  private readonly fireOsc: OscillatorNode;
  private readonly raspBand: BiquadFilterNode;
  private readonly raspDepth: GainNode;
  private readonly knockDepth: GainNode;
  private readonly whooshGain: GainNode;
  /** This car's own gearbox as heard (see EngineProfile.gears): current gear and time left in a shift. */
  private aGear = 0;
  private shiftLeft = 0;
  private rpmNow = 900;
  private lastSpeed01 = 0;
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
    this.drive.curve = driveCurve(1.25);
    this.drive.oversample = '2x';
    this.limiter = ctx.createGain();
    this.body = ctx.createGain();
    // Body resonances that stay put while the revs move (set per engine): the car's voice.
    let node: AudioNode = this.body.connect(this.limiter).connect(this.drive);
    for (let i = 0; i < 3; i++) {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.gain.value = 0;
      this.formants.push(f);
      node = node.connect(f);
    }
    // A touch of low-end weight.
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 160;
    lowShelf.gain.value = 9;
    node.connect(this.tone).connect(lowShelf).connect(this.out);
    // Howl: a narrow band of the engine that follows the revs (intake / exhaust order).
    this.howl = ctx.createBiquadFilter();
    this.howl.type = 'bandpass';
    this.howl.Q.value = 3;
    this.howlGain = ctx.createGain();
    this.howlGain.gain.value = 0;
    this.drive.connect(this.howl).connect(this.howlGain).connect(this.out);
    // Sub thump (half the firing rate) and straight-cut gear whine (follows road speed).
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0;
    this.sub.connect(this.subGain).connect(this.out);
    this.sub.start();
    this.gearOsc = ctx.createOscillator();
    this.gearOsc.type = 'sawtooth';
    const gearBand = ctx.createBiquadFilter();
    gearBand.type = 'bandpass';
    gearBand.frequency.value = 2200;
    gearBand.Q.value = 0.7;
    this.gearGain = ctx.createGain();
    this.gearGain.gain.value = 0;
    this.gearOsc.connect(gearBand).connect(this.gearGain).connect(this.out);
    this.gearOsc.start();

    // Engine note voices.
    this.loadGain = ctx.createGain();
    this.coastGain = ctx.createGain();
    this.loadGain.gain.value = 0;
    this.coastGain.gain.value = 0;
    this.loadGain.connect(this.body);
    this.coastGain.connect(this.body);
    for (let i = 0; i < 2; i++) {
      const load = ctx.createOscillator(), coast = ctx.createOscillator();
      const mix = ctx.createGain();
      mix.gain.value = i === 0 ? 1 : 0.6;
      load.connect(mix).connect(this.loadGain);
      const mix2 = ctx.createGain();
      mix2.gain.value = i === 0 ? 1 : 0.6;
      coast.connect(mix2).connect(this.coastGain);
      load.start(); coast.start();
      this.voices.push({ load, coast, detune: 0 });
    }
    // Noise that is let through once per firing: rasp (into the engine chain) and diesel knock (straight out).
    this.fireOsc = ctx.createOscillator();
    this.fireOsc.setPeriodicWave(pulseWave(ctx));
    this.fireOsc.start();
    const grit = noiseSource(ctx, true);
    this.raspBand = ctx.createBiquadFilter();
    this.raspBand.type = 'bandpass';
    this.raspBand.Q.value = 0.9;
    const raspGate = ctx.createGain();
    raspGate.gain.value = 0;
    this.raspDepth = ctx.createGain();
    this.raspDepth.gain.value = 0;
    this.fireOsc.connect(this.raspDepth).connect(raspGate.gain);
    grit.connect(this.raspBand).connect(raspGate).connect(this.body);
    const knockBand = ctx.createBiquadFilter();
    knockBand.type = 'bandpass';
    knockBand.frequency.value = 2600;
    knockBand.Q.value = 2.2;
    const knockGate = ctx.createGain();
    knockGate.gain.value = 0;
    this.knockDepth = ctx.createGain();
    this.knockDepth.gain.value = 0;
    this.fireOsc.connect(this.knockDepth).connect(knockGate.gain);
    grit.connect(knockBand).connect(knockGate).connect(this.out);
    // Rushing air.
    const air = ctx.createBiquadFilter();
    air.type = 'bandpass';
    air.frequency.value = 1500;
    air.Q.value = 0.5;
    this.whooshGain = ctx.createGain();
    this.whooshGain.gain.value = 0;
    grit.connect(air).connect(this.whooshGain).connect(this.out);
    grit.start();

    this.setProfile(ENGINES.flat12);
    void this.tryLoadSamples();

    // Supercharger whine.
    this.whine = ctx.createOscillator();
    this.whine.type = 'triangle';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.out);
    this.whine.start();

    // Cooling fan (buses): a broad, steady whoosh that rises a little with the revs.
    const fan = noiseSource(ctx, true);
    this.fanFilter = ctx.createBiquadFilter();
    this.fanFilter.type = 'bandpass';
    this.fanFilter.frequency.value = 450;
    this.fanFilter.Q.value = 0.6;
    this.fanGain = ctx.createGain();
    this.fanGain.gain.value = 0;
    fan.connect(this.fanFilter).connect(this.fanGain).connect(this.out);
    fan.start();
    // Turbo whistle: a high, thin tone rising with revs and boost.
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain).connect(this.out);
    this.turboOsc.start();

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
    // This engine's own waveforms, distortion and noise colour.
    const load = engineWave(this.ctx, p, false), coast = engineWave(this.ctx, p, true);
    this.voices.forEach((v, i) => {
      v.load.setPeriodicWave(load);
      v.coast.setPeriodicWave(coast);
      v.detune = i === 0 ? 0 : p.detune ?? 0;
      v.load.detune.value = v.coast.detune.value = v.detune;
    });
    this.drive.curve = driveCurve(p.drive);
    this.raspBand.frequency.value = p.raspHz ?? 1500;
    this.formants.forEach((f, i) => {
      const [hz, q, dB] = p.formants[i] ?? [1000, 1, 0];
      f.frequency.value = hz; f.Q.value = q; f.gain.value = dB;
    });
    this.aGear = 0;
    this.shiftLeft = 0;
  }

  /** Garage: a short run through the gears (pull away, two or three shifts, lift off) so you hear the gearbox too. */
  preview(p: EngineProfile): void {
    this.setProfile(p);
    window.clearInterval(this.previewTimer);
    this.previewing = true;
    const t0 = performance.now();
    this.setActive(true);
    this.rpmNow = p.idle;
    this.previewTimer = window.setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      // 0.5 s at idle, 5.5 s flat out up to 75 % of top speed (every gear pulled to just under the redline),
      // then off the throttle.
      const run = Math.max(0, Math.min(1, (t - 0.5) / 5.5));
      const coast = Math.max(0, t - 6);
      const speed = t < 0.5 ? 0 : Math.max(0.04, 0.75 * Math.pow(run, 0.9) - coast * 0.14);
      this.update({ rpm: 900, throttle: t > 0.5 && t < 6 ? 1 : 0, gear: 1, slip: 0, speed01: speed }, true, 0.03);
      if (t > 7) {
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
    const P = this.profile;
    const thr = Math.max(0, Math.min(1, s.throttle));
    // Revs. Standing still (grid, garage): free revving from the throttle. Moving: this car's own gearbox.
    let frac: number;
    let shifted = 0;
    if (s.speed01 < 0.03) {
      frac = (s.rpm - 900) / (7600 - 900);
      this.aGear = 0;
    } else {
      const G = P.gears, last = G.length - 1;
      if (this.aGear < last && s.speed01 > G[this.aGear] * 0.985) { this.aGear++; shifted = 1; }
      else if (this.aGear > 0 && s.speed01 < G[this.aGear - 1] * 0.8) { this.aGear--; shifted = -1; }
      const lo = this.aGear === 0 ? 0 : G[this.aGear - 1] * 0.6;
      const k = Math.max(0, Math.min(1.06, (s.speed01 - lo) / (G[this.aGear] - lo)));
      // In gear the engine works between about a quarter and nine tenths of its range (not pinned at the top).
      frac = this.aGear === 0 ? 0.06 + 0.84 * k : 0.22 + 0.68 * k;
      // Garage demo: show the engine off — each gear revs out to just under the redline before the shift.
      if (this.previewing && thr > 0.5) frac = this.aGear === 0 ? 0.08 + 0.9 * k : 0.34 + 0.64 * Math.pow(Math.min(1, k), 1.15);
    }
    if (shifted) this.shiftLeft = P.shiftTime;
    this.shiftLeft = Math.max(0, this.shiftLeft - dt);
    const shifting = this.shiftLeft > 0;
    let target = Math.max(P.idle * 0.8, P.idle + frac * (P.redline - P.idle));
    // A manual / automatic lets the revs fall (or slide) to the next gear; the fast boxes snap.
    const rate = shifting ? (P.shift === 'auto' ? 2.2 / P.shiftTime : P.shift === 'manual' ? 3 / P.shiftTime : 60) : 16;
    this.rpmNow += (target - this.rpmNow) * (1 - Math.exp(-dt * rate));
    let rpm = this.rpmNow;
    // Lumpy idle: the revs hunt.
    const lope = (P.lope ?? 0) * Math.max(0, 1 - (rpm - P.idle) / (P.idle * 1.2));
    if (lope > 0) rpm *= 1 + lope * (0.06 * Math.sin(t * 17.3) + 0.035 * Math.sin(t * 7.1 + 1.3));
    target = rpm;

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

    // The engine note follows the revs exactly (one waveform period = two crank turns).
    if (!this.usingSamples) {
      const f0 = rpm / 120;
      for (const v of this.voices) {
        v.load.frequency.setTargetAtTime(f0, t, 0.02);
        v.coast.frequency.setTargetAtTime(f0, t, 0.02);
      }
      this.loadGain.gain.setTargetAtTime(0.12 + 0.88 * thr, t, 0.04);
      this.coastGain.gain.setTargetAtTime(0.75 * (1 - thr), t, 0.06);
      const fire = (rpm / 60) * (P.cylinders / 2);
      this.fireOsc.frequency.setTargetAtTime(fire, t, 0.02);
      const rr = rpm / P.redline;
      // Exhaust roar: gritty low noise on every firing; every engine has it, the raspy ones more.
      this.raspDepth.gain.setTargetAtTime((0.3 + 0.7 * P.rasp) * (0.2 + 0.8 * thr) * 0.9, t, 0.05);
      this.knockDepth.gain.setTargetAtTime(active ? (P.diesel ?? 0) * (0.5 + 0.5 * thr) * 0.16 : 0, t, 0.05);
      this.whooshGain.gain.setTargetAtTime(active ? (P.whoosh ?? 0) * thr * (0.01 + 0.07 * rr * rr) : 0, t, 0.12);
    }

    // Load: on-throttle = louder, brighter; off = muffled burble.
    const load = thr;
    this.body.gain.setTargetAtTime(0.35 + 0.65 * load, t, 0.06);
    this.tone.frequency.setTargetAtTime((320 + load * 1300 + (rpm / P.redline) * 1100) * (0.6 + P.bright * 0.9), t, 0.06);

    // Rev limiter stutter near redline.
    if (rpm > P.redline * 0.97 && thr > 0.5) {
      this.limiterPhase += dt * 16;
      this.limiter.gain.setTargetAtTime(Math.sin(this.limiterPhase * Math.PI * 2) > 0 ? 1 : 0.25, t, 0.005);
    } else {
      this.limiter.gain.setTargetAtTime(1, t, 0.02);
    }

    // Gear change, each kind of gearbox in its own way.
    if (shifted > 0 && active) {
      const back = 0.35 + 0.65 * load;
      const g = this.body.gain;
      g.cancelScheduledValues(t);
      if (P.shift === 'manual') {
        // Lift, clutch, next gear: a clear gap, then the engine comes back in.
        g.setTargetAtTime(0.1, t, 0.02);
        g.setTargetAtTime(back, t + P.shiftTime, 0.05);
        if (P.flutter && thr > 0.5) this.flutter(P.flutter);
        else if (P.turbo > 0.5 && thr > 0.5) this.blowOff();
      } else if (P.shift === 'auto') {
        // Torque converter: the sound just sags a little while the revs slide down.
        g.setTargetAtTime(back * 0.7, t, 0.08);
        g.setTargetAtTime(back, t + P.shiftTime, 0.12);
      } else if (P.shift === 'dct') {
        // Twin-clutch: a blink of a cut and a sharp crack from the exhaust.
        g.setTargetAtTime(0.25, t, 0.004);
        g.setTargetAtTime(back, t + P.shiftTime, 0.012);
        this.pop(0.75);
        if (P.flutter && thr > 0.5) this.flutter(P.flutter * 0.6);
      } else {
        // Racing sequential: ignition cut, a bang, straight back on.
        g.setTargetAtTime(0.03, t, 0.003);
        g.setTargetAtTime(back, t + P.shiftTime, 0.008);
        this.pop(1.1);
        this.pop(0.6);
      }
    } else if (shifted < 0 && active && (P.shift === 'dct' || P.shift === 'seq')) {
      this.pop(0.5); // throttle blip on the down-shift
    }
    void this.lastGear;

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

    // Supercharger-style whine only on petrol engines; turbos get a real whistle (high, load-dependent).
    this.whine.frequency.setTargetAtTime((rpm / 60) * 9, t, 0.03);
    this.whineGain.gain.setTargetAtTime(active && !P.diesel ? (0.002 + thr * 0.02 * (rpm / P.redline)) * P.turbo : 0, t, 0.1);
    const r01 = rpm / P.redline;
    this.turboOsc.frequency.setTargetAtTime(2400 + r01 * 5200 + thr * 600, t, 0.12);
    this.turboGain.gain.setTargetAtTime(active ? P.turbo * thr * (0.0015 + 0.005 * r01) : 0, t, 0.15);
    // Howl follows the revs at this engine's order; louder on throttle and toward the top end.
    const [order, howlK] = P.howl ?? [4, 0];
    this.howl.frequency.setTargetAtTime(Math.min(2400, Math.max(60, (rpm / 60) * order * 0.5)), t, 0.02);
    this.howlGain.gain.setTargetAtTime(active ? howlK * (0.25 + 0.75 * thr) * (0.3 + 1.4 * r01 * r01) * 0.3 : 0, t, 0.05);
    // Sub thump at half the firing rate, strongest low down and under load.
    this.sub.frequency.setTargetAtTime(Math.min(110, Math.max(28, (rpm / 60) * P.note * 0.5)), t, 0.03);
    this.subGain.gain.setTargetAtTime(active ? (0.25 + (P.sub ?? 0)) * (0.3 + 0.5 * thr) * Math.max(0.2, 1 - r01 * 0.7) * 0.55 : 0, t, 0.06);
    // Blower whine (revs) replaces the generic whine level; gear whine follows road speed.
    if (P.blower) this.whineGain.gain.setTargetAtTime(active ? P.blower * (0.003 + 0.02 * thr * r01) : 0, t, 0.08);
    this.gearOsc.frequency.setTargetAtTime(180 + s.speed01 * 2100, t, 0.05);
    this.gearGain.gain.setTargetAtTime(active ? (P.gearWhine ?? 0) * Math.min(1, s.speed01 * 4) * (0.005 + 0.012 * thr) : 0, t, 0.08);
    const fanK = P.fan ?? 0;
    this.fanGain.gain.setTargetAtTime(active ? fanK * (0.05 + 0.05 * r01) : 0, t, 0.3);
    this.fanFilter.frequency.setTargetAtTime(380 + r01 * 260, t, 0.3);
    // Air brakes: the big "pssht" when the bus comes to a stop.
    if (P.airBrakes && active && this.lastSpeed01 > 0.04 && s.speed01 <= 0.04) this.airHiss();
    this.lastSpeed01 = s.speed01;

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

  /** Air brakes releasing at a stop: a loud, airy hiss with a little rattle. */
  private airHiss(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.03);
    g.gain.setValueAtTime(0.32, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    n.connect(hp).connect(g).connect(this.out);
    n.start(t);
    n.stop(t + 1.0);
  }

  /** Turbo flutter: the "stu-tu-tu-tu" of boost air chopped by the compressor on a lift. */
  private flutter(strength: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    // Six to eight puffs, slowing down and dying away.
    let at = t;
    const puffs = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < puffs; i++) {
      const level = 0.3 * strength * (1 - i / puffs);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(level, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03 + i * 0.004);
      at += 0.04 + i * 0.006;
    }
    n.connect(bp).connect(g).connect(this.out);
    n.start(t, Math.random());
    n.stop(at + 0.1);
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
