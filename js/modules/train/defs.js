// Определения модуля train: предметы (уголь), постройки поезда (топка, котёл, пульт), природа (угольный пласт),
// руины и декор сценариев, типы вагонов «тендер»/«салон», двигатели, тип работ «Кочегарить», звуки.
import { FUEL_IDS, STEAM_FIXTURES, RUNE_FIXTURES } from './constants.js';

const OWNER = 'train';

export function registerDefs(game) {
  const D = game.defs;

  // ---------- предметы ----------
  if (!D.items.has('coal')) {
    D.items.add({
      id: 'coal', nameKey: 'train.item.coal', category: 'fuel', stackLimit: 75, value: 2,
      color: '#5d6278', icon: 'coal', fuel: { heat: 8 }, traderStock: true,
    }, OWNER);
  } else D.items.extend('coal', { fuel: { heat: 8 }, traderStock: true });
  D.items.extend('wood', { fuel: { heat: 5 }, traderStock: true });
  D.items.extend('mana_crystal', { fuel: { heat: 14 }, traderStock: true });
  // посох проводника — его регистрирует combat; запасной вариант, если боевого модуля нет
  if (!D.items.has('conductor_staff')) {
    D.items.add({
      id: 'conductor_staff', nameKey: 'train.item.conductor_staff', category: 'weapon', stackLimit: 1, value: 0,
      color: '#bffaff', icon: 'crystal', glow: true, unique: true, indestructible: true,
    }, OWNER);
  }

  // ---------- постройки поезда ----------
  const trainB = { category: 'train', buildable: false, indestructible: true, placeableOn: 'wagon', hp: 3000 };
  D.buildings.add({
    ...trainB, id: 'firebox', nameKey: 'train.b.firebox', size: [1, 1], color: '#ff8a3d',
    heat: { radius: 3, warmth: 12 }, stokeable: true,
  }, OWNER);
  D.buildings.add({ ...trainB, id: 'steam_boiler', nameKey: 'train.b.steam_boiler', size: [3, 3], color: '#ffb347' }, OWNER);
  D.buildings.add({ ...trainB, id: 'cab_panel', nameKey: 'train.b.cab_panel', size: [1, 1], color: '#5ef2ff' }, OWNER);
  D.buildings.add({
    ...trainB, id: 'salon_lamp', nameKey: 'train.b.salon_lamp', size: [1, 1], passable: true, pathCost: 1, color: '#ffd36b',
    category: 'light', light: { radius: 4.5, color: '#ffd98a', intensity: 0.9, flicker: 0.03 },
  }, OWNER);

  // ---------- природа и руины ----------
  D.buildings.add({
    id: 'coal_seam', nameKey: 'train.b.coal_seam', category: 'natural', natural: true, buildable: false, mineable: true,
    blocksVision: true, blocksLight: true, hp: 420, yield: { coal: 12 }, workToMine: 420, color: '#7c84a6', bake: true,
  }, OWNER);
  D.buildings.add({
    id: 'derailed_coal_wagon', nameKey: 'train.b.derailed_coal_wagon', category: 'misc', buildable: false, size: [4, 2],
    hp: 400, materials: { metal: 10 }, deconstructYield: { metal: 10 }, workToBuild: 300, placeableOn: 'ground', color: '#c98a4b',
    ruin: true,
  }, OWNER);
  D.buildings.add({
    id: 'conductor_remains', nameKey: 'train.b.conductor_remains', category: 'misc', buildable: false, passable: true,
    pathCost: 1.2, indestructible: true, placeableOn: 'ground', color: '#e8f4ff',
    light: { radius: 2.2, color: '#e8f8ff', intensity: 0.6, flicker: 0.12 },
  }, OWNER);
  D.buildings.add({
    id: 'old_engine_relic', nameKey: 'train.b.old_engine_relic', category: 'misc', buildable: false, size: [2, 2],
    hp: 800, beauty: 4, placeableOn: 'wagon', color: '#d9a066', relic: true,
  }, OWNER);
  // гирлянда свадебного вагона — её регистрирует build; запасной вариант без модуля стройки
  if (!D.buildings.has('garland')) {
    D.buildings.add({
      id: 'garland', nameKey: 'train.b.garland', category: 'misc', buildable: false, passable: true, pathCost: 1, size: [1, 1],
      beauty: 3, placeableOn: 'wagon', color: '#ffcf6b', light: { radius: 2.6, color: '#ffd98a', intensity: 0.7, flicker: 0.2 },
    }, OWNER);
  }

  // ---------- вагоны ----------
  D.wagonTypes.add({ id: 'tender', nameKey: 'train.wagon.tender', length: 6, color: '#c9a46b', light: '#ffe0a0', stockpile: true, fuelOnly: true }, OWNER);
  D.wagonTypes.add({
    id: 'salon', nameKey: 'train.wagon.salon', length: 12, color: '#ffcf4a', light: '#fff1b8', layout: 'residential',
    fixtures: [{ defId: 'salon_lamp', dx: 6, dy: 3 }],
  }, OWNER);

  // ---------- двигатели ----------
  const engines = D.create('engines', { defaults: { heatsCars: false, stoker: false, ambushMul: 1, noiseMax: 1 } });
  engines.add({
    id: 'steam', nameKey: 'train.engine.steam', descKey: 'train.engine.steam_desc', default: true,
    fixtures: STEAM_FIXTURES, heatsCars: true, stoker: true, ambushMul: 1, noiseMax: 1, fuels: FUEL_IDS,
  }, OWNER);
  engines.add({
    id: 'rune', nameKey: 'train.engine.rune', descKey: 'train.engine.rune_desc', price: 800,
    fixtures: RUNE_FIXTURES, heatsCars: false, stoker: false, ambushMul: 0.6, noiseMax: 0.3, fuels: ['mana_crystal'],
  }, OWNER);

  // ---------- работы ----------
  game.jobs.registerWorkType({ id: 'stoking', nameKey: 'train.work.stoking', order: 25, skill: 'mining', defaultPriority: 2 }, OWNER);

  registerSfx(game);
}

