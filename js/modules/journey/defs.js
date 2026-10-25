// journey — определения: ландшафт, биомы (пустоши, пики, полосы пути), растения, постройки станций, предметы сюжета,
// звуки. Отрисовка — js/modules/journey/art.js (лениво, только в браузере).
import { TICKS_PER_HOUR } from '../../core/constants.js';
import { generateAsh, generateIce, generateTravel } from './worldgen.js';
import * as art from './art.js';

export const OWNER = 'journey';

/** Новые типы ландшафта (индексный реестр: индексы раздаются по порядку добавления). */
export const TERRAIN = [
  { id: 'ice', nameKey: 'journey.terrain.ice', cost: 1.3, buildable: true, fertile: 0 },
  { id: 'lava_crack', nameKey: 'journey.terrain.lava_crack', cost: 0, buildable: false, fertile: 0, lava: true },
  { id: 'rot', nameKey: 'journey.terrain.rot', cost: 1.15, buildable: true, fertile: 0, rot: true },
  { id: 'cinder', nameKey: 'journey.terrain.cinder', cost: 1.15, buildable: true, fertile: 0 },
  { id: 'gravel', nameKey: 'journey.terrain.gravel', cost: 1, buildable: false, fertile: 0 },
  { id: 'travel_void', nameKey: 'journey.terrain.travel_void', cost: 0, buildable: false, fertile: 0, travelVoid: true },
];

export const FLOORS = [
  { id: 'platform', nameKey: 'journey.floor.platform', cost: 0.85, paint: (...a) => art.paintPlatform(...a) },
  { id: 'bridge_planks', nameKey: 'journey.floor.bridge_planks', cost: 0.95, bridge: true, paint: (...a) => art.paintBridge(...a) },
];

/** Цвета ландшафта, которых нет в палитре леса ядра (дописываем к ней, не трогая существующие). */
const EXTRA_TERRAIN_FOREST = {
  ice: { base: '#0e2133', alt: '#11283d', speck: '#3e7fb0', tuft: null },
  lava_crack: { base: '#2a0804', alt: '#3a0c05', speck: '#ff6a1a', tuft: null },
  rot: { base: '#17171c', alt: '#1d1d24', speck: '#4c4a5e', tuft: null },
  cinder: { base: '#100c0c', alt: '#141010', speck: '#2e1f1a', tuft: null },
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
    ...EXTRA_TERRAIN_FOREST,
    lava_crack: { base: '#2c0703', alt: '#3e0d04', speck: '#ff7a24', tuft: null },
    gravel: { base: '#191416', alt: '#1d171a', speck: '#3a2c2c', tuft: null },
  },
  rail: '#ff9a6a',
  rune: '#ff5fa8',
  fog: '#050203',
  nightTint: '#1a0a08',
  scenery: 'ash',
};

export const ICE_PALETTE = {
  bg: '#05070c',
  terrain: {
    grass: { base: '#111a1c', alt: '#131e21', speck: '#24363a', tuft: '#6fc0b0' },
    dirt: { base: '#161820', alt: '#191b24', speck: '#2c3040', tuft: null },
    stone: { base: '#141a26', alt: '#171e2c', speck: '#2e3a52', tuft: null },
    water: { base: '#03101f', alt: '#041427', speck: '#0a2a52', edge: '#9fe8ff' },
    sand: { base: '#1a1c22', alt: '#1d1f26', speck: '#30343f', tuft: null },
    snow: { base: '#1b2433', alt: '#202a3b', speck: '#43557a', tuft: null },
    ash: { base: '#161822', alt: '#191b26', speck: '#2c3040', tuft: null },
    ...EXTRA_TERRAIN_FOREST,
    ice: { base: '#0f2238', alt: '#12294a', speck: '#5ab0ff', tuft: null },
    gravel: { base: '#151a24', alt: '#181e29', speck: '#2f394d', tuft: null },
  },
  rail: '#bfe0ff',
  rune: '#7fd0ff',
  fog: '#02040a',
  nightTint: '#0a1838',
  scenery: 'ice',
};

