import { Music } from './SynthwaveMusic';
import { AudioEnv, Sfx } from './Sfx';
import { Ambience, AmbienceKind } from './Ambience';
import { UiSounds } from './UiSounds';
import type { EngineProfile } from './engineProfiles';

export type { AudioEnv } from './Sfx';

export interface AudioState {
  /** Player speed, 0..1. */
  speed01: number;
  /** Throttle input, 0..1. */
  throttle: number;
  environment: AudioEnv;
  rpm?: number;
  gear?: number;
  slip?: number;
}

export type Bus = 'master' | 'music' | 'sfx' | 'ambience';

/**
 * Owns the AudioContext and the gain buses (master → music / sfx).
 * Browsers only allow audio after a user gesture, so the context is created lazily on the
 * first click / key / touch. Keys: M = mute, N = switch music (track ↔ procedural synthwave).
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  sfx: Sfx | null = null;
  music: Music | null = null;
  ui: UiSounds | null = null;
  ambience: Ambience | null = null;
  private pendingAmbience: AmbienceKind = 'none';
  private engineOn = false;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  /** Taps the music before the volume fader, so hit detection doesn't depend on the music volume. */
  private musicAnalyser: AnalyserNode | null = null;
  private bassBins: Float32Array<ArrayBuffer> | null = null;
  /** Called when the music title changes. */
  onMusicChange?: (title: string) => void;
  private muted = false;
  private volumes: Record<Bus, number> = { master: 0.8, music: 0.8, sfx: 0.45, ambience: 0.12 };
  private pendingMusic = '';
  private pending: AudioState | null = null;

  constructor() {
    const unlock = () => {
      this.init();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(ev, unlock, { passive: true });
    }
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggleMute();
      if (e.code === 'KeyN' && !(e.target instanceof HTMLInputElement)) void this.music?.next();
    });
    // Pause audio when the tab is hidden.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  private init(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    // The browser can stop the context on its own (output device switched, audio service hiccup): start it
    // again as soon as that happens while the page is visible.
    ctx.onstatechange = () => {
      if (ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) void ctx.resume().catch(() => {});
    };

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.ambienceBus = ctx.createGain();
    this.ambienceBus.connect(this.master);
    this.applyVolumes();

    this.sfx = new Sfx(ctx, this.sfxBus);
    this.sfx.engineOn = this.engineOn;
    if (this.pendingEngine) this.sfx.setEngineProfile(this.pendingEngine);
    this.ui = new UiSounds(ctx, this.sfxBus);
    this.ambience = new Ambience(ctx, this.ambienceBus);
    this.ambience.set(this.pendingAmbience);
    const musicTap = ctx.createGain();
    musicTap.connect(this.musicBus);
    this.musicAnalyser = ctx.createAnalyser();
    this.musicAnalyser.fftSize = 1024;
    this.musicAnalyser.smoothingTimeConstant = 0;
    musicTap.connect(this.musicAnalyser);
    this.bassBins = new Float32Array(this.musicAnalyser.frequencyBinCount);
    this.music = new Music(ctx, musicTap);
    this.music.onChange = (title) => this.onMusicChange?.(title);
    void this.music.play(this.pendingMusic || 'space-city');
    if (this.pending) this.sfx.update(this.pending);
  }

  /** Low-end (kick drum, ~40–150 Hz) energy of the music right now, linear; 0 before audio starts. */
  bassEnergy(): number {
    const a = this.musicAnalyser, bins = this.bassBins;
    if (!a || !bins || !this.ctx) return 0;
    a.getFloatFrequencyData(bins);
    const hz = this.ctx.sampleRate / a.fftSize;
    const i0 = Math.max(1, Math.floor(40 / hz)), i1 = Math.max(i0 + 1, Math.ceil(150 / hz));
    let e = 0;
    for (let i = i0; i < i1; i++) e += Math.pow(10, bins[i] / 10); // dB → power
    return e / (i1 - i0);
  }

  /** Call every frame. Safe to call before audio is unlocked. */
  update(state: AudioState): void {
    this.pending = state;
    this.sfx?.update(state);
  }

  private pendingEngine: EngineProfile | null = null;

  /** Engine sound for the player's car (safe before unlock). */
  setEngineProfile(p: EngineProfile): void {
    this.pendingEngine = p;
    this.sfx?.setEngineProfile(p);
  }

  /** Rev the engine once (garage). */
  previewEngine(p: EngineProfile): void {
    this.pendingEngine = p;
    this.sfx?.previewEngine(p);
  }

  /** Play a music track by id (safe before unlock: starts once audio is allowed). */
  playMusic(id: string): void {
    this.pendingMusic = id;
    void this.music?.play(id);
  }

  /** Level ambience bed (safe before unlock). */
  setAmbience(kind: AmbienceKind): void {
    this.pendingAmbience = kind;
    this.ambience?.set(kind);
  }

  /** Engine/wind sounds on (racing) or off (menus). */
  setEngine(on: boolean): void {
    this.engineOn = on;
    if (this.sfx) this.sfx.engineOn = on;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.applyVolumes();
  }

  setVolume(bus: Bus, v: number): void {
    this.volumes[bus] = Math.max(0, Math.min(1, v));
    this.applyVolumes();
  }

  getVolume(bus: Bus): number {
    return this.volumes[bus];
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.musicBus || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.ambienceBus?.gain.setTargetAtTime(this.volumes.ambience, t, 0.05);
  }
}
