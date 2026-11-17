import './menu.css';
import { LEVELS, UPCOMING } from '../levels';
import type { LevelDef } from '../levels/types';
import { AMBIENCE_LABELS, AmbienceKind } from '../audio/Ambience';
import { rankName } from '../net/elo';

/** Shown on the Netplay and Leaderboard screens. */
const RANK_TEXT = '<b>Rating</b> is your online skill score: everyone starts at 1000. In an online race you win points from every driver you finish ahead of and lose points to everyone who beats you — beating higher-rated drivers earns more. <b>Rank</b> is the title for your rating: Bronze (under 1100) · Silver 1100 · Gold 1250 · Platinum 1450 · Chrome 1700 · Neon Legend 2000+. Only Netplay races count; Quick Races against the AI do not change it.';
import { CARS, carById, formatPrice, PAINTS } from '../game/car/catalog';
import { levelItem, levelPrice } from '../game/products';
import type { StoreMode } from '../net/Store';
import { GaragePreview } from './GaragePreview';
import { listTracks, TrackInfo } from '../audio/SynthwaveMusic';
import { WEATHER_LABELS, WeatherName } from '../world/weather/Weather';
import { Settings, saveSettings } from './settings';

export type ScreenName = 'main' | 'quick' | 'garage' | 'netplay' | 'leaderboard' | 'options' | 'pause' | 'results' | 'loading' | 'none';

export interface MenuHandlers {
  startRace(): void;
  findMatch(): void;
  cancelMatch(): void;
  refreshLeaderboard(): void;
  resume(): void;
  restart(): void;
  quitToMenu(): void;
  settingsChanged(): void;
  previewLevel(level: LevelDef): void;
  sound(kind: 'hover' | 'select' | 'back'): void;
  /** What is playing now and what the current level would use by default. */
  ambienceInfo(): { current: AmbienceKind; levelDefault: AmbienceKind; levelName: string };
  musicInfo(): { current: string; levelDefault: string; levelName: string };
  garageOpen(): void;
  /** Main menu became visible. */
  mainShown(): void;
  garageBuy(carId: string): void;
  /** Buy a store item (car id or `level:<id>`). */
  buyItem(item: string): void;
  garageHear(carId: string): void;
}

export interface ResultRow {
  pos: number;
  name: string;
  time: string;
  isPlayer: boolean;
}

export interface LeaderRow {
  rank: number;
  name: string;
  rating: number;
  games: number;
  isMe?: boolean;
}


