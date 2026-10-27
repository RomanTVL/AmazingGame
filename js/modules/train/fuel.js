// Топливо (MVP): уголь (и дрова как запасное) в тендере и локомотиве; в пути расходуется по часам хода.
// Кончилось — 'train:outOfFuel' {} → journey ставит поезд на «дикую стоянку».
import { TICKS_PER_HOUR } from '../../core/constants.js';
import { ops } from './state.js';

/** Сколько «единиц топлива» даёт штука: уголь — 1, дрова — 1/3. */
export const FUEL_VALUE = { coal: 1, wood: 1 / 3 };
/** Расход в единицах за игровой час хода (перегон 3–6 ч → 24–48 угля). */
export const BURN_PER_HOUR = 8;
/** Средний перегон, ч (для подсказки «хватит на N перегонов»). */
export const AVG_LEG_HOURS = 4.5;
export const FUEL_MAX = 150;

/** Паровоз ли (рунный двигатель MVP топлива не тратит). */
export function usesFuel(game) {
  return (game.getScenario?.()?.engine ?? 'steam') !== 'rune';
}

function isFuelCar(car) {
  return car.type === 'tender' || car.type === 'locomotive';
}

/** Стопки топлива в тендере и локомотиве. */
export function fuelStacks(game) {
  const tr = game.train;
  const out = [];
  if (!tr?.stamped) return out;
  for (const it of game.entities.listKind('item')) {
    if (!(it.defId in FUEL_VALUE) || it.removed) continue;
    const car = tr.carAt(Math.floor(it.x), Math.floor(it.y));
    if (car && isFuelCar(car)) out.push(it);
  }
  return out;
}

/** Запас топлива в единицах (уголь-эквивалент). */
export function fuelUnits(game) {
  let n = 0;
  for (const it of fuelStacks(game)) n += it.count * FUEL_VALUE[it.defId];
  return Math.floor(n + 1e-6);
}

/** Сжечь одну единицу: сперва уголь, затем 3 полена. @returns {boolean} */
function burnUnit(game) {
  const stacks = fuelStacks(game);
  const coal = stacks.find((s) => s.defId === 'coal');
  if (coal) return game.items.take(coal, 1) === 1;
  const wood = stacks.filter((s) => s.defId === 'wood');
  let total = 0;
  for (const w of wood) total += w.count;
  if (total < 3) return false;
  let left = 3;
  for (const w of wood) {
    if (left <= 0) break;
    left -= game.items.take(w, left);
  }
  return true;
}

/** Тик хода: копит расход, сжигает единицы. @returns {boolean} топливо есть */
export function burnTick(game) {
  if (!usesFuel(game)) return true;
  const O = ops(game);
  O.fuelAcc = (O.fuelAcc || 0) + BURN_PER_HOUR / TICKS_PER_HOUR;
  while (O.fuelAcc >= 1) {
    if (!burnUnit(game)) return false;
    O.fuelAcc -= 1;
    O.fuelBurnt = (O.fuelBurnt || 0) + 1;
  }
  return true;
}

/** Хватит ли примерно на столько перегонов. */
export function legsLeft(units) {
  return Math.floor((units / (BURN_PER_HOUR * AVG_LEG_HOURS)) * 10) / 10;
}
