// Кочегарка и обслуживание локомотива: работа «Кочегарить» (задача stoke + шаг train:shovel), подноска угля в ларь
// (fill_bunker), зарядка рунного ядра кристаллами (charge_core), ремонт котла (repair_boiler), лопата лидера
// (удержание E с «окном жара») и канал маны лидера в рунное ядро.
import { EVENTS } from '../../core/events.js';
import { clamp, dist } from '../../core/math.js';
import { resKey } from '../../sim/jobs.js';
import { FUEL_IDS, STOKE, OVERFEED_HEAT, OVERFEED_TICKS, RUNE, RUNE_CORE_IDS, MAX_HEAT } from './constants.js';
import { rt, loco, ops, isInLoco, inRect, notify, hasUpgrade } from './state.js';
import {
  firebox, runeCore, boilerEntity, fuelStock, invalidateFuel, fuelAllowed, fuelValue, stokeTarget, stokingActive,
  affordableRepairCost, repairCosts, repairBoiler,
} from './machine.js';

const OWNER = 'train';
const REACH = 2.3;
const STOKER_RANGE = 45;
const BUNKER_FILL = 120;

// ---------------- Тайминг лопаты ----------------

/**
 * Качество броска лидера по длительности удержания E: «окно жара» открыто последние 180 мс каждого цикла 900 мс.
 * Внутри окна — 'perfect', в пределах 0,3 с от окна — 'ok', иначе — 'spill'.
 */
export function stokeQuality(heldMs) {
  const { cycle, window, ok } = STOKE;
  const k = Math.max(1, Math.round(heldMs / cycle));
  let best = Infinity;
  for (const kk of [k - 1, k, k + 1]) {
    if (kk < 1) continue;
    const a = kk * cycle - window;
    const b = kk * cycle;
    const d = heldMs < a ? a - heldMs : heldMs > b ? heldMs - b : 0;
    if (d < best) best = d;
  }
  return best === 0 ? 'perfect' : best <= ok ? 'ok' : 'spill';
}

/** Открыто ли «окно жара» сейчас (для отрисовки кольца). */
export function stokeWindowOpen(heldMs) {
  return heldMs >= STOKE.cycle - STOKE.window && heldMs % STOKE.cycle >= STOKE.cycle - STOKE.window;
}

// ---------------- Топливо под рукой ----------------

const carriesFuel = (game, p) => !!p?.carry && FUEL_IDS.includes(p.carry.defId) && p.carry.count > 0;

/** Ближайшая разрешённая стопка топлива на борту для кочегара (ларь локомотива — в первую очередь). */
function findFuelForStoker(game, pawn) {
  const tr = game.train;
  const loc = tr?.locomotive;
  if (!loc?.rect) return null;
  const cars = [...tr.cars].filter((c) => c.rect).sort((a, b) => Math.abs(a.index - loc.index) - Math.abs(b.index - loc.index));
  for (const car of cars) {
    const r = car.rect;
    let best = null;
    let bestRank = Infinity;
    for (const it of game.entities.queryRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, 'item')) {
      if (!inRect(r, it.x, it.y) || it.forbidden || !fuelAllowed(game, it.defId)) continue;
      if (game.jobs.isReserved(resKey.entity(it.id), pawn)) continue;
      const rank = FUEL_IDS.indexOf(it.defId) * 1000 + Math.hypot(it.x + 0.5 - pawn.x, it.y + 0.5 - pawn.y);
      if (rank < bestRank) {
        bestRank = rank;
        best = it;
      }
    }
    if (best && game.pathfinder.canReach(pawn.x, pawn.y, best.x, best.y, true)) return best;
  }
  return null;
}

/** Есть ли у лидера чем топить: в руках или в локомотиве. */
export function leaderFuelSource(game, pawn) {
  if (carriesFuel(game, pawn) && fuelAllowed(game, pawn.carry.defId)) return { carry: true, defId: pawn.carry.defId };
  const r = game.train?.locomotive?.rect;
  if (!r) return null;
  let best = null;
  for (const it of game.entities.queryRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, 'item')) {
    if (!inRect(r, it.x, it.y) || !fuelAllowed(game, it.defId)) continue;
    if (!best || FUEL_IDS.indexOf(it.defId) < FUEL_IDS.indexOf(best.defId)) best = it;
  }
  return best ? { item: best, defId: best.defId } : null;
}

