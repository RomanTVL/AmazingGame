// Боссы: Костяной дракон (летает, «серое пламя» линией с предупреждением, призыв скелетов, позвонок-уязвимость),
// Лич-кукловод (бьёт проклятиями, телепорт, клоны, поднимает непогребённых, проклинает постройки, нити к унылым),
// Сердце Гнили (неподвижно, щупальца и волны, темнота, «безымянность», щит памяти у поезда).
import { dist, distToSegment, lineTiles, clamp } from '../../core/math.js';
import { TICKS_PER_DAY } from '../../core/constants.js';
import { makeEnemy, newRaid, findEntry, raidOf, isActiveFoe } from './enemies.js';
import { dealDamage, pickPart, damageBuilding, spawnProjectile } from './fight.js';
import { engage, approach, nearestHostile } from './ai.js';
import { spawnGear } from './items.js';
import { secs } from './state.js';

export const BOSS_IDS = ['bone_dragon', 'lich', 'rot_heart'];
const ALIAS = { dragon: 'bone_dragon', bone: 'bone_dragon', puppeteer: 'lich', lich_puppeteer: 'lich', heart: 'rot_heart', rot: 'rot_heart', heart_of_rot: 'rot_heart' };

/** Позвонок дракона (уязвимое место) — на основании хвоста, за спиной. */
export const VERTEBRA_OFF = 1.6;
export function dragonVertebra(p) {
  const a = p.dir || 0;
  return { x: p.x - Math.cos(a) * VERTEBRA_OFF, y: p.y - Math.sin(a) * VERTEBRA_OFF };
}

const phaseOf = (p) => {
  const r = (p.health?.hp ?? 1) / (p.health?.maxHp ?? 1);
  return r > 0.66 ? 1 : r > 0.33 ? 2 : 3;
};

