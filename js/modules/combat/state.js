// Общее состояние модуля combat (одно на игру — замыкание C, а не синглтон модуля: в тестах в одном процессе
// живут несколько игр). Сохраняемая часть — C.S (сериализатор 'combat'); runtime — C.R (не сохраняется).
import { TICKS_PER_DAY } from '../../core/constants.js';

/** Сохраняемое состояние. Всё — JSON. */
export function createSaved() {
  return {
    raids: [], // [{id, faction, kind, pawnIds, initial, phase, startTick, points, robbed, stolen, stealBudget, robDone, kills, bossId}]
    nextRaidId: 1,
    autoRaidTick: Math.round(TICKS_PER_DAY * 5.1), // запасной рассказчик (только без модуля journey)
    autoRaidN: 0,
    stats: { raids: 0, kills: 0, bossesDefeated: [], executions: 0, recruited: 0 },
    threads: [], // нити Лича: [{lichId, pawnId, hp}]
    wards: [], // обереги вагонов: [{carId, untilTick}]
    hornUntil: 0, // «к оружию» по гудку (тик, после которого можно отпустить, если тихо)
    calmTicks: 0,
  };
}

/** Runtime-состояние (не сохраняется): эффекты, очередь ввода, кэши списков. */
export function createRuntime() {
  return {
    actions: [], // очередь действий игрока (обрабатывается в тике)
    vfx: [], // косметические эффекты {type, born, ...}
    clock: 0, // реальное время (с) для эффектов
    hoverEnemyId: 0,
    leaderTargetId: 0,
    lastHitStop: -1e9,
    tink: { n: 0, last: -1e9 },
    colony: [], // живые поселенцы (кэш на тик)
    enemies: [], // активные враги (кэш на тик)
    hostiles: 0,
    downedEnemies: 0,
    prisoners: 0,
    nameless: 0,
    heartId: 0,
    bossId: 0, // активный подвижный босс (цель «всем на босса»)
    posts: new Map(), // пост у окна/двери (гудок): pawnId → {x, y}
    prisonerSel: 0,
    execConfirm: 0,
    qbuf: [],
    qbuf2: [],
  };
}

export function createContext(game) {
  return {
    game,
    S: createSaved(),
    R: createRuntime(),
    /** Косметический эффект (no-op в headless). */
    vfx(type, props) {
      if (game.isHeadless) return null;
      const R = this.R;
      if (R.vfx.length > 400) R.vfx.splice(0, 50);
      const v = { type, born: R.clock, ...props };
      R.vfx.push(v);
      return v;
    },
  };
}

/** Реальное время в мс (только для косметики/хит-стопа; на симуляцию не влияет). */
export const realNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const now = (game) => game.time.tick;
export const secs = (s) => Math.round(s * 60);
