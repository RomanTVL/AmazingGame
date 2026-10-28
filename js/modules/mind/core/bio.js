// Биографии, имена, кандидаты, заполнение компонентов новой пешки, последние слова и прощальное слово.
import { generateName } from '../../../sim/pawn.js';
import { CHILDHOOD, ADULTHOOD, QUOTES, WISHES } from '../defs/bio.js';
import { NEED_IDS } from '../constants.js';
import { rollTraits, traitEffects, isHidden } from './traits.js';
import { rollSkills, normalizeSkills, incapableWork } from './skills.js';
import { firstName, isFemale, num } from './util.js';

const CH = new Map(CHILDHOOD.map((b) => [b.id, b]));
const AD = new Map(ADULTHOOD.map((b) => [b.id, b]));

/** Сгенерировать биографию (данные — id, тексты берутся из i18n в getBio). */
export function rollBio(rng, { age = 30 } = {}) {
  const child = rng.pick(CHILDHOOD);
  let adult = rng.pick(ADULTHOOD);
  // «неспособен к насилию» с детства не идёт в наёмники
  if (child.incapable?.includes('violent') && (adult.skills.melee || adult.skills.shooting) > 2) adult = rng.pick(ADULTHOOD.filter((a) => !(a.skills.melee > 2 || a.skills.shooting > 2)));
  const incapable = [...new Set([...(child.incapable || []), ...(adult.incapable || [])])];
  return { childhood: child.id, adulthood: age >= 20 ? adult.id : null, quote: rng.int(0, QUOTES.length - 1), wish: rng.pick(WISHES).id, incapable };
}

function bioBonus(bio) {
  const out = {};
  for (const b of [CH.get(bio?.childhood), AD.get(bio?.adulthood)]) if (b) for (const [k, v] of Object.entries(b.skills || {})) out[k] = (out[k] || 0) + v;
  return out;
}

/** Кандидат для экрана новой игры: {name, gender, age, bio, traits, skills, look, role, incapable}. Детерминирован для rng. */
export function generateCandidate(M, rng, opts = {}) {
  const game = M.game;
  const gender = opts.gender || (rng.chance(0.5) ? 'male' : 'female');
  const lang = opts.lang || game.i18n.lang;
  const name = generateName(rng, lang, gender);
  const ageMin = Math.max(16, num(opts.ageMin, 18));
  const ageMax = Math.max(ageMin, num(opts.ageMax, 62));
  const age = Number.isFinite(opts.age) ? opts.age : rng.int(ageMin, ageMax);
  const bio = rollBio(rng, { age });
  const mage = opts.role === 'leader' || !!opts.mage;
  const traits = rollTraits(game, rng, rng.chance(0.35) ? 3 : 2, Array.isArray(opts.traits) ? opts.traits : []);
  const eff = traitEffects(M, { traits });
  const bonus = bioBonus(bio);
  for (const [k, v] of Object.entries(eff.skills)) bonus[k] = (bonus[k] || 0) + v / 1.5;
  const skills = rollSkills(game, rng, { bonus, age, mage, incapable: bio.incapable });
  if (opts.skills && typeof opts.skills === 'object') {
    for (const [id, v] of Object.entries(opts.skills)) {
      if (!skills[id]) continue;
      if (typeof v === 'number') skills[id].level = Math.max(skills[id].level, v);
      else if (v && typeof v === 'object') Object.assign(skills[id], v);
    }
  }
  const hidden = traits.filter((t) => game.defs.traits.get(t)?.hidden);
  return {
    name, gender, age, bio, traits, skills, look: {}, role: opts.role || null, incapable: bio.incapable,
    ...(hidden.length ? { hiddenTraits: hidden } : {}),
  };
}

/** Расписание по умолчанию: 22–5 сон, 21 — отдых, остальное — любое. */
export function defaultSchedule() {
  const s = [];
  for (let h = 0; h < 24; h++) s.push(h >= 22 || h < 6 ? 'sleep' : h === 21 ? 'joy' : 'any');
  return s;
}

/**
 * Заполнить компоненты mind у пешки — ТОЛЬКО недостающее (готовые bio/traits/skills из roster не трогаем).
 * Вызывается на pawn:spawned для колонистов и лениво в системах (завербованные пленные и т.п.).
 */
