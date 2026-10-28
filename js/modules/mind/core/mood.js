// Мысли и настроение: память (pawn.thoughts — JSON), ситуативные мысли (pawn._situ — пересчитываются),
// множители черт, расчёт целевого настроения и плавное приближение к нему.
import { H, DAY, MOOD, NEEDS } from '../constants.js';
import { clamp01, num, isTravelling } from './util.js';
import { traitEffects, hasTrait } from './traits.js';

const MAX_THOUGHTS = 60;

/** Длительность мысли в тиках. */
function durationOf(def, opts) {
  if (Number.isFinite(opts.days)) return Math.max(1, opts.days * DAY);
  if (Number.isFinite(opts.hours)) return Math.max(1, opts.hours * H);
  if (Number.isFinite(def.days)) return def.days * DAY;
  if (Number.isFinite(def.hours)) return def.hours * H;
  return DAY;
}

/** Подпись мысли с чужим id (другой модуль не зарегистрировал её): ищем строку у других модулей. */
function adhocLabel(game, id) {
  for (const ns of ['mind', 'health', 'combat', 'economy', 'journey', 'train', 'vision', 'build'])
    for (const k of [`${ns}.thought.${id}`, `${ns}.thoughts.${id}`]) if (game.i18n.has(k)) return k;
  return null;
}

/** Зарегистрировать мысль (API registerThought). */
export function registerThought(M, def) {
  const game = M.game;
  if (!def?.id) return null;
  const reg = game.defs.thoughts;
  if (reg.has(def.id)) return reg.get(def.id);
  const d = { ...def };
  if (d.label && typeof d.label === 'object') {
    for (const lang of Object.keys(d.label)) game.i18n.add(lang, { mind: { thought: { [d.id]: d.label[lang] } } });
    d.nameKey = `mind.thought.${d.id}`;
    delete d.label;
  } else if (typeof d.label === 'string') {
    game.i18n.add('ru', { mind: { thought: { [d.id]: d.label } } });
    d.nameKey = `mind.thought.${d.id}`;
    delete d.label;
  }
  if (!d.nameKey) d.nameKey = adhocLabel(game, d.id) || `mind.thought.${d.id}`;
  return reg.add(d, def.owner || 'mind');
}

export function thoughtLabel(game, def, id) {
  const key = def?.nameKey;
  if (key && game.i18n.has(key)) return game.t(key);
  const k2 = adhocLabel(game, id);
  if (k2) return game.t(k2);
  return String(id || '?').replace(/_/g, ' ');
}

/** Множитель мысли от черт пешки. */
export function thoughtMul(M, pawn, def) {
  let m = 1;
  const eff = traitEffects(M, pawn);
  const tm = eff.thoughtMul?.[def.id];
  if (Number.isFinite(tm)) m *= tm;
  if (def.grief) m *= eff.griefMul;
  if (def.smallJoy) m *= eff.smallJoyMul;
  return m;
}

/**
 * Добавить мысль-память. opts: {mood, days, hours, source, otherPawnId, stackKey}.
 * Неизвестный id: с opts.mood — регистрируется «на лету», без — пропускается (лог один раз). Не бросает.
 */
