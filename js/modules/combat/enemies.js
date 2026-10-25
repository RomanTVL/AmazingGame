// Враги: реестр game.defs.enemies, фракции, генератор рейдов, отслеживание рейдов (мораль, грабёж, отход).
import { createPawn, generateName } from '../../sim/pawn.js';
import { TICKS_PER_DAY } from '../../core/constants.js';
import { dist } from '../../core/math.js';
import { secs } from './state.js';

/**
 * EnemyDef: {id, nameKey, faction, hp, speed, weapon? (defId предмета), natural? (WEAPON_STATS), armorItem?, armor? {type: снижение},
 *  skills {melee, shooting}, points (стоимость в рейде), xp, role ('melee'|'ranged'|'arsonist'|'leader'|'caster'|'beast'),
 *  drawAs, color, humanoid, undead?, beast?, capturable?, named? (человеческое имя), size, boss?, stationary?, flying?}
 */
export const ENEMY_DEFS = [
  // разбойники
  { id: 'bandit_thug', faction: 'bandits', hp: 100, speed: 3.9, weapon: ['club', 'knife', 'short_sword'], skills: { melee: 4, shooting: 2 }, points: 25, xp: 12, role: 'melee', drawAs: 'enemy_bandit', color: '#ff7a3d', humanoid: true, capturable: true, named: true },
  { id: 'bandit_archer', faction: 'bandits', hp: 90, speed: 3.9, weapon: ['bow'], skills: { melee: 2, shooting: 4 }, points: 30, xp: 14, role: 'ranged', drawAs: 'enemy_bandit', color: '#ffb347', humanoid: true, capturable: true, named: true },
  { id: 'bandit_crossbow', faction: 'bandits', hp: 95, speed: 3.7, weapon: ['crossbow'], armorItem: 'armor_leather', skills: { melee: 3, shooting: 5 }, points: 38, xp: 16, role: 'ranged', drawAs: 'enemy_bandit', color: '#ffd27a', humanoid: true, capturable: true, named: true },
  { id: 'bandit_torch', faction: 'bandits', hp: 90, speed: 4.1, weapon: ['knife'], skills: { melee: 4, shooting: 2 }, points: 28, xp: 12, role: 'arsonist', drawAs: 'enemy_bandit', color: '#ff5f3d', humanoid: true, capturable: true, named: true },
  { id: 'bandit_chief', faction: 'bandits', hp: 140, speed: 3.8, weapon: ['axe'], armorItem: 'armor_chain', skills: { melee: 9, shooting: 4 }, points: 65, xp: 30, role: 'leader', drawAs: 'enemy_bandit', color: '#ff4f4f', humanoid: true, capturable: true, named: true, size: 1.1 },
  // культисты Гнили
  { id: 'cultist_acolyte', faction: 'cultists', hp: 85, speed: 4.0, weapon: ['knife'], skills: { melee: 4, shooting: 2 }, points: 24, xp: 12, role: 'melee', drawAs: 'enemy_cultist', color: '#9dff5a', humanoid: true, capturable: true, named: true },
  { id: 'cultist_zealot', faction: 'cultists', hp: 110, speed: 3.8, weapon: ['spear'], armorItem: 'armor_leather', skills: { melee: 5, shooting: 2 }, points: 36, xp: 16, role: 'melee', drawAs: 'enemy_cultist', color: '#c3ff6a', humanoid: true, capturable: true, named: true },
  { id: 'cultist_hexer', faction: 'cultists', hp: 80, speed: 3.6, weapon: ['rune_staff'], skills: { melee: 2, magic: 7, shooting: 4 }, points: 42, xp: 20, role: 'caster', drawAs: 'enemy_cultist', color: '#7dff9a', humanoid: true, capturable: true, named: true },
  { id: 'cultist_firebrand', faction: 'cultists', hp: 85, speed: 4.1, weapon: ['club'], skills: { melee: 4, shooting: 2 }, points: 30, xp: 14, role: 'arsonist', drawAs: 'enemy_cultist', color: '#ffd23d', humanoid: true, capturable: true, named: true },
  // нежить
  { id: 'skeleton', faction: 'undead', hp: 60, speed: 3.3, natural: 'bone_blade', armor: { cut: 0.2, stab: 0.4, bite: 0.3, blunt: -0.35, burn: 0.1 }, skills: { melee: 3 }, points: 20, xp: 9, role: 'melee', drawAs: 'enemy_skeleton', color: '#e8f4ff', undead: true },
  { id: 'skeleton_archer', faction: 'undead', hp: 60, speed: 3.3, natural: 'bone_bow', armor: { cut: 0.2, stab: 0.4, bite: 0.3, blunt: -0.35 }, skills: { shooting: 3 }, points: 24, xp: 10, role: 'ranged', drawAs: 'enemy_skeleton', color: '#cfe8ff', undead: true },
  { id: 'ghoul', faction: 'undead', hp: 95, speed: 4.6, natural: 'claws', armor: { burn: -0.25, rune: -0.15 }, skills: { melee: 5 }, points: 30, xp: 14, role: 'melee', drawAs: 'enemy_ghoul', color: '#9dffb0', undead: true },
  // твари Гнили
  { id: 'rot_wolf', faction: 'rot_beasts', hp: 75, speed: 5.4, natural: 'bite', armor: { burn: -0.2 }, skills: { melee: 4 }, points: 22, xp: 10, role: 'beast', drawAs: 'enemy_rot_wolf', color: '#a8b8a0', beast: true, size: 0.9 },
  { id: 'rot_tendril', faction: 'rot_beasts', hp: 60, speed: 0, natural: 'tendril', armor: { burn: -0.3 }, skills: { melee: 5 }, points: 15, xp: 6, role: 'beast', drawAs: 'enemy_rot_tendril', color: '#b9a6ff', beast: true, stationary: true, simpleHealth: true },
  // боссы
  { id: 'bone_dragon', faction: 'boss', hp: 1400, speed: 3.6, natural: 'dragon_bite', armor: { stab: 0.35, cut: 0.2, blunt: -0.1 }, skills: { melee: 8 }, points: 0, xp: 260, role: 'boss', drawAs: 'enemy_bone_dragon', color: '#e8f4ff', boss: true, undead: true, flying: true, simpleHealth: true, size: 2.4 },
  { id: 'lich', faction: 'boss', hp: 1000, speed: 3.2, natural: 'lich_bolt', armor: { rune: 0.3, frost: 0.4 }, skills: { magic: 10, shooting: 8 }, points: 0, xp: 230, role: 'boss', drawAs: 'enemy_lich', color: '#c77dff', boss: true, undead: true, simpleHealth: true, size: 1.3 },
  { id: 'lich_clone', faction: 'boss', hp: 12, speed: 3.2, natural: 'clone_bolt', skills: { shooting: 4 }, points: 0, xp: 4, role: 'caster', drawAs: 'enemy_lich', color: '#8a5cc7', undead: true, simpleHealth: true, clone: true, size: 1.3 },
  { id: 'rot_heart', faction: 'boss', hp: 2200, speed: 0, natural: 'heart_lash', armor: { burn: -0.15, cut: 0.1 }, skills: { melee: 6 }, points: 0, xp: 320, role: 'boss', drawAs: 'enemy_rot_heart', color: '#b9a6ff', boss: true, beast: true, stationary: true, simpleHealth: true, size: 2.6 },
];

