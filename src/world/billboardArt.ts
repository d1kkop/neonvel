import { drawFigure, LOOKS } from './pinupArt';

/**
 * Procedural billboard artwork drawn into a canvas atlas (4 x 4 cells of 512x256).
 * Each level picks up to 16 designs. Custom images listed in /billboards/manifest.json replace cells in order.
 */
export interface BillboardDesign {
  name: string;
  draw: (ctx: CanvasRenderingContext2D) => void;
}
export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 4;
export const CELL_W = 512;
export const CELL_H = 256;
/** Atlas supersampling: designs draw in CELL_W × CELL_H units, stored at this many pixels per unit. */
export const ATLAS_SCALE = 2;

type Ctx = CanvasRenderingContext2D;

function neonText(ctx: Ctx, text: string, x: number, y: number, size: number, color: string, font = 'bold', family = 'Arial Black, Impact, sans-serif'): void {
  ctx.save();
  ctx.font = `${font} ${size}px ${family}`;
  // Shrink to fit: the text must stay inside the poster on both sides of its centre.
  const maxW = 2 * Math.min(x, CELL_W - x) - 24;
  const w = ctx.measureText(text).width + size * 0.2; // + glow stroke
  if (w > maxW && maxW > 0) {
    size = Math.floor((size * maxW) / w);
    ctx.font = `${font} ${size}px ${family}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  for (const blur of [30, 15, 6]) {
    ctx.shadowBlur = blur;
    ctx.strokeStyle = color;
    ctx.lineWidth = size / 10;
    ctx.strokeText(text, x, y);
  }
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function sunsetBg(ctx: Ctx, top: string, bottom: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, CELL_H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CELL_W, CELL_H);
}

function stripedSun(ctx: Ctx, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  g.addColorStop(0, '#fff36b');
  g.addColorStop(1, '#ff2a9a');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) {
    const y = cy + i * r * 0.16;
    ctx.fillRect(cx - r, y, r * 2, 2 + i * 1.6);
  }
  ctx.restore();
}

function palm(ctx: Ctx, x: number, baseY: number, h: number, lean: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = h * 0.05;
  ctx.lineCap = 'round';
  const topX = x + lean;
  const topY = baseY - h;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x + lean * 0.2, baseY - h * 0.5, topX, topY);
  ctx.stroke();
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI + (i / 6) * Math.PI + (i % 2) * 0.15;
    const len = h * 0.45;
    ctx.lineWidth = h * 0.035;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(topX + Math.cos(a) * len * 0.6, topY + Math.sin(a) * len * 0.5 - h * 0.08, topX + Math.cos(a) * len, topY + Math.sin(a) * len * 0.4 + h * 0.12);
    ctx.stroke();
  }
  ctx.restore();
}

function grid(ctx: Ctx, horizon: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  for (let i = -12; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(CELL_W / 2 + i * 12, horizon);
    ctx.lineTo(CELL_W / 2 + i * 90, CELL_H);
    ctx.stroke();
  }
  for (let j = 1; j < 9; j++) {
    const y = horizon + Math.pow(j / 8, 2) * (CELL_H - horizon);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CELL_W, y);
    ctx.stroke();
  }
  ctx.restore();
}

const BASE: Record<string, (ctx: Ctx) => void> = {
  neonNights: (ctx) => {
    sunsetBg(ctx, '#1a0233', '#ff2a7a');
    stripedSun(ctx, 256, 170, 90);
    palm(ctx, 70, 256, 170, 30, '#12001f');
    palm(ctx, 450, 256, 150, -25, '#12001f');
    neonText(ctx, 'NEON NIGHTS', 256, 70, 58, '#00e5ff');
  },
  turboCola: (ctx) => {
    ctx.fillStyle = '#12000a';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * CELL_W, Math.random() * CELL_H, 2 + Math.random() * 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,80,100,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // bottle
    ctx.save();
    ctx.translate(400, 128);
    ctx.fillStyle = '#ff2040';
    ctx.shadowColor = '#ff2040';
    ctx.shadowBlur = 25;
    ctx.beginPath();
    ctx.moveTo(-12, -100); ctx.lineTo(12, -100); ctx.lineTo(14, -60);
    ctx.quadraticCurveTo(40, -30, 36, 20); ctx.lineTo(36, 100); ctx.lineTo(-36, 100); ctx.lineTo(-36, 20);
    ctx.quadraticCurveTo(-40, -30, -14, -60); ctx.closePath();
    ctx.fill();
    ctx.restore();
    neonText(ctx, 'TURBO', 190, 90, 72, '#ff2040');
    neonText(ctx, 'COLA', 190, 170, 72, '#ffffff');
  },
  overdrive: (ctx) => {
    sunsetBg(ctx, '#05010f', '#2a0a4a');
    grid(ctx, 150, '#ff2bd6');
    ctx.save();
    ctx.font = 'italic 900 84px Arial Black, Impact, sans-serif';
    ctx.textAlign = 'center';
    const g = ctx.createLinearGradient(0, 50, 0, 130);
    g.addColorStop(0, '#e8f6ff');
    g.addColorStop(0.5, '#4d7cff');
    g.addColorStop(0.52, '#1a0a3a');
    g.addColorStop(1, '#ff8ad8');
    ctx.fillStyle = g;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 20;
    ctx.fillText('OVERDRIVE', 256, 120);
    ctx.restore();
  },
  miami2084: (ctx) => {
    sunsetBg(ctx, '#00353f', '#ff4fa8');
    stripedSun(ctx, 380, 150, 70);
    palm(ctx, 330, 256, 140, 20, '#001018');
    palm(ctx, 470, 256, 190, -35, '#001018');
    neonText(ctx, 'MIAMI', 160, 95, 70, '#ff4fa8', 'italic bold', 'Brush Script MT, cursive');
    neonText(ctx, '2084', 160, 175, 64, '#00e5ff');
  },
  synthFm: (ctx) => {
    ctx.fillStyle = '#0a0018';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    ctx.save();
    ctx.strokeStyle = '#3dff9e';
    ctx.shadowColor = '#3dff9e';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = 0; x <= CELL_W; x += 4) {
      const y = 190 + Math.sin(x * 0.05) * 25 * Math.sin(x * 0.011) + Math.sin(x * 0.21) * 8;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    neonText(ctx, 'SYNTH FM', 256, 70, 68, '#a64dff');
    neonText(ctx, '88.4', 256, 130, 40, '#3dff9e');
  },
  driveFast: (ctx) => {
    sunsetBg(ctx, '#140022', '#3a0050');
    ctx.save();
    ctx.fillStyle = '#ffb000';
    ctx.shadowColor = '#ffb000';
    ctx.shadowBlur = 20;
    for (let i = 0; i < 3; i++) {
      const x = 360 + i * 45;
      ctx.beginPath();
      ctx.moveTo(x, 90); ctx.lineTo(x + 35, 128); ctx.lineTo(x, 166); ctx.lineTo(x + 15, 128);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    neonText(ctx, 'DRIVE FAST', 190, 95, 52, '#ffb000');
    neonText(ctx, 'LIVE FOREVER', 190, 165, 36, '#ff2bd6');
  },
  hotelParadise: (ctx) => {
    ctx.fillStyle = '#05000c';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random()})`;
      ctx.fillRect(Math.random() * CELL_W, Math.random() * CELL_H, 2, 2);
    }
    neonText(ctx, 'Hotel', 256, 80, 70, '#ff2bd6', 'italic bold', 'Brush Script MT, cursive');
    neonText(ctx, 'PARADISE', 256, 165, 64, '#00e5ff');
    neonText(ctx, '★ ★ ★ ★ ★', 256, 225, 26, '#ffb000');
  },
  cyberBeach: (ctx) => {
    sunsetBg(ctx, '#2a0a4a', '#ff7a3c');
    stripedSun(ctx, 256, 175, 80);
    ctx.fillStyle = '#1a0630';
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = 0.7 - i * 0.12;
      ctx.beginPath();
      ctx.moveTo(0, 200 + i * 14);
      for (let x = 0; x <= CELL_W; x += 16) ctx.lineTo(x, 200 + i * 14 + Math.sin(x * 0.04 + i) * 4);
      ctx.lineTo(CELL_W, CELL_H); ctx.lineTo(0, CELL_H);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    palm(ctx, 60, 256, 200, 40, '#120020');
    neonText(ctx, 'CYBER BEACH', 280, 60, 54, '#ffe14d');
  },
};

