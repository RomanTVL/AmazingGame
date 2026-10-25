// Модель здоровья: состояния на частях тела, ёмкости, боль, кровотечение, лечение, болезни, «упал», смертельные исходы.
// Данные — JSON в pawn.health = {hp, maxHp, conds: [...], bloodLoss, pain, bleed, v}; кэш ёмкостей — pawn._hc (не сохраняется).
// Запись состояния: {id, part?, sev, born, tq? (качество перевязки 0..1), tt? (тик перевязки), rolled?, imm?, until?,
//                    fresh?, peak?, pd? (урон протезу), label?, caps?, pain?, painMul?, workMul?, moveMul?, src?}
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../core/constants.js';
import { EVENTS } from '../../core/events.js';
import { stopMoving } from '../../sim/pawn.js';
import { BODY_PARTS, PART, DAMAGE_TYPES, DAMAGE_ALIASES, BAL } from './defs.js';

const N = BODY_PARTS.length;
export const PART_INDEX = Object.create(null);
BODY_PARTS.forEach((p, i) => (PART_INDEX[p.id] = i));
const EXTERNAL = BODY_PARTS.filter((p) => p.coverage > 0);
const TORSO_ORGANS = BODY_PARTS.filter((p) => p.parent === 'torso' && p.internal > 0);
const VITAL = BODY_PARTS.filter((p) => p.vital).map((p) => p.id);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Гарантировать структуру здоровья (пешки из старых сейвов/чужих модулей). */
export function ensureHealth(pawn) {
  let h = pawn.health;
  if (!h || typeof h !== 'object') h = pawn.health = { hp: 100, maxHp: 100 };
  if (!Array.isArray(h.conds)) {
    if (!Number.isFinite(h.maxHp) || h.maxHp <= 0) h.maxHp = 100;
    h.conds = [];
    h.bloodLoss = 0;
    h.pain = 0;
    h.bleed = 0;
    h.v = 1;
    h.hp = h.maxHp;
  }
  return h;
}

export const scaleOf = (h) => (Number.isFinite(h.maxHp) && h.maxHp > 0 ? h.maxHp / 100 : 1);
export const partMax = (h, partId) => (PART[partId]?.hp ?? 20) * scaleOf(h);
export const condDef = (game, id) => game.defs.conditions.get(id);
export const touch = (h) => (h.v = (h.v | 0) + 1);
const noBlood = (p) => !!(p.undead || p.noBlood || p.mechanical);
const noPain = (p) => !!(p.undead || p.noPain || p.mechanical);

/** Нормализовать тип урона. */
export function normType(type) {
  if (!type) return 'blunt';
  const t = String(type).toLowerCase();
  if (DAMAGE_TYPES[t]) return t;
  return DAMAGE_ALIASES[t] || (['starvation', 'toxic', 'poison', 'overdose', 'disease'].includes(t) ? t : 'blunt');
}

// ------------------------------------------------------------------ состояние частей и ёмкости
function emptyCache() {
  return {
    v: -1, tick: -1, dmg: new Float32Array(N), eff: new Float32Array(N), prost: new Float32Array(N), missing: new Uint8Array(N),
    covered: new Uint8Array(N), fracture: new Float32Array(N), caps: {}, pain: 0, bleed: 0, lethal: null, instant: null, downed: null,
  };
}

/** Утрачена ли часть (сама или предок); протез на предке «закрывает» потомков (covered). */
function computeCoverage(h, c) {
  c.missing.fill(0);
  c.covered.fill(0);
  c.prost.fill(-1);
  for (const cd of h.conds) {
    if (!cd.part || PART_INDEX[cd.part] === undefined) continue;
    const i = PART_INDEX[cd.part];
    if (cd.id === 'missing') c.missing[i] = 1;
  }
  // протезы
  for (const cd of h.conds) {
    const i = PART_INDEX[cd.part];
    if (i === undefined) continue;
    if (cd.prosthetic) {
      c.prost[i] = Number.isFinite(cd.eff) ? cd.eff : 0.5;
      c.missing[i] = 0;
    }
  }
  // потомки утраченных/протезированных
  for (let i = 0; i < N; i++) {
    let p = BODY_PARTS[i].parent;
    while (p) {
      const j = PART_INDEX[p];
      if (c.missing[j]) {
        c.missing[i] = 1;
        break;
      }
      if (c.prost[j] >= 0) {
        c.covered[i] = 1;
        break;
      }
      p = PART[p].parent;
    }
  }
}

