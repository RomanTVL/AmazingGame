/**
 * МОДУЛЬ combat — бой: оружие и броня, враги и рейды, боссы, маг-лидер и заклинания, «К оружию!», снаряды, кровь,
 * пленные, турели и ловушки. Владелец: js/modules/combat/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * Файлы: state.js (состояние), items.js (оружие/броня/посох), enemies.js (враги, фракции, рейды), fight.js (урон,
 * снаряды, укрытия, сочность), ai.js (задача 'combat:fight' и узлы мышления), leader.js (мана, заклинания, уровни),
 * bosses.js (дракон, Лич, Сердце Гнили, запасной рассказчик), prison.js (пленные), defense.js (турели, ловушки, огонь,
 * обереги), gore.js (кровь), render.js (отрисовка, HUD, панели, звуки), strings.js (ru/en).
 *
 * КЛАВИШИ: ЛКМ — атака, 1–4 — заклинания, Shift — рывок/блинк, R — «К оружию!» (ядро), F — призвать/отпустить
 *          наведённого поселенца ('combat:draft').
 * СОБЫТИЯ: 'combat:hit' {attacker, target, damage, part, type, crit}, 'combat:raidStarted' {raidId, faction, count, kind},
 *          'combat:raidEnded' {raidId, faction, kind, result}, 'combat:spellCast' {caster, spellId, x, y},
 *          'combat:levelUp' {pawn, level}, 'combat:weaponNamed' {item, name, pawn, defId}, 'boss:defeated' {id, pawn},
 *          'combat:drafted', 'combat:callToArms', 'combat:captured', 'combat:recruited', 'combat:prisonerExecuted',
 *          'combat:fire', 'combat:faded', 'combat:threadAttached/Cut', 'combat:nameless', 'combat:bossSpawned'.
 * API (game.api.combat): контракт — isHostile, isDrafted, setDrafted(p, v, mode?), attack, spawnRaid (обе формы:
 *   (points, factionId, {edge, ambushTrain, x, y}) и ({faction, points, kind, edge, ambushTrain, units})), getMana, hasStaff;
 *   добавлено — spawnBoss(id, opts), spendMana(p, n), castSpell(p, slot|spellId, x, y), getSpells(p), callToArms(L),
 *   hornToArms(), getLevel(p), grantXp(p, n), chooseUpgrade(p, idx|id), capture(p, by), canCapture(p),
 *   setPrisonerMode(p, 'hold'|'recruit'|'release'|'execute'), equip(p, item), weaponOf(p), isArmed(p), isRaidActive(),
 *   getRaids(), ignite(building), damage(target, amount, opts), callByName(L, p), getStats(), debugState().
 * ПЕРКИ лидера (pawn.perks, читают другие модули): fuelMul (journey/train), camRadius (vision), voiceMul (vision),
 *   obeyBonus (mind); level, xp, known, slots, upgrades, cd, pending, cards.
 */
import { TICKS_PER_HOUR } from '../../core/constants.js';
import { dist } from '../../core/math.js';
import { createContext, createSaved, createRuntime } from './state.js';
import { registerItems, hasStaff, dropSlot, equipItem, weaponStats, isArmed } from './items.js';
import { registerEnemies, spawnRaid, updateRaids } from './enemies.js';
import { installJuice, registerKillHandling, updateProjectiles, updateStatuses, isHostile, isHealthStub, dealDamage } from './fight.js';
import { registerAI, refreshLists, setDrafted, callToArms, hornToArms, flyStep, kitColonist } from './ai.js';
import {
  ensureLeader, regenMana, leaderAttack, leaderDash, dashStep, castSlot, castSpellId, grantXp, chooseUpgrade, spendMana,
  onItemPicked, equipStaff, xpForLevel, activeSlots, SPELLS,
} from './leader.js';
import { installBosses, autoStoryteller } from './bosses.js';
import { installPrison, hourlyPrisoners, canCapture } from './prison.js';
import { registerBuildings, trackBuilding, rebuildTracking, installFire, updateFire, updateTraps, updateTurrets, installWards, updateWards } from './defense.js';
import { installGore, fadeDecals, cullIfNeeded } from './gore.js';
import { registerRender, BUILDING_DRAWERS } from './render.js';
import { registerStrings } from './strings.js';

