import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AMBIENCE_LABELS, AmbienceKind } from '../audio/Ambience';
import { AudioEngine } from '../audio/AudioEngine';
import { GameLoop } from '../core/GameLoop';
import { ChaseCamera } from '../game/ChaseCamera';
import { World } from '../game/World';
import { AI_DIFFICULTY } from '../game/CarPhysics';
import { defaultLaps } from '../game/laps';
import { preloadCarModels } from '../game/car/carModels';
import { type GameMode, HighwayMode } from '../game/modes';
import { levelById } from '../levels';
import type { LevelDef } from '../levels/types';
import { NetClient, NetPlayer, ServerMsg } from '../net/NetClient';
import { Store } from '../net/Store';
import { serverUrl } from '../net/serverUrl';
import { ENGINES } from '../audio/engineProfiles';
import { LEVEL_NAMES, UNLOCK_ALL, levelItem, levelPrice } from '../game/products';
import { carById, formatPrice, specFor } from '../game/car/catalog';
import type { CarSetup } from '../game/World';
import { isMobile, Mirror, Renderer } from '../render/Renderer';
import { detectGpu } from '../render/gpuTier';
import { makeFrame } from '../track/Track';
import type { WeatherName } from '../world/weather/Weather';
import { formatTime, Hud } from './Hud';
import { Input } from './Input';
import { Menu, ResultRow } from './Menu';
import type { MinimapCar } from './Minimap';
import { loadSettings, saveSettings, Settings } from './settings';

/** Level behind the main menu (its music, Space City, is the theme tune). */
const MENU_LEVEL = 'neon-skyway';

type State = 'menu' | 'loading' | 'netwait' | 'countdown' | 'racing' | 'finished';

/** The online race in progress (null = offline). */
interface OnlineRace {
  matchId: string;
  you: string;
  players: NetPlayer[];
  laps: number;
  finishedSent: boolean;
}


