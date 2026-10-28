// ИИ боя: единая задача 'combat:fight' (шаг 'combat:fight') с режимами
//   raider — враг рейда (подход, атака, поджог, грабёж, отход), boss — сценарий босса (bosses.js),
//   defend — вооружённый поселенец отбивается сам, arms — призван («К оружию!» R / F): строй за лидером и его цель,
//   horn — двойной гудок: пост у двери/окна, стрельба из окон, puppet — марионетка Лича, nameless — зов Сердца Гнили.
// + узлы мышления, подбор оружия/брони, призыв/отпуск.
import { dist, clamp } from '../../core/math.js';
import { moveTo, stopMoving } from '../../sim/pawn.js';
import { TRAIN_ROOM_BASE } from '../../sim/train.js';
import { weaponStats, isArmed, equipItem, hasStaff } from './items.js';
import { raidOf, FACTIONS, isActiveFoe } from './enemies.js';
import { center, isHostile, shotLine, attackReady, setCooldown, meleeStrike, fireAtTarget, hpRatio, skillLevel, isHealthStub } from './fight.js';
import { secs } from './state.js';

// ---------------- Кэш списков (раз в тик) ----------------
export function refreshLists(game, C) {
  const R = C.R;
  const col = R.colony;
  const en = R.enemies;
  col.length = 0;
  en.length = 0;
  let downedE = 0;
  let prisoners = 0;
  let nameless = 0;
  for (const p of game.entities.ofKind('pawn')) {
    if (p.dead) continue;
    if (p.prisoner) {
      prisoners++;
      continue;
    }
    if (p.faction === 'colony') {
      col.push(p);
      if (p.nameless) nameless++;
    } else if (p.faction === 'enemy') {
      if (p.downed) downedE++;
      else en.push(p);
    }
  }
  R.hostiles = en.length;
  R.alarm = false;
  R.bossId = 0;
  for (const e of en) if (e.boss && !e.stationary) R.bossId = e.id;
  // босс на карте — тревога для всех: бой с ним — дело всей команды
  if (R.bossId) R.alarm = true;
  else if (en.length) {
    const home = game.train?.stamped ? game.train.center() : null;
    for (const e of en) {
      if (!home || (e.x - home.x) ** 2 + (e.y - home.y) ** 2 < 28 * 28) {
        R.alarm = true;
        break;
      }
    }
  }
  R.downedEnemies = downedE;
  R.prisoners = prisoners;
  R.nameless = nameless;
}

/** Ближайшая враждебная пешке цель. opts: {maxD, allowDowned, from (точка), filter} */
export function nearestHostile(game, C, p, opts = {}) {
  const maxD = opts.maxD ?? 30;
  const fx = opts.from?.x ?? p.x;
  const fy = opts.from?.y ?? p.y;
  let best = null;
  let bestD = maxD * maxD;
  const scan = (list) => {
    for (const o of list) {
      if (o === p || o.dead || o.removed) continue;
      if (o.downed && !opts.allowDowned) continue;
      if (o.prisoner) continue;
      const dx = o.x - fx;
      const dy = o.y - fy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= bestD) continue;
      if (!isHostile(p, o)) continue;
      if (opts.filter && !opts.filter(o)) continue;
      best = o;
      bestD = d2;
    }
  };
  if (p.faction === 'enemy') scan(C.R.colony);
  else {
    scan(C.R.enemies);
    if (opts.allowDowned) for (const o of game.entities.ofKind('pawn')) if (o.faction === 'enemy' && o.downed && !o.prisoner) scan([o]);
    // марионетки Лича — тоже цели для поселенцев
    if (C.S.threads.length) scan(C.R.colony);
  }
  return best;
}

const validTarget = (game, p, id, allowDowned) => {
  const t = id ? game.entities.get(id) : null;
  if (!t || t.dead || t.removed) return null;
  if (t.kind === 'pawn' && ((t.downed && !allowDowned) || t.prisoner)) return null;
  return t;
};

// ---------------- Движение ----------------
/** Подойти к цели (перепрокладка не чаще раза в 40 тиков или при уходе цели). @returns {boolean} есть путь */
export function approach(game, p, x, y, adjacent = true) {
  const now = game.time.tick;
  if (p.stationary) return false;
  if (p.flying) {
    p._flyX = x;
    p._flyY = y;
    return true;
  }
  if (p._noPathUntil > now && Math.abs((p._goalX ?? -99) - x) < 3 && Math.abs((p._goalY ?? -99) - y) < 3) return false;
  const gx = Math.floor(x);
  const gy = Math.floor(y);
  const moved = p._goalX === undefined || Math.abs(p._goalX - gx) + Math.abs(p._goalY - gy) >= 2;
  const idle = !p.path || p.pathI >= p.path.length;
  if (!(idle || (moved && now - (p._repathTick || -1e9) > 40))) return true;
  p._repathTick = now;
  p._goalX = gx;
  p._goalY = gy;
  if (Math.floor(p.x) === gx && Math.floor(p.y) === gy) return true;
  if (moveTo(game, p, gx, gy, { adjacent })) return true;
  p._noPathUntil = now + 90;
  return false;
}

