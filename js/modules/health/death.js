// Смерть: труп, «Павшие», эпитафии, последнее дыхание и последние слова, горе, сцена смерти, наследник, посох,
// «Память» колонии, вещи на память.
import { EVENTS } from '../../core/events.js';
import { FACTION, TICKS_PER_HOUR, TICKS_PER_DAY } from '../../core/constants.js';
import { stopMoving } from '../../sim/pawn.js';
import { ensureHealth, computeCache } from './model.js';
import { BAL } from './defs.js';

const clamp100 = (v) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
export const firstName = (name) => String(name || '?').split(' ')[0];

/** Родительный падеж имени (ru, простые правила для имён игры). */
export function genitive(name, lang) {
  const n = firstName(name);
  if (lang !== 'ru') return n;
  if (/ий$/.test(n)) return n.slice(0, -1) + 'я';
  if (/[ая]$/.test(n) && /ия$/.test(n)) return n.slice(0, -1) + 'и';
  if (/ья$/.test(n)) return n.slice(0, -1) + 'и';
  if (/[гкхжшщч]а$/.test(n)) return n.slice(0, -1) + 'и';
  if (/а$/.test(n)) return n.slice(0, -1) + 'ы';
  if (/я$/.test(n)) return n.slice(0, -1) + 'и';
  if (/й$/.test(n)) return n.slice(0, -1) + 'я';
  if (/ь$/.test(n)) return n.slice(0, -1) + 'я';
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(n)) return n + 'а';
  return n;
}

const safe = (fn, fallback = null) => {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
};

/** Отношение a → b: {kind, opinion} (через поля пешки; mind хранит pawn.relations). */
export function relationOf(a, bId) {
  const r = a?.relations?.[bId];
  if (!r) return null;
  return { kind: String(r.kind || '').toLowerCase(), opinion: Number.isFinite(r.opinion) ? r.opinion : 0 };
}

const LOVER = ['spouse', 'lover', 'partner', 'wife', 'husband', 'fiance', 'fiancee', 'bride', 'groom', 'love'];
const FAMILY = ['family', 'parent', 'child', 'sibling', 'brother', 'sister', 'mother', 'father', 'son', 'daughter', 'aunt', 'uncle', 'cousin', 'grandparent', 'grandchild', 'relative', 'kin'];

export function closeness(rel) {
  if (!rel) return 'none';
  if (LOVER.includes(rel.kind)) return 'lover';
  if (FAMILY.includes(rel.kind)) return 'family';
  if (rel.kind === 'rival' || rel.kind === 'enemy' || rel.opinion <= -30) return 'rival';
  if (rel.kind === 'friend' || rel.kind === 'bestfriend' || rel.opinion >= 30) return 'friend';
  return 'none';
}

/** Биография (mind.getBio, иначе pawn.bio). */
export function getBio(game, pawn) {
  return safe(() => game.api.mind.getBio?.(pawn)) || pawn?.bio || null;
}

const textOf = (v) => (typeof v === 'string' && v.includes(' ') ? v : v && typeof v === 'object' ? v.text || v.desc || v.line || null : null);

/** Одна строка из биографии для сцены смерти и «Павших». */
export function bioLine(game, pawn, rng) {
  const bio = getBio(game, pawn);
  if (typeof bio === 'string' && bio.trim()) return bio.trim();
  if (bio && typeof bio === 'object') {
    const lines = Array.isArray(bio.lines) ? bio.lines.filter((s) => typeof s === 'string' && s.trim()) : [];
    const cand = [bio.quote, bio.memorable, bio.lastLine, bio.line, lines.length ? lines[Math.floor((rng ? rng.next() : 0) * lines.length)] : null, bio.summary, textOf(bio.adulthood), textOf(bio.childhood)];
    for (const c of cand) if (typeof c === 'string' && c.trim()) return c.trim();
  }
  const v = rng ? rng.int(0, 99) : pawn.id;
  if (pawn.mage || pawn.isLeader) return game.t('health.bio.leader', { variant: v, f: pawn.gender === 'female' });
  return game.t(pawn.gender === 'female' ? 'health.bio.f' : 'health.bio.m', { variant: v });
}