export function register(game) {
  const C = createContext(game);
  registerStrings(game);
  registerItems(game);
  registerEnemies(game);
  installJuice(game, C);
  installFire(game, C);
  installWards(game, C);
  installGore(game, C);
  installBosses(game, C);
  installPrison(game, C);
  C.spawnRaid = (...a) => spawnRaid(game, C, ...a);
  C.dropSlot = (p, slot) => dropSlot(game, p, slot);
  C.grantXp = (p, xp, reason) => grantXp(game, C, p, xp, reason);
  registerBuildings(game, C, BUILDING_DRAWERS);
  registerAI(game, C);
  registerKillHandling(game, C);
  registerInteractions(game, C);
  registerRender(game, C);
  game.input.registerKey('combat:draft', 'KeyF', 'combat', { label: 'combat.key.draft' });
  game.settings.registerDefault?.('hitStop', true);
  game.settings.registerDefault?.('flashes', true);
  game.settings.registerDefault?.('slowMo', true);

  const R = () => C.R;
  const leader = () => {
    const L = game.getLeader();
    return L && L.controlled === 'player' && !L.dead ? L : null;
  };

  // ---------- Тиковая система (order 45: после задач, до движения) ----------
  game.systems.add({
    id: 'combat',
    order: 45,
    update(g, dt) {
      if (!g.map) return;
      const now = g.time.tick;
      refreshLists(g, C);
      const L = leader();
      // действия игрока
      const acts = C.R.actions;
      if (acts.length) {
        for (const a of acts) {
          if (!L || L.downed) break;
          try {
            if (a.type === 'attack') {
              if (a.targetId) C.R.leaderTargetId = a.targetId;
              leaderAttack(g, C, L, a.x, a.y);
            } else if (a.type === 'spell') castSlot(g, C, L, a.slot, a.x, a.y);
            else if (a.type === 'dash') leaderDash(g, C, L, a.x, a.y);
            else if (a.type === 'arms') callToArms(g, C, L);
            else if (a.type === 'draft') {
              const p = g.entities.get(a.pawnId);
              if (p && p.faction === 'colony' && !p.isLeader) {
                const v = !p.drafted;
                setDrafted(g, C, p, v, 'arms');
                g.api.mind.say(p, g.t(v ? 'combat.arms.yes' : 'combat.arms.at_ease', { variant: now + p.id }));
              }
            }
          } catch (err) {
            g.error(err, `combat.action:${a.type}`);
          }
        }
        acts.length = 0;
      }
      if (L) {
        regenMana(g, C, L, dt);
        dashStep(g, C, L, dt);
        const t = C.R.leaderTargetId && g.entities.get(C.R.leaderTargetId);
        if (C.R.leaderTargetId && (!t || t.dead || t.downed || t.removed)) C.R.leaderTargetId = 0;
      }
      for (const p of C.R.enemies) if (p.flying) flyStep(g, p, dt);
      updateProjectiles(g, C, dt);
      updateStatuses(g, C);
      updateTurrets(g, C);
      if (now % 6 === 0) updateTraps(g, C);
      if (now % 30 === 0) {
        updateRaids(g, C);
        updateFire(g, C);
        updateWards(g, C);
        hornRelease(g, C);
        cullIfNeeded(g, C);
      }
      if (now % TICKS_PER_HOUR === 0) hourly(g, C);
    },
  }, 'combat');

  // ---------- Кадровая система ввода (до лидера, order 25) ----------
  game.frameSystems.add({
    id: 'combat:input',
    order: 25,
    update(g, dt) {
      C.R.clock += dt;
      const L = leader();
      if (!L || !g.map) {
        C.R.hoverEnemyId = 0;
        return;
      }
      const m = g.input.mouse;
      let hover = 0;
      if (m.inside) {
        let bd = 0.9 * 0.9;
        for (const o of C.R.enemies) {
          const d2 = (o.x - m.wx) ** 2 + (o.y - m.wy) ** 2;
          if (d2 < bd && isHostile(L, o)) {
            bd = d2;
            hover = o.id;
          }
        }
      }
      C.R.hoverEnemyId = hover;
      if (!g.ui.modalOpen && g.input.pressed('combat:draft')) {
        g.input.consume('combat:draft');
        const p = g.player?.hoveredColonist(L);
        if (p) C.R.actions.push({ type: 'draft', pawnId: p.id });
      }
    },
  }, 'combat');

  // ---------- События ----------
  const on = (name, fn) => game.events.on(name, fn, 'combat');
  on('player:attack', ({ x, y }) => R().actions.push({ type: 'attack', x, y, targetId: R().hoverEnemyId }));
  on('player:spell', ({ slot, x, y }) => R().actions.push({ type: 'spell', slot, x, y }));
  on('player:dash', ({ x, y }) => R().actions.push({ type: 'dash', x, y }));
  on('player:callToArms', () => R().actions.push({ type: 'arms' }));
  on('journey:horn', (e) => {
    if (e?.pattern === 'double' && game.map) {
      refreshLists(game, C);
      hornToArms(game, C);
    }
  });
  on('item:picked', (e) => onItemPicked(game, C, e));
  on('pawn:spawned', ({ pawn }) => {
    if (pawn.isLeader && pawn.faction === 'colony') {
      pawn.equipment ||= {};
      if (pawn.equipment.weapon === undefined) {
        pawn.equipment.weapon = 'conductor_staff';
        pawn.equipment.weaponMeta = { quality: 'legendary', kills: 0 };
      }
    }
  });
  on('colony:started', () => {
    const L = game.getLeader();
    if (L && game.colony.flags?.noStaff && hasStaff(L)) L.equipment.weapon = null;
    if (L) ensureLeader(game, C, L);
    for (const p of game.colonists()) kitColonist(game, p);
    rebuildTracking(game, C);
  });
  on('leader:changed', ({ to }) => {
    if (!to) return;
    if (to.drafted) setDrafted(game, C, to, false);
    ensureLeader(game, C, to);
  });
  on('world:reset', () => {
    C.S = createSaved();
    C.R = createRuntime();
  });
  const rebuild = () => {
    rebuildTracking(game, C);
    C.R.heartId = 0;
    for (const p of game.entities.ofKind('pawn')) if (p.boss?.id === 'rot_heart' && !p.dead) C.R.heartId = p.id;
    const L = game.getLeader();
    if (L) ensureLeader(game, C, L);
  };
  on('load:after', rebuild);
  on('station:changed', () => {
    // враги снаружи остались на прежней стоянке — их рейды закончены
    for (const raid of C.S.raids.slice()) {
      const alive = raid.pawnIds.some((id) => game.entities.get(id));
      if (!alive) {
        C.S.raids.splice(C.S.raids.indexOf(raid), 1);
        game.events.emit('combat:raidEnded', { raidId: raid.id, faction: raid.faction, kind: raid.kind, result: 'left' });
      }
    }
    C.S.threads = C.S.threads.filter((t) => game.entities.get(t.lichId) && game.entities.get(t.pawnId));
    C.S.wards = [];
    rebuild();
  });
  on('entity:spawned', ({ entity }) => {
    if (entity.kind === 'building') trackBuilding(game, C, entity, true);
  });
  on('entity:removed', ({ entity }) => {
    if (entity.kind === 'building') trackBuilding(game, C, entity, false);
    if (entity.kind === 'decal' && entity.combat) C.R.decalCount = Math.max(0, (C.R.decalCount || 1) - 1);
  });
  on('job:ended', ({ pawn, job, result }) => {
    if (result === 'done' && pawn?.isLeader && job?.workType) grantXp(game, C, pawn, 2, 'work');
  });
  on('health:partLost', (e) => {
    if (e?.pawn && e.severed !== false) C.limb(e.pawn, e.part, e.x, e.y);
  });
  on('health:downed', ({ pawn }) => {
    if (!pawn) return;
    C.pool(pawn);
    if (pawn.job?.type === 'combat:fight') game.jobs.endJob(pawn, 'cancelled');
  });
  on('combat:downed', ({ pawn }) => pawn && C.pool(pawn));

  // ---------- API ----------
  game.provide('combat', {
    isHostile: (a, b) => isHostile(a, b),
    isDrafted: (p) => !!p?.drafted,
    setDrafted: (p, v, mode) => setDrafted(game, C, p, v, mode || 'arms'),
    attack(attacker, target) {
      if (!attacker || !target || attacker.dead) return false;
      const tx = target.x ?? 0;
      const ty = target.y ?? 0;
      if (attacker.controlled === 'player') {
        if (target.id) C.R.leaderTargetId = target.id;
        return leaderAttack(game, C, attacker, tx, ty);
      }
      if (!target.id || !isHostile(attacker, target)) return false;
      attacker._tgt = target.id;
      const mode = attacker.faction === 'enemy' ? (attacker.boss ? 'boss' : 'raider') : attacker.drafted ? (attacker.draftMode === 'horn' ? 'horn' : 'arms') : 'defend';
      if (attacker.job?.type === 'combat:fight') return true;
      return game.jobs.startJob(attacker, game.jobs.createJob('combat:fight', attacker, { data: { mode }, priority: 96 }));
    },
    spawnRaid: (a, b, c) => spawnRaid(game, C, a, b, c),
    spawnBoss: (id, opts) => C.spawnBoss(id, opts || {}),
    getMana: (p) => (p?.mana && typeof p.mana === 'object' ? { cur: p.mana.cur, max: p.mana.max } : null),
    spendMana: (p, n) => spendMana(game, p, n),
    hasStaff: (p) => hasStaff(p),
    castSpell(p, slotOrId, x, y) {
      if (!p) return false;
      const tx = Number.isFinite(x) ? x : p.x + Math.cos(p.dir || 0) * 4;
      const ty = Number.isFinite(y) ? y : p.y + Math.sin(p.dir || 0) * 4;
      refreshLists(game, C);
      if (typeof slotOrId === 'number') return castSlot(game, C, p, slotOrId, tx, ty);
      if (!SPELLS[slotOrId]) return false;
      return castSpellId(game, C, p, slotOrId, tx, ty, activeSlots(game, p).power);
    },
    getSpells: (p) => (p ? { ...activeSlots(game, p), known: (p.perks?.known || []).slice(), cooldowns: { ...(p.perks?.cd || {}) } } : null),
    callToArms(L) {
      refreshLists(game, C);
      return callToArms(game, C, L || game.getLeader());
    },
    getLevel: (p) => (p?.perks?.level ? { level: p.perks.level, xp: p.perks.xp, next: xpForLevel(p.perks.level), pending: p.perks.pending || 0, cards: (p.perks.cards || []).slice() } : null),
    grantXp: (p, n, reason) => grantXp(game, C, p, n, reason),
    chooseUpgrade: (p, which) => chooseUpgrade(game, C, p, which),
    capture: (p, by) => {
      refreshLists(game, C);
      return C.capture(p, by);
    },
    canCapture: (p) => canCapture(game, p),
    setPrisonerMode: (p, mode) => C.setPrisonerMode(p, mode),
    equip: (p, item) => (item?.defId === 'conductor_staff' && p?.isLeader ? (game.items.take(item, 1), equipStaff(game, C, p), true) : equipItem(game, p, item)),
    weaponOf: (p) => (p ? weaponStats(game, C, p) : null),
    isArmed: (p) => !!p && isArmed(game, p),
    isRaidActive: () => C.S.raids.length > 0,
    getRaids: () => C.S.raids.map((r) => ({ id: r.id, faction: r.faction, kind: r.kind, phase: r.phase, count: r.pawnIds.length, initial: r.initial })),
    ignite: (b, src) => C.ignite(b, src),
    damage: (target, amount, opts) => dealDamage(game, C, target, amount, opts || {}),
    callByName: (L, p) => C.callByName(L, p),
    hornToArms: () => {
      refreshLists(game, C);
      return hornToArms(game, C);
    },
    getStats: () => ({ ...C.S.stats }),
    debugState: () => C,
  }, 'combat');

  // ---------- Сохранение ----------
  game.save.registerSerializer({
    id: 'combat',
    order: 75,
    save(g) {
      const projectiles = [];
      for (const pr of g.entities.ofKind('projectile')) {
        if (!pr.combat) continue;
        const o = {};
        for (const k in pr) if (k[0] !== '_' && k !== 'removed' && k !== 'kind') o[k] = pr[k];
        projectiles.push(o);
      }
      return { S: C.S, projectiles };
    },
    load(g, data) {
      C.S = { ...createSaved(), ...JSON.parse(JSON.stringify(data?.S || {})) };
      for (const o of data?.projectiles || []) {
        if (g.entities.get(o.id)) continue;
        try {
          g.entities.spawn('projectile', o);
        } catch (err) {
          g.error(err, 'combat.load.projectile');
        }
      }
    },
  }, 'combat');
}

