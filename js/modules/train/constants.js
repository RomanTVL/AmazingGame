// Константы модуля train: модель котла, регулятор, топливо, цены депо, раскладка фикстур локомотива.
// Скорости и расходы заданы «в секунду реального времени на 1x» и интегрируются по тикам с DT (1/60).

/** Ход по позициям регулятора 0..5 (1.0 = 10 вёрст в игровой час). */
export const REG_SPEED = [0, 0.4, 0.65, 0.85, 1.0, 1.15];
/** Падение жара топки, ед./с при 1x, по позиции регулятора. */
export const HEAT_DECAY = [0.3, 0.6, 0.9, 1.2, 1.8, 3.0];
/** Жар за единицу топлива. */
export const FUEL_HEAT = { coal: 8, wood: 5, mana_crystal: 14 };
/** Виды топлива в порядке предпочтения кочегара (дешёвое → дорогое). */
export const FUEL_IDS = ['coal', 'wood', 'mana_crystal'];
/** Вёрст в игровой час при speed = 1. */
export const VERSTS_PER_HOUR = 10;

export const MAX_REG = 5;
export const MAX_HEAT = 100;
export const MAX_PRESSURE = 150;
export const VALVE_PRESSURE = 90;
export const CRACK_PRESSURE = 100;
/** Секунд давления > 100 подряд до трещины котла. */
export const CRACK_SECONDS = 20;
export const CRACK_DAMAGE = 50;
export const BOOST_PRESSURE = 70;
/** Разгон/накат хода (ед. speed в секунду): с полного хода до остановки ≈ 10 с. */
export const ACCEL = 0.08;
export const COAST = 0.1;

/** Посадка по короткому гудку: 1800 тиков = 30 с при 1x = 3 игровых часа. */
export const BOARDING_TICKS = 1800;
/** Перекорм: чёрный дым 20 с при 1x, ход ×0,9. */
export const OVERFEED_TICKS = 1200;
export const OVERFEED_HEAT = 95;
/** Радиус «запрыгнуть на подножку» при отправлении. */
export const JUMP_RADIUS = 8;

/** Тайминг лопаты лидера (мс реального времени удержания E). */
export const STOKE = { cycle: 900, window: 180, ok: 300, minHold: 120 };
/** Двойной гудок: второе нажатие не позже 0,4 с; долгий — удержание 1 с. */
export const HORN = { doubleMs: 400, longMs: 1000 };

/** Рунный двигатель: расход заряда 4·ход² в игровой час пути; кристалл +8; канал лидера 1 мана → 0,5 заряда. */
export const RUNE = { drainPerHour: 4, crystal: 8, manaToBattery: 0.5, chargeBelow: 60, chargeUntil: 92 };

/**
 * Фикстуры локомотива (относительно левого верхнего угла вагона 10×7; внутри x 1..8, y 1..5).
 * Двери: верх/низ — (5, 0)/(5, 6), задняя — (0, 3); лобовое окно — (9, 3).
 */
export const STEAM_FIXTURES = [
  { defId: 'steam_boiler', dx: 6, dy: 2 },
  { defId: 'firebox', dx: 5, dy: 3 },
  { defId: 'cab_panel', dx: 4, dy: 1 },
];
export const RUNE_FIXTURES = [{ defId: 'mana_engine', dx: 6, dy: 2 }];
/** Угольный ларь у топки (зона-склад только для топлива, высший приоритет). */
export const BUNKER_CELLS = [[1, 4], [2, 4], [1, 5], [2, 5]];
/** Постройки, которые считаются «рунным ядром» (заряд кристаллами, канал лидера). */
export const RUNE_CORE_IDS = ['mana_engine', 'rune_core'];

/** Депо: цены в кронах (предмет silver). */
export const PRICES = {
  runeEngine: 800,
  sellSteam: 200,
  wagons: {
    tender: 250, storage: 250, residential: 300, kitchen: 300, hearse: 250, workshop: 350,
    infirmary: 350, greenhouse: 400, battle: 400, salon: 400,
  },
  defaultWagon: 300,
};
/** Улучшения локомотива: {id, engine, price}. Эффекты — в sim.js. */
export const UPGRADES = [
  { id: 'lagging', engine: 'steam', price: 250 },
  { id: 'reinforced_boiler', engine: 'steam', price: 300 },
  { id: 'wide_grate', engine: 'steam', price: 300 },
  { id: 'spark_arrester', engine: 'steam', price: 150 },
  { id: 'rune_cells', engine: 'rune', price: 400 },
  { id: 'pylon_coil', engine: 'rune', price: 300 },
];
export const MAX_WAGONS = 8;

/** Порядок обновления систем модуля (контракт: train — 70–90). */
export const ORDER = { loco: 75, scenario: 86, boarding: 88 };
