// Бой: линия выстрела, укрытия, шанс попадания, ближний бой с выбором части тела, снаряды с полётом,
// единый конвейер урона (броня, щиты, обереги → game.api.health.applyDamage), «сочность» удара, убийства,
// трофеи и магнит добычи, именное оружие, шум боя.
import { TILE } from '../../core/constants.js';
import { clamp, clamp01, dist, safeNum, hash01 } from '../../core/math.js';
import { weaponStats, weaponQuality, armorReduction, hasStaff, spawnGear, gearLabel } from './items.js';
import { raidOf, isActiveFoe } from './enemies.js';
import { realNow, secs } from './state.js';

// ---------------- Навыки и доступ к другим модулям ----------------
export function skillLevel(game, pawn, skill) {
  const m = game.api.mind;
  let v;
  if (typeof m.getSkill === 'function') {
    try {
      v = m.getSkill(pawn, skill);
    } catch {
      v = undefined;
    }
    if (v && typeof v === 'object') v = v.level;
  }
  if (!Number.isFinite(v)) v = m.skillLevel(pawn, skill);
  return safeNum(v, 0, 20, 3);
}

export function learn(game, pawn, skill, xp) {
  if (pawn.faction !== 'colony') return;
  const m = game.api.mind;
  if (typeof m.gainXp === 'function' && game.providers.mind?.gainXp) m.gainXp(pawn, skill, xp);
  else m.learn(pawn, skill, xp);
}

export const hpRatio = (game, p) => {
  const r = game.api.health.getSummary(p)?.ratio;
  if (Number.isFinite(r)) return r;
  return (p.health?.hp ?? 100) / (p.health?.maxHp ?? 100);
};

export const isHealthStub = (game) => !game.providers.health?.applyDamage;

export function center(e) {
  if (e.kind === 'pawn' || e.kind === 'projectile') return e;
  return { x: e.x + (e.w || 1) / 2, y: e.y + (e.h || 1) / 2 };
}

// ---------------- Враждебность ----------------
export function isHostile(a, b) {
  if (!a || !b || a === b) return false;
  if (a.prisoner || b.prisoner) return false;
  if (a.kind === 'pawn' && b.kind === 'pawn') {
    const pa = !!a.puppet;
    const pb = !!b.puppet;
    if (pa || pb) {
      if (pa && pb) return false;
      const other = pa ? b : a;
      return other.faction === 'colony';
    }
  }
  const ea = a.faction === 'enemy';
  const eb = b.faction === 'enemy';
  if (a.kind === 'building' || b.kind === 'building') {
    const bld = a.kind === 'building' ? a : b;
    const pawn = bld === a ? b : a;
    return pawn.faction === 'enemy' && bld.faction !== 'enemy';
  }
  return ea !== eb;
}

// ---------------- Линия выстрела и укрытия ----------------
/** Клетка для снаряда: 0 — свободно, 1 — дерево/куст (частично), 2 — сплошное. */
export function projTile(game, x, y) {
  const map = game.map;
  if (!map.inBounds(x, y)) return 2;
  const i = map.idx(x, y);
  const bid = map.building[i];
  if (bid) {
    const b = game.entities.get(bid);
    const d = b && game.defs.buildings.get(b.defId);
    if (d && !b.blueprint) {
      if (d.window) return 0;
      if (d.door) return 2;
      if (Number.isFinite(d.cover) && d.cover > 0 && d.cover < 0.9) return 0;
      if (!d.passable || d.blocksVision) return 2;
    }
  }
  if (map.plant[i]) {
    const p = game.entities.get(map.plant[i]);
    const pd = p && game.defs.plants.get(p.defId);
    if (pd?.blocksMove || pd?.blocksVision) return 1;
  }
  return 0;
}

/**
 * Линия выстрела между точками: -1 — перекрыта, иначе число деревьев на пути (каждое — штраф к меткости).
 * Начальная и конечная клетки не проверяются (стрелок у окна, цель в дверях).
 */