/** Пересчитать кэш здоровья пешки (ёмкости, боль, кровотечение, смертельность). */
export function computeCache(game, pawn, force = false) {
  const h = ensureHealth(pawn);
  let c = pawn._hc;
  if (!c) c = pawn._hc = emptyCache();
  const tick = game.time.tick;
  if (!force && c.v === h.v && tick - c.tick < 30) return c;
  c.v = h.v;
  c.tick = tick;
  const scale = scaleOf(h);
  computeCoverage(h, c);
  c.dmg.fill(0);
  c.fracture.fill(0);
  const scarMul = new Float32Array(N).fill(1);
  let pain = 0;
  let bleed = 0;
  let painMul = 1;
  const capMul = { consciousness: 1, moving: 1, manipulation: 1, sight: 1, hearing: 1, breathing: 1, bloodPumping: 1, bloodFiltration: 1 };
  let workMul = 1;
  let moveMul = 1;
  let lethal = null;
  const blood = !noBlood(pawn);
  for (const cd of h.conds) {
    const def = condDef(game, cd.id) || cd;
    const i = cd.part !== undefined ? PART_INDEX[cd.part] : undefined;
    const kind = def.kind || 'timed';
    const tended = Number.isFinite(cd.tq) && cd.tq >= 0;
    if (kind === 'injury') {
      if (i !== undefined) c.dmg[i] += cd.sev;
      const norm = cd.sev / scale;
      pain += norm * (def.pain ?? 0.01) * (tended ? 0.6 : 1);
      if (blood && i !== undefined) {
        const ageH = (tick - (cd.born ?? tick)) / TICKS_PER_HOUR;
        const clot = norm < 6 ? Math.max(0, 1 - ageH / 3) : Math.max(0.35, 1 - ageH / 30);
        bleed += norm * (def.bleed ?? 0) * (PART[cd.part]?.bleed ?? 1) * clot * (tended ? 0.05 : 1);
      }
    } else if (kind === 'fracture') {
      if (i !== undefined) c.fracture[i] = tended ? 0.5 : 0.25;
      pain += (def.painFlat ?? 0.12) * (tended ? 0.6 : 1);
    } else if (kind === 'missing') {
      if (cd.fresh) {
        pain += tended ? 0.04 : def.painFlat ?? 0.1;
        if (blood && !tended && i !== undefined) {
          const ageH = (tick - (cd.born ?? tick)) / TICKS_PER_HOUR;
          bleed += (PART[cd.part].hp) * (def.bleedPerHp ?? 0.035) * (PART[cd.part].bleed ?? 1) * Math.max(0.3, 1 - ageH / 16);
        }
      }
    } else if (kind === 'scar') {
      pain += def.painFlat ?? 0.012;
      if (i !== undefined) scarMul[i] *= cd.part.startsWith('eye') ? 0.7 : 0.92;
    } else if (kind === 'prosthetic') {
      // эффективность — в computeCoverage
    } else {
      // болезни, истощение, временные, бафы, состояния других модулей (вещества)
      const sev = kind === 'disease' || kind === 'chronic' ? clamp01(cd.sev ?? 0) : clamp01(cd.sev ?? 1);
      pain += (cd.pain ?? def.pain ?? 0) * sev;
      const caps = cd.caps || def.caps;
      if (caps) for (const k in caps) if (k in capMul) capMul[k] *= 1 - (1 - caps[k]) * sev;
      if (Number.isFinite(cd.painMul ?? def.painMul)) painMul *= cd.painMul ?? def.painMul;
      if (Number.isFinite(cd.workMul ?? def.workMul)) workMul *= cd.workMul ?? def.workMul;
      if (Number.isFinite(cd.moveMul ?? def.moveMul)) moveMul *= cd.moveMul ?? def.moveMul;
      if ((kind === 'disease' || kind === 'chronic') && (cd.sev ?? 0) >= 1 && def.lethal) lethal ||= def.lethal;
    }
  }
  if (noPain(pawn)) pain = 0;
  pain = Math.max(0, Math.min(1.5, pain * painMul));
  // эффективность частей
  for (let i = 0; i < N; i++) {
    const p = BODY_PARTS[i];
    if (c.missing[i]) {
      c.eff[i] = 0;
      continue;
    }
    if (c.prost[i] >= 0) {
      c.eff[i] = c.prost[i];
      continue;
    }
    if (c.covered[i]) {
      c.eff[i] = 1;
      continue;
    }
    const max = p.hp * scale;
    let e = clamp01(1 - c.dmg[i] / max);
    if (c.fracture[i]) e *= c.fracture[i];
    c.eff[i] = e * scarMul[i];
  }
  const E = (id) => c.eff[PART_INDEX[id]];
  const P = (id) => c.prost[PART_INDEX[id]];
  const M = (id) => c.missing[PART_INDEX[id]] === 1;
  const arm = (s) => {
    if (P('shoulder_' + s) >= 0) return P('shoulder_' + s);
    if (M('shoulder_' + s)) return 0;
    let v = E('shoulder_' + s);
    if (P('arm_' + s) >= 0) return v * P('arm_' + s);
    if (M('arm_' + s)) return 0;
    v = Math.min(v, E('arm_' + s));
    if (P('hand_' + s) >= 0) return v * P('hand_' + s);
    if (M('hand_' + s)) return 0;
    v *= E('hand_' + s);
    if (P('fingers_' + s) >= 0) return v * (0.8 + 0.2 * P('fingers_' + s));
    if (M('fingers_' + s)) return v * 0.6;
    return v * (0.8 + 0.2 * E('fingers_' + s));
  };
  const leg = (s) => {
    if (P('leg_' + s) >= 0) return P('leg_' + s);
    if (M('leg_' + s)) return 0;
    const v = E('leg_' + s);
    if (P('foot_' + s) >= 0) return v * (0.7 + 0.3 * P('foot_' + s));
    if (M('foot_' + s)) return v * 0.25;
    const toes = P('toes_' + s) >= 0 ? P('toes_' + s) : M('toes_' + s) ? 0 : E('toes_' + s);
    return v * (0.7 + 0.3 * E('foot_' + s) * (0.85 + 0.15 * toes));
  };
  const caps = c.caps;
  caps.bloodPumping = E('heart') * capMul.bloodPumping;
  const ribs = c.fracture[PART_INDEX.ribs] ? 0.85 : 1;
  caps.breathing = ((E('lung_l') + E('lung_r')) / 2) * (0.6 + 0.4 * E('neck')) * ribs * capMul.breathing;
  caps.bloodFiltration = ((E('kidney_l') + E('kidney_r')) / 4 + E('liver') / 2) * capMul.bloodFiltration;
  caps.sight = ((P('eye_l') >= 0 ? P('eye_l') : E('eye_l')) + (P('eye_r') >= 0 ? P('eye_r') : E('eye_r'))) / 2 * capMul.sight;
  caps.hearing = ((E('ear_l') + E('ear_r')) / 2) * capMul.hearing;
  const bl = h.bloodLoss || 0;
  const blF = bl < 0.15 ? 1 : bl < 0.3 ? 0.9 : bl < 0.45 ? 0.75 : bl < 0.6 ? 0.6 : 0.3;
  const painF = 1 - clamp01(pain - 0.2) * 0.35;
  const skull = c.fracture[PART_INDEX.head] ? 0.8 : 1;
  let cons = E('brain') * Math.min(1, 0.4 + 0.6 * caps.bloodPumping) * Math.min(1, 0.3 + 0.7 * caps.breathing);
  if (caps.bloodFiltration < 0.5) cons *= 0.6 + 0.8 * caps.bloodFiltration;
  cons *= blF * painF * skull * capMul.consciousness;
  caps.consciousness = clamp01(cons);
  caps.moving = Math.max(0, ((leg('l') + leg('r')) / 2) * Math.min(1, E('spine') * 1.25) * Math.min(1, caps.consciousness + 0.15) * capMul.moving);
  caps.manipulation = Math.max(0, ((arm('l') + arm('r')) / 2) * Math.min(1, caps.consciousness + 0.1) * capMul.manipulation);
  c.armL = arm('l');
  c.armR = arm('r');
  c.legL = leg('l');
  c.legR = leg('r');
  c.workMul = workMul;
  c.moveMul = moveMul;
  c.pain = pain;
  c.bleed = blood ? bleed : 0;
  // мгновенная смерть: разрушен жизненно важный орган
  let instant = null;
  for (const id of VITAL) {
    const i = PART_INDEX[id];
    if (c.missing[i] || (c.prost[i] < 0 && !c.covered[i] && c.dmg[i] >= PART[id].hp * scale - 1e-6)) {
      instant = id === 'brain' || id === 'head' ? 'brain' : id === 'heart' ? 'heart' : 'wounds';
      break;
    }
  }
  c.instant = instant;
  if (!lethal) {
    if (bl >= 1) lethal = 'blood_loss';
    else if (caps.breathing <= 0.01 || caps.bloodFiltration <= 0.02) lethal = 'organ_failure';
  }
  c.lethal = lethal;
  let downed = null;
  if (caps.consciousness < BAL.downedConsciousness) downed = 'unconscious';
  else if (pain >= BAL.painShock) downed = 'shock';
  else if (bl >= BAL.downedBloodLoss) downed = 'blood_loss';
  else if (caps.moving < BAL.downedMoving) downed = 'cant_move';
  c.downed = downed;
  // сводка
  let vitalMin = 1;
  for (const id of ['torso', 'neck', 'head', 'brain', 'heart']) vitalMin = Math.min(vitalMin, E(id));
  let dis = 0;
  for (const cd of h.conds) if (cd.sev <= 1 && (condDef(game, cd.id)?.kind === 'disease' || cd.id === 'malnutrition')) dis = Math.max(dis, cd.sev);
  let extDmg = 0;
  let extMax = 0;
  for (const p of EXTERNAL) {
    const i = PART_INDEX[p.id];
    extMax += p.hp * scale;
    extDmg += c.missing[i] ? p.hp * scale * 0.5 : Math.min(c.dmg[i], p.hp * scale);
  }
  const ratio = clamp01(Math.min(1 - bl, 0.25 + 0.75 * caps.consciousness, vitalMin, 1 - dis * 0.8, 1 - (extDmg / Math.max(1, extMax)) * 1.6));
  c.ratio = pawn.dead ? 0 : ratio;
  h.hp = Math.round(h.maxHp * c.ratio * 10) / 10;
  h.pain = Math.round(pain * 1000) / 1000;
  h.bleed = Math.round(c.bleed * 1000) / 1000;
  return c;
}

