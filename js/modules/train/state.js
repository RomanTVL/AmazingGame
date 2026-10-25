// Состояние модуля train. Всё сохраняемое — простые JSON-поля:
//   game.train.loco  — локомотив {engine, regulator, heat, pressure, boilerHp, battery, smokeUntil, crackT, ...}
//   game.train.ops   — эксплуатация {boarding, leftBehind, arrivals, ...}
//   game.colony.scen — сюжетное состояние сценария старта; game.colony.trainDialogs — ждущие решения игрока.
// Runtime-кэши (не сохраняются) — в rt(game) (WeakMap по объекту игры: в одном процессе бывает несколько игр).
import { FACTION } from '../../core/constants.js';
import { clamp } from '../../core/math.js';
import { FUEL_IDS, MAX_REG } from './constants.js';

const RT = new WeakMap();

/** Runtime-кэши модуля для данной игры. */
export function rt(game) {
  let r = RT.get(game);
  if (!r) RT.set(game, (r = freshRuntime()));
  return r;
}

export function freshRuntime() {
  return {
    fuelCache: null,
    fuelTick: -1e9,
    fireboxId: 0,
    coreId: 0,
    stateTick: -1,
    stateSnap: null,
    hold: null, // удержание E лидером у топки: {kind: 'stoke'|'channel', ms}
    horn: { down: false, ms: 0, longFired: false, pendingMs: -1, ignoreRelease: false },
    flare: null, // вспышка в топке {real, quality}
    strokeAcc: 0,
    hintCooldown: 0,
    startedTick: -1e9,
    exterior: null,
    transmitterTick: -1e9,
    transmitter: false,
    lastValveSfx: 0,
    panelTab: 'loco',
    depotPos: 'tail',
    dialogShownId: 0,
  };
}

export function resetRuntime(game) {
  RT.set(game, freshRuntime());
}

export function defaultLoco(engine = 'steam') {
  return {
    engine: engine === 'rune' ? 'rune' : 'steam',
    regulator: 0,
    heat: engine === 'rune' ? 0 : 40,
    pressure: engine === 'rune' ? 0 : 30,
    boilerHp: 100,
    boilerState: 'ok',
    battery: 100,
    smokeUntil: 0,
    crackT: 0,
    speed: 0,
    distance: 0,
    lastFuel: null,
    upgrades: [],
    fuelPolicy: { coal: true, wood: true, mana_crystal: true },
    raiseSteam: false,
    autoCharge: true,
    charging: false,
    fuelBurnt: { coal: 0, wood: 0, mana_crystal: 0 },
  };
}

export function defaultOps() {
  return {
    boarding: null, // {startTick, untilTick, announced}
    leftBehind: [], // [{id, name, snapshot, station, tick, day}]
    arrivals: 0,
    departures: 0,
    wasTravelling: false,
    lastStartTick: -1,
    stokeAuth: { day: 0, n: 0 },
    roofFire: null, // {carId, startTick, hp, hours}
    rotGap: null, // {hours, exact?, tick} — значение, переданное journey через api.train.setRotGap
    exteriorFx: true,
    forceDepot: false,
  };
}

/** Привести к актуальной форме (старые сейвы, частично заполненные поля). Идемпотентно. */
export function normalizeLoco(L) {
  const d = defaultLoco(L.engine);
  for (const k of Object.keys(d)) if (L[k] === undefined || L[k] === null) L[k] = d[k];
  L.engine = L.engine === 'rune' ? 'rune' : 'steam';
  L.regulator = clamp(Math.round(Number(L.regulator) || 0), 0, MAX_REG);
  for (const k of ['heat', 'pressure', 'boilerHp', 'battery', 'speed', 'distance', 'crackT', 'smokeUntil']) if (!Number.isFinite(L[k])) L[k] = d[k];
  if (!['ok', 'valve', 'cracked'].includes(L.boilerState)) L.boilerState = 'ok';
  if (!Array.isArray(L.upgrades)) L.upgrades = [];
  L.fuelPolicy = { ...d.fuelPolicy, ...(L.fuelPolicy || {}) };
  L.fuelBurnt = { ...d.fuelBurnt, ...(L.fuelBurnt || {}) };
  if (L.lastFuel !== null && !FUEL_IDS.includes(L.lastFuel)) L.lastFuel = null;
  return L;
}

export function normalizeOps(O) {
  const d = defaultOps();
  for (const k of Object.keys(d)) if (O[k] === undefined) O[k] = d[k];
  if (!Array.isArray(O.leftBehind)) O.leftBehind = [];
  if (!O.stokeAuth || typeof O.stokeAuth !== 'object') O.stokeAuth = { day: 0, n: 0 };
  return O;
}

/** Двигатель по сценарию текущей колонии (по умолчанию — паровой). */
export function scenarioEngine(game) {
  const e = game.getScenario?.()?.engine;
  return e === 'rune' ? 'rune' : 'steam';
}

/** Состояние локомотива (создаётся при первом обращении). null — поезда нет. */
export function loco(game) {
  const tr = game.train;
  if (!tr) return null;
  if (!tr.loco || typeof tr.loco !== 'object') tr.loco = defaultLoco(scenarioEngine(game));
  return tr.loco;
}

