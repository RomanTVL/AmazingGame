// journey — состояние модуля (JSON, свой сериализатор 'journey') и общие помощники.
import { RNG } from '../../core/rng.js';
import { TICKS_PER_HOUR } from '../../core/constants.js';
import { findOption, actOfStep, rotSpeedOfAct, biomeOfStep } from './route.js';

export const STATE_VERSION = 1;

export function createState() {
  return {
    v: STATE_VERSION,
    route: null,
    /** выбранные станции по шагам: [{step, id}] */
    path: [],
    step: 1,
    stationId: null,
    /** дикая стоянка (кончилось топливо): {reason, biome, legStep, n} */
    wild: null,
    phase: 'station', // 'station' | 'departing' | 'travel' | 'ended'
    mapKind: 'station', // 'station' | 'travel' | 'wild'
    next: null,
    awaitingChoice: false,
    departAt: 0,
    trainPos: 0,
    rotPos: 0,
    rotInit: false,
    rotOverTicks: 0,
    rotLevel: 0,
    rotFrontX: -1,
    rotBeastAt: 0,
    rotBehind: false,
    rotNotified: {},
    arrivedTick: 0,
    leg: null,
    story: {
      notes: {}, notesRead: 0, talked: 0, visitsDone: {}, queue: [], beatsDone: {}, journal: [],
      firstLeaderId: 0, metLeaders: [], prevLeader: null, act: 1, spawnedNotes: {},
    },
    teller: { nextTick: 0, cd: {}, fired: {}, lastThreat: 0 },
    dialogs: [],
    uid: 1,
    weather: { kind: 'clear', intensity: 0, untilTick: 0, nextTick: 0 },
    tempMod: { value: 0, untilTick: 0, kind: null },
    factions: { traders: 10, inquisition: 0, cult: -20, clans: 0 },
    deaths: [],
    boss: {},
    stats: { legs: 0, versts: 0, travelTicks: 0, encounters: 0, incidents: 0, wildStops: 0, startTick: 0, joined: 0 },
    ending: null,
    rng: null,
    leftBehind: [],
    pending: null,
    eventMul: {},
    trainSim: { speed: 0 },
  };
}

/** Детерминированный поток модуля (состояние — в сейве). */
export function journeyRng(J) {
  if (!J._rng) {
    J._rng = new RNG(1);
    if (J.state.rng) J._rng.setState(J.state.rng);
    else {
      const f = J.game.rng.fork('journey:story');
      J._rng.setState(f.getState());
    }
  }
  return J._rng;
}

export function saveRng(J) {
  if (J._rng) J.state.rng = J._rng.getState();
}

/** Текущая станция (вариант маршрута) или описание дикой стоянки. */
export function currentOption(J) {
  const s = J.state;
  if (s.wild) return null;
  return findOption(s.route, s.stationId);
}

/** Публичное описание станции (для API и событий). */
export function stationInfo(J, opt = currentOption(J)) {
  const game = J.game;
  const s = J.state;
  if (!opt) {
    if (s.wild) {
      return {
        index: s.step, step: s.step, act: actOfStep(Math.max(1, s.step)), biome: s.wild.biome, type: 'wild', id: `wild${s.wild.n}`,
        nameKey: 'journey.wild.name', name: game.t('journey.wild.name'), depot: false, trader: false, named: false, wild: true,
        danger: 2, eventMul: 1, boss: null,
      };
    }
    return { index: s.step || 1, step: s.step || 1, act: 1, biome: game.map?.biome || 'forest', type: 'halt', id: 'start', nameKey: 'station.start', name: game.t('station.start'), depot: false, named: false, danger: 1, eventMul: 1 };
  }
  return {
    index: opt.step,
    step: opt.step,
    act: opt.act,
    biome: opt.biome,
    type: opt.type,
    id: opt.id,
    uid: opt.uid,
    named: opt.named,
    nameKey: stationNameKey(opt),
    name: stationName(J, opt),
    typeName: game.t(`journey.type.${opt.type}`),
    depot: !!opt.depot,
    trader: !!opt.trader,
    boss: opt.boss || null,
    inquisition: !!opt.inquisition,
    cult: !!opt.cult,
    blackMarket: !!opt.blackMarket,
    danger: opt.danger,
    legLen: opt.legLen,
    eventMul: s.eventMul[opt.id] ?? opt.eventMul ?? 1,
    wild: false,
  };
}

