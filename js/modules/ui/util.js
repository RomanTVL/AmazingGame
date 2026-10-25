// Общие помощники модуля ui: имена («???» для безымянных), настроение, время, данные карточки поселенца
// (game.api.mind.getSheet в любом из разумных форматов → единый вид), обнаружение заглушек ядра.
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../core/constants.js';
import { FACTION } from '../../core/constants.js';

/** Предоставлена ли функция API реальным модулем (а не заглушкой ядра). */
export function isReal(game, ns, fn) {
  return !!game.providers?.[ns]?.[fn];
}

/** Безопасный вызов game.api.<ns>.<fn>(...) — исключение пишется в game.errors, возвращается def. */
export function call(game, ns, fn, args = [], def = undefined) {
  const f = game.api?.[ns]?.[fn];
  if (typeof f !== 'function') return def;
  try {
    const v = f(...args);
    return v === undefined ? def : v;
  } catch (err) {
    game.error(err, `ui→${ns}.${fn}`);
    return def;
  }
}

/** Имя для отображения: «???» у безымянных (pawn.nameless). */
export function nameOf(game, p) {
  if (!p) return '—';
  if (p.nameless) return '???';
  return p.name || '—';
}

/** Короткое имя (первое слово). */
export function shortName(game, p) {
  const n = nameOf(game, p);
  return n === '???' ? n : n.split(' ')[0];
}

/** Перевести строку, если это известный ключ i18n, иначе вернуть как есть. */
export function tx(game, s, vars) {
  if (typeof s !== 'string' || !s) return s ?? '';
  if (!s.includes(' ') && s.includes('.') && game.i18n.has(s)) return game.t(s, vars);
  return s;
}

/** Настроение 0..1 (mind может отдавать 0..100). */
export function moodOf(game, p) {
  let v = call(game, 'mind', 'getMood', [p], p?.mood?.value ?? 0.6);
  if (!Number.isFinite(v)) v = 0.6;
  if (v > 1.001) v /= 100;
  return Math.max(0, Math.min(1, v));
}

export function moodColor(m) {
  return m >= 0.6 ? '#7dff6a' : m >= 0.35 ? '#ffd27a' : m >= 0.2 ? '#ffb347' : '#ff5f6d';
}

export function healthOf(game, p) {
  const s = call(game, 'health', 'getSummary', [p], null);
  const ratio = Number.isFinite(s?.ratio) ? Math.max(0, Math.min(1, s.ratio)) : (p?.health?.hp ?? 100) / (p?.health?.maxHp ?? 100);
  return { ratio: Number.isFinite(ratio) ? ratio : 1, label: s?.label || '' };
}

export function healthColor(r) {
  return r > 0.7 ? '#7dff6a' : r > 0.35 ? '#ffb347' : '#ff5f6d';
}

export function isColonistPawn(p) {
  return !!p && p.kind === 'pawn' && !p.dead && !p.removed && p.faction === FACTION.COLONY && !p.animal;
}

/** Колонисты для HUD: лидер первым, затем по id. Новый массив. */
export function colonistsSorted(game) {
  const list = game.colonists().filter((p) => !p.animal);
  const L = game.getLeader();
  list.sort((a, b) => (b === L) - (a === L) || a.id - b.id);
  return list;
}

/** Видна ли клетка лидеру (с учётом модуля vision; без него — видно всё). */
export function visibleTile(game, x, y) {
  return !!call(game, 'vision', 'isVisible', [Math.floor(x), Math.floor(y)], true);
}

export function visiblePawn(game, p) {
  return !!p && visibleTile(game, p.x, p.y);
}

const pad2 = (n) => String(Math.max(0, n | 0)).padStart(2, '0');

/** Тики → «Д3 14:20». */
export function tickStamp(game, tick) {
  const total = (tick || 0) + (game.time.startHour ?? 7) * TICKS_PER_HOUR;
  const day = Math.floor(total / TICKS_PER_DAY) + 1;
  const h = Math.floor((total % TICKS_PER_DAY) / TICKS_PER_HOUR);
  const m = Math.floor(((total % TICKS_PER_HOUR) / TICKS_PER_HOUR) * 60);
  return game.t('ui.time.stamp', { day, time: `${pad2(h)}:${pad2(Math.floor(m / 10) * 10)}` });
}