/** Полёт (дракон): прямо к точке, сквозь стены. */
export function flyStep(game, p, dt) {
  if (!p.flying || p._flyX === undefined) return;
  const dx = p._flyX - p.x;
  const dy = p._flyY - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.2) {
    p.moving = false;
    return;
  }
  const map = game.map;
  const step = Math.min(d, (p.speed || 3) * dt);
  p.x = clamp(p.x + (dx / d) * step, 0.5, map.w - 0.5);
  p.y = clamp(p.y + (dy / d) * step, 0.5, map.h - 0.5);
  p.dir = Math.atan2(dy, dx);
  p.moving = true;
  p.walkPhase += step * 1.5;
  game.entities.moved(p);
}

function halt(p) {
  if (p.path) stopMoving(p);
  if (p.flying) p._flyX = undefined;
}

/** Расстояние до цели с учётом размеров (постройка — до прямоугольника). */
function reachDist(p, t) {
  if (t.kind === 'building') {
    const cx = clamp(p.x, t.x, t.x + (t.w || 1));
    const cy = clamp(p.y, t.y, t.y + (t.h || 1));
    return Math.hypot(p.x - cx, p.y - cy);
  }
  return dist(p.x, p.y, t.x, t.y) - (t.radius || 0.3) * 0.5;
}

/**
 * Сблизиться и атаковать. hold — не сходить с места (стрелок у окна, строй).
 * @returns {'attack'|'move'|'blocked'}
 */
const NEIGH = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/** Стрелок-поселенец отходит от бойца ближнего боя, а не стреляет в упор. @returns {boolean} отходит */
function kite(game, C, p, w) {
  const now = game.time.tick;
  if (p._kiteUntil > now) return !!p.path;
  let th = null;
  let bd = 2.3 * 2.3;
  for (const e of C.R.enemies) {
    const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d2 >= bd || weaponStats(game, C, e).kind !== 'melee' || e.stationary) continue;
    bd = d2;
    th = e;
  }
  if (!th) return false;
  const a = Math.atan2(p.y - th.y, p.x - th.x);
  const map = game.map;
  for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
    const x = Math.floor(p.x + Math.cos(a + off) * 3.5);
    const y = Math.floor(p.y + Math.sin(a + off) * 3.5);
    if (!map.isPassable(x, y)) continue;
    if (moveTo(game, p, x, y)) {
      p._kiteUntil = now + 45;
      return true;
    }
  }
  p._kiteUntil = now + 30;
  void w;
  return false;
}

const COLONY_REACH_BONUS = 0.3;

export function engage(game, C, p, t, opts = {}) {
  const now = game.time.tick;
  const w = weaponStats(game, C, p);
  if (w.kind === 'ranged' && !opts.hold && p.faction === 'colony' && t.kind === 'pawn' && kite(game, C, p, w)) return 'move';
  const c = center(t);
  const d = reachDist(p, t);
  const dmgMul = opts.dmgMul || p._dmgMul || 1;
  if (w.kind === 'ranged') {
    if (d <= w.range) {
      if (!(p._noLosUntil > now)) {
        halt(p);
        p.dir = Math.atan2(c.y - p.y, c.x - p.x);
        if (attackReady(game, p)) {
          const los = shotLine(game, p.x, p.y, c.x, c.y);
          if (los >= 0) {
            fireAtTarget(game, C, p, t, w, { trees: los, dmgMul });
            setCooldown(game, p, w.cooldown * (0.9 + ((p.id * 7 + now) % 10) * 0.02));
          } else p._noLosUntil = now + 45;
        }
        return 'attack';
      }
    }
    if (opts.hold) return 'blocked';
    return approach(game, p, c.x, c.y, true) ? 'move' : 'blocked';
  }
  // поселенцам +0.3: сосед по диагонали (≈1.4–1.7 с учётом смещения в клетке) — в досягаемости; врагам — как было
  const reach = (w.reach || 1.5) + (p.boss ? 0.6 : 0) + (p.faction === 'colony' ? COLONY_REACH_BONUS : 0);
  if (d <= reach) {
    halt(p);
    p.dir = Math.atan2(c.y - p.y, c.x - p.x);
    if (attackReady(game, p)) {
      if (opts.ignite && t.kind === 'building') C.ignite(t, p);
      else meleeStrike(game, C, p, t, w, { dmgMul });
      setCooldown(game, p, w.cooldown * (0.9 + ((p.id * 7 + now) % 10) * 0.02));
    }
    return 'attack';
  }
  if (opts.hold) return 'blocked';
  return approach(game, p, c.x, c.y, true) ? 'move' : 'blocked';
}

