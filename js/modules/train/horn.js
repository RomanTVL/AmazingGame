// Гудок, посадка, отправление и отставшие (MVP).
//   H (только из кабины): нажать — посадка 30 с (все бегут к поезду); удержать 1 с — отправление сейчас
//   (подтверждение со списком тех, кто не сел); двойной — «К оружию!» (обрабатывает combat).
//   Посадка закончилась / все сели → отправление. Не севшие остаются на станции навсегда (журнал, мысли друзей).
// КОГДА и КУДА ехать решает journey: train спрашивает game.api.journey.canDepart() и зовёт game.api.journey.depart().
import { EVENTS } from '../../core/events.js';
import { ops, isAboard, isInLoco } from './state.js';

export const BOARDING_TICKS = 1800; // 30 с при 1x
export const LONG_MS = 1000;
export const DOUBLE_MS = 400;
const ALL_ABOARD_GRACE = 120; // все сели — ещё 2 с и в путь

const RT = new WeakMap();
function rt(game) {
  let r = RT.get(game);
  if (!r) RT.set(game, (r = { horn: null, pendingShortMs: -1 }));
  return r;
}
export function resetHornRuntime(game) {
  RT.delete(game);
}

const notify = (game, key, vars, type = 'info') => game.api.ui.notify(game.t(key, vars), { type });

export function isInCab(game, pawn) {
  return isInLoco(game, pawn);
}

/** Поселенцы (кроме лидера), которых нет в поезде. */
export function missingPawns(game) {
  if (!game.train?.stamped) return [];
  return game.colonists().filter((p) => !p.isLeader && !isAboard(game, p));
}

function canDepart(game) {
  const j = game.api.journey;
  if (typeof j.canDepart !== 'function') return false;
  try {
    return !!j.canDepart();
  } catch (err) {
    game.error(err, 'train:canDepart');
    return false;
  }
}

function hornAt(game, pattern, sfx) {
  const L = game.getLeader();
  const c = game.train?.center() || L || { x: 0, y: 0 };
  game.api.av.play(sfx, { x: c.x, y: c.y });
  game.events.emit(EVENTS.JOURNEY_HORN, { pattern });
  game.api.vision.noise(c.x, c.y, 30, 'horn');
}

/** Начать посадку. opts.auto — служебная (journey после засады): без отправления в конце. */
export function startBoarding(game, opts = {}) {
  const O = ops(game);
  if (!O || !game.map) return false;
  if (!opts.auto && !canDepart(game)) {
    const tr = typeof game.api.journey.isTravelling === 'function' && game.api.journey.isTravelling();
    let hint = null;
    if (!tr && typeof game.api.journey.departHint === 'function') {
      try {
        hint = game.api.journey.departHint();
      } catch (err) {
        game.error(err, 'train:departHint');
      }
    }
    if (hint) game.api.ui.notify(hint, { type: 'bad' });
    else notify(game, tr ? 'train.horn.travelling' : 'train.horn.cantDepart', {}, 'bad');
    return false;
  }
  const now = game.time.tick;
  const ticks = opts.ticks ?? BOARDING_TICKS;
  O.boarding = { startTick: now, untilTick: now + ticks, auto: !!opts.auto, allAt: -1 };
  O.confirm = null;
  const missing = missingPawns(game);
  if (!opts.auto) notify(game, 'train.horn.boarding', { sec: Math.round(ticks / 60) }, 'info');
  game.events.emit(EVENTS.JOURNEY_BOARDING, { untilTick: O.boarding.untilTick, missing });
  return true;
}

export function cancelBoarding(game) {
  const O = ops(game);
  if (!O) return;
  O.boarding = null;
  O.confirm = null;
  if (!game.isHeadless) game.ui.closePanel('train_depart');
}

/** Окно подтверждения (список не севших). */
function openConfirm(game, missing) {
  const O = ops(game);
  O.confirm = { ids: missing.map((p) => p.id), tick: game.time.tick };
  if (!game.isHeadless) game.ui.openPanel('train_depart');
}