export function ensurePawn(M, pawn) {
  const game = M.game;
  if (!pawn || pawn.kind !== 'pawn' || pawn.animal) return;
  if (pawn.mindv === 1 && pawn.needs?.joy !== undefined) return;
  const rng = game.rng.fork(`mind:pawn:${pawn.id}:${pawn.name}`);
  let generatedBio = false;
  if (pawn.bio === undefined || pawn.bio === null) {
    pawn.bio = rollBio(rng, { age: num(pawn.age, 30) });
    generatedBio = true;
    pawn.mindGen = !pawn.isLeader;
  }
  if (!Array.isArray(pawn.incapable)) pawn.incapable = Array.isArray(pawn.bio?.incapable) ? pawn.bio.incapable.slice() : [];
  if (!Array.isArray(pawn.traits) || pawn.traits.length === 0) {
    if (!pawn.traitsSet) pawn.traits = rollTraits(game, rng, rng.chance(0.35) ? 3 : 2);
  }
  pawn.traitsSet = true;
  // скрытые черты из roster/кандидата
  for (const t of pawn.traits) if (game.defs.traits.get(t)?.hidden && !pawn.revealedTraits?.includes(t)) {
    pawn.hiddenTraits ||= [];
    if (!pawn.hiddenTraits.includes(t)) pawn.hiddenTraits.push(t);
  }
  const hasSkills = pawn.skills && Object.keys(pawn.skills).length > 0;
  if (!hasSkills) {
    const eff = traitEffects(M, pawn);
    const bonus = bioBonus(pawn.bio);
    for (const [k, v] of Object.entries(eff.skills)) bonus[k] = (bonus[k] || 0) + v / 1.5;
    pawn.skills = rollSkills(game, rng, { bonus, age: num(pawn.age, 30), mage: !!pawn.mage, incapable: pawn.incapable });
  } else {
    // roster дал часть навыков — дополнить недостающие, уровни не менять
    normalizeSkills(game, pawn);
    const extra = rollSkills(game, rng, { bonus: bioBonus(pawn.bio), age: num(pawn.age, 30), mage: !!pawn.mage, incapable: pawn.incapable });
    for (const [id, v] of Object.entries(extra)) if (!pawn.skills[id]) pawn.skills[id] = v;
  }
  normalizeSkills(game, pawn);
  if (pawn.mage && pawn.skills.magic && pawn.skills.magic.level < 6 && !pawn.skills.magic.fixed) pawn.skills.magic.level = Math.max(6, pawn.skills.magic.level);
  // потребности
  const n = (pawn.needs ||= {});
  n.food ??= 0.8 + rng.next() * 0.2;
  n.rest ??= 0.75 + rng.next() * 0.25;
  for (const id of NEED_IDS) if (!Number.isFinite(n[id])) n[id] = id === 'beauty' ? 0.5 : 0.7 + rng.next() * 0.25;
  pawn.mood ||= { value: 0.6 };
  if (!Number.isFinite(pawn.mood.value)) pawn.mood.value = 0.6;
  pawn.thoughts ||= [];
  pawn.relations ||= {};
  if (!Array.isArray(pawn.schedule) || pawn.schedule.length !== 24) pawn.schedule = defaultSchedule();
  // неспособность — снять приоритеты таких работ (только для сгенерированных нами биографий)
  if (generatedBio || !pawn.incapApplied) {
    const inc = incapableWork(pawn);
    if (inc.size && pawn.workPriorities) for (const wt of inc) if (wt in pawn.workPriorities) pawn.workPriorities[wt] = 0;
    pawn.incapApplied = true;
  }
  pawn.mindv = 1;
}

// ---------------------------------------------------------------- биография для других модулей
function bioPart(game, kind, id) {
  if (!id) return null;
  if (typeof id === 'object') return id;
  const base = `mind.bio.${kind}.${id}`;
  if (!game.i18n.has(`${base}.title`)) return { id, title: String(id), desc: '', line: '' };
  return { id, title: game.t(`${base}.title`), desc: game.t(`${base}.desc`), line: game.t(`${base}.line`) };
}