// ---------------- Режимы ----------------
function homePoint(game) {
  const c = game.train?.stamped ? game.train.center() : null;
  if (c) return c;
  const L = game.getLeader();
  return L ? { x: L.x, y: L.y } : { x: game.map.w / 2, y: game.map.h / 2 };
}

function retreatTick(game, C, p) {
  const map = game.map;
  if (!p._exit) {
    const cands = [
      { x: 1, y: Math.floor(p.y), d: p.x },
      { x: map.w - 2, y: Math.floor(p.y), d: map.w - p.x },
      { x: Math.floor(p.x), y: 1, d: p.y },
      { x: Math.floor(p.x), y: map.h - 2, d: map.h - p.y },
    ].sort((a, b) => a.d - b.d);
    for (const e of cands) {
      const spot = map.randomPassableNear(game.rng, e.x, e.y, 4, 12, (x, y) => game.pathfinder.canReach(p.x, p.y, x, y));
      if (spot) {
        p._exit = spot;
        break;
      }
    }
    if (!p._exit) p._exit = { x: Math.floor(p.x), y: Math.floor(p.y) };
  }
  const ex = p._exit;
  const nearEdge = p.x < 3 || p.y < 3 || p.x > map.w - 3 || p.y > map.h - 3;
  if (nearEdge || (dist(p.x, p.y, ex.x + 0.5, ex.y + 0.5) < 1.2)) {
    if (nearEdge || game.time.tick - (p._leftAt || 0) > secs(30)) {
      const raid = raidOf(C, p);
      if (raid) raid.left = (raid.left || 0) + 1;
      game.jobs.endJob(p, 'cancelled');
      game.entities.remove(p, 'left');
      return 'failed';
    }
  }
  if (p.flying) approach(game, p, ex.x + 0.5, ex.y + 0.5);
  else if (!approach(game, p, ex.x, ex.y, false)) p._exit = null;
  // отходя, огрызаются на тех, кто рядом
  const t = nearestHostile(game, C, p, { maxD: 2 });
  if (t) engage(game, C, p, t, { hold: true });
  return 'running';
}

/** Ограбить упавшего: 50% вещей (кроме посоха — «проклятая палка»). */
export function robPawn(game, C, robber, victim) {
  const raid = raidOf(C, robber);
  const eq = victim.equipment || {};
  const loot = (robber.loot ||= []);
  let took = 0;
  const rng = game.rng;
  if (eq.weapon && eq.weapon !== 'conductor_staff' && rng.chance(0.5)) {
    loot.push({ defId: eq.weapon, count: 1, meta: eq.weaponMeta || null });
    eq.weapon = null;
    delete eq.weaponMeta;
    took++;
  }
  if (eq.armor && (victim.isLeader || rng.chance(0.5))) {
    loot.push({ defId: eq.armor, count: 1, meta: eq.armorMeta || null });
    eq.armor = null;
    delete eq.armorMeta;
    took++;
  }
  if (victim.carry) {
    loot.push({ defId: victim.carry.defId, count: victim.carry.count });
    victim.carry = null;
    took++;
  }
  const inv = victim.inventory?.items;
  if (Array.isArray(inv) && inv.length) {
    for (let i = inv.length - 1; i >= 0; i--) {
      const it = inv[i];
      const isCoin = it?.defId === 'silver';
      if (!it || !(isCoin || rng.chance(0.5))) continue;
      const n = isCoin ? Math.ceil((it.count || 1) * 0.5) : it.count || 1;
      loot.push({ defId: it.defId, count: n });
      it.count = (it.count || 1) - n;
      if (it.count <= 0) inv.splice(i, 1);
      took++;
    }
  }
  if (victim.isLeader && Number.isFinite(game.colony.silver) && game.colony.silver > 0) {
    const n = Math.ceil(game.colony.silver * 0.3);
    game.colony.silver -= n;
    loot.push({ defId: 'silver', count: n, virtual: !game.defs.items.has('silver') });
    took++;
  }
  if (raid && !raid.robbed.includes(victim.id)) raid.robbed.push(victim.id);
  if (victim.isLeader) {
    game.api.mind.addThought(victim, 'humiliated', { source: robber });
    if (hasStaff(victim)) game.api.mind.say(robber, game.i18n.tRude('combat.rob.staff', 'combat.rob.staffRude', { variant: robber.id }));
  }
  game.api.vision.report(game.t('combat.rob.robbed', { who: robber.name, victim: victim.name }), { type: 'bad', x: victim.x, y: victim.y, pawnId: victim.id });
  return took;
}

/** Тендер (вагон только для топлива) — его не грабят: без угля поезд встаёт, а это не наказание за рейд. */
function inTender(game, it) {
  const tr = game.train;
  if (!tr?.stamped) return false;
  const car = tr.carAt(Math.floor(it.x), Math.floor(it.y));
  return !!car && !!tr.carDef(car).fuelOnly;
}
const FUEL_LOOT_CAP = 8; // топливо со склада вне тендера — не больше горсти за рейд

