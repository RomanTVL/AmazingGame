// journey — отправление, фаза «в пути» (карта-полоса, развилка, засада), дикая стоянка (кончилось топливо), прибытие.
// Переезд — game.changeStation (ядро уносит содержимое вагонов и всех живых поселенцев).
import { EVENTS } from '../../core/events.js';
import { stopMoving } from '../../sim/pawn.js';
import { hours, stationInfo, targetOption, isFinal, notify, safe, diff, jrng } from './state.js';
import { optionOf, STEP_BIOME } from './route.js';
import { decorateStation, layGravel, clearGravel } from './worldgen.js';
import { startRotTimer, rotHoursFor } from './rot.js';
import { onArrivalTeller } from './teller.js';

const REGROUP_TICKS = 900;

/** Сколько топлива нужно на (оставшийся) перегон, или null (не паровоз / ехать некуда). */
export function fuelNeed(J) {
  const S = J.S;
  const game = J.game;
  const bph = safe(J, 'burnPerHour', () => game.api.train.burnPerHour?.() ?? 0, 0);
  if (!bph || !S.route) return null;
  let ticks = 0;
  if (S.phase === 'station' && !isFinal(J)) ticks = S.route.legs[S.step];
  else if ((S.phase === 'wild' || S.phase === 'travel') && S.leg) ticks = S.leg.len - S.leg.t;
  else return null;
  return Math.ceil((ticks / hours(1)) * bph);
}

/** Почему нельзя ехать (null — можно). */
export function departBlock(J) {
  const S = J.S;
  const game = J.game;
  if (!game.train?.stamped || !S.route) return 'none';
  if (S.phase === 'station' && isFinal(J)) return 'final';
  if (S.phase !== 'station' && S.phase !== 'wild') return 'travelling';
  const need = fuelNeed(J);
  if (need !== null) {
    const fuel = safe(J, 'fuelUnits', () => game.api.train.fuelUnits?.() ?? 0, 0);
    if (fuel < 1) return 'noFuel';
    // с дикой стоянки — только с запасом на весь остаток перегона (вторая дикая стоянка на перегоне не нужна)
    if (S.phase === 'wild' && fuel < need) return 'needFuel';
  }
  return null;
}

export function departHint(J) {
  const b = departBlock(J);
  const t = (k, v) => J.game.t(k, v);
  if (b === 'noFuel') return t('journey.depart.noFuel', { need: fuelNeed(J) ?? 0 });
  if (b === 'needFuel') return t('journey.depart.needFuel', { need: fuelNeed(J) ?? 0, have: safe(J, 'fuel', () => J.game.api.train.fuelUnits?.() ?? 0, 0) });
  if (b === 'final') return t('journey.route.final');
  return null;
}

export function canDepart(J) {
  return departBlock(J) === null;
}

export const isTravelling = (J) => J.S.phase === 'travel';
export const isMoving = (J) => J.S.phase === 'travel' && !!J.S.leg && !J.S.leg.halt;

function change(J, opts, kind) {
  J.R.expect = kind;
  try {
    return J.game.changeStation(opts);
  } finally {
    J.R.expect = null;
  }
}

/** Отправиться (зовёт train после посадки). @returns {boolean} */
export function depart(J) {
  if (!canDepart(J)) return false;
  const game = J.game;
  const S = J.S;
  const from = stationInfo(J);
  if (S.phase === 'station') {
    const to = S.step + 1;
    const len = S.route.legs[to - 1];
    const rng = jrng(J);
    const p = Math.min(0.7, (0.12 + 0.06 * to) * diff(J).threat); // «изредка»
    S.leg = {
      to, t: 0, len, halt: null, haltUntil: 0, ambushAt: rng.chance(p) ? Math.floor(len * rng.range(0.2, 0.6)) : -1, ambushDone: false,
      forkAsked: false, startTick: game.time.tick, wilds: 0,
    };
  }
  game.events.emit('journey:departing', { station: from });
  S.phase = 'travel';
  const tr = game.train;
  change(J, { biome: 'travel', stationIndex: 1000 + S.leg.to * 10 + S.wildN, w: tr.length + 70, h: 40 }, 'travel');
  game.events.emit('journey:travelling', { from, to: S.leg.to });
  notify(J, 'journey.travel.departed', { name: from.name }, 'good');
  game.api.ui.setObjective('journey', game.t('journey.obj.travel', { n: S.leg.to }));
  return true;
}

