// Определения построек и полов модуля build (данные). Отрисовка — art.js (по def.art || def.id).
// Поля сверх BuildingDef ядра (docs/ARCHITECTURE.md §6.1), которые понимает build:
//   menu        — вкладка меню стройки: walls|furniture|light|storage|defense|decor|floors|production|misc
//   stuff       — материал для палитры: wood|stone|metal|cloth (варианты — materialOptions/optionStuff)
//   materialOptions — [{...cost}, ...] альтернативы стоимости (выбор в меню); def.materials = первая
//   placeMode   — 'wall' (линия/контур), 'line', 'rect' (полы), 'single'
//   roomWall    — ограничивает комнаты (стены, двери, частокол)
//   beauty, comfort (0..1), cover (0..1 — укрытие для боя), quality (есть ли качество)
//   heat {radius, warmth} — источник тепла (общее поле: его ставят и другие модули)
//   sittable, table, wallMounted (true — обязательно у стены, 'prefer' — по возможности), needsWindow
//   talisman, swing (качается — для av), plaque (табличка памяти), lockable / lockedOf / lockedVariant (двери)
//   trap {damage, cooldownTicks} — простая ловушка; kitchen (false — не кухонная станция)

/** Палитры материалов (неон). */
export const STUFF = {
  wood: { line: '#ffb86b', body: '#24150b', mid: '#5a3416', hi: '#ffe0b8' },
  stone: { line: '#aab6ff', body: '#141828', mid: '#323a5c', hi: '#e2e7ff' },
  metal: { line: '#8ff0ff', body: '#0b1820', mid: '#284452', hi: '#e8fdff' },
  cloth: { line: '#ff8fc8', body: '#24101c', mid: '#5a2440', hi: '#ffd8ec' },
};
export const FADED_STUFF = { line: '#8d93a6', body: '#141519', mid: '#2c2f38', hi: '#c4c8d4' };

const LIGHT_FIRE = (radius, intensity = 0.9, flicker = 0.25, color = '#ffa040') => ({ radius, color, intensity, flicker });