/** Можно ли украсть эту кучу (склад, переносимое, не уникальное, не из тендера, топливо — в пределах лимита). */
function stealable(game, raid, it) {
  if (!game.items.isStored(it)) return false;
  const def = game.defs.items.get(it.defId);
  if (!def || def.haulable === false || def.unique) return false;
  if (inTender(game, it)) return false;
  if (def.category === 'fuel' && (raid.fuelStolen || 0) >= FUEL_LOOT_CAP) return false;
  return true;
}

/** Украсть со склада (до 30% сложенного у ближайшей зоны). */
function stealTick(game, C, p, raid) {
  if (raid.stealBudget < 0) {
    let total = 0;
    for (const it of game.entities.ofKind('item')) if (stealable(game, raid, it)) total += it.count;
    raid.stealBudget = Math.ceil(total * 0.3);
  }
  if (raid.stealBudget <= 0) {
    raid.robDone = true;
    return;
  }
  let it = p._stealId ? game.entities.get(p._stealId) : null;
  if (!it || it.removed) {
    it = null;
    let bestD = 1e9;
    for (const o of game.entities.ofKind('item')) {
      if (!stealable(game, raid, o)) continue;
      const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        it = o;
      }
    }
    if (!it) {
      raid.robDone = true;
      return;
    }
    p._stealId = it.id;
  }
  if (dist(p.x, p.y, it.x + 0.5, it.y + 0.5) <= 1.6) {
    const fuel = game.defs.items.get(it.defId)?.category === 'fuel';
    if (!stealable(game, raid, it)) {
      p._stealId = 0;
      return;
    }
    const cap = fuel ? FUEL_LOOT_CAP - (raid.fuelStolen || 0) : 25;
    const n = game.items.take(it, Math.min(raid.stealBudget, 25, cap));
    if (n > 0) {
      (p.loot ||= []).push({ defId: it.defId, count: n });
      raid.stealBudget -= n;
      raid.stolen += n;
      if (fuel) raid.fuelStolen = (raid.fuelStolen || 0) + n;
    }
    p._stealId = 0;
    if ((p.loot?.length || 0) >= 4) p.leaving = true; // нагрузился — уходит
  } else if (!approach(game, p, it.x, it.y, true)) p._stealId = 0;
}

function raiderTick(game, C, p, job) {
  const now = game.time.tick;
  const raid = raidOf(C, p);
  if (p.leaving || raid?.phase === 'retreat') {
    if (!p._leftAt) p._leftAt = now;
    return retreatTick(game, C, p);
  }
  const f = FACTIONS[p.enemyFaction] || FACTIONS.bandits;
  const phase = raid?.phase || 'attack';
  if (phase === 'rob' && f.rob) {
    // упавшие поселенцы, ещё не обобранные
    let victim = null;
    let bestD = 1e9;
    for (const c of C.R.colony) {
      if (!c.downed || raid.robbed.includes(c.id)) continue;
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        victim = c;
      }
    }
    if (victim) {
      if (dist(p.x, p.y, victim.x, victim.y) <= 1.6) robPawn(game, C, p, victim);
      else approach(game, p, victim.x, victim.y, true);
    } else stealTick(game, C, p, raid);
    return 'running';
  }
  // выбор цели
  const finish = !f.rob && !isHealthStub(game);
  let t = validTarget(game, p, p._tgt, finish);
  if (!t || (t.downed && (now + p.id) % 20 === 0) || (now + p.id) % 20 === 0) {
    const maxD = phase === 'approach' ? 16 : 70;
    let nt = nearestHostile(game, C, p, { maxD });
    // не-бандиты добивают упавших, если стоящих рядом нет (пока health — заглушка без спасения раненых — нет)
    if (!nt && finish) nt = nearestHostile(game, C, p, { maxD: 14, allowDowned: true });
    t = nt;
    p._tgt = t?.id || 0;
  }
  // поджигатели
  const role = game.defs.enemies.get(p.enemyId)?.role;
  if (!t || (role === 'arsonist' && dist(p.x, p.y, t.x, t.y) > 6)) {
    if (role === 'arsonist' || (f.arson && p.id % 5 === 0)) {
      const b = C.arsonTarget(p);
      if (b) {
        engage(game, C, p, b, { ignite: true });
        return 'running';
      }
    }
  }
  if (t) {
    engage(game, C, p, t);
    return 'running';
  }
  // цели нет — к поезду
  const home = homePoint(game);
  if (dist(p.x, p.y, home.x, home.y) > 6) approach(game, p, home.x, home.y, true);
  else if (!p.path && (now + p.id) % 120 === 0) {
    const spot = game.map.randomPassableNear(game.rng, home.x, home.y, 8, 10);
    if (spot) approach(game, p, spot.x, spot.y, false);
  }
  void job;
  return 'running';
}

