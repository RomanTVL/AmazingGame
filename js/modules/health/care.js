// Медицина: перевязка (tend), спасение упавших (rescue), кормление лежачих (feedPatient), хирургия (surgery),
// ожидание врача; действия E лидера (перевязать, выслушать последние слова, нести/положить, операция).
import { resKey, cutPlant } from '../../sim/jobs.js';
import { stopMoving, moveTo, pathDone } from '../../sim/pawn.js';
import { safeNum, clamp01 } from '../../core/math.js';
import { TICKS_PER_HOUR } from '../../core/constants.js';
import { computeCache, tendAll, tendNeed, ensureHealth, needsTending, findCond, PART_INDEX, DESCENDANTS, touch } from './model.js';
import { stabilize, hearLastWords, thought, firstName } from './death.js';
import { canCarry, canBeCarried, startCarry, dropCarry, carriedOf, isCarrying, bedNear } from './carry.js';
import { medicinePotency, PART, PROSTHETIC_ITEMS } from './defs.js';

const safe = (fn, d = null) => {
  try {
    const v = fn();
    return v === undefined ? d : v;
  } catch {
    return d;
  }
};
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function doctorSkill(game, pawn) {
  return safeNum(safe(() => game.api.mind.skillLevel(pawn, 'medicine'), 3), 0, 20, 3);
}

/** Пациент: поселенец или пленный (живой, не на руках). */
export function isPatient(p) {
  return !!p && p.kind === 'pawn' && !p.dead && !p.removed && (p.faction === 'colony' || p.prisoner) && !p.boss;
}

/** Нужна ли пациенту перевязка/лечение (или он умирает). */
export function needsCare(game, p) {
  return !!p.dying || tendNeed(game, p) > 0;
}

/** Срочный пациент: умирает, или лежит и истекает кровью / не перевязан. */
export function isUrgent(game, p) {
  if (!isPatient(p) || p.carriedById) return false;
  if (p.dying) return true;
  if (!p.downed) return false;
  return computeCache(game, p).bleed > 0.08 || tendNeed(game, p) > 0;
}

/** Срочность: умирающий > кровотечение > упавший > прочее. */
function urgency(game, p) {
  const c = computeCache(game, p);
  return (p.dying ? 1000 : 0) + c.bleed * 200 + (p.downed ? 50 : 0) + tendNeed(game, p);
}

/** Лекарство поблизости (лучшее из ближайших). */
function findMedicine(game, pawn) {
  return game.items.findNearest(pawn, (it, def) => medicinePotency(game, it.defId) > 0 && def.category !== 'food', { maxDist: 45 });
}

// ------------------------------------------------------------------ шаг «подойти к пешке»
function registerToils(game, H) {
  game.jobs.registerToil({
    id: 'health:gotoPawn',
    start(g, pawn, toil, job) {
      const t = g.entities.get(toil.targetId ?? job.targetId);
      if (!t || t.dead || t.removed) return 'failed';
      if (t === pawn || Math.hypot(t.x - pawn.x, t.y - pawn.y) <= 1.5) return 'done';
      toil._tx = Math.floor(t.x);
      toil._ty = Math.floor(t.y);
      if (!moveTo(g, pawn, toil._tx, toil._ty, { adjacent: true })) return 'failed';
      return undefined;
    },
    tick(g, pawn, toil, job) {
      const t = g.entities.get(toil.targetId ?? job.targetId);
      if (!t || t.dead || t.removed) return 'failed';
      if (Math.hypot(t.x - pawn.x, t.y - pawn.y) <= 1.5) {
        stopMoving(pawn);
        return 'done';
      }
      const moved = Math.floor(t.x) !== toil._tx || Math.floor(t.y) !== toil._ty;
      if (pathDone(pawn) || (moved && (g.time.tick + pawn.id) % 20 === 0)) {
        toil._retries = (toil._retries || 0) + 1;
        if (toil._retries > 12) return 'failed';
        toil._tx = Math.floor(t.x);
        toil._ty = Math.floor(t.y);
        if (!moveTo(g, pawn, toil._tx, toil._ty, { adjacent: true })) return 'failed';
      }
      return 'running';
    },
    end(g, pawn) {
      stopMoving(pawn);
    },
  }, 'health');
}

