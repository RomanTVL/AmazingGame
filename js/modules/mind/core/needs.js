// Потребности (вместо заглушки ядра): еда, сон, отдых, комфорт, красота, общение, свежий воздух, тепло.
// Узлы ИИ eat/sleep/work (override), задача «поесть за столом» mind_eat, пустой стул, тост за ужином.
import { EVENTS } from '../../../core/events.js';
import { resKey } from '../../../sim/jobs.js';
import { makeEatJob, makeSleepJob } from '../../../sim/needs.js';
import { H, DAY, NEEDS, MOOD } from '../constants.js';
import { clamp01, num, isRoofed, isAiColonist, firstName, safeCall } from './util.js';
import { traitEffects } from './traits.js';
import { ensurePawn } from './bio.js';
import { computeSitu, updateMood, purgeThoughts } from './mood.js';
import { furniture, temperatureAt, warmthTarget, beautyAt, comfortTarget, corpseNear, distToBuilding } from './env.js';
import { driftOpinions, isLovers, kindOf } from './relations.js';

const approach = (v, target, ratePerHour, ticks) => v + (target - v) * (1 - Math.exp((-ratePerHour * ticks) / H));

/** Обновить потребности и окружение одной пешки (каждые 30 тиков; env — каждые 120). */
function slowNeeds(M, p, ticks, env) {
  const game = M.game;
  const n = p.needs;
  const eff = traitEffects(M, p);
  const awake = !p.asleep;
  if (awake) {
    n.joy = clamp01(num(n.joy, 0.7) - (0.9 / DAY) * eff.joyDecay * ticks);
    n.social = clamp01(num(n.social, 0.7) - (0.8 / DAY) * ticks);
  }
  const roofed = isRoofed(game, p.x, p.y);
  if (roofed) n.outdoors = clamp01(num(n.outdoors, 0.7) - (NEEDS.outdoorsPerDayInside / DAY) * ticks);
  else n.outdoors = clamp01(num(n.outdoors, 0.7) + (NEEDS.outdoorsPerHourOutside / H) * ticks);
  if (env) {
    const temp = temperatureAt(M, p.x, p.y);
    p._temp = Math.round(temp * 10) / 10;
    p._beautyT = beautyAt(M, p.x, p.y);
    p._corpseNear = corpseNear(M, p.x, p.y);
  }
  n.warmth = clamp01(approach(num(n.warmth, 1), warmthTarget(num(p._temp, 15)), NEEDS.envRatePerHour, ticks));
  n.beauty = clamp01(approach(num(n.beauty, 0.5), num(p._beautyT, 0.5), 1.2, ticks));
  const ct = comfortTarget(M, p);
  if (ct !== null) n.comfort = clamp01(approach(num(n.comfort, 0.5), Math.max(ct, num(n.comfort, 0.5) * 0.98), 0.8, ticks));
  else n.comfort = clamp01(num(n.comfort, 0.5) - (0.35 / DAY) * ticks);
}

