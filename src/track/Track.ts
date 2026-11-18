import * as THREE from 'three';

/** A point on the track: position on the centre line plus an orthonormal frame. */
export interface TrackFrame {
  position: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

/**
 * Common interface for all track types (closed loop now, endless later).
 * Distances are in metres along the centre line.
 */
export interface Track {
  readonly closed: boolean;
  readonly length: number;
  readonly width: number;
  readonly lanes: number;
  /** Fill `out` with the frame at distance `d` (wrapped for closed tracks). */
  frameAt(d: number, out: TrackFrame): TrackFrame;
}

export function makeFrame(): TrackFrame {
  return {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
  };
}

export type SectionType = 'tunnel' | 'canopy';

/** A covered stretch of road, in metres along the track. */
export interface TrackSection {
  type: SectionType;
  start: number;
  end: number;
}

/** One rolling-hill wave: `cycles` per lap (integer, so the loop closes), amplitude in metres, phase (rad). */
export type HillWave = [cycles: number, amplitude: number, phase: number];

/**
 * A closed circuit around a base height, optionally with rolling hills (a smooth periodic height profile
 * along the track). Control points are rescaled so the lap has exactly `targetLength` metres.
 * Frames keep a horizontal forward/right; `slopeAt` gives the climb (dh/ds) for physics and visuals.
 */
export class LoopTrack implements Track {
  readonly closed = true;
  readonly length: number;
  readonly width: number;
  readonly lanes: number;
  readonly height: number;
  readonly sections: TrackSection[];

  /** Pre-sampled centre line, one sample every `sampleStep` metres. */
  readonly samples: THREE.Vector3[] = [];
  readonly sampleStep = 2;

  private readonly curve: THREE.CatmullRomCurve3;

  constructor(opts: {
    points: [number, number][];
    targetLength: number;
    height: number;
    width: number;
    lanes: number;
    sections?: TrackSection[];
    hills?: HillWave[];
  }) {
    this.height = opts.height;
    this.hills = opts.hills ?? [];
    this.sections = opts.sections ?? [];
    this.width = opts.width;
    this.lanes = opts.lanes;

    const raw = opts.points.map(([x, z]) => new THREE.Vector3(x, opts.height, z));
    let curve = new THREE.CatmullRomCurve3(raw, true, 'centripetal');
    const scale = opts.targetLength / curve.getLength();
    const scaled = opts.points.map(([x, z]) => new THREE.Vector3(x * scale, opts.height, z * scale));
    curve = new THREE.CatmullRomCurve3(scaled, true, 'centripetal');
    curve.arcLengthDivisions = 4000;
    this.curve = curve;
    this.length = curve.getLength();

    const n = Math.round(this.length / this.sampleStep);
    for (let i = 0; i < n; i++) {
      const p = curve.getPointAt(i / n);
      p.y = this.height + this.hillAt((i / n) * this.length);
      this.samples.push(p);
    }
  }

  readonly hills: HillWave[];

  /** Hill offset (m) above the base height at distance d. */
  private hillAt(d: number): number {
    let h = 0;
    for (const [c, a, ph] of this.hills) h += a * Math.sin((d / this.length) * Math.PI * 2 * c + ph);
    return h;
  }

  /** Road height (world y) at distance d. */
  heightAt(d: number): number {
    return this.height + this.hillAt(d);
  }

  /** Climb rate dh/ds at distance d (+ = uphill in the driving direction). */
  slopeAt(d: number): number {
    let s = 0;
    for (const [c, a, ph] of this.hills) {
      const w = (Math.PI * 2 * c) / this.length;
      s += a * w * Math.cos(d * w + ph);
    }
    return s;
  }

  get hilly(): boolean {
    return this.hills.length > 0;
  }

  frameAt(d: number, out: TrackFrame): TrackFrame {
    const u = (((d / this.length) % 1) + 1) % 1;
    this.curve.getPointAt(u, out.position);
    if (this.hills.length) out.position.y = this.height + this.hillAt(u * this.length);
    this.curve.getTangentAt(u, out.forward);
    out.forward.y = 0;
    out.forward.normalize();
    out.up.set(0, 1, 0);
    // right = forward × up
    out.right.set(-out.forward.z, 0, out.forward.x);
    return out;
  }

  /** Signed curvature (1/m, + = turning right) per sample, and track heading per sample. */
  private kappa: Float32Array | null = null;

  private buildCurvature(): void {
    const n = this.samples.length;
    const heading = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.samples[i], b = this.samples[(i + 1) % n];
      heading[i] = Math.atan2(b.x - a.x, -(b.z - a.z));
    }
    const k = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let dh = heading[(i + 1) % n] - heading[i];
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      k[i] = dh / (this.length / n);
    }
    // Smooth (the spline is sampled finely; raw curvature is noisy).
    const sm = new Float32Array(n);
    const R = 6;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = -R; j <= R; j++) acc += k[(i + j + n) % n];
      sm[i] = acc / (R * 2 + 1);
    }
    this.kappa = sm;
  }

  /** Signed curvature at distance d (+ = right-hand bend). */
  curvatureAt(d: number): number {
    if (!this.kappa) this.buildCurvature();
    const n = this.samples.length;
    const f = ((((d / this.length) % 1) + 1) % 1) * n;
    const i = Math.floor(f) % n;
    const t = f - Math.floor(f);
    return this.kappa![i] * (1 - t) + this.kappa![(i + 1) % n] * t;
  }

  /** Max |curvature| over the next `ahead` metres (for AI braking). */
  maxCurvatureAhead(d: number, ahead: number, step = 6): number {
    let m = 0;
    for (let x = 0; x <= ahead; x += step) m = Math.max(m, Math.abs(this.curvatureAt(d + x)));
    return m;
  }

  /** The covered section at distance `d`, if any. `margin` extends the section on both ends. */
  sectionAt(d: number, margin = 0): TrackSection | undefined {
    const w = ((d % this.length) + this.length) % this.length;
    return this.sections.find((s) => w >= s.start - margin && w <= s.end + margin);
  }

  /** Squared horizontal distance from (x,z) to the nearest centre-line sample. Brute force; used at build time. */
  distanceSqTo(x: number, z: number): number {
    let best = Infinity;
    for (const p of this.samples) {
      const dx = p.x - x;
      const dz = p.z - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return best;
  }

  /** Nearest sample index to (x,z). */
  nearestSample(x: number, z: number): number {
    let best = Infinity;
    let idx = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const p = this.samples[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    return idx;
  }
}
