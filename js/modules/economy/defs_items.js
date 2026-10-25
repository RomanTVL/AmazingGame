// Предметы economy: валюта (кроны), материалы, еда и напитки, лекарства, 7 зелий, 2 вымышленных вещества,
// сырьё культур, семена, одежда с клеймом мастера, вспомогательные вещи для тайника (солома, полынь).
// ВЕЩЕСТВА ВЫМЫШЛЕННЫЕ: никаких реальных названий и рецептов.
//
// Поля сверх ItemDef ядра (читают economy и, по желанию, другие модули):
//   tags: ['food'|'water'|'coal'|'wood'|'warm'|'ore'|'drug'|'fuel'] — множители цен на табло;
//   contraband: true — ищет Инквизиция; drug: 'dust'|'fireblood'; potion: id эффекта; treat: 'tea'|'wine'|'cake';
//   throwable: {damage, radius}; apparel: {warmth}; quality: true — изделие с клеймом мастера (не стакается);
//   seedFor: id культуры; stashable: true — можно спрятать в тайник; stashHelper: true — солома/полынь.
import { OWNER } from './state.js';

const k = (id) => `economy.item.${id}`;

/** Предметы с «нашими» уникальными id — регистрируются сразу в register(). */
export const ITEMS = [
  // валюта
  { id: 'silver', category: 'currency', stackLimit: 500, value: 1, color: '#e9ecf7', icon: 'coins', tags: [], haulable: true },

  // сырьё культур и еда
  { id: 'potato', category: 'food', stackLimit: 75, value: 0.7, nutrition: 0.08, foodKind: 'raw', color: '#d9b26f', icon: 'tuber', tags: ['food'] },
  { id: 'grain', category: 'food', stackLimit: 75, value: 0.6, nutrition: 0.06, foodKind: 'raw', color: '#f2d98a', icon: 'grain', tags: ['food'] },
  { id: 'rune_pumpkin', category: 'food', stackLimit: 25, value: 3, nutrition: 0.2, foodKind: 'raw', color: '#ff9f43', icon: 'pumpkin', glow: true, tags: ['food'] },
  { id: 'meal_fine', category: 'food', stackLimit: 10, value: 9, nutrition: 0.95, foodKind: 'meal', color: '#ffd27a', icon: 'meal', tags: ['food'] },
  { id: 'meal_lavish', category: 'food', stackLimit: 10, value: 16, nutrition: 1, foodKind: 'meal', color: '#ff8fe0', icon: 'feast', tags: ['food'] },
  { id: 'stew', category: 'food', stackLimit: 15, value: 3, nutrition: 0.55, foodKind: 'meal', color: '#e0a868', icon: 'bowl', tags: ['food'] },
  { id: 'jerky', category: 'food', stackLimit: 50, value: 2.5, nutrition: 0.3, foodKind: 'preserved', color: '#c46a4a', icon: 'jerky', tags: ['food'] },
  { id: 'cake', category: 'food', stackLimit: 5, value: 15, nutrition: 0.35, foodKind: 'meal', treat: 'cake', color: '#ffb3e6', icon: 'cake', tags: ['food'] },
  { id: 'herbal_tea', category: 'drink', stackLimit: 20, value: 1.2, treat: 'tea', color: '#9fe8a0', icon: 'cup', tags: ['food'] },
  { id: 'wine', category: 'drink', stackLimit: 10, value: 8, treat: 'wine', color: '#e0336f', icon: 'bottle', tags: ['food'] },

  // травы и сырьё веществ
  { id: 'healing_herb', category: 'medicine', stackLimit: 50, value: 3, medicine: { potency: 0.3 }, color: '#7dff9a', icon: 'leaf', tags: [] },
  { id: 'dremotsvet', category: 'drug_raw', stackLimit: 50, value: 6, contraband: true, color: '#c77dff', icon: 'flower', tags: ['drug'], stashable: true },
  { id: 'blood_moss', category: 'drug_raw', stackLimit: 50, value: 7, contraband: true, color: '#ff3a5a', icon: 'moss', tags: ['drug'], stashable: true },
  { id: 'straw', category: 'material', stackLimit: 75, value: 0.3, color: '#e8d27a', icon: 'bundle', tags: [], stashHelper: true },
  { id: 'wormwood', category: 'material', stackLimit: 25, value: 1.5, color: '#a8cf8a', icon: 'bundle', tags: [], stashHelper: true },

  // семена
  { id: 'seeds_rune_pumpkin', category: 'seed', stackLimit: 50, value: 3, seedFor: 'crop_rune_pumpkin', color: '#ffb347', icon: 'seeds', tags: [] },
  { id: 'seeds_dremotsvet', category: 'seed', stackLimit: 50, value: 4, seedFor: 'crop_dremotsvet', color: '#c77dff', icon: 'seeds', tags: [] },
  { id: 'spores_blood_moss', category: 'seed', stackLimit: 50, value: 5, seedFor: 'crop_blood_moss', color: '#ff5f6d', icon: 'seeds', tags: [] },

  // ремесло
  { id: 'vial', category: 'material', stackLimit: 40, value: 2, color: '#bfe8ff', icon: 'vial_empty', tags: [] },
  { id: 'syringe', category: 'material', stackLimit: 30, value: 5, color: '#d8f4ff', icon: 'syringe', tags: [] },

  // одежда (клеймо мастера, качество)
  { id: 'tunic', category: 'apparel', stackLimit: 1, value: 8, quality: true, apparel: { warmth: 2, slot: 'body' }, color: '#d8c8ff', icon: 'shirt', tags: [] },
  { id: 'warm_clothes', category: 'apparel', stackLimit: 1, value: 20, quality: true, apparel: { warmth: 12, slot: 'body' }, color: '#ffb86b', icon: 'coat', tags: ['warm'] },
  { id: 'leather_coat', category: 'apparel', stackLimit: 1, value: 30, quality: true, apparel: { warmth: 8, slot: 'body' }, color: '#c98a5b', icon: 'coat', tags: ['warm'] },

  // зелья (легальная алхимия)
  { id: 'potion_healing', category: 'potion', stackLimit: 10, value: 25, potion: 'healing', color: '#ff5f8a', icon: 'flask', stashable: true, tags: [] },
  { id: 'potion_antidote', category: 'potion', stackLimit: 10, value: 18, potion: 'antidote', color: '#7dff6a', icon: 'flask', stashable: true, tags: [] },
  { id: 'potion_anti_infection', category: 'potion', stackLimit: 10, value: 22, potion: 'anti_infection', color: '#5ef2ff', icon: 'flask', stashable: true, tags: [] },
  { id: 'potion_sleep', category: 'potion', stackLimit: 10, value: 14, potion: 'sleep', color: '#8fa8ff', icon: 'flask', stashable: true, tags: [] },
  { id: 'potion_courage', category: 'potion', stackLimit: 10, value: 26, potion: 'courage', color: '#ffb347', icon: 'flask', stashable: true, tags: [] },
  { id: 'fire_flask', category: 'potion', stackLimit: 10, value: 16, potion: 'fire', throwable: { damage: 18, radius: 1.8 }, color: '#ff6a2a', icon: 'flask_fire', stashable: true, tags: [] },
  { id: 'potion_night_vision', category: 'potion', stackLimit: 10, value: 20, potion: 'night_vision', color: '#b4ff6a', icon: 'flask', stashable: true, tags: [] },

  // вещества (вымышленные)
  { id: 'dream_dust', category: 'drug', stackLimit: 25, value: 14, drug: 'dust', contraband: true, color: '#c9a6ff', icon: 'pouch', stashable: true, tags: ['drug'] },
  { id: 'fireblood', category: 'drug', stackLimit: 20, value: 30, drug: 'fireblood', contraband: true, color: '#ff2a4a', icon: 'vial_red', glow: true, stashable: true, tags: ['drug'] },
];