export function getCaps(game, pawn) {
  return computeCache(game, pawn).caps;
}

// ------------------------------------------------------------------ состояния
export function findCond(h, id, part) {
  for (const c of h.conds) if (c.id === id && (part === undefined || c.part === part)) return c;
  return null;
}

export function removeCond(h, cd) {
  const i = h.conds.indexOf(cd);
  if (i >= 0) h.conds.splice(i, 1);
  touch(h);
}

/** Добавить состояние (API addCondition). opts: {part, severity, hours, label, caps, pain, painMul, workMul, moveMul, source}. */
export function addCondition(H, pawn, id, opts = {}) {
  const game = H.game;
  if (!pawn || pawn.dead || !id) return null;
  const h = ensureHealth(pawn);
  const def = condDef(game, id);
  const tick = game.time.tick;
  const kind = def?.kind || 'timed';
  const part = opts.part && PART[opts.part] ? opts.part : undefined;
  let cd = findCond(h, id, def?.onPart || kind === 'injury' ? part : undefined);
  if (kind === 'injury' && part) return damagePart(H, pawn, part, opts.severity ?? 5, def.id === 'bruise' ? 'blunt' : 'cut', opts);
  if (cd && kind !== 'scar') {
    // повтор: болезнь усиливается, временное продлевается
    if (kind === 'disease' || kind === 'chronic') cd.sev = clamp01((cd.sev ?? 0) + (opts.severity ?? 0.05));
    else if (Number.isFinite(opts.severity)) cd.sev = Math.max(cd.sev ?? 0, opts.severity);
    const hours = opts.hours ?? def?.hours;
    if (hours) cd.until = Math.max(cd.until || 0, tick + hours * TICKS_PER_HOUR);
    touch(h);
    return cd;
  }
  cd = { id, born: tick };
  if (part) cd.part = part;
  if (kind === 'disease') {
    cd.sev = clamp01(opts.severity ?? 0.08);
    cd.imm = 0;
  } else if (kind === 'chronic') cd.sev = clamp01(opts.severity ?? 0.05);
  else if (kind === 'fracture') cd.sev = clamp01(opts.severity ?? 1);
  else cd.sev = opts.severity ?? (kind === 'scar' ? 3 : 1);
  const hours = opts.hours ?? def?.hours;
  if (hours) cd.until = tick + hours * TICKS_PER_HOUR;
  if (!def) {
    // состояние другого модуля без определения — храним всё нужное в записи
    for (const k of ['label', 'caps', 'pain', 'painMul', 'workMul', 'moveMul', 'color']) if (opts[k] !== undefined) cd[k] = opts[k];
    cd.kind = opts.kind || 'timed';
  }
  if (opts.source?.id) cd.src = opts.source.id;
  h.conds.push(cd);
  touch(h);
  game.events.emit('health:conditionAdded', { pawn, id, condition: cd });
  return cd;
}

