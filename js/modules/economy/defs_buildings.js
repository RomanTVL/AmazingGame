// Постройки economy: станции производства (плита, костёр, разделочный стол, верстак, кузня, алхимический стол,
// лаборатория перегонки, портняжный стол), растениеводство (ящик для растений, гидролоток, лампа роста),
// чайник на топке, тайник под полом, бочка солёной рыбы.
//
// Модуль build тоже может завести «печь/верстак/грядку» — поэтому всё регистрируется на 'game:init' и только если
// такого id ещё нет; если есть — дописываем свои функциональные поля (econStation, planter, growLamp...).
// Поля economy: econStation {kind: 'cook'|'craft'|'butcher', verb}; planter {fertility, damp};
//   growLamp {radius}; kettle: true; stash {capacity}; smellMask: true; heatSource: true.
import { OWNER } from './state.js';
import { fillMissing } from './defs_items.js';

const k = (id) => `economy.building.${id}`;

export const BUILDINGS = [
  { id: 'stove', size: [2, 1], rotatable: true, category: 'production', placeableOn: 'both', materials: { stone: 20, wood: 10 }, workToBuild: 320, hp: 160, color: '#ff7a5c', econStation: { kind: 'cook', verb: 'cook' }, heatSource: true },
  { id: 'campfire', size: [1, 1], category: 'production', placeableOn: 'ground', materials: { wood: 15 }, workToBuild: 120, hp: 60, color: '#ff9a4a', econStation: { kind: 'cook', verb: 'cook' }, heatSource: true, light: { radius: 4.6, color: '#ff9a4a', intensity: 0.95, flicker: 0.3 } },
  { id: 'butcher_table', size: [2, 1], rotatable: true, category: 'production', placeableOn: 'both', materials: { wood: 20 }, workToBuild: 260, color: '#ff6b6b', econStation: { kind: 'butcher', verb: 'butcher' } },
  { id: 'workbench', size: [2, 1], rotatable: true, category: 'production', placeableOn: 'both', materials: { wood: 30 }, workToBuild: 300, color: '#8fa8ff', econStation: { kind: 'craft', verb: 'make' } },
  { id: 'smithy', size: [2, 1], rotatable: true, category: 'production', placeableOn: 'both', materials: { stone: 30, wood: 10 }, workToBuild: 420, hp: 220, color: '#ffb347', econStation: { kind: 'craft', verb: 'forge' }, heatSource: true, light: { radius: 2.6, color: '#ff8a3a', intensity: 0.7, flicker: 0.25 } },
  { id: 'alchemy_table', size: [2, 1], rotatable: true, category: 'production', placeableOn: 'both', materials: { wood: 20, stone: 10, mana_crystal: 2 }, workToBuild: 400, color: '#5ef2ff', econStation: { kind: 'craft', verb: 'brew' }, light: { radius: 1.8, color: '#5ef2ff', intensity: 0.5 } },
  { id: 'drug_lab', size: [2, 1], rotatable: true, category: 'production', placeableOn: 'both', materials: { wood: 20, stone: 15, mana_crystal: 3 }, workToBuild: 480, color: '#ff3a5a', econStation: { kind: 'craft', verb: 'distill' }, light: { radius: 1.6, color: '#ff3a5a', intensity: 0.45, flicker: 0.1 } },
  { id: 'tailor_bench', size: [2, 1], rotatable: true, category: 'production', placeableOn: 'both', materials: { wood: 25 }, workToBuild: 300, color: '#d8c8ff', econStation: { kind: 'craft', verb: 'sew' } },

  { id: 'planter', size: [1, 1], passable: true, pathCost: 1.4, category: 'production', placeableOn: 'both', materials: { wood: 8 }, workToBuild: 90, hp: 50, color: '#7dff6a', planter: { fertility: 1, damp: true }, bake: true },
  { id: 'grow_tray', size: [1, 2], rotatable: true, passable: true, pathCost: 1.4, category: 'production', placeableOn: 'wagon', materials: { wood: 10, mana_crystal: 1 }, workToBuild: 160, hp: 60, color: '#3dffc5', planter: { fertility: 1.15, damp: true }, bake: true },
  { id: 'grow_lamp', size: [1, 1], category: 'light', placeableOn: 'both', materials: { wood: 5, mana_crystal: 2 }, workToBuild: 140, hp: 40, color: '#e8ffb0', growLamp: { radius: 3.5 }, light: { radius: 3.6, color: '#e8ffb0', intensity: 0.85 } },

  { id: 'kettle', size: [1, 1], category: 'production', placeableOn: 'wagon', materials: { metal: 4 }, workToBuild: 80, hp: 40, color: '#9fe8a0', kettle: true },
  { id: 'stash', size: [1, 1], passable: true, pathCost: 1, category: 'security', placeableOn: 'wagon', materials: { wood: 6 }, workToBuild: 400, hp: 40, color: '#b39ddb', stash: { capacity: 20 }, bake: true },
  { id: 'salted_fish_barrel', size: [1, 1], category: 'storage', placeableOn: 'both', materials: { wood: 12 }, workToBuild: 120, hp: 60, color: '#8fd0ff', smellMask: true },
];

export const BUILDING_IDS = new Set(BUILDINGS.map((b) => b.id));

export function registerBuildings(game) {
  const reg = game.defs.buildings;
  for (const d of BUILDINGS) {
    const def = { nameKey: k(d.id), ...d };
    if (reg.has(d.id)) {
      // чужая запись (build): только наши функциональные поля
      const patch = {};
      for (const key of ['econStation', 'planter', 'growLamp', 'kettle', 'stash', 'smellMask', 'heatSource']) if (d[key] !== undefined) patch[key] = d[key];
      fillMissing(reg, d.id, patch);
    } else reg.add(def, OWNER);
  }
}

export const isStation = (game, b) => !!(b && game.defs.buildings.get(b.defId)?.econStation);
export const isPlanter = (game, b) => !!(b && game.defs.buildings.get(b.defId)?.planter);
