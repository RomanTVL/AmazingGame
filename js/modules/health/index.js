/**
 * МОДУЛЬ health — здоровье по частям тела, ранения, медицина, смерть, горе, похороны, «Павшие», наследник.
 * Владелец: js/modules/health/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * Файлы: defs.js (части тела, состояния, предметы, постройки, мысли, звуки, баланс), model.js (ёмкости, урон, лечение,
 * болезни, «упал»), death.js (труп, «Павшие», эпитафии, последнее дыхание/слова, горе, наследник, посох, память, сцена),
 * carry.js (переноска раненых и тел), care.js (перевязка, спасение, кормление, хирургия, действия E),
 * funeral.js (гниение, могилы, похороны, речь, сожжение, вещи на память), ui.js (панели F2/F8, сцена смерти, отрисовка),
 * strings.js (ru/en).
 *
 * Данные: pawn.health = {hp, maxHp, conds: [...], bloodLoss, pain, bleed, v, ops?}, pawn.dying = {untilTick, cause, heard},
 *   pawn.downed/downedReason, pawn.inBedId, переноска — pawn.carryPawnId/carryCorpseId/carriedById; труп — {rot, fallenId,
 *   buried?}; game.colony.memory; «Павшие», похороны, посох, вещи на память — сериализатор 'health'.
 *
 * КЛАВИШИ: F2 — здоровье ('panel:health'), F8 — Павшие ('panel:fallen'). E — перевязать/выслушать/нести/положить/операция.
 * СОБЫТИЯ: 'health:injured' {pawn, part, type, amount, source, lost}, 'health:partLost' {pawn, part, x, y, type, source, severed},
 *   'health:downed' {pawn, reason}, 'health:recovered' {pawn}, 'health:healed' {pawn}, 'health:tended' {doctor, patient, quality},
 *   'health:buried' {corpse, grave, by, record}, 'health:deathScene' {pawn, years, lastWords, corpse, record},
 *   'health:lastBreath' {pawn, untilTick}, 'health:lastWords' {pawn, heard, text}, 'health:stabilized' {pawn},
 *   'health:memoryChanged' {value, delta, reason}, 'health:funeral' {record, rite, speechId}, 'health:cremated' {record, heat},
 *   'health:carryStarted/carryEnded' {carrier, target}, 'health:heirChanged' {pawn}, 'health:fallenRecorded' {record},
 *   'health:surgery' {doctor, patient, op, ok}, 'health:conditionAdded' {pawn, id}.
 */
import { EVENTS } from '../../core/events.js';
import { TICKS_PER_HOUR } from '../../core/constants.js';
import { safeNum } from '../../core/math.js';
import { registerDefs, BAL } from './defs.js';
import {
  ensureHealth, computeCache, applyDamage, addCondition, hasCondition, heal, updatePawn, afterChange, armBroken, worstCondition,
  tendAll, tendNeed, findCond, removeCond, touch, isSimple, condDef,
} from './model.js';
import {
  recordFallen, createFallen, getFallenById, getMemory, addMemory, applyGrief, startDying, finishDying, stabilize, hearLastWords,
  chooseHeir, setHeir, getHeir, dropStaff, deathScene, causeLabel, firstName,
} from './death.js';
import { isCarrying, canCarry, startCarry, dropCarry, updateCarry, rebuildCarriers, carrySpeedMul, carriedOf } from './carry.js';
import { registerCare, availableOps, scheduleOp, installProsthetic, amputate, doTend, countUrgent, isBeingTended } from './care.js';
import { registerFunerals, updateFunerals, hourlyCorpses, dailyCorpses, cremate, chooseEulogy, eulogyOptions, activeFuneral, buryCarried } from './funeral.js';
import { registerStrings } from './strings.js';
import { registerUI } from './ui.js';

const freshState = () => ({ fallen: [], nextFallenId: 1, memoryLog: [], staff: null, funerals: [], nextFuneralId: 0, keepsakes: [] });