export const BIOMES = [
  {
    id: 'ash', nameKey: 'journey.biome.ash', palette: ASH_PALETTE,
    gen: { trees: { dead_tree: 1 }, treeDensity: 0.22, bushDensity: 0.01, glowcapDensity: 0.01, waterLevel: 0.12, rockLevel: 0.66, oreChance: 0.14, manaChance: 0.05, railClear: 6 },
    generate: (game, map, rng, opts) => generateAsh(game, map, rng, opts),
  },
  {
    id: 'ice', nameKey: 'journey.biome.ice', palette: ICE_PALETTE,
    gen: { trees: { snow_pine: 1 }, treeDensity: 0.4, bushDensity: 0.012, glowcapDensity: 0, waterLevel: 0.28, rockLevel: 0.64, oreChance: 0.1, manaChance: 0.07, railClear: 6 },
    generate: (game, map, rng, opts) => generateIce(game, map, rng, opts),
  },
];

/** Биомы карты «в пути» (узкая полоса вокруг поезда): палитра — как у биома, генератор — пустота. */
export function travelBiomes(game) {
  const out = [];
  for (const id of ['forest', 'ash', 'ice']) {
    const base = game.defs.biomes.get(id);
    out.push({
      id: `travel_${id}`, nameKey: base?.nameKey || 'biome.forest', travelOf: id,
      palette: { ...(base?.palette || {}), scenery: id },
      gen: { ...(base?.gen || {}) },
      generate: (g, map, rng, opts) => generateTravel(g, map, rng, opts),
    });
  }
  return out;
}

export const PLANTS = [
  { id: 'dead_tree', nameKey: 'journey.plant.dead_tree', blocksMove: true, blocksVision: true, choppable: true, yield: { wood: 10 }, workToCut: 220, color: '#ff8a5c', canopy: 0.5, biomes: ['ash'], art: 'dead_tree' },
  { id: 'snow_pine', nameKey: 'journey.plant.snow_pine', blocksMove: true, blocksVision: true, choppable: true, yield: { wood: 20 }, workToCut: 320, color: '#8fe3ff', canopy: 0.66, biomes: ['ice'], art: 'snow_pine' },
  { id: 'cinder_bush', nameKey: 'journey.plant.cinder_bush', pathCost: 1.5, harvestYield: { berries: 4 }, regrowHours: 60, workToHarvest: 120, color: '#ff6a3a', canopy: 0.34, biomes: ['ash'], art: 'cinder_bush' },
  { id: 'frost_bush', nameKey: 'journey.plant.frost_bush', pathCost: 1.5, harvestYield: { berries: 5 }, regrowHours: 56, workToHarvest: 120, color: '#bfe6ff', canopy: 0.36, biomes: ['ice'], art: 'frost_bush' },
  { id: 'ember_moss', nameKey: 'journey.plant.ember_moss', pathCost: 1, color: '#ff8a3a', canopy: 0.2, biomes: ['ash'], art: 'ember_moss', light: { radius: 1.5, color: '#ff8a3a', intensity: 0.5 } },
  { id: 'rot_tendril', nameKey: 'journey.plant.rot_tendril', pathCost: 1.3, choppable: true, yield: null, workToCut: 90, color: '#8e86a8', canopy: 0.3, biomes: [], art: 'rot_tendril', rot: true },
];

