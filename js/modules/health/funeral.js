// Тела и обряды: гниение трупов, мысли «видел тело»/«запах»/«не похоронили», могилы и задача 'bury',
// похоронная церемония и надгробная речь, сожжение в топке, вещи на память, таблички.
import { resKey } from '../../sim/jobs.js';
import { stopMoving } from '../../sim/pawn.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../core/constants.js';
import { thought, addMemory, getFallenById, firstName, relationOf, closeness } from './death.js';
import { startCarry, dropCarry, carriedOf, isCarrying, canCarry, canBeCarried } from './carry.js';
import { BAL } from './defs.js';

const safe = (fn, d = null) => {
  try {
    const v = fn();
    return v === undefined ? d : v;
  } catch {
    return d;
  }
};
const FUNERAL_TICKS = Math.round(TICKS_PER_HOUR * 1.2);

// ------------------------------------------------------------------ места
/** Хранится ли тело (катафалк, гроб): 'hearse' | 'coffin' | null. */
export function keptAt(game, x, y) {
  const car = game.train?.carAt?.(x, y);
  if (car?.type === 'hearse') return 'hearse';
  const b = game.map?.buildingAt(x, y);
  if (b && game.defs.buildings.get(b.defId)?.coffin && !b.blueprint) return 'coffin';
  return null;
}

export function rotStage(rot) {
  return rot >= 0.8 ? 'bones' : rot >= 0.3 ? 'rotting' : 'fresh';
}

/** Подходит ли клетка под могилу. */
export function graveSpotOk(game, x, y, pawn) {
  const map = game.map;
  if (!map?.inBounds(x, y)) return false;
  const k = map.idx(x, y);
  if (map.roof[k] > 0 || map.room[k] >= 10000 || map.floor[k]) return false;
  if (!map.terrainDef(x, y)?.buildable || !map.isPassable(x, y)) return false;
  if (map.building[k] || map.plant[k]) return false;
  if (game.items.itemAt(x, y)) return false;
  if (map.hasFlag(x, y, 1) || map.hasFlag(x, y + 1, 1) || map.hasFlag(x, y - 1, 1)) return false;
  if (game.train?.carAt?.(x, y) || game.train?.carAt?.(x, y + 1) || game.train?.carAt?.(x, y - 1)) return false;
  if (game.entities.atTile(x, y, 'corpse').some((c) => !c.carriedById)) return false;
  if (pawn && game.jobs.isReserved(resKey.cell(x, y), pawn)) return false;
  return true;
}

/** Найти место для могилы: рядом с прежними могилами (кладбище), иначе в стороне от поезда. */
export function findGraveSpot(H, pawn) {
  const game = H.game;
  const map = game.map;
  if (!map) return null;
  let ax = null;
  let ay = null;
  for (const b of game.entities.ofKind('building')) {
    if (b.defId === 'grave') {
      ax = b.x;
      ay = b.y;
    }
  }
  if (ax === null) {
    const tr = game.train;
    const c = tr?.center?.() || { x: map.w / 2, y: map.h / 2 };
    const ry = tr?.railY ?? Math.floor(c.y);
    ax = Math.floor((tr?.x0 ?? c.x) + 3);
    ay = ry - 7 >= 2 ? ry - 7 : ry + 7;
  }
  for (let r = 0; r <= 16; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        // ряды кладбища: через клетку
        const x = ax + dx * 2;
        const y = ay + dy * 2;
        if (!graveSpotOk(game, x, y, pawn)) continue;
        if (pawn && !game.pathfinder.canReach(pawn.x, pawn.y, x, y, true)) continue;
        return { x, y };
      }
  }
  return null;
}

/** Пустая могила (поставленная стройкой). */
function emptyGrave(game, pawn) {
  for (const b of game.entities.ofKind('building')) {
    if (b.defId !== 'grave' || b.occupied || b.blueprint) continue;
    if (pawn && game.jobs.isReserved(resKey.entity(b.id), pawn)) continue;
    return b;
  }
  return null;
}