export function drawAtlas(designs: BillboardDesign[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * ATLAS_COLS * ATLAS_SCALE;
  canvas.height = CELL_H * ATLAS_ROWS * ATLAS_SCALE;
  const ctx = canvas.getContext('2d')!;
  // Designs draw in CELL units; the canvas stores them ATLAS_SCALE× sharper. Shadow blur ignores the
  // transform, so scale it here too (keeps every glow the same size as designed).
  ctx.scale(ATLAS_SCALE, ATLAS_SCALE);
  const blur = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'shadowBlur')!;
  Object.defineProperty(ctx, 'shadowBlur', {
    get() { return blur.get!.call(this) / ATLAS_SCALE; },
    set(v: number) { blur.set!.call(this, v * ATLAS_SCALE); },
  });
  designs.slice(0, ATLAS_COLS * ATLAS_ROWS).forEach(({ draw }, i) => {
    const cx = (i % ATLAS_COLS) * CELL_W;
    const cy = Math.floor(i / ATLAS_COLS) * CELL_H;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.rect(0, 0, CELL_W, CELL_H);
    ctx.clip();
    draw(ctx);
    ctx.restore();
  });
  return canvas;
}

/** Draw an image into atlas cell `i` (cover-fit). */
export function drawImageIntoCell(canvas: HTMLCanvasElement, img: HTMLImageElement, i: number): void {
  const ctx = canvas.getContext('2d')!;
  const cx = (i % ATLAS_COLS) * CELL_W;
  const cy = Math.floor(i / ATLAS_COLS) * CELL_H;
  const s = Math.max(CELL_W / img.width, CELL_H / img.height);
  const w = img.width * s;
  const h = img.height * s;
  ctx.save();
  ctx.setTransform(ATLAS_SCALE, 0, 0, ATLAS_SCALE, 0, 0);
  ctx.beginPath();
  ctx.rect(cx, cy, CELL_W, CELL_H);
  ctx.clip();
  ctx.drawImage(img, cx + (CELL_W - w) / 2, cy + (CELL_H - h) / 2, w, h);
  ctx.restore();
}

