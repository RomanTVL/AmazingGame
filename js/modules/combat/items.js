// Оружие, броня, особые предметы (посох проводника, кристалл сердца), качество, экипировка пешек.
// pawn.equipment.weapon = defId (контракт ядра), pawn.equipment.weaponMeta = {quality, kills, nick, maker};
// pawn.equipment.armor = defId, pawn.equipment.armorMeta = {quality, maker}.
import { TILE } from '../../core/constants.js';
import { sprite } from '../../engine/assets.js';
import { rgba, mix } from '../../render/color.js';
import { drawGlow } from '../../render/glow.js';

export const QUALITIES = [
  { id: 'awful', mul: 0.75, acc: -0.06 },
  { id: 'poor', mul: 0.88, acc: -0.03 },
  { id: 'normal', mul: 1, acc: 0 },
  { id: 'good', mul: 1.1, acc: 0.02 },
  { id: 'excellent', mul: 1.22, acc: 0.04 },
  { id: 'masterwork', mul: 1.38, acc: 0.06 },
  { id: 'legendary', mul: 1.55, acc: 0.08 },
];
const QBY = Object.fromEntries(QUALITIES.map((q) => [q.id, q]));
export const quality = (id) => QBY[id] || QBY.normal;

/**
 * Боевые характеристики. kind: 'melee'|'ranged'; type — тип урона для health ('cut'|'stab'|'blunt'|'burn'|'bite'|'frost'|'rune');
 * cooldown — с; range — клетки (дальний бой), reach — досягаемость ближнего; accuracy 0..1; projectile — стиль снаряда.
 */
export const WEAPON_STATS = {
  bow: { kind: 'ranged', damage: 11, type: 'stab', range: 11, cooldown: 1.6, accuracy: 0.72, projectile: 'arrow', speed: 22, skill: 'shooting', sfx: 'combat:bow' },
  crossbow: { kind: 'ranged', damage: 17, type: 'stab', range: 13, cooldown: 2.6, accuracy: 0.82, projectile: 'bolt', speed: 28, skill: 'shooting', sfx: 'combat:crossbow' },
  short_sword: { kind: 'melee', damage: 12, type: 'cut', reach: 1.5, cooldown: 1.0, accuracy: 0.85, skill: 'melee', metal: true },
  axe: { kind: 'melee', damage: 15, type: 'cut', reach: 1.5, cooldown: 1.35, accuracy: 0.78, skill: 'melee', metal: true },
  spear: { kind: 'melee', damage: 13, type: 'stab', reach: 1.9, cooldown: 1.2, accuracy: 0.82, skill: 'melee', metal: true },
  club: { kind: 'melee', damage: 10, type: 'blunt', reach: 1.5, cooldown: 1.1, accuracy: 0.85, skill: 'melee' },
  knife: { kind: 'melee', damage: 7, type: 'cut', reach: 1.4, cooldown: 0.7, accuracy: 0.9, skill: 'melee', metal: true },
  rune_rifle: { kind: 'ranged', damage: 20, type: 'rune', range: 15, cooldown: 2.2, accuracy: 0.85, projectile: 'rune', speed: 34, skill: 'shooting', sfx: 'combat:rune_shot' },
  rune_staff: { kind: 'ranged', damage: 13, type: 'rune', range: 12, cooldown: 1.4, accuracy: 0.8, projectile: 'rune', speed: 26, skill: 'magic', sfx: 'combat:rune_shot', mage: true },
  conductor_staff: { kind: 'melee', damage: 9, type: 'blunt', reach: 1.9, cooldown: 0.55, accuracy: 0.9, skill: 'melee', mage: true, staff: true },
  // естественное оружие (не предметы)
  fists: { kind: 'melee', damage: 4, type: 'blunt', reach: 1.4, cooldown: 1.0, accuracy: 0.85, skill: 'melee' },
  claws: { kind: 'melee', damage: 8, type: 'cut', reach: 1.5, cooldown: 0.9, accuracy: 0.85, skill: 'melee' },
  bite: { kind: 'melee', damage: 9, type: 'bite', reach: 1.4, cooldown: 0.95, accuracy: 0.86, skill: 'melee' },
  bone_blade: { kind: 'melee', damage: 8, type: 'cut', reach: 1.5, cooldown: 1.1, accuracy: 0.8, skill: 'melee', metal: true },
  bone_bow: { kind: 'ranged', damage: 9, type: 'stab', range: 10, cooldown: 1.9, accuracy: 0.66, projectile: 'arrow', speed: 20, skill: 'shooting', sfx: 'combat:bow' },
  tendril: { kind: 'melee', damage: 9, type: 'blunt', reach: 2.6, cooldown: 1.3, accuracy: 0.8, skill: 'melee' },
  dragon_bite: { kind: 'melee', damage: 25, type: 'cut', reach: 2.4, cooldown: 2.0, accuracy: 0.85, skill: 'melee' },
  lich_bolt: { kind: 'ranged', damage: 14, type: 'rune', range: 13, cooldown: 1.8, accuracy: 0.8, projectile: 'curse', speed: 18, skill: 'magic' },
  clone_bolt: { kind: 'ranged', damage: 5, type: 'rune', range: 11, cooldown: 2.2, accuracy: 0.6, projectile: 'curse', speed: 16, skill: 'magic' },
  heart_lash: { kind: 'melee', damage: 16, type: 'blunt', reach: 3.2, cooldown: 2.4, accuracy: 0.8, skill: 'melee' },
};

