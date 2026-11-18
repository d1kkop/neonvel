import { env, makeReverb, midiToHz, noiseSource, StepClock } from './dsp';
import { ANTHEMS, AnthemPlayer } from './AnthemMusic';

/** Procedural tracks for the playlist: the anthems first, then the classic loop songs. */
const SYNTH_TRACKS = () => [...ANTHEMS, ...SONGS].map((x) => ({ id: x.id, title: x.title, source: 'synth' as const }));

/**
 * Music: a playlist of tracks — recorded files (public/audio/manifest.json) and procedural
 * synthwave songs (SONGS below). Switching tracks crossfades.
 */

// ------------------------------------------------------------------ song definitions

interface Chord {
  root: number; // MIDI bass note
  chord: number[]; // MIDI pad notes
}

export interface SongDef {
  id: string;
  title: string;
  bpm: number;
  progression: Chord[]; // one chord per bar
  /** 16 steps: 0 rest, 1 root, 2 octave, 3 fifth */
  bass: number[];
  /** 16 steps: pad gate on/off */
  gate: number[];
  /** 8-step arpeggio over chord tones (0-2 = chord tones, 3 = root + octave, -1 rest) */
  arp: number[];
  kick: number[];
  snare: number[];
  hat: number[];
  leadWave: OscillatorType;
  padWave: OscillatorType;
  bassWave: OscillatorType;
  leadOctave: number;
  bassCutoff: number;
  padLevel: number;
  leadLevel: number;
  delayFeedback: number;
  /** Bars of intro (no drums) and where the breakdown sits in the 16-bar form. */
  intro: number;
  breakdown: [number, number];
  /** Bar where the lead enters. */
  leadFrom: number;
}

const X = 1, _ = 0;
const ch = (root: number, ...notes: number[]): Chord => ({ root, chord: notes });