export function register(game) {
  const H = {
    game,
    state: freshState(),
    rt: { carriers: new Set(), trailCount: 0, scene: null, quote: null, lastHeir: null, eulogyOpen: false, eulogyDismissed: {}, selectedId: 0 },
    hooks: {},
  };
  registerStrings(game);
  registerDefs(game);

  // ---------- крючки модели ----------
  H.hooks.kill = (pawn, cause, opts) => killPawn(H, pawn, cause, opts);
  H.hooks.canDieSlowly = (pawn) => pawn.faction === 'colony' && !pawn.undead && !pawn.boss && !!game.map;
  H.hooks.startDying = (pawn, cause) => startDying(H, pawn, cause);
  H.hooks.dropCarry = (pawn, opts) => dropCarry(H, pawn, opts);
  H.hooks.notifyPart = (pawn, part, kind) => {
    if (pawn.faction !== 'colony') return;
    const key = kind === 'prosthetic_broken' ? 'health.log.prostheticBroken' : 'health.log.partLost';
    game.api.vision.report(game.t(key, { name: pawn.name, part: game.t(`health.part.${part}`) }), { type: 'bad', x: pawn.x, y: pawn.y, pawnId: pawn.id });
    if (kind === 'lost') game.api.mind.addThought(pawn, 'lost_limb', { mood: -8, days: 15 });
  };
  H.hooks.notifyCond = (pawn, id, phase) => {
    if (pawn.faction !== 'colony') return;
    const key = phase === 'recovered' ? 'health.log.condRecovered' : 'health.log.condGot';
    game.api.ui.notify(game.t(key, { name: pawn.name, f: pawn.gender === 'female', cond: game.t(`health.cond.${id}`) }), { type: phase === 'recovered' ? 'good' : 'bad', pawnId: pawn.id });
  };
  H.hooks.onDowned = (pawn) => {
    if (pawn.undead || pawn.mechanical) {
      killPawn(H, pawn, 'destroyed', {});
      return;
    }
    if (pawn.faction === 'colony') {
      game.api.vision.report(game.t(pawn.isLeader ? 'health.log.leaderDowned' : 'health.log.downed', { name: pawn.name, reason: game.t(`health.downed.${pawn.downedReason || 'shock'}`) }), { type: 'danger', x: pawn.x, y: pawn.y, pawnId: pawn.id });
    }
    if (pawn.pose !== 'dying' && pawn.pose !== 'carried') pawn.pose = 'idle';
  };
  H.hooks.onRecovered = (pawn) => {
    if (pawn.faction === 'colony') game.api.ui.notify(game.t('health.log.recovered', { name: pawn.name }), { type: 'good', pawnId: pawn.id });
    pawn.inBedId = 0;
  };
  H.applyDamage = (pawn, amount, opts) => applyDamage(H, pawn, amount, opts || {});
  H.afterChange = (pawn) => afterChange(H, pawn, {});
  H.bedTaken = (bed, except) => {
    for (const p of game.entities.ofKind('pawn')) {
      if (p === except || p.dead) continue;
      if (p.inBedId === bed.id) return true;
      if (p.job?.type === 'sleep' && p.job.data?.bedId === bed.id) return true;
    }
    return false;
  };
  H.downedAt = (x, y, except) => {
    for (const p of game.entities.queryRadius(x + 0.5, y + 0.5, 0.7, 'pawn')) if (p !== except && p.downed) return true;
    return false;
  };

  registerCare(game, H);
  registerFunerals(game, H);
  registerUI(game, H);

  // ---------- API ----------
  game.provide('health', {
    applyDamage: (pawn, amount, opts = {}) => applyDamage(H, pawn, amount, opts || {}),
    heal: (pawn, amount) => heal(H, pawn, amount),
    kill: (pawn, cause = 'unknown', opts = {}) => killPawn(H, pawn, cause, opts || {}),
    isDowned: (pawn) => !!pawn?.downed,
    canWork: (pawn) => !!pawn && !pawn.dead && !pawn.removed && !pawn.downed && !pawn.dying && !pawn.carriedById,
    moveSpeedFactor(pawn) {
      if (!pawn || pawn.dead) return 1;
      if (isSimple(pawn)) return 1;
      const c = computeCache(game, pawn);
      const f = (0.2 + 0.8 * Math.min(1, c.caps.moving)) * c.moveMul * carrySpeedMul(pawn);
      return safeNum(f, 0.05, 3, 1);
    },
    workSpeedFactor(pawn) {
      if (!pawn || pawn.dead || pawn.downed) return 0;
      if (isSimple(pawn)) return 1;
      const c = computeCache(game, pawn);
      const f = (0.15 + 0.85 * Math.min(1, c.caps.manipulation * 0.75 + c.caps.consciousness * 0.25)) * c.workMul;
      return safeNum(f, 0, 10, 1);
    },
    addCondition: (pawn, id, opts = {}) => {
      const cd = addCondition(H, pawn, id, opts || {});
      if (pawn && !pawn.dead) afterChange(H, pawn, {});
      return cd;
    },
    hasCondition: (pawn, id) => hasCondition(game, pawn, id),
    removeCondition(pawn, id, part) {
      const h = pawn?.health;
      if (!h?.conds) return false;
      const cd = findCond(h, id, part);
      if (!cd) return false;
      removeCond(h, cd);
      afterChange(H, pawn, {});
      return true;
    },
    getSummary: (pawn) => summary(H, pawn),
    getMemory: () => getMemory(H),
    addMemory: (delta, reason = '') => addMemory(H, delta, reason),
    isCarrying: (pawn) => isCarrying(pawn),
    canCarry: (pawn) => canCarry(game, pawn),
    recordFallen: (pawn, opts = {}) => {
      const rec = recordFallen(H, pawn, opts || {});
      if (rec && opts?.kind === 'left' && opts.memory !== false) addMemory(H, 0, 'left');
      return rec;
    },
    createFallen: (spec = {}, opts = {}) => createFallen(H, spec || {}, opts || {}),
    getFallen: () => H.state.fallen,
    // --- дополнительно ---
    getCapacity(pawn, cap) {
      if (!pawn || pawn.dead) return 0;
      return safeNum(computeCache(game, pawn).caps[cap], 0, 2, 1);
    },
    getCapacities: (pawn) => (pawn ? { ...computeCache(game, pawn).caps } : null),
    /** Дрожь прицела 0..1: правая рука/кисть, боль, зрение. */
    aimShake(pawn) {
      if (!pawn || pawn.dead || isSimple(pawn)) return 0;
      const c = computeCache(game, pawn);
      const v = (1 - Math.min(1, c.armR)) * 0.7 + Math.max(0, c.pain - 0.15) * 0.4 + (1 - Math.min(1, c.caps.sight)) * 0.3;
      return safeNum(v, 0, 1, 0);
    },
    isDying: (pawn) => !!pawn?.dying,
    getBloodLoss: (pawn) => pawn?.health?.bloodLoss ?? 0,
    getConditions: (pawn) => conditionList(H, pawn),
    setHeir: (pawn) => setHeir(H, pawn),
    getHeir: () => getHeir(H),
    startCarry: (carrier, target) => startCarry(H, carrier, target),
    dropCarry: (carrier, opts = {}) => dropCarry(H, carrier, opts || {}),
    carried: (carrier) => carriedOf(game, carrier)?.entity || null,
    tend(pawn, quality = 0.5, doctor = null) {
      if (!pawn) return 0;
      if (doctor) return doTend(H, doctor, pawn, null) === 'failed' ? 0 : 1;
      const n = tendAll(H, pawn, quality);
      afterChange(H, pawn, {});
      return n;
    },
    tendNeed: (pawn) => (pawn ? tendNeed(game, pawn) : 0),
    stabilize: (pawn) => stabilize(H, pawn),
    hearLastWords: (listener, pawn) => hearLastWords(H, listener, pawn),
    availableOps: (pawn) => availableOps(H, pawn),
    scheduleSurgery: (pawn, op) => scheduleOp(H, pawn, op),
    installProsthetic: (pawn, condId, part) => installProsthetic(H, pawn, condId, part),
    amputate: (pawn, part) => {
      const ok = amputate(H, pawn, part, 0);
      if (ok) afterChange(H, pawn, {});
      return ok;
    },
    exposeToRot(pawn, amount = 0.05) {
      if (!pawn || pawn.dead || pawn.undead || isSimple(pawn)) return null;
      return addCondition(H, pawn, 'grey_rot', { severity: amount });
    },
    getFallenRecord: (id) => getFallenById(H, id),
    assignPlaque(fallenId, entityId) {
      const rec = fallenId ? getFallenById(H, fallenId) : H.state.fallen.find((r) => !r.plaqueId);
      if (!rec || rec.plaqueId) return null;
      rec.plaqueId = entityId || -1;
      addMemory(H, 3, 'plaque');
      return rec;
    },
    cremate: (pawn, firebox) => cremate(H, pawn, firebox),
    buryCarried: (pawn, x, y) => !!buryCarried(H, pawn, x, y),
    getEulogyOptions() {
      const f = activeFuneral(H);
      const rec = f && getFallenById(H, f.fallenId);
      return rec ? eulogyOptions(H, rec) : [];
    },
    chooseEulogy: (which) => chooseEulogy(H, which),
    getFunerals: () => H.state.funerals.map((f) => ({ ...f })),
    causeLabel: (cause) => causeLabel(game, cause),
    debugState: () => H,
  }, 'health');
  game.provide('colony', { chooseHeir: (exclude) => chooseHeir(H, exclude) }, 'health');

  // ---------- события ----------
  const on = (name, fn) => game.events.on(name, fn, 'health');
  on(EVENTS.PAWN_SPAWNED, ({ pawn }) => {
    ensureHealth(pawn);
    if (pawn.inBedId === undefined) pawn.inBedId = 0;
  });
  on(EVENTS.LEADER_DIED, ({ pawn, heir }) => {
    H.rt.lastHeir = heir || null;
    H.rt.lastLeaderDeath = pawn?.id || 0;
    const corpse = H.rt.lastCorpse && H.rt.lastCorpse.pawnId === pawn?.id ? H.rt.lastCorpse : null;
    dropStaff(H, pawn, corpse, heir);
  });
  on(EVENTS.PAWN_DIED, (payload) => afterDeath(H, payload));
  on(EVENTS.WORLD_RESET, ({ reason }) => {
    H.rt.carriers.clear();
    H.rt.scene = null;
    H.rt.quote = null;
    H.rt.lastHeir = null;
    H.rt.lastCorpse = null;
    H.rt.eulogyOpen = false;
    H.rt.trailCount = 0;
    H.rt.clearFilter = true;
    if (reason !== 'station') H.state = freshState();
    else H.state.funerals = [];
  });
  on(EVENTS.LOAD_AFTER, () => rebuildCarriers(H));
  on(EVENTS.STATION_CHANGED, () => rebuildCarriers(H, { dropAll: true }));
  on(EVENTS.TIME_HOUR, () => hourly(H));
  on(EVENTS.TIME_DAY, () => daily(H));
  on('journey:departing', () => addMemory(H, -2, 'departing'));
  on('journey:arrived', () => {
    const L = game.getLeader();
    if (!L || L.dead || (L.markProgress ?? 0) >= 1) return;
    L.markProgress = Math.min(1, (L.markProgress ?? 0) + 0.34);
    if (L.markProgress >= 1) game.api.ui.notify(game.t('health.log.markShown', { name: L.name }), { type: 'good', pawnId: L.id });
  });
  const staffTaken = ({ pawn, defId }) => {
    if (defId !== 'conductor_staff' || !H.state.staff) return;
    H.state.staff = null;
    game.api.ui.clearObjective('take_staff');
    if (pawn) game.api.ui.notify(game.t('health.log.staffTaken', { name: pawn.name, f: pawn.gender === 'female' }), { type: 'good', pawnId: pawn.id });
  };
  on(EVENTS.ITEM_PICKED, staffTaken);
  on('combat:equipped', staffTaken);

  // ---------- системы ----------
  game.systems.add({
    id: 'health',
    order: 35,
    update(g) {
      if (!g.map) return;
      const now = g.time.tick;
      for (const p of g.entities.ofKind('pawn')) {
        if (p.dead) continue;
        // последнее дыхание не кончается, пока врач/лидер перевязывает
        if (p.dying && isBeingTended(g, p)) p.dying.untilTick += 1;
        if (p.dying && now >= p.dying.untilTick) {
          finishDying(H, p);
          continue;
        }
        if ((now + p.id) % 30 !== 0) continue;
        if (p.downed && p.job) g.jobs.endJob(p, 'cancelled');
        updatePawn(H, p, 30);
        if (p.dead) continue;
        if (p.downed && p.needs && 'rest' in p.needs) p.needs.rest = Math.min(1, (p.needs.rest ?? 1) + 30 / (TICKS_PER_HOUR * 8));
        // хромота (av рисует), только если поза свободна
        if (!p.downed && !isSimple(p) && (p.pose === 'idle' || p.pose === 'limp')) {
          const c = computeCache(g, p);
          p.pose = Math.min(c.legL, c.legR) < 0.72 ? 'limp' : 'idle';
        }
      }
      if (now % 30 === 0) {
        updateFunerals(H);
        countUrgent(H);
      }
    },
  }, 'health');
  game.systems.add({ id: 'health:carry', order: 55, update: () => updateCarry(H) }, 'health');

  // ---------- сохранение ----------
  game.save.registerSerializer({
    id: 'health',
    order: 75,
    save: () => H.state,
    load(g, data) {
      H.state = { ...freshState(), ...JSON.parse(JSON.stringify(data || {})) };
    },
  }, 'health');
}