/** Снижение урона по типу (0..1, отрицательное — уязвимость). */
export const ARMOR_STATS = {
  armor_leather: { cut: 0.2, stab: 0.15, blunt: 0.1, bite: 0.25, burn: 0.05, frost: 0.1 },
  armor_chain: { cut: 0.45, stab: 0.3, blunt: 0.15, bite: 0.45, burn: 0, frost: 0.05, rune: 0.05 },
  armor_plate: { cut: 0.6, stab: 0.5, blunt: 0.3, bite: 0.6, burn: 0.1, frost: 0.1, rune: 0.1 },
  rune_cloak: { cut: 0.15, stab: 0.1, blunt: 0.05, bite: 0.15, burn: 0.35, frost: 0.35, rune: 0.5 },
};

const W = (id, value, color, extra = {}) => ({
  id, nameKey: `combat.item.${id}`, category: 'weapon', stackLimit: 1, value, color, icon: `combat_${id}`, weapon: WEAPON_STATS[id], ...extra,
});
const A = (id, value, color, extra = {}) => ({
  id, nameKey: `combat.item.${id}`, category: 'apparel', stackLimit: 1, value, color, icon: `combat_${id}`, armor: ARMOR_STATS[id], ...extra,
});

export const ITEM_DEFS = [
  W('bow', 40, '#c98a4b'),
  W('crossbow', 70, '#d9a066'),
  W('short_sword', 55, '#bfe8ff'),
  W('axe', 45, '#ff9f43'),
  W('spear', 40, '#e0c28a'),
  W('club', 15, '#a07850'),
  W('knife', 20, '#d8e4ff'),
  W('rune_rifle', 160, '#5ef2ff', { glow: true }),
  W('rune_staff', 120, '#b77dff', { glow: true }),
  W('conductor_staff', 0, '#5ef2ff', { unique: true, indestructible: true, haulable: false, sellable: false, glow: true, mageWeapon: true }),
  A('armor_leather', 35, '#c9894f'),
  A('armor_chain', 90, '#b8c4dc'),
  A('armor_plate', 180, '#dfe6f5'),
  A('rune_cloak', 140, '#9b6cff', { glow: true }),
  { id: 'heart_crystal', nameKey: 'combat.item.heart_crystal', category: 'misc', stackLimit: 1, value: 0, color: '#ff7ae0', icon: 'combat_heart_crystal', glow: true, unique: true, story: true, haulable: true, sellable: false },
];