export function stationNameKey(opt) {
  if (!opt) return 'station.start';
  return opt.named ? `journey.st.${opt.step}` : `journey.pname.${opt.biome}`;
}

export function stationName(J, opt) {
  if (!opt) return J.game.t('station.start');
  if (opt.named) return J.game.t(`journey.st.${opt.step}`);
  return J.game.t(`journey.pname.${opt.biome}`, { variant: opt.nameIdx });
}

/** Параметры сложности (journey дописывает их в game.defs.difficulties). */
export function diff(J) {
  const d = J.game.defs.difficulties.get(J.game.colony.difficulty) || J.game.defs.difficulties.get('normal');
  return {
    threat: d?.threat ?? 1,
    incidentRate: d?.incidentRate ?? 1,
    goodBias: d?.goodBias ?? 1,
    rotMul: d?.rotMul ?? 1,
    rotBeasts: d?.rotBeasts ?? true,
  };
}

/** Акт, в котором сейчас находится история (по шагу станции/цели перегона). */
export function currentAct(J) {
  const s = J.state;
  if (s.phase === 'travel' || s.phase === 'departing') {
    const to = findOption(s.route, s.leg?.toId);
    if (to) return to.act;
  }
  return actOfStep(Math.max(1, s.step || 1));
}

export function currentBiome(J) {
  const s = J.state;
  if (s.wild) return s.wild.biome;
  if (s.phase === 'travel' || s.phase === 'departing') {
    const to = findOption(s.route, s.leg?.toId);
    const from = findOption(s.route, s.leg?.fromId);
    if (to && from && to.biome !== from.biome) return (s.leg.traveled / Math.max(1, s.leg.length)) < 0.5 ? from.biome : to.biome;
    if (to) return to.biome;
  }
  const o = currentOption(J);
  return o?.biome || biomeOfStep(Math.max(1, s.step || 1));
}

/** Эффективная скорость Гнили, вёрст/ч: Vr(акт) × (1 − Память/250) × сложность. */
export function rotSpeed(J, act = currentAct(J)) {
  const mem = Number(J.game.api.health.getMemory()) || 0;
  return rotSpeedOfAct(act) * (1 - Math.max(0, Math.min(100, mem)) / 250) * diff(J).rotMul;
}

export const hours = (h) => Math.round(h * TICKS_PER_HOUR);

/** Живой лидер или null. */
export const leaderOf = (J) => J.game.getLeader();

/** Модуль train активен (предоставил getTrainState). */
export const trainActive = (J) => J.game.providers.journey?.getTrainState === 'train';

/** Лидер в кабине: API модуля train, иначе — внутри прямоугольника локомотива. */
export function inCab(J, pawn = leaderOf(J)) {
  if (!pawn) return false;
  const game = J.game;
  if (game.providers.journey?.isInCab === 'train') {
    try {
      return !!game.api.journey.isInCab(pawn);
    } catch (err) {
      game.error(err, 'journey.inCab');
      return false;
    }
  }
  const r = game.train?.locomotive?.rect;
  return !!r && pawn.x >= r.x && pawn.y >= r.y && pawn.x < r.x + r.w && pawn.y < r.y + r.h;
}

/** Безопасный вызов чужого API: исключение → game.error, результат по умолчанию. */
export function safeCall(J, where, fn, def = null) {
  try {
    const v = fn();
    return v === undefined ? def : v;
  } catch (err) {
    J.game.error(err, `journey:${where}`);
    return def;
  }
}

/** Функция модуля в чужом пространстве API, если она есть (не заглушка ядра и не отсутствует). */
export function apiFn(J, ns, fn) {
  const f = J.game.api[ns]?.[fn];
  return typeof f === 'function' ? f : null;
}

/** Предоставлена ли функция модулем-владельцем (не заглушкой ядра). */
export const provided = (J, ns, fn) => !!J.game.providers[ns]?.[fn];