// ------------------------------------------------------------------ смерть
function killPawn(H, pawn, cause = 'unknown', opts = {}) {
  const game = H.game;
  if (!pawn || pawn.dead) return null;
  if (isCarrying(pawn)) dropCarry(H, pawn, { reason: 'died', findBed: false });
  if (pawn.carriedById) {
    const c = game.entities.get(pawn.carriedById);
    if (c) {
      c.carryPawnId = 0;
      if (c.pose === 'carry') c.pose = 'idle';
      H.rt.carriers.delete(c.id);
    }
    pawn.carriedById = 0;
  }
  const dying = pawn.dying;
  pawn.dying = null;
  pawn.dead = true;
  if (pawn.job) game.jobs.endJob(pawn, 'cancelled');
  if (pawn.carry) game.items.dropCarried(pawn);
  const map = game.map;
  let x = Math.floor(Number.isFinite(pawn.x) ? pawn.x : 0);
  let y = Math.floor(Number.isFinite(pawn.y) ? pawn.y : 0);
  if (map) {
    x = Math.max(0, Math.min(map.w - 1, x));
    y = Math.max(0, Math.min(map.h - 1, y));
  }
  let corpse = null;
  if (map) {
    corpse = game.entities.spawn('corpse', {
      x, y, pawnId: pawn.id, name: pawn.name, color: pawn.color, faction: pawn.faction, wasLeader: !!pawn.isLeader, diedTick: game.time.tick,
      cause, rot: pawn.undead ? 0.85 : 0, gender: pawn.gender, age: pawn.age, hairColor: pawn.hairColor, mage: !!pawn.mage,
      look: pawn.look && typeof pawn.look === 'object' ? JSON.parse(JSON.stringify(pawn.look)) : {}, undead: !!pawn.undead, beast: !!pawn.beast,
      humanoid: pawn.faction === 'colony' || !!pawn.humanoid || (!pawn.beast && !pawn.undead && !pawn.simpleHealth), drawAs: pawn.drawAs || null,
      enemyId: pawn.enemyId || null, noBlood: !!pawn.undead, fallenId: 0, prisoner: !!pawn.prisoner, radius: pawn.radius,
    });
  }
  H.rt.lastCorpse = corpse;
  H.rt.deathInfo = { cause, opts, dying };
  game.entities.remove(pawn, 'died');
  game.events.emit(EVENTS.PAWN_DIED, { pawn, corpse, cause, opts });
  return corpse;
}