/** Лучший друг среди живых (по мнению умирающего). */
export function bestFriend(game, pawn) {
  let best = null;
  let bestOp = 10;
  for (const o of game.colonists()) {
    if (o === pawn) continue;
    const r = relationOf(pawn, o.id) || relationOf(o, pawn.id);
    if (!r) continue;
    const score = r.opinion + (LOVER.includes(r.kind) ? 60 : FAMILY.includes(r.kind) ? 40 : r.kind === 'friend' ? 20 : 0);
    if (score > bestOp) {
      bestOp = score;
      best = o;
    }
  }
  return best;
}

function hiddenTrait(game, pawn) {
  const hidden = [];
  if (Array.isArray(pawn.hiddenTraits)) hidden.push(...pawn.hiddenTraits);
  if (pawn.traitMeta && typeof pawn.traitMeta === 'object') for (const [id, m] of Object.entries(pawn.traitMeta)) if (m?.hidden && !m.revealed) hidden.push(id);
  for (const t of pawn.traits || []) {
    if (t && typeof t === 'object' && t.hidden && !t.revealed) hidden.push(t.id);
    if (typeof t === 'string' && (t === 'runaway_debtor' || t === 'ex_cultist') && !pawn.revealedTraits?.includes(t)) hidden.push(t);
  }
  return hidden[0] || null;
}

/** Последние слова: незакрытое желание, имя лучшего друга или скрытая черта. */
export function makeLastWords(game, pawn) {
  const rng = game.rng.fork(`words:${pawn.id}:${pawn.name}`);
  const bio = getBio(game, pawn);
  const wish = bio && typeof bio === 'object' ? [bio.wish, bio.goal, bio.dream, bio.unfinished, bio.desire].find((s) => typeof s === 'string' && s.trim()) : null;
  const friend = bestFriend(game, pawn);
  const hidden = hiddenTrait(game, pawn);
  const opts = [];
  if (hidden) opts.push(['hidden', 4]);
  if (wish) opts.push(['wish', 3.5]);
  if (friend) opts.push(['friend', 3]);
  opts.push(['plain', 1.5]);
  const kind = rng.weighted(opts, (o) => o[1])[0];
  const v = rng.int(0, 99);
  const f = pawn.gender === 'female';
  if (kind === 'hidden') {
    const key = game.i18n.has(`health.words.hidden_${hidden}`) ? `health.words.hidden_${hidden}` : 'health.words.hidden';
    return game.t(key, { variant: v, f });
  }
  if (kind === 'wish') return game.t('health.words.wish', { wish: wish.trim().replace(/[.!?…]+$/, ''), variant: v, f });
  if (kind === 'friend') return game.t('health.words.friend', { friend: firstName(friend.name), variant: v, f });
  return game.t('health.words.plain', { variant: v, f });
}

// ------------------------------------------------------------------ эпитафии
function bestSkillOf(pawn) {
  let best = null;
  let lvl = 5;
  for (const [k, s] of Object.entries(pawn.skills || {})) {
    const l = Number.isFinite(s?.level) ? s.level : Number.isFinite(s) ? s : 0;
    if (l > lvl) {
      lvl = l;
      best = k;
    }
  }
  return best;
}