export function ops(game) {
  const tr = game.train;
  if (!tr) return null;
  if (!tr.ops || typeof tr.ops !== 'object') tr.ops = defaultOps();
  return tr.ops;
}

/** Сюжетное состояние сценария (game.colony.scen) или null. */
export function scen(game) {
  return game.colony?.scen || null;
}

export function hasUpgrade(game, id) {
  return !!game.train?.loco?.upgrades?.includes(id);
}

// ---------------- Помощники ----------------

export function isTravelling(game) {
  try {
    return !!game.api.journey.isTravelling();
  } catch (err) {
    game.error(err, 'train:isTravelling');
    return false;
  }
}

/** Номер станции по порядку пути: 1 — стартовая, далее +1 за каждое прибытие. */
export function stationNo(game) {
  return (game.train?.ops?.arrivals ?? 0) + 1;
}

/** Сведения о текущей станции (от journey, если есть) + наш номер по порядку. */
export function stationInfo(game) {
  const j = game.api.journey;
  let cur = null;
  try {
    cur = typeof j.getCurrentStation === 'function' ? j.getCurrentStation() : null;
  } catch (err) {
    game.error(err, 'train:getCurrentStation');
  }
  let base = null;
  try {
    base = j.getStation();
  } catch (err) {
    game.error(err, 'train:getStation');
  }
  const s = cur || base || {};
  return {
    index: s.index ?? 0,
    id: s.id ?? 'start',
    name: s.name ?? null,
    nameKey: s.nameKey ?? null,
    type: s.type ?? null,
    depot: !!s.depot,
    number: stationNo(game),
  };
}

export function stationName(game, st) {
  if (!st) return '';
  if (st.name) return st.name;
  if (st.nameKey && game.i18n.has(st.nameKey)) return game.t(st.nameKey);
  return game.t('train.station.numbered', { n: st.number ?? stationNo(game) });
}

/** Внутри ли клетка прямоугольника вагона. */
export function inRect(r, tx, ty) {
  return !!r && tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
}

/** На борту ли пешка: в любом вагоне или на переходе между вагонами. */
export function isAboard(game, p) {
  const tr = game.train;
  const map = game.map;
  if (!tr?.stamped || !map || !p) return false;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  if (tr.carAt(tx, ty)) return true;
  if (!map.inBounds(tx, ty)) return false;
  const i = map.idx(tx, ty);
  return map.roof[i] === 1 && map.floor[i] === game.defs.floors.get('wagon_planks')?.index && ty === tr.railY;
}

export function isInLoco(game, p) {
  const car = game.train?.locomotive;
  return !!car?.rect && !!p && !p.dead && inRect(car.rect, Math.floor(p.x), Math.floor(p.y));
}

/** Расстояние (в клетках) от точки до ближайшего вагона. */
export function distToTrain(game, x, y) {
  let best = Infinity;
  for (const car of game.train?.cars || []) {
    const r = car.rect;
    if (!r) continue;
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

export function colonists(game) {
  return game.colonists();
}

export function isColonyPawn(p) {
  return !!p && p.kind === 'pawn' && !p.dead && !p.removed && p.faction === FACTION.COLONY;
}

/** Близкие пешки p (друзья, пары, родня): мнение ≥ 15 или «тёплый» вид отношений. */
export function friendsOf(game, p) {
  const warm = new Set(['friend', 'lover', 'spouse', 'family', 'partner', 'sibling', 'parent', 'child']);
  const out = [];
  for (const q of game.colonists()) {
    if (q === p) continue;
    const r = q.relations?.[p.id];
    const back = p.relations?.[q.id];
    if ((r && ((r.opinion ?? 0) >= 15 || warm.has(r.kind))) || (back && warm.has(back.kind))) out.push(q);
  }
  return out;
}

export function notify(game, text, type = 'info', extra = {}) {
  game.api.ui.notify(text, { type, ...extra });
}

/** JSON-снимок сущности без служебных полей. */
export function snapshotOf(e, extraSkip = []) {
  const skip = new Set(['job', 'path', 'pathI', 'pathGoal', 'moveInput', 'workProgress', ...extraSkip]);
  return JSON.parse(JSON.stringify(e, (k, v) => (k && (k[0] === '_' || skip.has(k)) ? undefined : v)));
}

// ---------------- Серебро (кроны) ----------------
export function silverCount(game) {
  if (game.defs.items.has('silver')) return game.items.count('silver');
  return game.colony.silver || 0;
}

export function spendSilver(game, n) {
  if (n <= 0) return true;
  if (silverCount(game) < n) return false;
  if (game.defs.items.has('silver')) {
    const c = game.train?.center();
    return !!game.api.economy.consume({ silver: n }, c?.x ?? 0, c?.y ?? 0);
  }
  game.colony.silver = (game.colony.silver || 0) - n;
  return true;
}

export function giveSilver(game, n) {
  if (n <= 0) return;
  if (game.defs.items.has('silver')) {
    const car = game.train?.carOfType('storage') || game.train?.cars?.[0];
    const cells = car ? game.train.interior(car) : [];
    const c = cells[Math.floor(cells.length / 2)] || game.train?.center();
    if (c) game.items.spawn('silver', n, Math.floor(c.x), Math.floor(c.y));
  } else game.colony.silver = (game.colony.silver || 0) + n;
}
