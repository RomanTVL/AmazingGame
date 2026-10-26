// Отдых и общение: задачи mind_joy (прогулка / посидеть / у окна) и mind_talk (подойти и поговорить),
// узлы ИИ 'joy' и 'social', спонтанные беседы рядом (пузырь со значком темы; изредка ссора — красный пузырь).
import { H, DAY, SOCIAL, FREE_JOBS, NEEDS } from '../constants.js';
import { clamp01, num, firstName, isFemale, isColonistPawn, isAiColonist, carAt, isTravelling, sayLine, safeCall } from './util.js';
import { traitEffects } from './traits.js';
import { changeOpinion, opinionOf, kindOf } from './relations.js';
import { furniture } from './env.js';
import { resKey } from '../../../sim/jobs.js';

const JOY_PER_HOUR = 0.55;
const SOCIAL_PER_TALK = 0.22;
/** Задачи, из которых пешку можно «поставить» в разговор лицом к лицу. */
const STANDABLE = new Set(['wander', 'wait', 'mind_joy']);

/** Может ли пешка сейчас участвовать в разговоре (хотя бы «на ходу»). */
export function canChat(M, p) {
  return isColonistPawn(p) && !p.asleep && !p.downed && !p.mindBreak && !p.drafted && !p.puppet && !p.nameless && !p.dying;
}

/** Свободна ли пешка (её можно позвать поговорить и поставить лицом к собеседнику). */
export function isFree(M, p) {
  return canChat(M, p) && isAiColonist(p) && (!p.job || FREE_JOBS.has(p.job.type));
}

const talking = (M, p) => {
  const t = M.R.talks.get(p.id);
  return !!t && t.until > M.game.time.tick;
};

// ------------------------------------------------------------------ реплики
/** Текст реплики по виду взаимодействия (для облачка 'pawn:said'). */
export function line(M, kind, a, b, topic) {
  const game = M.game;
  const L = game.getLeader();
  const vars = { name: b ? firstName(b) : '', f: isFemale(a), leader: L ? firstName(L) : '', dead: deadFriendName(M, a) || '', wish: wishOf(M, a) };
  const key = kind === 'chat' ? `mind.say.chat.${topic || 'none'}` : `mind.say.${kind}`;
  const k = game.i18n.has(key) ? key : 'mind.say.chat.none';
  return sayLine(game, k, vars, a?.id ?? 0, (game.time.tick / 60) | 0);
}

function wishOf(M, p) {
  const w = p?.bio?.wish;
  return typeof w === 'string' && M.game.i18n.has(`mind.bio.wish.${w}`) ? M.game.t(`mind.bio.wish.${w}`) : '';
}

function deadFriendName(M, p) {
  for (const t of p?.thoughts || []) {
    if ((t.id === 'friend_died' || t.id === 'colonist_died' || t.id === 'family_died' || t.id === 'lover_died') && t.o) {
      const r = p.relations?.[t.o];
      if (r?.name) return firstName({ name: r.name });
    }
  }
  return null;
}

/** Тема беседы → значок (food, skull, heart, star, train, home, coin, fire, none). */
function pickTopic(M, a, b, rng) {
  const game = M.game;
  const cands = [['none', 2], ['home', 1], ['coin', 0.5]];
  if (num(a.needs?.food, 1) < 0.4 || num(b.needs?.food, 1) < 0.4) cands.push(['food', 3]);
  if (deadFriendName(M, a)) cands.push(['skull', 3]);
  if (opinionOf(a, b) > 20 || kindOf(a, b) === 'friend') cands.push(['heart', 2]);
  if (game.time.isNight?.()) cands.push(['star', 1.5]);
  if (isTravelling(game) || carAt(game, a.x, a.y)) cands.push(['train', 1.2]);
  if (num(a.needs?.comfort, 1) < 0.3) cands.push(['fire', 0.8]);
  return rng.weighted(cands, (c) => c[1])[0];
}

// ------------------------------------------------------------------ разговор
/**
 * Беседа a → b: выбор вида, мысли, мнения, общение, событие 'mind:social', пузыри.
 * opts.stand — поставить обоих лицом друг к другу (задача mind_talk у b, если b свободен).
 * @returns {{kind, glyph, red}}
 */