// ------------------------------------------------------------------ похороны (задача)
function burialCandidate(H, pawn) {
  const game = H.game;
  let best = null;
  let bestD = Infinity;
  const now = game.time.tick;
  for (const c of game.entities.ofKind('corpse')) {
    if (c.carriedById || c.buried) continue;
    const ours = c.faction === 'colony';
    if (!ours && (!c.humanoid || c.undead || c.beast)) continue;
    if (now - (c.diedTick ?? now) < (ours ? TICKS_PER_HOUR : TICKS_PER_HOUR * 4)) continue;
    if (keptAt(game, c.x, c.y)) continue;
    if (game.jobs.isReserved(resKey.entity(c.id), pawn)) continue;
    const d = (c.x - pawn.x) ** 2 + (c.y - pawn.y) ** 2 - (ours ? 4000 : 0);
    if (d >= bestD) continue;
    if (!game.pathfinder.canReach(pawn.x, pawn.y, c.x, c.y, true)) continue;
    best = c;
    bestD = d;
  }
  return best;
}

function registerBurialJob(game, H) {
  game.jobs.registerJobType({
    id: 'health:bury',
    workType: 'hauling',
    labelKey: 'health.job.bury',
    priority: 58,
    adjacent: true,
    findJob(g, pawn) {
      if (!g.api.health.canWork(pawn) || !canCarry(g, pawn)) return null;
      if (g.api.journey.isTravelling?.()) return null;
      const c = burialCandidate(H, pawn);
      if (!c) return null;
      const grave = emptyGrave(g, pawn);
      const spot = grave ? { x: grave.x, y: grave.y } : findGraveSpot(H, pawn);
      if (!spot) return null;
      return { targetId: c.id, x: c.x, y: c.y, data: { sx: spot.x, sy: spot.y, graveId: grave?.id || 0 } };
    },
    canDo: (g, pawn) => canCarry(g, pawn) || isCarrying(pawn),
    reserve(g, pawn, job) {
      const keys = [resKey.cell(job.data.sx, job.data.sy)];
      if (job.targetId) keys.push(resKey.entity(job.targetId));
      if (job.data.graveId) keys.push(resKey.entity(job.data.graveId));
      return keys;
    },
    failIf(g, pawn, job) {
      if (job.data.carried) return !pawn.carryCorpseId;
      const c = g.entities.get(job.targetId);
      return !c || c.removed || (c.carriedById && c.carriedById !== pawn.id);
    },
    makeToils(g, pawn, job) {
      const toils = [];
      if (!job.data.carried) {
        toils.push(
          { type: 'goto', targetId: job.targetId, adjacent: true },
          { type: 'interact', fn: (g2, p) => (startCarry(H, p, g2.entities.get(job.targetId)) ? 'done' : 'failed') },
        );
      }
      toils.push(
        { type: 'goto', x: job.data.sx, y: job.data.sy, adjacent: true },
        {
          type: 'work',
          ticks: job.data.graveId ? 160 : 520,
          workType: 'hauling',
          x: job.data.sx,
          y: job.data.sy,
          fx: 'dig',
          onTick(g2, p) {
            if ((g2.time.tick + p.id) % 40 === 0) {
              safe(() => g2.api.av.play('health_dig', { x: job.data.sx + 0.5, y: job.data.sy + 0.5 }));
              if (!g2.isHeadless) g2.fx.preset('dust', job.data.sx + 0.5, job.data.sy + 0.5, { count: 4, color: '#8a7a66' });
            }
            return p.carryCorpseId ? undefined : 'failed';
          },
          onDone: (g2, p) => (buryCarried(H, p, job.data.sx, job.data.sy, job.data.graveId) ? undefined : 'failed'),
        },
      );
      return toils;
    },
    onEnd(g, pawn, job, result) {
      if (result !== 'done' && pawn.carryCorpseId && !job.manual) dropCarry(H, pawn, { reason: 'failed' });
    },
  }, 'health');
}

/** Похоронить несомое тело в клетке (x, y). @returns {object|null} могила */
export function buryCarried(H, pawn, x, y, graveId = 0) {
  const game = H.game;
  const c = carriedOf(game, pawn);
  if (!c || c.kind !== 'corpse') return null;
  const corpse = c.entity;
  let grave = graveId ? game.entities.get(graveId) : null;
  if (grave && (grave.occupied || grave.removed)) grave = null;
  if (!grave) {
    if (!graveSpotOk(game, x, y, null)) {
      const alt = findGraveSpot(H, pawn);
      if (!alt) return null;
      x = alt.x;
      y = alt.y;
    }
    grave = game.api.build.place('grave', x, y, { force: true }) || game.entities.spawn('building', { defId: 'grave', x, y, rot: 0, faction: 'colony' });
    if (!grave) return null;
    if (grave.blueprint) grave.blueprint = false;
  }
  pawn.carryCorpseId = 0;
  if (pawn.pose === 'carry') pawn.pose = 'idle';
  H.rt.carriers.delete(pawn.id);
  return buryCorpse(H, corpse, grave, pawn);
}

