// Контекст модуля mind: ссылка на игру, runtime-кэши (сбрасываются на world:reset) и сохраняемое состояние колонии
// (game.colony.mind — сохраняется автоматически вместе с game.colony).
import { colonists } from './util.js';

function freshRuntime() {
  return {
    /** pawnId → {text, start, until, kind, color} — облачка реплик */
    bubbles: new Map(),
    /** pawnId → {kind, glyphs, partnerId, start, until, audible} — идущие разговоры (для отрисовки) */
    talks: new Map(),
    /** отложенные реплики [{tick, pawnId, text}] */
    pending: [],
    /** ключ комнаты → номер игрового часа последнего «шёпота» в журнале */
    whisperHour: new Map(),
    lastWhisperTick: -1e9,
    /** неизвестные id мыслей (лог один раз) */
    unknown: new Set(),
    /** tableId → [{pawnId, tick}] — трапезы за столом (тост) */
    meals: new Map(),
    /** индекс мебели (перестраивается лениво) */
    furn: null,
    furnDirty: true,
    /** косметика: «ха!», искры и пр. [{x, y, kind, start, until}] */
    pops: [],
    colonists: [],
  };
}

export function freshSaved() {
  return {
    v: 1,
    /** дневные лимиты авторитета: {day, n: {reason: сумма}} */
    authDay: 0,
    authSum: {},
    lastCombatTick: -1e9,
    arrivedTick: -1e9,
    firstSnowUntil: 0,
    firstSnowDone: false,
    catId: 0,
    weddings: 0,
    storyNight: -1,
  };
}

export function createContext(game) {
  const M = {
    game,
    R: freshRuntime(),
    /** сохраняемое состояние (лениво создаётся в game.colony) */
    S() {
      const c = game.colony;
      if (!c.mind || typeof c.mind !== 'object') c.mind = freshSaved();
      return c.mind;
    },
    reset() {
      M.R = freshRuntime();
    },
    now: () => game.time.tick,
    colonists: () => colonists(game, M.R.colonists),
  };
  return M;
}