// ------------------------------------------------------------------ задачи
function registerJobs(game, H) {
  const J = game.jobs;

  // --- ожидание врача (пациент на ногах стоит на месте) ---
  J.registerJobType({
    id: 'health:waitTend',
    workType: null,
    labelKey: 'health.job.waitTend',
    priority: 96,
    reserve: () => [],
    makeToils: (g, pawn, job) => [{
      type: 'interact',
      fn(g2, p) {
        const doc = g2.entities.get(job.data.doctorId);
        const busy = doc && !doc.dead && doc.job && (doc.job.targetId === p.id || doc.job.data?.patientId === p.id);
        if (!busy || g2.time.tick - job.startedTick > 2400) return 'done';
        stopMoving(p);
        if (doc) p.dir = Math.atan2(doc.y - p.y, doc.x - p.x);
        return 'running';
      },
    }],
  }, 'health');

  const summon = (g, doctor, patient) => {
    if (!patient || patient === doctor || patient.downed || patient.controlled === 'player' || patient.dead) return;
    if (patient.job?.type === 'health:waitTend') return;
    if (patient.drafted && patient.job) return;
    if (patient.job && (patient.job.workType === 'doctoring' || patient.job.priority >= 85)) return;
    const job = J.createJob('health:waitTend', patient, { data: { doctorId: doctor.id } });
    J.startJob(patient, job);
  };

  // --- перевязка ---
  J.registerJobType({
    id: 'health:tend',
    workType: 'doctoring',
    labelKey: 'health.job.tend',
    priority: 72,
    adjacent: true,
    findJob(g, pawn) {
      if (!g.api.health.canWork(pawn)) return null;
      let best = null;
      let bestS = 0;
      for (const p of g.entities.ofKind('pawn')) {
        if (!isPatient(p) || p.carriedById || !needsCare(g, p)) continue;
        if (H.rt.urgentOnly && !isUrgent(g, p)) continue;
        if (p === pawn) {
          if (p.downed) continue;
        } else {
          if (p.controlled === 'player' && !p.downed) continue; // лидер на ногах лечится сам (E)
          if (p.drafted && !p.downed) continue;
          if (!p.downed && p.job && (p.job.workType === 'doctoring' || p.job.priority >= 85)) continue; // занят делом поважнее
        }
        if (J.isReserved(resKey.entity(p.id), pawn)) continue;
        if (p !== pawn && !g.pathfinder.canReach(pawn.x, pawn.y, Math.floor(p.x), Math.floor(p.y), true)) continue;
        // себя — только если больше некому и рана не пустяк
        let s = urgency(g, p) - Math.sqrt(d2(p, pawn)) * 0.5;
        if (p === pawn) s *= 0.5;
        if (s > bestS || !best) {
          best = p;
          bestS = s;
        }
      }
      if (!best) return null;
      const med = findMedicine(g, pawn);
      return { targetId: best.id, x: Math.floor(best.x), y: Math.floor(best.y), data: { medId: med?.id || 0, patientId: best.id } };
    },
    canDo(g, pawn, spec) {
      const p = g.entities.get(spec.targetId);
      return !!p && isPatient(p) && needsCare(g, p) && !p.carriedById && !pawn.downed;
    },
    reserve(g, pawn, job) {
      const keys = [resKey.entity(job.targetId)];
      if (job.data.medId) keys.push(resKey.entity(job.data.medId));
      return keys;
    },
    failIf(g, pawn, job) {
      const p = g.entities.get(job.targetId);
      return !p || p.dead || p.removed || !!p.carriedById || pawn.downed;
    },
    makeToils(g, pawn, job) {
      const toils = [];
      if (job.data.medId && !job.manual) toils.push({ type: 'goto', targetId: job.data.medId, adjacent: true }, { type: 'pickup', targetId: job.data.medId, count: 1 });
      else if (job.data.medId && job.manual) {
        // лидер: лекарство из запасов колонии без похода на склад (быстрее и удобнее)
        job.data.remoteMed = true;
      }
      const p = g.entities.get(job.targetId);
      const n = p ? Math.max(1, tendNeed(g, p)) : 1;
      const self = p === pawn;
      toils.push(
        { type: 'interact', fn: (g2, doc) => (summon(g2, doc, g2.entities.get(job.targetId)), 'done') },
        { type: 'health:gotoPawn', targetId: job.targetId },
        {
          type: 'work',
          ticks: Math.round((self ? 1.4 : 1) * (160 + 70 * Math.min(8, n) + (p?.dying ? 120 : 0))),
          workType: 'doctoring',
          targetId: job.targetId,
          fx: 'tend',
          onTick(g2, doc) {
            const pt = g2.entities.get(job.targetId);
            if (!pt || Math.hypot(pt.x - doc.x, pt.y - doc.y) > 2.2) return 'failed';
            if ((g2.time.tick + doc.id) % 50 === 0) safe(() => g2.api.av.play('health_tend', { x: pt.x, y: pt.y }));
            return undefined;
          },
          onDone: (g2, doc) => doTend(H, doc, g2.entities.get(job.targetId), job),
        },
      );
      return toils;
    },
    onEnd(g, pawn, job) {
      const p = g.entities.get(job.targetId);
      if (p?.job?.type === 'health:waitTend') g.jobs.endJob(p, 'done');
    },
  }, 'health');

  // --- спасение упавшего ---
  J.registerJobType({
    id: 'health:rescue',
    workType: 'doctoring',
    labelKey: 'health.job.rescue',
    priority: 74,
    adjacent: true,
    findJob(g, pawn) {
      if (!canCarry(g, pawn)) return null;
      let best = null;
      let bestD = Infinity;
      for (const p of g.entities.ofKind('pawn')) {
        if (!needsRescue(H, p) || p === pawn) continue;
        if (H.rt.urgentOnly && !isUrgent(g, p)) continue;
        if (J.isReserved(resKey.entity(p.id), pawn)) continue;
        const d = d2(p, pawn);
        if (d >= bestD) continue;
        if (!g.pathfinder.canReach(pawn.x, pawn.y, Math.floor(p.x), Math.floor(p.y), true)) continue;
        best = p;
        bestD = d;
      }
      if (!best) return null;
      const spot = findRestSpot(H, pawn, best);
      if (!spot) return null;
      return { targetId: best.id, x: Math.floor(best.x), y: Math.floor(best.y), data: { patientId: best.id, sx: spot.x, sy: spot.y, bedId: spot.bedId || 0 } };
    },
    canDo: (g, pawn, spec) => canCarry(g, pawn) && needsRescue(H, g.entities.get(spec.targetId)),
    reserve(g, pawn, job) {
      const keys = [resKey.entity(job.targetId), resKey.cell(job.data.sx, job.data.sy)];
      if (job.data.bedId) keys.push(resKey.entity(job.data.bedId));
      return keys;
    },
    failIf(g, pawn, job) {
      const p = g.entities.get(job.targetId);
      if (!p || p.dead || p.removed) return true;
      if (job.i <= 1 && (p.carriedById || !p.downed)) return true;
      return false;
    },
    makeToils(g, pawn, job) {
      job.keepCarry = false;
      return [
        { type: 'health:gotoPawn', targetId: job.targetId },
        {
          type: 'interact',
          fn(g2, doc) {
            const p = g2.entities.get(job.targetId);
            return startCarry(H, doc, p) ? 'done' : 'failed';
          },
        },
        { type: 'goto', x: job.data.sx, y: job.data.sy, adjacent: !!job.data.bedId },
        {
          type: 'interact',
          fn(g2, doc) {
            const p = dropCarry(H, doc, { reason: 'rescue', x: job.data.sx, y: job.data.sy, bedId: job.data.bedId });
            if (p && p.kind === 'pawn') thought(g2, p, 'was_rescued', { otherPawnId: doc.id });
            return 'done';
          },
        },
      ];
    },
    onEnd(g, pawn, job, result) {
      if (result !== 'done' && pawn.carryPawnId) dropCarry(H, pawn, { reason: 'failed', findBed: false });
    },
  }, 'health');

  // --- покормить лежачего ---
  J.registerJobType({
    id: 'health:feedPatient',
    workType: 'doctoring',
    labelKey: 'health.job.feed',
    priority: 66,
    adjacent: true,
    findJob(g, pawn) {
      if (!g.api.health.canWork(pawn) || isCarrying(pawn)) return null;
      let best = null;
      let bestF = 0.3;
      for (const p of g.entities.ofKind('pawn')) {
        if (!isPatient(p) || !p.downed || p.carriedById || p === pawn || p.dying) continue;
        const f = p.needs?.food ?? 1;
        if (f >= bestF) continue;
        if (J.isReserved(resKey.entity(p.id), pawn)) continue;
        if (!g.pathfinder.canReach(pawn.x, pawn.y, Math.floor(p.x), Math.floor(p.y), true)) continue;
        best = p;
        bestF = f;
      }
      if (!best) return null;
      const food = g.items.findNearest(pawn, (it, def) => (def.nutrition ?? 0) > 0 && def.category === 'food', { maxDist: 60 });
      if (!food) {
        // еды на складе нет — нарвать ягод с ближайшего куста
        const bush = findBush(g, pawn);
        if (!bush) return null;
        return { targetId: best.id, x: Math.floor(best.x), y: Math.floor(best.y), data: { bushId: bush.id, patientId: best.id } };
      }
      const def = g.defs.items.get(food.defId);
      const count = Math.max(1, Math.min(food.count, Math.ceil((1 - (best.needs.food ?? 0)) / Math.max(0.05, def.nutrition))));
      return { targetId: best.id, x: Math.floor(best.x), y: Math.floor(best.y), data: { foodId: food.id, count, patientId: best.id } };
    },
    reserve: (g, pawn, job) => [resKey.entity(job.targetId), resKey.entity(job.data.foodId || job.data.bushId)],
    failIf(g, pawn, job) {
      const p = g.entities.get(job.targetId);
      return !p || p.dead || !p.downed || !!p.carriedById;
    },
    makeToils: (g, pawn, job) => [
      ...(job.data.bushId
        ? [
          { type: 'goto', targetId: job.data.bushId, adjacent: true },
          {
            type: 'work',
            ticks: 160,
            fx: 'harvest',
            targetId: job.data.bushId,
            onDone(g2, doc) {
              const bush = g2.entities.get(job.data.bushId);
              if (!bush) return 'failed';
              cutPlant(g2, bush, doc, true);
              const items = g2.entities.queryRadius(bush.x + 0.5, bush.y + 0.5, 2.5, 'item', (it) => (g2.defs.items.get(it.defId)?.nutrition ?? 0) > 0);
              if (!items.length) return 'failed';
              const patient = g2.entities.get(job.targetId);
              const def = g2.defs.items.get(items[0].defId);
              const want = Math.max(1, Math.ceil((1 - (patient?.needs?.food ?? 0)) / Math.max(0.05, def.nutrition)));
              return g2.items.pickUp(doc, items[0], Math.min(items[0].count, want)) > 0 ? undefined : 'failed';
            },
          },
        ]
        : [
          { type: 'goto', targetId: job.data.foodId, adjacent: true },
          { type: 'pickup', targetId: job.data.foodId, count: job.data.count },
        ]),
      { type: 'health:gotoPawn', targetId: job.targetId },
      {
        type: 'work',
        ticks: 140,
        targetId: job.targetId,
        fx: 'eat',
        onDone(g2, doc) {
          const p = g2.entities.get(job.targetId);
          const c = doc.carry;
          if (!p || !c) return 'failed';
          const def = g2.defs.items.get(c.defId);
          const nut = (def?.nutrition ?? 0) * c.count;
          p.needs.food = Math.min(1, (p.needs.food ?? 0) + nut);
          doc.carry = null;
          g2.events.emit('pawn:ate', { pawn: p, item: null, defId: c.defId, nutrition: nut, fedBy: doc });
          return undefined;
        },
      },
    ],
  }, 'health');

  // --- хирургия ---
  J.registerJobType({
    id: 'health:surgery',
    workType: 'doctoring',
    labelKey: 'health.job.surgery',
    priority: 68,
    adjacent: true,
    findJob(g, pawn) {
      if (!g.api.health.canWork(pawn) || isCarrying(pawn) || armBrokenSafe(g, pawn)) return null;
      for (const p of g.entities.ofKind('pawn')) {
        if (!isPatient(p) || p === pawn || p.carriedById || p.dying) continue;
        const op = p.health?.ops?.[0];
        if (!op) continue;
        if (p.controlled === 'player' && !p.downed) continue;
        if (J.isReserved(resKey.entity(p.id), pawn)) continue;
        if (!g.pathfinder.canReach(pawn.x, pawn.y, Math.floor(p.x), Math.floor(p.y), true)) continue;
        let itemId = 0;
        if (op.kind === 'install') {
          const it = g.items.findNearest(pawn, (i) => i.defId === op.item, { maxDist: 80 });
          if (!it) continue;
          itemId = it.id;
        }
        return { targetId: p.id, x: Math.floor(p.x), y: Math.floor(p.y), data: { patientId: p.id, itemId, op: { ...op } } };
      }
      return null;
    },
    reserve(g, pawn, job) {
      const keys = [resKey.entity(job.targetId)];
      if (job.data.itemId) keys.push(resKey.entity(job.data.itemId));
      return keys;
    },
    failIf(g, pawn, job) {
      const p = g.entities.get(job.targetId);
      return !p || p.dead || !!p.carriedById || !p.health?.ops?.length;
    },
    makeToils(g, pawn, job) {
      const t = [];
      if (job.data.itemId && !job.data.remote) t.push({ type: 'goto', targetId: job.data.itemId, adjacent: true }, { type: 'pickup', targetId: job.data.itemId, count: 1 });
      t.push(
        { type: 'interact', fn: (g2, doc) => (summon(g2, doc, g2.entities.get(job.targetId)), 'done') },
        { type: 'health:gotoPawn', targetId: job.targetId },
        {
          type: 'work',
          ticks: 900,
          workType: 'doctoring',
          targetId: job.targetId,
          fx: 'tend',
          onTick(g2, doc) {
            const pt = g2.entities.get(job.targetId);
            if (!pt || Math.hypot(pt.x - doc.x, pt.y - doc.y) > 2.2) return 'failed';
            return undefined;
          },
          onDone: (g2, doc) => (doSurgery(H, doc, g2.entities.get(job.targetId), job) ? undefined : 'failed'),
        },
      );
      return t;
    },
    onEnd(g, pawn, job) {
      const p = g.entities.get(job.targetId);
      if (p?.job?.type === 'health:waitTend') g.jobs.endJob(p, 'done');
    },
  }, 'health');
}

