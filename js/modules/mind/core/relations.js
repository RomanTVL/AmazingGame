// Отношения: pawn.relations[otherId] = {kind, opinion} (мнение направленное: a о b), стартовые семьи/пары/друзья,
// дрейф мнения к базовому, превращение знакомых в друзей/соперников.
import { SOCIAL } from '../constants.js';
import { traitEffects } from './traits.js';
import { firstName, num } from './util.js';

export const LOVE = ['spouse', 'lover'];
const KIND_BASE = { spouse: 35, lover: 28, family: 22, friend: 18, rival: -18, ex: -6 };

export function rel(a, b) {
  if (!a || !b) return null;
  return a.relations?.[b.id] || null;
}

export function opinionOf(a, b) {
  return num(rel(a, b)?.opinion, 0);
}

export function kindOf(a, b) {
  return rel(a, b)?.kind || null;
}

export function isLovers(a, b) {
  return LOVE.includes(kindOf(a, b));
}

export function partnerOf(M, p) {
  for (const [id, r] of Object.entries(p?.relations || {})) {
    if (!LOVE.includes(r?.kind)) continue;
    const o = M.game.entities.get(Number(id));
    if (o && !o.dead) return o;
  }
  return null;
}

/** Базовое мнение a о b (вид отношений + внешность b). */
export function baseOpinion(M, a, b) {
  const k = kindOf(a, b);
  return (KIND_BASE[k] || 0) + traitEffects(M, b).opinionOfMe * 0.6;
}

function ensureRel(a, b) {
  a.relations ||= {};
  let r = a.relations[b.id];
  if (!r || typeof r !== 'object') r = a.relations[b.id] = { kind: null, opinion: 0 };
  if (!Number.isFinite(r.opinion)) r.opinion = 0;
  return r;
}

/** Изменить мнение a о b. @returns {number} новое мнение */
export function changeOpinion(M, a, b, delta) {
  if (!a || !b || a === b || !Number.isFinite(delta)) return 0;
  const r = ensureRel(a, b);
  r.opinion = Math.max(-100, Math.min(100, r.opinion + delta));
  r.name ||= b.name;
  updateKind(M, a, b, r);
  return r.opinion;
}

/** Друзья/соперники по порогам мнения (семья и пары не меняются сами). */
function updateKind(M, a, b, r) {
  const k = r.kind;
  if (k === 'family' || k === 'spouse' || k === 'lover') return;
  let next = k;
  if (r.opinion >= SOCIAL.friendAt && (!k || k === 'ex')) next = 'friend';
  else if (r.opinion <= SOCIAL.rivalAt && k !== 'rival') next = 'rival';
  else if (k === 'friend' && r.opinion < 8) next = null;
  else if (k === 'rival' && r.opinion > -8) next = null;
  if (next === k) return;
  r.kind = next;
  // уведомить, только если взаимно
  const back = b.relations?.[a.id];
  if (next && back?.kind === next && a.faction === 'colony' && b.faction === 'colony' && a.id < b.id + 1e9) {
    const key = next === 'friend' ? 'mind.social.friends' : 'mind.social.rivals';
    try {
      M.game.api.ui.notify(M.game.t(key, { a: firstName(a), b: firstName(b) }), { type: next === 'friend' ? 'good' : 'bad', pawnId: a.id });
    } catch (err) {
      M.game.error(err, 'mind.relations');
    }
  }
}

/** Отношение для сценариев: kind — spouse/lover/family/friend/rival/ex/null; взаимно. */
export function setRelation(M, a, b, kind, opinion) {
  if (!a || !b || a === b) return;
  const k = kind === 'wife' || kind === 'husband' ? 'spouse' : kind || null;
  for (const [x, y] of [[a, b], [b, a]]) {
    const r = ensureRel(x, y);
    r.kind = k;
    r.name = y.name;
    if (Number.isFinite(opinion)) r.opinion = Math.max(-100, Math.min(100, opinion));
    else if (!r.opinion) r.opinion = KIND_BASE[k] || 0;
    if (k === 'family' && !r.fam) r.fam = 'sibling';
  }
}