/**
 * Предметы с «общими» id, которые правдоподобно может завести и другой модуль (топливо — train, лекарства — health,
 * материалы — build). Регистрируются на 'game:init', только если их ещё нет; иначе дописываем недостающие поля.
 */
export const SHARED_ITEMS = [
  { id: 'coal', category: 'fuel', stackLimit: 75, value: 1.5, color: '#6b6f80', icon: 'coal', tags: ['coal', 'fuel', 'ore'] },
  { id: 'water', category: 'resource', stackLimit: 30, value: 1.2, color: '#5ab4ff', icon: 'barrel', tags: ['water'] },
  { id: 'metal', category: 'material', stackLimit: 75, value: 4, color: '#b8c4d8', icon: 'ingot', tags: [] },
  { id: 'leather', category: 'material', stackLimit: 75, value: 3, color: '#c98a5b', icon: 'hide', tags: [] },
  { id: 'components', category: 'material', stackLimit: 50, value: 12, color: '#9fd0ff', icon: 'gear', tags: [] },
  { id: 'medicine_industrial', category: 'medicine', stackLimit: 25, value: 22, medicine: { potency: 1 }, color: '#5ad1ff', icon: 'cross', tags: [] },
];

/** Теги цен для предметов ядра. */
const CORE_ITEM_TAGS = {
  wood: ['wood', 'fuel'], stone: [], iron_ore: ['ore'], mana_crystal: ['fuel'], berries: ['food'], meat_raw: ['food'],
  ration: ['food'], meal_simple: ['food'], medicine_herbal: [], cloth: [],
};