export function installBosses(game, C) {

  /** Призвать босса. @returns {{id, faction, count, pawnIds, kind, bossId}|null} */
  C.spawnBoss = (id, opts = {}) => {
    if (!game.map) return null;
    const bossId = BOSS_IDS.includes(id) ? id : ALIAS[id] || 'bone_dragon';
    const rng = game.rng;
    const home = game.train?.stamped ? game.train.center() : game.getLeader() || { x: game.map.w / 2, y: game.map.h / 2 };
    let spot;
    if (opts.x !== undefined) spot = { x: Math.floor(opts.x), y: Math.floor(opts.y) };
    else if (bossId === 'rot_heart') {
      const side = rng.chance(0.5) ? -1 : 1;
      spot = game.map.randomPassableNear(rng, home.x + rng.int(-12, 12), home.y + side * 20, 6, 40) || findEntry(game, opts.edge);
    } else spot = findEntry(game, opts.edge);
    if (!spot) return null;
    const raid = newRaid(C, 'boss', 'boss', 0, game.time.tick);
    raid.phase = 'attack';
    const now = game.time.tick;
    const boss = makeEnemy(game, C, bossId, spot.x, spot.y, {
      raidId: raid.id,
      extra: { boss: { id: bossId, phase: 1, born: now, breathAt: now + secs(12), summonAt: now + secs(18), raiseAt: now + secs(10), curseAt: now + secs(16), threadAt: now + secs(8), tpHp: 1, spawnAt: now + secs(6), waveAt: now + secs(40), namelessAt: now + secs(20), weakUntil: 0, breath: null, cursed: [] } },
    });
    if (!boss) return null;
    raid.pawnIds.push(boss.id);
    raid.bossId = boss.id;
    raid.initial = 1;
    C.S.raids.push(raid);
    C.S.stats.raids++;
    if (bossId === 'rot_heart') C.R.heartId = boss.id;
    if (bossId === 'lich') raiseUnburied(game, C, boss, raid);
    game.api.vision.report(game.t(`combat.boss.${bossId}.arrive`), { type: 'danger', x: spot.x, y: spot.y });
    C.sfx('combat:roar', spot.x, spot.y);
    C.shakePx(6);
    game.events.emit('combat:raidStarted', { raidId: raid.id, raid, faction: 'boss', count: 1, kind: 'boss', bossId });
    game.events.emit('combat:bossSpawned', { pawn: boss, id: bossId });
    return { id: raid.id, faction: 'boss', count: 1, pawnIds: [boss.id], kind: 'boss', bossId, pawnId: boss.id };
  };

  /** Свободный снаряд долетел до открытого позвонка дракона? @returns {object|null} дракон */
  C.vertebraHit = (x, y) => {
    for (const e of C.R.enemies) {
      if (e.boss?.id !== 'bone_dragon' || !(e.boss.weakUntil > game.time.tick)) continue;
      const v = dragonVertebra(e);
      if ((v.x - x) ** 2 + (v.y - y) ** 2 <= 0.7 * 0.7) return e;
    }
    return null;
  };
  // ---------- Урон боссам и щиты ----------
  C.bossDamageMul = (target, opts) => {
    const b = target.boss;
    if (!b) return 1;
    let m = 1;
    // светящийся позвонок: ×3 только по попаданию в него (точка удара/снаряда рядом с позвонком)
    if (b.id === 'bone_dragon' && b.weakUntil > game.time.tick && Number.isFinite(opts?.hitX)) {
      const v = dragonVertebra(target);
      if (dist(opts.hitX, opts.hitY, v.x, v.y) <= 1.0) {
        m *= 3;
        C.vfx('spark', { x: v.x, y: v.y, a: 0, color: '#ffd27a' });
      }
    }
    if (b.slowUntil > game.time.tick) m *= 1.1;
    // заклинания лидера по боссам — вчетверо сильнее (MVP-4: магия должна решать, мана — узкое место)
    if (opts?.spell) m *= 4;
    return m;
  };
  /** Щит памяти: у поезда урон по поселенцам ниже, пока жив Сердце Гнили. */
  C.memoryShieldMul = (target) => {
    if (!C.R.heartId) return 1;
    const c = game.train?.stamped ? game.train.center() : null;
    if (!c || dist(target.x, target.y, c.x, c.y) > 12) return 1;
    const mem = clamp(game.api.health.getMemory() ?? 0, 0, 100);
    return 1 - mem / 200;
  };

  // ---------- Нити Лича ----------
  C.hasThreads = () => C.S.threads.length > 0;
  const threadMid = (t) => {
    const a = game.entities.get(t.lichId);
    const b = game.entities.get(t.pawnId);
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  C.threadMid = threadMid;
  C.cutThread = (t, reason = 'cut') => {
    const i = C.S.threads.indexOf(t);
    if (i >= 0) C.S.threads.splice(i, 1);
    const p = game.entities.get(t.pawnId);
    if (p) {
      p.puppet = null;
      if (p.job?.type === 'combat:fight') game.jobs.endJob(p, 'cancelled');
      game.api.ui.notify(game.t('combat.boss.lich.threadCut', { name: p.name }), { type: 'good', pawnId: p.id });
      game.api.mind.addThought(p, 'was_puppet', {});
      const m = threadMid(t) || p;
      C.vfx('thread_cut', { x: m.x, y: m.y });
    }
    game.events.emit('combat:threadCut', { pawn: p || null, reason });
  };
  C.hitThreadsAt = (x, y, r, dmg) => {
    let hit = false;
    for (const t of C.S.threads.slice()) {
      const m = threadMid(t);
      if (!m || dist(m.x, m.y, x, y) > r + 0.7) continue;
      t.hp -= dmg;
      hit = true;
      C.vfx('spark', { x: m.x, y: m.y, a: 0, color: '#ff7ae0' });
      if (t.hp <= 0) C.cutThread(t, 'hit');
    }
    return hit;
  };
  /** Голос лидера (R / Окрик) рвёт нити в радиусе. @returns {number} */
  C.voiceCleanse = (L, r) => {
    let n = 0;
    for (const t of C.S.threads.slice()) {
      const p = game.entities.get(t.pawnId);
      if (p && dist(p.x, p.y, L.x, L.y) <= r) {
        C.cutThread(t, 'voice');
        n++;
      }
    }
    return n;
  };

  /** Позвать безымянного по имени (E лидера). */
  C.callByName = (L, p) => {
    if (!p?.nameless) return false;
    p.nameless = false;
    if (p.job?.type === 'combat:fight') game.jobs.endJob(p, 'cancelled');
    game.api.mind.say(L, game.t('combat.boss.rot_heart.callName', { name: (p.name || '').split(' ')[0] }));
    game.api.mind.addThought(p, 'called_by_name', { source: L });
    game.api.ui.notify(game.t('combat.boss.rot_heart.named', { name: p.name }), { type: 'good', pawnId: p.id });
    C.vfx('voice_ring', { x: p.x, y: p.y, r: 2, targetId: p.id, color: '#ffffff' });
    return true;
  };

  C.onBossDied = (pawn, corpse) => {
    const id = pawn.boss?.id;
    const raid = raidOf(C, pawn);
    // призванные рассыпаются, твари бегут
    if (raid) for (const mid of raid.pawnIds) {
      const m = game.entities.get(mid);
      if (!m || m === pawn || m.dead) continue;
      if (m.summoned) game.api.health.kill(m, 'unbound', {});
      else m.leaving = true;
    }
    if (id === 'lich') {
      for (const t of C.S.threads.slice()) C.cutThread(t, 'lichDied');
      for (const bid of pawn.boss.cursed || []) {
        const b = game.entities.get(bid);
        if (b) b.cursedUntil = 0;
      }
      const x = corpse ? corpse.x : Math.floor(pawn.x);
      const y = corpse ? corpse.y : Math.floor(pawn.y);
      spawnGear(game, 'heart_crystal', null, x, y);
      game.api.ui.notify(game.t('combat.boss.lich.crystal'), { type: 'good', x, y });
    }
    if (id === 'rot_heart') {
      C.R.heartId = 0;
      for (const p of C.R.colony) if (p.nameless) p.nameless = false;
    }
    if (!C.S.stats.bossesDefeated.includes(id)) C.S.stats.bossesDefeated.push(id);
    game.api.ui.notify(game.t(`combat.boss.${id}.defeated`), { type: 'good' });
    game.events.emit('boss:defeated', { id, pawn, corpse: corpse || null });
    if (game.settings.get('slowMo') !== false) game.slowMo(0.25, 900);
    C.shakePx(6);
  };

  // ---------- Поведение ----------
  C.bossTick = (p, job, dt) => {
    const b = p.boss;
    if (!b) return 'done';
    const now = game.time.tick;
    const ph = phaseOf(p);
    if (ph !== b.phase) {
      b.phase = ph;
      const txt = game.t(`combat.boss.${b.id}.phase${ph}`);
      if (txt) game.api.vision.report(txt, { type: 'danger', x: p.x, y: p.y });
      C.sfx('combat:roar', p.x, p.y);
      C.shakePx(5);
      if (b.id === 'lich') spawnClones(game, C, p, 1 + ph);
    }
    if (b.id === 'bone_dragon') return dragonTick(game, C, p, b, now, dt);
    if (b.id === 'lich') return lichTick(game, C, p, b, now);
    if (b.id === 'rot_heart') return heartTick(game, C, p, b, now);
    return 'running';
  };
}

function summon(game, C, boss, defId, n, r = 3, extra = {}) {
  const raid = raidOf(C, boss);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const spot = game.map.randomPassableNear(game.rng, boss.x, boss.y, r, 20);
    if (!spot) continue;
    const m = makeEnemy(game, C, defId, spot.x, spot.y, { raidId: raid?.id || 0, extra: { summoned: true, ...extra } });
    if (m) {
      raid?.pawnIds.push(m.id);
      if (raid) raid.initial++;
      C.vfx('summon', { x: m.x, y: m.y, color: game.defs.enemies.get(defId)?.color || '#e8f4ff' });
      k++;
    }
  }
  return k;
}