/** Тело → могила: запись «Павших», надгробие, вещь на память, церемония. */
export function buryCorpse(H, corpse, grave, by) {
  const game = H.game;
  const rec = corpse.fallenId ? getFallenById(H, corpse.fallenId) : null;
  const ours = corpse.faction === 'colony';
  Object.assign(grave, {
    occupied: true,
    name: corpse.name,
    fallenId: rec?.id || 0,
    epitaph: rec?.epitaph || (ours ? '' : game.t('health.epitaph.stranger')),
    years: rec ? rec.age : null,
    diedDay: rec?.day ?? game.time.day,
    stranger: !ours,
    color: corpse.color || '#c9b8ff',
    wasLeader: !!corpse.wasLeader,
  });
  corpse.buried = true;
  game.entities.remove(corpse, 'buried');
  game.events.emit('health:buried', { corpse, grave, by: by || null, record: rec });
  game.map?.touch(grave.x, grave.y, 1, 1);
  if (rec) {
    rec.rite = 'grave';
    rec.graveDay = game.time.day;
    spawnKeepsake(H, rec, 'keepsake', grave.x, grave.y + 1);
    startFuneral(H, rec, grave, 'grave');
  } else if (!ours) {
    addMemory(H, 1, 'buried_stranger');
  }
  for (const o of game.colonists()) if (ours) thought(game, o, 'buried_properly', { otherPawnId: corpse.pawnId || 0 });
  return grave;
}

function spawnKeepsake(H, rec, defId, x, y) {
  const game = H.game;
  if (!game.defs.items.has(defId)) return;
  const stacks = game.items.spawn(defId, 1, x, y);
  rec.keepsakeDefId = defId;
  (H.state.keepsakes ||= []).push({ fallenId: rec.id, defId, kept: false });
  void stacks;
}

// ------------------------------------------------------------------ церемония
export function startFuneral(H, rec, grave, rite) {
  const game = H.game;
  const f = {
    id: (H.state.nextFuneralId = (H.state.nextFuneralId || 0) + 1),
    fallenId: rec.id,
    graveId: grave?.id || 0,
    x: grave ? grave.x : 0,
    y: grave ? grave.y : 0,
    startTick: game.time.tick,
    untilTick: game.time.tick + FUNERAL_TICKS,
    attended: [],
    speech: null,
    leaderSeen: false,
    rite,
  };
  H.state.funerals.push(f);
  game.api.ui.notify(game.t('health.log.funeral', { name: rec.name }), { type: 'info', x: f.x, y: f.y });
  return f;
}

/** Варианты надгробной речи: mind.eulogyOptions(record) или собранные из фактов. */
export function eulogyOptions(H, rec) {
  const game = H.game;
  const fromMind = safe(() => (game.providers.mind?.eulogyOptions ? game.api.mind.eulogyOptions(rec) : null));
  if (Array.isArray(fromMind) && fromMind.length) return fromMind.slice(0, 3).map((o, i) => ({ id: o.id || `opt${i}`, text: o.text || String(o), effect: o.effect || 'truth', ...o }));
  const v = { first: firstName(rec.name), f: rec.gender === 'female', variant: rec.id * 7 + 3 };
  const skill = rec.bestSkill && game.i18n.has(`health.eulogy.skill_${rec.bestSkill}`) ? game.t(`health.eulogy.skill_${rec.bestSkill}`, v) : null;
  return [
    { id: 'truth', effect: 'truth', text: skill || game.t('health.eulogy.truth', v) },
    { id: 'praise', effect: 'praise', text: game.t('health.eulogy.praise', v) },
    { id: 'memory', effect: 'memory', text: rec.friendName ? game.t('health.eulogy.memoryFriend', { ...v, friend: firstName(rec.friendName) }) : game.t('health.eulogy.memory', v) },
  ];
}

/** Мнение живых о погибшем: средняя оценка. */
function avgOpinionOf(game, rec) {
  let s = 0;
  let n = 0;
  for (const o of game.colonists()) {
    const r = relationOf(o, rec.pawnId);
    if (r) {
      s += r.opinion;
      n++;
    }
  }
  return n ? s / n : 0;
}

