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
}

const even = (n: number) => Array.from({ length: n }, (_, i) => 1 - (i % 2) * 0.04);

export const ENGINES: Record<string, EngineProfile> = {
  // City bus: turbo inline-6 diesel — low revs, knock on every firing, deep drone, turbo whistle, cooling fan.
  diesel6: { name: 'Turbo-diesel inline-6', cylinders: 6, firing: [1, 0.9, 0.97, 0.88, 1, 0.92], resonances: [[68, 9], [210, 6], [1900, 5]], pipeMs: 6.5, pipeFeedback: 0.5, rasp: 0.3, redline: 2300, idle: 600, turbo: 0.9, crackle: 0, bright: 0.3, diesel: 0.9, intake: 0.5, fan: 0.6, airBrakes: true },
  flat12: { name: 'Flat-12', cylinders: 12, firing: even(12), resonances: [[190, 6], [640, 5], [1700, 4]], pipeMs: 2.4, pipeFeedback: 0.45, rasp: 0.25, redline: 8800, idle: 950, turbo: 0, crackle: 0.25, bright: 0.75 },
  v8muscle: { name: 'Big-block V8', cylinders: 8, firing: [1, 0.58, 0.92, 0.52, 1, 0.68, 0.86, 0.6], resonances: [[105, 9], [360, 5], [880, 3]], pipeMs: 4.8, pipeFeedback: 0.62, rasp: 0.55, redline: 6400, idle: 750, turbo: 0, crackle: 0.95, bright: 0.35 },
  v8lux: { name: 'Luxury V8', cylinders: 8, firing: [1, 0.72, 0.95, 0.7, 1, 0.78, 0.9, 0.74], resonances: [[90, 8], [300, 4], [760, 2]], pipeMs: 5.4, pipeFeedback: 0.55, rasp: 0.12, redline: 5200, idle: 600, turbo: 0, crackle: 0.15, bright: 0.25 },
  i4sport: { name: 'Sport inline-4', cylinders: 4, firing: [1, 0.9, 0.97, 0.88], resonances: [[260, 6], [1050, 6], [2700, 5]], pipeMs: 1.9, pipeFeedback: 0.45, rasp: 0.6, redline: 8400, idle: 1000, turbo: 0, crackle: 0.55, bright: 0.85 },
  inline6: { name: 'Inline-6', cylinders: 6, firing: even(6), resonances: [[160, 6], [520, 5], [1350, 4]], pipeMs: 3.0, pipeFeedback: 0.5, rasp: 0.18, redline: 7400, idle: 850, turbo: 0.15, crackle: 0.3, bright: 0.55 },
  turbo4: { name: 'Turbo inline-4', cylinders: 4, firing: [1, 0.84, 0.95, 0.8], resonances: [[230, 6], [950, 6], [2500, 5]], pipeMs: 2.0, pipeFeedback: 0.4, rasp: 0.85, redline: 8200, idle: 950, turbo: 1, crackle: 0.65, bright: 0.8 },
  v12: { name: 'V12', cylinders: 12, firing: even(12), resonances: [[140, 7], [470, 5], [1200, 3]], pipeMs: 3.6, pipeFeedback: 0.55, rasp: 0.12, redline: 7600, idle: 800, turbo: 0.25, crackle: 0.2, bright: 0.5 },
  v10: { name: 'V10', cylinders: 10, firing: [1, 0.93, 1, 0.9, 0.98, 1, 0.92, 1, 0.9, 0.97], resonances: [[250, 6], [820, 6], [2300, 5]], pipeMs: 2.2, pipeFeedback: 0.45, rasp: 0.45, redline: 9200, idle: 1000, turbo: 0, crackle: 0.5, bright: 0.9 },
  racev8: { name: 'Flat-plane race V8', cylinders: 8, firing: even(8), resonances: [[270, 7], [900, 6], [2600, 5]], pipeMs: 1.8, pipeFeedback: 0.5, rasp: 0.7, redline: 9600, idle: 1100, turbo: 0, crackle: 1, bright: 1 },
  w16: { name: 'W16 quad-turbo', cylinders: 16, firing: even(16), resonances: [[150, 8], [500, 5], [1400, 3]], pipeMs: 3.0, pipeFeedback: 0.55, rasp: 0.22, redline: 7000, idle: 850, turbo: 1, crackle: 0.35, bright: 0.45 },
};