/** Эпитафия из фактов (мягко; сухой юмор ≈1 из 8 — только здесь, не в сцене смерти). */
export function makeEpitaph(game, rec) {
  const rng = game.rng.fork(`epitaph:${rec.id}:${rec.name}`);
  const vars = { first: firstName(rec.name), age: rec.age ?? '?', f: rec.gender === 'female', station: rec.station?.name || '', variant: rng.int(0, 999) };
  if (rec.kind === 'left') return game.t('health.epitaph.left', vars);
  if (rng.chance(1 / 8)) return game.t('health.epitaph.dry', vars);
  if (rec.wasLeader) return game.t('health.epitaph.leader', vars);
  const cause = String(rec.cause || '');
  const pool = [];
  if (cause === 'blood_loss' || cause.startsWith('wounds')) pool.push('wounds');
  if (['infection', 'grey_rot', 'fever'].includes(cause)) pool.push('disease');
  if (cause === 'starvation') pool.push('starvation');
  if (rec.bestSkill && game.i18n.has(`health.epitaph.skill_${rec.bestSkill}`)) pool.push(`skill_${rec.bestSkill}`);
  if (rec.lastWordsHeard) pool.push('heard');
  pool.push('plain', 'plain');
  return game.t(`health.epitaph.${rng.pick(pool)}`, vars);
}

// ------------------------------------------------------------------ «Павшие»
function stationInfo(game) {
  const st = safe(() => game.api.journey.getStation(), null) || {};
  const name = st.nameKey && game.i18n.has(st.nameKey) ? game.t(st.nameKey) : st.name || game.t('health.fallen.stationN', { n: (st.index ?? 0) + 1 });
  return { index: st.index ?? 0, name };
}

/** Записать павшего (API recordFallen). opts: {kind: 'died'|'left', cause, lastWords, lastWordsHeard}. */
export function recordFallen(H, pawn, opts = {}) {
  const game = H.game;
  if (!pawn) return null;
  const S = H.state;
  let rec = S.fallen.find((r) => r.pawnId && r.pawnId === pawn.id && pawn.id);
  const fresh = !rec;
  if (!rec) rec = { id: S.nextFallenId++ };
  const friend = bestFriend(game, pawn);
  Object.assign(rec, {
    kind: opts.kind === 'left' ? 'left' : 'died',
    pawnId: pawn.id || 0,
    name: pawn.name || '???',
    gender: pawn.gender || 'male',
    age: Number.isFinite(pawn.age) ? pawn.age : 30,
    color: pawn.color || '#ffffff',
    hairColor: pawn.hairColor || '#e8e2d0',
    mage: !!pawn.mage,
    wasLeader: !!(pawn.isLeader || pawn.wasLeader || opts.wasLeader),
    cause: opts.kind === 'left' ? 'left' : opts.cause || rec.cause || 'unknown',
    day: opts.day ?? game.time.day,
    tick: game.time.tick,
    station: opts.station || stationInfo(game),
    story: opts.story || rec.story || bioLine(game, pawn, game.rng.fork(`bio:${pawn.id}:${pawn.name}`)),
    lastWordsHeard: !!(opts.lastWordsHeard ?? rec.lastWordsHeard),
    lastWords: opts.lastWords ?? rec.lastWords ?? null,
    rite: rec.rite || 'none',
    plaqueId: rec.plaqueId || 0,
    keepsakeDefId: rec.keepsakeDefId || null,
    corpseId: rec.corpseId || 0,
    bestSkill: bestSkillOf(pawn),
    traits: (pawn.traits || []).map((t) => (typeof t === 'string' ? t : t?.id)).filter(Boolean).slice(0, 6),
    friendName: friend ? friend.name : rec.friendName || null,
    relations: snapshotRelations(pawn),
    look: pawn.look && typeof pawn.look === 'object' ? JSON.parse(JSON.stringify(pawn.look)) : {},
    faction: pawn.faction || FACTION.COLONY,
  });
  if (fresh || opts.kind !== rec.kind || !rec.epitaph) rec.epitaph = makeEpitaph(game, rec);
  if (fresh) S.fallen.push(rec);
  game.events.emit('health:fallenRecorded', { record: rec });
  return rec;
}

function snapshotRelations(pawn) {
  const out = {};
  for (const [id, r] of Object.entries(pawn.relations || {})) if (r && typeof r === 'object') out[id] = { kind: r.kind || '', opinion: Number.isFinite(r.opinion) ? r.opinion : 0 };
  return out;
}