/** После 'pawn:died' (ядро уже передало власть): «Павшие», горе, сцена. */
function afterDeath(H, { pawn, corpse, cause, opts = {} }) {
  const game = H.game;
  if (!pawn) return;
  if (pawn.faction !== 'colony' || pawn.prisoner) return;
  const heir = H.rt.lastLeaderDeath === pawn.id ? H.rt.lastHeir : null;
  const wasLeader = !!(pawn.isLeader || H.rt.lastLeaderDeath === pawn.id);
  const heard = !!opts.heard;
  const rec = recordFallen(H, pawn, { kind: 'died', cause, lastWordsHeard: heard, lastWords: opts.lastWords || null, wasLeader });
  if (corpse && rec) {
    corpse.fallenId = rec.id;
    rec.corpseId = corpse.id;
  }
  applyGrief(H, pawn, { heard, nobodyHeard: !!opts.nobodyHeard, wasLeader });
  const text = wasLeader ? game.t('health.log.leaderDied', { name: pawn.name, f: pawn.gender === 'female', cause: causeLabel(game, cause) }) : game.t('health.log.died', { name: pawn.name, f: pawn.gender === 'female', cause: causeLabel(game, cause) });
  game.api.ui.notify(text, { type: 'danger', x: pawn.x, y: pawn.y });
  if (game.colony.heirId === pawn.id) game.colony.heirId = 0;
  deathScene(H, pawn, corpse, cause, { record: rec, heir, lastWords: opts.lastWords || null });
  if (wasLeader) {
    H.rt.lastHeir = null;
    H.rt.lastLeaderDeath = 0;
  }
}