/** Top-level game: menus ↔ races, owns renderer, audio, input and the current World. */
export class App {
  private readonly settings: Settings = loadSettings();
  private readonly camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 7000);
  private readonly renderer: Renderer;
  private readonly audio = new AudioEngine();
  private readonly input = new Input();
  private readonly menu: Menu;
  private readonly hud: Hud;
  private readonly chase: ChaseCamera;
  private readonly orbit: OrbitControls;
  private readonly net: NetClient;
  private world: World | null = null;
  private state: State = 'menu';
  private paused = false;
  private freeCam = false;
  private raceTime = 0;
  private countdown = 0;
  private lastCount = -1;
  private laps = 3;
  private lastLap = 1;
  private lapStart = 0;
  private bestLap = Infinity;
  private readonly carColors = new WeakMap<object, string>();
  private shotTimer = 0;
  private shot = 0;
  private wallCooldown = 0;
  private readonly frame = makeFrame();
  private readonly mirror = new Mirror();
  private readonly mirrorFrame: HTMLDivElement;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpF = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container, new THREE.Scene(), this.camera);
    this.applyQuality();
    this.chase = new ChaseCamera(this.camera);
    this.orbit = new OrbitControls(this.camera, this.renderer.webgl.domElement);
    this.orbit.enabled = false;
    this.net = new NetClient(serverUrl());
    this.net.onMessage = (m) => this.onNet(m);

    this.menu = new Menu(this.settings, {
      startRace: () => this.startRace(),
      findMatch: () => void this.findMatch(),
      cancelMatch: () => this.cancelMatch(),
      refreshLeaderboard: () => void this.refreshLeaderboard(),
      lapBoard: (level) => this.store.lapBoard(level, this.settings.authToken),
      signIn: (provider, devName) => this.store.signIn(provider, devName),
      signOut: () => void this.signOut(),
      rename: (name) => this.rename(name),
      providers: () => this.store.providers(),
      resume: () => this.resume(),
      restart: () => (this.online || this.lastWasOnline ? void this.findMatch(true) : this.startRace()),
      quitToMenu: () => this.toMenu(),
      mainShown: () => {
        // The main menu always shows the first level (and its theme tune), whatever was previewed.
        if (this.state === 'menu') {
          this.previewLevel(levelById(MENU_LEVEL), true);
          // Back on the title: the theme again (also when the background didn't need a rebuild).
          if (!this.onTitle) { this.onTitle = true; this.applyMusic(); }
        }
      },
      settingsChanged: () => this.applySettings(),
      previewLevel: (l) => this.previewLevel(l),
      sound: (k) => this.audio.ui?.[k](),
      garageOpen: () => void this.refreshOwned(),
      garageBuy: (id) => void this.buyCar(id),
      buyItem: (item) => void this.buyCar(item),
      garageHear: (id) => this.audio.previewEngine(ENGINES[carById(id).engine] ?? ENGINES.flat12),
      musicInfo: () => ({
        current: this.audio.music?.current ?? '',
        levelDefault: this.world?.level.music ?? 'space-city',
        levelName: this.world?.level.name ?? '',
      }),
      ambienceInfo: () => ({
        current: this.currentAmbience,
        levelDefault: (this.world?.level.ambience ?? 'city') as AmbienceKind,
        levelName: this.world?.level.name ?? '',
      }),
    });
    this.hud = new Hud(this.menu.root);
    this.hud.setTouchMode(this.settings.touchControls ?? 'buttons', this.settings.autoGas !== false);
    // Phones: the first tap goes full screen and locks landscape (Android / Chrome; on iPhone that needs
    // "Add to Home Screen", which opens the game full screen from the manifest).
    if (isMobile) {
      const goFull = () => {
        const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
        if (!document.fullscreenElement) {
          const p = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.();
          void Promise.resolve(p).then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape')).catch(() => undefined);
        }
      };
      window.addEventListener('pointerup', goFull, { once: true });
    }
    this.camera.layers.enable(1);
    this.camera.layers.enable(2);
    this.mirror.camera.layers.enable(1);
    this.mirrorFrame = document.createElement('div');
    this.mirrorFrame.className = 'mirror-frame';
    this.hud.el.appendChild(this.mirrorFrame);
    this.layoutMirror();
    this.hud.onPause = () => this.pause();
    this.audio.onMusicChange = (title) => {
      this.musicTitle = title;
      this.menu.toast(`♪ Music: ${title}`);
      this.updateNowPlaying();
      this.menu.refreshMusic();
    };
    this.applySettings();

    window.addEventListener('keydown', (e) => {
      if ((e.code === 'Escape' || e.code === 'KeyP') && (this.state === 'racing' || this.state === 'countdown')) {
        if (!this.paused) this.pause();
      }
      if (e.code === 'KeyC' && this.state !== 'menu') this.freeCam = !this.freeCam;
    });
    window.addEventListener('resize', () => this.onResize());
    // First user gesture unlocks audio (browser rule) and reveals the menu buttons.
    const unlock = () => {
      this.menu.unlockStart();
      this.audio.ui?.select();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    // GPU context lost → restored: rebuild the level, keep the race state.
    this.renderer.webgl.domElement.addEventListener('webglcontextrestored', () => this.recoverContext());
    // Gamepad START = pause.
    window.setInterval(() => {
      const p = navigator.getGamepads?.()[0];
      if (p?.buttons[9]?.pressed && (this.state === 'racing' || this.state === 'countdown') && !this.paused) this.pause();
    }, 100);

    this.menu.show('main');
    // Title background: built once, with the hand-modelled cars (waits up to 3 s for those small .glb files).
    // Building it first and again when the models arrived gave a big hitch a few seconds in (worst on phones).
    void Promise.race([preloadCarModels(this.settings.quality !== 'low'), new Promise((r) => window.setTimeout(r, 3000))]).then(() => {
      this.bootDone = true;
      if (this.state === 'menu' && !this.world) this.loadMenuWorld(levelById(MENU_LEVEL), true);
    });
    // Returning from a Google / Discord sign-in?
    void this.takeSignIn();
    // Returning from Stripe Checkout?
    void this.store.confirmFromUrl().then((r) => {
      if (!r) return;
      if (r.cancelled) this.menu.toast('Purchase cancelled — no money was charged.');
      else if (r.error) this.menu.toast(r.error);
      else if (r.item) {
        if (r.owned) this.settings.ownedCars = r.owned;
        if (!r.item.startsWith('level:')) this.settings.carId = r.item;
        saveSettings(this.settings);
        this.menu.toast(`${r.item.startsWith('level:') ? LEVEL_NAMES[r.item.slice(6)] : carById(r.item).name} unlocked — thank you!`);
      }
    });
    new GameLoop((dt) => this.update(dt), (a, dt) => this.render(a, dt)).start();
    (window as unknown as { __app: App }).__app = this;
  }

  // ------------------------------------------------------------- worlds

  private buildWorld(level: LevelDef, weather: WeatherName, opponents: number, online?: { id: string; name: string; setup: CarSetup; local: boolean }[]): World {
    this.world?.dispose();
    this.world = null;
    const w = new World(level, weather, this.renderer, this.settings.quality, this.playerCarSetup(), opponents, online);
    // Minimap outline: the track centre line every ~8 m.
    {
      const n = Math.max(64, Math.round(w.track.length / 8));
      const pts = new Float32Array(n * 2);
      const f = makeFrame();
      for (let i = 0; i < n; i++) {
        w.track.frameAt((i / n) * w.track.length, f);
        pts[i * 2] = f.position.x;
        pts[i * 2 + 1] = f.position.z;
      }
      this.hud.minimap.setTrack(pts, w.track.width);
    }
    w.weather.onLightning = (delay) => this.audio.sfx?.thunder(delay, Math.max(0.4, 1 - delay / 3));
    w.onLevelSound = (kind) => {
      if (kind === 'dolphin') this.audio.ambience?.dolphin();
      else if (kind === 'meteor') { this.audio.sfx?.impact(1); this.audio.sfx?.thunder(0.05, 0.9); }
      else if (kind === 'ufo') this.audio.sfx?.whoosh(0, 0.9, 1.1);
      else if (kind === 'hiss') this.audio.sfx?.hiss();
    };
    // Only while you drive: the menu's attract camera and the free camera stay steady.
    w.onShake = (amount) => { if (this.state === 'racing' && !this.freeCam) this.chase.shake(amount); };
    w.onHit = (label) => {
      if (this.state !== 'racing') return;
      this.hud.beatPop(label, false);
      this.audio.sfx?.impact(0.45);
      if (!this.freeCam) this.chase.shake(0.4);
    };
    this.renderer.setScene(w.scene, this.camera);
    this.world = w;
    w.road.beatSides = this.settings.beatSides ?? 1;
    // The chase camera sits further back / higher for long vehicles (the 3 m tall bus: well above the roof).
    const len = w.player.car.style.length;
    const k = Math.max(1, len / 4.6);
    this.vehScale = k;
    this.chase.distance = 7.5 * Math.pow(k, 0.95);
    this.chase.height = 2.4 * Math.pow(k, 1.1);
    this.chase.lookAhead = 10 * Math.pow(k, 0.6);
    this.chase.lookHeight = 0.8 * Math.pow(k, 0.9);
    const pm = carById(this.isOwned(this.settings.carId) ? this.settings.carId : 'vortex');
    this.audio.setEngineProfile(ENGINES[pm.engine] ?? ENGINES.flat12);
    this.applyAmbience();
    this.applyMusic(true);
    return w;
  }

  /** Weather a race on this level uses: the player's pick, else the level's first-race weather, else its default. */
  private raceWeather(level: LevelDef): WeatherName {
    const w = this.settings.weather[level.id] ?? level.firstWeather ?? level.defaultWeather;
    return w === 'fog' ? 'clear' : w; // fog is a separate toggle now
  }

  /** Ground fog for races on this level: the player's toggle, else on when the level's default weather was fog. */
  private raceFog(level: LevelDef): boolean {
    void level;
    return false; // fog was removed
  }

  /** Background world. The title screen always shows the level's calm default weather (no spoilers). */
  /** Minimap: player-centred, cars coloured by their paint, gaps along the track. */
  private drawMinimap(w: World): void {
    const p = w.player;
    const g = p.car.group;
    const e = g.matrixWorld.elements;
    let fx = -e[8], fz = -e[10];
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    const cars: MinimapCar[] = w.cars.filter((c) => !c.left).map((c) => {
      const gap = c.phys.s - p.phys.s;
      return { x: c.car.group.position.x, z: c.car.group.position.z, color: this.carColor(c.car.group), player: c.isPlayer, gap };
    });
    for (const n of w.npcs) {
      cars.push({ x: n.car.group.position.x, z: n.car.group.position.z, color: '#8a8a96', player: false, gap: n.phys.s - p.phys.s, minor: true });
    }
    this.hud.minimap.draw(g.position.x, g.position.z, fx, fz, cars);
  }

  private carColor(group: THREE.Object3D): string {
    let col = this.carColors.get(group);
    if (!col) {
      col = '#ff2bd6';
      group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
        if (m && (m as THREE.Material).vertexColors && m.color && (m as THREE.Material).name !== 'wheel') col = '#' + m.color.getHexString();
      });
      this.carColors.set(group, col);
    }
    return col;
  }

  private loadMenuWorld(level: LevelDef, title = false): void {
    this.onTitle = title;
    this.mode = null;
    const weather = title ? level.defaultWeather : this.raceWeather(level);
    this.menuWeather = `${weather}|${!title && this.raceFog(level)}`;
    const w = this.buildWorld(level, weather, 3);
    if (!title) w.weather.setFog(this.raceFog(level), true);
    // Attract mode: the AI drives every car (including yours); give them a rolling start.
    for (const c of w.cars) {
      c.phys.v = 40;
      c.phys.s += 200;
      c.phys.ps = c.phys.s;
    }
    this.state = 'menu';
    this.audio.setEngine(false);
    this.hud.show(false);
    this.updateNowPlaying();
    // Compile the shaders in the background before the first frame of this world (like startRace): a normal
    // first frame compiles them one by one on the main thread and froze the title screen for seconds on a
    // first visit (worst on phones). Until then the canvas keeps its last picture; the menus stay usable.
    w.placeCars(0);
    this.compiling = true;
    void this.renderer.precompile(w.scene, this.camera).catch(() => undefined).finally(() => {
      if (this.world === w) this.compiling = false;
    });
  }

  private previewTimer = 0;

  /** Debounced background-level preview (rebuilding a level is heavy; avoid doing it twice quickly). */
  private menuWeather: string | null = null;

  /** False until the first title background is built (menus asking for a background wait for it). */
  private bootDone = false;

  private previewLevel(level: LevelDef, title = false): void {
    window.clearTimeout(this.previewTimer);
    if (!this.bootDone) return;
    // A locked level is never loaded (not even as the menu background) until it is bought.
    if (!title && !this.isLevelOwned(level.id)) return;
    const weather = title ? level.defaultWeather : this.raceWeather(level);
    if (this.world?.level.id === level.id && this.menuWeather === `${weather}|${!title && this.raceFog(level)}`) return;
    this.previewTimer = window.setTimeout(() => {
      if (this.state === 'menu') this.loadMenuWorld(level, title);
    }, 450);
  }

  private startRace(): void {
    this.onTitle = false;
    this.mode = null;
    window.clearTimeout(this.previewTimer);
    if (!this.isLevelOwned(this.settings.levelId)) {
      this.menu.toast('This level is locked — unlock it on the Quick Race screen.');
      return;
    }
    const level = levelById(this.settings.levelId);
    const weather = this.raceWeather(level);
    this.menu.showLoading();
    this.state = 'loading';
    this.paused = false;
    // Let the loading screen paint before the (synchronous) level build.
    window.setTimeout(async () => {
      await preloadCarModels(this.settings.quality !== 'low'); // usually done long before (loaded at startup)
      const modeId = this.settings.mode ?? 'race';
      const w = this.buildWorld(level, weather, modeId === 'race' ? this.settings.opponents : 0);
      w.weather.setFog(this.raceFog(level), true);
      w.setDifficulty(this.settings.difficulty);
      // Compile all shaders up front (parallel where supported) so the race starts without hitches.
      w.placeCars(0);
      this.chase.update(w.player.car.group, 0, 1 / 60);
      // Nothing may draw the new world until this is done: a single normal frame would compile every shader
      // synchronously, one by one, and freeze the page for seconds (the loading screen covers the canvas).
      this.compiling = true;
      try {
        await this.renderer.precompile(w.scene, this.camera);
      } catch {
        /* compile lazily */
      }
      this.compiling = false;
      if (this.world !== w) return;
      this.laps = modeId === 'race' ? (this.settings.lapsByLevel?.[w.level.id] ?? defaultLaps(w.level.id)) : Infinity;
      this.mode = modeId === 'highway' ? new HighwayMode() : null;
      this.mode?.start(w);
      this.startTiming(w.level.id, this.isOwned(this.settings.carId) ? this.settings.carId : 'vortex');
      this.lastLap = 1;
      this.lapStart = 0;
      this.bestLap = Infinity;
      this.raceTime = 0;
      this.countdown = 3;
      this.lastCount = -1;
      this.state = 'countdown';
      this.freeCam = false;
      this.menu.hide();
      this.hud.show(true);
      this.audio.setEngine(true);
      this.audio.ui?.start();
    this.updateNowPlaying();
    }, 60);
  }

  private toMenu(): void {
    if (this.online) {
      this.net.send({ t: 'leave' });
      this.online = null;
    }
    this.paused = false;
    this.menu.hide();
    this.loadMenuWorld(levelById(MENU_LEVEL), true);
    this.menu.show('main');
  }

  private pause(): void {
    if (this.online) {
      // Online races can't be paused: show the menu, the race keeps going.
      this.menu.showPause(true);
      return;
    }
    this.paused = true;
    this.audio.setEngine(false);
    this.menu.showPause();
    this.updateNowPlaying();
  }

  private resume(): void {
    this.paused = false;
    this.menu.hide();
    this.audio.setEngine(true);
    this.updateNowPlaying();
  }

  private recoverContext(): void {
    const old = this.world;
    if (!old) return;
    const saved = old.cars.map((c) => ({ phys: { ...c.phys }, finish: c.finish, ai: c.ai }));
    const w = this.buildWorld(old.level, old.weather.name, old.cars.length - 1);
    w.cars.forEach((c, i) => {
      if (!saved[i]) return;
      Object.assign(c.phys, saved[i].phys);
      c.finish = saved[i].finish;
      if (saved[i].ai) c.ai = saved[i].ai;
    });
    w.time = old.time;
  }

  // ------------------------------------------------------------- simulation

  private update(dt: number): void {
    const w = this.world;
    if (!w || this.paused || this.state === 'loading') return;

    if (this.state === 'menu') {
      w.step(dt, null);
      return;
    }
    if (this.state === 'netwait') {
      w.step(dt, null, true);
      return;
    }
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount) {
        this.lastCount = n;
        if (n >= 1) {
          this.hud.setCountdown(String(n));
          this.audio.sfx?.countdown(n);
        }
      }
      if (this.countdown <= 0) {
        this.state = 'racing';
        if (this.settings.authToken && this.net.connected && !this.mode) this.net.send({ t: 'lapstart' });
        this.hud.setCountdown('GO!');
        this.audio.sfx?.countdown(0);
        window.setTimeout(() => this.hud.setCountdown(null), 700);
      }
      // Revving on the grid: throttle input moves the rpm but cars stay put.
      this.input.touch = this.hud.touch;
      const rev = this.input.poll();
      w.step(dt, null, true);
      w.player.phys.rpm += ((900 + rev.throttle * 6000) - w.player.phys.rpm) * Math.min(1, dt * 6);
      w.player.input = { ...rev };
      return;
    }

    // Racing / finished (after the finish the AI takes over your car).
    this.raceTime += dt;
    const racing = this.state === 'racing';
    const p = w.player;
    // Rubber-banding keeps races close: AI behind you pushes hard, AI far ahead eases off only a little.
    const D = AI_DIFFICULTY[this.settings.difficulty] ?? AI_DIFFICULTY.normal;
    for (const c of w.cars) {
      if (!c.ai || c.isPlayer || this.online) continue;
      const gap = c.phys.s - p.phys.s;
      c.ai.skill = Math.max(D.band[0], Math.min(D.band[1], c.ai.skill + (gap > 150 ? -D.ease : gap < -40 ? D.catchUp : 0)));
    }
    this.input.touch = this.hud.touch;
    this.input.touchBoost = this.hud.boostHeld;
    const inp = racing ? this.input.poll() : null;
    const wasBoosting = p.phys.boosting;
    const ev = w.step(dt, inp);
    if (p.phys.boosting && !wasBoosting) this.audio.sfx?.boost();
    if (racing) this.beatMoves(p.phys);
    if (this.mode && racing) {
      this.mode.update(dt, w, ev);
      for (const pop of this.mode.takePops()) this.hud.beatPop(pop.text, pop.good);
      if (this.mode.done) this.finishMode();
    }
    if (this.online && ++this.netTick % 4 === 0) {
      const ph = p.phys;
      this.net.send({ t: 'state', s: { s: ph.s, x: ph.x, psi: ph.psi, phi: ph.phi, v: ph.v, steer: ph.steer, drift: ph.driftAngle, b: ph.boosting ? 1 : 0 } });
    }
    if (ev.playerWall > 0.05 && this.wallCooldown <= 0) {
      if (ev.playerWall > 0.5) this.audio.sfx?.impact(ev.playerWall);
      else this.audio.sfx?.scrape(Math.min(1, 0.3 + ev.playerWall), 0.3);
      this.wallCooldown = 0.25;
    }
    if (ev.playerHit > 0.05 && this.wallCooldown <= 0) {
      this.audio.sfx?.impact(Math.min(1, ev.playerHit + 0.3));
      this.wallCooldown = 0.35;
    }
    this.wallCooldown -= dt;

    // Laps & finish.
    const L = w.track.length;
    for (const c of w.cars) {
      if (c.finish === undefined && c.phys.s >= this.laps * L) c.finish = this.raceTime;
    }
    const lap = Math.floor(Math.max(0, p.phys.s) / L) + 1;
    if (lap !== this.lastLap && racing) {
      if (lap > this.lastLap) {
        const lapTime = this.raceTime - this.lapStart;
        this.bestLap = Math.min(this.bestLap, lapTime);
        this.lapStart = this.raceTime;
        if (!this.mode) {
          this.recordLap(w.level.id, lapTime);
          // The track boards take this time once the server has checked the lap was possible.
          if (this.settings.authToken && this.net.connected) this.net.send({ t: 'lapdone', lap: lap - 1, ms: Math.round(lapTime * 1000) });
        }
      }
      this.lastLap = lap;
      if (lap === this.laps) this.hud.message('FINAL LAP!');
      else if (lap < this.laps) this.hud.message(`LAP ${lap}`);
      this.audio.ui?.select();
    }
    if (racing && p.finish !== undefined) {
      if (this.online) this.finishOnline();
      else this.finishRace();
    }
  }

  /** A lap was completed in a race: a new personal best is shown and kept locally. */
  private recordLap(levelId: string, seconds: number): void {
    const ms = Math.round(seconds * 1000);
    const prev = this.settings.bestLaps[levelId];
    if (prev !== undefined && ms >= prev) return;
    this.settings.bestLaps[levelId] = ms;
    saveSettings(this.settings);
    this.hud.beatPop(`BEST LAP ${formatTime(seconds)}`, true);
  }

  // --------------------------------------------------------------- accounts

  /** Back from Google / Discord: the session token comes in the address (#auth=…); keep it, clean the address. */
  private async takeSignIn(): Promise<void> {
    const h = window.location.hash;
    const tok = /[#&]auth=([\w-]+)/.exec(h)?.[1];
    const err = /[#&]autherror=([^&]+)/.exec(h)?.[1];
    if (tok || err) history.replaceState(null, '', window.location.pathname + window.location.search);
    if (err) this.menu.toast(decodeURIComponent(err));
    if (tok) this.settings.authToken = tok;
    if (!this.settings.authToken) { this.menu.refreshAccount(); return; }
    // (The page is busy building its first 3D scene right now: allow time, and try again if it is offline.)
    let me = await this.store.me(this.settings.authToken);
    for (let i = 0; i < 3 && me === undefined; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      me = await this.store.me(this.settings.authToken);
    }
    if (me === null) this.settings.authToken = ''; // signed out elsewhere / expired
    else if (me) {
      this.settings.playerName = me.name;
      this.settings.rating = me.rating;
      this.settings.games = me.games;
      this.settings.ownedCars = me.owned;
      if (tok) this.menu.toast(`Signed in as ${me.name}`);
    }
    saveSettings(this.settings);
    this.menu.refreshAccount();
  }

  private async signOut(): Promise<void> {
    await this.store.signOut(this.settings.authToken);
    this.settings.authToken = '';
    this.settings.ownedCars = [];
    saveSettings(this.settings);
    this.net.close();
    this.menu.refreshAccount();
    this.menu.toast('Signed out');
  }

  private async rename(name: string): Promise<string | null> {
    const r = await this.store.rename(this.settings.authToken, name);
    if (r.error) return r.error;
    this.settings.playerName = r.name ?? name;
    saveSettings(this.settings);
    return null;
  }

  // ------------------------------------------------------------ server lap timing

  private timingTimer = 0;

  /**
   * Quick race, signed in: report the car's distance along the track ten times a second, so the server can
   * check each lap (every step possible, the lap time matching its own clock) before it goes on the track board.
   */
  private startTiming(levelId: string, carId: string): void {
    window.clearInterval(this.timingTimer);
    if (!this.settings.authToken || this.online || this.mode) return;
    void this.ensureOnline().then((ok) => {
      if (!ok) return;
      this.net.send({ t: 'timing', level: levelId, car: carId });
      this.timingTimer = window.setInterval(() => {
        const w = this.world;
        if (!w || w.level.id !== levelId || this.state === 'menu' || this.paused) {
          if (!w || w.level.id !== levelId || this.state === 'menu') window.clearInterval(this.timingTimer);
          return;
        }
        if (this.state === 'racing') this.net.send({ t: 'tt', s: +w.player.phys.s.toFixed(2), v: +w.player.phys.v.toFixed(2) });
      }, 100);
    });
  }

  // ------------------------------------------------------------ VHS look

  private vhsTime = 0;

  /** Current game mode (Highway Rush), null in a normal race. */
  private mode: GameMode | null = null;

  private finishMode(): void {
    const m = this.mode!;
    this.state = 'finished';
    const r = m.result();
    this.audio.ui?.fanfare(r.won);
    this.hud.message(r.title, 2.5);
    const name = this.settings.playerName || 'YOU';
    window.setTimeout(() => {
      if (this.state !== 'finished') return;
      this.hud.show(false);
      this.audio.setEngine(false);
      this.menu.showResults([{ pos: 1, name, time: r.score.toLocaleString('en-US'), isPlayer: true }], r.detail, 'Play Again', r.title, 'SCORE');
    }, 2200);
  }

  private finishRace(): void {
    const w = this.world!;
    this.state = 'finished';
    const L = w.track.length;
    const order = [...w.cars].sort((a, b) => {
      const fa = a.finish ?? this.raceTime + (this.laps * L - a.phys.s) / Math.max(a.phys.v, 1);
      const fb = b.finish ?? this.raceTime + (this.laps * L - b.phys.s) / Math.max(b.phys.v, 1);
      return fa - fb;
    });
    const rows: ResultRow[] = order.map((c, i) => ({
      pos: i + 1,
      name: c.name === 'YOU' && this.settings.playerName ? this.settings.playerName : c.name,
      time: formatTime(c.finish ?? this.raceTime + (this.laps * L - c.phys.s) / Math.max(c.phys.v, 1)),
      isPlayer: c.isPlayer,
    }));
    const won = order[0].isPlayer;
    this.audio.ui?.fanfare(won);
    this.hud.message(won ? 'WINNER!' : 'FINISH', 2.5);
    window.setTimeout(() => {
      if (this.state !== 'finished') return;
      this.hud.show(false);
      this.audio.setEngine(false);
      this.menu.showResults(rows, 'Quick Race results are not ranked. Play Netplay to earn rating points.');
    }, 2200);
  }

  // ------------------------------------------------------------- rendering

  private render(alpha: number, dt: number): void {
    const w = this.world;
    if (!w || this.compiling) return;
    w.placeCars(this.paused ? 1 : alpha);
    const p = w.player;

    if (this.state === 'menu' || this.state === 'loading') {
      this.attractCamera(w, dt, this.paused ? 1 : alpha);
    } else if (this.freeCam) {
      if (!this.orbit.enabled) {
        this.orbit.enabled = true;
        this.orbit.target.copy(p.car.group.position);
      }
      this.orbit.update();
    } else {
      this.orbit.enabled = false;
      // Boost widens the view a little more than the extra speed alone.
      this.chase.update(p.car.group, (p.phys.v / p.spec.topSpeed) * (p.phys.boosting ? 1.2 : 1), dt, w.travelDir(p, this.tmpF));
    }

    const covered = !!w.track.sectionAt(p.phys.s, 4) && this.state !== 'menu';
    if (this.mode && (this.state === 'racing' || this.state === 'countdown')) {
      this.mode.frame(dt, w);
      this.hud.setModeLines(this.mode.hud());
    } else this.hud.setModeLines(null);
    // The world and the HUD pulse to the music's beat.
    const bd = this.beatDistance();
    w.beatPulse = bd && !this.paused ? bd.pulse : 0;
    w.beatHit = this.paused ? 0 : this.hardHit(dt, bd);
    this.hud.setBeat(bd?.pulse ?? 0, !!bd && bd.dist <= App.BEAT_WINDOW);
    w.update(this.paused ? 0 : dt, this.camera, covered);
    this.vhsTime += dt;
    this.renderer.setVhs(this.settings.vhs === true ? 1 : 0, 0, this.vhsTime);

    if (this.state === 'racing' || this.state === 'finished' || this.state === 'countdown') {
      const L = w.track.length;
      const sorted = w.cars.filter((c) => !c.left).sort((a, b) => b.phys.s - a.phys.s);
      const v = Math.max(0, p.phys.v);
      this.hud.update({
        lap: Math.floor(Math.max(0, p.phys.s) / L) + 1,
        laps: this.laps,
        pos: sorted.indexOf(p) + 1,
        total: sorted.length,
        time: this.raceTime,
        kmh: v * 3.6,
        speed01: v / p.spec.topSpeed,
        boost: p.phys.boost,
        boosting: p.phys.boosting,
        dt,
        lapTime: this.state === 'racing' ? this.raceTime - this.lapStart : undefined,
        best: this.bestLap,
      });
      this.drawMinimap(w);
      const sec = w.track.sectionAt(p.phys.s);
      this.audio.update({
        speed01: v / p.spec.topSpeed, throttle: p.input.throttle, environment: sec ? sec.type : 'open',
        rpm: p.phys.rpm, gear: p.phys.gear, slip: p.phys.slip,
      });
      this.audio.sfx?.setBoost(p.phys.boosting && !this.paused, v / p.spec.topSpeed);
    } else {
      this.audio.update({ speed01: 0, throttle: 0, environment: 'open', rpm: 900, gear: 1, slip: 0 });
      this.audio.sfx?.setBoost(false);
    }
    this.renderer.render();
    if (this.state === 'racing' || this.state === 'countdown' || this.state === 'finished') this.renderMirror(w);
    // Dynamic resolution, from the real time between frames (only while racing: menus and loading don't count).
    const nowMs = performance.now();
    if (this.state === 'racing' && !this.paused && this.lastFrameMs) this.renderer.adaptResolution(nowMs - this.lastFrameMs);
    this.lastFrameMs = nowMs;
  }

  private coverBlend = 0;
  private lastFrameMs = 0;
  /** True while a freshly built world's shaders compile in the background (see startRace). */
  private compiling = false;
  /** Vehicle size relative to a car (bus ≈ 2.4): scales the camera shots. */
  private vehScale = 1;

  /** Cinematic menu camera: cycles through a few shots around the leading car. */
  private attractCamera(w: World, dt: number, alpha = 1): void {
    this.shotTimer += dt;
    if (this.shotTimer > 7) {
      this.shotTimer = 0;
      this.shot = (this.shot + 1) % 4;
    }
    const p = w.player;
    const pos = p.car.group.position;
    const t = this.shotTimer;
    // The car is drawn between two physics steps (alpha); the camera must use that same in-between position,
    // or it runs a step ahead / behind the car at frame rates other than the physics rate (stutter on phones).
    const ps = p.phys.ps + (p.phys.s - p.phys.ps) * alpha;
    const px = p.phys.px + (p.phys.x - p.phys.px) * alpha;
    const cam = this.camera;
    const track = w.track;
    const hw = track.width / 2;
    // Near a tunnel/canopy the shots are pulled inside the walls and under the roof (blended, no jump).
    const covered = !!track.sectionAt(ps, 30);
    this.coverBlend += ((covered ? 1 : 0) - this.coverBlend) * (1 - Math.exp(-dt * 4));
    const k = this.coverBlend;
    /** Camera at sOff metres along the track from the car, lat metres beside it, h above the road. */
    const camAt = (sOff: number, lat: number, h: number) => {
      track.frameAt(ps + sOff, this.frame);
      const room = hw - 1.6;
      const L = THREE.MathUtils.lerp(px + lat, THREE.MathUtils.clamp(px + lat, -room, room), k);
      cam.position.copy(this.frame.position).addScaledVector(this.frame.right, L);
      cam.position.y += THREE.MathUtils.lerp(h, Math.min(h, 4.8), k);
    };
    w.track.frameAt(ps, this.frame);
    const f = this.frame.forward;
    // Buses: every shot further out and above the roofs, so it never ends up inside one of the other buses.
    const vs = this.vehScale;
    const up = (vs - 1) * 2.6;
    if (this.shot === 0) {
      camAt((16 - t * 1.2) * vs, 3.5 * vs, 1.3 + up);
      cam.lookAt(pos.x, pos.y + 0.8 * vs, pos.z);
    } else if (this.shot === 1) {
      // Side shot from whichever side has more room (inside a tunnel the far wall is close).
      const side = k > 0.5 ? (px > 0 ? -1 : 1) : -1;
      const fx = f.x, fz = f.z;
      camAt((-3 + t * 0.6) * vs, side * 9 * Math.pow(vs, 0.7), 2.2 + up);
      cam.lookAt(pos.x + fx * 6 * vs, pos.y + 0.8 * vs, pos.z + fz * 6 * vs);
    } else if (this.shot === 2) {
      const fx = f.x, fz = f.z;
      camAt(-30 * vs, 6, (14 - t) * Math.pow(vs, 0.6));
      cam.lookAt(pos.x + fx * 20 * vs, pos.y, pos.z + fz * 20 * vs);
    } else {
      this.chase.update(p.car.group, 0.6, dt);
    }
    if (cam.fov !== 62 && this.shot !== 3) {
      cam.fov = 62;
      cam.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------- settings

  private applyQuality(): void {
    if (this.settings.qualityAuto !== false) this.settings.quality = detectGpu().tier;
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio;
    // High supersamples (at least 1.5x, up to 2x) so fine shader detail stays crisp instead of shimmering.
    // Phones start at 1x and may climb to their sharp native-ish resolution while they keep 60 fps (the dynamic
    // resolution steps back down when the frame rate drops). Weak desktop GPUs start low.
    const ratio = isMobile ? Math.min(dpr, q === 'high' ? 1.5 : 1) : q === 'low' ? Math.min(dpr, 1) * 0.75 : q === 'medium' ? Math.min(dpr, 1.25) : Math.min(Math.max(dpr, 1.5), 2);
    const maxRatio = isMobile ? dpr : ratio; // phones may go up to their full native resolution
    // Dynamic resolution: weak hardware may go well below 1x to hold the frame rate.
    this.renderer.setRatioRange(q === 'low' ? 0.5 : q === 'medium' ? 0.7 : 1, maxRatio);
    // Phones: as sharp as possible while the game stays above 30 fps.
    this.renderer.setMinFps(isMobile ? 30 : 42);
    if (Math.abs(this.renderer.webgl.getPixelRatio() - ratio) > 0.01) {
      this.renderer.webgl.setPixelRatio(ratio);
      this.renderer.resize();
    }
  }

  private readonly store = new Store();

  /** Cars the player can drive: all free ones + purchased ones. */
  private isOwned(id: string): boolean {
    return UNLOCK_ALL || carById(id).price === 0 || this.settings.ownedCars.includes(id);
  }

  private playerCarSetup(): CarSetup {
    const id = this.isOwned(this.settings.carId) ? this.settings.carId : 'vortex';
    const m = carById(id);
    return {
      style: m.style,
      paint: this.settings.carPaint[id] ?? m.paint,
      accent: m.accent,
      name: m.name,
      tier: m.tier,
      driftMode: this.settings.driveMode === 'drift',
      spec: specFor(m),
    };
  }

  private async refreshOwned(): Promise<void> {
    const list = await this.store.owned(this.settings.authToken);
    if (list) {
      this.settings.ownedCars = list;
      saveSettings(this.settings);
    }
    const mode = await this.store.mode();
    this.menu.renderGarage(mode);
  }

  private isLevelOwned(id: string): boolean {
    return UNLOCK_ALL || levelPrice(id) === 0 || this.settings.ownedCars.includes(levelItem(id));
  }

  /** Buy a car (id) or a level (`level:<id>`). */
  private async buyCar(id: string): Promise<void> {
    const isLevel = id.startsWith('level:');
    const lid = id.slice(6);
    const m = isLevel ? { name: LEVEL_NAMES[lid] ?? lid, price: levelPrice(lid) } : carById(id);
    const status = (t: string) => (isLevel ? this.menu.toast(t) : this.menu.setGarageStatus(t));
    if (!this.settings.authToken) {
      status('Sign in with Google or Discord first (Netplay screen): purchases belong to your account.');
      return;
    }
    status(`Starting purchase of ${m.name} (${formatPrice(m.price)})…`);
    const r = await this.store.buy(this.settings.authToken, id);
    if (r.redirected) return; // off to Stripe Checkout
    if (r.error) {
      status(r.error);
      return;
    }
    if (r.owned) this.settings.ownedCars = r.owned;
    if (r.granted) {
      if (!isLevel) this.settings.carId = id;
      saveSettings(this.settings);
      this.audio.ui?.fanfare(true);
      this.menu.toast(`${m.name} unlocked${r.test ? ' (TEST purchase — no money charged)' : ''}!`);
      if (isLevel) this.menu.show('quick', false);
      else this.menu.renderGarage(r.test ? 'test' : 'stripe');
    }
  }

  private currentAmbience: AmbienceKind = 'none';
  private musicTitle = 'Press any key to start the music';

  private updateNowPlaying(): void {
    const inRace = (this.state === 'racing' || this.state === 'countdown' || this.state === 'netwait' || this.state === 'finished') && !this.menu.open;
    this.menu.setNowPlaying(this.musicTitle, AMBIENCE_LABELS[this.currentAmbience], inRace && !this.paused);
  }

  /** Level default unless the player picked a fixed ambience in Options. */
  private applyAmbience(): void {
    const pick = this.settings.ambience;
    const kind = (pick === 'auto' ? this.world?.level.ambience ?? 'none' : pick) as AmbienceKind;
    if (kind !== this.currentAmbience) {
      this.currentAmbience = kind;
      this.audio.setAmbience(kind);
      this.menu.toast(`♪ Ambience: ${AMBIENCE_LABELS[kind]}`);
    }
    this.menu.refreshAmbience();
    this.updateNowPlaying();
  }

  private shuffleTimer = 0;
  private lastMusicPick = '';

  /** Level track unless the player picked a fixed track or shuffle. `levelChanged` re-rolls shuffle. */
  // ------------------------------------------------------------ drive to the beat

  /** Beats away from the nearest beat (0 = on it, 0.5 = halfway), or null when the music has no beat clock. */
  private beatDistance(): { dist: number; pulse: number; frac: number; index: number } | null {
    const clock = this.audio.music?.beat;
    const now = this.audio.ctx?.currentTime;
    if (!clock || now === undefined) return null;
    const b = clock.beatAt(now);
    const frac = b - Math.floor(b);
    return { dist: Math.min(frac, 1 - frac), pulse: Math.exp(-frac * 7), frac, index: Math.floor(b) };
  }

  // Hard-hit detector: watches the music's low end (kick drum). Each kick's energy (integrated over
  // ~90 ms, steadier than a single peak) is compared with the recent kicks; only clearly harder ones
  // flash: accents, drops, the full beat coming back in after a break. A steady four-on-the-floor
  // stays mostly dark.
  private bassPrev = 0;
  private kickAvg = 0;
  private kickSum = 0;
  private kickWindow = 0;
  private kickFired = false;
  private sinceKick = 0;
  private hitGlow = 0;
  private hardHit(dt: number, bd: { dist: number } | null): number {
    const e = this.audio.bassEnergy();
    this.hitGlow *= Math.exp(-dt * 5);
    if (e <= 0) return this.hitGlow;
    // The reference slowly sinks while there are no kicks, so the beat returning after a break hits hard.
    this.sinceKick += dt;
    if (this.sinceKick > 1) this.kickAvg *= Math.exp(-dt * 0.4);
    if (this.kickWindow > 0) {
      this.kickSum += e * dt;
      this.kickWindow -= dt;
      const ratio = this.kickSum / Math.max(this.kickAvg, 1e-12);
      if (!this.kickFired && this.kickAvg > 0 && ratio > 1.45) {
        this.kickFired = true; // flash as soon as it is clearly harder, no need to wait for the window
        this.hitGlow = Math.max(this.hitGlow, Math.min(1, 0.5 + (ratio - 1.45) * 0.5));
      }
      if (this.kickWindow <= 0) {
        // Log-domain average, so one huge hit doesn't mask the next few.
        const l = Math.log(this.kickSum), avg = this.kickAvg > 0 ? Math.log(this.kickAvg) : l;
        this.kickAvg = Math.exp(avg + (l - avg) * 0.2);
      }
    } else if (e > this.bassPrev * 2 && (!bd || bd.dist < 0.12)) {
      // A kick starts: sharp rise in the low end, on the beat when the track has a beat clock
      // (that skips bass-line notes between the beats).
      this.kickWindow = 0.09;
      this.sinceKick = 0;
      this.kickSum = e * dt;
      this.kickFired = false;
    }
    this.bassPrev = e;
    return this.hitGlow;
  }

  private beatChain = 0;
  private lastBeat = -1;
  private wasBoostingBeat = false;
  /** Beat window (in beats) for firing the boost on the beat. */
  private static readonly BEAT_WINDOW = 0.17;

  /**
   * The music feeds the boost — no timing needed for drifts:
   *  - every beat that passes while you're drifting adds boost, more the longer the drift keeps going;
   *  - firing the boost on a beat gives an extra shove ("BEAT BOOST").
   */
  private beatMoves(ph: { drift: number; boost: number; boosting: boolean; v: number }): void {
    const b = this.beatDistance();
    const startedBoost = ph.boosting && !this.wasBoostingBeat;
    this.wasBoostingBeat = ph.boosting;
    if (!b) return;
    if (b.index !== this.lastBeat) {
      this.lastBeat = b.index;
      if (ph.drift > 0.5 && ph.v > 12) {
        this.beatChain = Math.min(this.beatChain + 1, 12);
        ph.boost = Math.min(1, ph.boost + 0.02 + 0.012 * Math.min(this.beatChain, 6));
        if (this.beatChain >= 2) this.hud.beatPop(`BEAT DRIFT ×${this.beatChain}`, true);
      } else if (ph.drift < 0.3) {
        this.beatChain = 0;
      }
    }
    if (startedBoost && b.dist <= App.BEAT_WINDOW) {
      ph.v += 3; // on top of the normal boost kick
      ph.boost = Math.min(1, ph.boost + 0.05);
      this.hud.beatPop('BEAT BOOST', true);
      this.audio.sfx?.blip(true);
    }
  }

  /** True while the title screen's own background is showing (it always plays the theme). */
  private onTitle = false;

  private applyMusic(levelChanged = false): void {
    if (this.onTitle) {
      // The game always opens with its theme, whatever the music setting.
      window.clearInterval(this.shuffleTimer);
      this.audio.playMusic('space-city');
      return;
    }
    const pick = this.settings.music;
    const switchedToShuffle = pick === 'shuffle' && this.lastMusicPick !== 'shuffle';
    this.lastMusicPick = pick;
    window.clearInterval(this.shuffleTimer);
    if (pick === 'shuffle') {
      if (levelChanged || switchedToShuffle || !this.audio.music?.current) void this.audio.music?.shuffle();
      this.shuffleTimer = window.setInterval(() => void this.audio.music?.shuffle(), 4 * 60 * 1000);
      if (!this.audio.music) this.audio.playMusic(this.world?.level.music ?? 'space-city');
      return;
    }
    this.audio.playMusic(pick === 'auto' ? this.world?.level.music ?? 'space-city' : pick);
  }

  private applySettings(): void {
    this.hud.setTouchMode(this.settings.touchControls ?? 'buttons', this.settings.autoGas !== false);
    if (this.world) {
      this.applyAmbience();
      this.applyMusic();
    }
    const v = this.settings.volume;
    this.audio.setVolume('master', v.master);
    this.audio.setVolume('music', v.music);
    this.audio.setVolume('sfx', v.sfx);
    this.audio.setVolume('ambience', v.ambience);
    this.applyQuality();
    this.renderer.lighting = Math.min(1, Math.max(0.5, this.settings.lighting ?? 1));
    if (this.world) this.world.road.beatSides = this.settings.beatSides ?? 1;

  }

  private layoutMirror(): void {
    this.mirror.layout();
    const r = this.mirror.rect;
    Object.assign(this.mirrorFrame.style, { left: `${r.x - 3}px`, top: `${r.y - 3}px`, width: `${r.w + 6}px`, height: `${r.h + 6}px` });
  }

  private renderMirror(w: World): void {
    const show = this.settings.quality !== 'low' && !this.freeCam;
    this.mirrorFrame.style.display = show ? '' : 'none';
    if (!show) return;
    const g = w.player.car.group;
    this.tmpF.set(0, 0, -1).applyQuaternion(g.quaternion).setY(0).normalize();
    const cam = this.mirror.camera;
    // Just behind the vehicle's tail (scaled for long ones like the bus), looking back.
    const half = w.player.car.style.length / 2;
    const k = Math.max(1, half / 2.3);
    cam.position.copy(g.position).addScaledVector(this.tmpF, -(half + 0.45)).setY(g.position.y + 1.05 * k);
    this.tmpV.copy(g.position).addScaledVector(this.tmpF, -30 * k).setY(g.position.y + 0.6 * k);
    cam.lookAt(this.tmpV);
    this.mirror.render(this.renderer.webgl, w.scene);
  }

  private onResize(): void {
    this.layoutMirror();
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.resize();
  }

  // ------------------------------------------------------------- netplay

  private async ensureOnline(): Promise<boolean> {
    try {
      await this.net.connect();
      this.net.send({ t: 'hello', token: this.settings.authToken });
      return true;
    } catch {
      return false;
    }
  }

  private online: OnlineRace | null = null;
  private lastWasOnline = false;
  private netTick = 0;

  /** Server found a match: load the level with every driver on the grid, then report ready. */
  private startOnline(m: Extract<ServerMsg, { t: 'match' }>): void {
    this.onTitle = false;
    const level = levelById(m.levelId);
    this.online = { matchId: m.matchId, you: m.you, players: m.players, laps: m.laps, finishedSent: false };
    this.lastWasOnline = true;
    this.menu.showLoading();
    this.state = 'loading';
    this.paused = false;
    window.setTimeout(async () => {
      const grid = m.players.map((p) => {
        const model = carById(p.car.id);
        return {
          id: p.id,
          name: p.id === m.you ? 'YOU' : p.name,
          local: p.id === m.you,
          setup: p.id === m.you ? this.playerCarSetup() : { style: model.style, paint: p.car.paint || model.paint, accent: model.accent, spec: specFor(model), tier: model.tier },
        };
      });
      const serverWeather = (m.weather as WeatherName) ?? 'clear';
      const w = this.buildWorld(level, serverWeather === 'fog' ? 'clear' : serverWeather, 0, grid);
      w.weather.setFog(serverWeather === 'fog', true);
      w.placeCars(0);
      this.chase.update(w.player.car.group, 0, 1 / 60);
      this.compiling = true; // see startRace: no frame may draw the new world before its shaders are ready
      try { await this.renderer.precompile(w.scene, this.camera); } catch { /* lazy */ }
      this.compiling = false;
      if (!this.online || this.world !== w) return;
      this.laps = m.laps;
      this.lastLap = 1;
      this.lapStart = 0;
      this.bestLap = Infinity;
      this.raceTime = 0;
      this.netTick = 0;
      this.state = 'netwait';
      this.freeCam = false;
      this.menu.hide();
      this.hud.show(true);
      this.hud.message('Waiting for the other drivers…', 30);
      this.audio.setEngine(true);
      this.updateNowPlaying();
      this.net.send({ t: 'ready' });
    }, 60);
  }

  /** Server says go: everyone starts the countdown together. */
  private goOnline(countdown: number): void {
    if (!this.online || (this.state !== 'netwait' && this.state !== 'loading')) return;
    this.hud.message('', 0.01);
    this.countdown = countdown;
    this.lastCount = -1;
    this.state = 'countdown';
    this.audio.ui?.start();
    this.updateNowPlaying();
  }

  private finishOnline(): void {
    const o = this.online!;
    if (o.finishedSent) return;
    o.finishedSent = true;
    this.state = 'finished';
    // One last position report across the line first: the server times the final lap from these reports.
    const ph = this.world?.player.phys;
    if (ph) this.net.send({ t: 'state', s: { s: ph.s, x: ph.x, psi: ph.psi, phi: ph.phi, v: ph.v, steer: ph.steer, drift: ph.driftAngle, b: ph.boosting ? 1 : 0 } });
    this.net.send({ t: 'finish', time: this.raceTime });
    this.audio.ui?.fanfare(true);
    this.hud.message(`FINISHED ${formatTime(this.raceTime)} — waiting for the others…`, 60);
  }

  private resultsOnline(m: Extract<ServerMsg, { t: 'result' }>): void {
    const o = this.online;
    if (!o || m.matchId !== o.matchId) return;
    this.online = null;
    const byId = new Map(o.players.map((p) => [p.id, p]));
    const rows: ResultRow[] = m.order.map((id, i) => ({
      pos: i + 1,
      name: byId.get(id)?.name ?? '?',
      time: m.dq?.includes(id) ? 'DSQ' : m.times[id] ? formatTime(m.times[id]) : 'DNF',
      isPlayer: id === o.you,
    }));
    const me = byId.get(o.you);
    const newRating = m.ratings[o.you];
    let extra = m.dq?.includes(o.you) ? 'Disqualified: failed the server boost / speed check. ' : '';
    if (me && newRating !== undefined) {
      const d = newRating - me.rating;
      extra += `Rating ${me.rating} → ${newRating} (${d >= 0 ? '+' : ''}${d})`;
      this.settings.rating = newRating;
      this.settings.games += 1;
      saveSettings(this.settings);
      this.menu.updateRating();
    }
    const won = m.order[0] === o.you;
    this.audio.ui?.fanfare(won);
    this.hud.show(false);
    this.audio.setEngine(false);
    this.state = 'finished';
    this.menu.showResults(rows, extra, 'Find Next Match');
    this.updateNowPlaying();
  }

  private async findMatch(fromResults = false): Promise<void> {
    if (fromResults) {
      this.toMenu();
      this.menu.show('netplay');
    }
    this.menu.setNetStatus('Connecting to server…', true);
    if (!(await this.ensureOnline())) {
      this.menu.setNetStatus('Game server offline — try again in a moment.');
      return;
    }
    const carId = this.isOwned(this.settings.carId) ? this.settings.carId : 'vortex';
    this.net.send({ t: 'queue', wait: this.settings.matchWait ?? 30, car: { id: carId, paint: this.settings.carPaint[carId] ?? '' } });
    this.menu.setNetStatus('Searching for drivers near your rating…', true);
  }

  private cancelMatch(): void {
    if (this.net.connected) this.net.send({ t: 'cancel' });
    this.menu.setNetStatus('Matchmaking cancelled.');
  }

  /** Leaderboard over plain HTTP: works without a driver name or a socket connection. */
  private async refreshLeaderboard(): Promise<void> {
    const rows = await this.store.leaderboard();
    if (!rows) this.menu.setLeaderboard(null, 'Leaderboard offline — start the server ("npm run server").');
    else this.menu.setLeaderboard(NetClient.toRows(rows, this.settings.playerName));
  }

  private onNet(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        if (m.owned) this.settings.ownedCars = m.owned;
        this.settings.playerName = m.name;
        this.settings.rating = m.rating;
        this.settings.games = m.games;
        saveSettings(this.settings);
        this.menu.updateRating();
        break;
      case 'queued':
        if (m.found === undefined || m.wait === undefined || m.waited === undefined) {
          this.menu.setNetStatus(`In queue (${m.size} searching) · matching within ±${m.range} rating…`, true);
          break;
        }
        {
          const max = m.max ?? 4;
          const left = Math.max(0, m.wait - m.waited);
          const plan = left > 0
            ? `Looking for a full race of ${max} drivers. In ${left} s the race starts with the drivers found so far (minimum 2).`
            : m.found > 1
              ? `Wait time is up: starting with ${m.found} drivers as soon as they are ready too…`
              : `Wait time is up, but nobody is online near your rating yet. Still searching — the first driver who joins races you.`;
          this.menu.setNetStatus(`Searching… ${m.found}/${max} drivers found · ${m.waited} s / ${m.wait} s · rating range ±${m.range}
${plan}`, true);
        }
        break;
      case 'match':
        this.menu.setNetStatus(`Match found: ${m.players.map((p) => `${p.name} (${p.rating})`).join(' vs ')}`);
        this.startOnline(m);
        break;
      case 'go':
        this.goOnline(m.countdown);
        break;
      case 'state':
        this.world?.applyRemote(m.id, m.s);
        break;
      case 'left': {
        const who = this.online?.players.find((p) => p.id === m.id)?.name ?? 'A driver';
        this.world?.removeRemote(m.id);
        this.hud.message(`${who} left the race`, 2.5);
        break;
      }
      case 'result':
        this.resultsOnline(m);
        break;
      case 'leaderboard':
        this.menu.setLeaderboard(NetClient.toRows(m.rows, this.settings.playerName));
        break;
      case 'error':
        if (m.code === 'auth') { this.settings.authToken = ''; saveSettings(this.settings); this.menu.refreshAccount(); }
        this.menu.setNetStatus(m.message);
        break;
      case 'lap':
        if (m.rejected) this.menu.toast(`Lap not counted for the track board: ${m.rejected}`);
        else if (m.improved && m.rank) this.menu.toast(`New track record for you: ${formatTime(m.ms / 1000)} — #${m.rank} on ${LEVEL_NAMES[m.level] ?? m.level}`);
        break;
      case 'warn':
        this.hud.message(m.message, 4);
        break;
    }
  }
}
