import * as THREE from 'three';
import { makeFrame } from '../track/Track';
import { Rng } from '../util/random';
import { designs } from '../world/billboardArt';
import { CoastTerrain, createOcean } from '../world/coast/Coast';
import { createHotels, createLifeguardTowers, createSeagulls, createUmbrellas, Placement } from '../world/props/BeachProps';
import { createPalms, PalmPlacement, palmWind } from '../world/props/Palms';
import { createBeachBars, createPartyLights, LightString } from '../world/props/BeachParty';
import { createDrinkTables, createLoungers, Dancers, type Lounger, VolleyballCourt } from '../world/props/BeachLife';
import type { LevelDef } from './types';

const PASTELS = ['#ffb3c7', '#9fe3e0', '#ffe3a3', '#c7b3ff', '#ffc9a3', '#b3ffd1', '#f7f3ea'].map((c) => new THREE.Color(c));

export const palmCoast: LevelDef = {
  id: 'palm-coast',
  name: 'Palm Coast',
  tagline: 'Pastel hotels and palms while a red sun sinks into the sea.',
  cardColors: ['#ff6a3a', '#7a3aa8'],
  time: 'dusk',
  seed: 4242,
  track: {
    points: [
      [0, 0], [500, -90], [900, 0], [1120, 260], [960, 540], [620, 580],
      [360, 430], [120, 580], [-260, 520], [-400, 250], [-260, 40],
    ],
    length: 3200,
    height: 7,
    hills: [[3, 5, 0.8], [8, 1.2, 2.0]], // coastal climbs (lowest point stays above the beach)
    width: 18,
    lanes: 4,
    pillars: false,
    sections: [
      { type: 'canopy', start: 640, end: 800 },
      { type: 'tunnel', start: 2050, end: 2260 },
    ],
  },
  // Sunset: a big red sun sinking into the sea at the end of the start straight, violet sky overhead,
  // long low orange light with a cool purple fill from the sky side.
  sky: {
    top: '#1c1a52', mid: '#c24e78', horizon: '#ff7a3e', sunA: '#ff1c08', sunB: '#c00410',
    sunSize: 0.11, sunIntensity: 2.1, sunGlow: 2.6, sunCore: 0.7, sunHalo: 1, sunStripes: 0, stars: 0.15, dayClouds: 0.6, cloudTint: 1,
  },
  atmosphere: {
    fogColor: '#e0846e', fogDensity: 0.0005, hazeColor: '#ff8a5a', hazeTop: 22, hazeStrength: 0.35, overcastColor: '#6a5a6e',
  },
  lighting: {
    hemiSky: '#7c6ac8', hemiGround: '#ff9466', hemiIntensity: 0.95, sunColor: '#ff7038', sunIntensity: 2.3,
    sunDir: [0.93, 0.025, -0.36], exposure: 1.0, bloom: { strength: 0.28, radius: 0.35, threshold: 1.15 },
    env: { top: '#2a2468', horizon: '#ff7a44', ground: '#6a4250', panels: ['#ff8a50', '#ffb07a', '#ff5a6a', '#b0a0ff'] },
  },
  road: {
    lampsOn: true, leftNeon: '#00c8d8', rightNeon: '#ff5fb0', leftLamp: '#ffd2a0', rightLamp: '#ffd2a0',
    neonIntensity: 0.75, asphalt: '#4a4450', reflect: 0.7, wetness: 0.35, concrete: '#efe9df', wallStyle: 'guardrail', lampStyle: 'post', railColor: '#e8ecf2',
  },
  weathers: ['clear', 'rain', 'storm'],
  defaultWeather: 'clear',
  billboards: designs(
    'miamiHeat', 'sunsetClub', 'coconutTan', 'surfParadise', 'summer86', 'bikiniBar', 'palmFm', 'turboCola',
    'tropicNights', 'cyberBeach', 'miami2084', 'driveFast',
  ),
  ambience: 'beach',
  music: 'sunset-boulevard',
  build(ctx) {
    const { track, scene } = ctx;
    const rng = new Rng(ctx.seed);
    const shoulder = track.height - 0.4;
    const terrain = new CoastTerrain(track, {
      shoulder, sand: '#f0dcae', wetSand: '#c2a676', grass: '#5f9f45', hills: 26, cell: ctx.quality === 'low' ? 16 : 12, subdiv: ctx.quality === 'low' ? 1 : ctx.quality === 'medium' ? 2 : 3,
    });
    scene.add(terrain.mesh);
    scene.add(createOcean({ deep: '#1c2f6a', shallow: '#3a7aa6', skyHorizon: '#ff9a6a', level: 0 }));

    const hw = track.width / 2;
    const frame = makeFrame();
    const palms: PalmPlacement[] = [];
    const umbrellas: Placement[] = [];
    /** For each umbrella: the direction toward the sea (unit x, z). */
    const seaward = new Map<Placement, [number, number]>();
    const towers: Placement[] = [];
    const hotels: { x: number; y: number; z: number; w: number; h: number; d: number; yaw: number; color: THREE.Color }[] = [];

    // Palm avenue along both sides of the road + umbrellas and towers on the beach side.
    for (let d = 0; d < track.length; d += 16 + rng.range(0, 10)) {
      if (track.sectionAt(d, 15)) continue;
      track.frameAt(d, frame);
      for (const side of [-1, 1]) {
        if (rng.chance(0.25)) continue;
        const lat = side * (hw + rng.range(3.5, 9));
        const x = frame.position.x + frame.right.x * lat;
        const z = frame.position.z + frame.right.z * lat;
        palms.push({ x, y: terrain.heightAt(x, z) - 0.2, z, scale: rng.range(0.8, 1.35), yaw: rng.range(0, Math.PI * 2) });
      }
      // Beach side = outside the loop.
      for (const side of [-1, 1]) {
        const probe = side * (hw + 40);
        const px = frame.position.x + frame.right.x * probe;
        const pz = frame.position.z + frame.right.z * probe;
        if (terrain.inside(px, pz)) continue;
        if (rng.chance(0.55)) {
          const lat = side * (hw + rng.range(22, 75));
          const x = frame.position.x + frame.right.x * lat + rng.range(-6, 6);
          const z = frame.position.z + frame.right.z * lat + rng.range(-6, 6);
          const y = terrain.heightAt(x, z);
          if (y > 0.3) {
            const u: Placement = { x, y, z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.9, 1.15) };
            umbrellas.push(u);
            seaward.set(u, [frame.right.x * side, frame.right.z * side]);
          }
        }
        if (rng.chance(0.06)) {
          const lat = side * (hw + 55);
          const x = frame.position.x + frame.right.x * lat;
          const z = frame.position.z + frame.right.z * lat;
          const y = terrain.heightAt(x, z);
          if (y > 0.2) towers.push({ x, y, z, yaw: Math.atan2(frame.right.x * side, frame.right.z * side) });
        }
      }
    }

    // Inland: hotels and palm groves on the island.
    for (let i = 0; i < 900 && hotels.length < 140; i++) {
      const x = rng.range(-500, 1200);
      const z = rng.range(-200, 700);
      if (!terrain.inside(x, z)) continue;
      const dist = terrain.distance(x, z);
      const w = rng.range(18, 50), d = rng.range(14, 34);
      if (dist < hw + 30 + Math.hypot(w, d) / 2) continue;
      const tall = rng.chance(0.15);
      const h = tall ? rng.range(45, 110) : rng.range(10, 36);
      // Face the nearest road point.
      const yaw = Math.round(rng.range(-1, 1)) * 0.3;
      const rad = Math.hypot(w, d) / 2;
      if (hotels.some((o) => Math.hypot(o.x - x, o.z - z) < rad + Math.hypot(o.w, o.d) / 2 + 3)) continue;
      hotels.push({ x, y: terrain.heightAt(x, z) - 1, z, w, h, d, yaw, color: rng.pick(PASTELS) });
    }
    for (let i = 0; i < 700; i++) {
      const x = rng.range(-600, 1300);
      const z = rng.range(-300, 800);
      const dist = terrain.distance(x, z);
      if (dist < hw + 12 || dist > 400) continue;
      const y = terrain.heightAt(x, z);
      if (y < 0.8) continue;
      palms.push({ x, y: y - 0.2, z, scale: rng.range(0.7, 1.3), yaw: rng.range(0, Math.PI * 2) });
    }

    // Beach party. Nine party zones spread evenly round the lap (so there is always one coming up): a reed bar
    // between two rows of poles with festoon lights zigzagging overhead, tiki torches round the bar. They sit
    // on the beach where there is one, otherwise on the grass on the land side. Two of the beach zones are
    // full party corners: a beach volleyball game under the lights, people dancing by the bar, cocktail tables
    // and a row of loungers to watch from. Loungers with sunbathers also stand by the umbrellas all along
    // the beach, and in small groups of their own.
    const bars: Placement[] = [];
    const poles: Placement[] = [];
    const strings: LightString[] = [];
    const torches: Placement[] = [];
    const loungers: Lounger[] = [];
    const tables: { x: number; y: number; z: number }[] = [];
    const courts: VolleyballCourt[] = [];
    const courtSpots: THREE.Vector3[] = [];
    const onCourt = (x: number, z: number, r: number) => courtSpots.some((c) => Math.hypot(c.x - x, c.z - z) < r);
    const dancers: Dancers[] = [];
    const cushions = ['#ff2bd6', '#00c8d8', '#ffd23f', '#ff6a3c', '#ffffff', '#3dff9e'].map((c) => new THREE.Color(c));
    const at = (d: number, lat: number, out = new THREE.Vector3()) => {
      track.frameAt(d, frame);
      out.set(frame.position.x + frame.right.x * lat, 0, frame.position.z + frame.right.z * lat);
      out.y = terrain.heightAt(out.x, out.z);
      return out;
    };
    /** Dry land `lat` metres off the road's edge on this side? */
    const dry = (d: number, side: number, lat: number, min = 0.5) => at(d, side * (hw + lat)).y >= min;
    /**
     * A place for a party zone at distance d: the beach side if the beach is wide enough there, else the land
     * side. Returns the side and how far out the bar stands (from the road's centre line).
     */
    const zoneSpot = (d: number): { side: number; barLat: number; beach: boolean } | null => {
      if (track.sectionAt(d, 75)) return null;
      track.frameAt(d, frame);
      for (const side of [-1, 1]) {
        const probe = side * (hw + 40);
        if (terrain.inside(frame.position.x + frame.right.x * probe, frame.position.z + frame.right.z * probe)) continue;
        for (const lat of [31, 26, 21]) if (dry(d, side, lat) && dry(d, side, lat + 12, 0.45) && dry(d - 40, side, lat) && dry(d + 40, side, lat)) return { side, barLat: hw + lat, beach: true };
      }
      for (const side of [-1, 1]) {
        const probe = side * (hw + 40);
        if (!terrain.inside(frame.position.x + frame.right.x * probe, frame.position.z + frame.right.z * probe)) continue;
        if (dry(d, side, 19, 1) && dry(d - 40, side, 19, 1) && dry(d + 40, side, 19, 1)) return { side, barLat: hw + 19, beach: false };
      }
      return null;
    };
    const zones: { d: number; side: number; barLat: number; beach: boolean; bar: THREE.Vector3 }[] = [];
    const zoneCount = 9;
    for (let k = 0; k < zoneCount; k++) {
      const d0 = (k + 0.35) * (track.length / zoneCount);
      for (const off of [0, 35, -35, 70, -70, 105, -105]) {
        const d = d0 + off;
        const spot = zoneSpot(d);
        if (!spot) continue;
        const bar = at(d, spot.side * spot.barLat);
        track.frameAt(d, frame);
        bars.push({ x: bar.x, y: bar.y - 0.05, z: bar.z, yaw: Math.atan2(-frame.right.x * spot.side, -frame.right.z * spot.side), scale: rng.range(1.0, 1.15) });
        zones.push({ d, ...spot, bar });
        break;
      }
    }
    for (const zn of zones) {
      const { d, side, barLat, bar } = zn;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const x = bar.x + Math.cos(a) * 6.5, z = bar.z + Math.sin(a) * 6.5;
        const y = terrain.heightAt(x, z);
        if (y > 0.4) torches.push({ x, y, z, yaw: 0 });
      }
      // Two rows of poles, 14 m either side of the bar's line, lights zigzagging between them.
      const rowLat = zn.beach ? [barLat - 14, barLat + 14] : [barLat - 9, barLat + 9];
      const rows: (THREE.Vector3 | null)[][] = [[], []];
      for (let i = -4; i <= 4; i++) {
        rowLat.forEach((lat, r) => {
          const p = at(d + i * 14 + (r ? 7 : 0), side * lat);
          if (p.y < 0.45 || Math.hypot(p.x - bar.x, p.z - bar.z) < 6) { rows[r].push(null); return; }
          poles.push({ x: p.x, y: p.y - 0.1, z: p.z, yaw: rng.range(0, Math.PI) });
          rows[r].push(new THREE.Vector3(p.x, p.y + 3.95, p.z));
        });
      }
      for (let i = 0; i < rows[0].length; i++) {
        const a = rows[0][i], b = rows[1][i], a2 = rows[0][i + 1];
        if (a && b) strings.push({ a, b, sag: 1.1 });
        if (b && a2) strings.push({ a: b, b: a2, sag: 1.1 });
        if (a && a2) strings.push({ a, b: a2, sag: 0.6 });
      }
      // Clear the umbrellas from the dance floor.
      for (let i = umbrellas.length - 1; i >= 0; i--) if (Math.hypot(umbrellas[i].x - bar.x, umbrellas[i].z - bar.z) < 62) umbrellas.splice(i, 1);
    }
    // Party corners: two beach zones about half a lap apart.
    const beachZones = zones.filter((z) => z.beach);
    const corners = beachZones.length ? [beachZones[Math.min(1, beachZones.length - 1)], beachZones[Math.min(beachZones.length - 1, 1 + Math.ceil(beachZones.length / 2))]] : [];
    const COURT_SCALE = 1.6; // larger than life, like the rest of the roadside: it has to read from a passing car
    [...new Set(corners)].forEach((zn, ci) => {
      const { d, side, bar } = zn;
      // The court lies 40 m past the bar along the road, lengthwise to it and right beside it (its near side
      // line 4 m from the barrier), on a level pad of sand: you drive past the players at arm's length.
      const dc = d + 40;
      const c = at(dc, side * (hw + 4 + 5.2 * COURT_SCALE));
      courtSpots.push(c.clone());
      track.frameAt(dc, frame);
      const fx = frame.forward.x, fz = frame.forward.z, ox = frame.right.x * side, oz = frame.right.z * side;
      let top = c.y;
      for (const [al, la] of [[-10.5, -5.5], [10.5, -5.5], [-10.5, 5.5], [10.5, 5.5]]) top = Math.max(top, terrain.heightAt(c.x + fx * al + ox * la, c.z + fz * al + oz * la));
      const court = new VolleyballCourt(ci + 1, terrain.mesh.material as THREE.Material);
      court.group.position.set(c.x, top + 0.04, c.z);
      court.group.rotation.y = Math.atan2(-fz, fx);
      court.group.scale.setScalar(COURT_SCALE);
      scene.add(court.group);
      courts.push(court);
      // Dancers between the bar and the court, cocktail tables round the bar.
      const spots: { x: number; y: number; z: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const al = 9 + (i % 4) * 4.2 + rng.range(-0.8, 0.8), la = ((i * 2) % 5 - 2) * 2.4 + rng.range(-0.6, 0.6);
        const x = bar.x + fx * al + ox * la, z = bar.z + fz * al + oz * la;
        spots.push({ x, y: terrain.heightAt(x, z), z });
      }
      const dz = new Dancers(spots, ci + 1, COURT_SCALE);
      scene.add(dz.group);
      dancers.push(dz);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.45;
        const x = bar.x + Math.cos(a) * 8.6, z = bar.z + Math.sin(a) * 8.6;
        const y = terrain.heightAt(x, z);
        if (y > 0.45) tables.push({ x, y, z });
      }
      // A row of loungers along the sea side of the court, foot ends toward the game.
      for (let i = -3; i <= 3; i++) {
        const x = c.x + fx * i * 3 + ox * (5.2 * COURT_SCALE + 3.5), z = c.z + fz * i * 3 + oz * (5.2 * COURT_SCALE + 3.5);
        const y = terrain.heightAt(x, z);
        if (y > 0.4) loungers.push({ x, y, z, yaw: Math.atan2(-ox, -oz), color: rng.pick(cushions), person: rng.chance(0.8) ? rng.int(0, 7) : -1 });
      }
      for (let i = umbrellas.length - 1; i >= 0; i--) if (Math.hypot(umbrellas[i].x - c.x, umbrellas[i].z - c.z) < 26) umbrellas.splice(i, 1);
    });
    // Loungers by the umbrellas (one or two each, foot end toward the sea), most of them taken.
    for (const u of umbrellas) {
      const out = seaward.get(u);
      if (!out) continue;
      const [ox, oz] = out;
      const n = rng.chance(0.6) ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const sd = n === 2 ? (i ? 1 : -1) : rng.chance(0.5) ? 1 : -1;
        const x = u.x - oz * sd * 1.25 + ox * 0.3, z = u.z + ox * sd * 1.25 + oz * 0.3;
        const y = terrain.heightAt(x, z);
        if (y > 0.35 && !onCourt(x, z, 24)) loungers.push({ x, y, z, yaw: Math.atan2(ox, oz) + rng.range(-0.12, 0.12), color: rng.pick(cushions), person: rng.chance(0.75) ? rng.int(0, 7) : -1 });
      }
    }
    // And groups of three or four on their own, every 60 m or so of beach.
    for (let d = 20; d < track.length; d += 60) {
      if (track.sectionAt(d, 20) || zones.some((z) => Math.abs(z.d - d) < 75)) continue;
      track.frameAt(d, frame);
      for (const side of [-1, 1]) {
        const probe = side * (hw + 40);
        if (terrain.inside(frame.position.x + frame.right.x * probe, frame.position.z + frame.right.z * probe)) continue;
        const lat = hw + rng.range(14, 30);
        const ox = frame.right.x * side, oz = frame.right.z * side, fx = frame.forward.x, fz = frame.forward.z;
        const n = rng.int(3, 4);
        for (let i = 0; i < n; i++) {
          const x = frame.position.x + ox * lat + fx * (i - n / 2) * 1.6, z = frame.position.z + oz * lat + fz * (i - n / 2) * 1.6;
          const y = terrain.heightAt(x, z);
          if (y < 0.4 || onCourt(x, z, 24) || umbrellas.some((u) => Math.hypot(u.x - x, u.z - z) < 3)) continue;
          loungers.push({ x, y, z, yaw: Math.atan2(ox, oz) + rng.range(-0.1, 0.1), color: rng.pick(cushions), person: rng.chance(0.8) ? rng.int(0, 7) : -1 });
        }
        break;
      }
    }
    if (loungers.length) scene.add(createLoungers(loungers));
    if (tables.length) scene.add(createDrinkTables(tables));
    if (courts.length) {
      const playerPos = new THREE.Vector3();
      const live = new THREE.Vector3();
      ctx.onUpdate((time, dt) => {
        // Only animate the games and the dancers you can see: within 350 m of the player.
        const pl = ctx.player();
        track.frameAt(pl.s, frame);
        playerPos.copy(frame.position);
        courts.forEach((court, i) => {
          const near = live.copy(court.group.position).distanceTo(playerPos) < 450;
          court.group.visible = dancers[i].group.visible = near;
          if (!near) return;
          court.update(time, dt);
          dancers[i].update(time);
        });
      });
    }

    // Nothing stands on or in front of the courts: no palms, light poles, light strings or torches.
    const keep = <T extends { x: number; z: number }>(list: T[], r: number) => { for (let i = list.length - 1; i >= 0; i--) if (onCourt(list[i].x, list[i].z, r)) list.splice(i, 1); };
    keep(palms, 24);
    keep(poles, 19);
    keep(torches, 19);
    keep(umbrellas, 24);
    for (let i = strings.length - 1; i >= 0; i--) {
      const st = strings[i];
      if (onCourt(st.a.x, st.a.z, 19) || onCourt(st.b.x, st.b.z, 19) || onCourt((st.a.x + st.b.x) / 2, (st.a.z + st.b.z) / 2, 17)) strings.splice(i, 1);
    }
    palmWind.uWindStrength.value = 1.35; // it's windy at the coast
    scene.add(createPalms(palms));
    if (umbrellas.length) scene.add(createUmbrellas(umbrellas));
    if (towers.length) scene.add(createLifeguardTowers(towers));
    if (bars.length) scene.add(createBeachBars(bars));
    if (poles.length || torches.length) scene.add(createPartyLights(poles, strings, torches));
    if (hotels.length) scene.add(createHotels(hotels));
    const gulls: THREE.Vector3[] = [];
    for (let i = 0; i < 36; i++) {
      track.frameAt(rng.range(0, track.length), frame);
      const side = rng.chance(0.5) ? 1 : -1;
      gulls.push(frame.position.clone().addScaledVector(frame.right, side * rng.range(40, 160)).setY(rng.range(18, 45)));
    }
    scene.add(createSeagulls(gulls));

    // Rooftop billboards on the lower hotels close to the road.
    const roofSpots = hotels
      .filter((h) => h.h < 30 && terrain.distance(h.x, h.z) < 160)
      .slice(0, 16)
      .map((h) => ({ x: h.x, z: h.z, y: h.y + h.h, w: Math.min(h.w, 30), d: h.d, yaw: h.yaw }));
    return { roofSpots };
  },
};
