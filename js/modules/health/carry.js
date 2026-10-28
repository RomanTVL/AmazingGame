// Переноска: раненого (упавшего) или тело. Состояние — JSON на сущностях:
//   несущий: carryPawnId (пешка) | carryCorpseId (труп), pose 'carry'; ноша: carriedById, pose 'carried'.
// Задача 'rescue' (ИИ), приказ vision 'carry_wounded' и E лидера пользуются одним и тем же состоянием.
import { stopMoving } from '../../sim/pawn.js';
import { armBroken } from './model.js';

const safe = (fn, d = null) => {
  try {
    const v = fn();
    return v === undefined ? d : v;
  } catch {
    return d;
  }
};

/** Что несёт пешка: {kind: 'pawn'|'corpse', entity} | null. */
export function carriedOf(game, carrier) {
  if (!carrier) return null;
  if (carrier.carryPawnId) {
    const e = game.entities.get(carrier.carryPawnId);
    if (e && !e.removed) return { kind: 'pawn', entity: e };
  }
  if (carrier.carryCorpseId) {
    const e = game.entities.get(carrier.carryCorpseId);
    if (e && !e.removed) return { kind: 'corpse', entity: e };
  }
  return null;
}

export const isCarrying = (pawn) => !!(pawn && (pawn.carryPawnId || pawn.carryCorpseId));

/** Может ли пешка нести другого (жива, на ногах, руки целы, ничего не несёт). */
export function canCarry(game, pawn) {
  if (!pawn || pawn.dead || pawn.removed || pawn.downed || pawn.dying) return false;
  if (pawn.kind && pawn.kind !== 'pawn') return false;
  if (isCarrying(pawn)) return false;
  return !armBroken(game, pawn);
}

/** Можно ли поднять эту цель. */
export function canBeCarried(game, target) {
  if (!target || target.removed) return false;
  if (target.kind === 'corpse') return !target.carriedById && !target.buried;
  if (target.kind !== 'pawn' || target.dead) return false;
  if (target.boss || target.stationary || target.flying) return false;
  return !!target.downed && !target.carriedById;
}

/** Поднять ношу. @returns {boolean} */
export function startCarry(H, carrier, target) {
  const game = H.game;
  if (!canCarry(game, carrier) || !canBeCarried(game, target)) return false;
  if (carrier.carry) game.items.dropCarried(carrier);
  if (target.kind === 'pawn') {
    if (target.job) game.jobs.endJob(target, 'cancelled');
    stopMoving(target);
    carrier.carryPawnId = target.id;
    target.carriedById = carrier.id;
    target.pose = 'carried';
    target.poseUntil = 0;
    target.inBedId = 0;
  } else {
    carrier.carryCorpseId = target.id;
    target.carriedById = carrier.id;
    target._trail = 0;
  }
  carrier.pose = 'carry';
  carrier.poseUntil = 0;
  H.rt.carriers.add(carrier.id);
  game.events.emit('health:carryStarted', { carrier, target });
  return true;
}

/** Свободна ли клетка для того, чтобы положить ношу. */
function freeSpot(game, x, y) {
  const map = game.map;
  return map.inBounds(x, y) && map.isPassable(x, y);
}

