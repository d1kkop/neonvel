import { env, makeReverb, midiToHz, noiseSource } from './dsp';

/**
 * "Anthem" songs: big, driving synthwave with a written melody and a real song form
 * (intro → verse → build → chorus → breakdown → build → final chorus, then back to the verse).
 * Sound: stacked detuned saw lead, side-chain-style pumping pads and bass, plucky 16th arpeggio,
 * gated-reverb snare, risers + snare rolls into each chorus, crash on the downbeat.
 */

type Chord = { root: number; notes: number[] };

/** Melody notation: one token per 16th — note name ("C#5"), "-" = hold, "." = rest. */
type Melody = string;

export interface AnthemDef {
  id: string;
  title: string;
  bpm: number;
  verse: Chord[]; // one chord per bar, repeated
  chorus: Chord[]; // one chord per bar (8 bars)
  melody: Melody[]; // chorus melody, one string (16 tokens) per bar, 8 bars
  /** 16-step bass pattern in the chorus: 1 root, 2 octave, 3 fifth, 0 rest. */
  bassChorus: number[];
  leadCutoff: number;
  swing?: number;
}

const ch = (root: number, ...notes: number[]): Chord => ({ root, notes });

const NOTE: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** Parse a melody bar into [step, midi, lengthInSteps] events. */
function parseBar(bar: Melody): [number, number, number][] {
  const tokens = bar.trim().split(/\s+/);
  const out: [number, number, number][] = [];
  tokens.forEach((tok, i) => {
    const m = /^([A-G][#b]?)(\d)$/.exec(tok);
    if (!m) return;
    let len = 1;
    while (tokens[i + len] === '-') len++;
    out.push([i, 12 * (Number(m[2]) + 1) + NOTE[m[1]], len]);
  });
  return out;
}

// Starlight Highway — E major, anthemic (vi–IV–I–V verse, IV–I–V–vi chorus).
const Cs = ch(37, 56, 61, 64, 68), A = ch(33, 57, 61, 64, 69), E = ch(40, 56, 59, 64, 68), B = ch(35, 54, 59, 63, 66);
// Orbit Rush — D minor, darker and faster; the chorus resolves through A major.
const Dm = ch(38, 57, 62, 65, 69), Bb = ch(34, 58, 62, 65, 70), F = ch(41, 57, 60, 65, 69), C = ch(36, 55, 60, 64, 67), AM = ch(33, 57, 61, 64, 69);

export const ANTHEMS: AnthemDef[] = [
  {
    id: 'starlight-highway',
    title: 'Starlight Highway — anthem synthwave (116 BPM)',
    bpm: 116,
    verse: [Cs, A, E, B],
    chorus: [A, E, B, Cs, A, E, B, Cs],
    melody: [
      'C#5 - - - B4 - C#5 - E5 - - - - - - -',
      'B4 - - - G#4 - - - E4 - - - G#4 - B4 -',
      'D#5 - - - C#5 - B4 - F#5 - - - D#5 - - -',
      'E5 - - - - - - - C#5 - - - G#4 - B4 -',
      'C#5 - - - B4 - C#5 - E5 - - - F#5 - E5 -',
      'G#5 - - - - - E5 - B4 - - - - - - -',
      'F#5 - - - D#5 - - - B4 - C#5 - D#5 - - -',
      'E5 - - - - - - - - - - - . . . .',
    ],
    bassChorus: [1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 3],
    leadCutoff: 4200,
  },
  {
    id: 'orbit-rush',
    title: 'Orbit Rush — epic darksynth (124 BPM)',
    bpm: 124,
    verse: [Dm, Bb, F, C],
    chorus: [Bb, C, Dm, Dm, Bb, C, F, AM],
    melody: [
      'D5 - - - F5 - - - D5 - C5 - A#4 - - -',
      'C5 - - - E5 - - - G5 - - - E5 - - -',
      'F5 - - - - - E5 - D5 - - - A4 - - -',
      'D5 - - - - - - - . . A4 - D5 - E5 -',
      'F5 - - - - - D5 - A5 - - - G5 - F5 -',
      'G5 - - - - - E5 - C5 - - - E5 - G5 -',
      'A5 - - - - - - - F5 - - - C5 - - -',
      'C#5 - - - E5 - - - A5 - - - - - - -',
    ],
    bassChorus: [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 3, 2, 3, 2],
    leadCutoff: 3600,
  },
];

type Section = 'intro' | 'verse' | 'build' | 'chorus' | 'breakdown' | 'build2' | 'chorus2';
/** [section, bars]. After the last section the song loops back to the verse. */
const FORM: [Section, number][] = [['intro', 4], ['verse', 8], ['build', 4], ['chorus', 8], ['breakdown', 8], ['build2', 4], ['chorus2', 8]];
const FORM_BARS = FORM.reduce((a, [, n]) => a + n, 0);
const LOOP_FROM = 4; // bar index of the verse

function sectionAt(bar: number): { name: Section; local: number; length: number } {
  let b = bar < FORM_BARS ? bar : LOOP_FROM + ((bar - LOOP_FROM) % (FORM_BARS - LOOP_FROM));
  for (const [name, n] of FORM) {
    if (b < n) return { name, local: b, length: n };
    b -= n;
  }
  return { name: 'verse', local: 0, length: 8 };
}

export class AnthemPlayer {
  private readonly bus: GainNode;
  private readonly pump: GainNode; // ducked on every kick (pads, bass, arp)
  private readonly delaySend: GainNode;
  private readonly reverbSend: GainNode;
  private readonly gateSend: GainNode;
  private readonly gate: GainNode;
  private readonly melody: [number, number, number][][];
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private origin = 0;
  get bpm(): number { return this.song.bpm; }
  beatAt(now: number): number { return ((now - this.origin) * this.song.bpm) / 60; }

  constructor(private readonly ctx: AudioContext, out: AudioNode, private readonly song: AnthemDef) {
    const c = ctx;
    this.melody = song.melody.map(parseBar);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    comp.attack.value = 0.008;
    comp.release.value = 0.2;
    // Brick-wall-ish limiter after the glue compressor so peaks never clip.
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    const makeup = c.createGain();
    makeup.gain.value = 0.92;
    this.bus = c.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(comp).connect(makeup).connect(limiter).connect(out);
    this.pump = c.createGain();
    this.pump.connect(this.bus);
    // Dotted-eighth delay.
    const delay = c.createDelay(2);
    delay.delayTime.value = (60 / song.bpm) * 0.75;
    const fb = c.createGain();
    fb.gain.value = 0.36;
    const dFilter = c.createBiquadFilter();
    dFilter.type = 'lowpass';
    dFilter.frequency.value = 3000;
    this.delaySend = c.createGain();
    this.delaySend.gain.value = 0.5;
    this.delaySend.connect(delay);
    delay.connect(dFilter).connect(fb).connect(delay);
    dFilter.connect(this.bus);
    // Big hall reverb.
    const hall = makeReverb(c, 3.4, 2.6);
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(hall).connect(this.bus);
    // Gated reverb for the snare (opened per hit, slammed shut).
    const room = makeReverb(c, 1.6, 1.5);
    this.gateSend = c.createGain();
    this.gate = c.createGain();
    this.gate.gain.value = 0;
    this.gateSend.connect(room).connect(this.gate).connect(this.bus);

    const t = c.currentTime;
    this.bus.gain.setValueAtTime(0, t);
    this.bus.gain.linearRampToValueAtTime(0.9, t + 1.5);
    this.nextTime = t + 0.1;
    this.origin = this.nextTime;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(0, t, 0.4);
    window.setTimeout(() => this.bus.disconnect(), 3000);
  }

  private schedule(): void {
    const sixteenth = 60 / this.song.bpm / 4;
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  private playStep(step: number, t: number, len: number): void {
    const S = this.song;
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const sec = sectionAt(bar);
    const chorusLike = sec.name === 'chorus' || sec.name === 'chorus2' || sec.name === 'breakdown';
    const chord = chorusLike ? S.chorus[sec.local % S.chorus.length] : S.verse[sec.local % S.verse.length];
    const beat = len * 4;
    const isBuild = sec.name === 'build' || sec.name === 'build2';
    const full = sec.name === 'chorus' || sec.name === 'chorus2';
    const drums = sec.name !== 'intro' && sec.name !== 'breakdown';
    const lastBeatOfBuild = isBuild && sec.local === sec.length - 1 && s >= 12;

    // --- drums
    if (drums && !lastBeatOfBuild) {
      if (s % 4 === 0) {
        this.kick(t, full ? 1 : 0.85);
        this.duck(t, beat);
      }
      if (!isBuild && (s === 4 || s === 12)) this.snare(t, full ? 1 : 0.8);
      if (full) {
        if (s % 4 === 2) this.hat(t, 0.07, 0.12); // open hat on the off-beat
        else this.hat(t, 0.022, 0.035);
      } else if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.05 : 0.025, 0.04);
    }
    if (isBuild) {
      // Snare roll that gets denser and louder, with a riser over the whole build.
      const prog = (sec.local * 16 + s) / (sec.length * 16);
      const every = sec.local < sec.length - 2 ? 4 : sec.local < sec.length - 1 ? 2 : 1;
      if (s % every === 0) this.snare(t, 0.25 + 0.65 * prog, true);
      if (sec.local === 0 && s === 0) this.riser(t, beat * 4 * sec.length);
    }
    if (full && sec.local === 0 && s === 0) this.crash(t);
    if (sec.name === 'breakdown' && sec.local === 0 && s === 0) this.crash(t, 0.6);

    // --- bass
    if (sec.name !== 'intro' && !(sec.name === 'breakdown' && sec.local < 4)) {
      const pat = full ? S.bassChorus : [1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0];
      const b = pat[s];
      if (b && !lastBeatOfBuild) this.bass(midiToHz(chord.root + (b === 2 ? 12 : b === 3 ? 7 : 0)), t, len * (full ? 0.9 : 1.6));
    }

    // --- pad: one long chord per bar (two voicings: low in verse, wide in chorus)
    if (s === 0) this.pad(full ? [...chord.notes, chord.notes[0] + 12] : chord.notes, t, beat * 4, sec.name === 'breakdown' ? 0.05 : full ? 0.032 : 0.036);

    // --- arpeggio: 16ths up and down two octaves of chord tones; filter opens through the intro
    if (sec.name !== 'breakdown' || sec.local >= 4) {
      const tones = [...chord.notes, ...chord.notes.map((n) => n + 12)];
      const order = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 2, 3];
      const open = sec.name === 'intro' ? 0.25 + 0.75 * ((sec.local * 16 + s) / 64) : isBuild ? 0.6 + 0.4 * ((sec.local * 16 + s) / (sec.length * 16)) : 1;
      this.pluck(midiToHz(tones[order[s] % tones.length] + 12), t, len * 0.9, full ? 0.022 : 0.03, open);
    }

    // --- melody: supersaw lead in the choruses (doubled an octave up in the final one), bell in the breakdown
    const bars = this.melody;
    const mBar = bars[sec.local % bars.length];
    for (const [st, midi, l] of mBar) {
      if (st !== s) continue;
      if (full) {
        this.lead(midiToHz(midi), t, len * l, 0.034);
        if (sec.name === 'chorus2') this.lead(midiToHz(midi + 12), t, len * l, 0.016);
      } else if (sec.name === 'breakdown') this.bell(midiToHz(midi + 12), t, len * l);
    }
  }

  /** Side-chain feel: duck the pump bus on every kick. */
  private duck(t: number, beat: number): void {
    const g = this.pump.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.3, t + 0.005);
    g.linearRampToValueAtTime(1, t + beat * 0.7);
  }

  private kick(t: number, level: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = c.createGain();
    env(g.gain, t, 0.8 * level, 0.002, 0.34);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.42);
    const n = noiseSource(c);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = c.createGain();
    env(ng.gain, t, 0.12 * level, 0.001, 0.012);
    n.connect(hp).connect(ng).connect(this.bus);
    n.start(t, Math.random());
    n.stop(t + 0.03);
  }

  private snare(t: number, level: number, roll = false): void {
    const c = this.ctx;
    const n = noiseSource(c);
    const bp = c.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 900;
    const g = c.createGain();
    env(g.gain, t, 0.42 * level, 0.002, roll ? 0.09 : 0.2);
    n.connect(bp).connect(g);
    g.connect(this.bus);
    g.connect(this.reverbSend);
    n.start(t, Math.random());
    n.stop(t + 0.3);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.07);
    const og = c.createGain();
    env(og.gain, t, 0.32 * level, 0.002, 0.1);
    o.connect(og).connect(this.bus);
    o.start(t);
    o.stop(t + 0.15);
    if (!roll) {
      // Gated reverb: big room burst, cut off hard.
      g.connect(this.gateSend);
      og.connect(this.gateSend);
      const gg = this.gate.gain;
      gg.cancelScheduledValues(t);
      gg.setValueAtTime(1.4, t);
      gg.setValueAtTime(1.4, t + 0.2);
      gg.linearRampToValueAtTime(0, t + 0.24);
    }
  }

  private hat(t: number, level: number, decay: number): void {
    const c = this.ctx;
    const n = noiseSource(c);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7800;
    const g = c.createGain();
    env(g.gain, t, level, 0.001, decay);
    n.connect(f).connect(g).connect(this.bus);
    n.start(t, Math.random());
    n.stop(t + decay + 0.05);
  }

  private crash(t: number, level = 1): void {
    const c = this.ctx;
    const n = noiseSource(c, true);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 5200;
    const g = c.createGain();
    env(g.gain, t, 0.13 * level, 0.002, 1.9);
    n.connect(f).connect(g);
    g.connect(this.bus);
    g.connect(this.reverbSend);
    n.start(t);
    n.stop(t + 2.1);
  }

  private riser(t: number, dur: number): void {
    const c = this.ctx;
    const n = noiseSource(c, true);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + dur * 0.97);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(f).connect(g);
    g.connect(this.bus);
    g.connect(this.reverbSend);
    n.start(t);
    n.stop(t + dur + 0.05);
  }

  private bass(freq: number, t: number, dur: number): void {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 5;
    f.frequency.setValueAtTime(1600, t);
    f.frequency.exponentialRampToValueAtTime(240, t + dur);
    const g = c.createGain();
    env(g.gain, t, 0.2, 0.004, dur);
    for (const [type, det, mul] of [['sawtooth', -7, 1], ['sawtooth', 7, 1], ['square', 0, 0.5]] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq * mul;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    f.connect(g).connect(this.pump);
  }

  private pad(notes: number[], t: number, dur: number, level: number): void {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(2200, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(1400, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.25);
    g.gain.setValueAtTime(level, t + dur * 0.85);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.15);
    for (const n of notes) {
      for (const det of [-14, 0, 14]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToHz(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.2);
      }
    }
    f.connect(g);
    g.connect(this.pump);
    g.connect(this.reverbSend);
  }

  private pluck(freq: number, t: number, dur: number, level: number, open: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(400 + 3600 * open, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.14);
    const g = c.createGain();
    env(g.gain, t, level, 0.002, Math.max(0.08, dur));
    o.connect(f).connect(g);
    g.connect(this.pump);
    g.connect(this.delaySend);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  /** Supersaw lead: five detuned saws + a sub square, gentle filter envelope, vibrato on long notes. */
  private lead(freq: number, t: number, dur: number, level: number): void {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(this.song.leadCutoff * 0.6, t);
    f.frequency.linearRampToValueAtTime(this.song.leadCutoff, t + 0.06);
    const g = c.createGain();
    const end = t + dur;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.012);
    g.gain.setValueAtTime(level, Math.max(t + 0.013, end - 0.03));
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.22);
    const vib = c.createOscillator();
    vib.frequency.value = 5.5;
    const vibAmt = c.createGain();
    vibAmt.gain.setValueAtTime(0, t);
    if (dur > 0.4) vibAmt.gain.linearRampToValueAtTime(14, t + Math.min(dur, 0.9));
    vib.connect(vibAmt);
    vib.start(t);
    vib.stop(end + 0.3);
    const voices: [OscillatorType, number, number][] = [['sawtooth', -18, 1], ['sawtooth', -8, 1], ['sawtooth', 0, 1], ['sawtooth', 8, 1], ['sawtooth', 18, 1], ['square', 0, 0.5]];
    for (const [type, det, mul] of voices) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq * mul;
      o.detune.value = det;
      vibAmt.connect(o.detune);
      o.connect(f);
      o.start(t);
      o.stop(end + 0.3);
    }
    f.connect(g);
    g.connect(this.bus);
    g.connect(this.delaySend);
    g.connect(this.reverbSend);
  }

  /** Soft FM-ish bell for the breakdown melody. */
  private bell(freq: number, t: number, dur: number): void {
    const c = this.ctx;
    const car = c.createOscillator();
    car.type = 'sine';
    car.frequency.value = freq;
    const mod = c.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 3.5;
    const modG = c.createGain();
    env(modG.gain, t, freq * 1.2, 0.002, 0.6);
    mod.connect(modG).connect(car.frequency);
    const g = c.createGain();
    env(g.gain, t, 0.05, 0.003, Math.max(0.6, dur * 1.5));
    car.connect(g);
    g.connect(this.bus);
    g.connect(this.delaySend);
    g.connect(this.reverbSend);
    const stopAt = t + Math.max(0.7, dur * 1.5) + 0.1;
    car.start(t);
    mod.start(t);
    car.stop(stopAt);
    mod.stop(stopAt);
  }
}