function takeLeaderFuel(game, pawn) {
  const src = leaderFuelSource(game, pawn);
  if (!src) return null;
  if (src.carry) {
    pawn.carry.count -= 1;
    if (pawn.carry.count <= 0) pawn.carry = null;
    return src.defId;
  }
  return game.items.take(src.item, 1) > 0 ? src.defId : null;
}

// ---------------- Бросок в топку ----------------

/**
 * Применить бросок: 'spill' — единица падает на пол; иначе +жар; жар > 95 → 'overfeed' (чёрный дым 20 с, ход ×0,9).
 * @returns {string} итоговое качество
 */
export function applyThrow(game, pawn, box, defId, quality) {
  const L = loco(game);
  let heat = 0;
  if (quality === 'spill') {
    game.items.spawn(defId, 1, Math.floor(pawn.x), Math.floor(pawn.y));
  } else {
    heat = fuelValue(game, pawn, defId, quality);
    L.heat = Math.min(MAX_HEAT, L.heat + heat);
    L.lastFuel = defId;
    L.fuelBurnt[defId] = (L.fuelBurnt[defId] || 0) + 1;
    if (L.heat > OVERFEED_HEAT) {
      quality = 'overfeed';
      L.smokeUntil = game.time.tick + OVERFEED_TICKS;
    }
  }
  pawn.soot = clamp((pawn.soot || 0) + 0.03, 0, 1);
  const x = box.x + 0.5;
  const y = box.y + 0.5;
  game.api.vision.noise(x, y, 6, 'shovel');
  game.api.av.play(quality === 'perfect' ? 'train:thump' : quality === 'spill' ? 'train:spill' : 'train:shovel', { x, y });
  if (quality === 'overfeed') notify(game, game.t('train.note.overfeed'), 'bad', { x, y });
  rt(game).flare = { quality, t0: null };
  invalidateFuel(game);
  game.events.emit(EVENTS.JOURNEY_STOKE, { pawn, x, y, quality, fuel: defId, heat });
  return quality;
}

/** Бросок поселенца: точность 0,55 + добыча/40 (+0,2 у «Сына машиниста»), «в точку» = точность × 0,4, 5% мимо. */
export function colonistThrow(game, pawn, box) {
  if (!carriesFuel(game, pawn)) return null;
  const defId = pawn.carry.defId;
  pawn.carry.count -= 1;
  if (pawn.carry.count <= 0) pawn.carry = null;
  let acc = 0.55 + (Number(game.api.mind.skillLevel(pawn, 'mining')) || 0) / 40;
  if (game.api.mind.hasTrait(pawn, 'son_of_engineer')) acc += 0.2;
  acc = clamp(acc, 0, 1);
  let quality = 'ok';
  if (game.rng.next() < 0.05) quality = 'spill';
  else if (game.rng.next() < acc * 0.4) quality = 'perfect';
  game.api.mind.learn(pawn, 'mining', 3);
  return applyThrow(game, pawn, box, defId, quality);
}

/** Лопата лидера (удержание E): heldMs → качество; «в точку» на глазах у людей → авторитет и мысль «Сам кочегарил». */
export function leaderStoke(game, pawn, heldMs) {
  const L = loco(game);
  if (!L || L.engine !== 'steam' || !pawn) return { ok: false, reason: 'engine' };
  if (!(heldMs >= STOKE.minHold)) return { ok: false, reason: 'short' };
  const box = firebox(game);
  if (!box) return { ok: false, reason: 'nobox' };
  if (!game.api.health.canCarry(pawn)) return { ok: false, reason: 'arm' };
  const defId = takeLeaderFuel(game, pawn);
  if (!defId) return { ok: false, reason: 'nofuel' };
  const want = stokeQuality(heldMs);
  const quality = applyThrow(game, pawn, box, defId, want);
  if (want === 'perfect') leaderSeenStoking(game, pawn);
  return { ok: true, quality, fuel: defId };
}

function leaderSeenStoking(game, leader) {
  const seers = [];
  for (const p of game.colonists()) {
    if (p === leader || p.asleep || p.downed) continue;
    if (Math.hypot(p.x - leader.x, p.y - leader.y) > 12) continue;
    if (!game.api.vision.canPawnSee(p, leader.x, leader.y)) continue;
    seers.push(p);
  }
  if (!seers.length) return;
  for (const p of seers) game.api.mind.addThought(p, 'leader_stoked', { mood: 2, days: 0.5, otherPawnId: leader.id, source: leader });
  const O = ops(game);
  const day = game.time.day;
  if (O.stokeAuth.day !== day) O.stokeAuth = { day, n: 0 };
  if (O.stokeAuth.n < 3) {
    O.stokeAuth.n++;
    game.api.mind.addAuthority(0.2, 'stoked');
  }
}