export function registerItems(game) {
  const items = game.defs.items;
  for (const d of ITEMS) {
    const def = { nameKey: k(d.id), ...d };
    if (items.has(d.id)) fillMissing(items, d.id, def);
    else items.add(def, OWNER);
  }
  for (const [id, tags] of Object.entries(CORE_ITEM_TAGS)) if (items.has(id) && !items.get(id).tags) items.extend(id, { tags });
  if (items.has('medicine_herbal')) fillMissing(items, 'medicine_herbal', { stashable: false });
}

/** Вызывается на 'game:init' (все модули уже зарегистрированы). */
export function registerSharedItems(game) {
  const items = game.defs.items;
  for (const d of SHARED_ITEMS) {
    const def = { nameKey: k(d.id), ...d };
    if (items.has(d.id)) fillMissing(items, d.id, { tags: d.tags });
    else items.add(def, OWNER);
  }
}

/** Дописать в чужую запись только отсутствующие поля (не ломая владельца). */
export function fillMissing(reg, id, patch) {
  const def = reg.get(id);
  if (!def) return;
  const add = {};
  for (const [key, v] of Object.entries(patch)) if (def[key] === undefined && key !== 'id' && key !== 'owner') add[key] = v;
  if (Object.keys(add).length) reg.extend(id, add);
}

export const isContraband = (game, defId) => !!game.defs.items.get(defId)?.contraband;
export const isStashable = (game, defId) => {
  const d = game.defs.items.get(defId);
  return !!(d && (d.stashable || d.stashHelper || d.category === 'drug' || d.category === 'potion'));
};

/** Множители качества (0 ужасно … 6 легенда). */
export const QUALITY_MUL = [0.5, 0.75, 1, 1.25, 1.6, 2.4, 4];
export const QUALITY_COLORS = ['#8a8a8a', '#b0a090', '#e8ecff', '#7dff6a', '#5ef2ff', '#ff4fd8', '#ffd27a'];

/** Качество изделия по навыку мастера (детерминированно от rng). */
export function rollQuality(rng, skillLevel) {
  const s = Math.max(0, Math.min(20, skillLevel ?? 3));
  const base = 1 + s * 0.22 + rng.normal(0, 0.9);
  return Math.max(0, Math.min(6, Math.round(base)));
}