/** Постройки станций (station: true на экземплярах — их не разбирает «Разобрать лагерь»). */
export const BUILDINGS = [
  // стены
  { id: 'hut_wall', nameKey: 'journey.b.hut_wall', category: 'structure', buildable: false, blocksVision: true, blocksLight: true, hp: 300, bake: true, connects: 'hut', color: '#ffb86b', wallStyle: 'hut', paintBaked: (...a) => art.paintWallStyled(...a) },
  { id: 'ruin_wall', nameKey: 'journey.b.ruin_wall', category: 'structure', buildable: false, blocksVision: true, blocksLight: true, hp: 260, bake: true, connects: 'ruin', color: '#7d8bb8', wallStyle: 'ruin', paintBaked: (...a) => art.paintWallStyled(...a) },
  { id: 'inq_wall', nameKey: 'journey.b.inq_wall', category: 'structure', buildable: false, blocksVision: true, blocksLight: true, hp: 500, bake: true, connects: 'inq', color: '#ff4f5e', wallStyle: 'inq', paintBaked: (...a) => art.paintWallStyled(...a) },
  { id: 'wreck_wall', nameKey: 'journey.b.wreck_wall', category: 'structure', buildable: false, blocksVision: true, blocksLight: true, hp: 600, bake: true, connects: 'wreck', color: '#4fb8a8', wallStyle: 'wreck', paintBaked: (...a) => art.paintWallStyled(...a) },
  { id: 'theatre_wall', nameKey: 'journey.b.theatre_wall', category: 'structure', buildable: false, blocksVision: true, blocksLight: true, hp: 500, bake: true, connects: 'theatre', color: '#ff4fd8', wallStyle: 'theatre', paintBaked: (...a) => art.paintWallStyled(...a) },
  { id: 'monastery_wall', nameKey: 'journey.b.monastery_wall', category: 'structure', buildable: false, blocksVision: true, blocksLight: true, hp: 700, bake: true, connects: 'monastery', color: '#9fd8ff', wallStyle: 'monastery', paintBaked: (...a) => art.paintWallStyled(...a) },
  { id: 'hut_door', nameKey: 'journey.b.hut_door', category: 'structure', buildable: false, passable: true, pathCost: 1.3, door: true, blocksVision: true, hp: 200, color: '#ffb86b', connects: 'hut', draw: (...a) => art.drawDoor(...a) },
  // станция
  { id: 'station_sign', nameKey: 'journey.b.station_sign', category: 'misc', buildable: false, size: [3, 1], hp: 300, color: '#5ef2ff', art: 'sign', draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  { id: 'station_lamp', nameKey: 'journey.b.station_lamp', category: 'light', buildable: false, hp: 120, color: '#ffd9a0', art: 'lamp', light: { radius: 4.5, color: '#ffd9a0', intensity: 0.85, flicker: 0.05 }, draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  { id: 'station_bench', nameKey: 'journey.b.station_bench', category: 'furniture', buildable: false, passable: true, pathCost: 1.6, size: [2, 1], hp: 120, color: '#c99a6b', art: 'bench', seat: true, draw: (...a) => art.drawProp(...a) },
  { id: 'well', nameKey: 'journey.b.well', category: 'misc', buildable: false, hp: 300, color: '#8fc8ff', art: 'well', draw: (...a) => art.drawProp(...a) },
  { id: 'old_campfire', nameKey: 'journey.b.old_campfire', category: 'misc', buildable: false, passable: true, hp: 60, color: '#ff9a4a', art: 'campfire', draw: (...a) => art.drawProp(...a) },
  { id: 'log_pile', nameKey: 'journey.b.log_pile', category: 'natural', natural: true, buildable: false, mineable: true, workToMine: 160, yield: { wood: 30 }, size: [2, 1], hp: 200, color: '#c98a4b', art: 'logs', draw: (...a) => art.drawProp(...a) },
  // руины и тайники
  { id: 'cache_supplies', nameKey: 'journey.b.cache', category: 'natural', natural: true, buildable: false, mineable: true, workToMine: 140, yield: { ration: 8, cloth: 10, wood: 12 }, hp: 120, color: '#ffd27a', art: 'crate', cache: true, draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  { id: 'cache_medicine', nameKey: 'journey.b.cache', category: 'natural', natural: true, buildable: false, mineable: true, workToMine: 140, yield: { medicine_herbal: 5, cloth: 6 }, hp: 120, color: '#7dff9a', art: 'crate', cache: true, draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  { id: 'cache_relics', nameKey: 'journey.b.cache', category: 'natural', natural: true, buildable: false, mineable: true, workToMine: 160, yield: { mana_crystal: 8, iron_ore: 10 }, hp: 120, color: '#5ef2ff', art: 'crate', cache: true, draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  { id: 'skeleton', nameKey: 'journey.b.skeleton', category: 'misc', buildable: false, passable: true, hp: 30, color: '#d8d0c0', art: 'skeleton', draw: (...a) => art.drawProp(...a) },
  // прежний поезд (ст. 4)
  { id: 'wreck_engine', nameKey: 'journey.b.wreck_engine', category: 'natural', natural: true, buildable: false, mineable: true, workToMine: 900, yield: { iron_ore: 30, stone: 6 }, size: [3, 2], hp: 1500, color: '#4fb8a8', art: 'wreck_engine', draw: (...a) => art.drawProp(...a) },
  { id: 'curl_grave', nameKey: 'journey.b.curl_grave', category: 'misc', buildable: false, size: [1, 2], hp: 400, indestructible: true, color: '#ffffff', art: 'curl_grave', draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  // Инквизиция, культ, депо, шахта
  { id: 'inq_banner', nameKey: 'journey.b.inq_banner', category: 'misc', buildable: false, hp: 150, color: '#ff4f5e', art: 'banner', draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  { id: 'watchtower', nameKey: 'journey.b.watchtower', category: 'security', buildable: false, size: [2, 2], hp: 700, color: '#ff4f5e', art: 'tower', light: { radius: 6, color: '#ffe2c0', intensity: 0.7 }, draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  { id: 'cult_shrine', nameKey: 'journey.b.cult_shrine', category: 'misc', buildable: false, size: [2, 2], hp: 900, color: '#b77dff', art: 'shrine', light: { radius: 4, color: '#b77dff', intensity: 0.6, flicker: 0.2 }, draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  { id: 'water_tower', nameKey: 'journey.b.water_tower', category: 'misc', buildable: false, size: [2, 2], hp: 800, color: '#8fc8ff', art: 'water_tower', draw: (...a) => art.drawProp(...a) },
  { id: 'coal_bunker', nameKey: 'journey.b.coal_bunker', category: 'misc', buildable: false, size: [2, 2], hp: 800, color: '#ffb347', art: 'bunker', draw: (...a) => art.drawProp(...a) },
  { id: 'rune_pylon', nameKey: 'journey.b.rune_pylon', category: 'misc', buildable: false, hp: 900, color: '#5ef2ff', art: 'pylon', pylon: true, light: { radius: 3.5, color: '#5ef2ff', intensity: 0.8, flicker: 0.1 }, draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  { id: 'mine_entrance', nameKey: 'journey.b.mine_entrance', category: 'misc', buildable: false, size: [3, 2], hp: 2000, indestructible: true, color: '#e0915f', art: 'mine', draw: (...a) => art.drawProp(...a) },
  { id: 'minecart', nameKey: 'journey.b.minecart', category: 'natural', natural: true, buildable: false, mineable: true, workToMine: 120, yield: { iron_ore: 8 }, hp: 200, color: '#e0915f', art: 'minecart', draw: (...a) => art.drawProp(...a) },
  // Театр Нитей, монастырь, Сердце мира
  { id: 'puppet', nameKey: 'journey.b.puppet', category: 'misc', buildable: false, passable: true, hp: 60, color: '#ff4fd8', art: 'puppet', draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  { id: 'theatre_seat', nameKey: 'journey.b.theatre_seat', category: 'furniture', buildable: false, passable: true, pathCost: 1.5, hp: 80, color: '#c77dff', art: 'seat', draw: (...a) => art.drawProp(...a) },
  { id: 'bell_tower', nameKey: 'journey.b.bell_tower', category: 'misc', buildable: false, size: [2, 2], hp: 1500, indestructible: true, color: '#9fd8ff', art: 'bell', light: { radius: 4, color: '#cfeaff', intensity: 0.6 }, draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  { id: 'world_heart', nameKey: 'journey.b.world_heart', category: 'misc', buildable: false, size: [4, 4], hp: 99999, indestructible: true, color: '#ff6ad5', art: 'heart', light: { radius: 9, color: '#ff9ae0', intensity: 1, flicker: 0.08 }, draw: (...a) => art.drawProp(...a), drawEmissive: (...a) => art.drawPropEmissive(...a) },
  // в пути
  { id: 'track_rubble', nameKey: 'journey.b.track_rubble', category: 'natural', natural: true, buildable: false, mineable: true, workToMine: 520, yield: { stone: 6 }, hp: 400, blocksVision: false, color: '#9aa3b5', art: 'rubble', draw: (...a) => art.drawProp(...a) },
];

export const ITEMS = [
  { id: 'lore_note', nameKey: 'journey.item.lore_note', category: 'misc', stackLimit: 1, value: 0, color: '#ffe6a8', icon: 'note', glow: true, haulable: false, story: true },
  { id: 'faded_thing', nameKey: 'journey.item.faded_thing', category: 'misc', stackLimit: 1, value: 0, color: '#9a98a8', icon: 'doll', haulable: false, story: true },
  { id: 'old_driver_log', nameKey: 'journey.item.old_driver_log', category: 'misc', stackLimit: 1, value: 0, color: '#ffffff', icon: 'book', glow: true, haulable: false, story: true },
];

/** Звуки модуля (процедурные; av может заменить своими с теми же id). */
export const SFX = [
  { id: 'journey_page', cooldown: 0.2, layers: [
    { type: 'noise', dur: 0.18, vol: 0.18, attack: 0.02, filter: { type: 'bandpass', freq: 2600, q: 0.9 } },
    { type: 'noise', dur: 0.12, vol: 0.12, delay: 0.12, filter: { type: 'bandpass', freq: 3400, q: 1.1 } },
  ] },
  { id: 'journey_traveler', cooldown: 0.6, layers: [
    { type: 'osc', wave: 'sine', freq: 220, freqEnd: 218, dur: 1.4, attack: 0.3, vol: 0.08 },
    { type: 'osc', wave: 'sine', freq: 330, freqEnd: 327, dur: 1.6, attack: 0.4, vol: 0.05, delay: 0.15 },
  ] },
  { id: 'journey_rot', cooldown: 1, layers: [
    { type: 'osc', wave: 'sawtooth', freq: 55, freqEnd: 48, dur: 1.6, attack: 0.5, vol: 0.06, filter: { type: 'lowpass', freq: 260 } },
    { type: 'noise', dur: 1.4, vol: 0.05, attack: 0.6, filter: { type: 'lowpass', freq: 500, freqEnd: 200 } },
  ] },
  { id: 'journey_brakes', cooldown: 1, layers: [
    { type: 'noise', dur: 1.1, vol: 0.12, attack: 0.1, filter: { type: 'bandpass', freq: 3200, freqEnd: 1800, q: 6 } },
    { type: 'osc', wave: 'sawtooth', freq: 1900, freqEnd: 1300, dur: 0.9, vol: 0.03, filter: { type: 'bandpass', freq: 1600, q: 5 } },
  ] },
  { id: 'journey_clack', cooldown: 0.12, jitter: 0.1, layers: [
    { type: 'noise', dur: 0.05, vol: 0.12, filter: { type: 'lowpass', freq: 700 } },
    { type: 'noise', dur: 0.05, vol: 0.1, delay: 0.11, filter: { type: 'lowpass', freq: 650 } },
  ] },
  { id: 'journey_dialog', cooldown: 0.3, layers: [
    { type: 'osc', wave: 'triangle', freq: 392, dur: 0.18, vol: 0.08 },
    { type: 'osc', wave: 'triangle', freq: 523, dur: 0.28, vol: 0.07, delay: 0.12 },
  ] },
  { id: 'journey_meteor', cooldown: 1, layers: [
    { type: 'noise', dur: 1.2, vol: 0.4, filter: { type: 'lowpass', freq: 1200, freqEnd: 150 } },
    { type: 'osc', wave: 'sine', freq: 70, freqEnd: 30, dur: 1, vol: 0.5, delay: 0.1 },
  ] },
];

export function registerDefs(game) {
  const d = game.defs;
  for (const t of TERRAIN) if (!d.terrain.has(t.id)) d.terrain.add(t, OWNER);
  for (const f of FLOORS) if (!d.floors.has(f.id)) d.floors.add(f, OWNER);
  // лес ядра: дописываем цвета для новых типов ландшафта (Гниль, лёд, лава и т.п.)
  const forest = d.biomes.get('forest');
  if (forest?.palette) {
    const terr = { ...EXTRA_TERRAIN_FOREST, ...(forest.palette.terrain || {}) };
    d.biomes.extend('forest', { palette: { ...forest.palette, terrain: terr, scenery: 'forest' } });
  }
  for (const b of BIOMES) if (!d.biomes.has(b.id)) d.biomes.add(b, OWNER);
  for (const b of travelBiomes(game)) if (!d.biomes.has(b.id)) d.biomes.add(b, OWNER);
  for (const p of PLANTS) if (!d.plants.has(p.id)) d.plants.add(p, OWNER);
  for (const b of BUILDINGS) if (!d.buildings.has(b.id)) d.buildings.add(b, OWNER);
  for (const it of ITEMS) if (!d.items.has(it.id)) d.items.add(it, OWNER);
  for (const s of SFX) if (!d.sfx.has(s.id)) d.sfx.add(s, OWNER);
  // отрисовщики растений и предметов (по defId)
  for (const p of PLANTS) game.render.registerDefDrawer(p.id, { draw: (...a) => art.drawPlant(...a), drawEmissive: (...a) => art.drawPlantEmissive(...a) });
  for (const it of ITEMS) game.render.registerDefDrawer(it.id, { draw: (...a) => art.drawItem(...a), drawEmissive: (...a) => art.drawItemEmissive(...a) });
  // своя сущность для NPC (Попутчик в сером, жители станций): не пешка — без ИИ, боя, потребностей
  game.entities.registerKind('npc', { static: false, transient: ['bubble'] });
  game.render.registerDrawer('npc', { draw: (...a) => art.drawNpc(...a), drawEmissive: (...a) => art.drawNpcEmissive(...a) });
  // пресеты частиц
  if (!d.fxPresets.has('journey_rot')) {
    d.fxPresets.add({ id: 'journey_rot', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 1, speed: 0.25, angle: -Math.PI / 2, spread: 1.4, life: 2.6, size: 5, color: o.color || '#6e6a80', gravity: -0.15, drag: 0.4, glow: false, alpha: 0.28, grow: 1.8, ...o }) }, OWNER);
    d.fxPresets.add({ id: 'journey_steam', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 6, speed: 1.4, spread: Math.PI * 2, life: 1.8, size: 7, color: o.color || '#d8e4ff', gravity: -0.4, drag: 1.2, glow: false, alpha: 0.35, grow: 2.6, ...o }) }, OWNER);
    d.fxPresets.add({ id: 'journey_meteor', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 40, speed: 6, spread: Math.PI * 2, life: 1.2, size: 2.4, color: o.color || '#9ff8ff', gravity: 2, drag: 1.4, glow: true, ...o }) }, OWNER);
  }
}

export const HOUR = TICKS_PER_HOUR;