export function converse(M, a, b, opts = {}) {
  const game = M.game;
  const rng = game.rng;
  const now = game.time.tick;
  const ea = traitEffects(M, a);
  const op = opinionOf(a, b);
  const moodA = num(a.mood?.value, 0.6);
  const moodB = num(b.mood?.value, 0.6);
  const w = [
    ['chat', 1],
    ['joke', 0.3 * ea.jokeMul],
    ['deep', (0.1 + (op > 25 ? 0.25 : 0)) * ea.deepMul],
    ['comfort', moodB < 0.32 && op >= -5 ? 0.9 * ea.comfortMul : 0],
    ['argue', (0.05 + (op < -10 ? 0.15 : 0) + (moodA < 0.3 ? 0.08 : 0)) * ea.insultMul],
    ['insult', (kindOf(a, b) === 'rival' || op < -30 ? 0.12 : 0.01) * ea.insultMul],
  ];
  const kind = rng.weighted(w.filter((x) => x[1] > 0), (x) => x[1])[0];
  let glyph = 'none';
  let red = false;
  const api = M.api;
  const n = (p, d) => {
    p.needs ||= {};
    p.needs.social = clamp01(num(p.needs.social, 0.5) + d);
  };
  switch (kind) {
    case 'chat':
      glyph = pickTopic(M, a, b, rng);
      api.addThought(a, 'good_chat', { otherPawnId: b.id });
      api.addThought(b, 'good_chat', { otherPawnId: a.id });
      changeOpinion(M, a, b, rng.int(1, 3));
      changeOpinion(M, b, a, rng.int(1, 3));
      n(a, SOCIAL_PER_TALK);
      n(b, SOCIAL_PER_TALK);
      break;
    case 'joke':
      glyph = 'laugh';
      if (moodB < 0.25 && rng.chance(0.4)) {
        api.addThought(b, 'bad_joke', { otherPawnId: a.id });
        changeOpinion(M, b, a, -2);
      } else {
        api.addThought(b, 'laughed', { otherPawnId: a.id });
        api.addThought(a, 'laughed', { otherPawnId: b.id });
        changeOpinion(M, b, a, 3);
      }
      n(a, SOCIAL_PER_TALK);
      n(b, SOCIAL_PER_TALK);
      break;
    case 'deep':
      glyph = 'heart';
      api.addThought(a, 'deep_talk', { otherPawnId: b.id });
      api.addThought(b, 'deep_talk', { otherPawnId: a.id });
      changeOpinion(M, a, b, 4);
      changeOpinion(M, b, a, 4);
      n(a, SOCIAL_PER_TALK * 1.5);
      n(b, SOCIAL_PER_TALK * 1.5);
      break;
    case 'comfort':
      glyph = 'heart';
      api.addThought(b, 'comforted', { otherPawnId: a.id });
      api.addThought(a, 'comforted_someone', { otherPawnId: b.id });
      changeOpinion(M, b, a, 5);
      changeOpinion(M, a, b, 2);
      n(a, SOCIAL_PER_TALK);
      n(b, SOCIAL_PER_TALK * 1.5);
      break;
    case 'argue':
      glyph = 'anger';
      red = true;
      api.addThought(a, 'argued', { otherPawnId: b.id });
      api.addThought(b, 'argued', { otherPawnId: a.id });
      changeOpinion(M, a, b, -5);
      changeOpinion(M, b, a, -5);
      n(a, SOCIAL_PER_TALK * 0.5);
      n(b, SOCIAL_PER_TALK * 0.5);
      break;
    default: // insult
      glyph = 'anger';
      red = true;
      api.addThought(b, 'insulted', { otherPawnId: a.id });
      changeOpinion(M, b, a, -8);
      n(a, SOCIAL_PER_TALK * 0.5);
      break;
  }
  api.learn(a, 'social', 6);
  const ticks = SOCIAL.ticks[kind] || 300;
  startTalkVisual(M, a, b, glyph, red, ticks);
  const audible = !!safeCall(game, 'hear', () => game.api.vision.canLeaderHear(a.x, a.y), false);
  game.events.emit('mind:social', { a, b, kind, glyphs: [glyph], audible, ticks });
  if (audible) api.say(a, line(M, kind, a, b, glyph === 'laugh' || glyph === 'anger' ? null : glyph));
  if (opts.stand) {
    if (isAiColonist(b) && (!b.job || STANDABLE.has(b.job.type))) {
      const job = game.jobs.createJob('mind_talk', b, { targetId: a.id, x: Math.floor(a.x), y: Math.floor(a.y), data: { listener: true, partnerId: a.id, ticks } });
      game.jobs.startJob(b, job);
    }
  }
  M.S().talks = (M.S().talks || 0) + 1;
  if (red) M.S().fights = (M.S().fights || 0) + 1;
  void now;
  return { kind, glyph, red, ticks };
}

