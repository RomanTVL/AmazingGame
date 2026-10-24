// av — общие помощники: безопасные межмодульные вызовы, состояние поезда за кадр, мана, хеши.
// Только косметика: ничего здесь не трогает симуляцию.
import { hash01 } from '../../core/math.js';

export const TAU = Math.PI * 2;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** Детерминированный «случай» по id и номеру (0..1). */
export const hid = (id, k = 0) => hash01((id | 0) * 7 + k * 131, k * 17 + 3, 911);

const warned = new Set();

/**
 * Безопасный вызов game.api.<ns>.<fn>(...args): цель может быть заглушкой ядра или отсутствовать
 * (модуль ещё не написан). Исключение чужого кода не ломает косметику av — один раз пишем в консоль.
 */
export function callApi(game, ns, fn, ...args) {
  const f = game.api?.[ns]?.[fn];
  if (typeof f !== 'function') return undefined;
  try {
    return f(...args);
  } catch (err) {
    const k = `${ns}.${fn}`;
    if (!warned.has(k)) {
      warned.add(k);
      console.warn(`[av] game.api.${k} бросил исключение (пропущено):`, err?.message || err);
    }
    return undefined;
  }
}

/** Есть ли «настоящая» реализация (не заглушка ядра). */
export function hasProvider(game, ns, fn) {
  return typeof game.api?.[ns]?.[fn] === 'function' && !!game.providers?.[ns]?.[fn];
}

/** Пешка/сущность по объекту или id. */
export function entityOf(game, x) {
  if (!x) return null;
  if (typeof x === 'object') return x;
  return game.entities.get(x) || null;
}

/** Доля маны 0..1 (combat.getMana → {cur,max} | число | null; иначе pawn.mana). */
export function manaRatio(game, p) {
  if (!p) return 1;
  const m = callApi(game, 'combat', 'getMana', p) ?? p.mana;
  if (typeof m === 'number' && Number.isFinite(m)) return clamp01(m > 1 ? m / 100 : m);
  if (m && typeof m === 'object') {
    const cur = num(m.cur ?? m.value ?? m.current, NaN);
    const max = num(m.max ?? m.cap, NaN);
    if (Number.isFinite(cur) && Number.isFinite(max) && max > 0) return clamp01(cur / max);
  }
  return 1;
}

/** Настроение 0..1. */
export function moodOf(game, p) {
  const v = callApi(game, 'mind', 'getMood', p);
  return Number.isFinite(v) ? clamp01(v > 1 ? v / 100 : v) : clamp01(num(p?.mood?.value, 0.6));
}

/** Черта (через mind.hasTrait; запасной путь — массив traits строк или объектов). */
export function hasTrait(game, p, id) {
  const r = callApi(game, 'mind', 'hasTrait', p, id);
  if (r !== undefined) return !!r;
  const t = p?.traits;
  if (!Array.isArray(t)) return false;
  return t.some((x) => x === id || x?.id === id);
}

const STATE_FALLBACK = Object.freeze({ engine: 'steam', moving: false, speed: 0, regulator: 0, heat: 0, pressure: 0, boilerState: 'ok', fuel: 0, battery: 0, noise: 0, rotGapHours: null });

/** Состояние поезда (journey.getTrainState) — один вызов за кадр (кэш по номеру кадра). */
export function trainState(game, S) {
  if (S._tsFrame === S.frameNo && S._ts) return S._ts;
  S._tsFrame = S.frameNo;
  const st = callApi(game, 'journey', 'getTrainState');
  S._ts = st && typeof st === 'object' ? st : STATE_FALLBACK;
  return S._ts;
}

/** Едет ли поезд (по состоянию поезда или фазе пути journey). */
export function isMoving(game, S) {
  const st = trainState(game, S);
  if (st.moving && num(st.speed) > 0.01) return true;
  return !!callApi(game, 'journey', 'isTravelling') && num(st.speed, 0.6) > 0.01;
}

/** Биом текущей карты. */
export function biomeId(game) {
  return callApi(game, 'journey', 'getBiome') || game.map?.biome || 'forest';
}

/** Класс биома для палитр: forest | ash | ice (по id или подстроке). */
export function biomeClass(id) {
  const s = String(id || '').toLowerCase();
  if (/ice|snow|frost|peak|winter|ледян|пик/.test(s)) return 'ice';
  if (/ash|waste|lava|desert|пепел|пуст/.test(s)) return 'ash';
  return 'forest';
}

/** Вагон под клеткой (или null). */
export function carAt(game, x, y) {
  const tr = game.train;
  if (!tr?.stamped) return null;
  for (const c of tr.cars) {
    const r = c.rect;
    if (r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return c;
  }
  return null;
}

/** Небольшой пул объектов с переиспользованием (без аллокаций в кадре). */
export class Pool {
  constructor(make, max = 256) {
    this.make = make;
    this.items = [];
    this.n = 0;
    this.max = max;
  }
  get size() {
    return this.n;
  }
  add() {
    if (this.n >= this.max) return null;
    let o = this.items[this.n];
    if (!o) o = this.items[this.n] = this.make();
    this.n++;
    return o;
  }
  /** Удалить i-й (перестановкой с последним). */
  kill(i) {
    const j = --this.n;
    if (i !== j) {
      const t = this.items[i];
      this.items[i] = this.items[j];
      this.items[j] = t;
    }
  }
  clear() {
    this.n = 0;
  }
}
