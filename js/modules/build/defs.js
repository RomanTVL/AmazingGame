// Определения построек модуля build (MVP): данные. Отрисовка — art.js (по def.art || def.id).
// Поля сверх BuildingDef ядра (docs/ARCHITECTURE.md §6.1), которые понимает build:
//   menu      — вкладка меню стройки: walls | furniture | light | storage
//   placeMode — 'line' (протяжка линией: стены), 'rect' (полы), иначе одиночная
//   cover     — укрытие для боя 0..1 (читает combat), sittable, table — для mind

/** Вкладки меню стройки (порядок). */
export const MENU_TABS = ['walls', 'furniture', 'light', 'storage'];
/** Категория ядра → вкладка (для построек других модулей без def.menu). */
export const CATEGORY_TAB = { structure: 'walls', furniture: 'furniture', light: 'light', storage: 'storage' };

/** Постройки MVP. */
export const BUILD_DEFS = [
  // ---------------- Стены и двери ----------------
  {
    id: 'wood_wall', nameKey: 'build.b.wood_wall', menu: 'walls', category: 'structure', color: '#ffb86b',
    hp: 220, materials: { wood: 5 }, workToBuild: 180, bake: true, connects: 'wall',
    blocksVision: true, blocksLight: true, cover: 0.75, placeMode: 'line',
  },
  {
    id: 'stone_wall', nameKey: 'build.b.stone_wall', menu: 'walls', category: 'structure', color: '#aab6ff',
    hp: 480, materials: { stone: 5 }, workToBuild: 320, bake: true, connects: 'wall',
    blocksVision: true, blocksLight: true, cover: 0.8, placeMode: 'line',
  },
  {
    id: 'door_wood', nameKey: 'build.b.door_wood', menu: 'walls', category: 'structure', color: '#ffb86b',
    hp: 160, materials: { wood: 6 }, workToBuild: 200, passable: true, pathCost: 1.4, door: true, connects: 'wall',
    blocksVision: true, blocksLight: true, art: 'door',
  },

  // ---------------- Мебель ----------------
  {
    id: 'bed', nameKey: 'build.b.bed', menu: 'furniture', category: 'furniture', color: '#ffb86b',
    size: [1, 2], rotatable: true, passable: true, pathCost: 1.8, bed: true, restEffect: 1.15, comfort: 0.75,
    hp: 140, materials: { wood: 20 }, workToBuild: 480,
  },
  {
    id: 'bedroll', nameKey: 'build.b.bedroll', menu: 'furniture', category: 'furniture', color: '#ff8fc8',
    size: [1, 2], rotatable: true, passable: true, pathCost: 1.2, bed: true, restEffect: 0.95, comfort: 0.4,
    hp: 60, materials: { cloth: 10 }, workToBuild: 150,
  },
  {
    id: 'table', nameKey: 'build.b.table', menu: 'furniture', category: 'furniture', color: '#ffb86b',
    size: [2, 1], rotatable: true, table: true, cover: 0.4, hp: 120, materials: { wood: 18 }, workToBuild: 330,
  },
  {
    id: 'chair', nameKey: 'build.b.chair', menu: 'furniture', category: 'furniture', color: '#ffb86b',
    rotatable: true, passable: true, pathCost: 1.4, sittable: true, comfort: 0.6, hp: 70,
    materials: { wood: 6 }, workToBuild: 110,
  },

  // ---------------- Свет ----------------
  {
    id: 'torch', nameKey: 'build.b.torch', menu: 'light', category: 'light', color: '#ffb347',
    passable: true, pathCost: 1.2, light: { radius: 5.5, color: '#ffb347', intensity: 0.85, flicker: 0.28 },
    hp: 40, materials: { wood: 4 }, workToBuild: 60,
  },

  // ---------------- Склад ----------------
  {
    id: 'chest', nameKey: 'build.b.chest', menu: 'storage', category: 'storage', color: '#ffd27a',
    passable: true, pathCost: 1.5, storage: true, hp: 110, materials: { wood: 12 }, workToBuild: 160,
  },
  {
    id: 'shelf', nameKey: 'build.b.shelf', menu: 'storage', category: 'storage', color: '#ffd27a',
    size: [2, 1], rotatable: true, passable: true, pathCost: 1.5, storage: true, hp: 120, materials: { wood: 15 }, workToBuild: 220,
  },
];

/** Полы в меню стройки (вкладка → id пола ядра). */
export const MENU_FLOORS = [{ id: 'wood_floor', menu: 'walls', color: '#ffb86b' }];

/** Фильтры склада: id → фильтр зоны (null — всё). */
export const STOCK_FILTERS = [
  { id: 'all', filter: null },
  { id: 'resources', filter: { categories: ['resource', 'material', 'fuel'] } },
  { id: 'food', filter: { categories: ['food'] } },
  { id: 'medicine', filter: { categories: ['medicine', 'medical'] } },
];