export function hasCondition(game, pawn, id) {
  const h = pawn?.health;
  if (!h || !Array.isArray(h.conds)) return false;
  return h.conds.some((c) => c.id === id);
}

// ------------------------------------------------------------------ урон
/** Цель удара по opts.part: id части, группа или синоним. */
export function resolvePart(rng, h, cache, part) {
  if (!part) return null;
  const s = String(part).toLowerCase();
  if (PART[s]) return s;
  const side = s.includes('left') || s.endsWith('_l') ? 'l' : s.includes('right') || s.endsWith('_r') ? 'r' : rng.chance(0.5) ? 'l' : 'r';
  const pick = (ids) => {
    const ok = ids.filter((id) => !cache.missing[PART_INDEX[id]] && !cache.covered[PART_INDEX[id]]);
    if (!ok.length) return null;
    return rng.weighted(ok, (id) => PART[id].coverage || 0.01);
  };
  if (s.includes('arm') || s.includes('hand')) return pick(s.includes('hand') ? [`hand_${side}`, `fingers_${side}`] : [`shoulder_${side}`, `arm_${side}`, `hand_${side}`]) || 'torso';
  if (s.includes('leg') || s.includes('foot')) return pick(s.includes('foot') ? [`foot_${side}`, `toes_${side}`] : [`leg_${side}`, `foot_${side}`]) || 'torso';
  if (s.includes('eye')) return pick([`eye_${side}`]) || 'head';
  if (s.includes('head') || s.includes('face')) return 'head';
  if (s.includes('chest') || s.includes('body') || s.includes('torso')) return 'torso';
  return null;
}