/** Цель при активном боссе: свой ближний противник (самооборона), иначе — сам босс. */
function bossFocus(game, C, p, selfR) {
  const boss = C.R.bossId ? game.entities.get(C.R.bossId) : null;
  if (!boss || !isActiveFoe(boss) || !isHostile(p, boss)) return null;
  return nearestHostile(game, C, p, { maxD: selfR }) || boss;
}
const BOSS_RALLY_D = 70;

function defendTick(game, C, p) {
  if (!isArmed(game, p)) return 'done';
  if (hpRatio(game, p) < 0.3) return 'failed';
  if (game.api.mind.isInBreak(p)) return 'failed';
  let t = validTarget(game, p, p._tgt, false);
  if (!t || (game.time.tick + p.id) % 20 === 0) {
    t = nearestHostile(game, C, p, { maxD: C.R.alarm ? 32 : 16 });
    if (C.R.bossId) t = bossFocus(game, C, p, 4) || t;
    p._tgt = t?.id || 0;
  }
  if (!t) return 'done';
  // не убегать далеко от дома в погоне (кроме босса: на него идут всей командой)
  const home = homePoint(game);
  const tooFar = !t.boss && dist(t.x, t.y, home.x, home.y) > 34;
  const w = weaponStats(game, C, p);
  engage(game, C, p, t, { hold: tooFar && w.kind === 'ranged' });
  if (tooFar && w.kind !== 'ranged') return 'done';
  return 'running';
}

/** Номер пешки в строю (стабильно: по id среди призванных). */
function formationSlot(C, p) {
  let i = 0;
  for (const o of C.R.colony) if (o.drafted && o.draftMode !== 'horn' && o.id < p.id && !o.isLeader) i++;
  return i;
}

function armsTick(game, C, p) {
  if (!p.drafted) return 'done';
  const now = game.time.tick;
  const L = game.getLeader();
  if (!L || L === p) return 'done';
  const w = weaponStats(game, C, p);
  // цель лидера (клик/наведение), иначе ближайший враг рядом с бойцом
  let t = validTarget(game, p, C.R.leaderTargetId, false) || validTarget(game, p, C.R.hoverEnemyId, false);
  if (t && (!isHostile(p, t) || dist(L.x, L.y, t.x, t.y) > 18)) t = null;
  if (!t) {
    t = validTarget(game, p, p._tgt, false);
    if (!t || (now + p.id) % 20 === 0) {
      t = nearestHostile(game, C, p, { maxD: w.kind === 'ranged' ? w.range : 7 });
      // призванные бьют босса (если он рядом с лидером), отвлекаясь лишь на тех, кто вплотную
      if (C.R.bossId) {
        const f = bossFocus(game, C, p, 2.5);
        if (f && dist(L.x, L.y, f.x, f.y) < 18) t = f;
      }
      p._tgt = t?.id || 0;
    }
  }
  if (t) {
    const leash = dist(L.x, L.y, t.x, t.y) < 14;
    const r = engage(game, C, p, t, { hold: !leash });
    if (r !== 'blocked') return 'running';
  }
  // строй за спиной лидера
  const i = formationSlot(C, p);
  const ring = Math.floor(i / 6);
  const k = i % 6;
  const back = (L.dir || 0) + Math.PI;
  // шаг в строю ≥ 1.3 клетки: хорда 2·r·sin(0.75/2) ≈ 1.32 при r = 1.8
  const ang = back + (k - 2.5) * 0.75;
  const rr = 1.8 + ring * 1.4;
  let fx = L.x + Math.cos(ang) * rr;
  let fy = L.y + Math.sin(ang) * rr;
  const map = game.map;
  if (!map.isPassable(Math.floor(fx), Math.floor(fy))) {
    let found = false;
    for (const [dx, dy] of NEIGH) {
      if (map.isPassable(Math.floor(fx + dx), Math.floor(fy + dy))) {
        fx += dx;
        fy += dy;
        found = true;
        break;
      }
    }
    if (!found) {
      fx = L.x;
      fy = L.y;
    }
  }
  if (dist(p.x, p.y, fx, fy) > 1.4) approach(game, p, fx, fy, dist(fx, fy, L.x, L.y) < 0.6);
  else {
    halt(p);
    if (!t) p.dir = L.dir;
  }
  return 'running';
}

/** Клетки-посты у дверей/окон поезда (изнутри вагона). */
function trainPosts(game) {
  const map = game.map;
  const out = [];
  for (const b of game.entities.ofKind('building')) {
    if (!b.train) continue;
    const def = game.defs.buildings.get(b.defId);
    if (!def || !(def.window || def.door)) continue;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const x = b.x + dx;
      const y = b.y + dy;
      if (!map.inBounds(x, y) || !map.isPassable(x, y)) continue;
      if (map.room[map.idx(x, y)] < TRAIN_ROOM_BASE) continue;
      if (map.buildingAt(x, y)) continue;
      out.push({ x, y, window: !!def.window, bx: b.x, by: b.y });
    }
  }
  return out;
}