// ---------------- Мана лидера (канал в рунное ядро) ----------------

function manaOf(game, p) {
  let m = null;
  try {
    m = game.api.combat.getMana(p);
  } catch (err) {
    game.error(err, 'train:getMana');
  }
  if (typeof m === 'number') return m;
  if (m && typeof m === 'object') {
    for (const k of ['mana', 'value', 'cur', 'current']) if (typeof m[k] === 'number') return m[k];
  }
  if (typeof p.mana === 'number') return p.mana;
  if (p.mana && typeof p.mana === 'object') for (const k of ['mana', 'value', 'cur', 'current']) if (typeof p.mana[k] === 'number') return p.mana[k];
  return null;
}

/** Потратить ману лидера (без магической системы — усталость). @returns {boolean} */
export function spendMana(game, p, n) {
  if (typeof game.api.combat.spendMana === 'function') return game.api.combat.spendMana(p, n) !== false;
  if (typeof p.mana === 'number') {
    if (p.mana < n) return false;
    p.mana -= n;
    return true;
  }
  if (p.mana && typeof p.mana === 'object') {
    const k = ['mana', 'value', 'cur', 'current'].find((kk) => typeof p.mana[kk] === 'number');
    if (k) {
      if (p.mana[k] < n) return false;
      p.mana[k] -= n;
      return true;
    }
  }
  const r = p.needs?.rest;
  if (typeof r === 'number') {
    if (r < 0.12) return false;
    p.needs.rest = Math.max(0, r - n * 0.002);
  }
  return true;
}

export function crystalValue(game) {
  return RUNE.crystal * (hasUpgrade(game, 'pylon_coil') ? 1.4 : 1);
}

// ---------------- Регистрация ----------------