export function addThought(M, pawn, id, opts = {}) {
  const game = M.game;
  if (!pawn || !id || pawn.dead || pawn.animal || pawn.kind !== 'pawn') return null;
  opts = opts || {};
  let def = game.defs.thoughts.get(id);
  if (!def) {
    if (Number.isFinite(opts.mood)) {
      def = registerThought(M, { id, mood: opts.mood, days: Number.isFinite(opts.days) ? opts.days : 1, stack: 2, owner: 'mind:adhoc' });
    } else {
      if (!M.R.unknown.has(id)) {
        M.R.unknown.add(id);
        if (!game.isHeadless) console.warn(`[mind] неизвестная мысль "${id}" — пропущена`);
      }
      return null;
    }
  }
  if (def.situ) return null;
  const now = game.time.tick;
  const dur = durationOf(def, opts);
  const mood = Number.isFinite(opts.mood) ? opts.mood : num(def.mood, 0);
  const other = opts.otherPawnId ?? opts.source?.id ?? 0;
  const list = (pawn.thoughts ||= []);
  let same = 0;
  let oldest = null;
  let match = null;
  for (const t of list) {
    if (t.id !== id) continue;
    same++;
    if (other && t.o === other) match = t;
    if (!oldest || t.until < oldest.until) oldest = t;
  }
  const max = Math.max(1, def.stack | 0 || 1);
  let entry;
  if (match || same >= max) {
    entry = match || oldest;
    entry.until = now + dur;
    entry.mood = mood;
    entry.start = now;
    if (other) entry.o = other;
  } else {
    entry = { id, mood, start: now, until: now + dur };
    if (other) entry.o = other;
    list.push(entry);
    if (list.length > MAX_THOUGHTS) {
      list.sort((a, b) => b.until - a.until);
      list.length = MAX_THOUGHTS;
    }
  }
  pawn._moodDirty = true;
  game.events.emit('mind:thought', { pawn, id, mood });
  return entry;
}

export function removeThought(M, pawn, id) {
  if (!pawn?.thoughts) return 0;
  const n = pawn.thoughts.length;
  pawn.thoughts = pawn.thoughts.filter((t) => t.id !== id);
  pawn._moodDirty = true;
  return n - pawn.thoughts.length;
}

export function hasThought(pawn, id) {
  return !!pawn?.thoughts?.some((t) => t.id === id);
}

/** Есть ли у пешки горе (мысль с grief). */
export function grieving(M, pawn) {
  const reg = M.game.defs.thoughts;
  return !!pawn?.thoughts?.some((t) => reg.get(t.id)?.grief);
}

/** Удалить истёкшие воспоминания; таблица памяти ускоряет таяние горя. */
export function purgeThoughts(M, pawn) {
  const list = pawn.thoughts;
  if (!list?.length) return;
  const game = M.game;
  const now = game.time.tick;
  const reg = game.defs.thoughts;
  const memorial = pawn.memorialUntil > now;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (memorial && reg.get(t.id)?.grief) t.until -= H; // вызывается раз в час: горе тает вдвое быстрее
    if (t.until > now) list[w++] = t;
  }
  if (w !== list.length) {
    list.length = w;
    pawn._moodDirty = true;
  }
}

// ---------------------------------------------------------------- ситуативные мысли
function situ(out, id, mood) {
  out.push({ id, mood });
}

/** Пересчитать ситуативные мысли пешки (pawn._situ = [{id, mood}]). */
export function computeSitu(M, p) {
  const game = M.game;
  const out = p._situ || (p._situ = []);
  out.length = 0;
  const n = p.needs || {};
  const eff = traitEffects(M, p);
  const reg = game.defs.thoughts;
  const md = (id) => num(reg.get(id)?.mood, 0) * (num(eff.thoughtMul?.[id], 1));
  const food = num(n.food, 1);
  if (food < NEEDS.starvingAt) situ(out, 'starving', md('starving'));
  else if (food < NEEDS.hungryAt) situ(out, 'hungry', md('hungry'));
  const rest = num(n.rest, 1);
  if (rest < 0.03) situ(out, 'exhausted', md('exhausted'));
  else if (rest < NEEDS.tiredAt) situ(out, 'tired', md('tired'));
  const joy = num(n.joy, 1);
  if (joy < 0.08) situ(out, 'joy_starved', md('joy_starved'));
  else if (joy < 0.25) situ(out, 'bored', md('bored'));
  if (num(n.social, 1) < 0.15) situ(out, 'lonely', md('lonely'));
  if (num(n.comfort, 1) < 0.22 && eff.comfortNeed > 0) situ(out, 'uncomfortable', md('uncomfortable') * eff.comfortNeed);
  // черты с постоянным настроением
  for (const tid of p.traits || []) {
    const td = game.defs.traits.get(tid);
    const bm = td?.effects?.baseMood;
    if (bm && reg.has(`trait_${tid}`)) situ(out, `trait_${tid}`, bm);
  }
  const travelling = M.R._travelling;
  if (hasTrait(M, p, 'motion_sick')) situ(out, travelling ? 'motion_sick' : 'solid_ground', md(travelling ? 'motion_sick' : 'solid_ground'));
  if (travelling && p.pose === 'window' && hasTrait(M, p, 'sleeper_counter')) situ(out, 'counting_sleepers', md('counting_sleepers') * eff.smallJoyMul);
  if (p.inspiration && p.inspiration.until > game.time.tick) situ(out, 'inspired', 4);
  if (!p.isLeader && game.getLeader()) {
    const a = num(game.colony.authority, 50);
    if (a < 25) situ(out, 'weak_leader', md('weak_leader'));
    else if (a > 75) situ(out, 'strong_leader', md('strong_leader'));
  }
  return out;
}

