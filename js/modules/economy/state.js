// Состояние модуля economy (на каждую игру своё — в одном процессе Node живёт много игр).
//  data — сохраняется сериализатором 'economy' (JSON);
//  rt   — runtime-кэши (индексы, летящие склянки, огонь, состояние UI-инструментов) — сбрасываются на world:reset;
//  ui   — состояние панелей (вкладки, прокрутка) — переживает новую игру.
// Данные на сущностях (заказы станций, содержимое тайников, рост культур, pawn.econ) сохраняются ядром автоматически.
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../core/constants.js';

export const OWNER = 'economy';
export const HOUR = TICKS_PER_HOUR;
export const DAY = TICKS_PER_DAY;

const STATES = new WeakMap();

export function freshData() {
  return {
    v: 1,
    goodwill: {},
    traders: [],
    nextTraderId: 1,
    /** насыщение рынка за текущую стоянку: {key, sat: {defId: 0..0.6}} */
    visit: { key: '', sat: {} },
    /** «сладкая цена»: лучшая цена продажи, что видели, defId → {price, station, stationIndex, day} */
    sweet: {},
    inspection: null,
    /** штампы «ДОСМОТРЕНО»: [{carId, until}] */
    stamps: [],
    /** станции, ставшие враждебными (нападение на инквизитора): key → true */
    hostile: {},
    stats: { inspections: 0, bribes: 0, fined: 0, confiscated: 0, trades: 0, crafted: 0, attacks: 0 },
    lastCaravanDay: 0,
  };
}

export function freshRuntime() {
  return {
    idx: null,
    flasks: [],
    fires: [],
    lastTaken: null,
    spawnedItems: [],
    zoneTool: null,
    itemIndexTick: -1,
    itemIndex: null,
    silverDirty: true,
    sweetNotified: '',
  };
}

export function S(game) {
  let s = STATES.get(game);
  if (!s) {
    s = { data: freshData(), rt: freshRuntime(), ui: { tab: 'bills', stationId: 0, scroll: {}, trade: { filter: 'all', qty: {}, negotiatorId: 0, rows: new Map() }, addOpen: false, openBill: 0 } };
    STATES.set(game, s);
  }
  return s;
}

// ---------------- общие помощники ----------------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Безопасный вызов API другого модуля (цель может быть заглушкой или бросить). */
export function call(game, ns, fn, ...args) {
  try {
    const f = game.api?.[ns]?.[fn];
    return typeof f === 'function' ? f(...args) : undefined;
  } catch (err) {
    game.error(err, `economy→${ns}.${fn}`);
    return undefined;
  }
}

export function skill(game, pawn, id) {
  const v = call(game, 'mind', 'skillLevel', pawn, id);
  return isNum(v) ? v : pawn?.skills?.[id]?.level ?? 3;
}

export function notify(game, text, opts = {}) {
  call(game, 'ui', 'notify', text, opts);
}

/** Сообщение о событии в точке (vision может исказить/задержать, если вне обзора). */
export function report(game, text, opts = {}) {
  if (game.api?.vision?.report) call(game, 'vision', 'report', text, opts);
  else notify(game, text, opts);
}

export function thought(game, pawn, id, opts) {
  if (pawn && !pawn.dead) call(game, 'mind', 'addThought', pawn, id, opts || {});
}

export function say(game, pawn, text) {
  if (pawn && !pawn.dead && text) call(game, 'mind', 'say', pawn, text);
}

export function floatText(game, x, y, text, color) {
  if (!game.isHeadless) call(game, 'av', 'floatText', x, y, text, color);
}

export function sfx(game, id, opts) {
  if (!game.isHeadless && game.defs.sfx?.has(id)) call(game, 'av', 'play', id, opts);
}

export function fx(game, x, y, opts) {
  if (!game.isHeadless) game.fx?.emit?.(x, y, opts);
}

export const itemDef = (game, id) => game.defs.items.get(id);
export const name = (game, defId) => game.t(itemDef(game, defId)?.nameKey || defId);

/** Есть ли у предмета «история» (мастер/качество/память) — такие не сливаются и не идут в ингредиенты. */
export function hasHistory(it) {
  return !!(it && (it.maker || it.keepsakeOf || it.quality !== undefined));
}

/** Женский род имени (для «Сшила Марта»): по полю gender. */
export function fem(pawnOrGender) {
  const g = typeof pawnOrGender === 'string' ? pawnOrGender : pawnOrGender?.gender;
  return g === 'female';
}

/** Детерминированный хеш → [0,1). */
export function hash01s(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Клетки интерьера вагона без проходов: не ряд railY и не столбец средней двери. */
export function carFurnitureCells(game, car) {
  const r = car?.rect;
  if (!r) return [];
  const out = [];
  const midX = r.x + Math.floor(r.w / 2);
  const railY = game.train.railY;
  for (let y = r.y + 1; y < r.y + r.h - 1; y++)
    for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
      if (y === railY) continue;
      if (x === midX && (y === r.y + 1 || y === r.y + r.h - 2)) continue;
      out.push({ x, y });
    }
  return out;
}

/** Свободна ли клетка под мебель (нет построек, растений, предметов, пешек). */
export function cellFree(game, x, y) {
  const map = game.map;
  if (!map || !map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  if (map.building[i] || map.plant[i]) return false;
  if (game.items.itemAt(x, y)) return false;
  if (game.entities.queryRect(x, y, x, y, 'pawn').length) return false;
  return true;
}

/** Текущая станция (journey) + ключ визита. */
export function stationInfo(game) {
  const st = call(game, 'journey', 'getStation') || { index: 0, id: 'start' };
  const biome = st.biome || call(game, 'journey', 'getBiome') || game.map?.biome || 'forest';
  return { ...st, biome, key: `${st.index ?? 0}:${st.id ?? '?'}` };
}

export function round1(v) {
  return Math.round(v * 10) / 10;
}

export function fmtPrice(v) {
  if (!isNum(v)) return '—';
  return v >= 10 ? String(Math.round(v)) : String(round1(v)).replace('.', ',');
}

export const TICK_HOUR = HOUR;
export const TICK_DAY = DAY;
