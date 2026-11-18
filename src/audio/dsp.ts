/** Small shared Web Audio helpers. */

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** 2 seconds of white noise, cached per context. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

export function noiseSource(ctx: BaseAudioContext, loop = false): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = loop;
  return s;
}

/** Synthetic reverb impulse: stereo decaying noise. */
export function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Simple soft-clip curve for grit. */
export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

/** Attack/decay envelope on a gain param. */
export function env(p: AudioParam, t: number, peak: number, attack: number, decay: number, floor = 0.0001): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(floor, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(floor, t + attack + decay);
}

/**
 * Reverb node that never throws: a convolver with a synthetic impulse, or (if the browser
 * refuses to create one, e.g. low memory / no audio device) a silent pass-through.
 */
export function makeReverb(ctx: BaseAudioContext, seconds: number, decay: number): AudioNode {
  try {
    const c = ctx.createConvolver();
    c.buffer = impulseResponse(ctx, seconds, decay);
    return c;
  } catch {
    const g = ctx.createGain();
    g.gain.value = 0;
    return g;
  }
}

/**
 * How far ahead of the audio clock the procedural music schedules its notes (seconds). The scheduler runs
 * on the page's main thread, which the renderer can hold up for many frames in a row (slow frames, shader
 * compiles, garbage collection); everything inside this window is already queued on the audio thread and
 * plays on time regardless. (It used to be 120 ms: a few slow frames made the music stutter and drop out.)
 */
export const MUSIC_LOOKAHEAD = 0.9;

/**
 * Step sequencer clock for the procedural songs: calls `onStep(step, time, stepLength)` for every step, well
 * ahead of the audio clock. If the page stalls for longer than the lookahead it skips whole steps, so the
 * music stays on its beat grid (`origin` + n × step) and the beat clock keeps matching what you hear.
 */
export class StepClock {
  step = 0;
  nextTime: number;
  /** AudioContext time of step 0. */
  readonly origin: number;
  private timer: number | null;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly stepLen: number,
    private readonly onStep: (step: number, time: number, stepLen: number) => void,
  ) {
    this.nextTime = ctx.currentTime + 0.1;
    this.origin = this.nextTime;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  tick(): void {
    const now = this.ctx.currentTime;
    if (this.nextTime < now + 0.02) {
      const missed = Math.ceil((now + 0.04 - this.nextTime) / this.stepLen);
      this.nextTime += missed * this.stepLen;
      this.step += missed;
    }
    while (this.nextTime < now + MUSIC_LOOKAHEAD) {
      this.onStep(this.step, this.nextTime, this.stepLen);
      this.nextTime += this.stepLen;
      this.step++;
    }
  }
}