/** Выбрать речь (индекс или id). @returns {boolean} */
export function chooseEulogy(H, which) {
  const game = H.game;
  const f = H.state.funerals.find((x) => !x.speech && x.leaderSeen) || H.state.funerals.find((x) => !x.speech);
  if (!f) return false;
  const rec = getFallenById(H, f.fallenId);
  if (!rec) return false;
  const opts = eulogyOptions(H, rec);
  const opt = typeof which === 'number' ? opts[which] : opts.find((o) => o.id === which);
  if (!opt) return false;
  f.speech = opt.id;
  f.speechText = opt.text;
  const disliked = avgOpinionOf(game, rec) < -10;
  for (const o of game.colonists()) {
    const close = closeness(relationOf(o, rec.pawnId));
    if (opt.effect === 'truth') thought(game, o, 'eulogy_moved', { otherPawnId: rec.pawnId });
    else if (opt.effect === 'praise') {
      if (disliked && close === 'rival') thought(game, o, 'eulogy_angry', { otherPawnId: rec.pawnId });
      else if (!disliked) thought(game, o, 'eulogy_moved', { mood: 2, otherPawnId: rec.pawnId });
    } else if (opt.effect === 'memory' && (close === 'friend' || close === 'lover' || close === 'family')) thought(game, o, 'eulogy_moved', { otherPawnId: rec.pawnId });
  }
  const L = game.getLeader();
  if (L) safe(() => game.api.mind.say(L, opt.text));
  game.events.emit('health:eulogy', { record: rec, option: opt });
  H.rt.eulogyOpen = false;
  if (!game.isHeadless) game.ui.closePanel('health_eulogy');
  return true;
}

function finishFuneral(H, f) {
  const game = H.game;
  const rec = getFallenById(H, f.fallenId);
  const set = new Set(f.attended);
  for (const o of game.colonists()) if (set.has(o.id)) thought(game, o, 'said_goodbye', { otherPawnId: rec?.pawnId || 0 });
  addMemory(H, f.speech ? 6 : 3, f.speech ? 'funeral_speech' : 'funeral');
  if (rec) {
    rec.funeral = { day: game.time.day, attended: f.attended.length, speech: f.speechText || null };
    game.events.emit('health:funeral', { record: rec, rite: f.rite, speechId: f.speech || null });
  }
  if (H.rt.eulogyOpen && !game.isHeadless) game.ui.closePanel('health_eulogy');
  H.rt.eulogyOpen = false;
}

/** Каждые 30 тиков: кто пришёл, лидер у могилы → речь, конец церемонии. */
export function updateFunerals(H) {
  const game = H.game;
  const list = H.state.funerals;
  if (!list.length) return;
  const now = game.time.tick;
  const L = game.getLeader();
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    for (const o of game.colonists()) {
      if (o.downed || f.attended.includes(o.id)) continue;
      if (Math.hypot(o.x - (f.x + 0.5), o.y - (f.y + 0.5)) <= 4) f.attended.push(o.id);
    }
    if (L && !f.speech && Math.hypot(L.x - (f.x + 0.5), L.y - (f.y + 0.5)) <= 5) {
      if (!f.leaderSeen) {
        f.leaderSeen = true;
        f.untilTick = Math.max(f.untilTick, now + TICKS_PER_HOUR * 0.6);
      }
      if (!game.isHeadless && !H.rt.eulogyOpen && !H.rt.eulogyDismissed?.[f.id]) {
        H.rt.eulogyOpen = true;
        game.ui.openPanel('health_eulogy');
      }
    }
    if (now >= f.untilTick) {
      list.splice(i, 1);
      finishFuneral(H, f);
    }
  }
}

export function activeFuneral(H) {
  return H.state.funerals.find((f) => !f.speech) || H.state.funerals[0] || null;
}

