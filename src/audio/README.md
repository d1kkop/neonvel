# Audio

Everything works with **zero assets**: music and SFX are synthesised with Web Audio.
An optional bundled track is listed in `public/audio/manifest.json`.

## Files
- `AudioEngine.ts` — lazily creates the `AudioContext` on the first click / key / touch (browser autoplay rule).
  Buses: master → music / sfx, plus a limiter. Keys: **M** = mute, **N** = next music (tracks → procedural synthwave → …).
  Suspends when the tab is hidden.
- `SynthwaveMusic.ts` — `Music`: starts the procedural loop immediately, then crossfades to the first manifest track
  once decoded. `SynthwaveLoop`: 116 BPM outrun loop (Am–F–C–G), detuned octave saw bass, gated saw pad,
  square lead arpeggio with dotted-8th delay, kick / snare / hats, 16-bar arrangement (intro, breakdown).
  Lookahead scheduler (`StepClock` in `dsp.ts`: 25 ms timer, 0.9 s ahead on the AudioContext clock, so slow
  frames on the main thread can't make the music stutter).
- `Sfx.ts` — continuous engine (2 detuned saws + square sub + combustion noise → waveshaper → lowpass, 5-gear rpm
  model with shift pops), wind noise, environment (reverb send / lowpass / rumble for `open` | `canopy` | `tunnel`,
  automatic whoosh on tunnel entry/exit). One-shots: `whoosh`, `passBy`, `countdown(3|2|1|0)`, `scrape`, `impact`,
  `boost`, `blip`, `thunder(delay, strength)` (for the weather system's lightning).
- `dsp.ts` — noise buffer, synthetic reverb impulse, envelopes, drive curve.

## API
```ts
const audio = new AudioEngine();
audio.update({ speed01, throttle, environment }); // every frame (safe before unlock)
audio.sfx?.countdown(3);                           // sfx is null until the first user gesture
audio.sfx?.thunder(1.2, 0.8);
audio.setVolume('music', 0.4); audio.toggleMute();
```

## Assets / licenses
See `public/audio/CREDITS.md`. Only use files whose license allows redistribution in a game (CC0 preferred;
CC-BY needs attribution in CREDITS).

Further candidates found (not bundled):
- Synthwave House Loop — Fupi — CC0 — https://opengameart.org/content/synthwave-house-loop
- Racing car engine sound loops — domasx2 — CC0 — https://opengameart.org/content/racing-car-engine-sound-loops
- Zodik outrun tracks (e.g. Future Travel) — **CC-BY 3.0** (attribution required) — https://opengameart.org/content/zodik-future-travel