// ---------- Час ----------
function hourly(game, C) {
  fadeDecals(game, C);
  hourlyPrisoners(game, C);
  if (!game.providers.journey?.getStation) autoStoryteller(game, C);
  if (isHealthStub(game)) stubHealth(game, C);
}

/** Пока health — заглушка ядра: медленное заживление, упавшие встают, брошенные враги истекают кровью. */
function stubHealth(game, C) {
  const now = game.time.tick;
  for (const p of game.entities.listKind('pawn')) {
    if (p.dead) continue;
    const h = p.health;
    if (!h) continue;
    const max = h.maxHp ?? 100;
    if (p.faction === 'enemy' && p.downed && !p.prisoner) {
      p._downedSince ??= now;
      if (now - p._downedSince > TICKS_PER_HOUR * 10) game.api.health.kill(p, 'bleeding', {});
      continue;
    }
    // упавших кормят и укрывают товарищи (упрощение до появления health: спасение и лечение)
    if (p.downed && p.needs && 'food' in p.needs) p.needs.food = Math.max(p.needs.food, 0.3);
    const rate = p.downed ? 0.06 : 0.03;
    h.hp = Math.min(max, (h.hp ?? max) + max * rate);
    if (p.downed && h.hp >= max * 0.35) {
      p.downed = false;
      p._downedSince = undefined;
      game.events.emit('combat:recovered', { pawn: p });
    }
  }
}