/** Постройки (≥ 25 — требование v1). */
export const BUILD_DEFS = [
  // ---------------- Стены и двери ----------------
  {
    id: 'wood_wall', nameKey: 'build.b.wood_wall', menu: 'walls', category: 'structure', stuff: 'wood', color: '#ffb86b',
    hp: 220, materials: { wood: 5 }, workToBuild: 180, bake: true, connects: 'wall', roomWall: true,
    blocksVision: true, blocksLight: true, cover: 0.75, placeMode: 'wall', art: 'wall',
  },
  {
    id: 'stone_wall', nameKey: 'build.b.stone_wall', menu: 'walls', category: 'structure', stuff: 'stone', color: '#aab6ff',
    hp: 480, materials: { stone: 5 }, workToBuild: 320, bake: true, connects: 'wall', roomWall: true,
    blocksVision: true, blocksLight: true, cover: 0.8, placeMode: 'wall', art: 'wall', beauty: 0.2,
  },
  {
    id: 'palisade', nameKey: 'build.b.palisade', menu: 'walls', category: 'structure', stuff: 'wood', color: '#e8a060',
    hp: 160, materials: { wood: 4 }, workToBuild: 110, bake: true, connects: 'palisade', roomWall: true,
    blocksVision: true, blocksLight: false, cover: 0.65, placeMode: 'wall', placeableOn: 'ground', beauty: -0.3,
  },
  {
    id: 'door_wood', nameKey: 'build.b.door_wood', menu: 'walls', category: 'structure', stuff: 'wood', color: '#ffb86b',
    hp: 160, materials: { wood: 6 }, workToBuild: 200, passable: true, pathCost: 1.4, door: true, roomWall: true,
    blocksVision: true, blocksLight: true, lockable: true, lockedVariant: 'door_wood_locked', art: 'door',
  },
  {
    id: 'door_reinforced', nameKey: 'build.b.door_reinforced', menu: 'walls', category: 'structure', stuff: 'metal', color: '#8ff0ff',
    hp: 420, materials: { wood: 6, metal: 4 }, materialOptions: [{ wood: 6, metal: 4 }, { wood: 6, iron_ore: 8 }], workToBuild: 320,
    passable: true, pathCost: 1.5, door: true, roomWall: true, blocksVision: true, blocksLight: true,
    lockable: true, lockedVariant: 'door_reinforced_locked', art: 'door', cover: 0.3,
  },
  // запертые варианты дверей (не строятся — подменяются при запирании)
  {
    id: 'door_wood_locked', nameKey: 'build.b.door_wood', menu: 'walls', category: 'structure', stuff: 'wood', color: '#ffb86b',
    hp: 160, materials: { wood: 6 }, workToBuild: 200, passable: false, door: true, roomWall: true, blocksVision: true,
    blocksLight: true, buildable: false, lockedOf: 'door_wood', art: 'door', cover: 0.6,
  },
  {
    id: 'door_reinforced_locked', nameKey: 'build.b.door_reinforced', menu: 'walls', category: 'structure', stuff: 'metal', color: '#8ff0ff',
    hp: 420, materials: { wood: 6, metal: 4 }, workToBuild: 320, passable: false, door: true, roomWall: true, blocksVision: true,
    blocksLight: true, buildable: false, lockedOf: 'door_reinforced', art: 'door', cover: 0.75,
  },

  // ---------------- Мебель ----------------
  {
    id: 'bed', nameKey: 'build.b.bed', menu: 'furniture', category: 'furniture', stuff: 'wood', color: '#ffb86b',
    size: [1, 2], rotatable: true, passable: true, pathCost: 1.8, bed: true, restEffect: 1.15, comfort: 0.75, beauty: 1,
    hp: 140, materials: { wood: 25 }, workToBuild: 480, quality: true,
  },
  {
    id: 'bed_double', nameKey: 'build.b.bed_double', menu: 'furniture', category: 'furniture', stuff: 'wood', color: '#ffb86b',
    size: [2, 2], rotatable: true, passable: true, pathCost: 1.8, bed: true, restEffect: 1.22, comfort: 0.82, beauty: 1.6,
    hp: 180, materials: { wood: 40, cloth: 6 }, workToBuild: 720, quality: true,
  },
  {
    id: 'bedroll', nameKey: 'build.b.bedroll', menu: 'furniture', category: 'furniture', stuff: 'cloth', color: '#ff8fc8',
    size: [1, 2], rotatable: true, passable: true, pathCost: 1.2, bed: true, restEffect: 0.95, comfort: 0.4,
    hp: 60, materials: { cloth: 10 }, workToBuild: 150, quality: true,
  },
  {
    id: 'table', nameKey: 'build.b.table', menu: 'furniture', category: 'furniture', stuff: 'wood', color: '#ffb86b',
    size: [2, 1], rotatable: true, table: true, beauty: 1, cover: 0.4, hp: 120, materials: { wood: 18 }, workToBuild: 330, quality: true,
  },
  {
    id: 'chair', nameKey: 'build.b.chair', menu: 'furniture', category: 'furniture', stuff: 'wood', color: '#ffb86b',
    rotatable: true, passable: true, pathCost: 1.4, sittable: true, comfort: 0.6, beauty: 0.5, hp: 70,
    materials: { wood: 6 }, workToBuild: 110, quality: true,
  },
  {
    id: 'stool', nameKey: 'build.b.stool', menu: 'furniture', category: 'furniture', stuff: 'wood', color: '#ffb86b',
    passable: true, pathCost: 1.3, sittable: true, comfort: 0.4, hp: 50, materials: { wood: 3 }, workToBuild: 60, quality: true,
  },
  {
    id: 'bench', nameKey: 'build.b.bench', menu: 'furniture', category: 'furniture', stuff: 'wood', color: '#ffb86b',
    size: [2, 1], rotatable: true, passable: true, pathCost: 1.4, sittable: true, comfort: 0.5, beauty: 0.3, hp: 90,
    materials: { wood: 10 }, workToBuild: 160, quality: true,
  },
  {
    id: 'window_bench', nameKey: 'build.b.window_bench', menu: 'furniture', category: 'furniture', stuff: 'wood', color: '#ffb86b',
    rotatable: true, passable: true, pathCost: 1.4, sittable: true, comfort: 0.6, beauty: 1, hp: 80,
    materials: { wood: 8, cloth: 2 }, workToBuild: 160, placeableOn: 'wagon', needsWindow: true, quality: true,
  },
  {
    id: 'coat_rack', nameKey: 'build.b.coat_rack', menu: 'furniture', category: 'furniture', stuff: 'wood', color: '#ffb86b',
    passable: true, pathCost: 1.3, beauty: 0.8, hp: 50, materials: { wood: 6 }, workToBuild: 90, quality: true,
  },
  {
    id: 'wardrobe', nameKey: 'build.b.wardrobe', menu: 'furniture', category: 'furniture', stuff: 'wood', color: '#ffb86b',
    size: [2, 1], rotatable: true, beauty: 1.5, cover: 0.5, hp: 160, materials: { wood: 30 }, workToBuild: 420, quality: true,
    bedroomFurniture: true,
  },

  // ---------------- Свет и тепло ----------------
  {
    id: 'torch', nameKey: 'build.b.torch', menu: 'light', category: 'light', stuff: 'wood', color: '#ffb347',
    passable: true, pathCost: 1.2, light: LIGHT_FIRE(5.5, 0.85, 0.28, '#ffb347'), hp: 40, materials: { wood: 4 }, workToBuild: 60, flame: 0.8,
  },
  {
    id: 'brazier', nameKey: 'build.b.brazier', menu: 'light', category: 'light', stuff: 'stone', color: '#ff9f43',
    light: LIGHT_FIRE(6, 0.9, 0.22, '#ff9f43'), heat: { radius: 3, warmth: 8 }, beauty: 1, hp: 140,
    materials: { stone: 10 }, materialOptions: [{ stone: 10 }, { metal: 5 }], optionStuff: ['stone', 'metal'], workToBuild: 160, flame: 1,
  },
  {
    id: 'lantern', nameKey: 'build.b.lantern', menu: 'light', category: 'light', stuff: 'metal', color: '#ffe2a0',
    passable: true, light: { radius: 6, color: '#ffe2a0', intensity: 0.95, flicker: 0.04 }, swing: true, beauty: 1, hp: 50,
    materials: { metal: 3 }, materialOptions: [{ metal: 3 }, { iron_ore: 6 }], workToBuild: 120,
  },
  {
    id: 'candle', nameKey: 'build.b.candle', menu: 'light', category: 'light', stuff: 'wood', color: '#ffd27a',
    passable: true, light: { radius: 2.4, color: '#ffd27a', intensity: 0.6, flicker: 0.18 }, beauty: 0.5, hp: 10,
    materials: { wood: 1, cloth: 1 }, workToBuild: 40, flame: 0.45,
  },
  {
    id: 'campfire', nameKey: 'build.b.campfire', menu: 'light', category: 'light', stuff: 'stone', color: '#ff9a3c',
    placeableOn: 'ground', light: LIGHT_FIRE(7.5, 1, 0.3, '#ff9a3c'), heat: { radius: 5, warmth: 15 }, beauty: 0.5, hp: 80,
    materials: { wood: 12 }, workToBuild: 70, flame: 1.4, cookStation: true,
  },
  {
    id: 'iron_stove', nameKey: 'build.b.iron_stove', menu: 'light', category: 'furniture', stuff: 'metal', color: '#ff8a3c',
    placeableOn: 'wagon', light: { radius: 3.2, color: '#ff8a3c', intensity: 0.7, flicker: 0.3 }, heat: { radius: 4, warmth: 14 },
    beauty: 0.5, hp: 200, materials: { metal: 8 }, materialOptions: [{ metal: 8 }, { iron_ore: 14 }], workToBuild: 300, kitchen: false,
  },

  // ---------------- Хранение ----------------
  {
    id: 'shelf', nameKey: 'build.b.shelf', menu: 'storage', category: 'storage', stuff: 'wood', color: '#ffd27a',
    size: [2, 1], rotatable: true, storage: true, bake: true, beauty: 0.3, hp: 120, materials: { wood: 15 }, workToBuild: 220,
  },
  {
    id: 'chest', nameKey: 'build.b.chest', menu: 'storage', category: 'storage', stuff: 'wood', color: '#ffd27a',
    storage: true, bake: true, beauty: 0.5, hp: 110, materials: { wood: 12 }, workToBuild: 160,
  },

  // ---------------- Оборона ----------------
  {
    id: 'sandbags', nameKey: 'build.b.sandbags', menu: 'defense', category: 'security', stuff: 'cloth', color: '#d9c38a',
    passable: true, pathCost: 3, cover: 0.55, connects: 'sandbag', bake: true, hp: 300, materials: { cloth: 4 }, workToBuild: 90,
    placeMode: 'line', placeableOn: 'both',
  },
  {
    id: 'barricade', nameKey: 'build.b.barricade', menu: 'defense', category: 'security', stuff: 'wood', color: '#ffb86b',
    cover: 0.7, bake: true, hp: 260, materials: { wood: 10 }, workToBuild: 140, placeMode: 'line', beauty: -0.5,
  },
  {
    id: 'spike_trap', nameKey: 'build.b.spike_trap', menu: 'defense', category: 'security', stuff: 'wood', color: '#ff6b6b',
    passable: true, pathCost: 1.6, placeableOn: 'ground', bake: true, hp: 80, materials: { wood: 8 }, workToBuild: 120,
    trap: { damage: 14, cooldownTicks: 120 }, beauty: -1,
  },

  // ---------------- Декор ----------------
  {
    id: 'rug', nameKey: 'build.b.rug', menu: 'decor', category: 'misc', stuff: 'cloth', color: '#ff7ab8',
    size: [2, 2], rotatable: true, passable: true, bake: true, beauty: 2, comfort: 0.1, hp: 60,
    materials: { cloth: 12 }, workToBuild: 200, quality: true,
  },
  {
    id: 'statue', nameKey: 'build.b.statue', menu: 'decor', category: 'misc', stuff: 'stone', color: '#e2e7ff',
    beauty: 6, hp: 300, materials: { stone: 40 }, workToBuild: 1100, quality: true,
  },
  {
    id: 'flower_pot', nameKey: 'build.b.flower_pot', menu: 'decor', category: 'misc', stuff: 'stone', color: '#ff7ab8',
    beauty: 2, hp: 40, materials: { stone: 4 }, materialOptions: [{ stone: 4 }, { wood: 4 }], optionStuff: ['stone', 'wood'], workToBuild: 90, quality: true,
  },
  {
    id: 'horseshoe', nameKey: 'build.b.horseshoe', menu: 'decor', category: 'misc', stuff: 'metal', color: '#c6e2ff',
    passable: true, placeableOn: 'wagon', wallMounted: 'prefer', talisman: true, swing: true, beauty: 1, hp: 30,
    materials: { metal: 1 }, materialOptions: [{ metal: 1 }, { iron_ore: 2 }], workToBuild: 30, tiny: true,
  },
  {
    id: 'cab_bell', nameKey: 'build.b.cab_bell', menu: 'decor', category: 'misc', stuff: 'metal', color: '#ffe08a',
    passable: true, placeableOn: 'wagon', wallMounted: 'prefer', talisman: true, swing: true, beauty: 1, hp: 30,
    materials: { metal: 1 }, materialOptions: [{ metal: 1 }, { iron_ore: 2 }], workToBuild: 30, tiny: true,
  },
  {
    id: 'child_drawing', nameKey: 'build.b.child_drawing', menu: 'decor', category: 'misc', stuff: 'cloth', color: '#fff3a0',
    passable: true, placeableOn: 'wagon', wallMounted: 'prefer', talisman: true, swing: true, beauty: 1, hp: 10,
    materials: { cloth: 1 }, workToBuild: 25, tiny: true,
  },
  {
    id: 'dried_flower', nameKey: 'build.b.dried_flower', menu: 'decor', category: 'misc', stuff: 'cloth', color: '#ffb0c8',
    passable: true, placeableOn: 'wagon', wallMounted: 'prefer', talisman: true, swing: true, beauty: 1, hp: 10,
    materials: {}, workToBuild: 20, tiny: true,
  },
  {
    id: 'garland', nameKey: 'build.b.garland', menu: 'decor', category: 'misc', stuff: 'cloth', color: '#ffd9a0',
    passable: true, wallMounted: 'prefer', swing: true, beauty: 3, hp: 20,
    light: { radius: 2.6, color: '#ffd9a0', intensity: 0.55, flicker: 0.12 }, materials: { cloth: 3 }, workToBuild: 80,
  },
  {
    id: 'memorial_plaque', nameKey: 'build.b.memorial_plaque', menu: 'decor', category: 'misc', stuff: 'wood', color: '#ffd27a',
    passable: true, placeableOn: 'wagon', wallMounted: true, plaque: true, beauty: 1, hp: 60,
    light: { radius: 1.8, color: '#ffd27a', intensity: 0.45, flicker: 0.2 },
    materials: { wood: 10 }, materialOptions: [{ wood: 10 }, { metal: 5 }], optionStuff: ['wood', 'metal'], workToBuild: 260,
  },

  // ---------------- Служебное ----------------
  {
    id: 'rubble', nameKey: 'build.b.rubble', menu: 'misc', category: 'misc', stuff: 'stone', color: '#7a7f96',
    buildable: false, passable: true, pathCost: 1.8, bake: true, beauty: -2, hp: 60, materials: {}, workToBuild: 80, rubble: true,
  },
];