const countSummons = (game, C, boss, defId) => {
  const raid = raidOf(C, boss);
  let n = 0;
  if (raid) for (const id of raid.pawnIds) {
    const m = game.entities.get(id);
    if (m && isActiveFoe(m) && m.enemyId === defId) n++;
  }
  return n;
};

// --- Костяной дракон ---
function dragonTick(game, C, p, b, now, dt) {
  // телеграф «серого пламени»
  if (b.breath) {
    p._flyX = undefined;
    if (now >= b.breath.fireAt) {
      breathFire(game, C, p, b.breath);
      b.breath = null;
      b.weakUntil = now + secs(2);
      b.breathAt = now + secs(b.phase === 3 ? 28 : 40);
    }
    return 'running';
  }
  let t = game.entities.get(p._tgt);
  if (!t || t.dead || t.downed || (now + p.id) % 30 === 0) {
    t = nearestHostile(game, C, p, { maxD: 80 });
    p._tgt = t?.id || 0;
  }
  if (now >= b.breathAt && t) {
    const ang = Math.atan2(t.y - p.y, t.x - p.x);
    b.breath = { x0: p.x, y0: p.y, ang, len: 14, fireAt: now + secs(1.6) };
    C.sfx('combat:roar', p.x, p.y);
    game.api.vision.noise(p.x, p.y, 25, 'roar');
    return 'running';
  }
  if (now >= b.summonAt) {
    b.summonAt = now + secs(35);
    // скелеты — только со второй фазы (MVP-4: баланс для троих)
    if (b.phase >= 2 && countSummons(game, C, p, 'skeleton') + countSummons(game, C, p, 'skeleton_archer') < 2) {
      summon(game, C, p, 'skeleton', b.phase - 1, 3);
      if (b.phase >= 3) summon(game, C, p, 'skeleton_archer', 1, 3);
      game.api.vision.report(game.t('combat.boss.bone_dragon.summon'), { type: 'bad', x: p.x, y: p.y });
    }
  }
  if (t) {
    const d = dist(p.x, p.y, t.x, t.y);
    if (d > 2.6) {
      // кружит рядом с целью
      const a = Math.atan2(p.y - t.y, p.x - t.x) + 0.02;
      approach(game, p, t.x + Math.cos(a) * 2, t.y + Math.sin(a) * 2);
    } else engage(game, C, p, t);
  }
  void dt;
  return 'running';
}

