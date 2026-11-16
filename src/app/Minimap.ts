/**
 * Small round minimap in the HUD: centred on the player and rotated with the heading (up = forward).
 * Shows the track around you and the other cars as dots; cars beyond the range sit pinned on the rim
 * with their gap in metres (+ ahead / − behind).
 */
export interface MinimapCar {
  x: number;
  z: number;
  color: string;
  player: boolean;
  /** Track-distance gap to the player in metres (+ ahead). */
  gap: number;
  /** Small dot, hidden when out of range (traffic). */
  minor?: boolean;
  /** Pinned to the rim when out of range, but without a gap label (police). */
  noLabel?: boolean;
}

const RANGE = 230; // metres from the centre to the rim

export class Minimap {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private track: Float32Array = new Float32Array(0); // x, z pairs (world)
  private width = 18;
  private size = 0;

  constructor() {
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    this.ctx = this.el.getContext('2d')!;
  }

  setTrack(points: Float32Array, width: number): void {
    this.track = points;
    this.width = width;
  }

  private resize(): number {
    const css = this.el.clientWidth || 170;
    const px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
    if (px !== this.size) {
      this.size = px;
      this.el.width = this.el.height = px;
    }
    return px;
  }

  /** `px, pz` = player world position, `fx, fz` = player forward (world, unit). */
  draw(px: number, pz: number, fx: number, fz: number, cars: MinimapCar[]): void {
    if (!this.el.isConnected || this.el.offsetParent === null) return;
    const S = this.resize();
    const g = this.ctx;
    const R = S / 2;
    const k = (R - 4) / RANGE; // px per metre
    // World → map: forward is up. Right vector = (−fz, fx) in xz.
    const map = (x: number, z: number): [number, number] => {
      const dx = x - px, dz = z - pz;
      const fwd = dx * fx + dz * fz;
      const right = dx * -fz + dz * fx;
      return [R + right * k, R - fwd * k];
    };
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.fillStyle = 'rgba(6, 2, 20, 0.62)';
    g.fill();
    g.clip();
    // Track: wide dark band with a thin neon centre line.
    const t = this.track;
    const lim2 = (RANGE * 1.6) ** 2;
    const strokeTrack = (w: number, style: string) => {
      g.lineWidth = w;
      g.strokeStyle = style;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      let pen = false;
      for (let i = 0; i <= t.length / 2; i++) {
        const j = (i % (t.length / 2)) * 2;
        const x = t[j], z = t[j + 1];
        if ((x - px) ** 2 + (z - pz) ** 2 > lim2) { pen = false; continue; }
        const [mx, my] = map(x, z);
        if (pen) g.lineTo(mx, my);
        else g.moveTo(mx, my);
        pen = true;
      }
      g.stroke();
    };
    strokeTrack(Math.max(4, this.width * k + 2), 'rgba(0, 229, 255, 0.35)');
    strokeTrack(Math.max(3, this.width * k), 'rgba(30, 20, 60, 0.95)');
    strokeTrack(1, 'rgba(255, 43, 214, 0.55)');
    // Cars (player last, on top).
    g.font = `bold ${Math.round(S * 0.075)}px Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const c of [...cars].sort((a, b) => Number(a.player) - Number(b.player))) {
      if (c.player) {
        // Arrow pointing up.
        g.fillStyle = '#ffe14a';
        g.shadowColor = '#ffe14a';
        g.shadowBlur = 8;
        g.beginPath();
        g.moveTo(R, R - S * 0.05);
        g.lineTo(R + S * 0.032, R + S * 0.035);
        g.lineTo(R - S * 0.032, R + S * 0.035);
        g.closePath();
        g.fill();
        g.shadowBlur = 0;
        continue;
      }
      let [mx, my] = map(c.x, c.z);
      const dx = mx - R, dy = my - R;
      const d = Math.hypot(dx, dy);
      const rim = R - S * 0.06;
      const clamped = d > rim;
      if (clamped && c.minor) continue;
      if (clamped) {
        mx = R + (dx / d) * rim;
        my = R + (dy / d) * rim;
      }
      g.fillStyle = c.color;
      g.strokeStyle = c.color;
      g.shadowColor = c.color;
      g.shadowBlur = 6;
      g.beginPath();
      g.arc(mx, my, S * (c.minor ? 0.02 : 0.032), 0, Math.PI * 2);
      if (clamped) {
        g.lineWidth = 2;
        g.stroke();
      } else g.fill();
      g.shadowBlur = 0;
      if (clamped && !c.noLabel) {
        // Gap label, nudged inward from the rim.
        const lx = R + (dx / d) * (rim - S * 0.11), ly = R + (dy / d) * (rim - S * 0.11);
        g.fillStyle = 'rgba(255, 255, 255, 0.9)';
        g.fillText(`${c.gap > 0 ? '+' : '−'}${Math.round(Math.abs(c.gap))}m`, lx, ly);
      }
    }
    g.restore();
    // Rim.
    g.beginPath();
    g.arc(R, R, R - 1.5, 0, Math.PI * 2);
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(0, 229, 255, 0.7)';
    g.stroke();
  }
}