function randomExternalPart(rng, cache) {
  const ok = [];
  for (const p of EXTERNAL) {
    const i = PART_INDEX[p.id];
    if (cache.missing[i] || cache.covered[i]) continue;
    ok.push(p);
  }
  return (ok.length ? rng.weighted(ok, (p) => p.coverage) : PART.torso).id;
}

function descendants(partId) {
  const out = [];
  const walk = (id) => {
    for (const p of BODY_PARTS) if (p.parent === id) {
      out.push(p.id);
      walk(p.id);
    }
  };
  walk(partId);
  return out;
}
export const DESCENDANTS = Object.create(null);
for (const p of BODY_PARTS) DESCENDANTS[p.id] = descendants(p.id);

/**
 * Урон по конкретной части. @returns {{dealt, destroyed, lost: string|null}}
 */
export function damagePart(H, pawn, partId, amount, type, opts = {}, depth = 0) {
  const game = H.game;
  const h = ensureHealth(pawn);
  const c = computeCache(game, pawn, true);
  const i = PART_INDEX[partId];
  const res = { dealt: 0, destroyed: false, lost: null };
  if (i === undefined || !(amount > 0)) return res;
  if (c.missing[i] || c.covered[i]) return res;
  const dt = DAMAGE_TYPES[type] || DAMAGE_TYPES.blunt;
  const max = partMax(h, partId);
  const tick = game.time.tick;
  // протез принимает удар на себя
  const prost = h.conds.find((x) => x.part === partId && x.prosthetic);
  if (prost) {
    prost.pd = (prost.pd || 0) + amount;
    res.dealt = amount;
    if (prost.pd >= max) {
      removeCond(h, prost);
      h.conds.push({ id: 'missing', part: partId, sev: max, born: tick, tq: 1, tt: tick });
      res.destroyed = true;
      res.lost = partId;
      H.hooks.notifyPart?.(pawn, partId, 'prosthetic_broken');
    }
    touch(h);
    return res;
  }
  const remaining = Math.max(0, max - c.dmg[i]);
  const take = Math.min(amount, remaining);
  const condId = dt.cond;
  if (take > 0) {
    let cd = h.conds.find((x) => x.id === condId && x.part === partId && !(x.tq >= 0) && tick - (x.born ?? 0) < TICKS_PER_HOUR);
    if (cd) {
      cd.sev += take;
      cd.peak = Math.max(cd.peak || 0, cd.sev);
    } else {
      cd = { id: condId, part: partId, sev: take, peak: take, born: tick };
      if (opts.source?.id) cd.src = opts.source.id;
      h.conds.push(cd);
    }
    res.dealt += take;
  }
  // перелом
  const P = PART[partId];
  if (P.bone && dt.fracture && !findCond(h, 'fracture', partId)) {
    const frac = (c.dmg[i] + take) / max;
    const chance = (dt.fracture === true ? 0.7 : dt.fracture) * (frac >= 0.45 ? 1 : frac >= 0.3 ? 0.3 : 0);
    if (chance > 0 && H.game.rng.chance(chance)) h.conds.push({ id: 'fracture', part: partId, sev: 1, born: tick });
  }
  touch(h);
  if (amount >= remaining - 1e-6) {
    res.destroyed = true;
    if (P.sever) {
      // часть утрачена вместе с дочерними
      const gone = new Set([partId, ...DESCENDANTS[partId]]);
      h.conds = h.conds.filter((x) => !gone.has(x.part));
      h.conds.push({ id: 'missing', part: partId, sev: max, born: tick, fresh: true });
      res.lost = partId;
      touch(h);
      game.events.emit('health:partLost', {
        pawn, part: partId, x: pawn.x, y: pawn.y, type, source: opts.source || null, severed: type === 'cut' || type === 'bite' || type === 'rune' || type === 'frost',
      });
      H.hooks.notifyPart?.(pawn, partId, 'lost');
    }
    const overflow = amount - take;
    if (overflow > 0.5 && P.parent && depth < 3 && !P.internal) {
      const r = damagePart(H, pawn, P.parent, overflow * 0.6, type, opts, depth + 1);
      res.dealt += r.dealt;
    }
  }
  return res;
}

/**
 * Нанести урон (API applyDamage). @returns {number} нанесённый урон
 */
