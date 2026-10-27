// journey — определения (MVP): ландшафт (Гниль, пепел-шлак, трещины, гравий, «пустота» пути), биомы пепельной пустоши
// и карты «в пути», растения пустоши, постройки станций (стены хижин/руин, тайники), параметры сложности, звуки.
import { generateAsh, generateTravel } from './worldgen.js';

export const OWNER = 'journey';

export const TERRAIN = [
  { id: 'rot', nameKey: 'journey.terrain.rot', cost: 1.15, buildable: true, fertile: 0, rot: true },
  { id: 'cinder', nameKey: 'journey.terrain.cinder', cost: 1.15, buildable: true, fertile: 0 },
  { id: 'lava_crack', nameKey: 'journey.terrain.lava_crack', cost: 0, buildable: false, fertile: 0, lava: true },
  { id: 'gravel', nameKey: 'journey.terrain.gravel', cost: 1, buildable: false, fertile: 0 },
  { id: 'travel_void', nameKey: 'journey.terrain.travel_void', cost: 0, buildable: false, fertile: 0, travelVoid: true },
];

/** Цвета новых типов ландшафта для палитры леса ядра. */
const EXTRA_TERRAIN = {
  rot: { base: '#1c1726', alt: '#241c30', speck: '#5a4a78', tuft: null },
  cinder: { base: '#100c0c', alt: '#141010', speck: '#2e1f1a', tuft: null },
  lava_crack: { base: '#2a0804', alt: '#3a0c05', speck: '#ff6a1a', tuft: null },
  gravel: { base: '#16151a', alt: '#1a191f', speck: '#34323e', tuft: null },
  travel_void: { base: '#05070c', alt: '#06080e', speck: '#0b0f18', tuft: null },
};

export const ASH_PALETTE = {
  bg: '#070405',
  terrain: {
    grass: { base: '#121410', alt: '#15170f', speck: '#2b3020', tuft: '#8a7a3a' },
    dirt: { base: '#17110d', alt: '#1b140f', speck: '#33241a', tuft: null },
    stone: { base: '#16121a', alt: '#1a1520', speck: '#34283e', tuft: null },
    water: { base: '#0b1418', alt: '#0d171c', speck: '#1a3038', edge: '#ff9a4a' },
    sand: { base: '#1e1710', alt: '#231b12', speck: '#3d2e1c', tuft: null },
    snow: { base: '#22202a', alt: '#26232e', speck: '#3c3846', tuft: null },
    ash: { base: '#18130f', alt: '#201812', speck: '#3e2c22', tuft: null },
    ...EXTRA_TERRAIN,
    lava_crack: { base: '#2c0703', alt: '#3e0d04', speck: '#ff7a24', tuft: null },
    gravel: { base: '#191416', alt: '#1d171a', speck: '#3a2c2c', tuft: null },
  },
  rail: '#ff9a6a',
  rune: '#ff5fa8',
  fog: '#050203',
  nightTint: '#1a0a08',
};

export const PLANTS = [
  { id: 'dead_tree', nameKey: 'journey.plant.dead_tree', blocksMove: true, blocksVision: true, choppable: true, yield: { wood: 10 }, workToCut: 220, color: '#b0704a', canopy: 0.5 },
  { id: 'cinder_bush', nameKey: 'journey.plant.cinder_bush', pathCost: 1.5, harvestYield: { berries: 4 }, regrowHours: 60, workToHarvest: 120, color: '#ff6a3a', canopy: 0.34 },
];

/** Постройки станций (не строятся игроком). */
export const BUILDINGS = [
  { id: 'hut_wall', nameKey: 'journey.b.hut_wall', category: 'structure', buildable: false, blocksVision: true, blocksLight: true, hp: 300, bake: true, connects: 'hut', color: '#c98a4b' },
  { id: 'ruin_wall', nameKey: 'journey.b.ruin_wall', category: 'structure', buildable: false, blocksVision: true, blocksLight: true, hp: 260, bake: true, connects: 'ruin', color: '#7d8bb8' },
  { id: 'cache_supplies', nameKey: 'journey.b.cache', category: 'natural', natural: true, buildable: false, mineable: true, workToMine: 140, yield: { ration: 8, cloth: 6, wood: 10 }, hp: 120, color: '#ffd27a', cache: true },
  { id: 'cache_medicine', nameKey: 'journey.b.cache', category: 'natural', natural: true, buildable: false, mineable: true, workToMine: 140, yield: { medicine_herbal: 4, cloth: 4 }, hp: 120, color: '#7dff9a', cache: true },
  { id: 'cache_coal', nameKey: 'journey.b.cache_coal', category: 'natural', natural: true, buildable: false, mineable: true, workToMine: 160, yield: { coal: 25 }, hp: 120, color: '#9aa3c8', cache: true },
];