/** Стартовые связи: семьи, пары, друзья — только для пар без заданных отношений. */
export function seedRelations(M, rng) {
  const list = M.colonists().slice();
  if (list.length < 2) return;
  const free = (a, b) => !a.relations?.[b.id]?.kind && !b.relations?.[a.id]?.kind;
  const adult = (p) => num(p.age, 30) >= 18;
  const surname = (p) => String(p.name || '').split(' ')[1] || '';
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (!free(a, b)) {
        // мнения заданы, а отношения взаимны?
        continue;
      }
      const r = rng.next();
      if (r < 0.1) {
        setRelation(M, a, b, 'family', rng.int(10, 40));
        const fam = Math.abs(num(a.age, 30) - num(b.age, 30)) > 18 ? 'parent' : rng.chance(0.3) ? 'cousin' : 'sibling';
        a.relations[b.id].fam = fam === 'parent' ? (num(a.age, 30) < num(b.age, 30) ? 'parent' : 'child') : fam;
        b.relations[a.id].fam = fam === 'parent' ? (num(b.age, 30) < num(a.age, 30) ? 'parent' : 'child') : fam;
        // родня — одна фамилия
        const s = surname(a);
        if (s && surname(b) && b.mindGen && !a.nameless && !b.nameless) b.name = `${String(b.name).split(' ')[0]} ${matchSurname(s, b, M.game.i18n.lang)}`;
      } else if (r < 0.18 && adult(a) && adult(b) && !M.api.partnerOf(a) && !M.api.partnerOf(b) && Math.abs(num(a.age, 30) - num(b.age, 30)) < 15) {
        setRelation(M, a, b, rng.chance(0.55) ? 'spouse' : 'lover', rng.int(35, 70));
      } else if (r < 0.38) {
        setRelation(M, a, b, 'friend', rng.int(30, 55));
      } else if (r < 0.46) {
        setRelation(M, a, b, 'rival', -rng.int(30, 50));
      } else {
        const op = rng.int(-12, 18);
        ensureRel(a, b).opinion = op + rng.int(-5, 5);
        ensureRel(b, a).opinion = op + rng.int(-5, 5);
        a.relations[b.id].name = b.name;
        b.relations[a.id].name = a.name;
      }
    }
}

/** Фамилия родственника с учётом рода (ru: Ветров → Ветрова). */
function matchSurname(s, who, lang) {
  if (lang !== 'ru') return s;
  const female = who.gender === 'female';
  const base = s.replace(/(ова|ева|ёва|ина)$/, (m) => m.slice(0, -1)).replace(/ая$/, 'ой');
  if (female) {
    if (/(ов|ев|ёв|ин)$/.test(base)) return `${base}а`;
    if (/ой$/.test(base)) return `${base.slice(0, -2)}ая`;
  }
  return base;
}

/** Дрейф мнений к базовому (раз в игровой час): 2% разницы. */
export function driftOpinions(M, p) {
  for (const [id, r] of Object.entries(p.relations || {})) {
    const o = M.game.entities.get(Number(id));
    if (!o || o.dead || !r) continue;
    const base = baseOpinion(M, p, o);
    r.opinion = num(r.opinion, 0) + (base - num(r.opinion, 0)) * 0.02;
  }
}

/** Список отношений для карточки: [{id, name, kind, fam, opinion, theirs, dead}]. */
export function relationList(M, p) {
  const out = [];
  for (const [id, r] of Object.entries(p?.relations || {})) {
    if (!r) continue;
    const o = M.game.entities.get(Number(id));
    if (o && o.faction !== 'colony' && !r.kind) continue;
    const name = o ? o.name : r.name;
    if (!name) continue;
    out.push({ id: Number(id), name: o?.nameless ? '???' : name, kind: r.kind || null, fam: r.fam || null, opinion: Math.round(num(r.opinion, 0)), theirs: o ? Math.round(opinionOf(o, p)) : null, dead: !o || !!o.dead });
  }
  const order = ['spouse', 'lover', 'family', 'friend', 'rival', 'ex'];
  out.sort((a, b) => (order.indexOf(a.kind) + 1 || 9) - (order.indexOf(b.kind) + 1 || 9) || Math.abs(b.opinion) - Math.abs(a.opinion));
  return out;
}