export function shotLine(game, x0, y0, x1, y1) {
  let x = Math.floor(x0);
  let y = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  let trees = 0;
  let first = true;
  for (let guard = 0; guard < 400; guard++) {
    if (!first && !(x === ex && y === ey)) {
      const k = projTile(game, x, y);
      if (k === 2) return -1;
      if (k === 1 && ++trees > 2) return -1;
    }
    first = false;
    if (x === ex && y === ey) return trees;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return trees;
}

/** Ценность укрытия клетки (0..0.85): мешки с песком/стены/деревья. Сначала спрашиваем build. */
export function coverValue(game, x, y) {
  const api = game.api.build;
  for (const fn of ['getCover', 'coverAt']) {
    if (typeof api[fn] === 'function') {
      const v = api[fn](x, y);
      if (Number.isFinite(v)) return clamp(v, 0, 0.9);
    }
  }
  const map = game.map;
  if (!map.inBounds(x, y)) return 0;
  const b = map.buildingAt(x, y);
  if (b && !b.blueprint) {
    const d = game.defs.buildings.get(b.defId);
    if (d) {
      if (Number.isFinite(d.cover)) return clamp(d.cover, 0, 0.9);
      if (d.window) return 0.5;
      if (d.door) return 0.35;
      if (!d.passable) return 0.75;
    }
  }
  const p = map.plantAt(x, y);
  if (p) {
    const pd = game.defs.plants.get(p.defId);
    if (pd?.blocksMove) return 0.4;
    if ((pd?.pathCost ?? 1) > 1) return 0.15;
  }
  return 0;
}

/** Укрытие цели от стрелка: соседние клетки цели со стороны стрелка. */
export function targetCover(game, shooter, target) {
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  const ddx = shooter.x - target.x;
  const ddy = shooter.y - target.y;
  if (ddx * ddx + ddy * ddy < 2.4) return 0;
  const sx = Math.abs(ddx) > 0.35 ? Math.sign(ddx) : 0;
  const sy = Math.abs(ddy) > 0.35 ? Math.sign(ddy) : 0;
  let c = coverValue(game, tx + sx, ty + sy);
  if (sx && sy) c = Math.max(c, coverValue(game, tx + sx, ty) * 0.8, coverValue(game, tx, ty + sy) * 0.8);
  return c;
}

/** Шанс попадания дальнего выстрела. */
export function hitChance(game, C, shooter, target, w, d, cover, trees = 0) {
  const lvl = skillLevel(game, shooter, w.skill || 'shooting');
  let p = w.accuracy * (0.68 + lvl * 0.032) + weaponQuality(shooter).acc;
  const rel = d / Math.max(1, w.range || 10);
  p *= 1 - 0.55 * rel * rel;
  p *= 1 - cover;
  p *= Math.pow(0.8, trees);
  const night = game.time.nightFactor || 0;
  if (night > 0.3 && !target.light && !target.burnUntil) p *= 1 - 0.2 * night;
  if (target.moving) p *= 0.9;
  if (target.boss || target.flying) p *= 1.25;
  if (target.downed) p *= 1.3;
  const shake = game.api.health.aimShake?.(shooter);
  if (Number.isFinite(shake)) p *= 1 - 0.4 * clamp01(shake);
  if (shooter.inspiration === 'steady_hand' || shooter.inspiration?.id === 'steady_hand') p *= 1.15;
  if (shooter.drafted) {
    const L = game.getLeader();
    const rally = L?.perks?.upgrades?.voice_rally || 0;
    if (rally) p += 0.06 * rally;
  }
  return clamp(p, 0.05, 0.97);
}

// ---------------- Части тела ----------------
const PARTS = [['head', 0.09], ['torso', 0.42], ['left_arm', 0.11], ['right_arm', 0.11], ['left_leg', 0.135], ['right_leg', 0.135]];
const LEG_PARTS = [['left_leg', 1], ['right_leg', 1]];
export function pickPart(game, kind = 'any') {
  const reg = game.defs.bodyParts;
  let list = kind === 'legs' ? LEG_PARTS : PARTS;
  if (reg) {
    list = list.filter((p) => reg.has(p[0]));
    if (!list.length) return undefined;
  }
  return game.rng.weighted(list, (p) => p[1])[0];
}

// ---------------- Атаки ----------------
export const attackReady = (game, p) => !(p._nextAtk > game.time.tick);
export function setCooldown(game, p, seconds) {
  p._nextAtk = game.time.tick + Math.max(1, Math.round(seconds * 60));
}

/** Удар ближнего боя. @returns {number} урон (-1 — промах) */
export function meleeStrike(game, C, attacker, target, w, opts = {}) {
  const rng = game.rng;
  const c = center(target);
  attacker.dir = Math.atan2(c.y - attacker.y, c.x - attacker.x);
  const q = weaponQuality(attacker);
  game.api.vision.noise(c.x, c.y, 8, 'clash');
  C.sfx(w.metal ? 'combat:clash' : 'combat:thud', c.x, c.y);
  C.vfx('slash', { x: attacker.x, y: attacker.y, a: attacker.dir, r: (w.reach || 1.5) * 0.9, color: attacker.isLeader ? '#bffaff' : w.metal ? '#e8f6ff' : '#ffcf8a' });
  if (target.kind === 'building') {
    damageBuilding(game, C, target, w.damage * q.mul * (opts.dmgMul || 1), attacker);
    return w.damage;
  }
  const lvl = skillLevel(game, attacker, 'melee');
  const tl = skillLevel(game, target, 'melee');
  let acc = w.accuracy * (0.76 + lvl * 0.024) + q.acc + (opts.accBonus || 0) - tl * 0.008;
  if (target.downed || target.frozenUntil > game.time.tick) acc += 0.4;
  const shake = game.api.health.aimShake?.(attacker);
  if (Number.isFinite(shake)) acc *= 1 - 0.25 * clamp01(shake);
  if (rng.next() > clamp(acc, 0.08, 0.97)) {
    C.floatMiss(target);
    learn(game, attacker, 'melee', 2);
    return -1;
  }
  const avg = w.damage * q.mul * (opts.dmgMul || 1);
  let dmg = avg * rng.range(0.8, 1.2);
  let crit = false;
  if (rng.next() < 0.06 + lvl * 0.004) {
    dmg *= 2.1;
    crit = true;
  }
  learn(game, attacker, 'melee', 6);
  return dealDamage(game, C, target, dmg, { type: w.type, part: pickPart(game), source: attacker, crit, avg, angle: attacker.dir });
}

/** Прицельный выстрел ИИ по цели (попадание решается в момент выстрела). */
export function fireAtTarget(game, C, shooter, target, w, opts = {}) {
  const c = center(target);
  const d = dist(shooter.x, shooter.y, c.x, c.y);
  const trees = opts.trees ?? Math.max(0, shotLine(game, shooter.x, shooter.y, c.x, c.y));
  const cover = target.kind === 'pawn' ? targetCover(game, shooter, target) : 0;
  const p = target.kind === 'pawn' ? hitChance(game, C, shooter, target, w, d, cover, trees) : 0.9;
  const rng = game.rng;
  const hit = rng.next() < p;
  const q = weaponQuality(shooter);
  const avg = w.damage * q.mul * (opts.dmgMul || 1);
  let dmg = avg * rng.range(0.8, 1.2);
  let crit = false;
  if (hit && rng.next() < 0.05 + skillLevel(game, shooter, w.skill || 'shooting') * 0.004) {
    dmg *= 2.1;
    crit = true;
  }
  shooter.dir = Math.atan2(c.y - shooter.y, c.x - shooter.x);
  const spec = {
    sourceId: shooter.id, faction: shooter.faction, style: w.projectile || 'arrow', speed: w.speed || 22, type: w.type,
    dmg, avg, crit, part: pickPart(game), range: (w.range || 10) + 3,
  };
  if (hit) {
    spec.mode = 'hit';
    spec.targetId = target.id;
    spawnProjectile(game, C, shooter.x, shooter.y, c.x, c.y, spec);
  } else {
    const blockedByCover = cover > 0 && rng.next() < cover / (cover + 0.4);
    const off = (rng.chance(0.5) ? 1 : -1) * rng.range(0.5, 1.3);
    const ang = Math.atan2(c.y - shooter.y, c.x - shooter.x) + off / Math.max(2, d);
    spec.mode = 'miss';
    if (blockedByCover) {
      const sx = Math.abs(shooter.x - c.x) > 0.35 ? Math.sign(shooter.x - c.x) : 0;
      const sy = Math.abs(shooter.y - c.y) > 0.35 ? Math.sign(shooter.y - c.y) : 0;
      spec.stopX = Math.floor(c.x) + sx;
      spec.stopY = Math.floor(c.y) + sy;
    }
    spawnProjectile(game, C, shooter.x, shooter.y, shooter.x + Math.cos(ang) * spec.range, shooter.y + Math.sin(ang) * spec.range, spec);
  }
  game.api.vision.noise(shooter.x, shooter.y, 15, 'shot');
  C.sfx(w.sfx || 'combat:bow', shooter.x, shooter.y);
  learn(game, shooter, w.skill || 'shooting', 5);
  return hit;
}

/** Свободный выстрел в точку (игрок): снаряд попадает в первого врага на пути. */
export function fireFree(game, C, shooter, x, y, w, opts = {}) {
  const ang = Math.atan2(y - shooter.y, x - shooter.x);
  shooter.dir = ang;
  const q = weaponQuality(shooter);
  const avg = (opts.damage ?? w.damage * q.mul) * (opts.dmgMul || 1);
  const rng = game.rng;
  let dmg = avg * rng.range(0.85, 1.15);
  let crit = false;
  if (rng.next() < 0.07) {
    dmg *= 2.1;
    crit = true;
  }
  const range = opts.range ?? (w.range || 10) + 2;
  spawnProjectile(game, C, shooter.x + Math.cos(ang) * 0.4, shooter.y + Math.sin(ang) * 0.4, shooter.x + Math.cos(ang) * range, shooter.y + Math.sin(ang) * range, {
    sourceId: shooter.id, faction: shooter.faction, style: opts.style || w.projectile || 'arrow', speed: opts.speed || w.speed || 24,
    type: opts.type || w.type, dmg, avg, crit, part: pickPart(game), range, mode: 'free', spell: opts.spell || null,
  });
  if (!opts.silent) {
    game.api.vision.noise(shooter.x, shooter.y, 15, 'shot');
    C.sfx(opts.sfx || w.sfx || 'combat:bow', shooter.x, shooter.y);
  }
}

// ---------------- Снаряды ----------------
export function spawnProjectile(game, C, x, y, tx, ty, spec) {
  const ang = Math.atan2(ty - y, tx - x);
  const speed = spec.speed || 22;
  const d = Math.hypot(tx - x, ty - y);
  const lifeTicks = Math.ceil(((spec.mode === 'aoe' ? d : spec.range || d) / speed) * 60) + 20;
  return game.entities.spawn('projectile', {
    x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, dir: ang, life: lifeTicks, tx, ty, ox: x, oy: y,
    combat: true, owner: 'combat', ...spec,
  });
}

/** Снаряд долетел до цели/точки. */
function impactPawn(game, C, pr, t) {
  const src = game.entities.get(pr.sourceId) || null;
  if (pr.aoe) {
    explode(game, C, t.x, t.y, pr.aoe, src);
    return;
  }
  dealDamage(game, C, t, pr.dmg, { type: pr.type, part: pr.part, source: src, crit: pr.crit, avg: pr.avg, angle: pr.dir, ranged: true, spell: pr.spell });
  if (pr.chill) applyChill(game, t, pr.chill.factor, pr.chill.seconds);
}

function impactWall(game, C, pr, x, y) {
  C.vfx('spark', { x, y, a: pr.dir + Math.PI, color: pr.style === 'rune' || pr.style === 'spark' ? '#9ff8ff' : '#ffd27a' });
  if (!game.isHeadless) game.fx.preset('sparks', x, y, { count: 4, color: pr.style === 'curse' ? '#c77dff' : '#ffe0a0' });
  if (pr.aoe) explode(game, C, x, y, pr.aoe, game.entities.get(pr.sourceId) || null);
}

/** Тик снарядов (order 45). */
export function updateProjectiles(game, C, dt) {
  const ents = game.entities;
  const map = game.map;
  for (const pr of ents.ofKind('projectile')) {
    if (!pr.combat) continue;
    pr.life--;
    const step = pr.speed * dt;
    if (pr.mode === 'hit') {
      const t = ents.get(pr.targetId);
      if (!t || t.dead || t.removed) pr.mode = 'miss';
      else {
        const c = center(t);
        const dx = c.x - pr.x;
        const dy = c.y - pr.y;
        const d = Math.hypot(dx, dy);
        if (d <= step + 0.3) {
          ents.remove(pr, 'hit');
          impactPawn(game, C, pr, t);
          continue;
        }
        pr.vx = (dx / d) * pr.speed;
        pr.vy = (dy / d) * pr.speed;
        pr.dir = Math.atan2(dy, dx);
      }
    }
    const nx = pr.x + pr.vx * dt;
    const ny = pr.y + pr.vy * dt;
    const tx = Math.floor(nx);
    const ty = Math.floor(ny);
    if (tx !== Math.floor(pr.x) || ty !== Math.floor(pr.y)) {
      if (pr.stopX === tx && pr.stopY === ty) {
        ents.remove(pr, 'cover');
        impactWall(game, C, pr, nx, ny);
        const b = map.buildingAt(tx, ty);
        if (b) damageBuilding(game, C, b, 2, null);
        continue;
      }
      const k = projTile(game, tx, ty);
      const fromInside = Math.floor(pr.ox) === tx && Math.floor(pr.oy) === ty;
      if (!fromInside && (k === 2 || (k === 1 && pr.mode !== 'hit' && hash01(tx, ty, pr.id) < 0.45))) {
        ents.remove(pr, 'wall');
        impactWall(game, C, pr, pr.x, pr.y);
        continue;
      }
      if (pr.faction === 'enemy' && C.wardAt?.(tx, ty)) {
        ents.remove(pr, 'ward');
        C.vfx('ward_hit', { x: nx, y: ny });
        continue;
      }
    }
    pr.x = nx;
    pr.y = ny;
    ents.moved(pr);
    if (pr.faction !== 'enemy' && pr.mode === 'free' && C.hasThreads?.()) {
      if (C.hitThreadsAt(nx, ny, 0.5, pr.dmg, pr)) {
        ents.remove(pr, 'thread');
        continue;
      }
    }
    if (pr.mode === 'free') {
      const src = ents.get(pr.sourceId) || { faction: pr.faction, id: pr.sourceId };
      C.R.qbuf2.length = 0;
      const near = ents.queryRadius(nx, ny, 0.6, 'pawn', null, C.R.qbuf2);
      let hitP = null;
      for (const p of near) {
        if (p.id === pr.sourceId || p.dead || p.removed) continue;
        if (!isHostile(src, p)) continue;
        if (p.downed && !pr.aoe) continue;
        hitP = p;
        break;
      }
      if (hitP) {
        ents.remove(pr, 'hit');
        impactPawn(game, C, pr, hitP);
        continue;
      }
    }
    if ((pr.mode === 'aoe' || pr.burstAt) && Math.hypot(pr.tx - nx, pr.ty - ny) <= step) {
      ents.remove(pr, 'burst');
      explode(game, C, pr.tx, pr.ty, pr.aoe, ents.get(pr.sourceId) || null);
      continue;
    }
    if (pr.life <= 0) {
      ents.remove(pr, 'spent');
      if (pr.aoe) explode(game, C, nx, ny, pr.aoe, ents.get(pr.sourceId) || null);
    }
  }
}

/**
 * Взрыв/площадная атака. aoe: {r, dmg, type, fire?, friendly? (доля урона по своим), chill?, color, kind}
 */
export function explode(game, C, x, y, aoe, source) {
  const r = aoe.r || 2;
  const list = game.entities.queryRadius(x, y, r + 0.3, 'pawn');
  const now = game.time.tick;
  for (const p of list) {
    if (p.dead || p.removed || p === source) continue;
    const hostile = source ? isHostile(source, p) : true;
    const mul = hostile ? 1 : aoe.friendly ?? 0.35;
    if (mul <= 0) continue;
    const d = dist(x, y, p.x, p.y);
    const fall = 1 - 0.5 * clamp01(d / r);
    dealDamage(game, C, p, aoe.dmg * fall * mul, { type: aoe.type || 'burn', part: pickPart(game), source, avg: aoe.dmg * 0.75, angle: Math.atan2(p.y - y, p.x - x), aoe: true, spell: aoe.spell });
    if (aoe.chill && !p.dead) applyChill(game, p, aoe.chill.factor, aoe.chill.seconds, aoe.chill.freeze);
    if (aoe.burn && !p.dead) p.burnUntil = Math.max(p.burnUntil || 0, now + secs(aoe.burn));
  }
  if (aoe.fire) {
    const map = game.map;
    const rr = Math.ceil(r);
    for (let yy = Math.floor(y) - rr; yy <= Math.floor(y) + rr; yy++)
      for (let xx = Math.floor(x) - rr; xx <= Math.floor(x) + rr; xx++) {
        const b = map.buildingAt(xx, yy);
        if (b && game.rng.chance(aoe.fire)) C.ignite?.(b, source);
      }
  }
  if (C.hasThreads?.()) C.hitThreadsAt(x, y, r, aoe.dmg, null);
  if (aoe.kind !== 'quiet') {
    game.api.vision.noise(x, y, 25, 'explosion');
    C.sfx(aoe.sfx || 'combat:explosion', x, y);
    C.shakePx(aoe.shake ?? 5);
  }
  C.vfx(aoe.vfx || 'explosion', { x, y, r, color: aoe.color || '#ff9f43' });
  if (!game.isHeadless && aoe.vfx !== 'frost') {
    game.fx.preset('embers', x, y, { count: 16, speed: 3.5, color: aoe.color || '#ffb347', spread: Math.PI * 2, angle: 0 });
    game.fx.preset('smoke', x, y, { count: 4 });
  }
}

// ---------------- Состояния ----------------
/** Замедление/заморозка: pawn.chill = {untilTick, base}; скорость восстанавливается системой. */
export function applyChill(game, p, factor = 0.4, seconds = 4, freezeSeconds = 0) {
  if (!p || p.dead || p.boss) {
    if (p?.boss) p.boss.slowUntil = game.time.tick + secs(seconds * 0.5);
    return;
  }
  const now = game.time.tick;
  if (!p.chill) p.chill = { base: p.speed, untilTick: 0 };
  p.chill.untilTick = Math.max(p.chill.untilTick, now + secs(seconds));
  p.speed = p.chill.base * factor;
  if (freezeSeconds > 0) {
    p.frozenUntil = Math.max(p.frozenUntil || 0, now + secs(freezeSeconds));
    p.speed = 0;
    p.path = null;
  }
}

export function updateStatuses(game, C) {
  const now = game.time.tick;
  for (const p of game.entities.ofKind('pawn')) {
    if (p.chill) {
      if (p.frozenUntil && p.frozenUntil <= now) {
        p.frozenUntil = 0;
        p.speed = p.chill.base * 0.4;
      }
      if (p.chill.untilTick <= now) {
        p.speed = p.chill.base;
        p.chill = null;
        p.frozenUntil = 0;
      }
    }
    if (p.shield && p.shield.untilTick <= now) p.shield = null;
    if (p.burnUntil) {
      if (p.burnUntil <= now) p.burnUntil = 0;
      else if ((now + p.id) % 30 === 0) {
        dealDamage(game, C, p, 2.2, { type: 'burn', part: pickPart(game), source: null, silent: true });
        if (!game.isHeadless) game.fx.preset('embers', p.x, p.y, { count: 3, color: '#ff9f43' });
      }
    }
  }
}

// ---------------- Урон ----------------
/**
 * Единый конвейер урона по пешке/постройке. opts: {type, part, source, crit, avg, angle, ranged, aoe, spell, silent, lethal}
 * @returns {number} нанесённый урон
 */
export function dealDamage(game, C, target, amount, opts = {}) {
  if (!target || target.dead || target.removed || !(amount > 0)) return 0;
  if (target.kind === 'building') return damageBuilding(game, C, target, amount, opts.source);
  if (target.kind !== 'pawn') return 0;
  const now = game.time.tick;
  const type = opts.type || 'blunt';
  const src = opts.source && opts.source.kind ? opts.source : null;
  let amt = amount;
  if (target.boss && C.bossDamageMul) amt *= C.bossDamageMul(target, opts);
  if (target.isLeader && target.faction === 'colony' && C.leaderShieldMul) amt *= C.leaderShieldMul(target);
  // щит рун
  const sh = target.shield;
  if (sh && sh.untilTick > now && sh.hp > 0) {
    const absorb = Math.min(sh.hp, amt);
    sh.hp -= absorb;
    amt -= absorb;
    C.vfx('shield_hit', { targetId: target.id, x: target.x, y: target.y });
    if (sh.hp <= 0) target.shield = null;
  }
  // оберег вагона (Руны пути)
  if (src?.faction === 'enemy' && target.faction === 'colony' && C.wardAt?.(Math.floor(target.x), Math.floor(target.y))) amt *= 0.25;
  // Сердце Гнили: память держит щит у поезда
  if (src?.faction === 'enemy' && target.faction === 'colony' && C.memoryShieldMul) amt *= C.memoryShieldMul(target);
  amt *= 1 - armorReduction(game, target, type);
  if (!(amt > 0.05)) {
    game.events.emit('combat:hit', { attacker: src, target, damage: 0, part: opts.part, type, blocked: true });
    return 0;
  }
  // запасной режим «без сознания» — только пока health — заглушка ядра (настоящий health решает сам)
  let toApply = amt;
  let downNow = false;
  const hp0 = target.health?.hp ?? 100;
  if (isHealthStub(game) && !opts.lethal && !target.downed && !target.boss && !target.simpleHealth && hp0 - amt <= 0 && hp0 > 1.5 && game.rng.next() < (target.faction === 'colony' ? 0.85 : 0.7)) {
    toApply = Math.max(0, hp0 - 1);
    downNow = true;
  }
  target._lastHitBy = src?.id || 0;
  target._lastHitTick = now;
  const dealt = safeNum(game.api.health.applyDamage(target, toApply, { part: opts.part, type, source: src, weapon: src?.equipment?.weapon }), 0, 1e5, toApply);
  if (downNow && !target.dead) {
    target.downed = true;
    if (target.job) game.jobs.endJob(target, 'cancelled');
    target.path = null;
    game.events.emit('combat:downed', { pawn: target, by: src });
  }
  game.events.emit('combat:hit', { attacker: src, target, damage: dealt, part: opts.part, type, crit: !!opts.crit, ranged: !!opts.ranged, spell: opts.spell || null });
  if (dealt > 0) {
    C.gore?.(target, dealt, type, opts.angle);
    if (dealt >= 8 && !target.undead && !target.beast && !target.simpleHealth && !target.dead) game.api.vision.noise(target.x, target.y, 10, 'scream');
    if (!opts.silent) C.damageNumber(target, dealt, !!opts.crit, src);
    if (!opts.silent && !game.isHeadless) C.hitSparks(target.x, target.y, opts.angle ?? 0, type, target);
  }
  const killed = !!target.dead;
  C.juice(src, target, dealt, opts, killed);
  return dealt;
}

/** Урон постройке (огонь, удары врагов, взрывы). */
export function damageBuilding(game, C, b, amount, source) {
  if (!b || b.removed || b.blueprint) return 0;
  const def = game.defs.buildings.get(b.defId);
  if (!def || def.indestructible || def.natural || b.train) return 0;
  const api = game.api.build;
  if (typeof api.damage === 'function' && game.providers.build?.damage) {
    return safeNum(api.damage(b, amount, { source, type: 'combat' }), 0, 1e5, amount);
  }
  b.hp = (b.hp ?? def.hp ?? 100) - amount;
  b._hitT = C.R.clock;
  if (b.hp <= 0) destroyBuilding(game, C, b, source);
  return amount;
}

export function destroyBuilding(game, C, b, source) {
  if (b.removed) return;
  const api = game.api.build;
  const cx = b.x + (b.w || 1) / 2;
  const cy = b.y + (b.h || 1) / 2;
  if (typeof api.destroy === 'function' && game.providers.build?.destroy) api.destroy(b, { source, reason: 'combat' });
  else game.entities.remove(b, 'destroyed');
  game.events.emit('combat:buildingDestroyed', { entity: b, source });
  C.vfx('explosion', { x: cx, y: cy, r: 1, color: '#ffb347' });
  if (!game.isHeadless) game.fx.preset('dust', cx, cy, { count: 16 });
  C.R.burning.delete(b.id);
}

// ---------------- Убийства, трофеи, именное оружие ----------------
export function registerKillHandling(game, C) {
  game.events.on('pawn:died', (payload) => {
    const { pawn, corpse } = payload;
    const now = game.time.tick;
    let src = payload.opts?.source;
    if (!src?.kind && pawn._lastHitBy && now - (pawn._lastHitTick || -1e9) < 900) src = game.entities.get(pawn._lastHitBy) || null;
    if (src?.kind !== 'pawn') src = null;
    const x = corpse ? corpse.x : Math.floor(pawn.x);
    const y = corpse ? corpse.y : Math.floor(pawn.y);
    // вещи погибшего (кроме посоха — его роняет health; страховка ниже)
    dropGearOnDeath(game, C, pawn, x, y);
    if (pawn.faction === 'enemy') {
      C.S.stats.kills++;
      const raid = raidOf(C, pawn);
      if (raid) {
        raid.kills++;
        const left = raid.pawnIds.some((id) => id !== pawn.id && isActiveFoe(game.entities.get(id)));
        if (!left && raid.kind !== 'boss' && game.settings.get('slowMo') !== false) game.slowMo(0.3, 600);
      }
      if (src) creditKill(game, C, src, pawn);
    }
    if (pawn.boss) C.onBossDied?.(pawn, corpse);
    // отражения Лича и щупальца не оставляют тел
    if (corpse && !corpse.removed && (pawn.enemyId === 'lich_clone' || pawn.enemyId === 'rot_tendril')) game.entities.remove(corpse, 'vanished');
    if (pawn.prisoner) C.freePrisonerBed?.(pawn);
    if (pawn.puppet) pawn.puppet = null;
    pawn.drafted = false;
    if (corpse && pawn.raisedFrom) {
      // поднятый Личом павший снова становится собой — его ещё можно похоронить
      const rf = pawn.raisedFrom;
      Object.assign(corpse, { pawnId: rf.pawnId, name: rf.name, color: rf.color, faction: rf.faction, wasLeader: !!rf.wasLeader, diedTick: rf.diedTick ?? corpse.diedTick, cause: rf.cause || corpse.cause, rot: rf.rot ?? corpse.rot });
    }
  }, 'combat');
}

function dropGearOnDeath(game, C, pawn, x, y) {
  const eq = pawn.equipment;
  if (!eq) return;
  const rng = game.rng;
  const leader = game.getLeader();
  const magnet = pawn.faction === 'enemy' && leader && !leader.dead && dist(leader.x, leader.y, x + 0.5, y + 0.5) <= 3;
  let k = 0;
  const put = (defId, count, meta) => {
    const tx = magnet ? Math.floor(leader.x) : x;
    const ty = magnet ? Math.floor(leader.y) : y;
    if (meta) spawnGear(game, defId, meta, tx, ty);
    else game.items.spawn(defId, count, tx, ty);
    if (magnet) C.vfx('loot', { x0: x + 0.5, y0: y + 0.5, defId, targetId: leader.id, delay: k++ * 0.09 });
  };
  if (eq.weapon === 'conductor_staff') {
    // health уже мог уронить посох — проверяем, не появился ли он на карте
    const exists = [...game.entities.ofKind('item')].some((it) => it.defId === 'conductor_staff') || game.colonists().some((p) => hasStaff(p));
    if (!exists) {
      spawnGear(game, 'conductor_staff', null, x, y);
      if (pawn.isLeader || pawn.id === game.colony.leaderId) {
        game.api.ui.setObjective('take_staff', game.t('combat.staff.objective'), { x, y });
      }
    }
    eq.weapon = null;
  } else if (eq.weapon && game.defs.items.get(eq.weapon)?.weapon) {
    if (pawn.faction !== 'enemy' || rng.chance(0.85)) put(eq.weapon, 1, eq.weaponMeta || { quality: 'normal' });
    eq.weapon = null;
  }
  if (eq.armor && game.defs.items.has(eq.armor)) {
    if (pawn.faction !== 'enemy' || rng.chance(0.7)) put(eq.armor, 1, eq.armorMeta || { quality: 'normal' });
    eq.armor = null;
  }
  for (const l of pawn.loot || []) if (game.defs.items.has(l.defId) && l.count > 0) {
    if (game.defs.items.get(l.defId).stackLimit === 1) put(l.defId, 1, l.meta || { quality: l.quality || 'normal' });
    else put(l.defId, l.count, null);
  }
  pawn.loot = [];
}

/** Убийство засчитывается оружию и стрелку: опыт лидера, именное оружие. */
export function creditKill(game, C, killer, victim) {
  killer.kills = (killer.kills || 0) + 1;
  const ed = victim.enemyId && game.defs.enemies.get(victim.enemyId);
  if (killer.isLeader && killer.faction === 'colony') C.grantXp?.(killer, ed?.xp ?? 10, 'kill');
  const eq = killer.equipment;
  const wid = eq?.weapon;
  if (!wid || killer.faction !== 'colony' || !game.defs.items.get(wid)?.weapon) return;
  const meta = (eq.weaponMeta ||= { quality: 'normal', kills: 0 });
  meta.kills = (meta.kills || 0) + 1;
  if (meta.kills >= 10 && !meta.nick && wid !== 'conductor_staff') {
    const list = game.i18n.raw('combat.nicknames');
    const base = Array.isArray(list) && list.length ? game.rng.pick(list) : 'Кочерга';
    const nick = meta.maker ? game.t('combat.nick.withMaker', { nick: base, maker: meta.maker }) : base;
    meta.nick = nick;
    game.events.emit('combat:weaponNamed', { item: meta, name: nick, pawn: killer, defId: wid });
    game.api.mind.addThought(killer, 'named_weapon', { weaponName: nick, source: killer });
    game.api.ui.notify(game.t('combat.nick.named', { who: killer.name, weapon: game.t(game.defs.items.get(wid).nameKey), nick }), { type: 'good', pawnId: killer.id });
    game.api.mind.say(killer, game.t('combat.nick.say', { nick, variant: meta.kills + killer.id }));
  }
}

// ---------------- Сочность удара ----------------
export function installJuice(game, C) {
  C.shakePx = (px) => {
    if (game.settings.get('shake') === false) return;
    const zoom = game.camera?.zoom || 1.25;
    const amount = Math.sqrt(Math.max(0, px) / (0.35 * TILE * zoom));
    game.api.av.shake(Math.min(1.2, amount));
  };
  C.juice = (src, target, dmg, opts, killed) => {
    const leader = game.getLeader();
    const involves = !!leader && (src === leader || target === leader);
    const avg = opts.avg || dmg;
    const crit = !!opts.crit || (avg > 0 && dmg >= 2 * avg);
    if (!(involves || crit || killed) || !(dmg > 0)) return;
    const k = clamp01(dmg / 40);
    const t = realNow();
    if (game.settings.get('hitStop') !== false && t - C.R.lastHitStop >= 150) {
      C.R.lastHitStop = t;
      game.api.av.hitStop(Math.round(50 + 30 * k));
    }
    const fl = game.settings.get('flashes');
    if (fl !== false && fl !== 'off') {
      const ms = fl === 'reduced' ? 40 : 80;
      game.api.av.flash(target, ms);
      if (!game.providers.av?.flash) target._flashUntil = C.R.clock + ms / 1000;
    }
    if (!game.isHeadless) {
      const preset = game.defs.fxPresets.has('hit_sparks') ? 'hit_sparks' : 'combat:hit_sparks';
      game.fx.preset(preset, target.x, target.y, { angle: opts.angle ?? 0 });
    }
    C.shakePx(2 + 4 * k);
  };
  C.damageNumber = (target, dmg, crit, src) => {
    if (game.settings.get('damageNumbers') === false) return;
    if (game.isHeadless) return;
    const color = target.faction === 'colony' ? '#ff6b7a' : crit ? '#ffd27a' : '#e8ecff';
    const text = `${Math.max(1, Math.round(dmg))}${crit ? '!' : ''}`;
    game.api.av.floatText(target.x, target.y - 0.6, text, color);
    if (!game.providers.av?.floatText) C.vfx('float', { x: target.x + (Math.random() - 0.5) * 0.3, y: target.y - 0.5, text, color, big: crit });
    void src;
  };
  C.floatMiss = (target) => {
    if (game.isHeadless || game.settings.get('damageNumbers') === false) return;
    const text = game.t('combat.ui.miss');
    game.api.av.floatText(target.x, target.y - 0.6, text, '#8c93b8');
    if (!game.providers.av?.floatText) C.vfx('float', { x: target.x, y: target.y - 0.5, text, color: '#8c93b8' });
  };
  C.floatText = (x, y, text, color = '#e8ecff') => {
    if (game.isHeadless) return;
    game.api.av.floatText(x, y, text, color);
    if (!game.providers.av?.floatText) C.vfx('float', { x, y, text, color });
  };
  C.hitSparks = (x, y, angle, type, target) => {
    const flesh = !target.undead && !target.simpleHealth;
    const color = type === 'burn' ? '#ff9f43' : type === 'frost' ? '#bfe8ff' : type === 'rune' ? '#9ff8ff' : flesh ? '#ff3d6e' : '#e8f4ff';
    game.fx.emit(x, y, { count: 5, speed: 3.2, angle: angle || 0, spread: 1.1, life: 0.3, size: 1.6, color, gravity: 4, drag: 3, glow: true });
  };
  C.sfx = (id, x, y, opts) => {
    if (game.isHeadless) return;
    game.api.av.play(id, { x, y, ...(opts || {}) });
  };
  C.playTink = () => {
    const t = realNow();
    if (t - C.R.tink.last > 1000) C.R.tink.n = 0;
    C.R.tink.last = t;
    const pitch = 1 + Math.min(12, C.R.tink.n++) * 0.09;
    const id = game.defs.sfx.has('loot_tink') ? 'loot_tink' : 'combat:loot_tink';
    game.api.av.play(id, { pitch });
  };
  C.gearLabel = (defId, meta) => gearLabel(game, defId, meta);
}