export const SFX = [
  { id: 'journey_rot', cooldown: 1, layers: [
    { type: 'osc', wave: 'sawtooth', freq: 55, freqEnd: 48, dur: 1.6, attack: 0.5, vol: 0.06, filter: { type: 'lowpass', freq: 260 } },
    { type: 'noise', dur: 1.4, vol: 0.05, attack: 0.6, filter: { type: 'lowpass', freq: 500, freqEnd: 200 } },
  ] },
  { id: 'journey_brakes', cooldown: 1, layers: [
    { type: 'noise', dur: 1.1, vol: 0.12, attack: 0.1, filter: { type: 'bandpass', freq: 3200, freqEnd: 1800, q: 6 } },
    { type: 'osc', wave: 'sawtooth', freq: 1900, freqEnd: 1300, dur: 0.9, vol: 0.03, filter: { type: 'bandpass', freq: 1600, q: 5 } },
  ] },
  { id: 'journey_victory', cooldown: 2, layers: [
    { type: 'osc', wave: 'triangle', freq: 392, dur: 0.3, vol: 0.1 },
    { type: 'osc', wave: 'triangle', freq: 523, dur: 0.3, vol: 0.1, delay: 0.25 },
    { type: 'osc', wave: 'triangle', freq: 659, dur: 0.8, vol: 0.1, delay: 0.5 },
  ] },
];

/** Числовые параметры сложности (рейды/Гниль). */
export const DIFFICULTY = {
  easy: { threat: 0.6, rotMul: 1.3, incidentGood: 1.4 },
  normal: { threat: 1, rotMul: 1, incidentGood: 1 },
  hard: { threat: 1.4, rotMul: 0.8, incidentGood: 0.8 },
  brutal: { threat: 1.9, rotMul: 0.65, incidentGood: 0.6 },
};

export function registerDefs(game) {
  const d = game.defs;
  for (const t of TERRAIN) if (!d.terrain.has(t.id)) d.terrain.add(t, OWNER);
  // пол вагона — «мост» над пустотой пути (иначе вагоны на карте пути непроходимы)
  d.floors.extend('wagon_planks', { bridge: true });
  const forest = d.biomes.get('forest');
  if (forest?.palette) d.biomes.extend('forest', { palette: { ...forest.palette, terrain: { ...EXTRA_TERRAIN, ...(forest.palette.terrain || {}) } } });
  if (!d.biomes.has('ash')) {
    d.biomes.add({
      id: 'ash', nameKey: 'journey.biome.ash', palette: ASH_PALETTE,
      gen: { trees: { dead_tree: 1 }, treeDensity: 0.22, bushDensity: 0.012, glowcapDensity: 0, waterLevel: 0.12, rockLevel: 0.66, oreChance: 0.12, manaChance: 0.04, coalChance: 0.16, railClear: 6 },
      generate: (g, map, rng, opts) => generateAsh(g, map, rng, opts),
    }, OWNER);
  }
  if (!d.biomes.has('travel')) {
    d.biomes.add({
      id: 'travel', nameKey: 'journey.biome.travel', palette: { ...(forest?.palette || ASH_PALETTE), terrain: { ...(forest?.palette?.terrain || {}), ...EXTRA_TERRAIN } },
      gen: { railClear: 6 },
      generate: (g, map) => generateTravel(g, map),
    }, OWNER);
  }
  for (const p of PLANTS) if (!d.plants.has(p.id)) d.plants.add(p, OWNER);
  for (const b of BUILDINGS) if (!d.buildings.has(b.id)) d.buildings.add(b, OWNER);
  for (const s of SFX) if (!d.sfx.has(s.id)) game.audio.registerSfx(s.id, s, OWNER);
  for (const [id, v] of Object.entries(DIFFICULTY)) if (d.difficulties.has(id)) d.difficulties.extend(id, v);
}