export function registerStoking(game) {
  const jobs = game.jobs;

  // Бросок кочегара: замах (~0,7 с) и бросок единицы топлива из рук.
  jobs.registerToil({
    id: 'train:shovel',
    start(game, pawn, toil, job) {
      if (!carriesFuel(game, pawn)) return 'failed';
      toil._t = 0;
      pawn.pose = 'shovel';
      pawn.poseUntil = game.time.tick + 60;
      const box = game.entities.get(job.targetId);
      if (box) pawn.dir = Math.atan2(box.y + 0.5 - pawn.y, box.x + 0.5 - pawn.x);
      return undefined;
    },
    tick(game, pawn, toil, job, dt) {
      const box = game.entities.get(job.targetId);
      if (!box) return 'failed';
      toil._t += dt * 60 * clamp(Number(game.api.health.workSpeedFactor(pawn)) || 1, 0.2, 3);
      if (toil._t < 42) return 'running';
      colonistThrow(game, pawn, box);
      return 'done';
    },
    end(game, pawn) {
      if (pawn.pose === 'shovel') pawn.pose = 'idle';
    },
  }, OWNER);

  jobs.registerJobType({
    id: 'stoke',
    workType: 'stoking',
    labelKey: 'train.job.stoke',
    priority: 60,
    adjacent: true,
    findJob(game, pawn) {
      if (!stokingActive(game)) return null;
      const L = loco(game);
      if (L.heat >= stokeTarget(game)) return null;
      if (!game.api.health.canCarry(pawn)) return null;
      const box = firebox(game);
      if (!box || game.jobs.isReserved(resKey.entity(box.id), pawn)) return null;
      if (Math.hypot(box.x - pawn.x, box.y - pawn.y) > STOKER_RANGE) return null;
      if (!game.pathfinder.canReach(pawn.x, pawn.y, box.x, box.y, true)) return null;
      if (carriesFuel(game, pawn)) return { targetId: box.id, x: box.x, y: box.y, data: { fuelId: 0 } };
      const fuel = findFuelForStoker(game, pawn);
      if (!fuel) return null;
      return { targetId: box.id, x: box.x, y: box.y, data: { fuelId: fuel.id } };
    },
    canDo: (game, pawn) => game.api.health.canCarry(pawn),
    reserve: (game, pawn, job) => [resKey.entity(job.targetId), ...(job.data.fuelId ? [resKey.entity(job.data.fuelId)] : [])],
    makeToils(game, pawn, job) {
      const t = [];
      if (job.data.fuelId) {
        t.push({ type: 'goto', targetId: job.data.fuelId, adjacent: true }, { type: 'pickup', targetId: job.data.fuelId, count: 1 });
      }
      t.push({ type: 'goto', targetId: job.targetId, adjacent: true }, { type: 'train:shovel', targetId: job.targetId });
      return t;
    },
    failIf: (game) => !stokingActive(game),
  }, OWNER);

  // Подноска топлива из тендера/склада в ларь у топки.
  jobs.registerJobType({
    id: 'fill_bunker',
    workType: 'hauling',
    labelKey: 'train.job.fillBunker',
    priority: 58,
    findJob(game, pawn) {
      const L = loco(game);
      if (!L || L.engine !== 'steam' || L.boilerState === 'cracked') return null;
      const tr = game.train;
      const loc = tr?.locomotive;
      if (!loc?.rect) return null;
      const zone = [...game.zones.zones.values()].find((z) => z.data?.bunker && z.data.carId === loc.id);
      if (!zone) return null;
      const stock = fuelStock(game);
      if (stock.bunker >= BUNKER_FILL) return null;
      let src = null;
      let srcD = Infinity;
      for (const car of tr.cars) {
        const r = car.rect;
        if (!r || car === loc) continue;
        for (const it of game.entities.queryRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, 'item')) {
          if (!inRect(r, it.x, it.y) || it.forbidden || !fuelAllowed(game, it.defId)) continue;
          if (game.jobs.isReserved(resKey.entity(it.id), pawn)) continue;
          const d = FUEL_IDS.indexOf(it.defId) * 500 + Math.hypot(it.x - pawn.x, it.y - pawn.y);
          if (d < srcD) {
            srcD = d;
            src = it;
          }
        }
      }
      if (!src || !game.pathfinder.canReach(pawn.x, pawn.y, src.x, src.y, true)) return null;
      const map = game.map;
      let dest = null;
      let destScore = Infinity;
      for (const i of zone.cells) {
        const x = i % map.w;
        const y = (i - x) / map.w;
        if (game.jobs.isReserved(resKey.cell(x, y), pawn)) continue;
        const room = game.items.roomAt(src.defId, x, y);
        if (room <= 0) continue;
        const s = game.items.itemAt(x, y) ? 0 : 1;
        if (s < destScore) {
          destScore = s;
          dest = { x, y, room };
        }
      }
      if (!dest) return null;
      const count = Math.max(1, Math.min(src.count, dest.room, BUNKER_FILL - stock.bunker + 10));
      return { targetId: src.id, x: src.x, y: src.y, data: { dest: { x: dest.x, y: dest.y }, count } };
    },
    reserve: (game, pawn, job) => [resKey.entity(job.targetId), resKey.cell(job.data.dest.x, job.data.dest.y)],
    makeToils(game, pawn, job) {
      const d = job.data.dest;
      return [
        { type: 'goto', targetId: job.targetId, adjacent: true },
        { type: 'pickup', targetId: job.targetId, count: job.data.count },
        { type: 'goto', x: d.x, y: d.y },
        { type: 'drop', x: d.x, y: d.y },
      ];
    },
    onEnd: (game) => invalidateFuel(game),
  }, OWNER);

  // Зарядка рунного ядра кристаллами маны (+8 за кристалл).
  jobs.registerToil({
    id: 'train:charge',
    start(game, pawn, toil) {
      if (pawn.carry?.defId !== 'mana_crystal') return 'failed';
      toil._t = 0;
      return undefined;
    },
    tick(game, pawn, toil, job, dt) {
      const L = loco(game);
      const core = game.entities.get(job.targetId);
      if (!core || L.engine !== 'rune') return 'failed';
      toil._t += dt * 60;
      if (toil._t < 24) return 'running';
      toil._t = 0;
      if (pawn.carry?.defId !== 'mana_crystal' || L.battery >= 100) return 'done';
      pawn.carry.count -= 1;
      if (pawn.carry.count <= 0) pawn.carry = null;
      L.battery = Math.min(100, L.battery + crystalValue(game));
      L.fuelBurnt.mana_crystal = (L.fuelBurnt.mana_crystal || 0) + 1;
      invalidateFuel(game);
      game.api.av.play('train:charge', { x: core.x + 1, y: core.y + 1 });
      game.events.emit('train:charged', { pawn, battery: L.battery, source: 'crystal' });
      return pawn.carry && L.battery < 100 ? 'running' : 'done';
    },
  }, OWNER);

  jobs.registerJobType({
    id: 'charge_core',
    workType: 'hauling',
    labelKey: 'train.job.charge',
    priority: 59,
    adjacent: true,
    findJob(game, pawn) {
      const L = loco(game);
      if (!L || L.engine !== 'rune' || !L.autoCharge) return null;
      if (L.battery >= RUNE.chargeUntil) {
        L.charging = false;
        return null;
      }
      if (!L.charging && L.battery >= RUNE.chargeBelow) return null;
      L.charging = true;
      const core = runeCore(game);
      if (!core || game.jobs.isReserved(resKey.entity(core.id), pawn)) return null;
      const it = game.items.findNearest(pawn, (i) => i.defId === 'mana_crystal', { maxDist: 90 });
      if (!it) return null;
      const need = Math.ceil((100 - L.battery) / crystalValue(game));
      return { targetId: core.id, x: core.x, y: core.y, data: { itemId: it.id, count: Math.max(1, Math.min(need, 5, it.count)) } };
    },
    reserve: (game, pawn, job) => [resKey.entity(job.targetId), resKey.entity(job.data.itemId)],
    makeToils(game, pawn, job) {
      return [
        { type: 'goto', targetId: job.data.itemId, adjacent: true },
        { type: 'pickup', targetId: job.data.itemId, count: job.data.count },
        { type: 'goto', targetId: job.targetId, adjacent: true },
        { type: 'train:charge', targetId: job.targetId },
      ];
    },
  }, OWNER);

  // Ремонт треснувшего котла: 20 металла или 6 деталей, 2 игровых часа работы.
  jobs.registerJobType({
    id: 'repair_boiler',
    workType: 'construction',
    labelKey: 'train.job.repairBoiler',
    priority: 75,
    adjacent: true,
    findJob(game, pawn) {
      const L = loco(game);
      if (!L || L.engine !== 'steam' || L.boilerState !== 'cracked') return null;
      if (!affordableRepairCost(game)) return null;
      const box = boilerEntity(game) || firebox(game);
      if (!box || game.jobs.isReserved(resKey.entity(box.id), pawn)) return null;
      if (!game.pathfinder.canReach(pawn.x, pawn.y, box.x, box.y, true, box.w || 1, box.h || 1)) return null;
      return { targetId: box.id, x: box.x, y: box.y };
    },
    canDo: (game) => loco(game)?.boilerState === 'cracked' && !!affordableRepairCost(game),
    makeToils(game, pawn, job) {
      return [
        { type: 'goto', targetId: job.targetId, adjacent: true },
        {
          type: 'work', ticks: 1200, workType: 'construction', targetId: job.targetId, fx: 'mine',
          onDone(game, p) {
            const cost = affordableRepairCost(game);
            const t = game.entities.get(job.targetId);
            if (!cost || !game.api.economy.consume(cost, t?.x ?? p.x, t?.y ?? p.y)) return 'failed';
            repairBoiler(game);
            game.api.mind.learn(p, 'construction', 20);
            return undefined;
          },
        },
      ];
    },
  }, OWNER);

  registerInteractions(game);
}