/** Рецепты (если economy зарегистрировал реестр и станции): только дополняем, ничего не требуем. */
const RECIPE_SPECS = [
  ['bow', { wood: 12, cloth: 2 }, 'crafting'],
  ['crossbow', { wood: 14, metal: 6 }, 'crafting'],
  ['short_sword', { metal: 10 }, 'crafting'],
  ['axe', { wood: 4, metal: 8 }, 'crafting'],
  ['spear', { wood: 8, metal: 4 }, 'crafting'],
  ['club', { wood: 8 }, 'crafting'],
  ['knife', { metal: 4 }, 'crafting'],
  ['armor_leather', { leather: 14 }, 'crafting'],
  ['armor_chain', { metal: 22 }, 'crafting'],
  ['armor_plate', { metal: 40 }, 'crafting'],
];

export function registerItems(game) {
  for (const def of ITEM_DEFS) {
    if (game.defs.items.has(def.id)) {
      // другой модуль уже зарегистрировал предмет с таким id — дописываем боевые поля, не ломая его
      const ex = game.defs.items.get(def.id);
      game.defs.items.extend(def.id, { weapon: ex.weapon || def.weapon, armor: ex.armor || def.armor });
      continue;
    }
    game.defs.items.add({ ...def, draw: itemIconDrawer, ...(def.glow ? { drawEmissive: itemGlowDrawer } : {}) }, 'combat');
  }
  // рецепты — если реестр есть (economy регистрируется раньше combat)
  const recipes = game.defs.recipes;
  if (recipes) {
    const station = ['smithy', 'workbench', 'crafting_bench'].find((s) => game.defs.buildings.has(s));
    if (station) {
      for (const [id, ing, workType] of RECIPE_SPECS) {
        const rid = `combat_${id}`;
        if (recipes.has(rid)) continue;
        const ingredients = {};
        let ok = true;
        for (const [k, v] of Object.entries(ing)) {
          const alt = k === 'metal' && !game.defs.items.has('metal') ? 'iron_ore' : k === 'leather' && !game.defs.items.has('leather') ? 'cloth' : k;
          if (!game.defs.items.has(alt)) ok = false;
          ingredients[alt] = v;
        }
        if (!ok) continue;
        try {
          recipes.add({ id: rid, nameKey: `combat.item.${id}`, station, ingredients, products: { [id]: 1 }, work: 900, skill: 'crafting', workType }, 'combat');
        } catch (err) {
          game.error(err, 'combat.recipes');
        }
      }
    }
  }
}

// ---------------- Экипировка ----------------
const EMPTY = {};

/** Статы оружия пешки (статический объект, без аллокаций). */
export function weaponStats(game, C, pawn) {
  const id = pawn.equipment?.weapon;
  if (id) {
    const d = game.defs.items.get(id);
    if (d?.weapon) return d.weapon;
  }
  const ed = pawn.enemyId && game.defs.enemies?.get(pawn.enemyId);
  if (ed?.natural) return WEAPON_STATS[ed.natural] || WEAPON_STATS.fists;
  return WEAPON_STATS.fists;
}

export function weaponQuality(pawn) {
  return quality(pawn.equipment?.weaponMeta?.quality);
}

export function isArmed(game, pawn) {
  const id = pawn.equipment?.weapon;
  if (id && game.defs.items.get(id)?.weapon) return true;
  const ed = pawn.enemyId && game.defs.enemies?.get(pawn.enemyId);
  return !!ed?.natural;
}

export const hasStaff = (pawn) => pawn?.equipment?.weapon === 'conductor_staff';

/** Снижение урона бронёй и природной защитой. */
export function armorReduction(game, pawn, type) {
  let r = 0;
  const aid = pawn.equipment?.armor;
  if (aid) {
    const a = game.defs.items.get(aid)?.armor || EMPTY;
    const q = quality(pawn.equipment.armorMeta?.quality).mul;
    r += (a[type] || 0) * Math.min(1.25, q);
  }
  const ed = pawn.enemyId && game.defs.enemies?.get(pawn.enemyId);
  if (ed?.armor) r += ed.armor[type] || 0;
  return Math.max(-0.6, Math.min(0.85, r));
}

