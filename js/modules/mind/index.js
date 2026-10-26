/**
 * МОДУЛЬ mind — «разум» поселенцев (MVP): потребности (еда, сон, отдых, комфорт, общение), мысли и настроение,
 * простые срывы (бродит / плачет / прячется), черты, навыки, биографии, разговоры (пузыри со значком темы),
 * авторитет проводника. Владелец: js/modules/mind/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * Системы: 'mind:needs' (20, вместо ядра 'needs'), 'mind:breaks' (26), 'mind:social' (42).
 * Узлы ИИ: eat/sleep/work (override), mentalBreak (99), joy (60), social (58), mind:idle (11).
 * Задачи: mind_eat, mind_joy, mind_talk, mind_break; шаг mind_relax.
 * СОБЫТИЯ: 'mind:thought' {pawn, id, mood}, 'mind:breakStarted' {pawn, kind, tier}, 'mind:breakEnded' {pawn, kind},
 *          'mind:skillUp' {pawn, skill, level}, 'mind:social' {a, b, kind, glyphs, audible, ticks},
 *          'mind:authorityChanged' {value, delta, reason}.
 * После MVP: романтика, свадьбы, вдохновения, слухи, скрытые черты, панели I/F7, красота/тепло/свежий воздух.
 */
import { EVENTS } from '../../core/events.js';
import { createContext } from './core/ctx.js';
import { registerDefs } from './core/defs.js';
import { registerNeeds } from './core/needs.js';
import { registerSocial, line, converse } from './core/social.js';
import { registerBreaks, isInBreak, startBreak, endBreak } from './core/breaks.js';
import { pawnOverlay } from './core/render.js';
import { touchFurniture } from './core/env.js';
import { addThought, removeThought, registerThought, getMood, thoughtList, computeSitu, updateMood } from './core/mood.js';
import { hasTrait, addTrait, revealTrait, removeTrait, traitEffects } from './core/traits.js';
import { learn, skillLevel, skillFactor, getSkill } from './core/skills.js';
import { ensurePawn, generateCandidate, getBio, lastWords } from './core/bio.js';
import { setRelation, changeOpinion, partnerOf, seedRelations, relationList } from './core/relations.js';
import { firstName, num, isColonistPawn } from './core/util.js';
import { NEED_IDS, MOOD } from './constants.js';

/** Нужды MVP, которые показываем в карточке. */
const SHEET_NEEDS = ['food', 'rest', 'joy', 'comfort', 'social'];

function clamp100(v) {
  return Math.max(0, Math.min(100, v));
}

