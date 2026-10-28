// journey — состояние (JSON, свой сериализатор 'journey') и общие помощники.
import { TICKS_PER_HOUR } from '../../core/constants.js';
import { RNG } from '../../core/rng.js';
import { optionOf, BOSS_STEP } from './route.js';

export const STATE_VERSION = 1;
export const hours = (h) => Math.round(h * TICKS_PER_HOUR);

export function createState() {
  return {
    v: STATE_VERSION,
    route: null,
    /** номер текущей станции: 0 — стартовая, 1..4 */
    step: 0,
    /** выбранный вариант по шагам (индекс 0/1 или null) */
    choice: [null, null, null, null],
    phase: 'station', // 'station' | 'travel' | 'wild' | 'ended'
    /** перегон: {to, t, len, halt: null|'ambush'|'regroup', haltUntil, ambushAt, ambushDone, forkAsked, startTick} */
    leg: null,
    arrivedTick: 0,
    wildN: 0,
    rot: { deadline: 0, level: 0, nextLevelAt: 0, nextBeastAt: 0, creep: 0 },
    teller: { nextRaid: 0, nextIncident: 0, cd: {} },
    boss: { at: 0, spawned: false, defeated: false },
    dialogs: [],
    uid: 1,
    victory: null,
    rng: null,
    stats: { legs: 0, ambushes: 0, wildStops: 0, incidents: 0, raids: 0, rotWaves: 0, startTick: 0 },
  };
}

/** Текущий вариант маршрута (станция, на которой стоим) или null (старт / дикая стоянка). */
export function currentOption(J) {
  const S = J.S;
  if (S.step < 1) return null;
  return optionOf(S.route, S.step, S.choice[S.step - 1] ?? 0);
}

/** Вариант, к которому едем (если выбран). */
export function targetOption(J) {
  const S = J.S;
  const to = S.leg?.to ?? S.step + 1;
  const c = S.choice[to - 1];
  return c === null || c === undefined ? null : optionOf(S.route, to, c);
}

export function optionName(J, opt) {
  if (!opt) return J.game.t('journey.st.start');
  return J.game.t(`journey.pname.${opt.type}`, { variant: opt.nameIdx });
}

/** Публичное описание станции (API getStation и события). */
export function stationInfo(J, opt = currentOption(J)) {
  const game = J.game;
  const S = J.S;
  if (S.phase === 'wild') {
    return { index: S.step, id: `wild${S.wildN}`, nameKey: 'journey.wild.name', name: game.t('journey.wild.name'), type: 'wild', biome: game.map?.biome || 'forest', wild: true, boss: null };
  }
  if (!opt) return { index: 0, id: 'start', nameKey: 'journey.st.start', name: game.t('journey.st.start'), type: 'start', biome: game.map?.biome || 'forest', boss: null };
  return {
    index: opt.step, id: opt.id, nameKey: `journey.pname.${opt.type}`, name: optionName(J, opt), type: opt.type,
    typeName: game.t(`journey.type.${opt.type}`), biome: opt.biome, boss: opt.boss, danger: opt.danger,
  };
}

export function diff(J) {
  const d = J.game.defs.difficulties.get(J.game.colony?.difficulty) || J.game.defs.difficulties.get('normal');
  return { threat: d?.threat ?? 1, rotMul: d?.rotMul ?? 1, incidentGood: d?.incidentGood ?? 1 };
}

export const isFinal = (J) => J.S.step >= BOSS_STEP;

export function safe(J, where, fn, def = null) {
  try {
    const v = fn();
    return v === undefined ? def : v;
  } catch (err) {
    J.game.error(err, `journey:${where}`);
    return def;
  }
}

export function notify(J, key, vars, type = 'info', extra = {}) {
  J.game.api.ui.notify(J.game.t(key, vars), { type, ...extra });
}

export const raidActive = (J) => !!safe(J, 'isRaidActive', () => J.game.api.combat.isRaidActive?.(), false);

/** Свой детерминированный поток journey (состояние — в сейве, S.rng): не сдвигает основной game.rng. */
export function jrng(J) {
  if (!J._rng) {
    J._rng = new RNG(1);
    J._rng.setState(J.S.rng ?? J.game.rng.fork('journey:story').getState());
  }
  return J._rng;
}
