// Оборона: рунная турель (заряды — кристаллы маны), шипы, огненная ловушка, тюремная койка;
// огонь построек (поджог, распространение), обереги вагонов (заклинание «Оберег вагона»).
import { dist, hash01 } from '../../core/math.js';
import { resKey } from '../../sim/jobs.js';
import { dealDamage, damageBuilding, explode, spawnProjectile, shotLine, pickPart, isHostile } from './fight.js';
import { secs } from './state.js';

export const AMMO_PER_CRYSTAL = 10;

export const BUILDING_DEFS = [
  {
    id: 'rune_turret', nameKey: 'combat.bld.rune_turret', descKey: 'combat.bld.rune_turret_desc', size: [1, 1], passable: false, hp: 160,
    materials: { stone: 25, mana_crystal: 8 }, workToBuild: 900, category: 'security', placeableOn: 'both', color: '#5ef2ff',
    cover: 0.6, turret: { range: 12, cooldown: 1.1, damage: 14, type: 'rune', ammoMax: 60 },
    light: { radius: 2.5, color: '#5ef2ff', intensity: 0.5 },
  },
  {
    id: 'spike_trap', nameKey: 'combat.bld.spike_trap', descKey: 'combat.bld.spike_trap_desc', size: [1, 1], passable: true, pathCost: 1.5, hp: 60,
    materials: { wood: 12, iron_ore: 4 }, workToBuild: 400, category: 'security', placeableOn: 'ground', color: '#c9b8ff',
    trap: { kind: 'spike', damage: 20, type: 'stab', rearm: 5 },
  },
  {
    id: 'fire_trap', nameKey: 'combat.bld.fire_trap', descKey: 'combat.bld.fire_trap_desc', size: [1, 1], passable: true, pathCost: 1.5, hp: 60,
    materials: { wood: 6, mana_crystal: 3 }, workToBuild: 450, category: 'security', placeableOn: 'ground', color: '#ff9f43',
    trap: { kind: 'fire', damage: 16, type: 'burn', rearm: 30, r: 1.7 },
  },
  {
    id: 'prisoner_bed', nameKey: 'combat.bld.prisoner_bed', descKey: 'combat.bld.prisoner_bed_desc', size: [1, 1], passable: true, hp: 80,
    materials: { wood: 25, iron_ore: 2 }, workToBuild: 500, category: 'security', placeableOn: 'both', color: '#ffb347', prisonerBed: true,
  },
];

