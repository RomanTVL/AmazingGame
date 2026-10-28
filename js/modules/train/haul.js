// Подноска топлива в тендер: когда в тендере мало (< FUEL_LOW), поселенцы в первую очередь (выше обычной работы)
// носят добытый уголь (а при нужде — дрова) в тендер. Обычная переноска ядра (haul) — в самом конце списка работ.
import { resKey } from '../../sim/jobs.js';
import { fuelUnits, FUEL_LOW } from './fuel.js';

const MAX_HAULERS = 2;
const WOOD_BELOW = 30; // дрова — только когда угля совсем мало

function tenderCell(game, defId) {
  const tr = game.train;
  const tender = tr?.carOfType('tender');
  if (!tender?.rect) return null;
  let empty = null;
  for (const c of tr.interior(tender)) {
    if (!game.map.isPassable(c.x, c.y) || game.map.buildingAt(c.x, c.y)) continue;
    if (game.jobs.isReserved(resKey.cell(c.x, c.y))) continue;
    const it = game.items.itemAt(c.x, c.y);
    if (it && it.defId === defId && game.items.roomAt(defId, c.x, c.y) > 0) return c;
    if (!it && !empty) empty = c;
  }
  return empty;
}

export function registerFuelHauling(game) {
  game.jobs.registerJobType({
    id: 'train:haulFuel',
    workType: null,
    labelKey: 'train.job.haulFuel',
    priority: 55,
    reserve(g, pawn, job) {
      return [resKey.entity(job.targetId), resKey.cell(job.data.dest.x, job.data.dest.y)];
    },
    makeToils(g, pawn, job) {
      const d = job.data.dest;
      return [
        { type: 'goto', targetId: job.targetId, adjacent: true },
        { type: 'pickup', targetId: job.targetId, count: job.data.count },
        { type: 'goto', x: d.x, y: d.y },
        { type: 'drop', x: d.x, y: d.y },
      ];
    },
  }, 'train');

  const R = { tick: -1e9, fuel: 0 };
  game.events.on('world:reset', () => {
    R.tick = -1e9;
  }, 'train');
  game.ai.registerThinkNode({
    id: 'train:fuel',
    priority: 52, // выше обычной работы (50), ниже еды/сна
    factions: ['colony'],
    evaluate(g, pawn) {
      const tr = g.train;
      if (!tr?.stamped || pawn.isLeader || pawn.downed || pawn.drafted || pawn.prisoner || tr.ops?.boarding) return null;
      if (typeof g.api.journey.isTravelling === 'function' && g.api.journey.isTravelling()) return null;
      if (typeof g.api.train.usesFuel === 'function' && !g.api.train.usesFuel()) return null;
      if (g.time.tick - R.tick >= 60) {
        R.tick = g.time.tick;
        R.fuel = fuelUnits(g);
      }
      if (R.fuel >= FUEL_LOW) return null;
      let busy = 0;
      for (const p of g.colonists()) if (p.job?.type === 'train:haulFuel') busy++;
      if (busy >= MAX_HAULERS) return null;
      const cands = [];
      for (const it of g.entities.ofKind('item')) {
        if (it.forbidden || it.removed) continue;
        if (it.defId !== 'coal' && !(it.defId === 'wood' && R.fuel < WOOD_BELOW)) continue;
        const car = tr.carAt(Math.floor(it.x), Math.floor(it.y));
        if (car && (car.type === 'tender' || car.type === 'locomotive')) continue;
        if (g.jobs.isReserved(resKey.entity(it.id), pawn)) continue;
        cands.push({ it, d: (it.x - pawn.x) ** 2 + (it.y - pawn.y) ** 2 + (it.defId === 'wood' ? 1e4 : 0) });
      }
      if (!cands.length) return null;
      cands.sort((a, b) => a.d - b.d);
      for (let i = 0; i < Math.min(cands.length, 8); i++) {
        const it = cands[i].it;
        if (!g.pathfinder.canReach(pawn.x, pawn.y, it.x, it.y, true)) continue;
        const dest = tenderCell(g, it.defId);
        if (!dest) return null;
        const room = g.items.roomAt(it.defId, dest.x, dest.y);
        const count = Math.min(room, it.count);
        if (count <= 0) continue;
        return g.jobs.createJob('train:haulFuel', pawn, { targetId: it.id, x: it.x, y: it.y, data: { dest: { x: dest.x, y: dest.y }, count } });
      }
      return null;
    },
  }, 'train');
}