function registerFuneralAttend(game, H) {
  game.jobs.registerJobType({
    id: 'health:attendFuneral',
    workType: null,
    labelKey: 'health.job.funeral',
    priority: 70,
    reserve: () => [],
    makeToils(g, pawn, job) {
      return [
        { type: 'goto', x: job.x, y: job.y },
        {
          type: 'interact',
          fn(g2, p) {
            const f = H.state.funerals.find((x) => x.id === job.data.funeralId);
            if (!f) return 'done';
            stopMoving(p);
            p.dir = Math.atan2(f.y + 0.5 - p.y, f.x + 0.5 - p.x);
            if (p.pose === 'idle') p.pose = 'idle';
            return 'running';
          },
        },
      ];
    },
  }, 'health');
  game.ai.registerThinkNode({
    id: 'health:funeral',
    priority: 70,
    factions: ['colony'],
    evaluate(g, pawn) {
      const f = H.state.funerals.find((x) => !x.attended.includes(pawn.id));
      if (!f || pawn.drafted || pawn.downed || pawn.prisoner || g.api.mind.isInBreak(pawn)) return null;
      if (!g.api.health.canWork(pawn)) return null;
      const map = g.map;
      const rng = g.rng;
      for (let k = 0; k < 10; k++) {
        const x = f.x + rng.int(-2, 2);
        const y = f.y + rng.int(-2, 2);
        if ((x === f.x && y === f.y) || !map.inBounds(x, y) || !map.isPassable(x, y)) continue;
        if (!g.pathfinder.canReach(pawn.x, pawn.y, x, y)) continue;
        return g.jobs.createJob('health:attendFuneral', pawn, { x, y, data: { funeralId: f.id } });
      }
      return null;
    },
  }, 'health');
}

// ------------------------------------------------------------------ сожжение
const isFirebox = (game, b) => !!b && (b.defId === 'firebox' || !!game.defs.buildings.get(b.defId)?.firebox);

export function cremate(H, pawn, firebox) {
  const game = H.game;
  const c = carriedOf(game, pawn);
  if (!c || c.kind !== 'corpse') return false;
  const corpse = c.entity;
  pawn.carryCorpseId = 0;
  if (pawn.pose === 'carry') pawn.pose = 'idle';
  H.rt.carriers.delete(pawn.id);
  const rec = corpse.fallenId ? getFallenById(H, corpse.fallenId) : null;
  corpse.buried = true;
  game.entities.remove(corpse, 'cremated');
  // жар — модулю поезда (journey.addHeat / событие)
  const heat = 25;
  if (game.providers.journey?.addHeat) safe(() => game.api.journey.addHeat(heat, { source: 'cremation' }));
  game.events.emit('health:cremated', { record: rec, corpse, firebox: firebox || null, heat, pawn });
  if (!game.isHeadless) {
    game.fx.preset('embers', (firebox?.x ?? pawn.x) + 0.5, (firebox?.y ?? pawn.y) + 0.5, { count: 30, color: '#ffb347' });
    safe(() => game.api.av.shake(0.15));
  }
  if (rec) {
    rec.rite = 'fire';
    for (const o of game.colonists()) {
      const soft = game.api.mind.hasTrait(o, 'softhearted') || game.api.mind.hasTrait(o, 'pessimist');
      thought(game, o, soft ? 'cremated_horror' : 'he_carries_us', { otherPawnId: rec.pawnId });
    }
    spawnKeepsake(H, rec, 'urn', Math.floor(pawn.x), Math.floor(pawn.y));
    addMemory(H, 3, 'cremation');
    game.api.ui.notify(game.t('health.log.cremated', { name: rec.name, f: rec.gender === 'female' }), { type: 'info', x: pawn.x, y: pawn.y });
    game.events.emit('health:funeral', { record: rec, rite: 'fire', speechId: null });
  }
  return true;
}

function registerRiteInteractions(game, H) {
  const reg = game.defs.interactions;
  // сжечь в топке (удержание)
  reg.add({
    id: 'health:cremate',
    order: 2,
    hold: true,
    find(g, L, tx, ty) {
      const c = carriedOf(g, L);
      if (!c || c.kind !== 'corpse') return null;
      const b = g.map.buildingAt(tx, ty);
      if (!isFirebox(g, b)) return null;
      let done = false;
      return {
        label: g.t('health.act.cremate', { name: firstName(c.entity.name) }),
        x: tx,
        y: ty,
        onHoldStart() {
          done = false;
        },
        onHoldTick(g2, pawn, ms) {
          if (done || ms < 1200) return;
          done = true;
          cremate(H, pawn, b);
        },
      };
    },
  }, 'health');
  // похоронить здесь (лидер несёт тело)
  reg.add({
    id: 'health:buryHere',
    order: 4,
    find(g, L, tx, ty) {
      const c = carriedOf(g, L);
      if (!c || c.kind !== 'corpse') return null;
      const b = g.map.buildingAt(tx, ty);
      const grave = b?.defId === 'grave' && !b.occupied && !b.blueprint ? b : null;
      if (!grave && !graveSpotOk(g, tx, ty, L)) return null;
      return {
        label: g.t('health.act.buryHere', { name: firstName(c.entity.name) }),
        x: tx,
        y: ty,
        run(g2, pawn) {
          if (!g2.jobs.startManual(pawn, 'health:bury', { targetId: 0, x: tx, y: ty, data: { sx: tx, sy: ty, graveId: grave?.id || 0, carried: true } })) g2.audio.play('error');
        },
      };
    },
  }, 'health');
}