export function applyDamage(H, pawn, amount, opts = {}) {
  const game = H.game;
  if (!pawn || pawn.dead || pawn.removed || pawn.invulnerable) return 0;
  amount = Number(amount);
  if (!(amount > 0) || !Number.isFinite(amount)) return 0;
  const h = ensureHealth(pawn);
  const type = normType(opts.type);
  const hpBefore = Math.max(1, h.hp ?? h.maxHp ?? 100);
  if (h.simple || pawn.boss) {
    h.hp = Math.max(0, (h.hp ?? h.maxHp) - amount);
    if (h.hp <= 0) H.hooks.kill(pawn, opts.cause || type, opts);
    return amount;
  }
  if (type === 'starvation') {
    const cd = findCond(h, 'malnutrition') || addCondition(H, pawn, 'malnutrition', { severity: 0 });
    cd.sev = clamp01((cd.sev ?? 0) + BAL.starvePerHour * amount);
    touch(h);
    afterChange(H, pawn, { amount: 0 });
    return amount;
  }
  if (type === 'poison' || type === 'disease') {
    addCondition(H, pawn, 'food_poisoning', { severity: 1 });
    afterChange(H, pawn, { amount: 0 });
    return amount;
  }
  let dealt = 0;
  let lost = null;
  const c = computeCache(game, pawn, true);
  if (type === 'toxic' || type === 'overdose') {
    // яд/передоз — по органам (без кровотечения)
    const organs = ['liver', 'kidney_l', 'kidney_r', 'brain'];
    for (const id of organs) {
      const share = id === 'brain' ? 0.25 : id === 'liver' ? 0.45 : 0.15;
      dealt += damagePart(H, pawn, id, amount * share, 'blunt', opts).dealt;
    }
  } else {
    const rng = game.rng;
    let part = resolvePart(rng, h, c, opts.part);
    if (!part || c.missing[PART_INDEX[part]] || c.covered[PART_INDEX[part]]) part = randomExternalPart(rng, c);
    const dt = DAMAGE_TYPES[type] || DAMAGE_TYPES.blunt;
    // пробитие к органам
    let inner = null;
    if (part === 'torso' && rng.chance(dt.pierce)) inner = rng.weighted(TORSO_ORGANS, (p) => p.internal).id;
    else if (part === 'head' && rng.chance(dt.pierce * 0.8)) inner = 'brain';
    if (inner) {
      const r1 = damagePart(H, pawn, part, amount * 0.35, type, opts);
      const r2 = damagePart(H, pawn, inner, amount * 0.65, type === 'cut' ? 'stab' : type, opts);
      dealt = r1.dealt + r2.dealt;
      lost = r1.lost || r2.lost;
      part = inner;
    } else {
      const r = damagePart(H, pawn, part, amount, type, opts);
      dealt = r.dealt;
      lost = r.lost;
    }
    game.events.emit('health:injured', { pawn, part, type, amount: dealt, source: opts.source || null, lost });
  }
  // удар по несущему роняет ношу
  if (amount >= 10 && pawn.carryPawnId) H.hooks.dropCarry?.(pawn, { reason: 'hit' });
  afterChange(H, pawn, { amount, hpBefore, cause: opts.cause, type, opts });
  return dealt || amount;
}

/** После изменения здоровья: смертельные исходы, «упал». */
export function afterChange(H, pawn, info = {}) {
  const game = H.game;
  if (pawn.dead || pawn.removed) return;
  const c = computeCache(game, pawn, true);
  if (c.instant) {
    H.hooks.kill(pawn, info.cause || (c.instant === 'wounds' ? woundCause(info.type) : `${c.instant}_destroyed`), info.opts || {});
    return;
  }
  if (c.lethal) {
    const overkill = info.amount > 0 && info.amount >= 2 * (info.hpBefore ?? 100);
    if (overkill || !H.hooks.canDieSlowly(pawn)) {
      H.hooks.kill(pawn, info.cause || c.lethal, info.opts || {});
      return;
    }
    if (!pawn.dying) H.hooks.startDying(pawn, c.lethal);
  }
  updateDowned(H, pawn, c);
}

function woundCause(type) {
  return type ? `wounds_${type}` : 'wounds';
}