// ------------------------------------------------------------------ pin-up posters

function sunsetSea(ctx: Ctx, sky: [string, string], sunY = 150, sunX = 150): void {
  sunsetBg(ctx, sky[0], sky[1]);
  stripedSun(ctx, sunX, sunY, 70);
  // Sea with sun glitter.
  const g = ctx.createLinearGradient(0, 190, 0, CELL_H);
  g.addColorStop(0, '#2a1060');
  g.addColorStop(1, '#0a0420');
  ctx.fillStyle = g;
  ctx.fillRect(0, 190, CELL_W, CELL_H - 190);
  ctx.fillStyle = 'rgba(255,200,120,0.6)';
  for (let i = 0; i < 14; i++) ctx.fillRect(sunX - 40 + Math.sin(i * 7.3) * 25, 195 + i * 4.5, 80 - i * 4, 2);
}

const PINUP: Record<string, (ctx: Ctx) => void> = {
  miamiHeat: (ctx) => {
    sunsetSea(ctx, ['#3a0a5a', '#ff6a3c'], 150, 170);
    palm(ctx, 40, 256, 200, 30, '#1a0420');
    drawFigure(ctx, 400, 252, 236, { ...LOOKS.sunsetBlonde, pose: 'hip' });
    neonText(ctx, 'MIAMI', 200, 70, 66, '#ff2bd6', 'italic bold', 'Brush Script MT, cursive');
    neonText(ctx, 'HEAT WAVE', 200, 135, 40, '#ffe14d');
  },
  sunsetClub: (ctx) => {
    sunsetSea(ctx, ['#14063a', '#ff3c8e'], 140, 256);
    palm(ctx, 470, 256, 210, -35, '#12001f');
    drawFigure(ctx, 110, 252, 226, { ...LOOKS.sunsetBrunette, pose: 'wave' });
    drawFigure(ctx, 190, 252, 232, { ...LOOKS.sunsetRed, pose: 'lean' });
    neonText(ctx, 'SUNSET', 360, 70, 54, '#00e5ff');
    neonText(ctx, 'BEACH CLUB', 360, 125, 34, '#ff2bd6');
  },
  coconutTan: (ctx) => {
    sunsetBg(ctx, '#ffb36b', '#ff4f7a');
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.arc(80 + i * 40, 128 + Math.sin(i) * 60, 30, 0, Math.PI * 2);
      ctx.fill();
    }
    drawFigure(ctx, 130, 252, 236, { ...LOOKS.sunsetDark, pose: 'lean' });
    neonText(ctx, 'COCONUT', 350, 80, 58, '#7a2a00');
    neonText(ctx, 'TAN OIL', 350, 140, 46, '#ff6a00');
    neonText(ctx, 'SPF 4 · GOLDEN GLOW', 350, 200, 20, '#ffe14d');
  },
  surfParadise: (ctx) => {
    sunsetSea(ctx, ['#00405a', '#ff8a5c'], 130, 120);
    // Wave curl.
    ctx.fillStyle = '#1a5aa0';
    ctx.beginPath();
    ctx.moveTo(0, 210);
    ctx.bezierCurveTo(120, 150, 220, 170, 300, 215);
    ctx.lineTo(300, 256); ctx.lineTo(0, 256);
    ctx.fill();
    drawFigure(ctx, 390, 252, 236, { ...LOOKS.sunsetBlonde, pose: 'surf', surfboard: '#ff2bd6', suit: '#ff6a00' });
    neonText(ctx, "SURF'S UP", 170, 70, 52, '#ffe14d');
    neonText(ctx, 'PARADISE BAY', 170, 120, 30, '#00e5ff');
  },
  palmFm: (ctx) => {
    ctx.fillStyle = '#07010f';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    grid(ctx, 175, '#ff2bd6');
    drawFigure(ctx, 120, 250, 232, { ...LOOKS.neonPink, pose: 'hip' });
    neonText(ctx, 'PALM COAST', 340, 80, 46, '#00e5ff');
    neonText(ctx, '99.1 FM', 340, 140, 52, '#ff2bd6');
  },
  summer86: (ctx) => {
    sunsetBg(ctx, '#00c8d8', '#ff5fb0');
    grid(ctx, 180, '#ffffff');
    drawFigure(ctx, 380, 252, 236, { ...LOOKS.sunsetRed, pose: 'wave', suit: '#3dff9e' });
    neonText(ctx, "SUMMER '86", 175, 95, 58, '#ff2bd6');
    neonText(ctx, 'ENDLESS NIGHTS', 175, 155, 26, '#a64dff');
  },
  tropicNights: (ctx) => {
    sunsetBg(ctx, '#05010f', '#2a0a4a');
    stripedSun(ctx, 256, 170, 80);
    palm(ctx, 60, 256, 200, 30, '#000000');
    palm(ctx, 460, 256, 180, -30, '#000000');
    drawFigure(ctx, 200, 252, 226, { ...LOOKS.neonCyan, pose: 'lean' });
    drawFigure(ctx, 315, 252, 234, { ...LOOKS.neonPink, pose: 'hip', flip: true });
    neonText(ctx, 'TROPIC NIGHTS', 256, 40, 40, '#ffe14d');
  },
  bikiniBar: (ctx) => {
    sunsetBg(ctx, '#2a0040', '#a0206a');
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `hsla(${(i * 37) % 360},100%,60%,0.6)`;
      ctx.beginPath();
      ctx.arc((i * 97) % CELL_W, (i * 53) % 120, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    drawFigure(ctx, 400, 252, 236, { ...LOOKS.sunsetBrunette, pose: 'hip', suitStyle: 'bikini', suit: '#ffe14d' });
    neonText(ctx, 'COCKTAILS', 190, 80, 50, '#3dff9e');
    neonText(ctx, 'LIVE DJ · 24/7', 190, 140, 30, '#ff2bd6');
  },
};