function findBush(g, pawn) {
  let best = null;
  let bestD = Infinity;
  for (const p of g.entities.queryRadius(pawn.x, pawn.y, 40, 'plant')) {
    const d = g.defs.plants.get(p.defId);
    if (!d?.harvestYield || (p.growth ?? 1) < 1) continue;
    if (g.jobs.isReserved(resKey.entity(p.id), pawn)) continue;
    const dd = (p.x - pawn.x) ** 2 + (p.y - pawn.y) ** 2;
    if (dd < bestD && g.pathfinder.canReach(pawn.x, pawn.y, p.x, p.y, true)) {
      bestD = dd;
      best = p;
    }
  }
  return best;
}

const armBrokenSafe = (g, p) => !canCarry(g, p) && !isCarrying(p) && !p.downed;

/** Нуждается ли упавший в спасении (лежит не в кровати и не под крышей вагона). */
export function needsRescue(H, p) {
  const game = H.game;
  if (!p || p.dead || p.removed || !p.downed || p.carriedById) return false;
  if (p.faction !== 'colony' && !p.prisoner) return false;
  if (p.boss) return false;
  if (p.inBedId && game.entities.get(p.inBedId)) return false;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  const map = game.map;
  if (!map?.inBounds(tx, ty)) return false;
  // под крышей вагона без кроватей рядом — не трогаем
  if (map.roof[map.idx(tx, ty)] > 0 && !anyFreeBed(H)) return false;
  return true;
}

