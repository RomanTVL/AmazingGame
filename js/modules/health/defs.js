// Определения модуля health: части тела, состояния (ранения, болезни, протезы), типы урона, константы баланса.
// Реестры: game.defs.bodyParts, game.defs.conditions (создаёт этот модуль; другие модули могут дописывать свои
// состояния: game.defs.conditions.add({id, nameKey, kind: 'timed'|'buff'|'disease'|..., hours, caps, pain, workMul})).

/**
 * Часть тела. Внешние части (coverage) получают удары напрямую; внутренние (internal) — только сквозь родителя
 * (torso/head). group — конечность (для протезов/цепочек), side — 'l'|'r', bone — может сломаться,
 * sever — при разрушении отрывается (утрачивается вместе с дочерними), vital — разрушение = мгновенная смерть,
 * bleed — множитель кровотечения, size — относительный размер для отрисовки.
 */
export const BODY_PARTS = [
  { id: 'torso', hp: 40, coverage: 0.3, vital: true, bleed: 1 },
  { id: 'ribs', parent: 'torso', hp: 30, internal: 0.16, bone: true, bleed: 0.6 },
  { id: 'spine', parent: 'torso', hp: 25, internal: 0.07, bone: true, bleed: 0.5 },
  { id: 'heart', parent: 'torso', hp: 15, internal: 0.07, vital: true, bleed: 2.2 },
  { id: 'lung_l', parent: 'torso', hp: 15, internal: 0.13, side: 'l', bleed: 1.4 },
  { id: 'lung_r', parent: 'torso', hp: 15, internal: 0.13, side: 'r', bleed: 1.4 },
  { id: 'liver', parent: 'torso', hp: 20, internal: 0.12, bleed: 1.6 },
  { id: 'stomach', parent: 'torso', hp: 20, internal: 0.12, bleed: 1.1 },
  { id: 'kidney_l', parent: 'torso', hp: 15, internal: 0.07, side: 'l', bleed: 1.3 },
  { id: 'kidney_r', parent: 'torso', hp: 15, internal: 0.07, side: 'r', bleed: 1.3 },
  { id: 'neck', parent: 'torso', hp: 25, coverage: 0.04, vital: true, bleed: 2 },
  { id: 'head', parent: 'neck', hp: 25, coverage: 0.08, vital: true, bone: true, bleed: 1.2 },
  { id: 'brain', parent: 'head', hp: 10, internal: 1, vital: true, bleed: 1 },
  { id: 'eye_l', parent: 'head', hp: 10, coverage: 0.012, side: 'l', sever: true, bleed: 0.6, group: 'eye_l' },
  { id: 'eye_r', parent: 'head', hp: 10, coverage: 0.012, side: 'r', sever: true, bleed: 0.6, group: 'eye_r' },
  { id: 'ear_l', parent: 'head', hp: 12, coverage: 0.01, side: 'l', sever: true, bleed: 0.8 },
  { id: 'ear_r', parent: 'head', hp: 12, coverage: 0.01, side: 'r', sever: true, bleed: 0.8 },
  { id: 'jaw', parent: 'head', hp: 20, coverage: 0.02, bone: true, sever: true, bleed: 1 },
  { id: 'shoulder_l', parent: 'torso', hp: 25, coverage: 0.05, side: 'l', bone: true, sever: true, group: 'arm_l', bleed: 1 },
  { id: 'arm_l', parent: 'shoulder_l', hp: 30, coverage: 0.07, side: 'l', bone: true, sever: true, group: 'arm_l', bleed: 1 },
  { id: 'hand_l', parent: 'arm_l', hp: 20, coverage: 0.035, side: 'l', bone: true, sever: true, group: 'arm_l', bleed: 0.8 },
  { id: 'fingers_l', parent: 'hand_l', hp: 10, coverage: 0.012, side: 'l', sever: true, group: 'arm_l', bleed: 0.6 },
  { id: 'shoulder_r', parent: 'torso', hp: 25, coverage: 0.05, side: 'r', bone: true, sever: true, group: 'arm_r', bleed: 1 },
  { id: 'arm_r', parent: 'shoulder_r', hp: 30, coverage: 0.07, side: 'r', bone: true, sever: true, group: 'arm_r', bleed: 1 },
  { id: 'hand_r', parent: 'arm_r', hp: 20, coverage: 0.035, side: 'r', bone: true, sever: true, group: 'arm_r', bleed: 0.8 },
  { id: 'fingers_r', parent: 'hand_r', hp: 10, coverage: 0.012, side: 'r', sever: true, group: 'arm_r', bleed: 0.6 },
  { id: 'leg_l', parent: 'torso', hp: 35, coverage: 0.09, side: 'l', bone: true, sever: true, group: 'leg_l', bleed: 1.1 },
  { id: 'foot_l', parent: 'leg_l', hp: 20, coverage: 0.03, side: 'l', bone: true, sever: true, group: 'leg_l', bleed: 0.8 },
  { id: 'toes_l', parent: 'foot_l', hp: 8, coverage: 0.01, side: 'l', sever: true, group: 'leg_l', bleed: 0.5 },
  { id: 'leg_r', parent: 'torso', hp: 35, coverage: 0.09, side: 'r', bone: true, sever: true, group: 'leg_r', bleed: 1.1 },
  { id: 'foot_r', parent: 'leg_r', hp: 20, coverage: 0.03, side: 'r', bone: true, sever: true, group: 'leg_r', bleed: 0.8 },
  { id: 'toes_r', parent: 'foot_r', hp: 8, coverage: 0.01, side: 'r', sever: true, group: 'leg_r', bleed: 0.5 },
];