/** Запись (и, по желанию, тело) без живой пешки — для сценариев. opts: {corpse, x, y, rot, day}. */
export function createFallen(H, spec = {}, opts = {}) {
  const game = H.game;
  const fake = {
    id: 0, name: spec.name || game.t('health.fallen.unknownName'), gender: spec.gender || 'male', age: spec.age ?? 40, color: spec.color || '#c9b8ff',
    hairColor: spec.hairColor || (spec.mage ? '#ffffff' : '#c9c3b8'), mage: !!spec.mage, isLeader: !!(spec.wasLeader || spec.isLeader), bio: spec.bio || null,
    traits: spec.traits || [], skills: spec.skills || {}, relations: spec.relations || {}, look: spec.look || {}, faction: FACTION.COLONY,
  };
  const rec = recordFallen(H, fake, { kind: spec.kind || 'died', cause: spec.cause || 'unknown', day: opts.day, story: spec.story, wasLeader: fake.isLeader });
  rec.pawnId = 0;
  if (spec.epitaph) rec.epitaph = spec.epitaph;
  let corpse = null;
  if (opts.corpse && game.map) {
    const x = Number.isFinite(opts.x) ? opts.x : Math.floor(game.map.w / 2);
    const y = Number.isFinite(opts.y) ? opts.y : Math.floor(game.map.h / 2);
    corpse = game.entities.spawn('corpse', {
      x: Math.floor(x), y: Math.floor(y), pawnId: 0, name: rec.name, color: rec.color, faction: FACTION.COLONY, wasLeader: rec.wasLeader,
      diedTick: game.time.tick - (opts.agoTicks ?? 0), cause: rec.cause, rot: Number.isFinite(opts.rot) ? opts.rot : 0,
      fallenId: rec.id, gender: rec.gender, age: rec.age, hairColor: rec.hairColor, mage: rec.mage, look: rec.look,
    });
    rec.corpseId = corpse.id;
  }
  Object.defineProperty(rec, 'corpse', { value: corpse, enumerable: false, configurable: true, writable: true });
  return rec;
}

export function getFallenById(H, id) {
  return H.state.fallen.find((r) => r.id === id) || null;
}

// ------------------------------------------------------------------ память
export function getMemory(H) {
  return H.game.colony.memory ?? 0;
}

export function addMemory(H, delta, reason = '') {
  const game = H.game;
  const prev = game.colony.memory ?? 0;
  const value = clamp100(prev + (Number.isFinite(delta) ? delta : 0));
  game.colony.memory = value;
  if (value !== prev) {
    game.events.emit(EVENTS.HEALTH_MEMORY_CHANGED, { value, delta: value - prev, reason });
    const log = (H.state.memoryLog ||= []);
    log.push({ day: game.time.day, delta: Math.round((value - prev) * 10) / 10, reason });
    if (log.length > 40) log.shift();
  }
  return value;
}

// ------------------------------------------------------------------ мысли (через mind)
export const THOUGHTS = {
  lover_died: { mood: -20, days: 25 },
  family_died: { mood: -15, days: 18 },
  friend_died: { mood: -10, days: 12 },
  rival_died: { mood: -2, days: 3 },
  colonist_died: { mood: -4, days: 5 },
  leader_died: { mood: -8, days: 10 },
  last_words_heard: { mood: -4, days: 6 },
  nobody_heard: { mood: -8, days: 6 },
  said_goodbye: { mood: 4, days: 5 },
  buried_properly: { mood: 2, days: 4 },
  not_buried: { mood: -6, days: 1 },
  saw_corpse: { mood: -4, days: 1 },
  saw_corpse_enemy: { mood: -1, days: 0.5 },
  smelled_corpse: { mood: -5, days: 0.5 },
  cremated_horror: { mood: -4, days: 4 },
  he_carries_us: { mood: 3, days: 4 },
  eulogy_moved: { mood: 3, days: 4 },
  in_pain: { mood: -4, days: 0.06 },
  lost_limb: { mood: -8, days: 15 },
  keepsake_comfort: { mood: 2, days: 3 },
};