export const SONGS: SongDef[] = [
  {
    id: 'neon-drive', title: 'Neon Drive — synthwave (116 BPM)', bpm: 116,
    progression: [ch(45, 57, 60, 64), ch(41, 53, 57, 60), ch(48, 55, 60, 64), ch(43, 55, 59, 62)], // Am F C G
    bass: [1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0],
    gate: [X, _, X, X, _, X, X, _, X, _, X, X, _, X, X, _],
    arp: [0, 1, 2, 1, 0, 1, 2, 3],
    kick: [X, _, _, _, X, _, _, _, X, _, _, _, X, _, _, _],
    snare: [_, _, _, _, X, _, _, _, _, _, _, _, X, _, _, _],
    hat: [_, X, _, X, _, X, _, X, _, X, _, X, _, X, _, X],
    leadWave: 'square', padWave: 'sawtooth', bassWave: 'sawtooth', leadOctave: 12, bassCutoff: 1400,
    padLevel: 0.045, leadLevel: 0.05, delayFeedback: 0.38, intro: 2, breakdown: [12, 14], leadFrom: 4,
  },
  {
    id: 'midnight-cruise', title: 'Midnight Cruise — chillwave (92 BPM)', bpm: 92,
    progression: [ch(38, 50, 53, 57, 60), ch(46, 50, 53, 58, 62), ch(41, 53, 57, 60, 64), ch(48, 52, 55, 60, 62)], // Dm7 Bb F C
    bass: [1, 0, 0, 0, 0, 0, 3, 0, 1, 0, 0, 0, 2, 0, 0, 0],
    gate: [X, _, _, _, X, _, _, _, X, _, _, _, X, _, _, _],
    arp: [0, -1, 2, -1, 1, -1, 3, -1],
    kick: [X, _, _, _, _, _, _, _, X, _, X, _, _, _, _, _],
    snare: [_, _, _, _, _, _, _, _, X, _, _, _, _, _, _, _],
    hat: [_, _, X, _, _, _, X, _, _, _, X, _, _, _, X, X],
    leadWave: 'triangle', padWave: 'sawtooth', bassWave: 'triangle', leadOctave: 12, bassCutoff: 700,
    padLevel: 0.06, leadLevel: 0.07, delayFeedback: 0.5, intro: 2, breakdown: [10, 12], leadFrom: 4,
  },
  {
    id: 'turbo-chase', title: 'Turbo Chase — darksynth (140 BPM)', bpm: 140,
    progression: [ch(40, 52, 55, 59), ch(36, 52, 55, 60), ch(43, 55, 59, 62), ch(38, 54, 57, 62)], // Em C G D
    bass: [1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 3, 3, 2, 3],
    gate: [X, _, _, X, _, _, X, _, X, _, _, X, _, _, X, _],
    arp: [0, 2, 1, 3, 0, 2, 1, 3],
    kick: [X, _, _, _, X, _, _, _, X, _, _, _, X, _, X, _],
    snare: [_, _, _, _, X, _, _, _, _, _, _, _, X, _, _, X],
    hat: [X, X, X, X, X, X, X, X, X, X, X, X, X, X, X, X],
    leadWave: 'sawtooth', padWave: 'square', bassWave: 'sawtooth', leadOctave: 12, bassCutoff: 1800,
    padLevel: 0.03, leadLevel: 0.045, delayFeedback: 0.3, intro: 1, breakdown: [12, 13], leadFrom: 2,
  },
  {
    id: 'sunset-boulevard', title: 'Sunset Boulevard — summer synth-pop (108 BPM)', bpm: 108,
    progression: [ch(48, 60, 64, 67), ch(45, 57, 60, 64), ch(41, 57, 60, 65), ch(43, 59, 62, 67)], // C Am F G
    bass: [1, 0, 2, 0, 0, 1, 2, 0, 1, 0, 2, 0, 0, 1, 3, 0],
    gate: [X, _, X, _, X, _, X, X, X, _, X, _, X, _, X, X],
    arp: [0, 1, 2, 3, 2, 1, 0, 1],
    kick: [X, _, _, _, X, _, _, _, X, _, _, _, X, _, _, _],
    snare: [_, _, _, _, X, _, _, _, _, _, _, _, X, _, _, _],
    hat: [_, X, X, X, _, X, X, X, _, X, X, X, _, X, X, X],
    leadWave: 'square', padWave: 'sawtooth', bassWave: 'square', leadOctave: 24, bassCutoff: 1100,
    padLevel: 0.05, leadLevel: 0.04, delayFeedback: 0.35, intro: 2, breakdown: [12, 14], leadFrom: 4,
  },
  {
    id: 'cyber-pulse', title: 'Cyber Pulse — cyberpunk (128 BPM)', bpm: 128,
    progression: [ch(42, 54, 57, 61), ch(38, 54, 57, 62), ch(45, 52, 57, 61), ch(40, 52, 56, 59)], // F#m D A E
    bass: [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 3, 2, 3, 2],
    gate: [X, _, _, _, _, _, X, _, _, _, X, _, _, _, _, _],
    arp: [0, 3, 1, 3, 2, 3, 1, 3],
    kick: [X, _, _, _, X, _, _, _, X, _, _, _, X, _, _, _],
    snare: [_, _, _, _, X, _, _, X, _, _, _, _, X, _, _, _],
    hat: [_, _, X, _, _, _, X, X, _, _, X, _, _, X, X, _],
    leadWave: 'sawtooth', padWave: 'sawtooth', bassWave: 'square', leadOctave: 12, bassCutoff: 2200,
    padLevel: 0.035, leadLevel: 0.04, delayFeedback: 0.45, intro: 2, breakdown: [8, 10], leadFrom: 4,
  },
  {
    id: 'deep-dive', title: 'Deep Dive — ambient synth (84 BPM)', bpm: 84,
    progression: [ch(36, 55, 59, 64, 67), ch(41, 57, 60, 64, 69), ch(45, 57, 60, 64, 67), ch(43, 55, 59, 62, 66)], // Cmaj9 Fmaj7 Am7 G
    bass: [1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
    gate: [X, _, _, _, _, _, _, _, X, _, _, _, _, _, _, _],
    arp: [0, -1, 1, -1, 2, -1, 3, -1],
    kick: [X, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    snare: [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    hat: [_, _, _, _, _, _, _, _, _, _, X, _, _, _, _, _],
    leadWave: 'sine', padWave: 'triangle', bassWave: 'sine', leadOctave: 24, bassCutoff: 600,
    padLevel: 0.09, leadLevel: 0.07, delayFeedback: 0.6, intro: 1, breakdown: [16, 16], leadFrom: 2,
  },
];

// ------------------------------------------------------------------ playlist

export interface TrackInfo {
  id: string;
  title: string;
  source: 'file' | 'synth';
  file?: string;
  /** Tempo of a recorded track (manifest "bpm", or "bpm115" in the file name). */
  bpm?: number;
}

/** Where the beat is: fractional beat count at a given AudioContext time. */
export interface BeatClock {
  bpm: number;
  beatAt(now: number): number;
}

export class Music {
  private fileTracks: TrackInfo[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private loaded: Promise<void> | null = null;
  private currentId = '';
  private player: ({ stop(): void } & Partial<BeatClock>) | null = null;
  private wanted = '';
  /** Called whenever the playing music changes (title). */
  onChange?: (title: string) => void;

  constructor(private readonly ctx: AudioContext, private readonly out: AudioNode) {}

  /** All tracks: recorded files first, then the procedural songs. */
  get tracks(): TrackInfo[] {
    return [...this.fileTracks, ...SYNTH_TRACKS()];
  }

  get current(): string {
    return this.currentId;
  }

  get title(): string {
    return this.tracks.find((t) => t.id === this.currentId)?.title ?? '—';
  }

  /** Loads the manifest (file list) — titles become available before decoding. */
  load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        try {
          const base = import.meta.env.BASE_URL;
          const res = await fetch(`${base}audio/manifest.json`);
          if (!res.ok) return;
          const manifest = (await res.json()) as { music?: (string | { file: string; title?: string; id?: string; bpm?: number })[] };
          for (const entry of manifest.music ?? []) {
            const file = typeof entry === 'string' ? entry : entry.file;
            const title = typeof entry === 'string' ? file.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ') : entry.title ?? file;
            const id = (typeof entry === 'string' ? undefined : entry.id) ?? file.replace(/\.[a-z0-9]+$/i, '');
            const bpm = (typeof entry === 'string' ? undefined : entry.bpm) ?? Number(/bpm(\d+)/i.exec(file)?.[1] ?? 0);
            this.fileTracks.push({ id, title, source: 'file', file, bpm: bpm || undefined });
          }
        } catch {
          /* no manifest: procedural songs only */
        }
      })();
    }
    return this.loaded;
  }

  /** Play a track by id (crossfades). Unknown ids fall back to the first procedural song. */
  async play(id: string): Promise<void> {
    this.wanted = id;
    await this.load();
    const track = this.tracks.find((t) => t.id === id) ?? this.tracks.find((t) => t.source === 'synth')!;
    if (track.id === this.currentId) return;
    let buffer: AudioBuffer | undefined;
    if (track.source === 'file') {
      buffer = this.buffers.get(track.id);
      if (!buffer) {
        try {
          const r = await fetch(`${import.meta.env.BASE_URL}audio/${track.file}`);
          buffer = await this.ctx.decodeAudioData(await r.arrayBuffer());
          this.buffers.set(track.id, buffer);
        } catch {
          return this.play(SONGS[0].id);
        }
      }
      if (this.wanted !== id) return; // a newer request arrived while decoding
    }
    this.player?.stop();
    this.currentId = track.id;
    const anthem = ANTHEMS.find((s) => s.id === track.id);
    this.player = buffer
      ? new FilePlayer(this.ctx, this.out, buffer, track.bpm)
      : anthem
        ? new AnthemPlayer(this.ctx, this.out, anthem)
        : new SongPlayer(this.ctx, this.out, SONGS.find((s) => s.id === track.id) ?? SONGS[0]);
    this.onChange?.(track.title);
  }

  /** The playing track's beat clock (null when its tempo is unknown). */
  get beat(): BeatClock | null {
    const p = this.player;
    return p && p.bpm && p.beatAt ? (p as BeatClock) : null;
  }

  /** N key: next track in the list. */
  async next(): Promise<void> {
    await this.load();
    const list = this.tracks;
    const i = list.findIndex((t) => t.id === this.currentId);
    await this.play(list[(i + 1) % list.length].id);
  }

  /** Random track different from the current one. */
  async shuffle(): Promise<void> {
    await this.load();
    const list = this.tracks.filter((t) => t.id !== this.currentId);
    await this.play(list[Math.floor(Math.random() * list.length)].id);
  }
}