function buildApi(M) {
  const game = M.game;
  const api = {
    addThought: (pawn, id, opts) => addThought(M, pawn, id, opts),
    removeThought: (pawn, id) => removeThought(M, pawn, id),
    registerThought: (def) => registerThought(M, def),
    getMood: (pawn) => getMood(pawn),
    learn: (pawn, skillId, xp) => learn(M, pawn, skillId, xp),
    gainXp: (pawn, skillId, xp) => learn(M, pawn, skillId, xp),
    skillLevel: (pawn, skillId) => skillLevel(game, pawn, skillId),
    getSkill: (pawn, skillId) => getSkill(M, pawn, skillId),
    skillFactor: (pawn, workTypeId) => skillFactor(M, pawn, workTypeId),
    isInBreak: (pawn) => isInBreak(pawn),
    startBreak: (pawn, tier, kind) => startBreak(M, pawn, tier, kind),
    endBreak: (pawn) => endBreak(M, pawn),
    hasTrait: (pawn, id) => hasTrait(M, pawn, id),
    addTrait: (pawn, id, opts) => addTrait(M, pawn, id, opts),
    removeTrait: (pawn, id) => removeTrait(M, pawn, id),
    revealTrait: (pawn, id) => revealTrait(M, pawn, id),
    say(pawn, text) {
      if (!pawn || typeof text !== 'string' || !text) return;
      game.events.emit(EVENTS.PAWN_SAID, { pawn, text });
    },
    scheduleAllows(pawn, activity) {
      const sch = pawn?.schedule?.[game.time.hourInt];
      if (!sch || sch === 'any') return true;
      return sch === activity;
    },
    getAuthority: () => num(game.colony.authority, 50),
    addAuthority(delta, reason = '') {
      const prev = num(game.colony.authority, 50);
      const value = clamp100(prev + (Number.isFinite(delta) ? delta : 0));
      game.colony.authority = value;
      if (value !== prev) game.events.emit(EVENTS.MIND_AUTHORITY_CHANGED, { value, delta: value - prev, reason });
      return value;
    },
    /** Простое послушание: в срыве — отказ; совсем подавлен при слабом авторитете — отказ. */
    willObey(pawn, orderId, _opts) {
      if (!pawn || pawn.isLeader || pawn.controlled === 'player') return { ok: true, reply: null };
      if (pawn.mindBreak) return { ok: false, reply: M.line('refuse_break', pawn, null) };
      const mood = getMood(pawn);
      const auth = api.getAuthority();
      if (mood < 0.15 && auth < 40 && orderId !== 'callToArms') return { ok: false, reply: M.line('refuse_mood', pawn, null) };
      return { ok: true, reply: null };
    },
    setRelation: (a, b, kind, opinion) => setRelation(M, a, b, kind, opinion),
    changeOpinion: (a, b, delta) => changeOpinion(M, a, b, delta),
    partnerOf: (p) => partnerOf(M, p),
    generateCandidate: (rng, opts) => generateCandidate(M, rng, opts || {}),
    getBio: (pawn) => getBio(M, pawn),
    /** Начать беседу a → b прямо сейчас (результат: {kind, glyph, red, ticks}). */
    converse: (a, b, opts) => (a && b && a !== b ? converse(M, a, b, opts || {}) : null),
    lastWords: (pawn) => lastWords(M, pawn),
    /** Сводка для карточки персонажа (ui). Настроение — в процентах 0..100. */
    getSheet(pawn) {
      if (!pawn) return null;
      if (pawn.mindv !== 1 && isColonistPawn(pawn)) ensurePawn(M, pawn);
      const traits = (pawn.traits || []).map((id) => ({
        id,
        label: game.t(`mind.traits.${id}.name`),
        desc: game.t(`mind.traits.${id}.desc`),
        hidden: false,
      }));
      const skills = game.defs.skills.all().map((d) => {
        const s = getSkill(M, pawn, d.id);
        return { id: d.id, label: game.t(d.nameKey), level: s.level, xp: s.xp, next: s.next, passion: s.passion, incapable: s.incapable };
      });
      const needs = SHEET_NEEDS.map((id) => ({ id, label: game.t(`mind.need.${id}`), value: num(pawn.needs?.[id], 1) }));
      const b = pawn.mindBreak;
      return {
        name: pawn.name,
        age: pawn.age,
        mood: Math.round(getMood(pawn) * 100),
        moodTarget: Math.round(num(pawn.mood?.target, getMood(pawn)) * 100),
        breakAt: Math.round(MOOD.minor * 100),
        inBreak: b ? { kind: b.kind, label: game.t(`mind.break.${b.kind}`), hoursLeft: Math.max(0, Math.round((b.until - game.time.tick) / 600)) } : null,
        needs,
        thoughts: thoughtList(M, pawn),
        traits,
        skills,
        relations: relationList(M, pawn),
        bio: getBio(M, pawn),
        authority: api.getAuthority(),
      };
    },
  };
  return api;
}

export function register(game) {
  const M = createContext(game);
  registerDefs(game);
  M.api = buildApi(M);
  M.line = (kind, a, b, topic) => line(M, kind, a, b, topic);
  M.converse = (a, b, opts) => converse(M, a, b, opts);

  // строки, которых не было в черновике
  game.i18n.add('ru', { mind: { break: { cry: 'Плачет навзрыд' } } });
  game.i18n.add('en', { mind: { break: { cry: 'Crying fit' } } });

  const { getSheet, ...rest } = M.api;
  game.provide('mind', { ...rest, getSheet }, 'mind');

  registerNeeds(M);
  registerBreaks(M);
  registerSocial(M);
  game.render.registerPawnOverlay(pawnOverlay(M), 'mind');

  // компоненты новой пешки — только недостающее (roster не перезаписываем)
  game.events.on(EVENTS.PAWN_SPAWNED, ({ pawn }) => {
    if (!pawn || pawn.animal || pawn.faction !== 'colony') return;
    ensurePawn(M, pawn);
  }, 'mind');

  game.events.on(EVENTS.ENTITY_SPAWNED, ({ entity }) => touchFurniture(M, entity), 'mind');
  game.events.on(EVENTS.ENTITY_REMOVED, ({ entity }) => touchFurniture(M, entity), 'mind');
  game.events.on(EVENTS.WORLD_RESET, () => M.reset(), 'mind');

  game.events.on(EVENTS.COLONY_STARTED, ({ seed } = {}) => {
    const S = M.S();
    if (!S.relSeeded) {
      seedRelations(M, game.rng.fork(`mind:relations:${seed ?? 0}`));
      S.relSeeded = true;
    }
    for (const p of M.colonists()) {
      computeSitu(M, p);
      updateMood(M, p, 0);
    }
  }, 'mind');

  // горе: мнение о погибшем больше не дрейфует — оставляем имя для реплик
  game.events.on(EVENTS.PAWN_DIED, ({ pawn }) => {
    if (!pawn || pawn.faction !== 'colony') return;
    for (const o of M.colonists()) {
      const r = o.relations?.[pawn.id];
      if (r) r.name ||= pawn.name;
    }
    if (pawn.mindBreak) delete pawn.mindBreak;
  }, 'mind');

  void NEED_IDS;
  void firstName;
  void traitEffects;
  return M;
}