function breathFire(game, C, p, br) {
  const x1 = br.x0 + Math.cos(br.ang) * br.len;
  const y1 = br.y0 + Math.sin(br.ang) * br.len;
  const now = game.time.tick;
  for (const o of C.R.colony) {
    if (o.dead) continue;
    if (distToSegment(o.x, o.y, br.x0, br.y0, x1, y1) <= 1.1) {
      dealDamage(game, C, o, 15, { type: 'burn', part: pickPart(game), source: p, avg: 15, angle: br.ang, aoe: true });
      if (!o.dead) o.burnUntil = Math.max(o.burnUntil || 0, now + secs(2));
    }
  }
  const map = game.map;
  const seen = new Set();
  let faded = 0;
  lineTiles(br.x0, br.y0, x1, y1, (x, y) => {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
      const b = map.buildingAt(x + dx, y + dy);
      if (!b || seen.has(b.id)) continue;
      seen.add(b.id);
      const def = game.defs.buildings.get(b.defId);
      if (!def || def.natural) continue;
      if (!b.faded) {
        b.faded = true;
        faded++;
        map.touch(b.x, b.y, b.w || 1, b.h || 1);
        game.events.emit('combat:faded', { entity: b });
      }
      if (!b.train) damageBuilding(game, C, b, 10, p);
    }
    return true;
  });
  C.vfx('breath', { x0: br.x0, y0: br.y0, x1, y1 });
  game.api.vision.noise(br.x0, br.y0, 25, 'explosion');
  C.sfx('combat:breath', br.x0, br.y0);
  C.shakePx(5);
  if (faded) game.api.vision.report(game.t('combat.boss.bone_dragon.faded', { n: faded }), { type: 'bad', x: x1, y: y1 });
}

// --- Лич-кукловод ---
function raiseUnburied(game, C, lich, raid) {
  let n = 0;
  for (const c of game.entities.listKind('corpse')) {
    if (c.faction !== 'colony' || c.buried || c.inGrave || c.grave) continue;
    const name = game.t('combat.boss.lich.unburied', { name: (c.name || '').split(' ')[0] || c.name });
    const raisedFrom = { pawnId: c.pawnId, name: c.name, color: c.color, faction: c.faction, wasLeader: !!c.wasLeader, diedTick: c.diedTick, cause: c.cause, rot: c.rot };
    const m = makeEnemy(game, C, 'ghoul', c.x, c.y, { raidId: raid.id, name, raisedFrom, extra: { color: c.color || '#9dffb0', unburied: true } });
    if (!m) continue;
    game.entities.remove(c, 'raised');
    raid.pawnIds.push(m.id);
    raid.initial++;
    n++;
    C.vfx('summon', { x: m.x, y: m.y, color: '#c77dff' });
  }
  if (n) game.api.vision.report(game.t('combat.boss.lich.raisedFallen', { n }), { type: 'danger' });
  return n;
}