/** Plays a decoded audio file in a loop with fade in / out. */
class FilePlayer {
  private readonly src: AudioBufferSourceNode;
  private readonly gain: GainNode;
  private readonly t0: number;
  private readonly offset: number;
  private readonly duration: number;
  constructor(private readonly ctx: AudioContext, out: AudioNode, buffer: AudioBuffer, readonly bpm?: number) {
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = true;
    this.gain = ctx.createGain();
    const t = ctx.currentTime;
    this.t0 = t;
    this.duration = buffer.duration;
    this.offset = bpm ? beatOffset(buffer, bpm) : 0;
    this.gain.gain.setValueAtTime(0, t);
    this.gain.gain.linearRampToValueAtTime(0.7, t + 1.5);
    this.src.connect(this.gain).connect(out);
    this.src.start(t);
  }
  stop(): void {
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, 0.4);
    this.src.stop(t + 2);
  }
  beatAt(now: number): number {
    const local = (now - this.t0) % this.duration; // the file loops
    return ((local - this.offset) * (this.bpm ?? 120)) / 60;
  }
}

const offsetCache = new WeakMap<AudioBuffer, number>();
/**
 * Where the first beat falls in a recorded track: fold the low-frequency energy envelope of the first
 * ~40 s onto one beat period and take the strongest phase (the kick drum).
 */