function registerSfx(game) {
  const A = game.audio;
  const horn = (dur, delay = 0) => [
    { type: 'osc', wave: 'sawtooth', freq: 233, freqEnd: 228, dur, attack: 0.04, vol: 0.16, delay, filter: { type: 'lowpass', freq: 1500 } },
    { type: 'osc', wave: 'square', freq: 294, freqEnd: 289, dur, attack: 0.05, vol: 0.09, delay, filter: { type: 'lowpass', freq: 1300 } },
    { type: 'osc', wave: 'sawtooth', freq: 350, freqEnd: 344, dur, attack: 0.05, vol: 0.06, delay, filter: { type: 'lowpass', freq: 1800 } },
    { type: 'noise', dur: dur * 0.9, attack: 0.05, vol: 0.05, delay, filter: { type: 'bandpass', freq: 2400, q: 1.2 } },
  ];
  A.registerSfx('train:horn', { cooldown: 0.2, layers: horn(0.55) }, OWNER);
  A.registerSfx('train:horn_double', { cooldown: 0.3, layers: [...horn(0.28), ...horn(0.32, 0.38)] }, OWNER);
  A.registerSfx('train:horn_long', { cooldown: 0.5, layers: horn(1.9) }, OWNER);
  A.registerSfx('train:shovel', { cooldown: 0.08, jitter: 0.15, layers: [
    { type: 'noise', dur: 0.12, vol: 0.32, filter: { type: 'bandpass', freq: 900, q: 0.9 } },
    { type: 'osc', wave: 'triangle', freq: 140, freqEnd: 70, dur: 0.12, vol: 0.25 },
  ] }, OWNER);
  A.registerSfx('train:thump', { cooldown: 0.1, layers: [
    { type: 'osc', wave: 'sine', freq: 70, freqEnd: 38, dur: 0.45, vol: 0.6 },
    { type: 'noise', dur: 0.3, vol: 0.25, filter: { type: 'lowpass', freq: 500, freqEnd: 120 } },
  ] }, OWNER);
  A.registerSfx('train:spill', { cooldown: 0.1, layers: [
    { type: 'noise', dur: 0.25, vol: 0.3, filter: { type: 'highpass', freq: 1800 } },
    { type: 'osc', wave: 'square', freq: 900, freqEnd: 500, dur: 0.06, vol: 0.06, delay: 0.05 },
  ] }, OWNER);
  A.registerSfx('train:valve', { cooldown: 0.9, layers: [
    { type: 'noise', dur: 1.1, attack: 0.08, vol: 0.18, filter: { type: 'highpass', freq: 3500 } },
    { type: 'osc', wave: 'sine', freq: 1850, freqEnd: 1900, dur: 1.0, attack: 0.1, vol: 0.05 },
  ] }, OWNER);
  A.registerSfx('train:crack', { cooldown: 1, layers: [
    { type: 'noise', dur: 0.5, vol: 0.55, filter: { type: 'lowpass', freq: 2600, freqEnd: 300 } },
    { type: 'osc', wave: 'square', freq: 110, freqEnd: 40, dur: 0.5, vol: 0.3 },
    { type: 'noise', dur: 2.2, attack: 0.1, vol: 0.2, delay: 0.3, filter: { type: 'highpass', freq: 2500 } },
  ] }, OWNER);
  A.registerSfx('train:chuff', { cooldown: 0.05, jitter: 0.1, layers: [
    { type: 'noise', dur: 0.14, vol: 0.07, attack: 0.01, filter: { type: 'bandpass', freq: 600, q: 0.7 } },
  ] }, OWNER);
  A.registerSfx('train:charge', { cooldown: 0.08, jitter: 0.1, layers: [
    { type: 'osc', wave: 'sine', freq: 660, freqEnd: 1320, dur: 0.18, vol: 0.12 },
    { type: 'osc', wave: 'triangle', freq: 990, freqEnd: 1980, dur: 0.14, vol: 0.06, delay: 0.04 },
  ] }, OWNER);
  A.registerSfx('train:coin', { cooldown: 0.1, layers: [
    { type: 'osc', wave: 'square', freq: 1568, dur: 0.07, vol: 0.06 },
    { type: 'osc', wave: 'square', freq: 2093, dur: 0.18, vol: 0.06, delay: 0.07 },
  ] }, OWNER);
  A.registerSfx('train:fire', { cooldown: 0.6, layers: [
    { type: 'noise', dur: 0.8, attack: 0.1, vol: 0.18, filter: { type: 'bandpass', freq: 700, q: 0.5 } },
  ] }, OWNER);
  A.registerSfx('train:hop', { cooldown: 0.1, layers: [
    { type: 'noise', dur: 0.08, vol: 0.2, filter: { type: 'lowpass', freq: 800 } },
    { type: 'osc', wave: 'triangle', freq: 300, freqEnd: 520, dur: 0.1, vol: 0.08 },
  ] }, OWNER);
}
