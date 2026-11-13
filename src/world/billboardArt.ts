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
  canvas.width = CELL_W * ATLAS_COLS;
  canvas.height = CELL_H * ATLAS_ROWS;
  const ctx = canvas.getContext('2d')!;
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

const ALL: Record<string, (ctx: Ctx) => void> = { ...BASE, ...PINUP };

/** Look up designs by name. */
export function designs(...names: string[]): BillboardDesign[] {
  return names.filter((n) => ALL[n]).map((n) => ({ name: n, draw: ALL[n] }));
}