function beatOffset(buffer: AudioBuffer, bpm: number): number {
  const cached = offsetCache.get(buffer);
  if (cached !== undefined) return cached;
  const sr = buffer.sampleRate;
  const d = buffer.getChannelData(0);
  const period = (60 / bpm) * sr;
  const bins = 64;
  const acc = new Float32Array(bins);
  let lp = 0;
  const end = Math.min(d.length, sr * 40);
  for (let i = 0; i < end; i++) {
    lp += (d[i] - lp) * 0.02; // ~150 Hz low-pass: kick drum energy
    const b = Math.floor(((i % period) / period) * bins);
    acc[b] += lp * lp;
  }
  let best = 0;
  for (let b = 1; b < bins; b++) if (acc[b] > acc[best]) best = b;
  const off = (best / bins) * (60 / bpm);
  offsetCache.set(buffer, off);
  return off;
}

/**
 * Procedural synthwave song player (StepClock: notes are queued ~0.9 s ahead on the AudioContext clock):
 * bass, gated pad, lead arpeggio, kick / snare / hats — all driven by a SongDef.
 */
class SongPlayer {
  get bpm(): number { return this.song.bpm; }
  beatAt(now: number): number { return ((now - this.clock.origin) * this.song.bpm) / 60; }
  private readonly bus: GainNode;
  private readonly delaySend: GainNode;
  private readonly reverbSend: GainNode;
  private readonly clock: StepClock;