/** Запомнить пузыри беседы (косметика, не сохраняется). */
export function startTalkVisual(M, a, b, glyph, red, ticks) {
  const now = M.game.time.tick;
  M.R.talks.set(a.id, { glyph, red, partnerId: b.id, start: now, until: now + ticks });
  M.R.talks.set(b.id, { glyph, red, partnerId: a.id, start: now + 50, until: now + ticks });
  for (const p of [a, b]) {
    if (p.moving) continue;
    p.pose = 'talk';
    p.poseUntil = now + ticks;
  }
  a.faceId = b.id;
  b.faceId = a.id;
}

function face(p, o) {
  if (!o || p.moving) return;
  const dx = o.x - p.x;
  const dy = o.y - p.y;
  if (dx * dx + dy * dy > 1e-4) p.dir = Math.atan2(dy, dx);
}

// ------------------------------------------------------------------ места отдыха
function randomSpot(game, pawn, r, rng) {
  const home = game.train?.center?.();
  let cx = pawn.x;
  let cy = pawn.y;
  if (home && Math.hypot(home.x - pawn.x, home.y - pawn.y) > 16) {
    cx = home.x;
    cy = home.y;
  }
  return game.map.randomPassableNear(rng, cx, cy, r, 14, (x, y) => !game.map.buildingAt(x, y) && game.pathfinder.canReach(pawn.x, pawn.y, x, y));
}

/** Свободное сиденье (sittable) поблизости. */
function findSeatFor(M, pawn) {
  const game = M.game;
  let best = null;
  let bd = 30 * 30;
  for (const s of furniture(M).seats) {
    const d = (s.x - pawn.x) ** 2 + (s.y - pawn.y) ** 2;
    if (d >= bd) continue;
    if (game.jobs.isReserved(resKey.cell(s.x, s.y), pawn)) continue;
    if (!game.pathfinder.canReach(pawn.x, pawn.y, s.x, s.y)) continue;
    bd = d;
    best = s;
  }
  return best;
}

/** Клетка у окна вагона, где стоит пешка (или ближайшего вагона). */
function findWindowSpot(M, pawn, rng) {
  const game = M.game;
  const car = carAt(game, pawn.x, pawn.y);
  if (!car?.rect) return null;
  const r = car.rect;
  const list = [];
  for (const w of furniture(M).windows) {
    if (w.x < r.x || w.x >= r.x + r.w || w.y < r.y || w.y >= r.y + r.h) continue;
    for (const dy of [1, -1]) {
      const x = w.x;
      const y = w.y + dy;
      if (y <= r.y || y >= r.y + r.h - 1) continue;
      if (!game.map.isPassable(x, y) || game.map.buildingAt(x, y)) continue;
      if (game.jobs.isReserved(resKey.cell(x, y), pawn)) continue;
      list.push({ x, y, wx: w.x, wy: w.y });
    }
  }
  if (!list.length) return null;
  const s = rng.pick(list);
  return game.pathfinder.canReach(pawn.x, pawn.y, s.x, s.y) ? s : null;
}

/** Задача отдыха: посидеть / постоять у окна / прогуляться. */
export function makeJoyJob(M, pawn) {
  const game = M.game;
  const rng = game.rng;
  const eff = traitEffects(M, pawn);
  const opts = [];
  const seat = findSeatFor(M, pawn);
  if (seat) opts.push(['sit', 2 * num(eff.joyWeights.sit, 1)]);
  const win = findWindowSpot(M, pawn, rng);
  if (win) opts.push(['window', 1.5 * num(eff.joyWeights.window, 1)]);
  opts.push(['walk', 1.2 * num(eff.joyWeights.walk, 1)]);
  const kind = rng.weighted(opts, (o) => o[1])[0];
  if (kind === 'sit') return game.jobs.createJob('mind_joy', pawn, { x: seat.x, y: seat.y, data: { kind, seatId: seat.id, sx: seat.x, sy: seat.y } });
  if (kind === 'window') return game.jobs.createJob('mind_joy', pawn, { x: win.x, y: win.y, data: { kind, sx: win.x, sy: win.y, fx: win.wx, fy: win.wy } });
  const spot = randomSpot(game, pawn, 9, rng);
  if (!spot) return null;
  return game.jobs.createJob('mind_joy', pawn, { x: spot.x, y: spot.y, data: { kind: 'walk', sx: spot.x, sy: spot.y } });
}