/** Создать предмет-оружие/броню на земле с метаданными. @returns {object|null} сущность */
export function spawnGear(game, defId, meta, x, y) {
  if (!game.defs.items.has(defId) || !game.map) return null;
  const [it] = game.items.spawn(defId, 1, Math.floor(x), Math.floor(y));
  if (it && meta) {
    if (meta.quality) it.quality = meta.quality;
    if (meta.kills) it.kills = meta.kills;
    if (meta.nick) it.nick = meta.nick;
    if (meta.maker) it.maker = meta.maker;
  }
  return it || null;
}

const metaOf = (it) => ({ quality: it.quality || 'normal', kills: it.kills || 0, nick: it.nick || null, maker: it.maker || null });

/** Надеть предмет-сущность (оружие или броню). Старое кладётся под ноги. @returns {boolean} */
export function equipItem(game, pawn, it) {
  const def = it && game.defs.items.get(it.defId);
  if (!def || it.removed) return false;
  const eq = (pawn.equipment ||= {});
  const meta = metaOf(it);
  if (def.weapon) {
    if (eq.weapon) dropSlot(game, pawn, 'weapon');
    game.items.take(it, 1);
    eq.weapon = def.id;
    eq.weaponMeta = meta;
  } else if (def.armor) {
    if (eq.armor) dropSlot(game, pawn, 'armor');
    game.items.take(it, 1);
    eq.armor = def.id;
    eq.armorMeta = meta;
  } else return false;
  game.events.emit('combat:equipped', { pawn, defId: def.id });
  return true;
}

/** Снять слот и положить вещь на землю. @returns {object|null} предмет */
export function dropSlot(game, pawn, slot, x = pawn.x, y = pawn.y) {
  const eq = pawn.equipment;
  if (!eq?.[slot]) return null;
  const id = eq[slot];
  const meta = eq[`${slot}Meta`];
  eq[slot] = null;
  delete eq[`${slot}Meta`];
  return spawnGear(game, id, meta, x, y);
}

/** Название оружия с прозвищем: «Тётя Вера» (топор). */
export function gearLabel(game, defId, meta) {
  const name = game.t(game.defs.items.get(defId)?.nameKey || defId);
  return meta?.nick ? game.t('combat.ui.nicknamed', { nick: meta.nick, name }) : name;
}