// ------------------------------------------------------------------ сводка
function summary(H, pawn) {
  const game = H.game;
  if (!pawn) return { ratio: 1, label: game.t('health.ok') };
  if (pawn.dead) return { ratio: 0, label: game.t('health.state.dead'), dead: true };
  const c = computeCache(game, pawn);
  const ratio = Math.max(0, Math.min(1, c.ratio ?? 1));
  let key = ratio > 0.75 ? 'health.ok' : ratio > 0.35 ? 'health.hurt' : 'health.critical';
  if (pawn.dying) key = 'health.state.dying';
  else if (pawn.downed) key = `health.downed.${pawn.downedReason || 'shock'}`;
  else if (c.bleed > 0.4) key = 'health.state.bleeding';
  const worst = worstCondition(game, pawn);
  return {
    ratio,
    label: game.t(key),
    bleeding: c.bleed,
    pain: c.pain,
    bloodLoss: pawn.health?.bloodLoss ?? 0,
    downed: !!pawn.downed,
    dying: !!pawn.dying,
    needsTend: tendNeed(game, pawn),
    worst: worst ? game.t(`health.cond.${worst.id}`) : null,
    conditions: conditionList(H, pawn),
  };
}

/** Состояния для UI: [{id, label, part, partLabel, severity, tended, color, kind}] */
function conditionList(H, pawn) {
  const game = H.game;
  const out = [];
  for (const cd of pawn?.health?.conds || []) {
    const def = condDef(game, cd.id);
    const kind = def?.kind || cd.kind || 'timed';
    out.push({
      id: cd.id,
      kind,
      label: cd.label || (game.i18n.has(`health.cond.${cd.id}`) ? game.t(`health.cond.${cd.id}`) : cd.id),
      part: cd.part || null,
      partLabel: cd.part ? game.t(`health.part.${cd.part}`) : null,
      severity: cd.sev ?? 0,
      immunity: cd.imm ?? null,
      tended: cd.tq >= 0,
      color: def?.color || cd.color || '#c9b8ff',
    });
  }
  return out;
}

// ------------------------------------------------------------------ час / сутки
function hourly(H) {
  const game = H.game;
  if (!game.map) return;
  hourlyCorpses(H);
  for (const p of game.colonists()) {
    if (isSimple(p)) continue;
    const c = computeCache(game, p);
    if (c.pain > 0.3 && !p.downed) game.api.mind.addThought(p, 'in_pain', { mood: -Math.round(4 + c.pain * 8), days: 0.06 });
  }
}

function daily(H) {
  const game = H.game;
  if (!game.map) return;
  dailyCorpses(H);
  const rng = game.rng;
  for (const p of game.colonists()) {
    if (isSimple(p) || p.undead) continue;
    if (!hasCondition(game, p, 'fever') && rng.chance(BAL.feverChancePerDay)) {
      addCondition(H, p, 'fever', { severity: 0.06 });
      H.hooks.notifyCond(p, 'fever');
    }
  }
}

export { firstName, touch };