/** Отставшие: запись, событие, мысли, удаление из мира. */
function leaveBehind(game, list) {
  if (!list.length) return;
  const O = ops(game);
  let st = null;
  try {
    st = game.api.journey.getStation();
  } catch (err) {
    game.error(err, 'train:getStation');
  }
  const sname = st?.name || (st?.nameKey ? game.t(st.nameKey) : '');
  for (const p of list) {
    if (p.job) game.jobs.endJob(p, 'cancelled');
    O.leftBehind.push({ id: p.id, name: p.name, station: sname, day: game.time.day, tick: game.time.tick });
    game.events.emit(EVENTS.JOURNEY_LEFT_BEHIND, { pawn: p, station: st });
    game.api.ui.notify(game.t('train.left.one', { name: p.name, station: sname }), { type: 'bad' });
    for (const q of game.colonists()) if (q !== p) game.api.mind.addThought(q, 'train_left_friend', { otherPawnId: p.id });
    game.entities.remove(p, 'leftBehind');
  }
}

/**
 * Отправиться. Без force и с не севшими — открывает подтверждение и возвращает false.
 * @returns {boolean} поезд тронулся
 */
export function depart(game, opts = {}) {
  const O = ops(game);
  if (!O || !canDepart(game)) return false;
  const missing = missingPawns(game);
  if (missing.length && !opts.force) {
    openConfirm(game, missing);
    return false;
  }
  leaveBehind(game, missing);
  O.boarding = null;
  O.confirm = null;
  if (!game.isHeadless) game.ui.closePanel('train_depart');
  let ok = false;
  try {
    ok = !!game.api.journey.depart();
  } catch (err) {
    game.error(err, 'train:depart');
  }
  if (ok) O.departures = (O.departures || 0) + 1;
  return ok;
}

/** Ответ на подтверждение: true — ехать, false — ждать ещё 10 с. */
export function confirmDepart(game, go) {
  const O = ops(game);
  if (!O) return false;
  if (go) return depart(game, { force: true });
  O.confirm = null;
  if (O.boarding) O.boarding.untilTick = Math.max(O.boarding.untilTick, game.time.tick + 600);
  if (!game.isHeadless) game.ui.closePanel('train_depart');
  return false;
}

// ---------------- системы ----------------

/** Тиковая: ход посадки. */
export function boardingTick(game) {
  const O = ops(game);
  const B = O?.boarding;
  if (!B) return;
  const now = game.time.tick;
  if (B.auto) {
    if (now >= B.untilTick || !missingPawns(game).length) O.boarding = null;
    return;
  }
  if (!canDepart(game)) {
    cancelBoarding(game);
    return;
  }
  const missing = missingPawns(game);
  if (!missing.length) {
    if (B.allAt < 0) {
      B.allAt = now;
      if (O.confirm) {
        O.confirm = null;
        if (!game.isHeadless) game.ui.closePanel('train_depart');
      }
    }
    if (now - B.allAt >= ALL_ABOARD_GRACE) {
      notify(game, 'train.depart.allAboard', {}, 'good');
      depart(game, { force: true });
    }
    return;
  }
  B.allAt = -1;
  // гудок будит: спящие снаружи встают и бегут к поезду
  if ((now - B.startTick) % 60 === 0) {
    for (const p of missing) {
      if (!(p.asleep || p.job?.type === 'sleep' || p.job?.type === 'mind_sleep')) continue;
      if (p.job) game.jobs.endJob(p, 'cancelled');
      p.asleep = false;
    }
  }
  if (now >= B.untilTick && !O.confirm) openConfirm(game, missing);
}

/** Кадровая: клавиша H (нажать / удержать / двойной). */
export function hornInput(game, dt) {
  const inp = game.input;
  const R = rt(game);
  const ms = (Number.isFinite(dt) ? dt : 0) * 1000;
  if (R.pendingShortMs >= 0) {
    R.pendingShortMs -= ms;
    if (R.pendingShortMs < 0) shortHorn(game);
  }
  if (inp.pressed('journey:horn')) {
    inp.consume('journey:horn');
    const L = game.getLeader();
    if (!L || !isInCab(game, L)) {
      notify(game, 'train.horn.cabOnly', {}, 'info');
      R.horn = null;
      return;
    }
    if (R.pendingShortMs >= 0) {
      R.pendingShortMs = -1;
      R.horn = null;
      hornAt(game, 'double', 'train:horn_double');
      notify(game, 'train.horn.double', {}, 'info');
      return;
    }
    R.horn = { ms: 0, long: false };
  }
  if (!R.horn) return;
  if (inp.isDown('journey:horn')) {
    R.horn.ms += ms;
    if (!R.horn.long && R.horn.ms >= LONG_MS) {
      R.horn.long = true;
      longHorn(game);
    }
  } else {
    if (!R.horn.long) R.pendingShortMs = DOUBLE_MS;
    R.horn = null;
  }
}