/** Выбор варианта на шаге (можно, пока не доехали до развилки). @returns {boolean} */
export function choose(J, step, idx) {
  const S = J.S;
  if (!S.route || step < 1 || step > S.route.steps.length || !optionOf(S.route, step, idx)) return false;
  const next = S.phase === 'travel' || S.phase === 'wild' ? S.leg?.to : S.step + 1;
  if (step !== next) return false;
  S.choice[step - 1] = idx;
  notify(J, 'journey.route.chosen', { name: J.game.t(`journey.type.${optionOf(S.route, step, idx).type}`) }, 'info');
  return true;
}

function standingEnemies(game) {
  return game.entities.listKind('pawn').some((p) => p.faction === 'enemy' && !p.dead && !p.downed && !p.prisoner);
}

function hopAboard(J) {
  const game = J.game;
  const tr = game.train;
  if (!tr?.stamped) return;
  const cells = [];
  for (const car of tr.cars) for (const c of tr.interior(car)) if (game.map.isPassable(c.x, c.y) && !game.map.buildingAt(c.x, c.y)) cells.push(c);
  let i = 0;
  for (const p of game.colonists()) {
    if (safe(J, 'isAboard', () => game.api.train.isAboard?.(p), true) || !cells.length) continue;
    const c = cells[(p.id * 5 + i++) % cells.length];
    if (p.job) game.jobs.endJob(p, 'cancelled');
    game.entities.setPosition(p, c.x + 0.5, c.y + 0.5);
    stopMoving(p);
  }
}

function ambush(J) {
  const game = J.game;
  const S = J.S;
  const L = S.leg;
  L.ambushDone = true;
  L.halt = 'ambush';
  layGravel(game);
  const rng = jrng(J);
  const faction = L.to <= 2 ? rng.pick(['bandits', 'rot_beasts']) : rng.pick(['bandits', 'cultists', 'undead']);
  const cap = 20 + 22 * game.colonists().filter((p) => !p.downed).length;
  const points = Math.round(Math.min(cap, 18 + L.to * 5) * diff(J).threat);
  const res = safe(J, 'spawnRaid', () => game.api.combat.spawnRaid({ points, faction, ambushTrain: true }), null);
  S.stats.ambushes++;
  game.api.av.play('journey_brakes', {});
  notify(J, 'journey.travel.ambush', {}, 'danger');
  game.events.emit('journey:incident', { id: 'ambush' });
  if (!res) {
    clearGravel(game);
    L.halt = null;
  }
}