export function registerNeeds(M) {
  const game = M.game;
  game.systems.setEnabled('needs', false);

  game.systems.add({
    id: 'mind:needs',
    order: 20,
    update(g, dt) {
      if (!g.map) return;
      const ticks = dt * 60;
      const now = g.time.tick;
      const hour = now % H === 0;
      M.R._travelling = !!safeCall(g, 'travel', () => g.api.journey.isTravelling?.() || g.api.journey.getTrainState?.()?.moving, false);
      for (const p of g.entities.ofKind('pawn')) {
        if (p.dead || p.faction !== 'colony' || p.animal || p.prisoner) continue;
        if (p.mindv !== 1) ensurePawn(M, p);
        const n = p.needs;
        const eff = traitEffects(M, p);
        n.food = clamp01(num(n.food, 1) - (NEEDS.foodPerDay / DAY) * eff.foodDecay * ticks);
        if (!p.asleep) n.rest = clamp01(num(n.rest, 1) - (NEEDS.restPerHourAwake / H) * eff.restDecay * ticks);
        const ph = (now + p.id * 7) % 30;
        if (ph === 0) {
          slowNeeds(M, p, 30, (now + p.id * 7) % 120 === 0);
          if ((now + p.id * 7) % 60 === 0) computeSitu(M, p);
          updateMood(M, p, 30);
        }
        if (hour) {
          if (n.food <= 0) safeCall(g, 'starve', () => g.api.health.applyDamage(p, NEEDS.starveDamagePerHour, { type: 'starvation' }));
          purgeThoughts(M, p);
          driftOpinions(M, p);
        }
      }
    },
  }, 'mind');

  // ---------------- задача: поесть (за столом, если есть) ----------------
  game.jobs.registerJobType({
    id: 'mind_eat',
    workType: null,
    labelKey: 'job.eat',
    priority: 90,
    reserve(g, pawn, job) {
      const keys = [resKey.entity(job.targetId)];
      if (job.data.sx !== undefined) keys.push(resKey.cell(job.data.sx, job.data.sy));
      return keys;
    },
    makeToils(g, pawn, job) {
      const t = [
        { type: 'goto', targetId: job.targetId, adjacent: true },
        { type: 'pickup', targetId: job.targetId, count: job.data.count },
      ];
      if (job.data.sx !== undefined) t.push({ type: 'goto', x: job.data.sx, y: job.data.sy });
      t.push({
        type: 'work',
        ticks: job.data.binge ? 90 : 120,
        fx: 'eat',
        x: job.data.sx ?? Math.floor(pawn.x),
        y: job.data.sy ?? Math.floor(pawn.y),
        onTick(g2, p) {
          if (job.data.tableId) {
            p.pose = 'sit';
            p.poseUntil = g2.time.tick + 30;
            const tb = g2.entities.get(job.data.tableId);
            if (tb) p.faceId = tb.id;
          }
        },
        onDone: (g2, p) => eatDone(M, p, job),
      });
      return t;
    },
    onEnd(g, pawn) {
      if (pawn.pose === 'sit') pawn.pose = 'idle';
      pawn.faceId = 0;
    },
  }, 'mind');

  // ---------------- узлы ИИ ----------------
  game.ai.registerThinkNode({
    id: 'eat',
    priority: 90,
    interrupts: true,
    override: true,
    factions: ['colony'],
    evaluate(g, pawn, ctx) {
      if (pawn.mindBreak || pawn.animal) return null;
      const t = pawn.job?.type;
      if (t === 'eat' || t === 'mind_eat') return null;
      const food = pawn.needs.food ?? 1;
      if (ctx.interrupt ? food > NEEDS.starvingAt : food > NEEDS.hungryAt) return null;
      return makeMindEat(M, pawn);
    },
  }, 'mind');

  game.ai.registerThinkNode({
    id: 'sleep',
    priority: 80,
    interrupts: false,
    override: true,
    factions: ['colony'],
    evaluate(g, pawn) {
      if (pawn.mindBreak || pawn.animal) return null;
      const rest = pawn.needs.rest ?? 1;
      const sch = pawn.schedule?.[g.time.hourInt];
      const sleepTime = sch ? sch === 'sleep' : g.time.isSleepTime();
      if (!(rest < NEEDS.tiredAt || (sleepTime && rest < 0.92))) return null;
      return makeSleepJob(g, pawn);
    },
  }, 'mind');

  game.ai.registerThinkNode({
    id: 'work',
    priority: 50,
    override: true,
    factions: ['colony'],
    evaluate(g, pawn) {
      if (pawn.animal) return null;
      const sch = pawn.schedule?.[g.time.hourInt];
      if (sch === 'joy') return null;
      if (sch === 'sleep' && (pawn.needs.rest ?? 1) < 0.9) return null;
      const job = g.jobs.findWork(pawn);
      if (job && refusesJob(M, pawn, job)) return null;
      return job;
    },
  }, 'mind');

  // пустой стул павшего
  game.events.on(EVENTS.PAWN_DIED, ({ pawn }) => {
    if (!pawn || pawn.faction !== 'colony') return;
    const chair = pawn.lastChairId ? game.entities.get(pawn.lastChairId) : null;
    if (chair) chair.emptyFor = { pawnId: pawn.id, name: pawn.name, untilTick: game.time.tick + 3 * DAY };
  }, 'mind');
}

/** «Боится высоты»: задачи на крыше/турели. */
export function refusesJob(M, pawn, job) {
  const words = traitEffects(M, pawn).refuseJobs;
  if (!words.length || !job) return false;
  const t = M.game.entities.get(job.targetId);
  const hay = `${job.type} ${job.data?.kind || ''} ${t?.defId || ''} ${job.data?.roof ? 'roof' : ''}`.toLowerCase();
  return words.some((w) => hay.includes(w));
}

/** Еда: предпочитаем приготовленное; место за столом (стул), иначе — где стоит; нет еды — собирательство ядра. */
export function makeMindEat(M, pawn, opts = {}) {
  const game = M.game;
  const ok = (it, def) => (def.nutrition ?? 0) > 0 && def.category === 'food';
  let food = game.items.findNearest(pawn, (it, def) => ok(it, def) && def.foodKind !== 'raw', { maxDist: 70 });
  if (!food) food = game.items.findNearest(pawn, ok);
  if (!food) return opts.binge ? null : makeEatJob(game, pawn);
  const def = game.defs.items.get(food.defId);
  const want = opts.binge ? 2 + (pawn.id % 2) : Math.ceil((1 - num(pawn.needs.food, 0)) / def.nutrition);
  const count = Math.max(1, Math.min(food.count, want));
  const data = { count, binge: !!opts.binge };
  const seat = opts.binge ? null : findSeat(M, pawn, food);
  if (seat) Object.assign(data, seat);
  return game.jobs.createJob('mind_eat', pawn, { targetId: food.id, x: food.x, y: food.y, data });
}