function costText(game, cost) {
  return Object.entries(cost).map(([id, n]) => `${n} ${game.t(game.defs.items.get(id)?.nameKey || id)}`).join(', ');
}

function registerInteractions(game) {
  const I = game.defs.interactions;
  const near = (p, b) => dist(p.x, p.y, b.x + (b.w || 1) / 2, b.y + (b.h || 1) / 2) <= REACH + Math.max(b.w || 1, b.h || 1) / 2 - 0.5;

  // Лопата лидера у топки: удерживать E (замах) и отпустить, когда пульсирует «окно жара».
  I.add({
    id: 'journey:stoke',
    order: 6,
    find(game, pawn, tx, ty) {
      const b = game.map.buildingAt(tx, ty);
      if (!b || b.defId !== 'firebox') return null;
      const L = loco(game);
      if (!L || L.engine !== 'steam' || L.boilerState === 'cracked' || !near(pawn, b)) return null;
      if (!game.api.health.canCarry(pawn)) {
        return { label: game.t('train.act.armHurt'), x: b.x, y: b.y, run: (g) => g.audio.play('error') };
      }
      const src = leaderFuelSource(game, pawn);
      if (!src) {
        return {
          label: game.t('train.act.noFuel'), x: b.x, y: b.y,
          run: (g) => {
            g.audio.play('error');
            notify(g, g.t('train.note.noFuelNear'), 'info');
          },
        };
      }
      const name = game.t(game.defs.items.get(src.defId)?.nameKey || src.defId);
      return {
        label: game.t('train.act.stoke', { fuel: name }),
        hold: true,
        x: b.x,
        y: b.y,
        onHoldStart(g, p) {
          rt(g).hold = { kind: 'stoke', ms: 0, boxId: b.id };
          p.pose = 'shovel';
          p.poseUntil = 0;
          g.audio.play('train:shovel', { x: b.x, y: b.y, vol: 0.4 });
        },
        onHoldTick(g, p, heldMs) {
          const h = rt(g).hold;
          if (h) h.ms = heldMs;
        },
        onRelease(g, p, heldMs) {
          rt(g).hold = null;
          if (p.pose === 'shovel') p.pose = 'idle';
          const res = leaderStoke(g, p, heldMs);
          if (!res.ok && res.reason === 'short') {
            const R = rt(g);
            if (R.hintCooldown <= 0) notify(g, g.t('train.note.stokeHow'), 'info');
            R.hintCooldown = 10;
          }
        },
      };
    },
  }, OWNER);

  // Рунное ядро: лидер канализирует ману (удержание E): 1 мана → 0,5 заряда.
  I.add({
    id: 'train:channel',
    order: 6,
    find(game, pawn, tx, ty) {
      const b = game.map.buildingAt(tx, ty);
      if (!b || !RUNE_CORE_IDS.includes(b.defId) || !b.train) return null;
      const L = loco(game);
      if (!L || L.engine !== 'rune' || !near(pawn, b)) return null;
      if (L.battery >= 99.5) return { label: game.t('train.act.coreFull'), x: b.x, y: b.y, run: (g) => g.audio.play('error') };
      return {
        label: game.t('train.act.channel'),
        hold: true,
        x: b.x,
        y: b.y,
        onHoldStart(g, p) {
          rt(g).hold = { kind: 'channel', ms: 0, acc: 0, boxId: b.id };
          p.pose = 'idle';
        },
        onHoldTick(g, p, heldMs, dtReal) {
          const h = rt(g).hold;
          if (!h) return;
          h.ms = heldMs;
          h.acc += (Number.isFinite(dtReal) ? dtReal : 0) * 1000;
          const Lc = loco(g);
          while (h.acc >= 250) {
            h.acc -= 250;
            if (Lc.battery >= 100) break;
            if (!spendMana(g, p, 2)) {
              h.dry = true;
              break;
            }
            Lc.battery = Math.min(100, Lc.battery + 2 * RUNE.manaToBattery);
            g.events.emit('train:charged', { pawn: p, battery: Lc.battery, source: 'mana' });
          }
        },
        onRelease(g) {
          const h = rt(g).hold;
          rt(g).hold = null;
          if (h?.dry) notify(g, g.t('train.note.noMana'), 'info');
        },
      };
    },
  }, OWNER);

  // Треснувший котёл: E — чинить самому.
  I.add({
    id: 'train:repair',
    order: 7,
    find(game, pawn, tx, ty) {
      const b = game.map.buildingAt(tx, ty);
      if (!b || (b.defId !== 'steam_boiler' && b.defId !== 'firebox')) return null;
      const L = loco(game);
      if (!L || L.boilerState !== 'cracked' || !near(pawn, b)) return null;
      const cost = affordableRepairCost(game);
      if (!cost) {
        const need = repairCosts(game).map((c) => costText(game, c)).join(game.t('train.or'));
        return { label: game.t('train.act.repairNeed', { cost: need }), x: b.x, y: b.y, run: (g) => g.audio.play('error') };
      }
      return {
        label: game.t('train.act.repair', { cost: costText(game, cost) }),
        x: b.x,
        y: b.y,
        run(g, p) {
          const target = boilerEntity(g) || b;
          if (!g.jobs.startManual(p, 'repair_boiler', { targetId: target.id, x: target.x, y: target.y })) g.audio.play('error');
        },
      };
    },
  }, OWNER);

  // Пульт машиниста: E — панель поезда.
  I.add({
    id: 'train:panel',
    order: 40,
    find(game, pawn, tx, ty) {
      const b = game.map.buildingAt(tx, ty);
      if (!b || b.defId !== 'cab_panel' || !isInLoco(game, pawn)) return null;
      return { label: game.t('train.act.panel'), x: b.x, y: b.y, run: (g) => g.ui.openPanel('train') };
    },
  }, OWNER);
}
