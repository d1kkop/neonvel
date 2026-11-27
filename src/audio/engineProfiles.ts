/**
 * Engine character per car. The synthesiser builds exhaust-pulse loops from these numbers.
 */
export interface EngineProfile {
  name: string;
  cylinders: number;
  /** Relative strength of consecutive firings (repeats) — uneven = burble (cross-plane V8). */
  firing: number[];
  /** Exhaust / intake resonance peaks (Hz) with gain (dB). */
  resonances: [number, number][];
  /** Exhaust pipe length → comb resonance (ms) and its feedback (0..0.9). */
  pipeMs: number;
  pipeFeedback: number;
  /** Combustion noise / rasp 0..1. */
  rasp: number;
  /** Max rpm of this engine (the sound maps the gearbox rpm onto it). */
  redline: number;
  idle: number;
  /** Turbo whistle + blow-off 0..1. */
  turbo: number;
  /** Over-run crackle / pops 0..1. */
  crackle: number;
  /** Overall brightness 0..1. */
  bright: number;
  /** Diesel: sharp combustion knock on every firing ("clatter") 0..1. */
  diesel?: number;
  /** Intake / induction roar under load 0..1. */
  intake?: number;
  /** Big engine cooling fan hum (buses) 0..1. */
  fan?: number;
  /** Air brakes: "pssht" when the vehicle comes to a stop. */
  airBrakes?: boolean;

  // --- What makes one car unmistakably different from the next (not just higher or lower):

  /**
   * This car's own gearbox as heard: the top of every gear as a fraction of the car's top speed (the last one
   * is 1). Four long gears rev slowly through a wide band; seven short ones scream up and bang through.
   */
  gears: number[];
  /**
   * How a gear change sounds: 'manual' = the throttle lifts, revs fall, then pick up; 'auto' = no cut, the revs
   * slur down; 'dct' = a 60 ms blip with a crack; 'seq' = a hard cut and a bang (racing sequential).
   */
  shift: 'manual' | 'auto' | 'dct' | 'seq';
  /** Seconds a gear change takes. */
  shiftTime: number;
  /** Lumpy idle (big cam): the revs hunt up and down at idle 0..1. */
  lope?: number;
  /** Fixed body resonances applied live (they do not move with the revs): [Hz, Q, dB]. Up to three. */
  formants: [number, number, number][];
  /**
   * Howl: a narrow resonance that follows the revs at this engine order (cycles per crank turn x 2), 0..1.
   * Order 2 = a four's buzz, 4 = flat-plane V8 bark, 5 = V10 scream, 6 = twelve-cylinder wail.
   */
  howl?: [order: number, gain: number];
  /** Deep sub thump under the engine (half the firing rate) 0..1: the chest-punch of a big V8 / W16. */
  sub?: number;
  /** Supercharger whine (follows the revs) 0..1. */
  blower?: number;
  /** Straight-cut gear whine (follows road speed, so it keeps climbing through the gears) 0..1. */
  gearWhine?: number;
  /** Turbo flutter ("stu-tu-tu") when lifting off boost 0..1. */
  flutter?: number;

  // --- The engine note itself: built from crank orders (1 = once per crankshaft turn), not from one shared
  // waveform. This is what makes a V8 rumble, a four buzz and a twelve sing.

  /** The loud orders of this engine and their strength: [order, 0..1]. Half orders (0.5, 1.5 ...) = uneven firing. */
  orders: [number, number][];
  /**
   * The order the exhaust note is built on (its multiples form the tone). Low = deep: 1 for a cross-plane V8's
   * rumble, 2 for a four, 3 for a six or one bank of a twelve. (Not the full firing order: that is what made
   * the many-cylinder engines whine.)
   */
  note: number;
  /** How fast the higher multiples of the note die away (0.5 = bright and hard, 2 = soft and round). */
  tilt: number;
  /** Level of everything between the main orders (0 = pure and smooth, 0.3 = rough, lumpy, every cylinder different). */
  fill: number;
  /** Distortion: 0.8 = clean, 3.5 = snarling. */
  drive: number;
  /** Second voice detuned by this many cents (two cylinder banks beating against each other). 0 = none. */
  detune?: number;
  /** Centre (Hz) of the combustion rasp noise that rides on every firing. */
  raspHz?: number;
  /** Rushing air under load (big intakes, turbos) 0..1. */
  whoosh?: number;
}