/** Тики → «m:ss» по секундам при скорости 1× (60 тиков = 1 с). */
export function ticksClock(ticks) {
  const s = Math.max(0, Math.ceil(ticks / 60));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** Часы игрового времени → «14 ч» / «2 д 5 ч». */
export function hoursText(game, hours) {
  if (!Number.isFinite(hours)) return '—';
  const h = Math.max(0, Math.round(hours));
  if (h < 48) return game.t('ui.time.hours', { n: h });
  return game.t('ui.time.daysHours', { d: Math.floor(h / 24), h: h % 24 });
}

export function plural(game, n, key) {
  const forms = game.i18n.raw(key);
  if (Array.isArray(forms)) return game.i18n.plural(n, forms);
  return game.t(key);
}

/** Сжатая дата сохранения. */
export function savedAtText(game, ms) {
  if (!ms) return '';
  try {
    const d = new Date(ms);
    return d.toLocaleString(game.i18n.lang === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// ---------- Карточка поселенца (данные) ----------

const PASSION = { none: 0, minor: 1, major: 2, '0': 0, '1': 1, '2': 2, true: 1, false: 0 };

export function passionLevel(v) {
  if (typeof v === 'number') return Math.max(0, Math.min(2, v | 0));
  if (v === undefined || v === null) return 0;
  return PASSION[String(v)] ?? 0;
}

function labelFrom(game, o, prefix) {
  if (!o) return '';
  if (typeof o === 'string') return defLabel(game, o, prefix);
  if (o.label) return tx(game, o.label);
  if (o.name) return tx(game, o.name);
  if (o.nameKey) return game.t(o.nameKey);
  if (o.text) return tx(game, o.text);
  if (o.id) return defLabel(game, o.id, prefix);
  return '';
}

/** Название по id из реестра модуля (traits/skills/thoughts/needs) или из строк ui. */
export function defLabel(game, id, prefix) {
  const reg = game.defs[prefix];
  const def = reg?.get?.(id);
  if (def?.nameKey && game.i18n.has(def.nameKey)) return game.t(def.nameKey);
  if (def?.label) return tx(game, def.label);
  const k = `ui.${prefix}.${id}`;
  if (game.i18n.has(k)) return game.t(k);
  if (prefix === 'workTypes') {
    const wt = game.defs.workTypes.get(id);
    if (wt) return game.t(wt.nameKey);
  }
  return String(id).replace(/_/g, ' ');
}

function isHiddenTrait(game, p, entry) {
  const id = typeof entry === 'string' ? entry : entry?.id;
  if (entry && typeof entry === 'object') {
    if (entry.revealed) return false;
    if (entry.hidden) return true;
  }
  if (Array.isArray(p?.revealedTraits) && p.revealedTraits.includes(id)) return false;
  if (Array.isArray(p?.hiddenTraits) && p.hiddenTraits.includes(id)) return true;
  if (p?.hiddenTraits && typeof p.hiddenTraits === 'object' && p.hiddenTraits[id]) return true;
  const def = game.defs.traits?.get?.(id);
  return !!def?.hidden && !(p?.revealedTraits || []).includes(id);
}

/** Черты: [{id, label, desc, hidden}] (скрытые — «???»). */
export function traitsOf(game, p, src) {
  const list = Array.isArray(src) ? src : Array.isArray(p?.traits) ? p.traits : [];
  const out = [];
  for (const t of list) {
    if (!t) continue;
    const id = typeof t === 'string' ? t : t.id;
    const hidden = isHiddenTrait(game, p, t);
    const def = id && game.defs.traits?.get?.(id);
    let desc = typeof t === 'object' ? tx(game, t.desc || t.description || '') : '';
    if (!desc && def?.descKey && game.i18n.has(def.descKey)) desc = game.t(def.descKey);
    out.push({ id, hidden, label: hidden ? '???' : labelFrom(game, t, 'traits'), desc: hidden ? game.t('ui.sheet.hiddenTrait') : desc });
  }
  return out;
}

/** Навыки: [{id, label, level, passion}] по порядку реестра skills (если есть). */
export function skillsOf(game, p, src) {
  const raw = src ?? p?.skills ?? {};
  const out = [];
  const push = (id, v) => {
    if (!id) return;
    const level = typeof v === 'number' ? v : Number(v?.level ?? v?.value ?? 0);
    out.push({
      id,
      label: typeof v === 'object' && (v.label || v.name || v.nameKey) ? labelFrom(game, v, 'skills') : defLabel(game, id, 'skills'),
      level: Number.isFinite(level) ? level : 0,
      passion: passionLevel(typeof v === 'object' ? v.passion : 0),
      disabled: !!(typeof v === 'object' && (v.disabled || v.incapable)),
    });
  };
  if (Array.isArray(raw)) for (const s of raw) push(s?.id ?? s?.skill, s);
  else if (raw && typeof raw === 'object') for (const [id, v] of Object.entries(raw)) push(id, v);
  const reg = game.defs.skills;
  if (reg?.all) {
    const order = new Map(reg.all().map((d, i) => [d.id, i]));
    out.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  }
  return out;
}

/** Потребности: [{id, label, value 0..1}]. */
export function needsOf(game, p, src) {
  const raw = src ?? p?.needs ?? {};
  const out = [];
  const push = (id, v) => {
    if (!id) return;
    let value = typeof v === 'number' ? v : Number(v?.value ?? v?.level ?? v?.cur);
    if (!Number.isFinite(value)) return;
    if (value > 1.001) value /= 100;
    out.push({ id, label: typeof v === 'object' && (v.label || v.name || v.nameKey) ? labelFrom(game, v, 'needs') : needLabel(game, id), value: Math.max(0, Math.min(1, value)) });
  };
  if (Array.isArray(raw)) for (const n of raw) push(n?.id, n);
  else if (raw && typeof raw === 'object') for (const [id, v] of Object.entries(raw)) push(id, v);
  return out;
}

export function needLabel(game, id) {
  if (game.i18n.has(`needs.${id}`)) return game.t(`needs.${id}`);
  return defLabel(game, id, 'needs');
}

/** Мысли: [{id, label, mood, count}] — из sheet или pawn.thoughts. */
export function thoughtsOf(game, p, src) {
  const raw = src ?? p?.thoughts ?? [];
  const out = [];
  const list = Array.isArray(raw) ? raw : Object.entries(raw).map(([id, v]) => ({ id, ...(typeof v === 'object' ? v : { mood: v }) }));
  for (const t of list) {
    if (!t) continue;
    const id = typeof t === 'string' ? t : t.id;
    const def = id && game.defs.thoughts?.get?.(id);
    let mood = Number(typeof t === 'object' ? t.mood ?? t.value ?? t.offset ?? def?.mood : def?.mood);
    if (!Number.isFinite(mood)) mood = 0;
    out.push({ id, label: labelFrom(game, t, 'thoughts') || defLabel(game, id, 'thoughts'), mood, count: typeof t === 'object' ? t.count || t.stack || 1 : 1 });
  }
  // слить одинаковые
  const merged = new Map();
  for (const t of out) {
    const m = merged.get(t.id);
    if (m && t.id) {
      m.mood += t.mood;
      m.count += t.count;
    } else merged.set(t.id || `${merged.size}`, { ...t });
  }
  return [...merged.values()].sort((a, b) => Math.abs(b.mood) - Math.abs(a.mood));
}

const REL_KIND = ['spouse', 'lover', 'family', 'friend', 'rival'];

/** Отношения: [{id, name, kind, opinion}] — из sheet или pawn.relations. */
export function relationsOf(game, p, src) {
  const raw = src ?? p?.relations ?? {};
  const out = [];
  const push = (id, v) => {
    const oid = Number(v?.pawnId ?? v?.otherId ?? v?.id ?? id);
    const other = Number.isFinite(oid) ? game.entities.get(oid) : null;
    const name = v?.name || (other ? nameOf(game, other) : null);
    if (!name) return;
    const opinion = Number(v?.opinion ?? v?.value ?? 0);
    out.push({ id: oid, name: other?.nameless ? '???' : name, kind: v?.kind || null, opinion: Number.isFinite(opinion) ? opinion : 0, dead: !other || other.dead });
  };
  if (Array.isArray(raw)) for (const r of raw) push(null, r);
  else if (raw && typeof raw === 'object') for (const [id, v] of Object.entries(raw)) push(id, v && typeof v === 'object' ? v : { opinion: v });
  out.sort((a, b) => (REL_KIND.indexOf(a.kind) + 1 || 9) - (REL_KIND.indexOf(b.kind) + 1 || 9) || Math.abs(b.opinion) - Math.abs(a.opinion));
  return out;
}

export function relKindLabel(game, kind) {
  if (!kind) return '';
  const k = `ui.rel.${kind}`;
  return game.i18n.has(k) ? game.t(k) : tx(game, kind);
}

/** Биография → [строки]. */
export function bioLines(game, p, src) {
  const bio = src ?? call(game, 'mind', 'getBio', [p], null) ?? p?.bio;
  const out = [];
  if (!bio) return out;
  const one = (label, v) => {
    if (!v) return;
    const s = typeof v === 'string' ? tx(game, v) : tx(game, v.title || v.name || v.label || v.text || '') + (v.desc ? ` — ${tx(game, v.desc)}` : '');
    if (s) out.push(label ? `${label}: ${s}` : s);
  };
  if (typeof bio === 'string') one('', bio);
  else {
    one(game.t('ui.sheet.childhood'), bio.childhood);
    one(game.t('ui.sheet.adulthood'), bio.adulthood);
    if (Array.isArray(bio.lines)) for (const l of bio.lines) one('', l);
    if (bio.quote) one('', `«${tx(game, bio.quote)}»`);
  }
  return out;
}

/** Полная сводка карточки: mind.getSheet + запасные поля пешки. */
export function sheetOf(game, p) {
  const s = call(game, 'mind', 'getSheet', [p], null) || {};
  return {
    traits: traitsOf(game, p, s.traits),
    skills: skillsOf(game, p, s.skills),
    needs: needsOf(game, p, s.needs),
    thoughts: thoughtsOf(game, p, s.thoughts),
    relations: relationsOf(game, p, s.relations),
    bio: bioLines(game, p, s.bio),
    mood: Number.isFinite(s.mood) ? (s.mood > 1.001 ? s.mood / 100 : s.mood) : moodOf(game, p),
    health: healthOf(game, p),
    conditions: conditionsOf(game, p, s.health?.conditions ?? s.conditions),
  };
}

export function conditionsOf(game, p, src) {
  const raw = src ?? p?.health?.conditions ?? [];
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const c of raw) {
    if (!c) continue;
    const id = typeof c === 'string' ? c : c.id || c.type;
    const label = typeof c === 'object' && (c.label || c.name || c.nameKey) ? labelFrom(game, c, 'conditions') : defLabel(game, id, 'conditions');
    const part = typeof c === 'object' && c.part ? defLabel(game, c.part, 'bodyParts') : '';
    out.push({ id, label: part ? `${label} (${part})` : label, severity: Number(c?.severity) || 0, bad: c?.good !== true });
  }
  return out.slice(0, 12);
}

/** Задача пешки — подпись. */
export function jobLabel(game, p) {
  if (!p) return '';
  if (p.asleep) return game.t('tt.asleep');
  if (p.downed) return game.t('ui.status.downed');
  const jt = p.job && game.defs.jobTypes.get(p.job.type);
  return jt?.labelKey ? game.t(jt.labelKey) : '';
}

/** Детерминированный (без ГСЧ) индекс по строке/числу. */
export function hashPick(n, len) {
  if (!len) return 0;
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % len;
}