// ------------------------------------------------------------------ гниение и мысли
/** Раз в час: гниение, «видел тело», запах; раз в сутки — «не похоронили», вещи на память. */
export function hourlyCorpses(H) {
  const game = H.game;
  const temp = safe(() => game.api.journey.getAmbientTemp(), 15) ?? 15;
  const cold = temp < 0 ? 0.3 : temp < 8 ? 0.7 : 1;
  const perHour = BAL.corpseRotPerDay / 24;
  const colonists = game.colonists();
  for (const c of game.entities.listKind('corpse')) {
    if (c.carriedById && !game.entities.get(c.carriedById)) c.carriedById = 0;
    const kept = c.carriedById ? null : keptAt(game, c.x, c.y);
    const before = c.rot ?? 0;
    c.rot = Math.min(1.5, before + perHour * cold * (kept ? 0.1 : 1));
    if (rotStage(before) !== rotStage(c.rot)) game.events.emit('health:corpseRot', { corpse: c, stage: rotStage(c.rot) });
    if (c.faction !== 'colony' && c.rot >= 1.45) {
      game.entities.remove(c, 'decayed');
      continue;
    }
    if (kept) continue;
    for (const o of colonists) {
      if (o.downed || o.asleep) continue;
      const d = Math.hypot(o.x - c.x - 0.5, o.y - c.y - 0.5);
      if (d > 5.5) continue;
      if (c.faction === 'colony') thought(game, o, 'saw_corpse', { otherPawnId: c.pawnId || 0 });
      else thought(game, o, 'saw_corpse_enemy');
      if (c.rot >= 0.35 && c.rot < 0.95 && d <= 3.5) thought(game, o, 'smelled_corpse');
    }
  }
  // кровавые следы тускнеют
  const now = game.time.tick;
  for (const d of game.entities.listKind('decal')) {
    if (!d.health) continue;
    d.alpha = Math.max(0, (d.alpha ?? 0.3) - 0.012);
    if (d.alpha <= 0.04 || now - (d.bornTick ?? now) > TICKS_PER_DAY * 3) {
      game.entities.remove(d, 'faded');
      H.rt.trailCount = Math.max(0, H.rt.trailCount - 1);
    }
  }
}

export function dailyCorpses(H) {
  const game = H.game;
  const now = game.time.tick;
  let unburied = null;
  for (const c of game.entities.ofKind('corpse')) {
    if (c.faction !== 'colony' || c.buried) continue;
    if (now - (c.diedTick ?? now) < TICKS_PER_DAY) continue;
    if (keptAt(game, c.x, c.y)) continue;
    unburied = c;
    break;
  }
  if (unburied) for (const o of game.colonists()) thought(game, o, 'not_buried', { otherPawnId: unburied.pawnId || 0 });
  // вещи на память: сохранили (лежит на складе или в инвентаре) → +2
  const ks = H.state.keepsakes || [];
  for (const k of ks) {
    if (k.kept) continue;
    const stored = game.items.count(k.defId, { storedOnly: true });
    const claimed = ks.filter((x) => x.kept && x.defId === k.defId).length;
    if (stored > claimed) {
      k.kept = true;
      const rec = getFallenById(H, k.fallenId);
      if (rec) rec.keepsakeKept = true;
      addMemory(H, 2, 'keepsake');
      for (const o of game.colonists()) {
        const close = rec ? closeness(relationOf(o, rec.pawnId)) : 'none';
        if (close === 'friend' || close === 'lover' || close === 'family') thought(game, o, 'keepsake_comfort', { otherPawnId: rec?.pawnId || 0 });
      }
    }
  }
}

export function registerFunerals(game, H) {
  registerBurialJob(game, H);
  registerFuneralAttend(game, H);
  registerRiteInteractions(game, H);
  H.keptSpotLabel = (x, y) => keptAt(game, x, y);
}

export { canBeCarried, FUNERAL_TICKS };