// ---------------- Иконки предметов (кэшированные спрайты) ----------------
function paintIcon(ctx, id, c) {
  const dark = mix(c, '#000000', 0.7);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = c;
  ctx.shadowBlur = 6;
  ctx.strokeStyle = c;
  ctx.fillStyle = dark;
  ctx.lineWidth = 1.6;
  const line = (x0, y0, x1, y1, w = 1.6, col = c) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  switch (id) {
    case 'bow':
      ctx.beginPath();
      ctx.arc(10, 16, 11, -1.1, 1.1);
      ctx.stroke();
      line(14.8, 6.2, 14.8, 25.8, 0.8, '#f4e6c8');
      line(9, 16, 26, 16, 1, '#e8d8b8');
      break;
    case 'crossbow':
      line(6, 16, 26, 16, 2.4);
      ctx.beginPath();
      ctx.arc(20, 16, 8, -1.3, 1.3);
      ctx.stroke();
      line(22.6, 8.2, 22.6, 23.8, 0.8, '#f4e6c8');
      break;
    case 'short_sword':
      line(9, 23, 24, 8, 2.6, '#e8f6ff');
      line(7, 19, 13, 25, 2, '#c98a4b');
      line(6, 26, 9, 23, 2.4, '#c98a4b');
      break;
    case 'axe':
      line(8, 25, 22, 9, 2.2, '#c98a4b');
      ctx.beginPath();
      ctx.moveTo(18, 7);
      ctx.quadraticCurveTo(27, 8, 26, 17);
      ctx.lineTo(20, 12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = c;
      ctx.stroke();
      break;
    case 'spear':
      line(6, 26, 23, 9, 1.8, '#d9b77a');
      ctx.beginPath();
      ctx.moveTo(27, 5);
      ctx.lineTo(21, 9);
      ctx.lineTo(23, 11);
      ctx.closePath();
      ctx.fillStyle = '#e8f6ff';
      ctx.fill();
      break;
    case 'club':
      ctx.lineWidth = 4;
      line(9, 24, 21, 11, 3, c);
      ctx.beginPath();
      ctx.arc(22, 10, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'knife':
      line(11, 21, 23, 9, 2.2, '#e8f6ff');
      line(8, 24, 12, 20, 2.6, '#7a5030');
      break;
    case 'rune_rifle':
      line(5, 18, 27, 13, 3, '#2a3550');
      line(5, 18, 27, 13, 1.2, c);
      line(9, 19, 8, 24, 2.4, '#5a4030');
      ctx.fillStyle = '#e8ffff';
      ctx.beginPath();
      ctx.arc(17, 15.5, 2.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'rune_staff':
    case 'conductor_staff':
      line(7, 26, 22, 9, 2.2, '#7a5030');
      ctx.fillStyle = id === 'conductor_staff' ? '#bffaff' : '#e2c8ff';
      ctx.beginPath();
      ctx.moveTo(24, 3);
      ctx.lineTo(27.5, 7.5);
      ctx.lineTo(24, 12.5);
      ctx.lineTo(20.5, 7.5);
      ctx.closePath();
      ctx.shadowBlur = 10;
      ctx.fill();
      break;
    case 'armor_leather':
    case 'armor_chain':
    case 'armor_plate':
    case 'rune_cloak': {
      ctx.beginPath();
      ctx.moveTo(10, 7);
      ctx.lineTo(13, 9);
      ctx.lineTo(19, 9);
      ctx.lineTo(22, 7);
      ctx.lineTo(26, 12);
      ctx.lineTo(22, 14);
      ctx.lineTo(22, 26);
      ctx.lineTo(10, 26);
      ctx.lineTo(10, 14);
      ctx.lineTo(6, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (id === 'armor_chain') {
        ctx.fillStyle = rgba(c, 0.8);
        for (let yy = 13; yy < 25; yy += 3) for (let xx = 12; xx < 21; xx += 3) ctx.fillRect(xx, yy, 1.2, 1.2);
      } else if (id === 'armor_plate') {
        line(16, 10, 16, 25, 1, rgba('#ffffff', 0.7));
        line(11, 17, 21, 17, 1, rgba('#ffffff', 0.5));
      } else if (id === 'rune_cloak') {
        ctx.fillStyle = '#e2c8ff';
        ctx.fillRect(15, 15, 2, 2);
        ctx.fillRect(13, 20, 2, 2);
        ctx.fillRect(18, 21, 2, 2);
      }
      break;
    }
    case 'heart_crystal':
      ctx.fillStyle = rgba(c, 0.85);
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(16, 26);
      ctx.bezierCurveTo(4, 17, 7, 6, 16, 11);
      ctx.bezierCurveTo(25, 6, 28, 17, 16, 26);
      ctx.fill();
      ctx.fillStyle = '#ffe8fa';
      ctx.fillRect(12, 12, 2, 2);
      break;
    default:
      ctx.strokeRect(9, 9, 14, 14);
  }
}

export const itemIconDrawer = function drawItemIcon(ctx, e, game, view, def) {
  if (!def) return;
  const key = def.id;
  const spr = sprite(`combat:item:${key}`, 32, 32, (c) => paintIcon(c, key, def.color || '#cccccc'));
  ctx.drawImage(spr, e.x * TILE, e.y * TILE);
  if (e.nick && view.zoom > 0.9) {
    ctx.fillStyle = rgba('#ffd27a', 0.9);
    ctx.fillRect(e.x * TILE + 3, e.y * TILE + 3, 3, 3);
  }
};

function itemGlowDrawer(ctx, e, game, view, alpha, def) {
  drawGlow(ctx, e.x * TILE + 16, e.y * TILE + 16, 24, def?.color || '#5ef2ff', alpha * 0.7);
}

/** Спрайт иконки предмета для HUD/оверлеев. */
export function gearSprite(game, defId) {
  const def = game.defs.items.get(defId);
  if (!def) return null;
  return sprite(`combat:item:${defId}`, 32, 32, (c) => paintIcon(c, defId, def.color || '#cccccc'));
}