function anyFreeBed(H) {
  for (const b of H.game.entities.ofKind('building')) if (H.game.defs.buildings.get(b.defId)?.bed && !b.blueprint && !H.bedTaken(b)) return true;
  return false;
}

/** Куда положить раненого: свободная кровать (лазарет первым) → пол в лазарете/жилом вагоне → любой вагон. */
export function findRestSpot(H, carrier, patient) {
  const game = H.game;
  const J = game.jobs;
  let best = null;
  let bestS = Infinity;
  for (const b of game.entities.ofKind('building')) {
    const def = game.defs.buildings.get(b.defId);
    if (!def?.bed || b.blueprint || H.bedTaken(b, patient)) continue;
    if (b.ownerId && b.ownerId !== patient.id && b.prisonBed !== !!patient.prisoner) continue;
    if (J.isReserved(resKey.entity(b.id), carrier)) continue;
    if (!game.pathfinder.canReach(carrier.x, carrier.y, b.x, b.y, true)) continue;
    const car = game.train?.carAt?.(b.x, b.y);
    const s = Math.hypot(b.x - patient.x, b.y - patient.y) - (car?.type === 'infirmary' ? 40 : 0);
    if (s < bestS) {
      bestS = s;
      best = { x: b.x, y: b.y, bedId: b.id };
    }
  }
  if (best) return best;
  const train = game.train;
  if (!train) return null;
  const order = ['infirmary', 'residential', 'salon', 'kitchen', 'workshop', 'storage', 'battle', 'greenhouse'];
  const cars = train.cars.filter((c) => c.rect && c.type !== 'locomotive' && c.type !== 'hearse').sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const map = game.map;
  for (const car of cars) {
    for (const c of train.interior(car)) {
      if (!map.isPassable(c.x, c.y) || map.buildingAt(c.x, c.y)) continue;
      if (J.isReserved(resKey.cell(c.x, c.y), carrier)) continue;
      if (H.downedAt(c.x, c.y, patient)) continue;
      if (!game.pathfinder.canReach(carrier.x, carrier.y, c.x, c.y)) continue;
      return { x: c.x, y: c.y, bedId: 0 };
    }
  }
  return null;
}