const even = (n: number) => Array.from({ length: n }, (_, i) => 1 - (i % 2) * 0.04);

export const ENGINES: Record<string, EngineProfile> = {
  // City bus: turbo inline-6 diesel — low revs, knock on every firing, deep drone, turbo whistle, cooling fan;
  // a lazy 5-speed automatic that slurs from gear to gear.
  diesel6: {
    orders: [[1.5, 1], [3, 0.8], [0.5, 0.5], [4.5, 0.4], [6, 0.3]], note: 1.5, tilt: 1.4, fill: 0.35, drive: 1.5, raspHz: 400, whoosh: 0.5,
    name: 'Turbo-diesel inline-6', cylinders: 6, firing: [1, 0.9, 0.97, 0.88, 1, 0.92], resonances: [[68, 9], [210, 6], [1900, 5]], pipeMs: 6.5, pipeFeedback: 0.5, rasp: 0.3,
    redline: 2300, idle: 600, turbo: 0.9, crackle: 0, bright: 0.3, diesel: 0.9, intake: 0.5, fan: 0.6, airBrakes: true,
    gears: [0.2, 0.37, 0.57, 0.8, 1], shift: 'auto', shiftTime: 0.7, formants: [[95, 1.2, 8], [320, 1.5, 4]], sub: 0.5,
  },
  // Flat-12: a smooth, rising wail; classic 5-speed manual with a proper lift between gears.
  flat12: {
    orders: [[3, 1], [6, 0.8], [9, 0.45], [1.5, 0.3], [12, 0.3]], note: 3, tilt: 1.2, fill: 0.05, drive: 1.4, detune: 5, raspHz: 900,
    name: 'Flat-12', cylinders: 12, firing: even(12), resonances: [[190, 6], [640, 5], [1700, 4]], pipeMs: 2.4, pipeFeedback: 0.45, rasp: 0.25,
    redline: 7600, idle: 900, turbo: 0, crackle: 0.25, bright: 0.75,
    gears: [0.25, 0.43, 0.62, 0.82, 1], shift: 'manual', shiftTime: 0.22, formants: [[900, 2, 6], [2400, 2, 5]], howl: [6, 0.55],
  },
  // Big-block V8: lumpy idle, chest thump, blower whine, four long gears and a slow, heavy shift.
  v8muscle: {
    orders: [[0.5, 0.7], [1, 0.9], [1.5, 0.7], [2, 1], [2.5, 0.6], [3, 0.45], [4, 0.8], [6, 0.3]], note: 1, tilt: 1.3, fill: 0.35, drive: 3.2, detune: 10, raspHz: 350,
    name: 'Big-block V8', cylinders: 8, firing: [1, 0.58, 0.92, 0.52, 1, 0.68, 0.86, 0.6], resonances: [[105, 9], [360, 5], [880, 3]], pipeMs: 4.8, pipeFeedback: 0.62, rasp: 0.55,
    redline: 6400, idle: 750, turbo: 0, crackle: 0.95, bright: 0.35,
    gears: [0.3, 0.53, 0.77, 1], shift: 'manual', shiftTime: 0.32, lope: 0.9, formants: [[120, 1, 9], [430, 1.5, 4]], sub: 0.85, blower: 0.55,
  },
  // Luxury V8: hushed and deep, a seamless automatic.
  v8lux: {
    orders: [[2, 1], [4, 0.6], [1, 0.4], [0.5, 0.3]], note: 2, tilt: 2.0, fill: 0.12, drive: 1.0, detune: 5, raspHz: 300,
    name: 'Luxury V8', cylinders: 8, firing: [1, 0.72, 0.95, 0.7, 1, 0.78, 0.9, 0.74], resonances: [[90, 8], [300, 4], [760, 2]], pipeMs: 5.4, pipeFeedback: 0.55, rasp: 0.12,
    redline: 5200, idle: 600, turbo: 0, crackle: 0.15, bright: 0.25,
    gears: [0.22, 0.4, 0.6, 0.8, 1], shift: 'auto', shiftTime: 0.5, formants: [[110, 1, 6], [380, 1.2, 3]], sub: 0.5,
  },
  // Sport four: a hard metallic buzz, short gears, quick manual shifts, gear whine.
  i4sport: {
    orders: [[2, 1], [4, 0.9], [6, 0.6], [8, 0.4], [1, 0.25]], note: 2, tilt: 0.9, fill: 0.05, drive: 2.6, raspHz: 1100,
    name: 'Sport inline-4', cylinders: 4, firing: [1, 0.9, 0.97, 0.88], resonances: [[260, 6], [1050, 6], [2700, 5]], pipeMs: 1.9, pipeFeedback: 0.45, rasp: 0.6,
    redline: 7400, idle: 950, turbo: 0, crackle: 0.55, bright: 0.85,
    gears: [0.2, 0.34, 0.5, 0.66, 0.83, 1], shift: 'manual', shiftTime: 0.15, formants: [[1400, 3, 9], [3200, 3, 6]], howl: [2, 0.7], gearWhine: 0.3,
  },
  inline6: {
    orders: [[3, 1], [1.5, 0.5], [6, 0.6], [9, 0.3]], note: 3, tilt: 1.2, fill: 0.08, drive: 1.8, raspHz: 800,
    name: 'Inline-6', cylinders: 6, firing: even(6), resonances: [[160, 6], [520, 5], [1350, 4]], pipeMs: 3.0, pipeFeedback: 0.5, rasp: 0.18,
    redline: 7400, idle: 850, turbo: 0.15, crackle: 0.3, bright: 0.55,
    gears: [0.24, 0.42, 0.61, 0.81, 1], shift: 'manual', shiftTime: 0.2, formants: [[600, 2, 6], [1700, 2, 4]], howl: [3, 0.5],
  },
  // Turbo four: muffled and breathy off boost, whistle and whoosh on it, flutter on every lift.
  turbo4: {
    orders: [[2, 1], [1, 0.4], [4, 0.45], [6, 0.15]], note: 2, tilt: 1.9, fill: 0.12, drive: 1.5, raspHz: 600, whoosh: 1,
    name: 'Turbo inline-4', cylinders: 4, firing: [1, 0.84, 0.95, 0.8], resonances: [[230, 6], [950, 6], [2500, 5]], pipeMs: 2.0, pipeFeedback: 0.4, rasp: 0.85,
    redline: 7000, idle: 900, turbo: 1, crackle: 0.65, bright: 0.6,
    gears: [0.23, 0.4, 0.59, 0.79, 1], shift: 'manual', shiftTime: 0.2, formants: [[650, 2, 6], [1900, 2, 4]], howl: [2, 0.3], flutter: 1,
  },
  // V12 grand tourer: silk. Soft wail, no drama, a smooth five-speed automatic.
  v12: {
    orders: [[3, 1], [1.5, 0.45], [6, 0.55], [9, 0.2]], note: 3, tilt: 1.7, fill: 0.04, drive: 1.1, detune: 4, raspHz: 600,
    name: 'V12', cylinders: 12, firing: even(12), resonances: [[140, 7], [470, 5], [1200, 3]], pipeMs: 3.6, pipeFeedback: 0.55, rasp: 0.12,
    redline: 7600, idle: 800, turbo: 0.25, crackle: 0.2, bright: 0.5,
    gears: [0.24, 0.43, 0.63, 0.83, 1], shift: 'auto', shiftTime: 0.4, formants: [[300, 1, 5], [1100, 1.5, 3]], howl: [6, 0.35], sub: 0.25,
  },
  // V10: a piercing scream, seven short gears through a twin-clutch box that cracks on every shift.
  v10: {
    orders: [[2.5, 1], [5, 0.9], [7.5, 0.55], [10, 0.4], [1.5, 0.3]], note: 2.5, tilt: 0.9, fill: 0.08, drive: 2.2, detune: 6, raspHz: 1300,
    name: 'V10', cylinders: 10, firing: [1, 0.93, 1, 0.9, 0.98, 1, 0.92, 1, 0.9, 0.97], resonances: [[250, 6], [820, 6], [2300, 5]], pipeMs: 2.2, pipeFeedback: 0.45, rasp: 0.45,
    redline: 8200, idle: 950, turbo: 0, crackle: 0.5, bright: 0.9,
    gears: [0.17, 0.29, 0.42, 0.56, 0.7, 0.85, 1], shift: 'dct', shiftTime: 0.07, formants: [[1800, 2.5, 8], [3600, 2.5, 6]], howl: [5, 0.85],
  },
  // Race V8: raw bark, straight-cut gear whine all the time, sequential box that bangs.
  racev8: {
    orders: [[2, 1], [4, 1], [6, 0.6], [8, 0.5], [1, 0.35]], note: 2, tilt: 0.8, fill: 0.2, drive: 3.6, detune: 8, raspHz: 1000, whoosh: 0.3,
    name: 'Flat-plane race V8', cylinders: 8, firing: even(8), resonances: [[270, 7], [900, 6], [2600, 5]], pipeMs: 1.8, pipeFeedback: 0.5, rasp: 0.7,
    redline: 8400, idle: 1000, turbo: 0, crackle: 1, bright: 1,
    gears: [0.2, 0.34, 0.49, 0.65, 0.82, 1], shift: 'seq', shiftTime: 0.09, formants: [[1200, 2, 7], [2800, 2, 6]], howl: [4, 0.65], gearWhine: 0.8,
  },
  // Twin-turbo flat-plane V8 hypercar (Super Phoenix): the race V8 pushed harder — snarling, sky-high revs
  // (10,200), seven tight gears so it lives near the top, turbo whistle, flutter and crackle on every lift.
  v8tt: {
    orders: [[2, 1], [4, 1], [6, 0.7], [8, 0.55], [1, 0.4], [3, 0.25]], note: 2, tilt: 0.65, fill: 0.24, drive: 4.6, detune: 10, raspHz: 1250, whoosh: 0.55,
    name: 'Twin-turbo flat-plane V8', cylinders: 8, firing: even(8), resonances: [[240, 8], [950, 7], [2900, 6]], pipeMs: 1.5, pipeFeedback: 0.55, rasp: 0.9,
    redline: 10200, idle: 1100, turbo: 0.75, crackle: 1, bright: 1, sub: 0.45, flutter: 0.7,
    gears: [0.24, 0.37, 0.5, 0.63, 0.76, 0.88, 1], shift: 'seq', shiftTime: 0.07, formants: [[1300, 2, 8], [3000, 2, 7]], howl: [4, 0.8], gearWhine: 0.6,
  },
  // W16: a thunderous, dense rumble with four turbos sucking air; seven gears that shift almost unheard.
  w16: {
    orders: [[2, 0.8], [4, 1], [1, 0.6], [0.5, 0.4], [8, 0.5], [6, 0.3]], note: 2, tilt: 1.3, fill: 0.25, drive: 2.0, detune: 12, raspHz: 400, whoosh: 0.8,
    name: 'W16 quad-turbo', cylinders: 16, firing: even(16), resonances: [[150, 8], [500, 5], [1400, 3]], pipeMs: 3.0, pipeFeedback: 0.55, rasp: 0.22,
    redline: 7000, idle: 850, turbo: 1, crackle: 0.35, bright: 0.45,
    gears: [0.16, 0.28, 0.41, 0.55, 0.7, 0.85, 1], shift: 'dct', shiftTime: 0.1, formants: [[200, 1, 8], [800, 1.5, 4]], sub: 0.8, flutter: 0.5, howl: [8, 0.25],
  },
};