/** Упал/встал. */
export function updateDowned(H, pawn, c = computeCache(H.game, pawn)) {
  const game = H.game;
  const should = !!(c.downed || pawn.dying);
  if (should && !pawn.downed) {
    pawn.downed = true;
    pawn.downedReason = c.downed || 'dying';
    if (pawn.job) game.jobs.endJob(pawn, 'cancelled');
    stopMoving(pawn);
    pawn.asleep = false;
    if (pawn.moveInput) pawn.moveInput.x = pawn.moveInput.y = 0;
    if (pawn.carry) game.items.dropCarried(pawn);
    if (pawn.carryPawnId) H.hooks.dropCarry?.(pawn, { reason: 'downed' });
    game.events.emit('health:downed', { pawn, reason: pawn.downedReason });
    H.hooks.onDowned?.(pawn);
  } else if (!should && pawn.downed && !pawn.carriedById) {
    pawn.downed = false;
    pawn.downedReason = null;
    H.hooks.onRecovered?.(pawn);
    game.events.emit('health:recovered', { pawn });
  } else if (pawn.downed) pawn.downedReason = c.downed || (pawn.dying ? 'dying' : pawn.downedReason);
}

// ------------------------------------------------------------------ лечение
/**
 * Перевязать/обработать все нуждающиеся состояния. quality 0..1. @returns {number} сколько обработано
 */
export function tendAll(H, pawn, quality) {
  const game = H.game;
  const h = ensureHealth(pawn);
  const tick = game.time.tick;
  let n = 0;
  for (const cd of h.conds) {
    if (!needsTending(game, cd, tick)) continue;
    const q = clamp01(quality + (game.rng.next() - 0.5) * 0.16);
    cd.tq = Math.max(cd.tq ?? -1, q);
    cd.tt = tick;
    n++;
  }
  if (n) touch(h);
  return n;
}

/** Нужна ли записи перевязка/лечение. */
export function needsTending(game, cd, tick = game.time.tick) {
  const def = condDef(game, cd.id);
  const kind = def?.kind || cd.kind;
  if (kind === 'injury' || kind === 'fracture') return !(cd.tq >= 0);
  if (kind === 'missing') return !!cd.fresh && !(cd.tq >= 0);
  if (kind === 'disease') return !(cd.tq >= 0) || tick - (cd.tt ?? 0) > BAL.treatHours * TICKS_PER_HOUR;
  return false;
}

export function tendNeed(game, pawn) {
  const h = pawn.health;
  if (!h?.conds) return 0;
  let n = 0;
  const tick = game.time.tick;
  for (const cd of h.conds) if (needsTending(game, cd, tick)) n++;
  return n;
}

/** Исцеление (заклинание, зелье): снять amount очков ранений, начиная с тяжёлых; немного крови. */
export function heal(H, pawn, amount) {
  if (!pawn || pawn.dead) return 0;
  const h = ensureHealth(pawn);
  let left = Number(amount) || 0;
  if (left <= 0) return 0;
  const inj = h.conds.filter((c) => condDef(H.game, c.id)?.kind === 'injury').sort((a, b) => b.sev - a.sev);
  for (const cd of inj) {
    if (left <= 0) break;
    const k = Math.min(cd.sev, left);
    cd.sev -= k;
    left -= k;
    if (cd.sev <= 0.01) removeCond(h, cd);
  }
  h.bloodLoss = Math.max(0, (h.bloodLoss || 0) - (Number(amount) || 0) / 300);
  touch(h);
  afterChange(H, pawn, {});
  return (Number(amount) || 0) - left;
}

// ------------------------------------------------------------------ течение времени
/**
 * Обновить здоровье пешки за dtTicks тиков (вызывается раз в 30 тиков с разносом по id).
 */
