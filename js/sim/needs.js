// ЗАГЛУШКА потребностей: голод и отдых. Модуль mind заменит/расширит
// (настроение, расписание, развлечения, комфорт...). Он может:
//  - отключить системы: game.systems.setEnabled('needs', false)
//  - переопределить узлы ИИ 'eat'/'sleep' (game.ai.registerThinkNode({... override: true}))
//  - переиспользовать задачи 'eat'/'sleep' и шаг 'sleep'.
// Значения потребностей: pawn.needs.food, pawn.needs.rest ∈ [0, 1] (1 = сыт/бодр).
import { EVENTS } from '../core/events.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { resKey } from './jobs.js';
import { cutPlant } from './jobs.js';

export const NEEDS = {
  foodPerDay: 1.5,       // сколько «сытости» тратится за сутки
  restPerHourAwake: 1 / 17,
  restPerHourBed: 1 / 6,
  restPerHourFloor: 1 / 8,
  hungryAt: 0.3,
  starvingAt: 0.12,
  tiredAt: 0.18,
  starveDamagePerHour: 1,
};

export function registerNeeds(game) {
  // инициализация компонентов
  game.events.on(EVENTS.PAWN_SPAWNED, ({ pawn }) => {
    pawn.needs.food ??= 0.8 + game.rng.next() * 0.2;
    pawn.needs.rest ??= 0.75 + game.rng.next() * 0.25;
  });

  game.systems.add({
    id: 'needs',
    order: 20,
    update(game, dt) {
      const ticks = dt * 60;
      const foodDrain = (NEEDS.foodPerDay / TICKS_PER_DAY) * ticks;
      const hour = game.time.tick % TICKS_PER_HOUR === 0;
      for (const p of game.entities.ofKind('pawn')) {
        if (p.dead || p.faction !== 'colony') continue;
        const n = p.needs;
        n.food = clamp((n.food ?? 1) - foodDrain, 0, 1);
        if (!p.asleep) n.rest = clamp((n.rest ?? 1) - (NEEDS.restPerHourAwake / TICKS_PER_HOUR) * ticks, 0, 1);
        if (hour) {
          if (n.food <= 0) {
            game.api.mind.addThought(p, 'starving');
            game.api.health.applyDamage(p, NEEDS.starveDamagePerHour, { type: 'starvation' });
          } else if (n.food < NEEDS.hungryAt) game.api.mind.addThought(p, 'hungry');
          if (n.rest <= 0.02) game.api.mind.addThought(p, 'exhausted');
        }
      }
    },
  });

  // --- шаг «сон» ---
  game.jobs.registerToil({
    id: 'sleep',
    start(game, pawn, toil, job) {
      pawn.asleep = true;
      const bed = job.data.bedId ? game.entities.get(job.data.bedId) : null;
      game.events.emit(EVENTS.PAWN_SLEPT, { pawn, bed: bed || null, onFloor: !bed });
    },
    tick(game, pawn, toil, job, dt) {
      const rate = job.data.bedId ? NEEDS.restPerHourBed : NEEDS.restPerHourFloor;
      const mul = game.defs.buildings.get(game.entities.get(job.data.bedId)?.defId)?.restEffect ?? 1;
      pawn.needs.rest = clamp(pawn.needs.rest + (rate * mul / TICKS_PER_HOUR) * dt * 60, 0, 1);
      pawn.asleep = true;
      const r = pawn.needs.rest;
      if (r >= 1 || (r > 0.7 && !game.time.isSleepTime())) return 'done';
      if (pawn.needs.food < NEEDS.starvingAt) return 'done';
      return 'running';
    },
    end(game, pawn, toil, job) {
      pawn.asleep = false;
      if (!job.data.bedId) game.api.mind.addThought(pawn, 'slept_on_floor');
      else game.api.mind.addThought(pawn, 'slept_in_bed');
      game.events.emit(EVENTS.PAWN_WOKE, { pawn });
    },
  });

  // --- задача «поесть» ---
  game.jobs.registerJobType({
    id: 'eat',
    workType: null,
    labelKey: 'job.eat',
    priority: 90,
    makeToils(game, pawn, job) {
      if (job.data.forage) {
        return [
          { type: 'goto', targetId: job.targetId, adjacent: true },
          {
            type: 'work',
            ticks: 160,
            fx: 'harvest',
            targetId: job.targetId,
            onDone(g, p) {
              const bush = g.entities.get(job.targetId);
              if (!bush) return 'failed';
              cutPlant(g, bush, p, true);
              // съесть часть урожая прямо с куста
              const berries = g.entities.queryRadius(bush.x + 0.5, bush.y + 0.5, 2.5, 'item', (it) => g.defs.items.get(it.defId)?.nutrition > 0);
              for (const it of berries) {
                const def = g.defs.items.get(it.defId);
                const want = Math.ceil((1 - p.needs.food) / def.nutrition);
                const n = g.items.take(it, want);
                p.needs.food = clamp(p.needs.food + n * def.nutrition, 0, 1);
                g.events.emit(EVENTS.PAWN_ATE, { pawn: p, item: null, defId: it.defId, nutrition: n * def.nutrition });
                if (p.needs.food >= 0.99) break;
              }
              g.api.mind.addThought(p, 'ate_raw');
              return undefined;
            },
          },
        ];
      }
      return [
        { type: 'goto', targetId: job.targetId, adjacent: true },
        { type: 'pickup', targetId: job.targetId, count: job.data.count },
        {
          type: 'work',
          ticks: 120,
          fx: 'eat',
          x: Math.floor(pawn.x),
          y: Math.floor(pawn.y),
          onDone(g, p) {
            const c = p.carry;
            if (!c) return 'failed';
            const def = g.defs.items.get(c.defId);
            const nut = (def?.nutrition ?? 0) * c.count;
            p.needs.food = clamp(p.needs.food + nut, 0, 1);
            p.carry = null;
            g.events.emit(EVENTS.PAWN_ATE, { pawn: p, item: null, defId: c.defId, nutrition: nut });
            g.api.mind.addThought(p, def?.foodKind === 'raw' ? 'ate_raw' : def?.foodKind === 'meal' ? 'ate_meal' : 'ate_ration');
            return undefined;
          },
        },
      ];
    },
  });

  // --- задача «спать» ---
  game.jobs.registerJobType({
    id: 'sleep',
    workType: null,
    labelKey: 'job.sleep',
    priority: 80,
    reserve(game, pawn, job) {
      return job.data.bedId ? [resKey.entity(job.data.bedId)] : [resKey.cell(job.x, job.y)];
    },
    makeToils(game, pawn, job) {
      return [{ type: 'goto', x: job.x, y: job.y }, { type: 'sleep' }];
    },
  });

  // --- узлы ИИ ---
  game.ai.registerThinkNode({
    id: 'eat',
    priority: 90,
    interrupts: true,
    factions: ['colony'],
    evaluate(game, pawn, ctx) {
      const food = pawn.needs.food ?? 1;
      if (pawn.job?.type === 'eat') return null;
      if (ctx.interrupt ? food > NEEDS.starvingAt : food > NEEDS.hungryAt) return null;
      return makeEatJob(game, pawn);
    },
  });
  game.ai.registerThinkNode({
    id: 'sleep',
    priority: 80,
    interrupts: false,
    factions: ['colony'],
    evaluate(game, pawn) {
      const rest = pawn.needs.rest ?? 1;
      const sleepTime = game.time.isSleepTime() && game.api.mind.scheduleAllows(pawn, 'sleep');
      if (!(rest < NEEDS.tiredAt || (sleepTime && rest < 0.92))) return null;
      return makeSleepJob(game, pawn);
    },
  });
}