/** Фракции рейдов. morale — доля выбывших, после которой рейд отходит (≥1 — никогда). */
export const FACTIONS = {
  bandits: { id: 'bandits', nameKey: 'combat.faction.bandits', color: '#ff7a3d', units: [['bandit_thug', 5], ['bandit_archer', 4], ['bandit_crossbow', 2], ['bandit_torch', 1.5], ['bandit_chief', 0.8]], morale: 0.5, rob: true, loot: true, minPoints: 25 },
  cultists: { id: 'cultists', nameKey: 'combat.faction.cultists', color: '#9dff5a', units: [['cultist_acolyte', 5], ['cultist_zealot', 3], ['cultist_hexer', 2], ['cultist_firebrand', 2]], morale: 0.65, loot: true, arson: true, minPoints: 24 },
  undead: { id: 'undead', nameKey: 'combat.faction.undead', color: '#e8f4ff', units: [['skeleton', 5], ['skeleton_archer', 3], ['ghoul', 2.5]], morale: 1.01, minPoints: 20 },
  rot_beasts: { id: 'rot_beasts', nameKey: 'combat.faction.rot_beasts', color: '#a8b8a0', units: [['rot_wolf', 1]], morale: 0.7, minPoints: 22 },
  boss: { id: 'boss', nameKey: 'combat.faction.boss', color: '#ff4fd8', units: [], morale: 1.01, minPoints: 0 },
};
const FACTION_ALIASES = { bandit: 'bandits', raiders: 'bandits', collectors: 'bandits', cult: 'cultists', cultist: 'cultists', rot_cult: 'cultists', skeletons: 'undead', ghouls: 'undead', beasts: 'rot_beasts', rot: 'rot_beasts', wolves: 'rot_beasts', rot_wolves: 'rot_beasts' };
export const resolveFaction = (id) => FACTIONS[id] ? id : FACTION_ALIASES[id] || 'bandits';