/** Полы: свой ковёр + доработка полов ядра (красота, меню). */
export const BUILD_FLOORS = [
  { id: 'carpet', nameKey: 'build.f.carpet', cost: 0.95, materials: { cloth: 2 }, workToBuild: 70, beauty: 1.5, menu: 'floors', color: '#ff4f8a' },
  { id: 'carpet_blue', nameKey: 'build.f.carpet_blue', cost: 0.95, materials: { cloth: 2 }, workToBuild: 70, beauty: 1.5, menu: 'floors', color: '#5a8cff' },
];
export const FLOOR_PATCHES = {
  wood_floor: { beauty: 0.4, menu: 'floors', color: '#ffb86b' },
  stone_tiles: { beauty: 0.7, menu: 'floors', color: '#aab6ff' },
  wagon_planks: { beauty: 0 },
};

/** Вкладки меню стройки (порядок). */
export const MENU_TABS = ['walls', 'furniture', 'light', 'storage', 'defense', 'decor', 'floors', 'production', 'misc', 'orders'];
/** Категория ядра → вкладка (для построек других модулей без def.menu). */
export const CATEGORY_TAB = {
  structure: 'walls', furniture: 'furniture', light: 'light', storage: 'storage', security: 'defense',
  production: 'production', misc: 'misc', decor: 'decor',
};

