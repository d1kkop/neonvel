/**
 * Procedural 80s pin-up poster figures, drawn entirely with canvas paths (no external images).
 * A figure is a pose skeleton (joints in "figure units": y 0 = top of head, 1 = feet; x 0 = centre)
 * rendered as tapered limbs + an hourglass torso, with hair, swimsuit and sunglasses on top.
 */

type P = [number, number];
type Ctx = CanvasRenderingContext2D;

export interface Pose {
  head: P;
  tilt: number; // head tilt (radians)
  shoulderL: P; shoulderR: P;
  elbowL: P; elbowR: P;
  handL: P; handR: P;
  hipShift: number; // hips sway (+ = right)
  kneeL: P; kneeR: P;
  footL: P; footR: P;
  /** Which arm / leg is drawn behind the torso. */
  backArm: 'L' | 'R';
  backLeg: 'L' | 'R';
}

export const POSES: Record<string, Pose> = {
  hip: {
    head: [0.01, 0.065], tilt: 0.12,
    shoulderL: [-0.085, 0.165], shoulderR: [0.085, 0.17],
    elbowL: [-0.12, 0.06], handL: [-0.03, 0.025],
    elbowR: [0.165, 0.3], handR: [0.115, 0.415],
    hipShift: 0.03,
    kneeL: [0.0, 0.7], footL: [-0.05, 0.975],
    kneeR: [0.075, 0.71], footR: [0.07, 0.975],
    backArm: 'L', backLeg: 'R',
  },
  wave: {
    head: [-0.005, 0.065], tilt: -0.08,
    shoulderL: [-0.085, 0.168], shoulderR: [0.085, 0.165],
    elbowL: [-0.15, 0.15], handL: [-0.17, 0.02],
    elbowR: [0.11, 0.3], handR: [0.12, 0.43],
    hipShift: -0.025,
    kneeL: [-0.075, 0.71], footL: [-0.075, 0.975],
    kneeR: [0.01, 0.7], footR: [0.06, 0.975],
    backArm: 'R', backLeg: 'L',
  },
  lean: {
    head: [0.0, 0.07], tilt: 0.05,
    shoulderL: [-0.088, 0.17], shoulderR: [0.088, 0.17],
    elbowL: [-0.16, 0.08], handL: [-0.035, 0.03],
    elbowR: [0.16, 0.08], handR: [0.035, 0.03],
    hipShift: -0.035,
    kneeL: [-0.07, 0.7], footL: [-0.06, 0.975],
    kneeR: [0.0, 0.69], footR: [0.09, 0.96],
    backArm: 'R', backLeg: 'L',
  },
  surf: {
    head: [0.0, 0.065], tilt: 0.06,
    shoulderL: [-0.085, 0.167], shoulderR: [0.085, 0.167],
    elbowL: [-0.11, 0.3], handL: [-0.095, 0.42],
    elbowR: [0.15, 0.25], handR: [0.2, 0.3],
    hipShift: 0.02,
    kneeL: [-0.05, 0.71], footL: [-0.08, 0.975],
    kneeR: [0.06, 0.71], footR: [0.075, 0.975],
    backArm: 'L', backLeg: 'L',
  },
};

export interface FigureStyle {
  pose: keyof typeof POSES;
  /** 'sunlit' = warm gradient skin; 'silhouette' = dark figure with neon rim glow. */
  render: 'sunlit' | 'silhouette';
  skinTop: string;
  skinBottom: string;
  hair: string;
  hairStyle: 'big' | 'pony' | 'long';
  suit: string;
  suitStyle: 'bikini' | 'onepiece';
  rim: string;
  surfboard?: string;
  flip?: boolean;
}

// ------------------------------------------------------------------ geometry helpers

function limbPath(ctx: Ctx, pts: P[], widths: number[]): void {
  // Offset polylines on both sides, then close.
  const left: P[] = [];
  const right: P[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const w = widths[i] / 2;
    left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) {
    const m: P = [(left[i - 1][0] + left[i][0]) / 2, (left[i - 1][1] + left[i][1]) / 2];
    ctx.quadraticCurveTo(left[i - 1][0], left[i - 1][1], m[0], m[1]);
  }
  ctx.lineTo(left[left.length - 1][0], left[left.length - 1][1]);
  ctx.lineTo(right[right.length - 1][0], right[right.length - 1][1]);
  for (let i = right.length - 2; i >= 0; i--) {
    const m: P = [(right[i + 1][0] + right[i][0]) / 2, (right[i + 1][1] + right[i][1]) / 2];
    ctx.quadraticCurveTo(right[i + 1][0], right[i + 1][1], m[0], m[1]);
  }
  ctx.lineTo(right[0][0], right[0][1]);
  ctx.closePath();
}