// ------------------------------------------------------------------ сами действия
/** Перевязка: качество от навыка и лекарства; умирающего можно стабилизировать. */
export function doTend(H, doctor, patient, job) {
  const game = H.game;
  if (!patient || patient.dead) return 'failed';
  const skill = doctorSkill(game, doctor);
  let medDef = null;
  if (doctor.carry && medicinePotency(game, doctor.carry.defId) > 0) medDef = doctor.carry.defId;
  else if (job?.data?.remoteMed && job.data.medId) {
    const it = game.entities.get(job.data.medId);
    if (it && !it.removed && game.items.take(it, 1) > 0) medDef = it.defId;
  }
  const potency = medDef ? medicinePotency(game, medDef) : 0;
  const self = doctor === patient;
  const rng = game.rng;
  let quality = clamp01(0.18 + skill * 0.045 + potency * 0.42) * (self ? 0.7 : 1);
  if (doctor.isLeader && doctor.mage) quality = Math.min(1, quality + 0.05);
  if (patient.dying) {
    const chance = 0.2 + skill / 40 + potency * 0.1;
    if (rng.chance(chance)) stabilize(H, patient);
    else safe(() => game.api.av.floatText(patient.x, patient.y - 0.9, game.t('health.float.stabilizeFail'), '#ff5f6d'));
  }
  const n = tendAll(H, patient, quality);
  if (medDef && doctor.carry?.defId === medDef) {
    doctor.carry.count -= 1;
    if (doctor.carry.count <= 0) doctor.carry = null;
  }
  safe(() => game.api.mind.learn(doctor, 'medicine', 30 + 10 * n));
  game.events.emit('health:tended', { doctor, patient, quality, medicine: medDef, count: n });
  if (n > 0 && !game.isHeadless) safe(() => game.api.av.floatText(patient.x, patient.y - 0.9, game.t('health.float.tended', { q: Math.round(quality * 100) }), '#7dff9a'));
  H.afterChange(patient);
  return undefined;
}