function hornTick(game, C, p) {
  if (!p.drafted) return 'done';
  const R = C.R;
  let post = R.posts.get(p.id);
  if (!post) {
    const w = weaponStats(game, C, p);
    const taken = new Set([...R.posts.values()].map((q) => q.x + ',' + q.y));
    let best = null;
    let bestD = 1e9;
    for (const q of trainPosts(game)) {
      if (taken.has(q.x + ',' + q.y)) continue;
      // стрелкам — окна, бойцам ближнего боя — двери
      const pref = (w.kind === 'ranged') === q.window ? 0 : 30;
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + pref * pref;
      if (d < bestD && game.pathfinder.canReach(p.x, p.y, q.x, q.y)) {
        bestD = d;
        best = q;
      }
    }
    post = best || { x: Math.floor(p.x), y: Math.floor(p.y), window: false };
    R.posts.set(p.id, post);
  }
  const atPost = dist(p.x, p.y, post.x + 0.5, post.y + 0.5) < 0.9;
  const w = weaponStats(game, C, p);
  let t = validTarget(game, p, p._tgt, false);
  if (!t || (game.time.tick + p.id) % 20 === 0) {
    t = nearestHostile(game, C, p, { maxD: w.kind === 'ranged' ? w.range + 1 : 3.5, from: atPost ? null : { x: post.x + 0.5, y: post.y + 0.5 } });
    p._tgt = t?.id || 0;
  }
  if (t && (atPost || dist(p.x, p.y, t.x, t.y) < 2.5)) {
    engage(game, C, p, t, { hold: true });
    return 'running';
  }
  if (!atPost) approach(game, p, post.x, post.y, false);
  else halt(p);
  return 'running';
}

function puppetTick(game, C, p) {
  if (!p.puppet) return 'done';
  let t = validTarget(game, p, p._tgt, false);
  if (!t || (game.time.tick + p.id) % 30 === 0) {
    t = nearestHostile(game, C, p, { maxD: 30 });
    p._tgt = t?.id || 0;
  }
  if (t) engage(game, C, p, t);
  return 'running';
}

function namelessTick(game, C, p) {
  if (!p.nameless) return 'done';
  const heart = C.R.heartId ? game.entities.get(C.R.heartId) : null;
  if (!heart || heart.dead) {
    p.nameless = false;
    return 'done';
  }
  if (dist(p.x, p.y, heart.x, heart.y) > 3.2) approach(game, p, heart.x, heart.y, true);
  else {
    halt(p);
    p.dir = Math.atan2(heart.y - p.y, heart.x - p.x);
  }
  return 'running';
}

function prisonerTick(game, C, p) {
  const pr = p.prisoner;
  if (!pr) return 'done';
  if (pr.mode === 'release') {
    p.leaving = true;
    return retreatTick(game, C, p);
  }
  const bed = pr.bedId ? game.entities.get(pr.bedId) : null;
  if (bed && !bed.removed) {
    if (dist(p.x, p.y, bed.x + 0.5, bed.y + 0.5) > 0.7) approach(game, p, bed.x, bed.y, false);
    else {
      halt(p);
      p.pose = 'sit';
    }
  } else if (!p.path && (game.time.tick + p.id) % 300 === 0) {
    C.assignPrisonerBed?.(p);
  }
  return 'running';
}

export function fightTick(game, C, p, job, dt) {
  if (p.dead) return 'failed';
  if (p.downed) return 'failed';
  if (p.frozenUntil > game.time.tick) {
    halt(p);
    return 'running';
  }
  switch (job.data.mode) {
    case 'raider':
      return raiderTick(game, C, p, job);
    case 'boss':
      return C.bossTick(p, job, dt);
    case 'defend':
      return defendTick(game, C, p);
    case 'arms':
      return armsTick(game, C, p);
    case 'horn':
      return hornTick(game, C, p);
    case 'puppet':
      return puppetTick(game, C, p);
    case 'nameless':
      return namelessTick(game, C, p);
    case 'prisoner':
      return prisonerTick(game, C, p);
    default:
      return 'done';
  }
}

const fightJob = (game, p, mode, priority) => game.jobs.createJob('combat:fight', p, { data: { mode }, priority });