export function registerEnemies(game) {
  const reg = game.defs.create('enemies', { defaults: { hp: 100, speed: 4, points: 25, xp: 10, size: 1, skills: {} } });
  for (const d of ENEMY_DEFS) if (!reg.has(d.id)) reg.add({ nameKey: `combat.enemy.${d.id}`, ...d }, 'combat');
}

const QUAL_ROLL = [['poor', 3], ['normal', 6], ['good', 2], ['excellent', 0.6], ['awful', 1]];

/** Создать вражескую пешку. opts: {raidId, name, raisedFrom, extra} */
export function makeEnemy(game, C, defId, x, y, opts = {}) {
  const def = game.defs.enemies.get(defId);
  if (!def || !game.map) return null;
  const rng = game.rng;
  const gender = def.named ? (rng.chance(0.75) ? 'male' : 'female') : 'male';
  let name = opts.name;
  if (!name) name = def.named ? generateName(rng, game.i18n.lang, gender) : game.t(def.nameKey);
  const equipment = {};
  if (def.weapon) {
    const w = Array.isArray(def.weapon) ? rng.pick(def.weapon) : def.weapon;
    if (game.defs.items.has(w)) {
      equipment.weapon = w;
      equipment.weaponMeta = { quality: rng.weighted(QUAL_ROLL, (q) => q[1])[0], kills: 0 };
    }
  }
  if (def.armorItem && game.defs.items.has(def.armorItem)) equipment.armor = def.armorItem;
  const skills = {};
  for (const [k, v] of Object.entries(def.skills || {})) skills[k] = { level: v, xp: 0 };
  const loot = [];
  if (def.faction === 'bandits' && game.defs.items.has('silver') && rng.chance(0.6)) loot.push({ defId: 'silver', count: rng.int(3, 18) });
  const p = createPawn(game, {
    name,
    gender,
    age: rng.int(19, 55),
    faction: 'enemy',
    enemyId: def.id,
    enemyFaction: def.faction,
    drawAs: def.drawAs,
    color: def.color,
    hairColor: rng.pick(['#3b2a20', '#1c1c24', '#8a4b2f', '#5a5a5a']),
    speed: def.speed,
    radius: 0.3 * (def.size || 1),
    x: x + 0.5,
    y: y + 0.5,
    dir: rng.range(-Math.PI, Math.PI),
    health: { hp: def.hp, maxHp: def.hp },
    skills,
    equipment,
    raidId: opts.raidId || 0,
    loot,
    undead: !!def.undead,
    beast: !!def.beast,
    humanoid: !!def.humanoid,
    flying: !!def.flying,
    stationary: !!def.stationary,
    simpleHealth: !!def.simpleHealth,
    workPriorities: {},
    ...(opts.extra || {}),
  });
  if (opts.raisedFrom) p.raisedFrom = opts.raisedFrom;
  return p;
}

// ---------------- Рейды ----------------
function edgePoint(game, edge, rng) {
  const map = game.map;
  const m = 2;
  switch (edge) {
    case 'north': return { x: rng.int(m, map.w - 1 - m), y: m };
    case 'south': return { x: rng.int(m, map.w - 1 - m), y: map.h - 1 - m };
    case 'west': return { x: m, y: rng.int(m, map.h - 1 - m) };
    default: return { x: map.w - 1 - m, y: rng.int(m, map.h - 1 - m) };
  }
}

/** Точка входа рейда: проходимая клетка у края, из которой достижим поезд/лидер. */
export function findEntry(game, edge, opts = {}) {
  const rng = game.rng;
  const map = game.map;
  const goal = game.train?.center() || game.getLeader() || { x: map.w / 2, y: map.h / 2 };
  const edges = ['north', 'south', 'west', 'east'];
  const order = edge && edges.includes(edge) ? [edge, ...edges.filter((e) => e !== edge)] : rng.shuffle(edges.slice());
  for (const e of order) {
    for (let k = 0; k < 14; k++) {
      const pt = edgePoint(game, e, rng);
      const spot = map.randomPassableNear(rng, pt.x, pt.y, 2, 10, (x, y) => game.pathfinder.canReach(x + 0.5, y + 0.5, Math.floor(goal.x), Math.floor(goal.y), true));
      if (spot) return { ...spot, edge: e };
    }
  }
  const any = map.randomPassableNear(rng, goal.x, goal.y + (opts.near ? 10 : 25), 12, 40);
  return any ? { ...any, edge: 'none' } : null;
}