/** Хирургия: ампутация / протез. @returns {boolean} */
export function doSurgery(H, doctor, patient, job) {
  const game = H.game;
  const h = patient?.health;
  if (!h?.ops?.length) return false;
  const op = h.ops.shift();
  const skill = doctorSkill(game, doctor);
  const ok = game.rng.chance(Math.min(0.97, 0.55 + skill * 0.035));
  const tick = game.time.tick;
  if (op.kind === 'install') {
    const carryOk = doctor.carry?.defId === op.item;
    if (!carryOk && !job?.data?.remote) return false;
    if (carryOk) {
      doctor.carry.count -= 1;
      if (doctor.carry.count <= 0) doctor.carry = null;
    } else if (!game.items.consume({ [op.item]: 1 }, doctor.x, doctor.y)) return false;
    if (!ok) {
      H.applyDamage(patient, 6, { part: op.part, type: 'surgery', cause: 'surgery' });
      game.api.ui.notify(game.t('health.log.surgeryFailed', { name: patient.name }), { type: 'bad', pawnId: patient.id });
      return true;
    }
    installProsthetic(H, patient, op.cond, op.part);
    thought(game, patient, 'got_prosthetic');
    game.api.ui.notify(game.t('health.log.prostheticDone', { name: patient.name, item: game.t(`health.item.${op.item}`) }), { type: 'good', pawnId: patient.id });
  } else if (op.kind === 'amputate') {
    amputate(H, patient, op.part, ok ? 0 : 6);
    game.api.ui.notify(game.t('health.log.amputated', { name: patient.name, part: game.t(`health.part.${op.part}`) }), { type: 'info', pawnId: patient.id });
  }
  touch(h);
  void tick;
  H.afterChange(patient);
  safe(() => game.api.mind.learn(doctor, 'medicine', 120));
  game.events.emit('health:surgery', { doctor, patient, op, ok });
  return true;
}

/** Ампутация части (и потомков): утрата без кровотечения (перевязана), инфекция уходит. */
export function amputate(H, pawn, partId, extraDamage = 0) {
  const game = H.game;
  const h = ensureHealth(pawn);
  if (!PART[partId]) return false;
  const gone = new Set([partId, ...DESCENDANTS[partId]]);
  h.conds = h.conds.filter((x) => !gone.has(x.part));
  const tick = game.time.tick;
  h.conds.push({ id: 'missing', part: partId, sev: PART[partId].hp, born: tick, fresh: true, tq: 0.8, tt: tick });
  h.conds.push({ id: 'surgical', part: PART[partId].parent || 'torso', sev: 4 + extraDamage, peak: 4 + extraDamage, born: tick, tq: 0.7, tt: tick });
  touch(h);
  thought(game, pawn, 'lost_limb');
  game.events.emit('health:partLost', { pawn, part: partId, x: pawn.x, y: pawn.y, type: 'surgery', source: null, severed: false, surgical: true });
  return true;
}

/** Поставить протез на утраченную часть (или заменить больную). */
export function installProsthetic(H, pawn, condId, partId) {
  const game = H.game;
  const h = ensureHealth(pawn);
  const def = game.defs.conditions.get(condId);
  if (!def || !PART[partId]) return null;
  const gone = new Set([partId, ...DESCENDANTS[partId]]);
  h.conds = h.conds.filter((x) => !gone.has(x.part));
  const cd = { id: condId, part: partId, sev: 1, born: game.time.tick, prosthetic: true, eff: def.eff ?? 0.5 };
  h.conds.push(cd);
  touch(h);
  computeCache(game, pawn, true);
  game.events.emit('health:prosthetic', { pawn, part: partId, cond: condId });
  return cd;
}

