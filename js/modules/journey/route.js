// journey — маршрут: 12 шагов в 3 актах, на каждом шаге 2–3 варианта (именная станция магистрали + процедурные),
// длины перегонов, депо на шагах 3/6/9, боссы на 4/8/12. Всё детерминированно от сида (game.rng.fork).

export const STEPS = 12;
export const ACTS = [
  { act: 1, from: 1, to: 4, biome: 'forest', vr: 3 },
  { act: 2, from: 5, to: 8, biome: 'ash', vr: 3.75 },
  { act: 3, from: 9, to: 12, biome: 'ice', vr: 4.5 },
];
export const actOfStep = (step) => (step <= 4 ? 1 : step <= 8 ? 2 : 3);
export const biomeOfStep = (step) => ACTS[actOfStep(step) - 1].biome;
/** Скорость фронта Гнили в акте (вёрст в игровой час, без поправки на Память). */
export const rotSpeedOfAct = (act) => ACTS[Math.max(0, Math.min(2, act - 1))].vr;
/** Вёрст в час при скорости 1.0 (позиция регулятора 4) — договорённость с модулем train. */
export const VERSTS_PER_SPEED = 10;

/**
 * Именные станции магистрали. type — тип станции (генерация карты, торговля, угроза), boss — id босса для
 * game.api.combat.spawnBoss, depot — депо (покупки поезда у модуля train).
 */
export const NAMED = {
  1: { type: 'halt', danger: 1 },
  2: { type: 'bridge', danger: 1, trader: true },
  3: { type: 'sawmill', danger: 2, depot: true, trader: true },
  4: { type: 'graveyard', danger: 4, boss: 'bone_dragon' },
  5: { type: 'ford', danger: 2, trader: true, inquisition: true },
  6: { type: 'junction', danger: 3, depot: true, trader: true, blackMarket: true },
  7: { type: 'otrada', danger: 2, trader: true },
  8: { type: 'theatre', danger: 5, boss: 'lich' },
  9: { type: 'pass', danger: 3 },
  10: { type: 'monastery', danger: 2, trader: true },
  11: { type: 'winterhold', danger: 1, trader: true },
  12: { type: 'heart', danger: 5, boss: 'rot_heart' },
};

/** Процедурные типы: деревня (торговцы), руины (добыча), дикий лес, шахта, форпост Инквизиции, святилище культа, депо. */
export const PROC_TYPES = {
  village: { danger: 1, trader: true },
  ruins: { danger: 2, loot: true },
  wild: { danger: 2 },
  mine: { danger: 2, trader: false, mine: true },
  inquisition: { danger: 2, inquisition: true, trader: true },
  shrine: { danger: 3, cult: true },
  depot: { danger: 1, depot: true, trader: true },
};

const PROC_WEIGHTS = {
  1: { village: 3, ruins: 3, wild: 3, mine: 2, shrine: 1, inquisition: 1 },
  2: { ruins: 3, mine: 3, inquisition: 2, shrine: 2, village: 2, wild: 1 },
  3: { wild: 2, ruins: 2, village: 2, mine: 2, shrine: 2, inquisition: 1 },
};

/** Сколько вариантов названий для процедурных станций в каждом биоме (строки — journey.pname.<biome>). */
export const PROC_NAME_COUNT = 14;

/** Тип станции → иконка/цвет для карты маршрута. */
export const TYPE_STYLE = {
  halt: { color: '#ffd9a0', glyph: 'halt' },
  bridge: { color: '#8fc8ff', glyph: 'bridge' },
  sawmill: { color: '#c98a4b', glyph: 'saw' },
  graveyard: { color: '#4fb8a8', glyph: 'skull' },
  ford: { color: '#ff4f5e', glyph: 'eye' },
  junction: { color: '#ffb347', glyph: 'gear' },
  otrada: { color: '#ffcf8a', glyph: 'house' },
  theatre: { color: '#ff4fd8', glyph: 'mask' },
  pass: { color: '#bfe6ff', glyph: 'peak' },
  monastery: { color: '#9fd8ff', glyph: 'bell' },
  winterhold: { color: '#ffd27a', glyph: 'house' },
  heart: { color: '#ff6ad5', glyph: 'heart' },
  village: { color: '#ffcf8a', glyph: 'house' },
  ruins: { color: '#7d8bb8', glyph: 'ruin' },
  wild: { color: '#3dffc5', glyph: 'tree' },
  mine: { color: '#e0915f', glyph: 'pick' },
  inquisition: { color: '#ff4f5e', glyph: 'eye' },
  shrine: { color: '#b77dff', glyph: 'eye2' },
  depot: { color: '#5ef2ff', glyph: 'gear' },
};