/** Предмет «металл», если его не зарегистрировал economy. */
export const METAL_ITEM = { id: 'metal', nameKey: 'build.item.metal', category: 'resource', stackLimit: 75, value: 3, color: '#c6e2ff', icon: 'ore' };

/** Мысли, которые выдаёт build (регистрируются, только если их ещё нет — mind может завести свои). */
export const BUILD_THOUGHTS = [
  { id: 'talisman', nameKey: 'build.th.talisman', mood: 1, days: 0.25 },
  { id: 'cozy_bedroom', nameKey: 'build.th.cozy_bedroom', mood: 3, days: 1 },
  { id: 'impressive_bedroom', nameKey: 'build.th.impressive_bedroom', mood: 5, days: 1 },
  { id: 'awful_bedroom', nameKey: 'build.th.awful_bedroom', mood: -2, days: 1 },
  { id: 'slept_in_barracks', nameKey: 'build.th.slept_in_barracks', mood: -2, days: 1 },
  { id: 'impressive_dining', nameKey: 'build.th.impressive_dining', mood: 3, days: 0.5 },
];

/** Состояние «Отдохнувший» (если модуль health ведёт реестр conditions и такого ещё нет). */
export const RESTED_CONDITION = {
  id: 'rested', nameKey: 'build.cond.rested', descKey: 'build.cond.rested_desc', good: true, kind: 'buff',
  hours: 12, durationHours: 12, workSpeed: 1.1, workSpeedFactor: 1.1, manaRegen: 1.1, manaRegenFactor: 1.1,
};