// ---------------- Призыв ----------------
/** Призвать/отпустить. mode: 'arms' (строй за лидером) | 'horn' (пост у окна/двери). */
export function setDrafted(game, C, p, v, mode = 'arms') {
  if (!p || p.dead || p.faction !== 'colony' || p.isLeader) {
    if (p && !v) p.drafted = false;
    return false;
  }
  const was = !!p.drafted;
  p.drafted = !!v;
  if (v) p.draftMode = mode;
  else {
    delete p.draftMode;
    C.R.posts.delete(p.id);
  }
  if (was !== !!v || v) {
    if (p.job && p.job.type !== 'combat:fight') game.jobs.endJob(p, 'cancelled');
    else if (p.job && !v) game.jobs.endJob(p, 'cancelled');
    p._thinkCooldown = 0;
    p._tgt = 0;
  }
  game.events.emit('combat:drafted', { pawn: p, drafted: !!v, mode });
  return true;
}

/** Радиус голоса лидера (vision может дать свой). */
export function voiceRadius(game, L) {
  let r = 12;
  const v = game.api.vision;
  for (const fn of ['voiceRadius', 'getVoiceRadius']) {
    if (typeof v[fn] === 'function') {
      try {
        const x = v[fn](L);
        if (Number.isFinite(x) && x > 0) r = x;
      } catch (err) {
        game.error(err, 'combat.voiceRadius');
      }
      break;
    }
  }
  return r * (L?.perks?.voiceMul || 1);
}

/** «К оружию!» (R): призвать всех в радиусе голоса; повторно — отпустить. */
export function callToArms(game, C, L) {
  if (!L) return 0;
  const drafted = C.R.colony.filter((p) => p.drafted && !p.isLeader);
  C.vfx('voice_ring', { x: L.x, y: L.y, r: voiceRadius(game, L), targetId: L.id });
  // голос лидера рвёт нити Лича и будит безымянных рядом
  const freed = C.voiceCleanse(L, voiceRadius(game, L));
  if (drafted.length) {
    for (const p of drafted) setDrafted(game, C, p, false);
    game.api.ui.notify(game.t('combat.arms.released', { n: drafted.length }), { type: 'info' });
    C.sfx('combat:release', L.x, L.y);
    return -drafted.length;
  }
  const r = voiceRadius(game, L);
  let n = 0;
  for (const p of C.R.colony) {
    if (p === L || p.isLeader || p.downed || p.puppet || p.nameless) continue;
    if (dist(p.x, p.y, L.x, L.y) > r) continue;
    const ans = game.api.mind.willObey(p, 'callToArms', { leader: L });
    if (ans && ans.ok === false) {
      if (ans.reply) game.api.mind.say(p, ans.reply);
      continue;
    }
    setDrafted(game, C, p, true, 'arms');
    n++;
  }
  game.api.mind.say(L, game.t('combat.arms.shout', { variant: game.time.tick }));
  game.api.vision.noise(L.x, L.y, 14, 'shout');
  C.sfx('combat:call', L.x, L.y);
  game.api.ui.notify(n ? game.t('combat.arms.called', { n }) : game.t('combat.arms.nobody'), { type: n ? 'good' : 'info' });
  game.events.emit('combat:callToArms', { leader: L, count: n, freed });
  return n;
}

/** Двойной гудок: весь поезд «к оружию» — к дверям и окнам. */
export function hornToArms(game, C) {
  const train = game.train;
  const home = homePoint(game);
  const map = game.map;
  let n = 0;
  for (const p of C.R.colony) {
    if (p.isLeader || p.downed || p.puppet || p.nameless) continue;
    const aboard = map.inBounds(Math.floor(p.x), Math.floor(p.y)) && map.room[map.idx(Math.floor(p.x), Math.floor(p.y))] >= TRAIN_ROOM_BASE;
    if (!aboard && dist(p.x, p.y, home.x, home.y) > 40) continue;
    setDrafted(game, C, p, true, 'horn');
    n++;
  }
  C.S.hornUntil = game.time.tick + secs(30);
  void train;
  game.api.ui.notify(game.t('combat.arms.horn', { n }), { type: 'danger' });
  return n;
}

