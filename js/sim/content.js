// Базовые определения «вещей» ядра: растения, природные камни, конструкции поезда.
// Схемы определений (контракт для модулей) — docs/ARCHITECTURE.md, разделы «BuildingDef» и «PlantDef».
import { TICKS_PER_HOUR } from '../core/constants.js';

/** Значения по умолчанию для BuildingDef. */
export const BUILDING_DEFAULTS = {
  size: [1, 1],
  rotatable: false,
  passable: false,
  pathCost: 1,
  blocksVision: false,
  blocksLight: false,
  hp: 100,
  materials: {},
  workToBuild: 100,
  placeableOn: 'both', // 'wagon' | 'ground' | 'both'
  category: 'misc',    // structure | furniture | production | light | security | storage | misc | natural | train
  buildable: true,     // показывать в меню стройки (модуль build)
  bake: false,         // рисовать в кэш тайлов (статичные стены); иначе — каждый кадр
  door: false,
  bed: false,
  storage: false,      // на клетке можно хранить предметы, хоть она и непроходима (стеллаж)
  light: null,         // {radius (клетки), color, intensity 0..1, flicker?}
  natural: false,
  mineable: false,
  indestructible: false,
};

export const PLANT_DEFAULTS = {
  blocksMove: false,
  blocksVision: false,
  pathCost: 1,
  choppable: false,
  yield: null,         // при рубке
  harvestYield: null,  // при сборе (растение остаётся, рост → 0)
  regrowHours: 48,
  workToCut: 200,
  workToHarvest: 120,
  biomes: ['forest'],
  light: null,
  bake: true, // рисовать в кэш тайлов (статично); false — каждый кадр (анимация)
};

export const CORE_PLANTS = [
  { id: 'tree_pine', nameKey: 'plant.tree_pine', blocksMove: true, blocksVision: true, choppable: true, yield: { wood: 22 }, workToCut: 300, color: '#2fe39a', canopy: 0.64 },
  { id: 'tree_birch', nameKey: 'plant.tree_birch', blocksMove: true, blocksVision: true, choppable: true, yield: { wood: 16 }, workToCut: 240, color: '#b4ff6a', canopy: 0.55 },
  { id: 'tree_oak', nameKey: 'plant.tree_oak', blocksMove: true, blocksVision: true, choppable: true, yield: { wood: 30 }, workToCut: 380, color: '#5effc8', canopy: 0.78 },
  { id: 'bush_berry', nameKey: 'plant.bush_berry', pathCost: 1.6, harvestYield: { berries: 7 }, regrowHours: 40, workToHarvest: 120, color: '#ff4f7a', canopy: 0.38 },
  { id: 'glowcap', nameKey: 'plant.glowcap', pathCost: 1, color: '#5ef2ff', canopy: 0.2, light: { radius: 1.6, color: '#5ef2ff', intensity: 0.55 } },
];

export const CORE_BUILDINGS = [
  // природа
  { id: 'rock', nameKey: 'building.rock', category: 'natural', natural: true, buildable: false, mineable: true, blocksVision: true, blocksLight: true, hp: 400, yield: { stone: 18 }, workToMine: 360, color: '#8d96b8', bake: true },
  { id: 'ore_iron', nameKey: 'building.ore_iron', category: 'natural', natural: true, buildable: false, mineable: true, blocksVision: true, blocksLight: true, hp: 450, yield: { iron_ore: 14, stone: 4 }, workToMine: 460, color: '#e0915f', bake: true },
  { id: 'mana_vein', nameKey: 'building.mana_vein', category: 'natural', natural: true, buildable: false, mineable: true, blocksVision: true, blocksLight: true, hp: 500, yield: { mana_crystal: 6 }, workToMine: 520, color: '#5ef2ff', bake: true, light: { radius: 2.4, color: '#5ef2ff', intensity: 0.75, flicker: 0.15 } },
  // поезд
  { id: 'wagon_wall', nameKey: 'building.wagon_wall', category: 'train', buildable: false, indestructible: true, blocksVision: true, blocksLight: true, hp: 2000, bake: true, placeableOn: 'wagon', connects: 'wall' },
  { id: 'wagon_window', nameKey: 'building.wagon_window', category: 'train', buildable: false, indestructible: true, blocksVision: false, blocksLight: false, hp: 1500, bake: true, placeableOn: 'wagon', connects: 'wall', window: true },
  { id: 'wagon_door', nameKey: 'building.wagon_door', category: 'train', buildable: false, indestructible: true, passable: true, pathCost: 1.3, door: true, blocksVision: true, hp: 1500, placeableOn: 'wagon', connects: 'wall' },
  { id: 'mana_engine', nameKey: 'building.mana_engine', category: 'train', buildable: false, indestructible: true, size: [2, 2], hp: 3000, placeableOn: 'wagon', light: { radius: 5, color: '#5ef2ff', intensity: 1, flicker: 0.1 } },
];

export function registerContentDefs(game) {
  game.defs.create('plants', { defaults: PLANT_DEFAULTS });
  game.defs.create('buildings', { defaults: BUILDING_DEFAULTS });
  game.defs.plants.addAll(CORE_PLANTS);
  game.defs.buildings.addAll(CORE_BUILDINGS);

  // Рост растений (раз в игровой час): кусты отрастают после сбора
  game.systems.add({
    id: 'plants',
    order: 60,
    update(game) {
      if (game.time.tick % TICKS_PER_HOUR !== 7) return;
      for (const p of game.entities.ofKind('plant')) {
        if ((p.growth ?? 1) >= 1) continue;
        const def = game.defs.plants.get(p.defId);
        p.growth = Math.min(1, (p.growth ?? 0) + 1 / (def?.regrowHours || 48));
        if (p.growth >= 1) game.map.touch(p.x, p.y);
      }
    },
  });
}