export function registerBuildings(game, C, drawers) {
  for (const d of BUILDING_DEFS) {
    if (game.defs.buildings.has(d.id)) continue;
    game.defs.buildings.add({ ...d, ...(drawers[d.id] || {}) }, 'combat');
  }
  // турели заряжает носильщик: кристаллы маны → заряды
  game.jobs.registerJobType({
    id: 'combat:loadTurret',
    workType: 'hauling',
    labelKey: 'combat.job.loadTurret',
    priority: 60,
    reserve: (g, p, job) => [resKey.entity(job.targetId), resKey.entity(job.data.itemId)],
    findJob(g, p) {
      if (!C.R.turretIds?.size) return null;
      let best = null;
      let bd = 1e9;
      for (const id of C.R.turretIds) {
        const b = g.entities.get(id);
        const def = b && g.defs.buildings.get(b.defId);
        if (!def?.turret || b.blueprint) continue;
        if ((b.ammo || 0) > def.turret.ammoMax * 0.4) continue;
        if (g.jobs.isReserved(resKey.entity(b.id), p)) continue;
        const d = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (!best) return null;
      const it = g.items.findNearest(p, (item) => item.defId === 'mana_crystal', { maxDist: 80 });
      if (!it) return null;
      const need = Math.ceil((g.defs.buildings.get(best.defId).turret.ammoMax - (best.ammo || 0)) / AMMO_PER_CRYSTAL);
      return { targetId: best.id, x: best.x, y: best.y, data: { itemId: it.id, count: Math.max(1, Math.min(need, it.count)) } };
    },
    makeToils: (g, p, job) => [
      { type: 'goto', targetId: job.data.itemId, adjacent: true },
      { type: 'pickup', targetId: job.data.itemId, count: job.data.count },
      { type: 'goto', targetId: job.targetId, adjacent: true },
      {
        type: 'interact',
        fn(g2, pawn, j) {
          const b = g2.entities.get(j.targetId);
          const c = pawn.carry;
          if (!b || !c || c.defId !== 'mana_crystal') return 'failed';
          const def = g2.defs.buildings.get(b.defId);
          b.ammo = Math.min(def.turret.ammoMax, (b.ammo || 0) + c.count * AMMO_PER_CRYSTAL);
          pawn.carry = null;
          C.sfx('magic', b.x + 0.5, b.y + 0.5);
          return 'done';
        },
      },
    ],
  }, 'combat');
}

/** Учёт построек обороны (на spawn/remove/load). */
export function trackBuilding(game, C, b, added) {
  const def = game.defs.buildings.get(b.defId);
  if (!def) return;
  const R = C.R;
  R.turretIds ||= new Set();
  R.trapIds ||= new Set();
  R.burningIds ||= new Set();
  if (def.turret) {
    if (added) {
      R.turretIds.add(b.id);
      b.ammo ??= Math.round(def.turret.ammoMax * 0.5);
    } else R.turretIds.delete(b.id);
  }
  if (def.trap) {
    if (added) R.trapIds.add(b.id);
    else R.trapIds.delete(b.id);
  }
  if (added && b.burnUntil > game.time.tick) R.burningIds.add(b.id);
  if (!added) R.burningIds.delete(b.id);
}

export function rebuildTracking(game, C) {
  C.R.turretIds = new Set();
  C.R.trapIds = new Set();
  C.R.burningIds = new Set();
  for (const b of game.entities.ofKind('building')) trackBuilding(game, C, b, true);
}

// ---------------- Огонь ----------------
export function installFire(game, C) {
  C.ignite = (b, source) => {
    if (!b || b.removed || b.blueprint) return false;
    const def = game.defs.buildings.get(b.defId);
    if (!def || def.indestructible || def.natural || b.train) return false;
    const now = game.time.tick;
    if (b.burnUntil > now) return false;
    b.burnUntil = now + secs(18 + (b.id % 7));
    (C.R.burningIds ||= new Set()).add(b.id);
    game.events.emit('combat:fire', { entity: b, source: source || null });
    game.api.vision.report(game.t('combat.fire.started', { name: game.t(def.nameKey) }), { type: 'danger', x: b.x, y: b.y });
    return true;
  };
  /** Цель поджигателя: ближайшая постройка колонии (не поезд, не природная, не горящая). */
  C.arsonTarget = (p) => {
    let best = null;
    let bd = 30 * 30;
    const now = game.time.tick;
    for (const b of game.entities.queryRadius(p.x, p.y, 30, 'building')) {
      if (b.train || b.blueprint || b.burnUntil > now) continue;
      const def = game.defs.buildings.get(b.defId);
      if (!def || def.natural || def.indestructible || def.trap) continue;
      const d = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  };
}

export function updateFire(game, C) {
  const ids = C.R.burningIds;
  if (!ids?.size) return;
  const now = game.time.tick;
  for (const id of [...ids]) {
    const b = game.entities.get(id);
    if (!b || b.removed) {
      ids.delete(id);
      continue;
    }
    if (!(b.burnUntil > now)) {
      ids.delete(id);
      b.burnUntil = 0;
      b.scorched = true;
      continue;
    }
    damageBuilding(game, C, b, 4, null);
    if (b.removed) continue;
    if (!game.isHeadless) {
      game.fx.preset('embers', b.x + 0.5, b.y + 0.5, { count: 3, color: '#ff9f43' });
      if (hash01(b.id, now, 3) < 0.3) game.fx.preset('smoke', b.x + 0.5, b.y + 0.3, {});
    }
    // распространение
    if (hash01(b.id, now, 7) < 0.06) {
      const nb = game.map.buildingAt(b.x + (hash01(b.id, now, 1) < 0.5 ? -1 : (b.w || 1)), b.y + Math.floor(hash01(b.id, now, 2) * (b.h || 1)));
      if (nb && nb !== b) C.ignite(nb, null);
    }
    // обжигает стоящих рядом
    for (const p of game.entities.queryRadius(b.x + 0.5, b.y + 0.5, 1.2, 'pawn')) {
      if (!p.dead) p.burnUntil = Math.max(p.burnUntil || 0, now + secs(2));
    }
  }
}

// ---------------- Ловушки ----------------
export function updateTraps(game, C) {
  const ids = C.R.trapIds;
  if (!ids?.size || !C.R.hostiles) return;
  const now = game.time.tick;
  for (const id of ids) {
    const b = game.entities.get(id);
    if (!b || b.blueprint || b.armedAt > now) continue;
    const def = game.defs.buildings.get(b.defId);
    const tr = def?.trap;
    if (!tr) continue;
    let victim = null;
    for (const e of C.R.enemies) {
      if (e.flying || e.stationary) continue;
      if (Math.floor(e.x) === b.x && Math.floor(e.y) === b.y) {
        victim = e;
        break;
      }
    }
    if (!victim) continue;
    b.armedAt = now + secs(tr.rearm);
    if (tr.kind === 'spike') {
      dealDamage(game, C, victim, tr.damage, { type: tr.type, part: pickPart(game, 'legs'), source: null, avg: tr.damage * 0.7, angle: -Math.PI / 2 });
      victim.chill ||= { base: victim.speed, untilTick: 0 };
      victim.chill.untilTick = Math.max(victim.chill.untilTick, now + secs(3));
      victim.speed = victim.chill.base * 0.5;
      C.vfx('spikes', { x: b.x + 0.5, y: b.y + 0.5 });
      C.sfx('combat:spike', b.x + 0.5, b.y + 0.5);
      game.api.vision.noise(b.x + 0.5, b.y + 0.5, 8, 'clash');
    } else {
      explode(game, C, b.x + 0.5, b.y + 0.5, { r: tr.r || 1.6, dmg: tr.damage, type: 'burn', burn: 4, friendly: 0, color: '#ff9f43', shake: 3 }, { faction: 'colony', kind: 'trap' });
    }
    game.events.emit('combat:trapTriggered', { entity: b, victim });
  }
}

// ---------------- Турели ----------------
export function updateTurrets(game, C) {
  const ids = C.R.turretIds;
  if (!ids?.size || !C.R.hostiles) return;
  const now = game.time.tick;
  const rng = game.rng;
  for (const id of ids) {
    const b = game.entities.get(id);
    if (!b || b.blueprint || !(b.ammo > 0) || b.nextShot > now) continue;
    const def = game.defs.buildings.get(b.defId);
    const tu = def?.turret;
    if (!tu) continue;
    const cx = b.x + 0.5;
    const cy = b.y + 0.5;
    let best = null;
    let bd = tu.range * tu.range;
    for (const e of C.R.enemies) {
      const d2 = (e.x - cx) ** 2 + (e.y - cy) ** 2;
      if (d2 < bd && isHostile(e, b)) {
        bd = d2;
        best = e;
      }
    }
    if (!best) continue;
    if (shotLine(game, cx, cy, best.x, best.y) < 0) {
      b.nextShot = now + 30;
      continue;
    }
    b.ammo--;
    b.nextShot = now + secs(tu.cooldown);
    b.aim = Math.atan2(best.y - cy, best.x - cx);
    const hit = rng.next() < 0.78 * (best.boss ? 1.15 : 1);
    const dmg = tu.damage * rng.range(0.85, 1.15);
    const spec = { sourceId: b.id, faction: 'colony', style: 'rune', speed: 30, type: tu.type, dmg, avg: tu.damage, part: pickPart(game), range: tu.range + 2, turret: true };
    if (hit) {
      spec.mode = 'hit';
      spec.targetId = best.id;
      spawnProjectile(game, C, cx, cy, best.x, best.y, spec);
    } else {
      spec.mode = 'miss';
      const a = b.aim + (rng.chance(0.5) ? 0.12 : -0.12);
      spawnProjectile(game, C, cx, cy, cx + Math.cos(a) * spec.range, cy + Math.sin(a) * spec.range, spec);
    }
    game.api.vision.noise(cx, cy, 15, 'shot');
    C.sfx('combat:rune_shot', cx, cy);
    if (b.ammo === 0) game.api.vision.report(game.t('combat.turret.empty'), { type: 'bad', x: b.x, y: b.y });
  }
}

// ---------------- Обереги вагонов ----------------
export function installWards(game, C) {
  C.wardAt = (tx, ty) => {
    const W = C.S.wards;
    if (!W.length) return false;
    const car = game.train?.carAt?.(tx, ty);
    if (!car) return false;
    const now = game.time.tick;
    return W.some((w) => w.carId === car.id && w.untilTick > now);
  };
}

export function updateWards(game, C) {
  const W = C.S.wards;
  if (!W.length) return;
  const now = game.time.tick;
  for (let i = W.length - 1; i >= 0; i--) if (W[i].untilTick <= now) W.splice(i, 1);
}

export { dist };