// ---------------------------------------------------------------- настроение
/** Очки настроения от памяти (со стаками) + ситуативные. */
export function moodPoints(M, p) {
  const game = M.game;
  const reg = game.defs.thoughts;
  let pts = 0;
  const list = p.thoughts || [];
  // ранги одинаковых мыслей: сильнейшая даёт полный вклад, следующие — × stackFactor^i
  const rank = M.R._rank || (M.R._rank = new Map());
  rank.clear();
  const sorted = list.length > 1 ? list.slice().sort((a, b) => Math.abs(b.mood) - Math.abs(a.mood)) : list;
  for (const t of sorted) {
    const def = reg.get(t.id);
    if (!def) continue;
    const r = rank.get(t.id) || 0;
    rank.set(t.id, r + 1);
    const sf = num(def.stackFactor, 1);
    pts += num(t.mood, 0) * thoughtMul(M, p, def) * (r ? sf ** r : 1);
  }
  for (const s of p._situ || []) pts += num(s.mood, 0);
  return pts;
}

export function targetMood(M, p) {
  return clamp01(MOOD.base + moodPoints(M, p) / 100);
}

/** Обновить настроение (вызывается раз в 30 тиков на пешку). */
export function updateMood(M, p, ticks) {
  const t = targetMood(M, p);
  const m = (p.mood ||= { value: 0.6 });
  if (!Number.isFinite(m.value)) m.value = 0.6;
  const k = 1 - Math.exp(-(MOOD.ratePerHour * ticks) / H);
  m.value = clamp01(m.value + (t - m.value) * k);
  m.target = Math.round(t * 1000) / 1000;
  p._moodDirty = false;
}

export function getMood(p) {
  const v = p?.mood?.value;
  return Number.isFinite(v) ? v : 0.6;
}

/** Список мыслей для карточки: [{id, label, mood, count, remaining (ч), situational}]. */
export function thoughtList(M, p) {
  const game = M.game;
  const reg = game.defs.thoughts;
  const now = game.time.tick;
  const by = new Map();
  const sorted = (p.thoughts || []).slice().sort((a, b) => Math.abs(b.mood) - Math.abs(a.mood));
  for (const t of sorted) {
    const def = reg.get(t.id);
    if (!def) continue;
    let e = by.get(t.id);
    if (!e) by.set(t.id, (e = { id: t.id, label: thoughtLabel(game, def, t.id), mood: 0, count: 0, remaining: 0, situational: false }));
    const sf = num(def.stackFactor, 1);
    e.mood += num(t.mood, 0) * thoughtMul(M, p, def) * (e.count ? sf ** e.count : 1);
    e.count++;
    e.remaining = Math.max(e.remaining, (t.until - now) / H);
  }
  for (const s of p._situ || []) {
    const def = reg.get(s.id);
    by.set(`s:${s.id}`, { id: s.id, label: thoughtLabel(game, def, s.id), mood: s.mood, count: 1, remaining: 0, situational: true });
  }
  const out = [...by.values()];
  for (const e of out) e.mood = Math.round(e.mood * 10) / 10;
  out.sort((a, b) => Math.abs(b.mood) - Math.abs(a.mood));
  return out.filter((e) => e.mood !== 0 || e.situational);
}

export { isTravelling };
