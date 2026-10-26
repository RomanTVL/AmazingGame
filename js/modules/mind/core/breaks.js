// Срывы при низком настроении (MVP): бродит в тоске / плачет / прячется. Потом — катарсис и восстановление.
// pawn.mindBreak = {kind, tier, start, until} (JSON, сохраняется); узел ИИ 'mentalBreak' (99, interrupts).
import { H, MOOD, NEEDS } from '../constants.js';
import { num, firstName, isAiColonist, safeCall } from './util.js';
import { traitEffects } from './traits.js';

/** Виды срывов по тяжести. hours — [мин, макс]. */
export const BREAKS = {
  sad_wander: { tiers: ['minor', 'major'], hours: [2, 4], line: 'break_sad', glyph: 'cloud' },
  cry: { tiers: ['minor', 'major', 'extreme'], hours: [2, 5], line: 'break_sad', glyph: 'tear' },
  hide_in_room: { tiers: ['major', 'extreme'], hours: [3, 7], line: 'break_hide', glyph: 'hide' },
};
const TIER_MUL = { minor: 1, major: 1.3, extreme: 1.7 };
const CHECK = 60;

export function isInBreak(pawn) {
  return !!pawn?.mindBreak;
}

/** Пороги срыва с учётом черт (breakShift: + ломается раньше). */
export function thresholds(M, p) {
  const s = num(traitEffects(M, p).breakShift, 0);
  return { minor: MOOD.minor + s, major: MOOD.major + s * 0.8, extreme: MOOD.extreme + s * 0.5 };
}

function canBreak(M, p) {
  return isAiColonist(p) && !p.downed && !p.asleep && !p.drafted && !p.puppet && !p.nameless && !p.dying && !p.mindBreak;
}

/** Начать срыв (kind — необязательно). @returns {object|null} */
export function startBreak(M, p, tier = 'minor', kind = null) {
  const game = M.game;
  if (!p || p.dead || p.mindBreak) return null;
  const rng = M.rng();
  if (!kind || !BREAKS[kind]) {
    const eff = traitEffects(M, p);
    const cand = Object.entries(BREAKS).filter(([, d]) => d.tiers.includes(tier));
    kind = rng.weighted(cand, ([id]) => num(eff.breakWeights[id], 1))?.[0] || 'sad_wander';
  }
  const d = BREAKS[kind];
  const now = game.time.tick;
  const hours = rng.range(d.hours[0], d.hours[1]) * (TIER_MUL[tier] || 1);
  p.mindBreak = { kind, tier, start: now, until: Math.round(now + hours * H) };
  if (p.job) game.jobs.endJob(p, 'cancelled');
  p._thinkCooldown = 0;
  const name = firstName(p);
  const label = game.t(`mind.break.${kind}`);
  safeCall(game, 'breakNotify', () => game.api.ui.notify(game.t('mind.break.startedDesc', { name, kind: label }), { type: 'bad', x: p.x, y: p.y, pawnId: p.id }));
  M.api.say(p, M.line(d.line, p, null));
  for (const o of M.colonists()) {
    if (o === p || o.asleep) continue;
    if ((o.x - p.x) ** 2 + (o.y - p.y) ** 2 <= 36) M.api.addThought(o, 'saw_breakdown', { otherPawnId: p.id });
  }
  game.events.emit('mind:breakStarted', { pawn: p, kind, tier });
  return p.mindBreak;
}

/** Закончить срыв: катарсис, реплика, событие. */
export function endBreak(M, p) {
  const game = M.game;
  const b = p?.mindBreak;
  if (!b) return false;
  delete p.mindBreak;
  p.mindBreakCd = game.time.tick + 12 * H;
  if (p.job?.type === 'mind_break') game.jobs.endJob(p, 'done');
  if (p.pose === 'sit') p.pose = 'idle';
  M.api.addThought(p, 'catharsis');
  safeCall(game, 'breakNotify', () => game.api.ui.notify(game.t('mind.break.ended', { name: firstName(p) }), { type: 'info', x: p.x, y: p.y, pawnId: p.id }));
  if (!p.dead) M.api.say(p, M.line('break_end', p, null));
  game.events.emit('mind:breakEnded', { pawn: p, kind: b.kind });
  return true;
}

/** Есть ли враги рядом (тогда срыв не мешает бежать/защищаться). */
function danger(M, p) {
  const game = M.game;
  for (const o of game.entities.queryRadius(p.x, p.y, 10, 'pawn')) {
    if (o.dead || o.downed || o === p) continue;
    if (safeCall(game, 'hostile', () => game.api.combat.isHostile(p, o), false)) return true;
  }
  return false;
}

