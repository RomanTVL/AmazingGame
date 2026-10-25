// Общее состояние модуля combat (одно на игру — замыкание C, а не синглтон модуля: в тестах в одном процессе
// живут несколько игр). Сохраняемая часть — C.S (сериализатор 'combat'); runtime — C.R (не сохраняется).
import { TICKS_PER_DAY } from '../../core/constants.js';

/** Сохраняемое состояние. Всё — JSON. */
export function createSaved() {
  return {
    raids: [], // [{id, faction, kind, pawnIds, initial, phase, startTick, points, robbed, stolen, stealBudget, stealZoneId, robDone, bossId}]
    nextRaidId: 1,
    autoRaidTick: Math.round(TICKS_PER_DAY * 2.3), // запасной рассказчик (только без модуля journey)
    stats: { raids: 0, kills: 0, bossesDefeated: [] },
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
    turrets: new Set(),
    traps: new Set(),
    burning: new Set(),
    faded: new Set(),
    listsDirty: true,
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
