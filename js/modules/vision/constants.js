// Константы модуля vision (обзор, слух, голос, постройки-источники обзора).

/** Биты видимости клетки в V.vis: свои глаза лидера / постройки (камеры, вышки, маяк) / поселенцы (передатчик). */
export const BIT = Object.freeze({ LEADER: 1, STRUCT: 2, CREW: 4 });

export const DAY_RADIUS = 14; // обзор лидера днём
export const CREW_RADIUS = 12; // обзор поселенца (через передатчик)
export const MIN_RADIUS = 2.5; // ночной минимум лидера: кудри светятся
export const NIGHT_SHRINK = 0.62; // доля радиуса, теряемая в полную ночь (на неосвещённых клетках)
export const CAMERA_RADIUS = 9;
export const TOWER_RADIUS = 14;
export const LIGHTHOUSE_RADIUS = 16;
export const MONITOR_LEADER_RADIUS = 1.5; // у пульта лидер «не видит, что за спиной»

export const VOICE_RADIUS = 10; // голос лидера (×perks.voiceMul)
export const HEAR_RADIUS = 8; // слух лидера
export const DOOR_OPEN_RADIUS = 1.3; // дверь открыта, если пешка ближе (как у отрисовщика двери ядра)

/** id построек модуля. */
export const DEF = Object.freeze({
  CAMERA: 'rune_camera',
  TRANSMITTER: 'rune_transmitter',
  BELL: 'signal_bell',
  BOARD: 'command_board',
  MONITOR: 'camera_monitor',
  TOWER: 'watchtower',
  LIGHTHOUSE: 'lighthouse',
});

/** Радиусы шума по видам (PLAN 16.7) — по умолчанию для noise(x, y, undefined, kind). */
export const NOISE_RADIUS = Object.freeze({
  steps: 2, shovel: 6, chop: 8, clash: 8, scream: 10, cry: 6, scrape: 6, shot: 15, explosion: 25, horn: 40,
  bell: 40, groan: 5, shout: 10, generic: 6,
});

/** Тревожные виды шума (оранжевые значки). */
export const DANGER_NOISE = new Set(['clash', 'scream', 'shot', 'explosion', 'groan']);

/** Приказы колеса: внутреннее кольцо (действия) и внешнее (работы). */
export const INNER_ORDERS = ['follow', 'guard', 'attack', 'hold_door', 'retreat_to_train', 'carry_wounded', 'rest', 'quiet'];
export const WORK_ORDERS = { build: 'construction', chop: 'cutting', haul: 'hauling', heal: 'doctoring', cook: 'cooking' };
export const OUTER_ORDERS = Object.keys(WORK_ORDERS);
export const ALL_ORDERS = [...INNER_ORDERS, ...OUTER_ORDERS];
/** Боевые приказы — исполняет узел 'orderFight' (96, выше бегства 95). */
export const FIGHT_ORDERS = new Set(['guard', 'attack', 'hold_door']);

export const TICKS_HOUR = 600;
/** Длительность приказов (тики). */
export const ORDER_TICKS = {
  follow: 4 * TICKS_HOUR, guard: 8 * TICKS_HOUR, attack: 2 * TICKS_HOUR, hold_door: 6 * TICKS_HOUR,
  retreat_to_train: 2 * TICKS_HOUR, carry_wounded: 2 * TICKS_HOUR, rest: 2 * TICKS_HOUR, quiet: TICKS_HOUR, work: 4 * TICKS_HOUR,
};

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