/** Weather names adapted to the level (snow / underwater). */
function weatherLabel(level: LevelDef, w: WeatherName): string {
  if (level.precipitation === 'snow') return ({ clear: 'Clear', rain: 'Snow', fog: 'Fog', storm: 'Blizzard' } as const)[w];
  if (level.precipitation === 'bubbles') return ({ clear: 'Calm', rain: 'Bubbles', fog: 'Murky', storm: 'Currents' } as const)[w];
  return WEATHER_LABELS[w];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** DOM-based neon menus (start screen, quick race, netplay, options, pause, results). */
export class Menu {
  readonly root: HTMLDivElement;
  current: ScreenName = 'none';
  private readonly screens = new Map<ScreenName, HTMLDivElement>();
  private history: ScreenName[] = [];

  constructor(private readonly s: Settings, private readonly h: MenuHandlers) {
    this.root = document.createElement('div');
    this.root.id = 'ui';
    document.body.appendChild(this.root);
    for (const name of ['main', 'quick', 'garage', 'netplay', 'leaderboard', 'options', 'pause', 'results', 'loading'] as ScreenName[]) {
      const el = document.createElement('div');
      el.className = 'screen' + (name === 'main' ? ' locked' : ' dim');
      el.dataset.screen = name;
      this.root.appendChild(el);
      this.screens.set(name, el);
    }
    this.renderMain();
    this.renderOptions();
    void listTracks().then((t) => {
      this.tracks = t;
      if (this.current === 'options') this.renderOptions();
    });

    // Hover / click sounds via delegation.
    this.root.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest('.btn, .chip, .card:not(.locked), .car-card, .swatch');
      if (t && !(t as HTMLElement).dataset.hovered) {
        (t as HTMLElement).dataset.hovered = '1';
        this.h.sound('hover');
        t.addEventListener('mouseleave', () => delete (t as HTMLElement).dataset.hovered, { once: true });
      }
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get open(): boolean {
    return this.current !== 'none';
  }

  show(name: ScreenName, pushHistory = true): void {
    if (this.current === 'garage' && name !== 'garage') this.closeGarage();
    if (pushHistory && this.current !== 'none' && this.current !== name) this.history.push(this.current);
    this.current = name;
    for (const [n, el] of this.screens) el.classList.toggle('active', n === name);
    if (name === 'main') this.h.mainShown();
    if (name === 'quick') this.renderQuick();
    if (name === 'garage') { this.renderGarage(); this.h.garageOpen(); }
    if (name === 'netplay') this.renderNetplay();
    if (name === 'leaderboard') this.renderLeaderboard();
    if (name === 'options') this.renderOptions();
    const first = this.screens.get(name)?.querySelector<HTMLElement>('.btn');
    first?.focus({ preventScroll: true });
  }

  back(): void {
    const prev = this.history.pop() ?? 'main';
    this.h.sound('back');
    this.show(prev, false);
  }

  hide(): void {
    if (this.current === 'garage') this.closeGarage();
    this.current = 'none';
    this.history = [];
    for (const el of this.screens.values()) el.classList.remove('active');
  }

  // ------------------------------------------------------------- screens

  private renderMain(): void {
    const el = this.screens.get('main')!;
    el.innerHTML = `
      <div class="logo"><div class="l1">NEON VELOCITY</div><div class="l2">Retro Racer</div></div>
      <div class="press-start" data-press>PRESS ANY KEY OR CLICK TO START</div>
      <div class="menu-list">
        <button class="btn primary" data-act="quick">Quick Race</button>
        <button class="btn" data-act="garage">Garage</button>
        <button class="btn" data-act="netplay">Netplay</button>
        <button class="btn" data-act="leaderboard">Leaderboard</button>
        <button class="btn" data-act="options">Options</button>
      </div>
      <div class="footer">↑↓ / gamepad to navigate · ENTER select · ESC back &nbsp;|&nbsp; M mute · N next song</div>`;
    el.querySelector('[data-act=quick]')!.addEventListener('click', () => { this.h.sound('select'); this.show('quick'); });
    el.querySelector('[data-act=garage]')!.addEventListener('click', () => { this.h.sound('select'); this.show('garage'); });
    el.querySelector('[data-act=netplay]')!.addEventListener('click', () => { this.h.sound('select'); this.show('netplay'); });
    el.querySelector('[data-act=leaderboard]')!.addEventListener('click', () => { this.h.sound('select'); this.show('leaderboard'); });
    el.querySelector('[data-act=options]')!.addEventListener('click', () => { this.h.sound('select'); this.show('options'); });
  }

  private renderLeaderboard(): void {
    const el = this.screens.get('leaderboard')!;
    el.innerHTML = `
      <div class="title">LEADERBOARD</div>
      <div class="panel" style="max-width:720px">
        <div class="row" style="justify-content:space-between">
          <span class="hud-small">ONLINE RANKING · ${esc(this.s.playerName || 'no driver name yet')} · ${this.s.rating}</span><button class="chip" data-act="refresh">Refresh</button></div>
        <div class="note" style="margin:6px 0 10px">${RANK_TEXT}</div>
        <table class="lb"><thead><tr><th>#</th><th>DRIVER</th><th>RATING</th><th>RANK</th><th>RACES</th></tr></thead>
          <tbody data-lb><tr><td colspan="5">Loading…</td></tr></tbody></table>
        <div class="row" style="margin-top:16px"><button class="btn small" data-act="back">Back</button></div>
      </div>`;
    el.querySelector('[data-act=refresh]')!.addEventListener('click', () => { this.h.sound('select'); this.h.refreshLeaderboard(); });
    el.querySelector('[data-act=back]')!.addEventListener('click', () => this.back());
    this.h.refreshLeaderboard();
  }

  private renderQuick(): void {
    const el = this.screens.get('quick')!;
    const s = this.s;
    const level = LEVELS.find((l) => l.id === s.levelId) ?? LEVELS[0];
    const weather0 = s.weather[level.id] ?? level.firstWeather ?? level.defaultWeather;
    const weather = weather0 === 'fog' ? 'clear' : weather0;
    const fogOn = s.fog?.[level.id] ?? weather0 === 'fog';
    const canFog = false; // fog was removed (it never looked right)
    const levelOwned = (id: string) => levelPrice(id) === 0 || s.ownedCars.includes(levelItem(id));
    const card = (l: { name: string; tagline: string; cardColors: [string, string] }, id?: string) => `
      <div tabindex="0" class="card ${id === level.id ? 'on' : ''} ${id ? '' : 'locked'} ${id && !levelOwned(id) ? 'paid' : ''}" ${id ? `data-level="${id}"` : ''}
        style="background: linear-gradient(135deg, ${l.cardColors[0]}, ${l.cardColors[1]})">
        <h3>${esc(l.name)}</h3><p>${esc(l.tagline)}</p>${id ? (levelOwned(id) ? '' : `<span class="badge price">🔒 ${formatPrice(levelPrice(id))}</span>`) : '<span class="badge">COMING SOON</span>'}
      </div>`;
    el.innerHTML = `
      <div class="title">QUICK RACE</div>
      <div class="panel">
        <div class="cards">${LEVELS.map((l) => card(l, l.id)).join('')}${UPCOMING.map((u) => card(u)).join('')}</div>
        <div class="row" style="margin-top:18px"><span class="label">Weather</span>
          ${level.weathers.filter((w) => w !== 'fog').map((w) => `<button class="chip ${w === weather ? 'on' : ''}" data-weather="${w}">${weatherLabel(level, w)}</button>`).join('')}</div>
        ${canFog ? `<div class="row"><span class="label">Fog</span>
          <button class="chip ${fogOn ? '' : 'on'}" data-fog="0">Off</button>
          <button class="chip ${fogOn ? 'on' : ''}" data-fog="1">On</button>
          <span style="font-family:Arial,sans-serif;font-size:12px;opacity:.8">Mist lying on the track — works with any weather.</span></div>` : ''}
        <div class="row"><span class="label">Mode</span>
          ${([['race', 'Race'], ['highway', 'Highway Rush'], ['heat', 'Heat']] as const).map(([m, label]) => `<button class="chip ${m === (s.mode ?? 'race') ? 'on' : ''}" data-mode="${m}">${label}</button>`).join('')}
          <span style="font-family:Arial,sans-serif;font-size:12px;opacity:.8">${(s.mode ?? 'race') === 'race' ? 'Classic race against the AI.' : s.mode === 'highway' ? 'Open road with traffic: near misses score, checkpoints add time — beat the clock.' : 'Police chase: survive 150 s without getting boxed in. The heat keeps rising.'}</span></div>
        ${(s.mode ?? 'race') === 'race' ? '' : '<div style="display:none">'}
        <div class="row"><span class="label">Laps</span>
          ${[1, 2, 3, 5].map((n) => `<button class="chip ${n === s.laps ? 'on' : ''}" data-laps="${n}">${n}</button>`).join('')}</div>
        <div class="row"><span class="label">Opponents</span>
          ${[1, 3, 5, 7, 10].map((n) => `<button class="chip ${n === s.opponents ? 'on' : ''}" data-opp="${n}">${n}</button>`).join('')}</div>
        ${(s.mode ?? 'race') === 'race' ? '' : '</div>'}
        <div class="row"><span class="label">Car</span>
          <span style="font-family:Arial,sans-serif">${esc(carById(s.carId).name)}</span>
          <button class="chip" data-act="garage">Change in Garage</button></div>
        <div class="row" style="justify-content:space-between;margin-top:18px">
          <button class="btn small" data-act="back">Back</button>
          ${levelOwned(level.id)
            ? '<button class="btn primary" data-act="start">Start Race ▸</button>'
            : `<button class="btn primary" data-act="buylevel">Unlock ${esc(level.name)} · ${formatPrice(levelPrice(level.id))}</button>`}
        </div>
      </div>`;
    el.querySelectorAll<HTMLElement>('[data-level]').forEach((c) => c.addEventListener('click', () => {
      s.levelId = c.dataset.level!;
      this.commit();
      this.h.sound('select');
      this.h.previewLevel(LEVELS.find((l) => l.id === s.levelId)!);
      this.renderQuick();
    }));
    el.querySelectorAll<HTMLElement>('[data-weather]').forEach((c) => c.addEventListener('click', () => {
      s.weather[level.id] = c.dataset.weather as WeatherName;
      this.commit(); this.h.sound('select'); this.renderQuick();
    }));
    el.querySelectorAll<HTMLElement>('[data-fog]').forEach((c) => c.addEventListener('click', () => {
      s.fog ??= {};
      s.fog[level.id] = c.dataset.fog === '1';
      this.commit(); this.h.sound('select'); this.h.previewLevel(level); this.renderQuick();
    }));
    el.querySelectorAll<HTMLElement>('[data-mode]').forEach((c) => c.addEventListener('click', () => {
      s.mode = c.dataset.mode as Settings['mode'];
      this.commit(); this.h.sound('select'); this.renderQuick();
    }));
    el.querySelectorAll<HTMLElement>('[data-laps]').forEach((c) => c.addEventListener('click', () => {
      s.laps = +c.dataset.laps!; this.commit(); this.h.sound('select'); this.renderQuick();
    }));
    el.querySelectorAll<HTMLElement>('[data-opp]').forEach((c) => c.addEventListener('click', () => {
      s.opponents = +c.dataset.opp!; this.commit(); this.h.sound('select'); this.renderQuick();
    }));
    el.querySelector('[data-act=garage]')?.addEventListener('click', () => { this.h.sound('select'); this.show('garage'); });
    el.querySelector('[data-act=back]')!.addEventListener('click', () => this.back());
    el.querySelector('[data-act=start]')?.addEventListener('click', () => this.h.startRace());
    el.querySelector('[data-act=buylevel]')?.addEventListener('click', () => { this.h.sound('select'); this.h.buyItem(levelItem(level.id)); });
  }

  private preview: GaragePreview | null = null;
  private garageView = '';
  private storeMode: StoreMode = 'offline';

  private owns(id: string): boolean {
    return carById(id).price === 0 || this.s.ownedCars.includes(id);
  }

  renderGarage(mode?: StoreMode): void {
    if (mode) this.storeMode = mode;
    const el = this.screens.get('garage')!;
    const s = this.s;
    if (!this.garageView) this.garageView = s.carId;
    const view = carById(this.garageView);
    const owned = this.owns(view.id);
    const bar = (v: number) => `<span class="stat"><i style="width:${v * 10}%"></i></span>`;
    const paint = s.carPaint[view.id] ?? view.paint;
    const modeNote = this.storeMode === 'test' ? 'Store: TEST MODE — purchases are free test unlocks.'
      : this.storeMode === 'stripe' ? 'Secure payment via Stripe Checkout.'
      : this.storeMode === 'off' ? 'Store disabled on this server.' : 'Store offline — start the server to buy cars.';
    el.innerHTML = `
      <div class="title">GARAGE</div>
      <div class="panel garage">
        <div class="car-list">
          ${CARS.map((c) => `
            <div tabindex="0" class="car-card tier-${c.tier} ${c.id === view.id ? 'on' : ''} ${this.owns(c.id) ? '' : 'locked'}" data-car="${c.id}">
              <div class="car-name">${esc(c.name)}${c.tier !== 'free' ? ` <span class="tier-badge ${c.tier}">${c.tier.toUpperCase()}</span>` : ''}${c.id === s.carId ? ' <span class="eq">★</span>' : ''}</div>
              <div class="car-price">${this.owns(c.id) ? (c.price ? 'OWNED' : 'FREE') : '🔒 ' + formatPrice(c.price)}</div>
            </div>`).join('')}
        </div>
        <div class="car-view">
          <canvas class="car-canvas"></canvas>
          ${owned ? '' : `<div class="lock-badge">🔒 LOCKED · ${formatPrice(view.price)}</div>`}
          <h2>${esc(view.name)}${view.tier !== 'free' ? ` <span class="tier-badge ${view.tier}">${view.tier.toUpperCase()}</span>` : ''}</h2>
          <p class="blurb">${esc(view.blurb)}</p>
          <div class="row" style="margin:4px 0"><button class="chip" data-act="hear">🔊 Hear engine</button></div>
          <div class="stats">
            <div><span>SPEED</span>${bar(view.stats.speed)}</div>
            <div><span>ACCEL</span>${bar(view.stats.accel)}</div>
            <div><span>GRIP</span>${bar(view.stats.grip)}</div>
          </div>
          ${owned ? `<div class="row">${PAINTS.map((p) => `<span tabindex="0" class="swatch ${p === paint ? 'on' : ''}" data-paint="${p}" style="background:${p}"></span>`).join('')}</div>` : ''}
          <div class="row" style="justify-content:space-between;margin-top:12px">
            <button class="btn small" data-act="back">Back</button>
            ${owned
              ? `<button class="btn primary" data-act="select" ${view.id === s.carId ? 'disabled' : ''}>${view.id === s.carId ? 'Selected' : 'Select'}</button>`
              : `<button class="btn primary" data-act="buy">Buy ${formatPrice(view.price)}</button>`}
          </div>
          <div class="status" data-garage-status>${esc(modeNote)}</div>
        </div>
      </div>`;
    // 3D preview (kept alive while the garage is open).
    const canvas = el.querySelector<HTMLCanvasElement>('.car-canvas')!;
    if (this.preview) {
      canvas.replaceWith(this.preview.canvas);
      this.preview.canvas.className = 'car-canvas';
    } else {
      this.preview = new GaragePreview(canvas);
    }
    this.preview.resize();
    this.preview.show(view, paint, !owned);
    el.querySelectorAll<HTMLElement>('[data-car]').forEach((c) => c.addEventListener('click', () => {
      this.garageView = c.dataset.car!;
      this.h.garageHear(this.garageView);
      this.renderGarage();
    }));
    el.querySelectorAll<HTMLElement>('[data-paint]').forEach((c) => c.addEventListener('click', () => {
      s.carPaint[view.id] = c.dataset.paint!;
      this.commit(); this.h.sound('select'); this.renderGarage();
    }));
    el.querySelector('[data-act=select]')?.addEventListener('click', () => {
      s.carId = view.id; this.commit(); this.h.sound('select'); this.renderGarage();
    });
    el.querySelector('[data-act=hear]')?.addEventListener('click', () => this.h.garageHear(view.id));
    el.querySelector('[data-act=buy]')?.addEventListener('click', () => { this.h.sound('select'); this.h.garageBuy(view.id); });
    el.querySelector('[data-act=back]')!.addEventListener('click', () => this.back());
  }

  setGarageStatus(text: string): void {
    const n = this.screens.get('garage')!.querySelector('[data-garage-status]');
    if (n) n.textContent = text;
  }

  private closeGarage(): void {
    this.preview?.dispose();
    this.preview = null;
    this.garageView = '';
  }

  private renderNetplay(): void {
    const el = this.screens.get('netplay')!;
    const s = this.s;
    el.innerHTML = `
      <div class="title">NETPLAY</div>
      <div class="panel" style="max-width:720px">
        <div class="row"><span class="label">Driver name</span>
          <input type="text" maxlength="16" value="${esc(s.playerName)}" placeholder="Enter a name" data-name></div>
        <div class="rating"><div><div class="hud-small">RATING</div><div class="big" data-rating>${s.rating}</div></div>
          <div><div class="hud-small">RANK</div><div class="hud-big" data-rank>${rankName(s.rating)}</div></div>
          <div><div class="hud-small">RACES</div><div class="hud-big" data-games>${s.games}</div></div></div>
        <div class="note" style="margin-top:6px">${RANK_TEXT}</div>
        <div class="row" style="margin-top:10px"><span class="label">Max wait</span>
          ${([15, 30, 45] as const).map((n) => `<button class="chip ${n === (s.matchWait ?? 30) ? 'on' : ''}" data-wait="${n}">${n} s</button>`).join('')}</div>
        <div class="note" style="margin-top:2px">A race prefers <b>4 drivers</b>. If 4 are found it starts at once; otherwise, after the wait time you pick here, it starts with the drivers found so far (at least 2). Longer = bigger races, shorter = faster start.</div>
        <div class="row" style="margin-top:14px">
          <button class="btn primary" data-act="find">Find Match</button>
          <button class="btn small" data-act="cancel" style="display:none">Cancel</button>
        </div>
        <div class="status" data-status>Matchmaking pairs you with drivers of a similar rating. Win to climb the ladder.</div>
        <div class="row" style="justify-content:space-between;margin-top:14px">
          <span class="hud-small">LEADERBOARD</span><button class="chip" data-act="refresh">Refresh</button></div>
        <table class="lb"><thead><tr><th>#</th><th>DRIVER</th><th>RATING</th><th>RANK</th><th>RACES</th></tr></thead>
          <tbody data-lb><tr><td colspan="5">Loading…</td></tr></tbody></table>
        <div class="row" style="margin-top:16px"><button class="btn small" data-act="back">Back</button></div>
      </div>`;
    const name = el.querySelector<HTMLInputElement>('[data-name]')!;
    name.addEventListener('change', () => { s.playerName = name.value.trim().slice(0, 16); this.commit(); });
    el.querySelector('[data-act=find]')!.addEventListener('click', () => {
      s.playerName = name.value.trim().slice(0, 16);
      this.commit();
      if (!s.playerName) { this.setNetStatus('Enter a driver name first.'); name.focus(); return; }
      this.h.sound('select');
      this.h.findMatch();
    });
    el.querySelector('[data-act=cancel]')!.addEventListener('click', () => { this.h.sound('back'); this.h.cancelMatch(); });
    el.querySelectorAll<HTMLElement>('[data-wait]').forEach((c) => c.addEventListener('click', () => {
      s.matchWait = +c.dataset.wait! as Settings['matchWait'];
      this.commit(); this.h.sound('select');
      el.querySelectorAll<HTMLElement>('[data-wait]').forEach((b) => b.classList.toggle('on', b === c));
    }));
    el.querySelector('[data-act=refresh]')!.addEventListener('click', () => { this.h.sound('select'); this.h.refreshLeaderboard(); });
    el.querySelector('[data-act=back]')!.addEventListener('click', () => { this.h.cancelMatch(); this.back(); });
    this.h.refreshLeaderboard();
  }

  setNetStatus(text: string, searching = false): void {
    const el = this.screens.get('netplay')!;
    const st = el.querySelector('[data-status]');
    if (st) st.textContent = text;
    const find = el.querySelector<HTMLElement>('[data-act=find]');
    const cancel = el.querySelector<HTMLElement>('[data-act=cancel]');
    if (find) find.style.display = searching ? 'none' : '';
    if (cancel) cancel.style.display = searching ? '' : 'none';
  }

  setLeaderboard(rows: LeaderRow[] | null, message?: string): void {
    const html = !rows || rows.length === 0
      ? `<tr><td colspan="5">${esc(message ?? 'No ranked drivers yet — race online to get on the board!')}</td></tr>`
      : rows.map((r) => `<tr class="${r.isMe ? 'me' : ''}"><td>${r.rank}</td><td>${esc(r.name)}</td><td>${r.rating}</td><td>${rankName(r.rating)}</td><td>${r.games}</td></tr>`).join('');
    for (const n of ['netplay', 'leaderboard'] as ScreenName[]) {
      const tb = this.screens.get(n)!.querySelector('[data-lb]');
      if (tb) tb.innerHTML = html;
    }
  }

  updateRating(): void {
    const el = this.screens.get('netplay')!;
    const set = (sel: string, v: string) => { const n = el.querySelector(sel); if (n) n.textContent = v; };
    set('[data-rating]', String(this.s.rating));
    set('[data-rank]', rankName(this.s.rating));
    set('[data-games]', String(this.s.games));
  }

  private renderOptions(): void {
    const el = this.screens.get('options')!;
    const s = this.s;
    el.innerHTML = `
      <div class="title">OPTIONS</div>
      <div class="panel" style="max-width:720px">
        ${(['master', 'music', 'sfx', 'ambience'] as const).map((k) => `
          <div class="row"><span class="label">${k === 'sfx' ? 'Effects' : k}</span>
          <input type="range" min="0" max="1" step="0.05" value="${s.volume[k]}" data-vol="${k}"></div>`).join('')}
        <div class="row" style="align-items:flex-start"><span class="label">Music</span>
          <div style="flex:1">
            <div class="row" style="margin:0 0 6px">
              <button class="chip ${s.music === 'auto' ? 'on' : ''}" data-music="auto">Auto (level)</button>
              <button class="chip ${s.music === 'shuffle' ? 'on' : ''}" data-music="shuffle">Shuffle</button>
              ${this.tracks.map((t) => `<button class="chip ${s.music === t.id ? 'on' : ''}" data-music="${t.id}" title="${esc(t.title)}">${esc(t.title.split(' — ')[0])}</button>`).join('')}
            </div>
            <div class="status" data-music-now>${this.musicText()}</div>
          </div></div>
        <div class="row" style="align-items:flex-start"><span class="label">Ambience</span>
          <div style="flex:1">
            <div class="row" style="margin:0 0 6px">
              <button class="chip ${s.ambience === 'auto' ? 'on' : ''}" data-amb="auto">Auto (level)</button>
              ${(Object.keys(AMBIENCE_LABELS) as AmbienceKind[]).map((k) => `<button class="chip ${s.ambience === k ? 'on' : ''}" data-amb="${k}" title="${esc(AMBIENCE_LABELS[k])}">${k === 'none' ? 'Off' : k}</button>`).join('')}
            </div>
            <div class="status" data-amb-now>${this.ambienceText()}</div>
          </div></div>
        <div class="row"><span class="label">Driving</span>
          <button class="chip ${s.driveMode === 'grip' ? 'on' : ''}" data-drive="grip">Grip</button>
          <button class="chip ${s.driveMode === 'drift' ? 'on' : ''}" data-drive="drift">Drift</button>
          <span style="font-family:Arial,sans-serif;font-size:12px;opacity:.8">${s.driveMode === 'drift'
            ? 'Steer hard + tap brake / SPACE at speed to slide; keep steering to hold the drift.'
            : 'Planted and precise. SPACE (handbrake) still kicks the tail out.'}</span></div>
        <div class="row"><span class="label">VHS look</span>
          <button class="chip ${s.vhs === true ? 'on' : ''}" data-vhs="1">On</button>
          <button class="chip ${s.vhs !== true ? 'on' : ''}" data-vhs="0">Off</button>
          <span style="font-family:Arial,sans-serif;font-size:12px;opacity:.8">80s videotape picture, and REWIND (R) in Quick Races — 3 per race. Not in Netplay or the Highway / Heat modes.</span></div>
        <div class="row"><span class="label">AI level</span>
          ${(['easy', 'normal', 'hard', 'impossible'] as const).map((d) => `<button class="chip ${d === (s.difficulty ?? 'normal') ? 'on' : ''}" data-diff="${d}">${d}</button>`).join('')}</div>
        <div class="row"><span class="label">Graphics</span>
          ${(['low', 'medium', 'high'] as const).map((q) => `<button class="chip ${q === s.quality ? 'on' : ''}" data-q="${q}">${q}</button>`).join('')}</div>
        <div class="row"><span class="label">Server</span><input type="text" value="${esc(s.serverUrl)}" data-server></div>
        <div class="row" style="margin-top:16px;justify-content:space-between">
          <button class="btn small" data-act="back">Back</button>
          <button class="chip" data-act="controls">Controls…</button></div>
      </div>
      <div class="popup" data-controls hidden>
        <div class="panel popup-panel">
          <div class="hud-small" style="margin-bottom:10px">CONTROLS</div>
          <div class="controls-list">
            <b>Keyboard</b>: ↑/W accelerate · ↓/S brake · ←→/A D steer · SPACE handbrake (drift) · ESC pause · C camera<br>
            <b>Gamepad</b>: RT/A accelerate · LT/B brake · stick/d-pad steer · X/RB handbrake · START pause<br>
            <b>Touch</b>: drag the circle — up/down = gas/brake, left/right = steer</div>
          <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn small" data-act="close-controls">Close</button></div>
        </div>
      </div>`;
    const pop = el.querySelector<HTMLElement>('[data-controls]')!;
    el.querySelector('[data-act=controls]')!.addEventListener('click', () => { this.h.sound('select'); pop.hidden = false; });
    const closePop = () => { this.h.sound('back'); pop.hidden = true; };
    el.querySelector('[data-act=close-controls]')!.addEventListener('click', closePop);
    pop.addEventListener('click', (e) => { if (e.target === pop) closePop(); });
    el.querySelectorAll<HTMLInputElement>('[data-vol]').forEach((r) => r.addEventListener('input', () => {
      s.volume[r.dataset.vol as 'master' | 'music' | 'sfx' | 'ambience'] = +r.value;
      this.commit();
      this.h.settingsChanged();
    }));
    el.querySelectorAll<HTMLElement>('[data-music]').forEach((c) => c.addEventListener('click', () => {
      s.music = c.dataset.music!;
      this.commit(); this.h.sound('select'); this.h.settingsChanged();
      window.setTimeout(() => this.renderOptions(), 300);
    }));
    el.querySelectorAll<HTMLElement>('[data-amb]').forEach((c) => c.addEventListener('click', () => {
      s.ambience = c.dataset.amb!;
      this.commit(); this.h.sound('select'); this.h.settingsChanged(); this.renderOptions();
    }));
    el.querySelectorAll<HTMLElement>('[data-drive]').forEach((c) => c.addEventListener('click', () => {
      s.driveMode = c.dataset.drive as Settings['driveMode'];
      this.commit(); this.h.sound('select'); this.renderOptions();
    }));
    el.querySelectorAll<HTMLElement>('[data-vhs]').forEach((c) => c.addEventListener('click', () => {
      s.vhs = c.dataset.vhs === '1';
      this.commit(); this.h.sound('select'); this.renderOptions();
    }));
    el.querySelectorAll<HTMLElement>('[data-diff]').forEach((c) => c.addEventListener('click', () => {
      s.difficulty = c.dataset.diff as Settings['difficulty'];
      this.commit(); this.h.sound('select'); this.renderOptions();
    }));
    el.querySelectorAll<HTMLElement>('[data-q]').forEach((c) => c.addEventListener('click', () => {
      s.quality = c.dataset.q as Settings['quality'];
      this.commit(); this.h.sound('select'); this.h.settingsChanged(); this.renderOptions();
    }));
    const srv = el.querySelector<HTMLInputElement>('[data-server]')!;
    srv.addEventListener('change', () => { s.serverUrl = srv.value.trim(); this.commit(); });
    el.querySelector('[data-act=back]')!.addEventListener('click', () => this.back());
  }

  showPause(online = false): void {
    const el = this.screens.get('pause')!;
    el.innerHTML = `
      <div class="title" style="margin-top:20vh">${online ? 'ONLINE RACE' : 'PAUSED'}</div>
      ${online ? '<div class="status" style="text-align:center">The race keeps going — leaving counts as DNF.</div>' : ''}
      <div class="menu-list" style="margin-top:2vh">
        <button class="btn primary" data-act="resume">Resume</button>
        ${online ? '' : '<button class="btn" data-act="restart">Restart</button>'}
        <button class="btn" data-act="options">Options</button>
        <button class="btn" data-act="quit">${online ? 'Leave Race' : 'Quit to Menu'}</button>
      </div>`;
    el.querySelector('[data-act=resume]')!.addEventListener('click', () => { this.h.sound('select'); this.h.resume(); });
    el.querySelector('[data-act=restart]')?.addEventListener('click', () => { this.h.sound('select'); this.h.restart(); });
    el.querySelector('[data-act=options]')!.addEventListener('click', () => { this.h.sound('select'); this.show('options'); });
    el.querySelector('[data-act=quit]')!.addEventListener('click', () => { this.h.sound('back'); this.h.quitToMenu(); });
    this.history = [];
    this.show('pause', false);
  }

  showResults(rows: ResultRow[], extra = '', againLabel = 'Race Again', headline?: string, timeLabel = 'TIME'): void {
    const el = this.screens.get('results')!;
    const me = rows.find((r) => r.isPlayer);
    const head = headline ?? (me?.pos === 1 ? 'YOU WIN!' : `FINISHED P${me?.pos ?? '-'}`);
    el.innerHTML = `
      <div class="title" style="margin-top:12vh">${head}</div>
      <div class="panel" style="max-width:560px">
        <table class="lb"><thead><tr><th>POS</th><th>DRIVER</th><th>${timeLabel}</th></tr></thead><tbody>
          ${rows.map((r) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.pos}</td><td>${esc(r.name)}</td><td>${r.time}</td></tr>`).join('')}
        </tbody></table>
        ${extra ? `<div class="status">${extra}</div>` : ''}
        <div class="row" style="justify-content:space-between;margin-top:16px">
          <button class="btn small" data-act="menu">Menu</button>
          <button class="btn primary" data-act="again">${esc(againLabel)}</button>
        </div>
      </div>`;
    el.querySelector('[data-act=menu]')!.addEventListener('click', () => { this.h.sound('back'); this.h.quitToMenu(); });
    el.querySelector('[data-act=again]')!.addEventListener('click', () => { this.h.sound('select'); this.h.restart(); });
    this.history = [];
    this.show('results', false);
  }

  showLoading(text: string): void {
    const el = this.screens.get('loading')!;
    el.innerHTML = `<div class="title" style="margin-top:40vh">LOADING</div><div class="status">${esc(text)}</div>`;
    this.show('loading', false);
  }

  private tracks: TrackInfo[] = [];

  private musicText(): string {
    const m = this.h.musicInfo();
    const title = (id: string) => this.tracks.find((t) => t.id === id)?.title ?? id;
    const src = this.s.music === 'auto' ? `level track for ${m.levelName}` : this.s.music === 'shuffle' ? 'shuffle' : 'chosen by you';
    return m.current ? `♪ Now playing: ${title(m.current)} (${src})` : '♪ Music starts after the first key press.';
  }

  /** Refresh the music "now playing" line if Options is open. */
  refreshMusic(): void {
    const n = this.screens.get('options')!.querySelector('[data-music-now]');
    if (n) n.textContent = this.musicText();
  }

  private ambienceText(): string {
    const a = this.h.ambienceInfo();
    const src = this.s.ambience === 'auto' ? `level default for ${a.levelName}` : `chosen by you · ${a.levelName} default: ${AMBIENCE_LABELS[a.levelDefault]}`;
    return `♪ Now playing: ${AMBIENCE_LABELS[a.current]} (${src})`;
  }

  /** Refresh the "now playing" line if Options is open. */
  refreshAmbience(): void {
    const n = this.screens.get('options')!.querySelector('[data-amb-now]');
    if (n) n.textContent = this.ambienceText();
  }

  private toastTimer = 0;
  /** Small notification in the top-right corner. */
  toast(text: string): void {
    let t = this.root.querySelector<HTMLDivElement>('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      this.root.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t!.classList.remove('show'), 3200);
  }

  private nowPlaying: HTMLDivElement | null = null;
  /** Persistent "now playing" panel on the right (music + ambience). */
  setNowPlaying(music: string, ambience: string, inRace: boolean): void {
    if (!this.nowPlaying) {
      this.nowPlaying = document.createElement('div');
      this.nowPlaying.className = 'now-playing';
      this.root.appendChild(this.nowPlaying);
    }
    this.nowPlaying.classList.toggle('compact', inRace);
    this.nowPlaying.innerHTML = `<div class="np-title">NOW PLAYING</div><div>♪ ${esc(music)}</div><div>≋ ${esc(ambience)}</div>`;
  }

  /** First user gesture: audio is unlocked, reveal the main menu buttons. */
  unlockStart(): void {
    const main = this.screens.get('main')!;
    if (!main.classList.contains('locked')) return;
    main.classList.remove('locked');
    // Focus after the unlocking key press is done, so that key doesn't also click the button.
    if (this.current === 'main') window.setTimeout(() => main.querySelector<HTMLElement>('.btn')?.focus({ preventScroll: true }), 0);
  }

  private commit(): void {
    saveSettings(this.s);
  }

  /** Keyboard / gamepad-style navigation between focusable elements of the active screen. */
  private onKey(e: KeyboardEvent): void {
    if (!this.open || this.current === 'loading') return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' && e.key !== 'Escape') return;
    const el = this.screens.get(this.current)!;
    const items = Array.from(el.querySelectorAll<HTMLElement>('.btn, .chip, .card:not(.locked), .car-card, .swatch'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      items[(i + 1) % items.length]?.focus();
      this.h.sound('hover');
      e.preventDefault();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      items[(i - 1 + items.length) % items.length]?.focus();
      this.h.sound('hover');
      e.preventDefault();
    } else if (e.key === 'Enter' && i >= 0 && !items[i].matches('button')) {
      items[i].click();
    } else if (e.key === 'Escape' || e.key === 'Backspace') {
      if (this.current === 'pause') this.h.resume();
      else if (this.current === 'results') this.h.quitToMenu();
      else if (this.current !== 'main') this.back();
      e.preventDefault();
    }
  }
}