/** Быстрый доступ к частям (заполняется в registerDefs; модули могут добавлять свои части в реестр). */
export const PART = Object.create(null);
for (const p of BODY_PARTS) PART[p.id] = p;

/** Ёмкости (capacities): id → i18n-ключ. */
export const CAPACITIES = ['consciousness', 'moving', 'manipulation', 'sight', 'hearing', 'breathing', 'bloodPumping', 'bloodFiltration'];

/** Тип урона (opts.type) → состояние-ранение и вероятность пробить к внутреннему органу. */
export const DAMAGE_TYPES = {
  cut: { cond: 'cut', pierce: 0.25, sever: true },
  stab: { cond: 'stab', pierce: 0.55, sever: false },
  blunt: { cond: 'bruise', pierce: 0.3, sever: false, fracture: true },
  burn: { cond: 'burn', pierce: 0.04, sever: false },
  bite: { cond: 'bite', pierce: 0.3, sever: true, fracture: 0.3 },
  frost: { cond: 'frostbite', pierce: 0, sever: true },
  rune: { cond: 'rune_burn', pierce: 0.35, sever: true },
  surgery: { cond: 'surgical', pierce: 0, sever: false },
};

/** Синонимы типов урона от других модулей. */
export const DAMAGE_ALIASES = {
  slash: 'cut', claw: 'cut', sword: 'cut', axe: 'cut', blade: 'cut',
  pierce: 'stab', arrow: 'stab', bolt: 'stab', bullet: 'stab', shot: 'stab', spear: 'stab', knife: 'stab', gunshot: 'stab',
  crush: 'blunt', club: 'blunt', fall: 'blunt', punch: 'blunt', blast: 'blunt', explosion: 'blunt', damage: 'blunt', unknown: 'blunt', melee: 'blunt',
  fire: 'burn', flame: 'burn', heat: 'burn', scald: 'burn',
  ice: 'frost', cold: 'frost', freeze: 'frost',
  magic: 'rune', spell: 'rune', lightning: 'rune', arcane: 'rune',
  surgical: 'surgery',
};

/**
 * Состояния. kind:
 *  'injury' — ранение на части (severity — очки урона), 'fracture' — перелом (0..1), 'missing' — утраченная часть,
 *  'scar' — шрам (постоянно), 'prosthetic' — протез, 'disease' — болезнь с гонкой иммунитета (0..1, 1 = смерть),
 *  'chronic' — накопительное (истощение), 'timed' — на время (hours), 'buff' — польза на время.
 * pain — боль за единицу тяжести (injury) или при тяжести 1 (прочие); painFlat — постоянная боль;
 * bleed — кровопотеря (доля объёма крови в сутки) за очко тяжести; caps — множители ёмкостей при тяжести 1.
 */