/** Какие операции доступны пациенту: [{kind, part, cond?, item?, labelKey}] */
export function availableOps(H, pawn) {
  const game = H.game;
  const h = pawn?.health;
  if (!h?.conds) return [];
  const out = [];
  const c = computeCache(game, pawn);
  for (const cd of h.conds) {
    if (cd.id === 'infection' && cd.part && PART[cd.part]?.sever) out.push({ kind: 'amputate', part: cd.part });
  }
  for (const p of PROSTHETIC_ITEMS) {
    const def = game.defs.conditions.get(p.cond);
    for (const g of def?.groups || []) {
      // целевая часть протеза: корень группы для ноги/руки (кисть — для деревянной руки), глаз
      const side = g.slice(-1);
      let part = g.startsWith('leg') ? `leg_${side}` : g.startsWith('eye') ? g : p.cond === 'wooden_hand' ? `hand_${side}` : `shoulder_${side}`;
      if (p.cond === 'rune_arm') part = `arm_${side}`;
      const i = PART_INDEX[part];
      if (i === undefined) continue;
      const missingHere = c.missing[i] && !isAncestorMissing(c, part);
      if (!missingHere) continue;
      if (c.prost[i] >= 0) continue;
      out.push({ kind: 'install', part, cond: p.cond, item: p.id, have: game.items.count(p.id) > 0 });
    }
  }
  return out;
}

function isAncestorMissing(c, partId) {
  let p = PART[partId]?.parent;
  while (p) {
    if (c.missing[PART_INDEX[p]]) return true;
    p = PART[p].parent;
  }
  return false;
}

/** Назначить операцию (из панели). */
export function scheduleOp(H, pawn, op) {
  const h = ensureHealth(pawn);
  h.ops ||= [];
  if (h.ops.some((o) => o.kind === op.kind && o.part === op.part)) return false;
  h.ops.push({ kind: op.kind, part: op.part, cond: op.cond || null, item: op.item || null });
  H.game.api.ui.notify(H.game.t('health.log.opScheduled', { name: pawn.name }), { type: 'info', pawnId: pawn.id });
  return true;
}

// ------------------------------------------------------------------ действия E лидера
const pawnAt = (game, tx, ty, pred) => {
  for (const p of game.entities.queryRadius(tx + 0.5, ty + 0.5, 0.95, 'pawn')) if (!p.dead && pred(p)) return p;
  return null;
};