export function thought(game, pawn, id, extra = {}) {
  const t = THOUGHTS[id] || {};
  try {
    game.api.mind.addThought(pawn, id, { mood: extra.mood ?? t.mood, days: extra.days ?? t.days, ...extra });
  } catch (err) {
    game.error(err, `health.thought:${id}`);
  }
}

/** Горе на всех поселенцев по близости с погибшим. */
export function applyGrief(H, dead, opts = {}) {
  const game = H.game;
  const heard = !!opts.heard;
  const nobody = !!opts.nobodyHeard;
  for (const o of game.colonists()) {
    if (o === dead) continue;
    const rel = relationOf(o, dead.id) || relationOf(dead, o.id);
    const close = closeness(rel);
    const op = Math.max(0, Math.min(1, (rel?.opinion ?? 0) / 100));
    const scale = 0.6 + 0.4 * op;
    if (close === 'lover' || close === 'family' || close === 'friend') {
      const id = close === 'lover' ? 'lover_died' : close === 'family' ? 'family_died' : 'friend_died';
      const base = THOUGHTS[id];
      thought(game, o, id, { mood: Math.round(base.mood * scale * (heard ? 0.5 : 1)), otherPawnId: dead.id });
      if (heard) thought(game, o, 'last_words_heard', { otherPawnId: dead.id });
      if (nobody) thought(game, o, 'nobody_heard', { otherPawnId: dead.id });
      if (close === 'lover' && ['spouse', 'wife', 'husband'].includes(rel.kind)) safe(() => game.api.mind.addTrait(o, 'widowed', {}));
    } else if (close === 'rival') thought(game, o, 'rival_died', { otherPawnId: dead.id });
    thought(game, o, 'colonist_died', { otherPawnId: dead.id });
    if (opts.wasLeader) thought(game, o, 'leader_died', { otherPawnId: dead.id });
  }
}

// ------------------------------------------------------------------ последнее дыхание
export function startDying(H, pawn, cause) {
  const game = H.game;
  if (pawn.dying || pawn.dead) return;
  const until = game.time.tick + game.rng.int(BAL.dyingMin, BAL.dyingMax);
  pawn.dying = { untilTick: until, cause, startTick: game.time.tick, heard: false };
  pawn.pose = 'dying';
  pawn.poseUntil = 0;
  if (!pawn.downed) {
    pawn.downed = true;
    pawn.downedReason = 'dying';
    if (pawn.job) game.jobs.endJob(pawn, 'cancelled');
    stopMoving(pawn);
    if (pawn.carryPawnId) H.hooks.dropCarry?.(pawn, { reason: 'downed' });
    game.events.emit('health:downed', { pawn, reason: 'dying' });
  }
  game.events.emit(EVENTS.HEALTH_LAST_BREATH, { pawn, untilTick: until });
  if (game.speed > 1 || game.paused === false) {
    if (game.speed > 1) game.setSpeed(1);
  }
  const text = pawn.isLeader ? game.t('health.log.leaderDying', { name: pawn.name }) : game.t('health.log.dying', { name: pawn.name });
  game.api.vision.report(text, { type: 'danger', x: pawn.x, y: pawn.y, pawnId: pawn.id });
  H.rt.dyingSince ||= {};
  H.rt.dyingSince[pawn.id] = typeof performance !== 'undefined' ? performance.now() : 0;
}

/** Выслушать последние слова (лидер рядом). @returns {string|null} */
export function hearLastWords(H, listener, pawn) {
  const game = H.game;
  if (!pawn?.dying || pawn.dying.heard || pawn.dead) return null;
  const text = makeLastWords(game, pawn);
  pawn.dying.heard = true;
  pawn.dying.words = text;
  pawn.dying.untilTick = Math.min(pawn.dying.untilTick, game.time.tick + 360);
  H.rt.quote = { text, name: pawn.name, color: pawn.color, t: 0, dur: 7.5 };
  game.events.emit(EVENTS.HEALTH_LAST_WORDS, { pawn, heard: true, text, listener });
  addMemory(H, 4, 'last_words');
  game.api.ui.notify(game.t('health.log.heard', { name: pawn.name, text }), { type: 'info', pawnId: pawn.id });
  return text;
}