/** Deterministic 0..1 noise for poster details (same picture every time). */
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const CODE_GLYPHS = '0123456789ABCDEF{}<>[]/\\;:=+*#$%&@!?';

/** Falling green code columns (bright head, fading tail), dimmer where `mask` returns a small value. */
function codeRain(ctx: Ctx, seed: number, color = '#3dff9e', mask?: (x: number, y: number) => number): void {
  ctx.save();
  ctx.font = 'bold 13px Consolas, "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cols = 42, rows = 19;
  for (let c = 0; c < cols; c++) {
    const x = (c + 0.5) * (CELL_W / cols);
    const head = Math.floor(rnd(seed + c * 3.1) * (rows + 8));
    const len = 5 + Math.floor(rnd(seed + c * 7.7) * 11);
    for (let r = 0; r < rows; r++) {
      const d = head - r;
      if (d < 0 || d > len) continue;
      const y = (r + 0.5) * (CELL_H / rows);
      const k = (1 - d / len) * (mask ? mask(x, y) : 1);
      if (k < 0.04) continue;
      ctx.globalAlpha = Math.min(1, k);
      ctx.fillStyle = d === 0 ? '#eafff4' : color;
      ctx.shadowColor = color;
      ctx.shadowBlur = d === 0 ? 10 : 3;
      ctx.fillText(CODE_GLYPHS[Math.floor(rnd(seed + c * 13.3 + r * 5.9) * CODE_GLYPHS.length)], x, y);
    }
  }
  ctx.restore();
}