/** Гудковой призыв снимается сам, когда врагов нет 30+ секунд. */
function hornRelease(game, C) {
  const S = C.S;
  if (!S.hornUntil) return;
  if (C.R.hostiles > 0) {
    S.hornUntil = Math.max(S.hornUntil, game.time.tick + 1800);
    return;
  }
  if (game.time.tick < S.hornUntil) return;
  S.hornUntil = 0;
  for (const p of C.R.colony) if (p.drafted && p.draftMode === 'horn') setDrafted(game, C, p, false);
}

// ---------- Действия E ----------
function registerInteractions(game, C) {
  const reg = game.defs.interactions;
  const pawnAt = (tx, ty, pred) => {
    for (const p of game.entities.queryRadius(tx + 0.5, ty + 0.5, 0.9, 'pawn')) if (!p.dead && pred(p)) return p;
    return null;
  };
  reg.add({
    id: 'combat:callName',
    order: 5,
    find(g, L, tx, ty) {
      if (!C.R.nameless) return null;
      const p = pawnAt(tx, ty, (o) => o.nameless && o.faction === 'colony');
      if (!p || dist(p.x, p.y, L.x, L.y) > 3) return null;
      return { label: g.t('combat.act.callName', { name: p.name }), x: tx, y: ty, run: (g2, pawn) => C.callByName(pawn, p) };
    },
  }, 'combat');
  reg.add({
    id: 'combat:capture',
    order: 12,
    find(g, L, tx, ty) {
      if (!C.R.downedEnemies) return null;
      const p = pawnAt(tx, ty, (o) => canCapture(g, o));
      if (!p) return null;
      return {
        label: g.t('combat.act.capture', { name: p.name }),
        x: tx,
        y: ty,
        run(g2, pawn) {
          if (dist(pawn.x, pawn.y, p.x, p.y) <= 2.2) C.capture(p, pawn);
          else if (!g2.player.walkTo(p.x, p.y)) g2.audio.play('error');
        },
      };
    },
  }, 'combat');
  reg.add({
    id: 'combat:prisoner',
    order: 13,
    find(g, L, tx, ty) {
      if (!C.R.prisoners) return null;
      const p = pawnAt(tx, ty, (o) => !!o.prisoner);
      if (!p) return null;
      return {
        label: g.t('combat.act.prisoner', { name: p.name }),
        x: tx,
        y: ty,
        run(g2) {
          C.R.prisonerSel = p.id;
          g2.ui.openPanel('combat_prisoners');
        },
      };
    },
  }, 'combat');
  reg.add({
    id: 'combat:equip',
    order: 28,
    find(g, L, tx, ty) {
      const it = g.items.itemAt(tx, ty);
      const def = it && g.defs.items.get(it.defId);
      if (!def || !(def.weapon || def.armor)) return null;
      if (def.weapon && hasStaff(L) && it.defId !== 'conductor_staff') return null;
      const name = g.t(def.nameKey);
      return {
        label: g.t(def.armor ? 'combat.act.wear' : 'combat.act.wield', { name: it.nick ? `«${it.nick}»` : name }),
        x: tx,
        y: ty,
        run(g2, pawn) {
          if (it.defId === 'conductor_staff') {
            if (dist(pawn.x, pawn.y, it.x + 0.5, it.y + 0.5) <= 2) {
              g2.items.take(it, 1);
              equipStaff(g2, C, pawn);
              return;
            }
          }
          if (!g2.jobs.startManual(pawn, 'combat:equip', { targetId: it.id, x: it.x, y: it.y })) g2.audio.play('error');
        },
      };
    },
  }, 'combat');
}
