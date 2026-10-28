// Навыки: pawn.skills[id] = {level 0..20, xp, passion 'none'|'minor'|'major'}; опыт, страсти, «неспособен к…»,
// множитель скорости работы skillFactor(pawn, workTypeId).
import { SKILL } from '../constants.js';
import { INCAPABLE_TAGS } from '../defs/bio.js';
import { traitEffects } from './traits.js';
import { firstName, num } from './util.js';

const PASSIONS = ['none', 'minor', 'major'];

function normPassion(v) {
  if (PASSIONS.includes(v)) return v;
  if (v === 1 || v === true) return 'minor';
  if (v === 2) return 'major';
  return 'none';
}

/** Привести pawn.skills к виду {id: {level, xp, passion}}, не меняя готовые уровни. */
export function normalizeSkills(game, pawn) {
  const s = (pawn.skills ||= {});
  for (const def of game.defs.skills.all()) {
    let v = s[def.id];
    if (typeof v === 'number') v = s[def.id] = { level: v };
    if (!v || typeof v !== 'object') continue;
    v.level = Math.max(0, Math.min(SKILL.maxLevel, Math.floor(num(v.level, 0))));
    v.xp = Math.max(0, num(v.xp, 0));
    v.passion = normPassion(v.passion);
  }
  return s;
}

/** Работы, к которым пешка неспособна (по биографии). */
export function incapableWork(pawn) {
  const out = new Set();
  for (const tag of pawn?.incapable || []) {
    for (const wt of INCAPABLE_TAGS[tag] || [tag]) out.add(wt);
  }
  return out;
}

/** Неспособен ли к навыку (все его работы закрыты или тег). */
export function skillIncapable(game, pawn, skillId) {
  const tags = pawn?.incapable || [];
  if (!tags.length) return false;
  if (skillId === 'melee' || skillId === 'shooting') return tags.includes('violent');
  if (skillId === 'social' || skillId === 'trade') return tags.includes('social');
  const def = game.defs.skills.get(skillId);
  const inc = incapableWork(pawn);
  return !!def?.workTypes?.length && def.workTypes.every((w) => inc.has(w));
}

/** Сгенерировать навыки: базовые 0–4 + бонусы биографии + опыт возраста; 1–3 страсти. */
export function rollSkills(game, rng, { bonus = {}, age = 30, mage = false, incapable = [] } = {}) {
  const out = {};
  const ids = game.defs.skills.ids();
  const ageBonus = Math.min(4, Math.max(0, (age - 20) / 10));
  for (const id of ids) {
    let lv = rng.int(0, 3) + (bonus[id] || 0) * 1.5 + ageBonus * rng.next();
    if (id === 'magic' && !mage) lv = Math.min(lv, (bonus.magic || 0) * 1.5 + rng.int(0, 1));
    out[id] = { level: Math.max(0, Math.min(SKILL.maxLevel, Math.round(lv))), xp: 0, passion: 'none' };
  }
  if (mage) out.magic.level = Math.max(6, out.magic.level);
  // страсти — чаще к сильным навыкам
  const nPass = rng.int(1, 3);
  const cand = ids.slice();
  for (let i = 0; i < nPass && cand.length; i++) {
    const id = rng.weighted(cand, (s) => 1 + out[s].level);
    cand.splice(cand.indexOf(id), 1);
    out[id].passion = rng.chance(0.3) ? 'major' : 'minor';
  }
  for (const tag of incapable) {
    const map = { violent: ['melee', 'shooting'], caring: ['medicine'], intellectual: ['intellect'], social: ['social'], dumb_labor: ['mining'] };
    for (const id of map[tag] || []) if (out[id]) {
      out[id].level = 0;
      out[id].passion = 'none';
    }
  }
  return out;
}

export function skillLevel(game, pawn, skillId) {
  const v = pawn?.skills?.[skillId];
  const lv = typeof v === 'number' ? v : v?.level;
  return Number.isFinite(lv) ? lv : 3;
}

/** Навык со всеми подробностями для других модулей. */
export function getSkill(M, pawn, skillId) {
  const game = M.game;
  const v = pawn?.skills?.[skillId];
  const level = skillLevel(game, pawn, skillId);
  const passion = normPassion(v?.passion);
  const incapable = skillIncapable(game, pawn, skillId);
  return {
    id: skillId,
    level,
    xp: num(v?.xp, 0),
    next: SKILL.xpFor(level),
    passion,
    incapable,
    /** множитель эффекта навыка: 1 до уровня 3 (без штрафа новичкам) … 1.68 при 20 */
    factor: incapable ? 0.5 : 1 + 0.04 * Math.max(0, level - 3),
    /** качество 0..1 (для готовки/ремесла/лечения) */
    quality: Math.max(0, Math.min(1, level / 20)),
  };
}

/** Множитель скорости работы по типу работы. */
export function skillFactor(M, pawn, workTypeId) {
  const game = M.game;
  if (!pawn) return 1;
  const wt = game.defs.workTypes.get(workTypeId);
  const eff = traitEffects(M, pawn);
  let f = num(eff.workSpeed, 1);
  if (wt?.skill) {
    const s = getSkill(M, pawn, wt.skill);
    f *= s.factor;
  }
  if (incapableWork(pawn).has(workTypeId)) f *= 0.5;
  // настроение: подавленный работает медленнее, вдохновлённый — быстрее
  const mood = num(pawn.mood?.value, 0.6);
  if (mood < 0.25) f *= 0.85;
  else if (mood > 0.8) f *= 1.05;
  return Math.max(0.1, Math.min(3, f));
}

/** Опыт навыка: множитель страсти, повышение уровня (событие mind:skillUp). @returns {number} уровень */
export function learn(M, pawn, skillId, xp) {
  const game = M.game;
  if (!pawn || pawn.dead || !skillId || !(xp > 0) || pawn.faction !== 'colony' || pawn.animal) return skillLevel(game, pawn, skillId);
  if (!game.defs.skills.has(skillId)) return 3;
  const s = (pawn.skills ||= {});
  let v = s[skillId];
  if (typeof v === 'number') v = s[skillId] = { level: v, xp: 0, passion: 'none' };
  if (!v) v = s[skillId] = { level: 0, xp: 0, passion: 'none' };
  if (v.level >= SKILL.maxLevel) return v.level;
  if (skillIncapable(game, pawn, skillId)) return v.level;
  const mul = SKILL.passionMul[normPassion(v.passion)] ?? 1;
  v.xp = num(v.xp, 0) + xp * mul;
  let need = SKILL.xpFor(v.level);
  while (v.xp >= need && v.level < SKILL.maxLevel) {
    v.xp -= need;
    v.level++;
    need = SKILL.xpFor(v.level);
    game.events.emit('mind:skillUp', { pawn, skill: skillId, level: v.level });
    if (v.level % 4 === 0 || v.passion === 'major') {
      try {
        game.api.ui.notify(game.t('mind.skill.up', { name: firstName(pawn), skill: game.t(`mind.skills.${skillId}`), level: v.level }), { type: 'good', pawnId: pawn.id });
      } catch (err) {
        game.error(err, 'mind.learn');
      }
    }
  }
  if (v.level >= SKILL.maxLevel) v.xp = 0;
  return v.level;
}