/** Round joint caps (filled separately so winding never cuts holes into the limb). */
function capsPath(ctx: Ctx, pts: P[], widths: number[]): void {
  for (let i = 0; i < pts.length; i++) {
    ctx.moveTo(pts[i][0] + widths[i] / 2, pts[i][1]);
    ctx.arc(pts[i][0], pts[i][1], widths[i] / 2, 0, Math.PI * 2);
  }
}

function mid(a: P, b: P, t = 0.5): P {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function torsoPath(ctx: Ctx, pose: Pose): void {
  const hs = pose.hipShift;
  const sL = pose.shoulderL, sR = pose.shoulderR;
  const chestY = 0.225, waistY = 0.335, hipY = 0.43, crotchY = 0.49;
  const ws = hs * 0.55;
  ctx.moveTo(sL[0], sL[1]);
  // left side: shoulder → armpit → chest → waist → hip → thigh top
  ctx.bezierCurveTo(sL[0] - 0.005, sL[1] + 0.03, -0.074, chestY - 0.03, -0.072, chestY);
  ctx.bezierCurveTo(-0.07, chestY + 0.05, -0.052 + ws, waistY - 0.04, -0.05 + ws, waistY);
  ctx.bezierCurveTo(-0.05 + ws, waistY + 0.04, -0.095 + hs, hipY - 0.04, -0.09 + hs, hipY);
  ctx.bezierCurveTo(-0.088 + hs, hipY + 0.03, -0.06 + hs, crotchY, 0.0 + hs, crotchY + 0.005);
  // right side back up
  ctx.bezierCurveTo(0.06 + hs, crotchY, 0.088 + hs, hipY + 0.03, 0.09 + hs, hipY);
  ctx.bezierCurveTo(0.095 + hs, hipY - 0.04, 0.05 + ws, waistY + 0.04, 0.05 + ws, waistY);
  ctx.bezierCurveTo(0.052 + ws, waistY - 0.04, 0.07, chestY + 0.05, 0.072, chestY);
  ctx.bezierCurveTo(0.074, chestY - 0.03, sR[0] + 0.005, sR[1] + 0.03, sR[0], sR[1]);
  // shoulders / neck line
  ctx.quadraticCurveTo(0.03, sR[1] - 0.02, 0.018, 0.13);
  ctx.lineTo(-0.018, 0.13);
  ctx.quadraticCurveTo(-0.03, sL[1] - 0.02, sL[0], sL[1]);
  ctx.closePath();
}

function armPts(pose: Pose, side: 'L' | 'R'): { pts: P[]; w: number[] } {
  const s = side === 'L' ? pose.shoulderL : pose.shoulderR;
  const e = side === 'L' ? pose.elbowL : pose.elbowR;
  const h = side === 'L' ? pose.handL : pose.handR;
  return { pts: [s, mid(s, e), e, mid(e, h), h], w: [0.042, 0.035, 0.027, 0.023, 0.02] };
}

function legPts(pose: Pose, side: 'L' | 'R'): { pts: P[]; w: number[] } {
  const hx = (side === 'L' ? -0.05 : 0.05) + pose.hipShift;
  const hip: P = [hx, 0.47];
  const k = side === 'L' ? pose.kneeL : pose.kneeR;
  const f = side === 'L' ? pose.footL : pose.footR;
  const calf = mid(k, f, 0.35);
  calf[0] += side === 'L' ? -0.006 : 0.006;
  return { pts: [hip, mid(hip, k, 0.5), k, calf, f], w: [0.088, 0.066, 0.042, 0.039, 0.022] };
}

// ------------------------------------------------------------------ figure

export function drawFigure(ctx: Ctx, x: number, feetY: number, height: number, style: FigureStyle): void {
  const pose = POSES[style.pose];
  const W = Math.ceil(height * 0.7);
  const H = Math.ceil(height * 1.05);
  // Render the figure into its own layer so we can add a rim glow around the whole silhouette.
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const c = layer.getContext('2d')!;
  c.translate(W / 2, H - height * 0.99);
  c.scale(style.flip ? -height : height, height);

  const silhouette = style.render === 'silhouette';
  const skin = c.createLinearGradient(0, 0, 0, 1);
  skin.addColorStop(0, silhouette ? '#2a0e44' : style.skinTop);
  skin.addColorStop(1, silhouette ? '#120422' : style.skinBottom);
  const skinBack = c.createLinearGradient(0, 0, 0, 1);
  skinBack.addColorStop(0, silhouette ? '#1c0830' : shade(style.skinTop, 0.82));
  skinBack.addColorStop(1, silhouette ? '#0a0216' : shade(style.skinBottom, 0.8));

  const fillPath = (fill: string | CanvasGradient, build: () => void) => {
    c.beginPath();
    build();
    c.fillStyle = fill;
    c.fill();
  };
  const back = { arm: armPts(pose, pose.backArm), leg: legPts(pose, pose.backLeg) };
  const front = { arm: armPts(pose, pose.backArm === 'L' ? 'R' : 'L'), leg: legPts(pose, pose.backLeg === 'L' ? 'R' : 'L') };

  // Long hair behind the body.
  if (style.hairStyle !== 'pony') {
    fillPath(style.hair, () => {
      const [hx, hy] = pose.head;
      const len = style.hairStyle === 'long' ? 0.3 : 0.24;
      c.moveTo(hx - 0.06, hy - 0.02);
      c.bezierCurveTo(hx - 0.11, hy + 0.06, hx - 0.1, hy + len * 0.7, hx - 0.07, hy + len);
      c.quadraticCurveTo(hx, hy + len + 0.03, hx + 0.07, hy + len);
      c.bezierCurveTo(hx + 0.1, hy + len * 0.7, hx + 0.11, hy + 0.06, hx + 0.06, hy - 0.02);
      c.closePath();
    });
  }

  // Surfboard behind.
  if (style.surfboard) {
    c.save();
    c.translate(0.2, 0.42);
    c.rotate(0.08);
    c.beginPath();
    c.ellipse(0, 0, 0.055, 0.42, 0, 0, Math.PI * 2);
    c.fillStyle = style.surfboard;
    c.fill();
    c.beginPath();
    c.moveTo(0, -0.4);
    c.lineTo(0, 0.4);
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 0.008;
    c.stroke();
    c.restore();
  }

  fillPath(skinBack, () => limbPath(c, back.leg.pts, back.leg.w));
  fillPath(skinBack, () => capsPath(c, back.leg.pts, back.leg.w));
  fillPath(skinBack, () => limbPath(c, back.arm.pts, back.arm.w));
  fillPath(skinBack, () => capsPath(c, back.arm.pts, back.arm.w));
  fillPath(skin, () => torsoPath(c, pose));
  // Neck.
  fillPath(skin, () => {
    const [hx, hy] = pose.head;
    c.moveTo(hx - 0.02, hy + 0.04);
    c.lineTo(hx + 0.02, hy + 0.04);
    c.lineTo(0.022, 0.15);
    c.lineTo(-0.022, 0.15);
    c.closePath();
  });
  fillPath(skin, () => limbPath(c, front.leg.pts, front.leg.w));
  fillPath(skin, () => capsPath(c, front.leg.pts, front.leg.w));

  // Swimsuit (clipped to the torso + thighs).
  c.save();
  c.beginPath();
  torsoPath(c, pose);
  c.clip();
  const hs = pose.hipShift;
  c.fillStyle = style.suit;
  if (style.suitStyle === 'onepiece') {
    c.beginPath();
    c.moveTo(-0.1, 0.195);
    c.lineTo(0.1, 0.195);
    c.lineTo(0.12 + hs, 0.41);
    c.quadraticCurveTo(0.03 + hs, 0.43, 0.0 + hs, 0.5);
    c.quadraticCurveTo(-0.03 + hs, 0.43, -0.12 + hs, 0.41);
    c.closePath();
    c.fill();
    // Side cut-out stripe for that 80s look.
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillRect(-0.1, 0.3, 0.2, 0.012);
  } else {
    // Top.
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.moveTo(sx * 0.008, 0.205);
      c.quadraticCurveTo(sx * 0.04, 0.195, sx * 0.074, 0.212);
      c.quadraticCurveTo(sx * 0.07, 0.245, sx * 0.012, 0.245);
      c.closePath();
      c.fill();
    }
    // Bottom.
    c.beginPath();
    c.moveTo(-0.1 + hs, 0.425);
    c.quadraticCurveTo(0 + hs, 0.435, 0.1 + hs, 0.425);
    c.quadraticCurveTo(0.04 + hs, 0.455, 0.012 + hs, 0.5);
    c.lineTo(-0.012 + hs, 0.5);
    c.quadraticCurveTo(-0.04 + hs, 0.455, -0.1 + hs, 0.425);
    c.closePath();
    c.fill();
  }
  c.restore();
  if (style.suitStyle === 'bikini') {
    // Straps.
    c.strokeStyle = style.suit;
    c.lineWidth = 0.006;
    c.beginPath();
    c.moveTo(-0.05, 0.205); c.lineTo(-0.03, 0.15);
    c.moveTo(0.05, 0.205); c.lineTo(0.03, 0.15);
    c.stroke();
  }

  fillPath(skin, () => limbPath(c, front.arm.pts, front.arm.w));
  fillPath(skin, () => capsPath(c, front.arm.pts, front.arm.w));

  // Head.
  const [hx, hy] = pose.head;
  c.save();
  c.translate(hx, hy);
  c.rotate(pose.tilt);
  fillPath(skin, () => c.ellipse(0, 0, 0.042, 0.055, 0, 0, Math.PI * 2));
  // Hair volume on top.
  c.fillStyle = style.hair;
  c.beginPath();
  if (style.hairStyle === 'big') {
    for (const [ox, oy, r] of [[-0.035, -0.03, 0.035], [0.0, -0.05, 0.04], [0.035, -0.03, 0.035], [-0.05, 0.01, 0.028], [0.05, 0.01, 0.028]]) {
      c.moveTo(ox + r, oy);
      c.arc(ox, oy, r, 0, Math.PI * 2);
    }
  } else {
    c.ellipse(0, -0.025, 0.048, 0.04, 0, Math.PI, Math.PI * 2);
    c.ellipse(0, -0.02, 0.046, 0.03, 0, 0, Math.PI * 2);
  }
  c.fill();
  if (style.hairStyle === 'pony') {
    c.beginPath();
    c.moveTo(0.03, -0.04);
    c.bezierCurveTo(0.12, -0.05, 0.12, 0.08, 0.08, 0.16);
    c.bezierCurveTo(0.07, 0.08, 0.06, 0.0, 0.03, -0.02);
    c.fill();
  }
  // Sunglasses.
  c.fillStyle = '#05030a';
  c.beginPath();
  c.roundRect(-0.038, -0.005, 0.034, 0.017, 0.006);
  c.roundRect(0.004, -0.005, 0.034, 0.017, 0.006);
  c.fill();
  c.fillRect(-0.006, -0.002, 0.012, 0.004);
  c.fillStyle = 'rgba(120,240,255,0.8)';
  c.fillRect(-0.032, -0.002, 0.012, 0.003);
  c.fillRect(0.01, -0.002, 0.012, 0.003);
  // Lips hint (sunlit only).
  if (!silhouette) {
    c.fillStyle = '#c0284f';
    c.beginPath();
    c.ellipse(0.002, 0.033, 0.01, 0.004, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();

  // Composite onto the poster with a rim glow.
  ctx.save();
  ctx.shadowColor = style.rim;
  ctx.shadowBlur = silhouette ? 18 : 10;
  ctx.drawImage(layer, x - W / 2, feetY - H);
  if (silhouette) {
    ctx.shadowBlur = 6;
    ctx.drawImage(layer, x - W / 2, feetY - H);
  }
  ctx.restore();
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

/** Ready-made figure looks. */
export const LOOKS = {
  sunsetBlonde: { render: 'sunlit', skinTop: '#ffd2b0', skinBottom: '#e07a7a', hair: '#ffd36b', hairStyle: 'big', suit: '#00e5ff', suitStyle: 'bikini', rim: '#ff9a5c' },
  sunsetBrunette: { render: 'sunlit', skinTop: '#e8a07a', skinBottom: '#b8506a', hair: '#2a0f1f', hairStyle: 'long', suit: '#ff2bd6', suitStyle: 'onepiece', rim: '#ffb86b' },
  sunsetRed: { render: 'sunlit', skinTop: '#ffd9bf', skinBottom: '#e88a8a', hair: '#d8401f', hairStyle: 'pony', suit: '#ffe14d', suitStyle: 'bikini', rim: '#ff7a9a' },
  sunsetDark: { render: 'sunlit', skinTop: '#b8704a', skinBottom: '#7a3448', hair: '#120810', hairStyle: 'big', suit: '#3dff9e', suitStyle: 'bikini', rim: '#ffb000' },
  neonPink: { render: 'silhouette', skinTop: '', skinBottom: '', hair: '#14051f', hairStyle: 'big', suit: '#ff2bd6', suitStyle: 'bikini', rim: '#ff2bd6' },
  neonCyan: { render: 'silhouette', skinTop: '', skinBottom: '', hair: '#14051f', hairStyle: 'long', suit: '#00e5ff', suitStyle: 'onepiece', rim: '#00e5ff' },
} satisfies Record<string, Omit<FigureStyle, 'pose'>>;