/**
 * Биография для ui/health: {childhood, adulthood: {id, title, desc, line}, quote, wish, lines[], summary, incapable[], lastWords}.
 * Чужой формат (строка/объект из roster) возвращается как есть, дополненный там, где можно.
 */
export function getBio(M, pawn) {
  const game = M.game;
  const b = pawn?.bio;
  if (!b) return null;
  if (typeof b === 'string') return { summary: b, lines: [b], quote: null, wish: null };
  const childhood = bioPart(game, 'child', b.childhood);
  const adulthood = bioPart(game, 'adult', b.adulthood);
  const quote = typeof b.quote === 'number' ? game.t('mind.bio.quote', { variant: b.quote }) : typeof b.quote === 'string' ? b.quote : null;
  const wish = typeof b.wish === 'string' && game.i18n.has(`mind.bio.wish.${b.wish}`) ? game.t(`mind.bio.wish.${b.wish}`) : typeof b.wish === 'string' ? b.wish : null;
  const lines = [childhood?.line, adulthood?.line].filter((s) => typeof s === 'string' && s.trim());
  const summary = [childhood?.title, adulthood?.title].filter(Boolean).join(' · ');
  return {
    ...b, childhood, adulthood, quote, wish, lines, summary,
    incapable: (pawn.incapable || []).map((t) => (game.i18n.has(`mind.work.${t}`) ? game.t(`mind.work.${t}`) : t)),
    lastWords: lastWords(M, pawn),
  };
}

/** Короткие «последние слова» (health берёт для сцены смерти). Без шуток — серьёзный тон. */
export function lastWords(M, pawn) {
  const game = M.game;
  if (!pawn) return null;
  const f = isFemale(pawn);
  const v = (pawn.id * 7 + game.time.day) | 0;
  if (isHidden(pawn, 'runaway_debtor')) return game.t(`mind.lastWords.debtor.${f ? 'f' : 'm'}`);
  if (isHidden(pawn, 'ex_cultist')) return game.t('mind.lastWords.cultist');
  const friend = bestFriend(M, pawn);
  const wishId = pawn.bio?.wish;
  const opts = [];
  if (friend) opts.push(() => game.t('mind.lastWords.friend', { friend: firstName(friend) }));
  if (typeof wishId === 'string' && game.i18n.has(`mind.bio.wish.${wishId}`)) opts.push(() => game.t(`mind.lastWords.wish.${f ? 'f' : 'm'}`, { wish: game.t(`mind.bio.wish.${wishId}`) }));
  opts.push(() => game.t('mind.lastWords.train'), () => game.t('mind.lastWords.remember'));
  if (num(pawn.needs?.warmth, 1) < 0.3) opts.push(() => game.t('mind.lastWords.cold'));
  return opts[v % opts.length]();
}

/** Лучший друг среди живых (по мнению пешки). */
export function bestFriend(M, pawn, alive = true) {
  const game = M.game;
  let best = null;
  let bo = 15;
  for (const [id, r] of Object.entries(pawn?.relations || {})) {
    const o = game.entities.get(Number(id));
    if (alive && (!o || o.dead)) continue;
    const op = num(r?.opinion, 0) + (r?.kind === 'spouse' || r?.kind === 'lover' ? 30 : r?.kind === 'family' ? 15 : 0);
    if (op > bo) {
      bo = op;
      best = o || { id: Number(id), name: r?.name || '' };
    }
  }
  return best;
}

// ---------------------------------------------------------------- прощальное слово
/**
 * Варианты прощального слова по фактам павшего: [{id, label, text, effects}].
 * record — запись «Павших» health ({pawnId, name, gender, skills, traits, relations, cause}) или сама пешка.
 * effects: {mourners: очки мысли скорбящим, thought, rivalsOpinionOfLeader, authority}.
 */