export const CONDITION_DEFS = [
  { id: 'cut', kind: 'injury', open: true, pain: 0.012, bleed: 0.06, scar: 0.25, color: '#ff5f6d' },
  { id: 'stab', kind: 'injury', open: true, pain: 0.014, bleed: 0.075, scar: 0.25, color: '#ff4f7a' },
  { id: 'bruise', kind: 'injury', pain: 0.01, bleed: 0.006, scar: 0, color: '#b48cff' },
  { id: 'burn', kind: 'injury', open: true, pain: 0.018, bleed: 0.004, scar: 0.5, infMul: 0.7, color: '#ffb347' },
  { id: 'bite', kind: 'injury', open: true, pain: 0.013, bleed: 0.055, scar: 0.3, infMul: 1.6, color: '#ff6b6b' },
  { id: 'frostbite', kind: 'injury', pain: 0.012, bleed: 0, scar: 0.4, color: '#9fd8ff' },
  { id: 'rune_burn', kind: 'injury', open: true, pain: 0.016, bleed: 0.02, scar: 0.35, color: '#c77dff' },
  { id: 'surgical', kind: 'injury', open: true, pain: 0.01, bleed: 0.03, scar: 0.15, color: '#ff8fa3' },
  { id: 'fracture', kind: 'fracture', painFlat: 0.12, healTended: 0.13, healUntended: 0.04, color: '#ffb347' },
  { id: 'missing', kind: 'missing', painFlat: 0.1, bleedPerHp: 0.035, color: '#5c6383' },
  { id: 'scar', kind: 'scar', painFlat: 0.012, permanent: true, color: '#c9a0b8' },
  { id: 'infection', kind: 'disease', onPart: true, growth: 0.42, immunity: 0.3, pain: 0.3, caps: { consciousness: 0.8 }, lethal: 'infection', color: '#9dff6a' },
  { id: 'grey_rot', kind: 'disease', growth: 0.14, immunity: 0.16, pain: 0.35, caps: { consciousness: 0.75, moving: 0.6, manipulation: 0.7 }, lethal: 'grey_rot', color: '#a9b0b8' },
  { id: 'fever', kind: 'disease', growth: 0.28, immunity: 0.34, pain: 0.2, caps: { consciousness: 0.7, moving: 0.8 }, lethal: 'fever', color: '#ff9f43' },
  { id: 'malnutrition', kind: 'chronic', pain: 0.1, caps: { consciousness: 0.6, moving: 0.5, manipulation: 0.7 }, lethal: 'starvation', color: '#d8b07a' },
  { id: 'food_poisoning', kind: 'timed', hours: 10, pain: 0.25, caps: { consciousness: 0.85, moving: 0.7, manipulation: 0.85 }, color: '#b4ff6a' },
  { id: 'rested', kind: 'buff', hours: 12, workMul: 1.1, color: '#7dff6a' },
  // протезы (ставятся хирургией на утраченную часть; eff — эффективность заменённой цепочки)
  { id: 'peg_leg', kind: 'prosthetic', groups: ['leg_l', 'leg_r'], eff: 0.6, item: 'peg_leg', color: '#c98a4b' },
  { id: 'wooden_hand', kind: 'prosthetic', groups: ['arm_l', 'arm_r'], parts: ['hand_l', 'hand_r', 'fingers_l', 'fingers_r'], eff: 0.5, item: 'wooden_hand', color: '#d8a46b' },
  { id: 'rune_arm', kind: 'prosthetic', groups: ['arm_l', 'arm_r'], eff: 1.05, item: 'rune_arm', color: '#5ef2ff' },
  { id: 'glass_eye', kind: 'prosthetic', groups: ['eye_l', 'eye_r'], eff: 0, item: 'glass_eye', color: '#bfefff' },
];

/** Протезы-предметы (крафт: материалы ядра; economy может добавить рецепты). */
export const PROSTHETIC_ITEMS = [
  { id: 'peg_leg', cond: 'peg_leg', materials: { wood: 20 }, work: 900, color: '#c98a4b', value: 25 },
  { id: 'wooden_hand', cond: 'wooden_hand', materials: { wood: 15 }, work: 900, color: '#e0b07a', value: 22 },
  { id: 'rune_arm', cond: 'rune_arm', materials: { wood: 10, mana_crystal: 8 }, work: 1600, color: '#5ef2ff', value: 120 },
  { id: 'glass_eye', cond: 'glass_eye', materials: { mana_crystal: 2 }, work: 600, color: '#bfefff', value: 30 },
];

/** Известные лекарства других модулей без поля medicine (потенция по id). */
export const MEDICINE_GUESS = {
  medicine: 0.9, medicine_industrial: 1, herbal_medicine: 0.6, potion_healing: 1.3, healing_potion: 1.3,
  potion_heal: 1.3, potion_antidote: 0.8, potion_infection: 1.2, potion_cure: 1.2, bandage: 0.45,
};

/** Баланс (в сутках/часах игры). */
export const BAL = {
  bloodRegenPerDay: 0.4,
  healUntended: 1.5,
  healTendedBase: 3,
  healTendedQ: 6,
  bedHealMul: 1.4,
  infectChance: 0.3,
  infectAfterHours: 3,
  painShock: 0.8,
  downedConsciousness: 0.3,
  downedMoving: 0.15,
  downedBloodLoss: 0.6,
  treatHours: 20,
  dyingMin: 1800,
  dyingMax: 2400,
  starvePerHour: 1 / 72,
  starveRecoverPerHour: 0.04,
  feverChancePerDay: 0.008,
  corpseRotPerDay: 0.25,
};

/** Иконки для частиц/крови (палитра, чтобы не плодить цвета частиц). */
export const BLOOD = '#a0102a';
export const BLOOD_DARK = '#5a0716';

export function registerDefs(game) {
  const parts = game.defs.create('bodyParts', { defaults: { hp: 20, bleed: 1 } });
  for (const p of BODY_PARTS) if (!parts.has(p.id)) parts.add({ ...p, nameKey: `health.part.${p.id}` }, 'health');
  const conds = game.defs.create('conditions', { defaults: { kind: 'timed' } });
  for (const c of CONDITION_DEFS) if (!conds.has(c.id)) conds.add({ ...c, nameKey: `health.cond.${c.id}` }, 'health');
}