/**
 * Сгенерировать маршрут: steps[i] — массив вариантов шага i+1. Вариант:
 * {id, step, act, biome, type, named, nameIdx?, danger, depot, trader, boss, legLen, rotErr, uid, eventMul}
 */
export function generateRoute(rng) {
  const steps = [];
  for (let step = 1; step <= STEPS; step++) {
    const act = actOfStep(step);
    const biome = biomeOfStep(step);
    const opts = [];
    const named = NAMED[step];
    opts.push(makeOption(rng, step, act, biome, named.type, true, named));
    const single = step === 1 || step === 4 || step === 8 || step === 12;
    if (!single) {
      const n = rng.chance(step === 11 ? 0 : 0.5) ? 2 : 1;
      const used = new Set([named.type]);
      for (let k = 0; k < n; k++) {
        let type;
        if (k === 0 && step === 9) type = 'depot'; // шаг 9: депо гарантировано (именной Перевал — не депо)
        else {
          const w = PROC_WEIGHTS[act];
          type = rng.weighted(Object.keys(w).filter((t) => !used.has(t)), (t) => w[t]) || 'wild';
        }
        used.add(type);
        opts.push(makeOption(rng, step, act, biome, type, false, PROC_TYPES[type]));
      }
      // шаги 3/6/9 — хотя бы одно депо
      if ((step === 3 || step === 6 || step === 9) && !opts.some((o) => o.depot)) opts[opts.length - 1].depot = true;
    }
    opts.forEach((o, i) => {
      o.id = `s${step}${String.fromCharCode(97 + i)}`;
      o.uid = step * 10 + i;
      o.optIndex = i;
    });
    // именная станция — не всегда первая в списке (чтобы выбор не был очевиден по позиции)
    if (opts.length > 1 && rng.chance(0.5)) opts.push(opts.shift());
    steps.push(opts);
  }
  return { steps };
}

function makeOption(rng, step, act, biome, type, named, base) {
  const legLen = step === 1 ? 0 : Math.round(rng.int(120, 180) / 5) * 5;
  const danger = Math.max(1, Math.min(5, (base.danger ?? 2) + (act - 1) * 0.5 + (named ? 0 : rng.int(-1, 1)) | 0));
  return {
    step, act, biome, type, named,
    nameIdx: named ? -1 : rng.int(0, PROC_NAME_COUNT - 1),
    danger,
    depot: !!base.depot,
    trader: !!base.trader,
    boss: base.boss || null,
    inquisition: !!base.inquisition,
    cult: !!base.cult,
    blackMarket: !!base.blackMarket,
    legLen,
    rotErr: Math.round(rng.range(-0.3, 0.3) * 100) / 100,
    eventMul: 1,
  };
}

/** Вариант по id в маршруте. */
export function findOption(route, id) {
  if (!route || !id) return null;
  for (const opts of route.steps) for (const o of opts) if (o.id === id) return o;
  return null;
}

/** Варианты шага (1..12). */
export function optionsOf(route, step) {
  return route?.steps?.[step - 1] || [];
}

/** Размер карты станции по типу. */
export function mapSizeFor(st) {
  switch (st?.type) {
    case 'graveyard':
    case 'heart':
    case 'theatre':
      return { w: 150, h: 96 };
    case 'mine':
      return { w: 150, h: 94 };
    case 'wild':
      return { w: 140, h: 90 };
    default:
      return { w: 140, h: 90 };
  }
}