export function eulogyOptions(M, record) {
  const game = M.game;
  if (!record) return [];
  const pawn = record.kind === 'pawn' ? record : game.entities.get(record.pawnId) || null;
  const src = pawn || record;
  const f = src.gender === 'female';
  const sfx = f ? '_f' : '';
  const name = firstName(src);
  const skills = src.skills || {};
  let best = null;
  let bl = -1;
  for (const [id, v] of Object.entries(skills)) {
    const lv = typeof v === 'number' ? v : num(v?.level, 0);
    if (lv > bl && game.i18n.has(`mind.eulogy.skillRole.${id}`)) {
      bl = lv;
      best = id;
    }
  }
  const trait = (src.traits || []).find((t) => game.i18n.has(`mind.eulogy.traitLine.${t}`)) || 'default';
  const causeId = String(record.cause || src.cause || 'default');
  const ck = game.i18n.has(`mind.eulogy.causeLine${sfx}.${causeId}`) ? causeId : /bleed/.test(causeId) ? 'bleeding' : /starv/.test(causeId) ? 'starvation' : /cold|freez/.test(causeId) ? 'cold' : /rot/.test(causeId) ? 'rot' : /combat|raid|shot|cut|bite|wound/.test(causeId) ? 'combat' : 'default';
  const cause = game.t(`mind.eulogy.causeLine${sfx}.${ck}`);
  // кто был близок, кто не любил
  const pid = src.id || record.pawnId;
  let friend = null;
  let fo = 20;
  let haters = 0;
  let total = 0;
  let sum = 0;
  for (const o of M.colonists()) {
    if (o.id === pid) continue;
    const r = o.relations?.[pid];
    if (!r) continue;
    total++;
    sum += num(r.opinion, 0);
    if (num(r.opinion, 0) < -20 || r.kind === 'rival') haters++;
    const op = num(r.opinion, 0) + (r.kind === 'spouse' || r.kind === 'lover' ? 30 : 0);
    if (op > fo) {
      fo = op;
      friend = o;
    }
  }
  const disliked = total > 0 && (sum / total < -10 || haters * 2 > total);
  const skillRole = best ? game.t(`mind.eulogy.skillRole${sfx}.${best}`) : game.t(`mind.eulogy.skillRole${sfx}.social`);
  const opts = [
    {
      id: 'truth', label: game.t('mind.eulogy.label.truth'),
      text: game.t(`mind.eulogy.truth${sfx}`, { name, skill: skillRole, trait: game.t(`mind.eulogy.traitLine${sfx}.${trait}`) }),
      effects: { mourners: 3, thought: 'eulogy_truth', authority: 3 },
    },
    {
      id: 'praise', label: game.t('mind.eulogy.label.praise'),
      text: game.t(`mind.eulogy.praise${sfx}`, { name }),
      effects: { mourners: 1, thought: 'eulogy_praise', authority: 3, rivalsOpinionOfLeader: disliked ? -5 : 0, disliked },
    },
    friend
      ? {
        id: 'friend', label: game.t('mind.eulogy.label.friend'),
        text: game.t(`mind.eulogy.friend${sfx}`, { name, friend: firstName(friend), cause }),
        effects: { mourners: 2, thought: 'eulogy_friend', friendId: friend.id, authority: 3 },
      }
      : {
        id: 'cause', label: game.t('mind.eulogy.label.cause'),
        text: game.t(`mind.eulogy.cause${sfx}`, { cause }),
        effects: { mourners: 2, thought: 'eulogy_moved', authority: 3 },
      },
  ];
  return opts;
}

/** Применить выбранное прощальное слово (если health не применил сам). */
export function applyEulogy(M, record, optionId, mourners) {
  const game = M.game;
  const opt = eulogyOptions(M, record).find((o) => o.id === optionId);
  if (!opt) return false;
  const pid = record.pawnId || record.id;
  const list = Array.isArray(mourners) && mourners.length ? mourners : M.colonists();
  for (const o of list) {
    if (!o || o.id === pid) continue;
    M.api.addThought(o, opt.effects.thought, { otherPawnId: pid });
    if (opt.effects.friendId === o.id) M.api.addThought(o, 'eulogy_friend', { otherPawnId: pid });
  }
  if (opt.effects.rivalsOpinionOfLeader) {
    const L = game.getLeader();
    if (L) for (const o of list) {
      const r = o.relations?.[pid];
      if (r && (num(r.opinion, 0) < -20 || r.kind === 'rival')) M.api.changeOpinion(o, L, opt.effects.rivalsOpinionOfLeader);
    }
  }
  return true;
}

export { CH as CHILDHOOD_BY_ID, AD as ADULTHOOD_BY_ID };
