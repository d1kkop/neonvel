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