/** Ищем собеседника: ближайший свободный поселенец (до 30 клеток), достижимый. */
function findPartner(M, pawn) {
  const game = M.game;
  let best = null;
  let bd = 30 * 30;
  for (const o of M.colonists()) {
    if (o === pawn || !canChat(M, o) || talking(M, o)) continue;
    if (o.job && !FREE_JOBS.has(o.job.type) && o.controlled !== 'player') continue;
    if (o.job?.type === 'mind_talk') continue;
    const d = (o.x - pawn.x) ** 2 + (o.y - pawn.y) ** 2;
    if (d >= bd) continue;
    if (!game.pathfinder.canReach(pawn.x, pawn.y, Math.floor(o.x), Math.floor(o.y), true)) continue;
    bd = d;
    best = o;
  }
  return best;
}

// ------------------------------------------------------------------ регистрация
export function registerSocial(M) {
  const game = M.game;

  // шаг «отдых/болтовня на месте»: поза, взгляд, прирост отдыха/общения
  game.jobs.registerToil({
    id: 'mind_relax',
    start(g, pawn, toil) {
      toil._t = 0;
    },
    tick(g, pawn, toil, job, dt) {
      const t = dt * 60;
      toil._t += t;
      const n = (pawn.needs ||= {});
      const eff = traitEffects(M, pawn);
      if (toil.joy) n.joy = clamp01(num(n.joy, 0.5) + ((toil.joy * JOY_PER_HOUR) / H) * t);
      if (toil.social) n.social = clamp01(num(n.social, 0.5) + ((toil.social * 0.6) / H) * t);
      void eff;
      if (toil.pose) {
        pawn.pose = toil.pose;
        pawn.poseUntil = g.time.tick + 30;
      }
      if (toil.partnerId) {
        const o = g.entities.get(toil.partnerId);
        if (!o || o.dead || Math.hypot(o.x - pawn.x, o.y - pawn.y) > SOCIAL.talkRange + 1.5) return 'done';
        face(pawn, o);
        pawn.faceId = o.id;
      } else if (Number.isFinite(toil.fx)) {
        face(pawn, { x: toil.fx + 0.5, y: toil.fy + 0.5 });
      }
      if (toil._t >= (toil.ticks || 300)) return 'done';
      return 'running';
    },
    end(g, pawn, toil) {
      if (toil.pose && pawn.pose === toil.pose) {
        pawn.pose = 'idle';
        pawn.poseUntil = 0;
      }
      if (toil.partnerId) pawn.faceId = 0;
    },
  });

  game.jobs.registerJobType({
    id: 'mind_joy',
    workType: null,
    labelKey: 'mind.job.joy',
    priority: 20,
    reserve(g, pawn, job) {
      return job.data.sx !== undefined ? [resKey.cell(job.data.sx, job.data.sy)] : [];
    },
    makeToils(g, pawn, job) {
      const d = job.data;
      const ticks = d.kind === 'walk' ? 200 + (pawn.id % 5) * 30 : 420 + (pawn.id % 4) * 60;
      return [
        { type: 'goto', x: d.sx, y: d.sy },
        { type: 'mind_relax', ticks, joy: 1, pose: d.kind === 'sit' ? 'sit' : d.kind === 'window' ? 'window' : null, fx: d.fx, fy: d.fy },
        {
          type: 'interact',
          fn(g2, p) {
            if (d.kind === 'walk') {
              if (g2.time.isNight?.() && !g2.map.isRoofed(Math.floor(p.x), Math.floor(p.y))) M.api.addThought(p, 'stargazed');
              else M.api.addThought(p, 'nice_walk');
            }
            return 'done';
          },
        },
      ];
    },
  }, 'mind');

  game.jobs.registerJobType({
    id: 'mind_talk',
    workType: null,
    labelKey: 'mind.job.talk',
    priority: 20,
    reserve: () => [],
    makeToils(g, pawn, job) {
      const d = job.data;
      if (d.listener) return [{ type: 'mind_relax', ticks: d.ticks || 300, social: 1, joy: 0.3, pose: 'talk', partnerId: d.partnerId }];
      return [
        { type: 'goto', targetId: d.partnerId, adjacent: true },
        {
          type: 'interact',
          fn(g2, p, j) {
            const o = g2.entities.get(d.partnerId);
            if (!o || !canChat(M, o) || Math.hypot(o.x - p.x, o.y - p.y) > SOCIAL.talkRange + 0.5) return 'failed';
            const r = converse(M, p, o, { stand: true });
            j.toils[j.i + 1].ticks = r.ticks;
            return 'done';
          },
        },
        { type: 'mind_relax', ticks: 300, social: 1, joy: 0.3, pose: 'talk', partnerId: d.partnerId },
      ];
    },
    failIf(g, pawn, job) {
      const o = g.entities.get(job.data.partnerId);
      return !o || o.dead || o.removed;
    },
  }, 'mind');

  const blocked = (p) => !!p.mindBreak || p.animal || p.prisoner || p.puppet || p.nameless || p.drafted;

  // отдых: когда скучно или по расписанию
  game.ai.registerThinkNode({
    id: 'joy',
    priority: 60,
    factions: ['colony'],
    evaluate(g, pawn) {
      if (blocked(pawn)) return null;
      const joy = num(pawn.needs?.joy, 1);
      const sch = pawn.schedule?.[g.time.hourInt];
      if (!(joy < 0.22 || (sch === 'joy' && joy < 0.95))) return null;
      return makeJoyJob(M, pawn);
    },
  }, 'mind');

  // общение: одиноко — пойти поговорить
  game.ai.registerThinkNode({
    id: 'social',
    priority: 58,
    factions: ['colony'],
    evaluate(g, pawn) {
      if (blocked(pawn)) return null;
      if (num(pawn.needs?.social, 1) >= 0.3) return null;
      const o = findPartner(M, pawn);
      if (!o) return null;
      return g.jobs.createJob('mind_talk', pawn, { targetId: o.id, x: Math.floor(o.x), y: Math.floor(o.y), data: { partnerId: o.id } });
    },
  }, 'mind');

  // безделье: вместо пустой прогулки — отдохнуть, если отдых не полон
  game.ai.registerThinkNode({
    id: 'mind:idle',
    priority: 11,
    factions: ['colony'],
    evaluate(g, pawn) {
      if (blocked(pawn)) return null;
      if (num(pawn.needs?.joy, 1) > 0.85) return null;
      return makeJoyJob(M, pawn);
    },
  }, 'mind');

  // спонтанные беседы рядом + повороты лицом к собеседнику (после шагов задач, до движения)
  game.systems.add({
    id: 'mind:social',
    order: 42,
    update(g) {
      if (!g.map) return;
      const now = g.time.tick;
      const talks = M.R.talks;
      if (talks.size) {
        for (const [id, t] of talks) {
          if (t.until <= now) {
            talks.delete(id);
            continue;
          }
          const p = g.entities.get(id);
          if (!p || p.dead) {
            talks.delete(id);
            continue;
          }
          if (!p.job || STANDABLE.has(p.job.type) || p.job.type === 'mind_talk') face(p, g.entities.get(t.partnerId));
        }
      }
      const list = M.colonists();
      if (list.length < 2) return;
      for (const a of list) {
        if ((now + a.id * 11) % SOCIAL.checkEvery !== 0) continue;
        if (!isAiColonist(a) || !canChat(M, a) || talking(M, a)) continue;
        if (a.job?.type === 'mind_talk') continue;
        const need = num(a.needs?.social, 0.6);
        if (!g.rng.chance(SOCIAL.baseChance * (1.3 - need))) continue;
        let b = null;
        let bd = SOCIAL.talkRange * SOCIAL.talkRange;
        for (const o of list) {
          if (o === a || !canChat(M, o) || talking(M, o)) continue;
          const d = (o.x - a.x) ** 2 + (o.y - a.y) ** 2;
          if (d < bd) {
            bd = d;
            b = o;
          }
        }
        if (!b) continue;
        const stand = (!a.job || STANDABLE.has(a.job.type)) && (!b.job || STANDABLE.has(b.job.type)) && isAiColonist(b);
        const r = converse(M, a, b, { stand });
        if (stand) {
          const job = g.jobs.createJob('mind_talk', a, { targetId: b.id, x: Math.floor(b.x), y: Math.floor(b.y), data: { listener: true, partnerId: b.id, ticks: r.ticks } });
          g.jobs.startJob(a, job);
        }
      }
    },
  }, 'mind');
}

export { DAY, NEEDS };
