// journey — маршрут MVP: 4 станции после стартовой; на каждом шаге 2 варианта (тип: лес / пустошь / деревня / руины).
// Шаги 1–2 — Лес Шёпота, 3–4 — Пепельная пустошь; станция 4 — логово Костяного дракона.
// Всё детерминированно от сида (game.rng.fork('journey:route')). 12 станций, 3 акта — после MVP.
import { TICKS_PER_HOUR } from '../../core/constants.js';

export const STEPS = 4;
export const BOSS_STEP = 4;
export const TYPES = ['forest', 'ash', 'village', 'ruins'];
/** Биом шага (для деревни/руин). */
export const STEP_BIOME = { 1: 'forest', 2: 'forest', 3: 'ash', 4: 'ash' };
/** Опасность типа (влияет на рейды по прибытии). */
export const TYPE_DANGER = { forest: 1, ash: 2, village: 0.6, ruins: 1.6 };
export const TYPE_COLOR = { forest: '#3dffc5', ash: '#ff8a5c', village: '#ffcf8a', ruins: '#7d8bb8' };
/** Пулы вариантов по шагам. */
const POOLS = {
  1: ['forest', 'village', 'ruins'],
  2: ['forest', 'village', 'ruins'],
  3: ['ash', 'village', 'ruins'],
  4: ['ash', 'ruins'],
};
/** Длина перегона: 30–60 с реального времени на 1x (3–6 игровых часов). */
export const LEG_MIN = Math.round(TICKS_PER_HOUR * 3);
export const LEG_MAX = Math.round(TICKS_PER_HOUR * 6);
/** Вариантов названия на тип (journey.pname.<type> в strings.js). */
const NAMES_PER_TYPE = 8;

export function biomeOf(type, step) {
  if (type === 'forest') return 'forest';
  if (type === 'ash') return 'ash';
  return STEP_BIOME[step] || 'forest';
}

/** @returns {{steps: object[][], legs: number[]}} steps[i] — 2 варианта шага i+1; legs[i] — длина перегона в тиках. */
export function generateRoute(rng) {
  const steps = [];
  const legs = [];
  const used = new Set(); // имена не повторяются за маршрут (те же броски rng — сдвиг на свободное)
  const uniqueName = (type, idx) => {
    let k = idx;
    for (let n = 0; n < NAMES_PER_TYPE && used.has(`${type}:${k}`); n++) k = (k + 1) % NAMES_PER_TYPE;
    used.add(`${type}:${k}`);
    return k;
  };
  for (let step = 1; step <= STEPS; step++) {
    const pool = rng.shuffle(POOLS[step].slice());
    const opts = pool.slice(0, 2).map((type, i) => ({
      id: `s${step}${'ab'[i]}`,
      step,
      type,
      biome: biomeOf(type, step),
      boss: step === BOSS_STEP ? 'bone_dragon' : null,
      danger: TYPE_DANGER[type] + (step - 1) * 0.4,
      nameIdx: uniqueName(type, rng.int(0, NAMES_PER_TYPE - 1)),
    }));
    steps.push(opts);
    legs.push(rng.int(LEG_MIN, LEG_MAX));
  }
  return { steps, legs };
}

export function optionOf(route, step, idx) {
  return route?.steps?.[step - 1]?.[idx] || null;
}