function shortHorn(game) {
  hornAt(game, 'short', 'train:horn');
  const O = ops(game);
  if (O?.boarding && !O.boarding.auto) return; // уже идёт посадка — просто гудок
  startBoarding(game);
}

function longHorn(game) {
  hornAt(game, 'long', 'train:horn_long');
  if (!canDepart(game)) {
    startBoarding(game); // покажет причину
    return;
  }
  const O = ops(game);
  if (!O.boarding) O.boarding = { startTick: game.time.tick, untilTick: game.time.tick + BOARDING_TICKS, auto: false, allAt: -1 };
  depart(game, { force: false });
}

// ---------------- ИИ: бежать к поезду ----------------

function freeCell(game, pawn) {
  const tr = game.train;
  const cars = [...tr.cars].sort((a, b) => (b.type === 'residential') - (a.type === 'residential'));
  const cells = [];
  for (const car of cars) {
    for (const c of tr.interior(car)) if (game.map.isPassable(c.x, c.y) && !game.map.buildingAt(c.x, c.y)) cells.push(c);
    if (cells.length > 12) break;
  }
  if (!cells.length) return null;
  return cells[(pawn.id * 7 + 3) % cells.length];
}

export function registerBoardingAI(game) {
  game.ai.registerThinkNode({
    id: 'train:board',
    priority: 96,
    interrupts: true,
    factions: ['colony'],
    evaluate(g, pawn, ctx) {
      const B = g.train?.ops?.boarding;
      if (!B || !g.train.stamped || pawn.isLeader || pawn.downed || pawn.drafted || pawn.prisoner) return null;
      if (isAboard(g, pawn)) {
        const j = pawn.job;
        if (ctx?.interrupt && j && g.train.carAt(j.x, j.y)) return null;
        if (j?.type === 'wait') return null;
        return g.jobs.createJob('wait', pawn, { data: { ticks: 90 } });
      }
      if (pawn.job?.type === 'goto' && pawn.job.data?.board) return null;
      const c = freeCell(g, pawn);
      if (!c) return null;
      return g.jobs.createJob('goto', pawn, { x: c.x, y: c.y, data: { wait: 30, board: true } });
    },
  }, 'train');
}

// ---------------- UI: подтверждение отправления ----------------

export function registerDepartPanel(game) {
  game.ui.registerPanel({
    id: 'train_depart',
    title: 'train.depart.title',
    width: 420,
    height: 250,
    anchor: 'center',
    modal: true,
    draw(ctx, g, ui, r) {
      const O = g.train?.ops;
      const ids = O?.confirm?.ids || [];
      const names = ids.map((id) => g.entities.get(id)).filter((p) => p && !p.dead).map((p) => p.name);
      let y = r.y + 4;
      ui.text(g.t('train.depart.missing', { n: names.length }), r.x, y, { size: 14, bold: true, color: ui.theme.warn });
      y += 24;
      for (const n of names.slice(0, 6)) {
        ui.text(`• ${n}`, r.x + 8, y, { size: 13 });
        y += 19;
      }
      ui.text(g.t('train.depart.warn'), r.x, r.y + r.h - 64, { size: 12, color: ui.theme.bad });
      const bw = (r.w - 12) / 2;
      if (ui.button(r.x, r.y + r.h - 34, bw, 32, g.t('train.depart.go'))) confirmDepart(g, true);
      if (ui.button(r.x + bw + 12, r.y + r.h - 34, bw, 32, g.t('train.depart.wait'))) confirmDepart(g, false);
    },
    onClose(g) {
      const O = g.train?.ops;
      if (O?.confirm) confirmDepart(g, false);
    },
  }, 'train');
}