function monoText(ctx: Ctx, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', glow = 8): void {
  ctx.save();
  ctx.font = `bold ${size}px Consolas, "Courier New", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Toy-horse silhouette on a wheeled platform (the wooden gift horse), about w wide, standing on baseY. */
function giftHorse(ctx: Ctx, x: number, baseY: number, w: number, fill: string, stroke: string): void {
  const u = w / 100;
  ctx.save();
  ctx.translate(x, baseY);
  ctx.scale(u, u);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.2;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.shadowColor = stroke;
  ctx.shadowBlur = 10;
  const shape = (pts: number[]) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  shape([-48, -12, 48, -12, 48, -6, -48, -6]);                                   // platform
  for (const wx of [-34, 34]) {                                                  // wheels
    ctx.beginPath(); ctx.arc(wx, -4, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(wx, -4, 2, 0, Math.PI * 2); ctx.stroke();
  }
  for (const lx of [-30, -18, 14, 26]) shape([lx - 4, -52, lx + 4, -52, lx + 3, -12, lx - 3, -12]); // legs
  shape([-38, -78, 28, -78, 34, -64, 30, -50, -34, -50, -40, -62]);              // barrel body
  shape([14, -78, 30, -112, 44, -118, 40, -100, 34, -74]);                       // neck
  shape([28, -120, 44, -124, 62, -106, 60, -98, 44, -100, 32, -106]);            // head
  shape([32, -122, 36, -134, 40, -122]);                                         // ear
  shape([-38, -76, -52, -70, -56, -48, -48, -52, -44, -66]);                     // tail
  for (let i = 0; i < 5; i++) shape([16 + i * 3, -84 - i * 6, 10 + i * 3, -80 - i * 6, 14 + i * 3, -74 - i * 6]); // mane
  // Planks and the hatch in its belly.
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-36 + i * 14, -78); ctx.lineTo(-34 + i * 14, -50); ctx.stroke(); }
  ctx.strokeRect(-12, -70, 16, 14);
  ctx.restore();
}

/** Segmented worm crawling along a sine wave, with spikes and a toothy head. */
function codeWorm(ctx: Ctx, x0: number, x1: number, y: number, amp: number, color: string): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  const n = 15;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = x0 + (x1 - x0) * t, yy = y + Math.sin(t * Math.PI * 2.6) * amp;
    const r = 7 + 9 * Math.sin(Math.PI * (0.15 + t * 0.8));
    ctx.fillStyle = i % 2 ? color : '#0a0a0a';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, yy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x, yy + sd * r); ctx.lineTo(x - 3, yy + sd * (r + 7)); ctx.stroke(); }
    if (i === n - 1) {
      ctx.fillStyle = '#ffffff';
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(x + 4, yy + sd * 5, 2.6, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.moveTo(x + r, yy - 6); ctx.lineTo(x + r + 9, yy - 2); ctx.moveTo(x + r, yy + 6); ctx.lineTo(x + r + 9, yy + 2); ctx.stroke();
    }
  }
  ctx.restore();
}

const EXTRA: Record<string, (ctx: Ctx) => void> = {
  // Desert roadhouse that never closes at night.
  duskTillDawn: (ctx) => {
    sunsetBg(ctx, '#12031f', '#c8401c');
    // Low sun on the horizon, desert floor, mesa silhouettes.
    const sun = ctx.createRadialGradient(120, 196, 4, 120, 196, 90);
    sun.addColorStop(0, '#fff2a8'); sun.addColorStop(0.35, '#ff8a2a'); sun.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 100, 260, 160);
    ctx.fillStyle = '#12050f';
    ctx.beginPath();
    ctx.moveTo(0, 256); ctx.lineTo(0, 205); ctx.lineTo(40, 205); ctx.lineTo(48, 170); ctx.lineTo(96, 170); ctx.lineTo(104, 205);
    ctx.lineTo(190, 205); ctx.lineTo(196, 186); ctx.lineTo(228, 186); ctx.lineTo(234, 205); ctx.lineTo(512, 205); ctx.lineTo(512, 256);
    ctx.fill();
    // Saguaro.
    ctx.strokeStyle = '#12050f'; ctx.lineCap = 'round'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(148, 208); ctx.lineTo(148, 150); ctx.moveTo(148, 186); ctx.lineTo(134, 186); ctx.lineTo(134, 168); ctx.moveTo(148, 176); ctx.lineTo(162, 176); ctx.lineTo(162, 160); ctx.stroke();
    // The bar: a low shack with lit windows and a roof sign.
    ctx.fillStyle = '#1c0a14';
    ctx.fillRect(300, 168, 190, 46);
    ctx.fillStyle = '#ffb040'; ctx.shadowColor = '#ff8a20'; ctx.shadowBlur = 14;
    for (const wx of [314, 352, 428, 460]) ctx.fillRect(wx, 182, 20, 16);
    ctx.fillStyle = '#ff5a1c'; ctx.fillRect(390, 180, 22, 34);
    ctx.shadowBlur = 0;
    // Bats leaving at sundown.
    ctx.fillStyle = '#0c0410';
    for (let i = 0; i < 7; i++) {
      const bx = 250 + i * 34 + rnd(i) * 14, by = 118 + rnd(i + 9) * 34, bs = 5 + rnd(i + 3) * 4;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx - bs, by - bs, bx - bs * 2, by); ctx.quadraticCurveTo(bx - bs, by - bs * 0.3, bx, by + bs * 0.5);
      ctx.quadraticCurveTo(bx + bs, by - bs * 0.3, bx + bs * 2, by); ctx.quadraticCurveTo(bx + bs, by - bs, bx, by); ctx.fill();
    }
    neonText(ctx, 'FROM DUSK', 256, 44, 46, '#ff3a2a');
    neonText(ctx, 'TILL DAWN', 256, 96, 52, '#ffb000');
    neonText(ctx, 'ROADHOUSE · OPEN ALL NIGHT', 256, 238, 17, '#3dff9e');
  },
  // Cyber Grid: falling code with a prompt.
  matrixCode: (ctx) => {
    ctx.fillStyle = '#000603';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    codeRain(ctx, 11, '#3dff9e', (x, y) => (Math.abs(y - 128) < 58 && Math.abs(x - 256) < 215 ? 0.22 : 1));
    neonText(ctx, 'H4CK THE GRID', 256, 108, 54, '#3dff9e', 'bold', 'Consolas, "Courier New", monospace');
    monoText(ctx, '> access granted_', 256, 160, 22, '#b8ffd8', 'center');
  },
  // Cyber Grid: the leaderboard of the underground.
  hackerRanking: (ctx) => {
    ctx.fillStyle = '#010a06';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    codeRain(ctx, 47, '#1f9a5c', () => 0.35);
    ctx.strokeStyle = '#3dff9e'; ctx.lineWidth = 2; ctx.shadowColor = '#3dff9e'; ctx.shadowBlur = 10;
    ctx.strokeRect(14, 12, CELL_W - 28, CELL_H - 24);
    ctx.shadowBlur = 0;
    monoText(ctx, 'HACKER RANKING', 256, 36, 30, '#eafff4', 'center', 12);
    const rows: [string, string, string][] = [['01', 'ZER0_DAY', '9 999 999'], ['02', 'N1GHT.SH4DE', '8 404 200'], ['03', 'ROOTKIT_RITA', '7 310 048'], ['04', 'NULL_PTR', '6 660 001'], ['05', 'YOU?', '0 000 000']];
    rows.forEach(([n, name, score], i) => {
      const y = 78 + i * 33;
      const col = i === 0 ? '#ffe14d' : i === rows.length - 1 ? '#ff2bd6' : '#3dff9e';
      monoText(ctx, '#' + n, 34, y, 24, col);
      monoText(ctx, name, 92, y, 24, col);
      monoText(ctx, score, CELL_W - 34, y, 24, col, 'right');
      ctx.fillStyle = 'rgba(61,255,158,0.25)';
      ctx.fillRect(34, y + 15, CELL_W - 68, 1);
    });
  },
  // Cyber Grid: the worm is loose.
  virusAlert: (ctx) => {
    ctx.fillStyle = '#0c0002';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    codeRain(ctx, 83, '#ff2a4a', () => 0.4);
    // Hazard stripes top and bottom.
    for (const y of [0, CELL_H - 16]) for (let i = -1; i < 20; i++) {
      ctx.fillStyle = i % 2 ? '#ffe14d' : '#1a1a00';
      ctx.beginPath(); ctx.moveTo(i * 28, y + 16); ctx.lineTo(i * 28 + 14, y); ctx.lineTo(i * 28 + 42, y); ctx.lineTo(i * 28 + 28, y + 16); ctx.fill();
    }
    neonText(ctx, 'VIRUS DETECTED', 256, 58, 44, '#ff2a4a', 'bold', 'Consolas, "Courier New", monospace');
    codeWorm(ctx, 60, 440, 128, 16, '#3dff9e');
    monoText(ctx, 'WORM.EXE  INFECTING…', 60, 186, 20, '#ffe14d');
    ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2; ctx.strokeRect(60, 204, 392, 18);
    ctx.fillStyle = '#ff2a4a'; ctx.shadowColor = '#ff2a4a'; ctx.shadowBlur = 10; ctx.fillRect(63, 207, 386 * 0.87, 12);
    ctx.shadowBlur = 0;
    monoText(ctx, '87%', 440, 186, 20, '#ffe14d', 'right');
  },
  // Cyber Grid: a present for your system.
  trojanExe: (ctx) => {
    ctx.fillStyle = '#02040c';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    codeRain(ctx, 29, '#1f8a9a', () => 0.4);
    grid(ctx, 196, '#00e5ff');
    giftHorse(ctx, 132, 214, 150, '#061018', '#00e5ff');
    neonText(ctx, 'TROJAN.EXE', 356, 70, 44, '#00e5ff', 'bold', 'Consolas, "Courier New", monospace');
    monoText(ctx, 'a gift for your system', 356, 116, 18, '#b8f4ff', 'center');
    // Fake "open" button.
    ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 2; ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 12;
    ctx.strokeRect(286, 144, 140, 34);
    ctx.shadowBlur = 0;
    monoText(ctx, '[ OPEN ]', 356, 162, 22, '#ff2bd6', 'center');
  },
};

const ALL: Record<string, (ctx: Ctx) => void> = { ...BASE, ...PINUP, ...EXTRA };

/** Look up designs by name. */
export function designs(...names: string[]): BillboardDesign[] {
  return names.filter((n) => ALL[n]).map((n) => ({ name: n, draw: ALL[n] }));
}