/** Место за столом: стул рядом со столом (не «пустой стул» павшего, если есть другой), иначе клетка у стола. */
function findSeat(M, pawn, food) {
  const game = M.game;
  const f = furniture(M);
  if (!f.tables.length) return null;
  const now = game.time.tick;
  let best = null;
  let bd = Infinity;
  for (const tb of f.tables) {
    const d = Math.hypot(tb.x - food.x, tb.y - food.y);
    if (d > 30) continue;
    if (!game.pathfinder.canReach(food.x, food.y, tb.x, tb.y, true, tb.w || 1, tb.h || 1)) continue;
    for (const s of f.seats) {
      if (distToBuilding(s.x + 0.5, s.y + 0.5, tb) > 1.01) continue;
      if (game.jobs.isReserved(resKey.cell(s.x, s.y), pawn)) continue;
      const empty = s.emptyFor && s.emptyFor.untilTick > now && s.emptyFor.pawnId !== pawn.id;
      const score = d + (empty ? 1000 : 0) + (pawn.lastChairId === s.id ? -3 : 0);
      if (score < bd) {
        bd = score;
        best = { tableId: tb.id, seatId: s.id, sx: s.x, sy: s.y };
      }
    }
    if (!best || bd >= 1000) {
      // нет свободного стула — встать у стола
      for (let dy = -1; dy <= (tb.h || 1); dy++)
        for (let dx = -1; dx <= (tb.w || 1); dx++) {
          const x = tb.x + dx;
          const y = tb.y + dy;
          if (!game.map.isPassable(x, y) || game.map.buildingAt(x, y)?.defId === tb.defId) continue;
          if (game.jobs.isReserved(resKey.cell(x, y), pawn)) continue;
          const score = d + 5;
          if (score < bd) {
            bd = score;
            best = { tableId: tb.id, seatId: 0, sx: x, sy: y };
          }
        }
    }
  }
  return best;
}

function eatDone(M, p, job) {
  const game = M.game;
  const c = p.carry;
  if (!c) return 'failed';
  const def = game.defs.items.get(c.defId);
  const nut = (def?.nutrition ?? 0) * c.count;
  p.needs.food = clamp01(p.needs.food + nut);
  p.carry = null;
  game.events.emit(EVENTS.PAWN_ATE, { pawn: p, item: null, defId: c.defId, nutrition: nut });
  const api = M.api;
  if (def?.thought) api.addThought(p, def.thought);
  else api.addThought(p, def?.foodKind === 'raw' ? 'ate_raw' : def?.foodKind === 'meal' ? 'ate_meal' : 'ate_ration');
  if (job.data.binge) return undefined;
  const now = game.time.tick;
  if (job.data.tableId) {
    api.addThought(p, 'ate_at_table');
    const seat = job.data.seatId ? game.entities.get(job.data.seatId) : null;
    if (seat) {
      const use = (p.chairUse ||= {});
      use[seat.id] = (use[seat.id] || 0) + 1;
      let bestId = 0;
      let bn = 0;
      for (const [id, n] of Object.entries(use)) if (n > bn) {
        bn = n;
        bestId = Number(id);
      }
      p.lastChairId = bestId;
      const e = seat.emptyFor;
      if (e && e.untilTick > now && e.pawnId !== p.id) {
        for (const o of M.colonists()) {
          const r = o.relations?.[e.pawnId];
          if (o !== p && r && (r.kind || num(r.opinion, 0) > 25)) api.addThought(o, 'sat_in_his_chair', { otherPawnId: e.pawnId });
        }
      }
    }
    recordMeal(M, p, job.data.tableId);
  } else if (furniture(M).tables.length) api.addThought(p, 'ate_without_table');
  return undefined;
}

/** Тост: ≥ 3 человек поели за одним столом в течение часа. */
function recordMeal(M, p, tableId) {
  const game = M.game;
  const now = game.time.tick;
  let list = M.R.meals.get(tableId);
  if (!list) M.R.meals.set(tableId, (list = []));
  for (let i = list.length - 1; i >= 0; i--) if (now - list[i].tick > H || list[i].pawnId === p.id) list.splice(i, 1);
  list.push({ pawnId: p.id, tick: now });
  const S = M.S();
  S.toastAt ||= {};
  if (list.length < 3 || now - num(S.toastAt[tableId], -1e9) < 6 * H) return;
  S.toastAt[tableId] = now;
  const pawns = list.map((m) => game.entities.get(m.pawnId)).filter((x) => x && !x.dead);
  list.length = 0;
  if (pawns.length < 3) return;
  for (const o of pawns) {
    M.api.addThought(o, 'toast_dinner');
    o.pose = 'toast';
    o.poseUntil = now + 240;
  }
  const a = pawns[0];
  const b = pawns[1];
  const audible = !!safeCall(game, 'hear', () => game.api.vision.canLeaderHear(a.x, a.y), false);
  game.events.emit('mind:social', { a, b, kind: 'toast', glyphs: ['star'], audible, ticks: 240, pawns });
  M.api.startTalkVisual?.(a, b, 'toast', ['star'], audible, 240);
  if (audible) M.api.say(a, M.line('toast', a, b));
  try {
    game.api.av.play('mind:chime', { x: a.x, y: a.y });
    game.api.ui.notify(game.t('mind.social.toast', { names: pawns.map(firstName).join(', ') }), { type: 'good', x: a.x, y: a.y });
  } catch (err) {
    game.error(err, 'mind.toast');
  }
}

export { isAiColonist, isLovers, kindOf, MOOD };