export function updatePawn(H, pawn, dtTicks) {
  const game = H.game;
  const h = ensureHealth(pawn);
  if (h.simple || pawn.boss) return;
  const tick = game.time.tick;
  const dtDays = dtTicks / TICKS_PER_DAY;
  const scale = scaleOf(h);
  const rng = game.rng;
  const c0 = computeCache(game, pawn, true);
  const inBed = !!pawn.inBedId || !!pawn.asleep;
  const bedMul = inBed ? BAL.bedHealMul : 1;
  const malnourished = (findCond(h, 'malnutrition')?.sev ?? 0) > 0.3;
  const healMul = bedMul * (malnourished ? 0.6 : 1);
  let changed = false;
  // кровь
  const prevBL = h.bloodLoss || 0;
  if (c0.bleed > 0.02) h.bloodLoss = prevBL + c0.bleed * dtDays;
  else h.bloodLoss = Math.max(0, prevBL - BAL.bloodRegenPerDay * dtDays * (inBed ? 1.3 : 1));
  if (pawn.dying) h.bloodLoss = Math.min(h.bloodLoss, 1);
  if (Math.abs(h.bloodLoss - prevBL) > 1e-6) changed = true;
  const immF = clamp01(0.5 + 0.5 * c0.caps.bloodFiltration) * ((pawn.needs?.food ?? 1) > 0.2 ? 1 : 0.7) * (inBed ? 1.15 : 1) * (findCond(h, 'rested') ? 1.05 : 1);
  let healedSomething = false;
  for (let k = h.conds.length - 1; k >= 0; k--) {
    const cd = h.conds[k];
    const def = condDef(game, cd.id);
    const kind = def?.kind || cd.kind || 'timed';
    const tended = cd.tq >= 0;
    if (cd.until && tick >= cd.until) {
      h.conds.splice(k, 1);
      changed = true;
      continue;
    }
    if (kind === 'injury') {
      const rate = (tended ? BAL.healTendedBase + BAL.healTendedQ * cd.tq : BAL.healUntended) * healMul * scale;
      cd.sev -= rate * dtDays;
      changed = true;
      // заражение открытой раны
      if (def.open && !cd.rolled && tick - (cd.born ?? tick) >= BAL.infectAfterHours * TICKS_PER_HOUR) {
        cd.rolled = true;
        const norm = (cd.peak ?? cd.sev) / scale;
        const p = BAL.infectChance * (def.infMul ?? 1) * (tended ? (1 - cd.tq) * 0.4 : 1) * (norm >= 4 ? 1 : 0.35) * (pawn.undead ? 0 : 1);
        if (p > 0 && rng.chance(p) && !findCond(h, 'infection', cd.part)) {
          addCondition(H, pawn, 'infection', { part: cd.part, severity: 0.05 });
          H.hooks.notifyCond?.(pawn, 'infection');
        }
      }
      if (cd.sev <= 0.01) {
        h.conds.splice(k, 1);
        healedSomething = true;
        const peak = (cd.peak ?? 0) / scale;
        if (peak >= 8 && rng.chance(def.scar ?? 0) && cd.part && !findCond(h, 'scar', cd.part)) {
          h.conds.push({ id: 'scar', part: cd.part, sev: Math.min(6, Math.max(2, peak * 0.2)), born: tick });
        }
      }
    } else if (kind === 'fracture') {
      cd.sev -= (tended ? def.healTended : def.healUntended) * healMul * dtDays;
      changed = true;
      if (cd.sev <= 0) {
        h.conds.splice(k, 1);
        healedSomething = true;
      }
    } else if (kind === 'missing') {
      if (cd.fresh && tended && tick - (cd.tt ?? tick) > TICKS_PER_DAY * 2) {
        cd.fresh = false;
        changed = true;
      }
    } else if (kind === 'disease') {
      const treated = tended && tick - (cd.tt ?? 0) < BAL.treatHours * TICKS_PER_HOUR;
      const q = treated ? cd.tq : 0;
      cd.sev = Math.min(1, (cd.sev ?? 0) + (def.growth ?? 0.2) * (1 - 0.55 * q) * dtDays);
      cd.imm = Math.min(1, (cd.imm ?? 0) + (def.immunity ?? 0.25) * immF * (1 + 0.4 * q) * dtDays);
      changed = true;
      if (cd.imm >= 1 || (cd.part && c0.missing[PART_INDEX[cd.part]])) {
        h.conds.splice(k, 1);
        if (cd.imm >= 1) H.hooks.notifyCond?.(pawn, cd.id, 'recovered');
      }
    } else if (kind === 'chronic') {
      if (cd.id === 'malnutrition' && (pawn.needs?.food ?? 1) > 0.25) {
        cd.sev -= BAL.starveRecoverPerHour * (dtTicks / TICKS_PER_HOUR);
        changed = true;
        if (cd.sev <= 0) h.conds.splice(k, 1);
      }
    }
  }
  if (changed) touch(h);
  if (healedSomething && !h.conds.some((x) => ['injury', 'fracture'].includes(condDef(game, x.id)?.kind))) game.events.emit('health:healed', { pawn });
  afterChange(H, pawn, {});
}

/** Есть ли у пешки сломанная/утраченная рука (кисть) — нельзя нести, кидать уголь, копать. */
export function armBroken(game, pawn) {
  const h = pawn.health;
  if (!h?.conds) return false;
  const c = computeCache(game, pawn);
  for (const s of ['l', 'r']) {
    for (const id of [`shoulder_${s}`, `arm_${s}`, `hand_${s}`]) {
      const i = PART_INDEX[id];
      if (c.missing[i]) return true;
      if (c.fracture[i] && !c.covered[i]) return true;
    }
  }
  return false;
}

/** Самое тяжёлое состояние для подписи. */
export function worstCondition(game, pawn) {
  const h = pawn.health;
  if (!h?.conds?.length) return null;
  let best = null;
  let bestScore = -1;
  for (const cd of h.conds) {
    const def = condDef(game, cd.id);
    const kind = def?.kind || cd.kind;
    const s = kind === 'disease' ? 30 + cd.sev * 60 : kind === 'injury' ? cd.sev : kind === 'fracture' ? 25 : kind === 'missing' ? (cd.fresh ? 40 : 5) : 1;
    if (s > bestScore) {
      bestScore = s;
      best = cd;
    }
  }
  return best;
}

export { EVENTS };