function spawnClones(game, C, lich, n) {
  if (countSummons(game, C, lich, 'lich_clone') >= 4) return;
  summon(game, C, lich, 'lich_clone', n, 5, { name: lich.name });
  C.vfx('blink', { x: lich.x, y: lich.y, x2: lich.x, y2: lich.y });
}

function lichTick(game, C, p, b, now) {
  const hpR = (p.health?.hp ?? 1) / (p.health?.maxHp ?? 1);
  // телепорт после серьёзного урона
  if (b.tpHp - hpR >= 0.12) {
    b.tpHp = hpR;
    const spot = game.map.randomPassableNear(game.rng, p.x + game.rng.range(-10, 10), p.y + game.rng.range(-10, 10), 4, 20);
    if (spot) {
      C.vfx('blink', { x: p.x, y: p.y, x2: spot.x + 0.5, y2: spot.y + 0.5 });
      p.x = spot.x + 0.5;
      p.y = spot.y + 0.5;
      p.path = null;
      game.entities.moved(p);
      C.sfx('combat:blink', p.x, p.y);
      if (b.phase >= 2) spawnClones(game, C, p, 1);
    }
  }
  // подъём мёртвых врагов
  if (now >= b.raiseAt) {
    b.raiseAt = now + secs(30);
    const raid = raidOf(C, p);
    let k = 0;
    for (const c of game.entities.queryRadius(p.x, p.y, 14, 'corpse')) {
      if (k >= 2 + b.phase || c.faction === 'colony') continue;
      const m = makeEnemy(game, C, 'skeleton', c.x, c.y, { raidId: raid?.id || 0, extra: { summoned: true } });
      if (!m) continue;
      game.entities.remove(c, 'raised');
      raid?.pawnIds.push(m.id);
      if (raid) raid.initial++;
      C.vfx('summon', { x: m.x, y: m.y, color: '#c77dff' });
      k++;
    }
    if (k) game.api.vision.report(game.t('combat.boss.lich.raise', { n: k }), { type: 'bad', x: p.x, y: p.y });
  }
  // проклятие построек
  if (now >= b.curseAt) {
    b.curseAt = now + secs(20);
    const list = game.entities.queryRadius(p.x, p.y, 14, 'building', (e) => !e.blueprint && !game.defs.buildings.get(e.defId)?.natural && !(e.cursedUntil > now));
    if (list.length) {
      const e = list[game.rng.int(0, list.length - 1)];
      e.cursedUntil = now + secs(20);
      (b.cursed ||= []).push(e.id);
      if (b.cursed.length > 12) b.cursed.shift();
      C.vfx('curse', { x: e.x + (e.w || 1) / 2, y: e.y + (e.h || 1) / 2 });
    }
  }
  if (now % 60 === 0) for (const id of b.cursed || []) {
    const e = game.entities.get(id);
    if (e && e.cursedUntil > now && !e.train) damageBuilding(game, C, e, 3, p);
  }
  // нити к унылым (настроение < 0.35)
  if (now >= b.threadAt) {
    b.threadAt = now + secs(15);
    const mine = C.S.threads.filter((t) => t.lichId === p.id).length;
    if (mine < 3) {
      for (const c of C.R.colony) {
        if (c.isLeader || c.puppet || c.downed || c.dead || c.nameless) continue;
        if (dist(c.x, c.y, p.x, p.y) > 30) continue;
        if (game.api.mind.getMood(c) >= 0.35) continue;
        C.S.threads.push({ lichId: p.id, pawnId: c.id, hp: 30 });
        c.puppet = { lichId: p.id };
        if (c.drafted) c.drafted = false;
        if (c.job) game.jobs.endJob(c, 'cancelled');
        game.api.vision.report(game.t('combat.boss.lich.thread', { name: c.name }), { type: 'danger', x: c.x, y: c.y, pawnId: c.id });
        game.events.emit('combat:threadAttached', { pawn: c, lich: p });
        break;
      }
    }
  }
  // держит дистанцию и бьёт проклятиями
  let t = game.entities.get(p._tgt);
  if (!t || t.dead || t.downed || (now + p.id) % 30 === 0) {
    t = nearestHostile(game, C, p, { maxD: 60 });
    p._tgt = t?.id || 0;
  }
  if (t) {
    const d = dist(p.x, p.y, t.x, t.y);
    if (d < 4.5 && (now + p.id) % 40 === 0) {
      const a = Math.atan2(p.y - t.y, p.x - t.x);
      approach(game, p, p.x + Math.cos(a) * 5, p.y + Math.sin(a) * 5, false);
    } else engage(game, C, p, t);
  }
  return 'running';
}