/** Срок последнего дыхания вышел. */
export function finishDying(H, pawn) {
  const game = H.game;
  const d = pawn.dying;
  if (!d) return;
  let heard = !!d.heard;
  let words = d.words || null;
  if (!heard && pawn.isLeader) {
    // лидера никто не «слушает» по E — услышали те, кто был рядом
    const near = game.colonists().filter((o) => o !== pawn && !o.downed && Math.hypot(o.x - pawn.x, o.y - pawn.y) <= 3);
    if (near.length) {
      heard = true;
      words = makeLastWords(game, pawn);
      H.rt.quote = { text: words, name: pawn.name, color: pawn.color, t: 0, dur: 7.5 };
      game.events.emit(EVENTS.HEALTH_LAST_WORDS, { pawn, heard: true, text: words, listener: near[0] });
      addMemory(H, 4, 'last_words');
    }
  }
  if (!heard) {
    game.api.ui.notify(game.t('health.log.nobodyHeard', { name: genitive(pawn.name, game.i18n.lang), full: pawn.name }), { type: 'bad', pawnId: pawn.id });
    game.events.emit(EVENTS.HEALTH_LAST_WORDS, { pawn, heard: false, text: null });
    addMemory(H, -2, 'missed_last_words');
  }
  H.hooks.kill(pawn, d.cause || 'wounds', { fromDying: true, heard, nobodyHeard: !heard, lastWords: words });
}

/** Стабилизировать умирающего (медик). */
export function stabilize(H, pawn) {
  const game = H.game;
  if (!pawn?.dying) return false;
  const cause = pawn.dying.cause;
  pawn.dying = null;
  if (pawn.pose === 'dying') pawn.pose = 'idle';
  const h = ensureHealth(pawn);
  h.bloodLoss = Math.min(h.bloodLoss || 0, 0.8);
  for (const cd of h.conds) {
    if (cd.sev >= 1 && ['disease', 'chronic'].includes(game.defs.conditions.get(cd.id)?.kind)) {
      cd.sev = 0.88;
      cd.imm = Math.min(1, (cd.imm ?? 0) + 0.2);
    }
  }
  h.v = (h.v | 0) + 1;
  computeCache(game, pawn, true);
  game.events.emit('health:stabilized', { pawn, cause });
  game.api.ui.notify(game.t('health.log.stabilized', { name: pawn.name }), { type: 'good', pawnId: pawn.id });
  return true;
}

// ------------------------------------------------------------------ наследник
export function chooseHeir(H, exclude) {
  const game = H.game;
  const all = game.colonists().filter((p) => p !== exclude && !p.dead && !p.dying);
  if (!all.length) {
    const any = game.colonists().filter((p) => p !== exclude && !p.dead);
    return any[0] || null;
  }
  const designated = all.find((p) => p.id === game.colony.heirId);
  if (designated) return designated;
  let best = null;
  let bestScore = -Infinity;
  for (const p of all) {
    let sum = 0;
    let n = 0;
    for (const o of all) {
      if (o === p) continue;
      const r = relationOf(o, p.id);
      if (r) {
        sum += r.opinion;
        n++;
      }
    }
    const avg = n ? sum / n : 0;
    const social = safe(() => game.api.mind.skillLevel(p, 'social'), 0) || 0;
    let s = avg + social * 5;
    if (p.downed) s -= 200;
    if (s > bestScore || (s === bestScore && best && p.id < best.id)) {
      best = p;
      bestScore = s;
    }
  }
  return best;
}

export function setHeir(H, pawn) {
  const game = H.game;
  const prev = game.colony.heirId || 0;
  game.colony.heirId = pawn && !pawn.dead && pawn.faction === FACTION.COLONY ? pawn.id : 0;
  if (game.colony.heirId !== prev) {
    game.events.emit('health:heirChanged', { pawn: pawn || null });
    if (pawn) game.api.ui.notify(game.t('health.log.heirSet', { name: pawn.name }), { type: 'info', pawnId: pawn.id });
  }
  return game.colony.heirId;
}