/** Еда: предмет с nutrition (предпочитая не сырое), иначе — куст с ягодами. */
export function makeEatJob(game, pawn) {
  const food = game.items.findNearest(pawn, (it, def) => (def.nutrition ?? 0) > 0 && def.category === 'food');
  if (food) {
    const def = game.defs.items.get(food.defId);
    const count = Math.max(1, Math.min(food.count, Math.ceil((1 - pawn.needs.food) / def.nutrition)));
    return game.jobs.createJob('eat', pawn, { targetId: food.id, x: food.x, y: food.y, data: { count } });
  }
  // собирательство
  let best = null;
  let bestD = Infinity;
  for (const p of game.entities.queryRadius(pawn.x, pawn.y, 40, 'plant')) {
    const d = game.defs.plants.get(p.defId);
    if (!d?.harvestYield || (p.growth ?? 1) < 1) continue;
    if (game.jobs.isReserved(resKey.entity(p.id), pawn)) continue;
    const dd = (p.x - pawn.x) ** 2 + (p.y - pawn.y) ** 2;
    if (dd < bestD && game.pathfinder.canReach(pawn.x, pawn.y, p.x, p.y, true)) {
      bestD = dd;
      best = p;
    }
  }
  if (best) return game.jobs.createJob('eat', pawn, { targetId: best.id, x: best.x, y: best.y, data: { forage: true } });
  return null;
}

/** Сон: свободная кровать → место на полу в жилом вагоне → под крышей → где стоит. */
export function makeSleepJob(game, pawn) {
  let bed = null;
  let bestD = Infinity;
  for (const b of game.entities.ofKind('building')) {
    const def = game.defs.buildings.get(b.defId);
    if (!def?.bed) continue;
    if (b.ownerId && b.ownerId !== pawn.id) continue;
    if (game.jobs.isReserved(resKey.entity(b.id), pawn)) continue;
    const d = (b.x - pawn.x) ** 2 + (b.y - pawn.y) ** 2;
    if (d < bestD && game.pathfinder.canReach(pawn.x, pawn.y, b.x, b.y)) {
      bestD = d;
      bed = b;
    }
  }
  if (bed) return game.jobs.createJob('sleep', pawn, { x: bed.x, y: bed.y, data: { bedId: bed.id } });
  const spot = findFloorSpot(game, pawn);
  return game.jobs.createJob('sleep', pawn, { x: spot.x, y: spot.y, data: { bedId: 0 } });
}

function findFloorSpot(game, pawn) {
  const map = game.map;
  const train = game.train;
  const cars = train ? train.cars.filter((c) => c.type === 'residential') : [];
  const candidates = [];
  const pushCar = (car) => {
    if (!car.rect) return;
    const r = car.rect;
    for (let y = r.y + 1; y < r.y + r.h - 1; y++)
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) candidates.push({ x, y });
  };
  cars.forEach(pushCar);
  if (train) train.cars.forEach((c) => c.type !== 'residential' && c.type !== 'locomotive' && pushCar(c));
  for (const c of candidates) {
    if (!map.isPassable(c.x, c.y)) continue;
    if (map.buildingAt(c.x, c.y)) continue;
    if (game.items.itemAt(c.x, c.y)) continue;
    if (game.jobs.isReserved(resKey.cell(c.x, c.y), pawn)) continue;
    if (!game.pathfinder.canReach(pawn.x, pawn.y, c.x, c.y)) continue;
    return c;
  }
  return { x: Math.floor(pawn.x), y: Math.floor(pawn.y) };
}