// --- Сердце Гнили ---
function heartTick(game, C, p, b, now) {
  C.R.heartId = p.id;
  if (now >= b.spawnAt) {
    b.spawnAt = now + secs(12);
    if (countSummons(game, C, p, 'rot_tendril') < 4 + b.phase) summon(game, C, p, 'rot_tendril', 1, 5);
  }
  if (now >= b.waveAt) {
    b.waveAt = now + secs(60);
    const raid = raidOf(C, p);
    const entry = findEntry(game, null, {});
    if (entry && raid) {
      for (let i = 0; i < 1 + b.phase; i++) {
        const s = game.map.randomPassableNear(game.rng, entry.x, entry.y, 3, 16) || entry;
        const m = makeEnemy(game, C, 'rot_wolf', s.x, s.y, { raidId: raid.id });
        if (m) {
          raid.pawnIds.push(m.id);
          raid.initial++;
        }
      }
      game.api.vision.report(game.t('combat.boss.rot_heart.wave'), { type: 'danger', x: entry.x, y: entry.y });
    }
  }
  if (now >= b.namelessAt) {
    const mem = clamp(game.api.health.getMemory() ?? 0, 0, 100);
    b.namelessAt = now + Math.round(secs(20) * (1 + (50 - mem) / 100));
    const cands = C.R.colony.filter((c) => !c.isLeader && !c.nameless && !c.downed && !c.puppet);
    const n = Math.min(cands.length, game.rng.int(1, 2));
    for (let i = 0; i < n; i++) {
      const c = cands.splice(game.rng.int(0, cands.length - 1), 1)[0];
      c.nameless = true;
      if (c.drafted) c.drafted = false;
      if (c.order) c.order = null;
      if (c.job) game.jobs.endJob(c, 'cancelled');
      game.api.vision.report(game.t('combat.boss.rot_heart.nameless', { name: c.name }), { type: 'danger', pawnId: c.id, x: c.x, y: c.y });
      game.events.emit('combat:nameless', { pawn: c });
    }
  }
  // хлещет всех, кто подошёл
  let t = game.entities.get(p._tgt);
  if (!t || t.dead || (now + p.id) % 20 === 0) {
    t = nearestHostile(game, C, p, { maxD: 4, allowDowned: true, filter: (o) => !o.nameless });
    p._tgt = t?.id || 0;
  }
  if (t) engage(game, C, p, t, { hold: true });
  // плевок гнилью по дальним
  else if ((now + p.id) % secs(4) === 0) {
    const far = nearestHostile(game, C, p, { maxD: 14 });
    if (far) {
      spawnProjectile(game, C, p.x, p.y, far.x, far.y, { sourceId: p.id, faction: 'enemy', style: 'curse', speed: 12, type: 'burn', dmg: 9, avg: 9, part: pickPart(game), range: 16, mode: 'hit', targetId: far.id });
    }
  }
  return 'running';
}

/** Простой рассказчик (если нет модуля journey): иногда рейды, на поздних днях — боссы. */
export function autoStoryteller(game, C) {
  const S = C.S;
  const now = game.time.tick;
  if (now < S.autoRaidTick) return;
  if (C.R.hostiles > 0) {
    S.autoRaidTick = now + secs(120);
    return;
  }
  const rng = game.rng;
  const day = game.time.day;
  S.autoRaidN++;
  const cap = 25 + game.colonists().filter((p) => !p.downed).length * 22;
  const points = Math.min(cap, Math.round(20 + day * 4 + S.autoRaidN * 4));
  const faction = rng.pick(day < 4 ? ['bandits', 'rot_beasts'] : ['bandits', 'bandits', 'cultists', 'undead', 'rot_beasts']);
  C.spawnRaid({ points, faction, edge: rng.pick(['north', 'south', 'west', 'east']) });
  S.autoRaidTick = now + Math.round(TICKS_PER_DAY * rng.range(4, 6));
}