/** Точки засады вокруг поезда (по обе стороны состава, 6–9 клеток). */
function ambushPoints(game, n) {
  const train = game.train;
  const rng = game.rng;
  const map = game.map;
  const out = [];
  if (!train?.stamped) return out;
  const top = train.cars[0]?.rect?.y ?? train.railY - 3;
  const bot = top + 7;
  for (let i = 0; i < n * 6 && out.length < n; i++) {
    const side = rng.chance(0.5) ? -1 : 1;
    const x = rng.int(train.x0, train.x0 + train.length);
    const y = side < 0 ? top - rng.int(6, 9) : bot + rng.int(5, 8);
    if (map.isPassable(x, y)) out.push({ x, y });
  }
  return out;
}

/** Состав рейда по очкам. */
function composeUnits(game, factionId, points) {
  const f = FACTIONS[factionId];
  const rng = game.rng;
  const out = [];
  let left = Math.max(points, f.minPoints);
  let guard = 0;
  while (left > 0 && out.length < 30 && guard++ < 200) {
    const affordable = f.units.filter(([id]) => (game.defs.enemies.get(id)?.points ?? 999) <= left + 6);
    if (!affordable.length) break;
    const [id] = rng.weighted(affordable, (u) => u[1]);
    out.push(id);
    left -= game.defs.enemies.get(id).points;
  }
  if (!out.length && f.units.length) out.push(f.units[0][0]);
  return out;
}

/**
 * Рейд. Две формы вызова: spawnRaid(points, factionId, {edge, ambushTrain}) и spawnRaid({faction, points, kind, edge, ambushTrain, boss}).
 * @returns {{id, faction, count, pawnIds, kind}|null}
 */
export function spawnRaid(game, C, a, b, c) {
  let opts;
  if (a && typeof a === 'object') opts = { ...a };
  else opts = { points: a, faction: b, ...(c || {}) };
  if (!game.map) return null;
  if (opts.kind === 'boss' || opts.boss) return C.spawnBoss(opts.boss || opts.id || 'bone_dragon', opts);
  const faction = resolveFaction(opts.faction || 'bandits');
  if (faction === 'boss') return C.spawnBoss(opts.id || 'bone_dragon', opts);
  const points = Math.max(1, Number.isFinite(+opts.points) ? +opts.points : 80);
  const units = Array.isArray(opts.units) && opts.units.length ? opts.units.filter((u) => game.defs.enemies.has(u)) : composeUnits(game, faction, points);
  const raid = newRaid(C, faction, opts.kind || (opts.ambushTrain ? 'ambush' : 'raid'), points, game.time.tick);
  let spots;
  let entry = null;
  if (opts.ambushTrain) {
    spots = ambushPoints(game, units.length);
    raid.phase = 'attack';
  }
  if (!spots || spots.length < units.length) {
    entry = opts.x !== undefined ? { x: Math.floor(opts.x), y: Math.floor(opts.y), edge: 'custom' } : findEntry(game, opts.edge);
    if (!entry) return null;
    spots = spots || [];
    for (let i = spots.length; i < units.length; i++) {
      const s = game.map.randomPassableNear(game.rng, entry.x, entry.y, 3, 16) || entry;
      spots.push(s);
    }
  }
  units.forEach((id, i) => {
    const p = makeEnemy(game, C, id, spots[i].x, spots[i].y, { raidId: raid.id });
    if (p) raid.pawnIds.push(p.id);
  });
  if (!raid.pawnIds.length) return null;
  raid.initial = raid.pawnIds.length;
  raid.entry = entry ? { x: entry.x, y: entry.y, edge: entry.edge } : null;
  C.S.raids.push(raid);
  C.S.stats.raids++;
  const fx = entry?.x ?? spots[0].x;
  const fy = entry?.y ?? spots[0].y;
  const fname = game.t(FACTIONS[faction].nameKey);
  const dirKey = entry ? `combat.dir.${entry.edge}` : 'combat.dir.around';
  const text = opts.ambushTrain
    ? game.t('combat.raid.ambush', { faction: fname, n: raid.initial })
    : game.i18n.has(dirKey) && game.t(dirKey)
      ? game.t('combat.raid.started', { faction: fname, n: raid.initial, dir: game.t(dirKey) })
      : game.t('combat.raid.startedNear', { faction: fname, n: raid.initial });
  game.api.vision.report(text, { type: 'danger', x: fx, y: fy });
  game.events.emit('combat:raidStarted', { raidId: raid.id, raid, faction, count: raid.initial, kind: raid.kind });
  return { id: raid.id, faction, count: raid.initial, pawnIds: raid.pawnIds.slice(), kind: raid.kind };
}