// ---------------- Регистрация ----------------
export function registerAI(game, C) {
  game.jobs.registerToil({
    id: 'combat:fight',
    tick: (g, p, toil, job, dt) => fightTick(g, C, p, job, dt),
    end: (g, p) => {
      if (p.path) stopMoving(p);
      if (p.pose === 'sit' && p.prisoner) p.pose = 'idle';
    },
  }, 'combat');
  game.jobs.registerJobType({
    id: 'combat:fight',
    workType: null,
    labelKey: 'combat.job.fight',
    priority: 96,
    reserve: () => [],
    makeToils: () => [{ type: 'combat:fight' }],
  }, 'combat');

  // подобрать оружие/броню / снаряжение (ручное E и ИИ)
  game.jobs.registerJobType({
    id: 'combat:equip',
    workType: null,
    labelKey: 'combat.job.equip',
    priority: 52,
    makeToils: (g, p, job) => [
      { type: 'goto', targetId: job.targetId, adjacent: true },
      {
        type: 'interact',
        fn(g2, pawn, j) {
          const it = g2.entities.get(j.targetId);
          if (!it || it.removed) return 'failed';
          return equipItem(g2, pawn, it) ? 'done' : 'failed';
        },
      },
    ],
  }, 'combat');

  const ai = game.ai;
  // враги
  ai.registerThinkNode({
    id: 'combat:enemy',
    priority: 96,
    interrupts: true,
    factions: ['enemy'],
    evaluate(g, p) {
      if (p.job?.type === 'combat:fight') return null;
      return fightJob(g, p, p.boss ? 'boss' : 'raider', 96);
    },
  }, 'combat');
  // пленные (фракция neutral)
  ai.registerThinkNode({
    id: 'combat:prisoner',
    priority: 98,
    interrupts: true,
    factions: ['neutral'],
    evaluate(g, p) {
      if (!p.prisoner || p.job?.type === 'combat:fight') return null;
      return fightJob(g, p, 'prisoner', 98);
    },
  }, 'combat');
  // марионетки и безымянные
  ai.registerThinkNode({
    id: 'combat:possessed',
    priority: 98,
    interrupts: true,
    factions: ['colony'],
    evaluate(g, p) {
      if (p.job?.type === 'combat:fight' && (p.job.data.mode === 'puppet' || p.job.data.mode === 'nameless')) return null;
      if (p.puppet) return fightJob(g, p, 'puppet', 98);
      if (p.nameless) return fightJob(g, p, 'nameless', 98);
      return null;
    },
  }, 'combat');
  // «К оружию!» (резерв ядра: callToArms 97)
  ai.registerThinkNode({
    id: 'callToArms',
    priority: 97,
    interrupts: true,
    factions: ['colony'],
    evaluate(g, p) {
      if (!p.drafted || p.isLeader) return null;
      const mode = p.draftMode === 'horn' ? 'horn' : 'arms';
      if (p.job?.type === 'combat:fight' && p.job.data.mode === mode) return null;
      return fightJob(g, p, mode, 97);
    },
  }, 'combat');
  // самооборона вооружённых (выше бегства ядра 95)
  ai.registerThinkNode({
    id: 'combat:defend',
    priority: 96,
    interrupts: true,
    factions: ['colony'],
    evaluate(g, p) {
      if (!C.R.hostiles || p.drafted || p.isLeader || p.job?.type === 'combat:fight') return null;
      // раненые (в т.ч. только что вставшие) в бой не лезут, пока не окрепнут
      if (!isArmed(g, p) || hpRatio(g, p) < 0.6 || g.api.mind.isInBreak(p)) return null;
      // тревога (рейд у поезда) — вооружённые сходятся на врага издалека
      let t = nearestHostile(g, C, p, { maxD: C.R.alarm ? 30 : 12 });
      if (!t && C.R.bossId) {
        const b = g.entities.get(C.R.bossId);
        if (b && dist(p.x, p.y, b.x, b.y) < BOSS_RALLY_D) t = b;
      }
      if (!t) return null;
      return fightJob(g, p, 'defend', 96);
    },
  }, 'combat');
  // подобрать оружие/броню, если есть на складе (ниже еды/сна, выше работы)
  ai.registerThinkNode({
    id: 'combat:equip',
    priority: 52,
    factions: ['colony'],
    evaluate(g, p) {
      const now = g.time.tick;
      if (p._eqNext > now) return null;
      p._eqNext = now + 1800 + (p.id % 13) * 37;
      const eq = p.equipment || {};
      const needW = !eq.weapon;
      const needA = !eq.armor;
      if (!needW && !needA) return null;
      const it = g.items.findNearest(p, (item, def) => {
        if (def.unique) return false;
        if (needW && def.weapon && !def.weapon.mage) return true;
        return needA && !!def.armor;
      }, { maxDist: 60 });
      if (!it) return null;
      return g.jobs.createJob('combat:equip', p, { targetId: it.id, x: it.x, y: it.y });
    },
  }, 'combat');
}

/** Стартовое снаряжение спутников (детерминированно, без расхода основного ГСЧ). */
export function kitColonist(game, p) {
  if (p.isLeader || p.equipment?.weapon || p.naked) return;
  const rng = game.rng.fork(`combat:kit:${p.id}`);
  const shoot = skillLevel(game, p, 'shooting');
  const melee = skillLevel(game, p, 'melee');
  const pool = shoot >= melee ? ['bow', 'bow', 'crossbow', 'knife'] : ['club', 'spear', 'axe', 'knife', 'short_sword'];
  if (rng.chance(0.85)) {
    p.equipment ||= {};
    p.equipment.weapon = rng.pick(pool);
    p.equipment.weaponMeta = { quality: rng.pick(['poor', 'normal', 'normal', 'good']), kills: 0 };
  }
  if (rng.chance(0.3)) {
    p.equipment ||= {};
    p.equipment.armor = 'armor_leather';
    p.equipment.armorMeta = { quality: 'normal' };
  }
}

export { isActiveFoe };