  constructor(private readonly ctx: AudioContext, out: AudioNode, private readonly song: SongDef) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(out);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = (60 / song.bpm) * 0.75; // dotted eighth
    const fb = ctx.createGain();
    fb.gain.value = song.delayFeedback;
    const dFilter = ctx.createBiquadFilter();
    dFilter.type = 'lowpass';
    dFilter.frequency.value = 3200;
    this.delaySend = ctx.createGain();
    this.delaySend.connect(delay);
    delay.connect(dFilter).connect(fb).connect(delay);
    dFilter.connect(this.bus);
    const reverb = makeReverb(ctx, 3.0, 3);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.6;
    this.reverbSend.connect(reverb).connect(this.bus);
    const t = ctx.currentTime;
    this.bus.gain.setValueAtTime(0, t);
    this.bus.gain.linearRampToValueAtTime(0.85, t + 1.5);
    this.clock = new StepClock(ctx, 60 / song.bpm / 4, (step, time, len) => this.playStep(step, time, len));
  }

  stop(): void {
    this.clock.stop();
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(0, t, 0.4);
    window.setTimeout(() => this.bus.disconnect(), 3000);
  }

  private playStep(step: number, t: number, len: number): void {
    const S = this.song;
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const section = bar % 16;
    const chord = S.progression[bar % S.progression.length];
    const intro = section < S.intro;
    const breakdown = section >= S.breakdown[0] && section < S.breakdown[1];

    if (!intro) {
      if (S.kick[s] && !breakdown) this.kick(t);
      if (S.snare[s]) this.snare(t);
      if (S.hat[s]) this.hat(t, s % 4 === 2 ? 0.06 : 0.035);
    }
    const b = S.bass[s];
    if (b && !breakdown) this.bass(midiToHz(chord.root + (b === 2 ? 12 : b === 3 ? 7 : 0)), t, len * 1.8);
    if (S.gate[s]) this.pad(chord.chord, t, len * (S.bpm < 100 ? 3.6 : 0.9), breakdown ? S.padLevel * 1.5 : S.padLevel);
    if (section >= S.leadFrom && !breakdown) {
      const a = S.arp[s % 8];
      if (a >= 0) {
        const note = a === 3 ? chord.chord[0] + 12 : chord.chord[Math.min(a, chord.chord.length - 1)];
        this.lead(midiToHz(note + S.leadOctave), t, len * (S.bpm < 100 ? 1.6 : 0.8));
      }
    }
  }

  private kick(t: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = c.createGain();
    env(g.gain, t, 0.9, 0.002, 0.32);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.4);
  }

  private snare(t: number): void {
    const c = this.ctx;
    const n = noiseSource(c);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1200;
    const g = c.createGain();
    env(g.gain, t, 0.45, 0.002, 0.22);
    n.connect(f).connect(g);
    g.connect(this.bus);
    g.connect(this.reverbSend);
    g.connect(this.delaySend);
    n.start(t, Math.random());
    n.stop(t + 0.3);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = c.createGain();
    env(og.gain, t, 0.3, 0.002, 0.1);
    o.connect(og).connect(this.bus);
    o.start(t);
    o.stop(t + 0.15);
  }

  private hat(t: number, level: number): void {
    const c = this.ctx;
    const n = noiseSource(c);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = c.createGain();
    env(g.gain, t, level, 0.001, 0.045);
    n.connect(f).connect(g).connect(this.bus);
    n.start(t, Math.random());
    n.stop(t + 0.07);
  }

  private bass(freq: number, t: number, dur: number): void {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(this.song.bassCutoff, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = c.createGain();
    env(g.gain, t, 0.22, 0.004, dur);
    for (const det of [-8, 8]) {
      const o = c.createOscillator();
      o.type = this.song.bassWave;
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    f.connect(g).connect(this.bus);
  }

  private pad(notes: number[], t: number, dur: number, level: number): void {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + Math.min(0.15, dur * 0.2));
    g.gain.setValueAtTime(level, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const n of notes) {
      for (const det of [-10, 10]) {
        const o = c.createOscillator();
        o.type = this.song.padWave;
        o.frequency.value = midiToHz(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.02);
      }
    }
    f.connect(g);
    g.connect(this.bus);
    g.connect(this.reverbSend);
  }

  private lead(freq: number, t: number, dur: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = this.song.leadWave;
    o.frequency.value = freq;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    const g = c.createGain();
    env(g.gain, t, this.song.leadLevel, 0.003, dur);
    o.connect(f).connect(g);
    g.connect(this.bus);
    g.connect(this.delaySend);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

/** Track list for menus (works before audio is unlocked). */
export async function listTracks(): Promise<TrackInfo[]> {
  const files: TrackInfo[] = [];
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}audio/manifest.json`);
    if (res.ok) {
      const manifest = (await res.json()) as { music?: (string | { file: string; title?: string; id?: string })[] };
      for (const e of manifest.music ?? []) {
        const file = typeof e === 'string' ? e : e.file;
        files.push({
          id: (typeof e === 'string' ? undefined : e.id) ?? file.replace(/\.[a-z0-9]+$/i, ''),
          title: (typeof e === 'string' ? undefined : e.title) ?? file,
          source: 'file',
          file,
        });
      }
    }
  } catch {
    /* procedural only */
  }
  return [...files, ...SYNTH_TRACKS()];
}