export function newRaid(C, faction, kind, points, tick) {
  return {
    id: C.S.nextRaidId++, faction, kind, points, pawnIds: [], initial: 0, phase: 'approach', startTick: tick,
    robbed: [], stolen: 0, stealBudget: -1, stealZoneId: 0, robDone: false, kills: 0, bossId: 0,
  };
}

export const raidOf = (C, pawn) => (pawn?.raidId ? C.S.raids.find((r) => r.id === pawn.raidId) || null : null);

export const isActiveFoe = (p) => !!p && !p.dead && !p.removed && !p.downed && p.faction === 'enemy' && !p.prisoner;

/** Живые неупавшие поселенцы (стоящие на ногах), не марионетки. */
function standingColonists(game) {
  const out = [];
  for (const p of game.entities.ofKind('pawn')) if (p.faction === 'colony' && !p.dead && !p.downed && !p.prisoner) out.push(p);
  return out;
}

/** Раз в 30 тиков: мораль, фазы, конец рейдов. */
export function updateRaids(game, C) {
  const S = C.S;
  if (!S.raids.length) return;
  const tick = game.time.tick;
  const standing = standingColonists(game);
  for (let i = S.raids.length - 1; i >= 0; i--) {
    const raid = S.raids[i];
    const members = [];
    for (const id of raid.pawnIds) {
      const p = game.entities.get(id);
      if (isActiveFoe(p)) members.push(p);
    }
    if (!members.length) {
      endRaid(game, C, raid, raid.phase === 'retreat' || raid.phase === 'rob' ? 'left' : 'repelled');
      continue;
    }
    const f = FACTIONS[raid.faction] || FACTIONS.bandits;
    const lost = 1 - members.length / Math.max(1, raid.initial);
    if (raid.phase !== 'retreat' && raid.kind !== 'boss' && lost >= f.morale) {
      raid.phase = 'retreat';
      game.api.vision.report(game.t(`combat.raid.broken.${raid.faction}`), { type: 'good', x: members[0].x, y: members[0].y });
    }
    const near = (r) => members.some((m) => standing.some((c) => Math.abs(c.x - m.x) < r && Math.abs(c.y - m.y) < r && dist(c.x, c.y, m.x, m.y) <= r));
    if (raid.phase === 'approach') {
      const goal = game.train?.center();
      if (near(22) || (goal && members.some((m) => dist(m.x, m.y, goal.x, goal.y) < 20)) || tick - raid.startTick > secs(150)) raid.phase = 'attack';
    }
    if (f.rob && raid.phase === 'attack' && tick - raid.startTick > secs(8)) {
      const anyDowned = game.colonists().some((c) => c.downed && !raid.robbed.includes(c.id));
      if (!near(20) && (anyDowned || standing.length === 0 || raid.stealBudget !== 0)) {
        raid.phase = 'rob';
        game.api.vision.report(game.t('combat.raid.robbing'), { type: 'bad', x: members[0].x, y: members[0].y });
      }
    } else if (raid.phase === 'rob') {
      if (near(20)) raid.phase = 'attack';
      else if (raid.robDone) {
        raid.phase = 'retreat';
      }
    }
    if (raid.phase !== 'retreat' && tick - raid.startTick > TICKS_PER_DAY && raid.kind !== 'boss') raid.phase = 'retreat';
    if (raid.phase === 'retreat') for (const m of members) if (!m.leaving) {
      m.leaving = true;
      if (m.job) game.jobs.endJob(m, 'cancelled');
    }
  }
}

export function endRaid(game, C, raid, result = 'repelled') {
  const S = C.S;
  const i = S.raids.indexOf(raid);
  if (i >= 0) S.raids.splice(i, 1);
  const f = FACTIONS[raid.faction] || FACTIONS.bandits;
  if (raid.kind !== 'boss') {
    const key = result === 'repelled' ? 'combat.raid.repelled' : 'combat.raid.left';
    game.api.ui.notify(game.t(key, { faction: game.t(f.nameKey) }), { type: result === 'repelled' ? 'good' : 'info' });
  }
  game.events.emit('combat:raidEnded', { raidId: raid.id, faction: raid.faction, kind: raid.kind, result, kills: raid.kills });
}

/** Есть ли сейчас враги на карте (активные). */
export function anyHostiles(game) {
  for (const p of game.entities.ofKind('pawn')) if (isActiveFoe(p)) return true;
  return false;
}