/** Свободная кровать рядом (или в клетке). */
export function bedNear(H, x, y, r = 1.6) {
  const game = H.game;
  let best = null;
  let bestD = Infinity;
  for (const b of game.entities.queryRadius(x, y, r + 1.5, 'building')) {
    const def = game.defs.buildings.get(b.defId);
    if (!def?.bed || b.blueprint) continue;
    if (H.bedTaken(b)) continue;
    const d = Math.hypot(b.x + 0.5 - x, b.y + 0.5 - y);
    if (d <= r + 1 && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/**
 * Положить ношу. opts: {reason, x, y, bedId}. Без координат — под ноги (или в соседнюю свободную кровать).
 * @returns {object|null} то, что положили
 */
export function dropCarry(H, carrier, opts = {}) {
  const game = H.game;
  const c = carriedOf(game, carrier);
  carrier.carryPawnId = 0;
  carrier.carryCorpseId = 0;
  if (carrier.pose === 'carry') carrier.pose = 'idle';
  H.rt.carriers.delete(carrier.id);
  if (!c) return null;
  const t = c.entity;
  let x = Number.isFinite(opts.x) ? opts.x : Math.floor(carrier.x);
  let y = Number.isFinite(opts.y) ? opts.y : Math.floor(carrier.y);
  let bed = opts.bedId ? game.entities.get(opts.bedId) : null;
  if (!bed && opts.findBed !== false && c.kind === 'pawn' && opts.reason !== 'hit' && opts.reason !== 'downed') bed = bedNear(H, carrier.x, carrier.y);
  if (bed) {
    x = bed.x;
    y = bed.y;
  }
  if (!freeSpot(game, x, y) && game.map) {
    const fx = Math.floor(carrier.x);
    const fy = Math.floor(carrier.y);
    if (freeSpot(game, fx, fy)) {
      x = fx;
      y = fy;
    }
  }
  t.carriedById = 0;
  if (c.kind === 'pawn') {
    game.entities.setPosition(t, x + 0.5, y + 0.5);
    t.pose = t.dying ? 'dying' : 'idle';
    t.inBedId = bed ? bed.id : 0;
    if (bed) game.events.emit('health:inBed', { pawn: t, bed });
  } else {
    game.entities.setPosition(t, x, y);
  }
  game.events.emit('health:carryEnded', { carrier, target: t, reason: opts.reason || 'put', bed: bed || null });
  if (opts.reason === 'hit' && !game.isHeadless) safe(() => game.api.av.floatText(carrier.x, carrier.y - 0.8, game.t('health.carry.dropped'), '#ff5f6d'));
  return t;
}

/** Тик переноски (после движения): ноша следует за несущим; кровавый след за телом. */
export function updateCarry(H) {
  const game = H.game;
  if (!H.rt.carriers.size) return;
  for (const id of H.rt.carriers) {
    const carrier = game.entities.get(id);
    if (!carrier || carrier.dead || carrier.removed) {
      H.rt.carriers.delete(id);
      releaseOrphans(H, id);
      continue;
    }
    if (carrier.downed) {
      dropCarry(H, carrier, { reason: 'downed' });
      continue;
    }
    const c = carriedOf(game, carrier);
    if (!c) {
      carrier.carryPawnId = 0;
      carrier.carryCorpseId = 0;
      if (carrier.pose === 'carry') carrier.pose = 'idle';
      H.rt.carriers.delete(id);
      continue;
    }
    const t = c.entity;
    if (c.kind === 'pawn') {
      if (t.dead || !t.downed) {
        dropCarry(H, carrier, { reason: 'recovered', findBed: false });
        continue;
      }
      t.x = carrier.x;
      t.y = carrier.y + 0.02;
      t.dir = carrier.dir;
      game.entities.moved(t);
    } else {
      const tx = Math.floor(carrier.x);
      const ty = Math.floor(carrier.y);
      if (tx !== t.x || ty !== t.y) {
        const ox = t.x;
        const oy = t.y;
        game.entities.setPosition(t, tx, ty);
        t._trail = (t._trail || 0) + 1;
        if (t._trail >= 2 && (t.rot ?? 0) < 0.8 && !t.noBlood) {
          t._trail = 0;
          bloodTrail(H, ox, oy);
        }
      }
    }
  }
}

/** Ноша, чей несущий исчез (смерть/загрузка): отпустить. */
function releaseOrphans(H, carrierId) {
  const game = H.game;
  for (const p of game.entities.ofKind('pawn')) {
    if (p.carriedById === carrierId) {
      p.carriedById = 0;
      p.pose = p.dying ? 'dying' : 'idle';
    }
  }
  for (const c of game.entities.ofKind('corpse')) if (c.carriedById === carrierId) c.carriedById = 0;
}

function bloodTrail(H, x, y) {
  const game = H.game;
  const fx = game.api.av?.effect;
  if (typeof fx === 'function' && game.providers.av?.effect) {
    safe(() => fx('blood_trail', { x: x + 0.5, y: y + 0.5 }));
    return;
  }
  if (H.rt.trailCount > 60) return;
  H.rt.trailCount++;
  const rng = game.rng;
  game.entities.spawn('decal', {
    x, y, color: '#5a0716', alpha: 0.32, r: 3 + rng.next() * 2.5, ox: rng.range(-6, 6), oy: rng.range(-6, 6), a: rng.range(0, 3), health: true, bornTick: game.time.tick,
  });
}

/** Пересобрать список несущих (загрузка, смена стоянки) и починить висящие ссылки. */
export function rebuildCarriers(H, opts = {}) {
  const game = H.game;
  H.rt.carriers.clear();
  H.rt.trailCount = 0;
  for (const d of game.entities.ofKind('decal')) if (d.health) H.rt.trailCount++;
  for (const p of game.entities.ofKind('pawn')) {
    if (!p.carryPawnId && !p.carryCorpseId) continue;
    if (opts.dropAll) {
      H.rt.carriers.add(p.id);
      dropCarry(H, p, { reason: 'station', findBed: false });
      continue;
    }
    if (carriedOf(game, p)) H.rt.carriers.add(p.id);
    else {
      p.carryPawnId = 0;
      p.carryCorpseId = 0;
      if (p.pose === 'carry') p.pose = 'idle';
    }
  }
  for (const p of game.entities.ofKind('pawn')) {
    if (!p.carriedById) continue;
    const c = game.entities.get(p.carriedById);
    if (!c || c.carryPawnId !== p.id) {
      p.carriedById = 0;
      if (p.pose === 'carried') p.pose = p.dying ? 'dying' : 'idle';
    }
  }
  for (const k of game.entities.ofKind('corpse')) {
    if (!k.carriedById) continue;
    const c = game.entities.get(k.carriedById);
    if (!c || c.carryCorpseId !== k.id) k.carriedById = 0;
  }
}

/** Множитель скорости несущего. */
export function carrySpeedMul(pawn) {
  if (pawn.carryPawnId) return 0.6;
  if (pawn.carryCorpseId) return 0.4;
  return 1;
}