function registerInteractions(game, H) {
  const reg = game.defs.interactions;
  const near = (L, p, r = 2.3) => Math.hypot(L.x - p.x, L.y - p.y) <= r;
  const approach = (g, L, p) => {
    if (!g.player.walkTo(p.x, p.y)) g.audio.play('error');
  };

  // последние слова
  reg.add({
    id: 'health:lastWords',
    order: 5,
    find(g, L, tx, ty) {
      if (L.downed || isCarrying(L)) return null;
      const p = pawnAt(g, tx, ty, (o) => o !== L && o.dying && !o.dying.heard);
      if (!p) return null;
      return {
        label: g.t('health.act.lastWords', { name: firstName(p.name) }),
        x: tx,
        y: ty,
        run(g2, pawn) {
          if (near(pawn, p, 2.6)) hearLastWords(H, pawn, p);
          else approach(g2, pawn, p);
        },
      };
    },
  }, 'health');

  // перевязать / стабилизировать
  reg.add({
    id: 'health:tend',
    order: 6,
    find(g, L, tx, ty) {
      if (L.downed || isCarrying(L)) return null;
      const p = pawnAt(g, tx, ty, (o) => isPatient(o) && !o.carriedById && needsCare(g, o) && (o !== L || tendNeed(g, o) > 0));
      if (!p) return null;
      if (p.dying && !p.dying.heard && p !== L) return null; // сперва — последние слова (order 5)
      const self = p === L;
      return {
        label: g.t(p.dying ? 'health.act.stabilize' : self ? 'health.act.tendSelf' : 'health.act.tend', { name: firstName(p.name) }),
        x: tx,
        y: ty,
        run(g2, pawn) {
          const med = findMedicine(g2, pawn);
          if (!g2.jobs.startManual(pawn, 'health:tend', { targetId: p.id, x: Math.floor(p.x), y: Math.floor(p.y), data: { medId: med?.id || 0, patientId: p.id } })) g2.audio.play('error');
        },
      };
    },
  }, 'health');

  // операция
  reg.add({
    id: 'health:surgery',
    order: 8,
    find(g, L, tx, ty) {
      if (L.downed || isCarrying(L)) return null;
      const p = pawnAt(g, tx, ty, (o) => o !== L && isPatient(o) && o.health?.ops?.length && !o.dying && !o.carriedById);
      if (!p) return null;
      const op = p.health.ops[0];
      if (op.kind === 'install' && g.items.count(op.item) <= 0) return null;
      return {
        label: g.t('health.act.surgery', { name: firstName(p.name), part: g.t(`health.part.${op.part}`) }),
        x: tx,
        y: ty,
        run(g2, pawn) {
          if (!g2.jobs.startManual(pawn, 'health:surgery', { targetId: p.id, x: Math.floor(p.x), y: Math.floor(p.y), data: { patientId: p.id, itemId: 0, remote: true, op: { ...op } } })) g2.audio.play('error');
        },
      };
    },
  }, 'health');

  // нести (удержание E): упавший или тело
  reg.add({
    id: 'health:carry',
    order: 7,
    hold: true,
    find(g, L, tx, ty) {
      if (L.downed || isCarrying(L)) return null;
      const p = pawnAt(g, tx, ty, (o) => o !== L && canBeCarried(g, o) && !o.prisoner);
      const corpse = p ? null : g.entities.atTile(tx, ty, 'corpse').find((c) => canBeCarried(g, c));
      const t = p || corpse;
      if (!t) return null;
      if (!canCarry(g, L)) return { label: g.t('health.act.cantCarry'), x: tx, y: ty, hold: false, run: (g2) => g2.audio.play('error') };
      const name = firstName(t.name || '?');
      let started = false;
      return {
        label: g.t(corpse ? 'health.act.carryBody' : 'health.act.carry', { name }),
        x: tx,
        y: ty,
        onHoldStart() {
          started = false;
        },
        onHoldTick(g2, pawn, ms) {
          if (started || ms < 450) return;
          started = true;
          const ok = Math.hypot(pawn.x - (t.kind === 'corpse' ? t.x + 0.5 : t.x), pawn.y - (t.kind === 'corpse' ? t.y + 0.5 : t.y)) <= 2.4 && startCarry(H, pawn, t);
          if (!ok) g2.audio.play('error');
          else g2.audio.play('pickup', { x: pawn.x, y: pawn.y });
        },
        onRelease(g2, pawn, ms) {
          if (!started && ms < 450 && Math.hypot(pawn.x - t.x, pawn.y - t.y) > 2.4) approach(g2, pawn, t.kind === 'corpse' ? { x: t.x + 0.5, y: t.y + 0.5 } : t);
        },
      };
    },
  }, 'health');

  // положить ношу (кровать рядом → в кровать; катафалк/гроб — тело)
  reg.add({
    id: 'health:putDown',
    order: 9,
    find(g, L, tx, ty) {
      const c = carriedOf(g, L);
      if (!c) return null;
      const name = firstName(c.entity.name || '?');
      if (c.kind === 'pawn') {
        const bed = bedNear(H, L.x, L.y);
        return { label: g.t(bed ? 'health.act.putInBed' : 'health.act.putDown', { name }), x: Math.floor(L.x), y: Math.floor(L.y), run: (g2, pawn) => dropCarry(H, pawn, { reason: 'put' }) };
      }
      const keep = H.keptSpotLabel?.(Math.floor(L.x), Math.floor(L.y));
      return { label: g.t(keep ? 'health.act.putHearse' : 'health.act.putBody', { name }), x: Math.floor(L.x), y: Math.floor(L.y), run: (g2, pawn) => dropCarry(H, pawn, { reason: 'put' }) };
    },
  }, 'health');
}

/** Узел ИИ «Беда!»: врачи встают даже ночью, если кто-то истекает кровью или умирает. */
function registerEmergency(game, H) {
  game.ai.registerThinkNode({
    id: 'health:emergency',
    priority: 86,
    interrupts: true,
    factions: ['colony'],
    evaluate(g, pawn) {
      if (!H.rt.urgentCount || pawn.downed || pawn.drafted || pawn.prisoner) return null;
      if (!g.api.health.canWork(pawn) || g.jobs.getPriority(pawn, 'doctoring') <= 0) return null;
      const cur = pawn.job?.type;
      if (cur === 'health:tend' || cur === 'health:rescue') return null;
      H.rt.urgentOnly = true;
      try {
        for (const id of ['health:rescue', 'health:tend']) {
          const jt = g.defs.jobTypes.get(id);
          const job = jt && g.jobs.tryJobType(jt, pawn);
          if (job) return job;
        }
      } finally {
        H.rt.urgentOnly = false;
      }
      return null;
    },
  }, 'health');
}

/** Сколько срочных пациентов (раз в 30 тиков). */
export function countUrgent(H) {
  let n = 0;
  for (const p of H.game.entities.ofKind('pawn')) if (!p.dead && (p.downed || p.dying) && isUrgent(H.game, p)) n++;
  H.rt.urgentCount = n;
  return n;
}

export function registerCare(game, H) {
  registerToils(game, H);
  registerJobs(game, H);
  registerInteractions(game, H);
  registerEmergency(game, H);
}

export { needsTending, findCond, TICKS_PER_HOUR };