/** Спрятаться: клетка вагона подальше от остальных (иначе — в стороне от поезда). */
function hideSpot(M, p) {
  const game = M.game;
  const others = M.colonists().filter((o) => o !== p);
  let best = null;
  let bs = -1;
  for (const car of game.train?.cars || []) {
    const r = car.rect;
    if (!r || car.type === 'locomotive') continue;
    for (let y = r.y + 1; y < r.y + r.h - 1; y += 2)
      for (let x = r.x + 1; x < r.x + r.w - 1; x += 2) {
        if (!game.map.isPassable(x, y) || game.map.buildingAt(x, y)) continue;
        let md = 99;
        for (const o of others) md = Math.min(md, Math.hypot(o.x - x, o.y - y));
        const score = md + (car.type === 'residential' || car.type === 'storage' ? 3 : 0);
        if (score > bs && game.pathfinder.canReach(p.x, p.y, x, y)) {
          bs = score;
          best = { x, y };
        }
      }
  }
  return best || game.map.randomPassableNear(M.rng(), p.x, p.y, 10, 12, (x, y) => game.pathfinder.canReach(p.x, p.y, x, y));
}

/** Задача срыва: один «цикл» (узел выдаёт новый, пока срыв не кончится). */
function makeBreakJob(M, p) {
  const game = M.game;
  const kind = p.mindBreak.kind;
  if (kind === 'cry') {
    return game.jobs.createJob('mind_break', p, { x: Math.floor(p.x), y: Math.floor(p.y), data: { kind, ticks: 600 } });
  }
  if (kind === 'hide_in_room') {
    const s = hideSpot(M, p);
    if (!s) return game.jobs.createJob('mind_break', p, { x: Math.floor(p.x), y: Math.floor(p.y), data: { kind, ticks: 600 } });
    return game.jobs.createJob('mind_break', p, { x: s.x, y: s.y, data: { kind, sx: s.x, sy: s.y, ticks: 900 } });
  }
  const s = game.map.randomPassableNear(M.rng(), p.x, p.y, 9, 14, (x, y) => !game.map.buildingAt(x, y) && game.pathfinder.canReach(p.x, p.y, x, y));
  if (!s) return game.jobs.createJob('mind_break', p, { x: Math.floor(p.x), y: Math.floor(p.y), data: { kind, ticks: 300 } });
  return game.jobs.createJob('mind_break', p, { x: s.x, y: s.y, data: { kind, sx: s.x, sy: s.y, ticks: 200 + M.rng().int(0, 200) } });
}

export function registerBreaks(M) {
  const game = M.game;

  game.jobs.registerJobType({
    id: 'mind_break',
    workType: null,
    labelKey: 'mind.job.break',
    priority: 99,
    reserve: () => [],
    makeToils(g, pawn, job) {
      const d = job.data;
      const t = [];
      if (d.sx !== undefined) t.push({ type: 'goto', x: d.sx, y: d.sy });
      t.push({ type: 'mind_relax', ticks: d.ticks || 300, pose: d.kind === 'sad_wander' ? null : 'sit' });
      return t;
    },
    failIf(g, pawn) {
      return !pawn.mindBreak;
    },
  }, 'mind');

  game.ai.registerThinkNode({
    id: 'mentalBreak',
    priority: 99,
    interrupts: true,
    factions: ['colony'],
    evaluate(g, pawn) {
      if (!pawn.mindBreak || pawn.job?.type === 'mind_break') return null;
      if (num(pawn.needs?.food, 1) < NEEDS.starvingAt || num(pawn.needs?.rest, 1) < 0.04) return null;
      if (pawn.drafted || pawn.puppet || pawn.nameless) return null;
      if (danger(M, pawn)) return null;
      return makeBreakJob(M, pawn);
    },
  }, 'mind');

  game.systems.add({
    id: 'mind:breaks',
    order: 26,
    update(g) {
      const now = g.time.tick;
      for (const p of M.colonists()) {
        if ((now + p.id * 13) % CHECK !== 0) continue;
        if (p.mindBreak) {
          if (now >= p.mindBreak.until || p.downed || p.drafted || p.controlled === 'player') endBreak(M, p);
          continue;
        }
        if (!canBreak(M, p) || num(p.mindBreakCd, 0) > now) continue;
        const mood = num(p.mood?.value, 0.6);
        const th = thresholds(M, p);
        const tier = mood < th.extreme ? 'extreme' : mood < th.major ? 'major' : mood < th.minor ? 'minor' : null;
        if (!tier) continue;
        const chance = CHECK / (MOOD.mtbHours[tier] * H);
        if (M.rng().chance(chance)) startBreak(M, p, tier);
      }
    },
  }, 'mind');
}