export function getHeir(H) {
  const p = H.game.entities.get(H.game.colony.heirId);
  return p && !p.dead ? p : null;
}

// ------------------------------------------------------------------ посох
const STAFF = 'conductor_staff';

function takeStaff(pawn) {
  let found = false;
  const eq = pawn.equipment || {};
  for (const k of Object.keys(eq)) {
    const v = eq[k];
    if (v === STAFF || v?.defId === STAFF || v?.id === STAFF) {
      delete eq[k];
      found = true;
    }
  }
  const inv = pawn.inventory?.items;
  if (Array.isArray(inv)) {
    for (let i = inv.length - 1; i >= 0; i--) {
      const it = inv[i];
      if (it === STAFF || it?.defId === STAFF) {
        inv.splice(i, 1);
        found = true;
      }
    }
  }
  if (pawn.carry?.defId === STAFF) {
    pawn.carry = null;
    found = true;
  }
  return found;
}

/** На смерти лидера: посох падает у тела (никогда не уничтожается), наследнику — цель «Забери посох». */
export function dropStaff(H, dead, corpse, heir) {
  const game = H.game;
  const had = takeStaff(dead);
  if (!game.defs.items.has(STAFF)) return null;
  if (!had && !game.api.combat.hasStaff(dead)) return null;
  if (!had && !(dead.mage || dead.isLeader)) return null;
  const x = corpse ? corpse.x : Math.floor(dead.x);
  const y = corpse ? corpse.y : Math.floor(dead.y);
  const stacks = game.items.spawn(STAFF, 1, x, y);
  const it = stacks[0] || null;
  H.state.staff = { x: it?.x ?? x, y: it?.y ?? y, itemId: it?.id || 0, heirId: heir?.id || 0, tick: game.time.tick };
  if (heir) game.api.ui.setObjective('take_staff', game.t('health.objective.take_staff'), { x: H.state.staff.x, y: H.state.staff.y, pawnId: heir.id });
  return it;
}

export function staffPicked(H) {
  if (!H.state.staff) return;
  H.state.staff = null;
  H.game.api.ui.clearObjective('take_staff');
  H.game.api.ui.notify(H.game.t('health.log.staffTaken'), { type: 'good' });
}

// ------------------------------------------------------------------ сцена смерти
export function deathScene(H, pawn, corpse, cause, extra = {}) {
  const game = H.game;
  const age = Number.isFinite(pawn.age) ? pawn.age : 30;
  const lang = game.i18n.lang;
  const years = `${age} ${game.i18n.plural(age, lang === 'ru' ? ['год', 'года', 'лет'] : ['year', 'years'])}`;
  const line = extra.record?.story || bioLine(game, pawn, game.rng.fork(`bio:${pawn.id}:${pawn.name}`));
  const causeText = causeLabel(game, cause);
  game.events.emit('health:deathScene', { pawn, years: age, lastWords: extra.lastWords || null, corpse, record: extra.record || null });
  if (game.isHeadless) return;
  H.rt.scene = { name: pawn.name, color: pawn.color, sub: `${years} · ${causeText}`, line, heir: extra.heir ? game.t('health.scene.heir', { name: extra.heir.name }) : null, t: 0, dur: extra.heir ? 8 : 6.5 };
  if (typeof game.slowMo === 'function') game.slowMo(0.3, 1500);
  const sting = game.defs.sfx.has('death_sting') ? 'death_sting' : 'health_death';
  safe(() => game.api.av.play(sting, { vol: 0.9 }));
}

export function causeLabel(game, cause) {
  const c = String(cause || 'unknown');
  const k1 = `health.cause.${c}`;
  if (game.i18n.has(k1)) return game.t(k1);
  if (c.startsWith('wounds')) return game.t('health.cause.wounds');
  return game.t('health.cause.unknown');
}

export { TICKS_PER_HOUR, TICKS_PER_DAY };