/** Тик фазы «в пути». */
export function travelTick(J) {
  const S = J.S;
  const L = S.leg;
  if (S.phase !== 'travel' || !L) return;
  const game = J.game;
  const now = game.time.tick;
  if (L.halt === 'ambush') {
    if (!standingEnemies(game)) {
      L.halt = 'regroup';
      L.haltUntil = now + REGROUP_TICKS;
      safe(J, 'startBoarding', () => game.api.train.startBoarding?.({ auto: true, ticks: REGROUP_TICKS }));
      notify(J, 'journey.travel.regroup', {}, 'good');
    }
    return;
  }
  if (L.halt === 'regroup') {
    const miss = safe(J, 'missing', () => game.api.train.missing?.() || [], []);
    if (!miss.length || now >= L.haltUntil) {
      hopAboard(J);
      clearGravel(game);
      L.halt = null;
      notify(J, 'journey.travel.resume', {}, 'info');
    }
    return;
  }
  L.t++;
  if (!L.ambushDone && L.ambushAt >= 0 && L.t >= L.ambushAt) {
    ambush(J);
    return;
  }
  if (S.choice[L.to - 1] === null || S.choice[L.to - 1] === undefined) {
    if (!L.forkAsked && L.t >= L.len * 0.4) {
      L.forkAsked = true;
      J.R.openRoute = true;
      notify(J, 'journey.travel.fork', {}, 'info');
    }
    if (L.t >= L.len * 0.85) {
      S.choice[L.to - 1] = 0;
      notify(J, 'journey.travel.autoChoice', { name: game.t(`journey.type.${optionOf(S.route, L.to, 0).type}`) }, 'info');
    }
  }
  if (L.t >= L.len) arrive(J);
}

/** Прибытие на станцию шага leg.to. */
export function arrive(J) {
  const game = J.game;
  const S = J.S;
  const L = S.leg;
  const to = L.to;
  const idx = S.choice[to - 1] ?? 0;
  S.choice[to - 1] = idx;
  const opt = optionOf(S.route, to, idx);
  game.events.emit(EVENTS.JOURNEY_ARRIVING, { station: stationInfo(J, opt) });
  S.step = to;
  S.phase = 'station';
  S.leg = null;
  S.stats.legs++;
  S.arrivedTick = game.time.tick;
  change(J, { biome: opt.biome, stationIndex: to, w: 140, h: 90 }, 'station');
  decorateStation(game, opt.type, game.rng.fork(`journey:deco:${to}:${opt.type}`));
  startRotTimer(J, rotHoursFor(J, to));
  if (opt.boss) {
    S.boss = { at: game.time.tick + hours(6), spawned: false, defeated: false }; // 6 ч — перевязать раны и приготовиться
    notify(J, 'journey.boss.warn', {}, 'danger');
    game.api.ui.setObjective('journey', game.t('journey.obj.boss'));
  } else game.api.ui.setObjective('journey', game.t('journey.obj.station', { n: to, left: 4 - to }));
  onArrivalTeller(J, opt.danger);
  const st = stationInfo(J, opt);
  game.events.emit('journey:arrived', { station: st });
  game.api.av.play('journey_brakes', {});
  notify(J, 'journey.travel.arrived', { name: st.name, type: game.t(`journey.type.${opt.type}`) }, 'good');
}

/** Кончилось топливо в пути — дикая стоянка (биом цели). */
export function wildStop(J) {
  const game = J.game;
  const S = J.S;
  if (S.phase !== 'travel' || !S.leg) return false;
  if (S.leg.wilds >= 1) {
    // на этом перегоне уже стояли — дотягиваем на остатках пара (без новой дикой стоянки)
    notify(J, 'journey.travel.coast', {}, 'bad');
    return false;
  }
  S.leg.wilds = (S.leg.wilds || 0) + 1;
  S.phase = 'wild';
  S.wildN++;
  S.stats.wildStops++;
  S.leg.halt = null;
  const biome = targetOption(J)?.biome || STEP_BIOME[S.leg.to] || 'forest';
  change(J, { biome, stationIndex: 500 + S.wildN, w: 120, h: 80 }, 'wild');
  decorateStation(game, biome === 'ash' ? 'ash' : 'forest', game.rng.fork(`journey:deco:wild:${S.wildN}`));
  startRotTimer(J, 30 * diff(J).rotMul);
  // на дикой стоянке рейда по прибытии нет
  S.teller.nextRaid = Math.max(S.teller.nextRaid, game.time.tick + hours(30));
  game.events.emit('journey:arrived', { station: stationInfo(J) });
  notify(J, 'journey.wild.stop', {}, 'danger');
  game.api.ui.setObjective('journey', game.t('journey.obj.wild'));
  return true;
}
