// Глобальные константы игры. Меняйте осторожно: от них зависят сохранения и баланс.

/** Размер клетки в «мировых пикселях». Мировые слои рисуют в этих единицах (1 клетка = 32). */
export const TILE = 32;
/** Тиков симуляции в секунду (фиксированный шаг). */
export const TPS = 60;
/** Длительность одного тика, сек. */
export const DT = 1 / TPS;
/** 1 игровой час = 600 тиков = 10 реальных секунд на скорости 1x. */
export const TICKS_PER_HOUR = 600;
export const HOURS_PER_DAY = 24;
/** 1 игровой день = 14400 тиков = 4 реальные минуты на 1x. */
export const TICKS_PER_DAY = TICKS_PER_HOUR * HOURS_PER_DAY;
/** Размер чанка (в клетках) для кэша отрисовки и пространственной сетки сущностей. */
export const CHUNK = 16;
/** Максимум шагов симуляции за один кадр (защита от «спирали смерти»). */
export const MAX_STEPS_PER_FRAME = 4;
/** Доступные скорости времени (индекс = game.speed). 0 = пауза. */
export const SPEEDS = [0, 1, 2, 3];

export const FACTION = Object.freeze({
  COLONY: 'colony',
  ENEMY: 'enemy',
  NEUTRAL: 'neutral',
});

/** Битовые флаги клетки (map.flags). */
export const TILE_FLAG = Object.freeze({
  RAIL: 1,
  RAIL_RUNE: 2,
});

export const GAME_VERSION = '0.1.0';
export const SAVE_FORMAT = 'lasttrain-save';
export const SAVE_VERSION = 1;
