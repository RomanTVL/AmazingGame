// Шина событий (pub/sub). Модули общаются через неё, не импортируя друг друга.
// Полный список событий и форм payload — в docs/ARCHITECTURE.md (раздел «События»).

/**
 * Документированные имена событий ядра. Модули могут вводить свои события
 * с префиксом своего модуля: 'combat:hit', 'mind:breakStarted' и т.п.
 */
export const EVENTS = Object.freeze({
  // Жизненный цикл игры
  GAME_INIT: 'game:init',               // {game} — после register всех модулей и init систем
  COLONY_STARTED: 'colony:started',     // {seed, biome}
  COLONY_LOST: 'colony:lost',           // {day} — не осталось живых поселенцев
  GAME_SPEED: 'time:speed',             // {speed, paused}
  // Время
  TIME_HOUR: 'time:hour',               // {day, hour}
  TIME_DAY: 'time:day',                 // {day}
  // Карта
  MAP_GENERATED: 'map:generated',       // {map, biome}
  MAP_CHANGED: 'map:changed',           // {x, y, w, h}
  // Сущности
  ENTITY_SPAWNED: 'entity:spawned',     // {entity}
  ENTITY_REMOVED: 'entity:removed',     // {entity, reason}
  ITEM_CHANGED: 'item:changed',         // {item, delta}
  // Поселенцы
  PAWN_SPAWNED: 'pawn:spawned',         // {pawn}
  PAWN_DIED: 'pawn:died',               // {pawn, corpse, cause}
  PAWN_ATE: 'pawn:ate',                 // {pawn, item, defId, nutrition}
  PAWN_SLEPT: 'pawn:slept',             // {pawn, bed (entity|null), onFloor}
  PAWN_WOKE: 'pawn:woke',               // {pawn}
  PAWN_SAID: 'pawn:said',               // {pawn, text}
  LEADER_DIED: 'leader:died',           // {pawn, heir|null}
  LEADER_CHANGED: 'leader:changed',     // {from|null, to}
  // Работы
  JOB_STARTED: 'job:started',           // {pawn, job}
  JOB_ENDED: 'job:ended',               // {pawn, job, result: 'done'|'failed'|'cancelled'}
  WORK_HIT: 'work:hit',                 // {pawn, job, x, y, fx} — удар топором/киркой (для звука/частиц)
  WORK_PRIORITY: 'work:priority',       // {pawn, workType, value}
  PLANT_CUT: 'plant:cut',               // {plant, pawn, harvestOnly}
  THING_MINED: 'thing:mined',           // {thing, pawn}
  ITEM_PICKED: 'item:picked',           // {pawn, defId, count}
  ITEM_DROPPED: 'item:dropped',         // {pawn, defId, count, x, y}
  DESIGNATION_ADDED: 'designation:added',     // {type, x, y, targetId}
  DESIGNATION_REMOVED: 'designation:removed', // {type, x, y}
  ZONE_CHANGED: 'zone:changed',         // {zone}
  // Игрок (лидер)
  PLAYER_INTERACT: 'player:interact',   // {pawn, interaction}
  PLAYER_ORDER_MENU: 'player:orderMenu',// {leader, target (pawn|null), x, y}
  PLAYER_CALL_TO_ARMS: 'player:callToArms', // {leader}
  PLAYER_SPELL: 'player:spell',         // {leader, slot (0..3), x, y}
  PLAYER_ATTACK: 'player:attack',       // {leader, x, y}
  PLAYER_DASH: 'player:dash',           // {leader, x, y}
  // Поезд
  TRAIN_STAMPED: 'train:stamped',       // {train}
  TRAIN_UNSTAMPED: 'train:unstamped',   // {train}
  // UI / прочее
  UI_NOTIFY: 'ui:notify',               // {text, type, x?, y?, pawnId?}
  UI_PANEL_OPENED: 'ui:panelOpened',    // {id}
  UI_PANEL_CLOSED: 'ui:panelClosed',    // {id}
  UI_MENU_REQUESTED: 'ui:menuRequested',// {} — Esc при отсутствии открытых панелей
  SETTINGS_CHANGED: 'settings:changed', // {key, value}
  SAVE_BEFORE: 'save:before',           // {slot}
  SAVE_AFTER: 'save:after',             // {slot, bytes}
  LOAD_AFTER: 'load:after',             // {slot}
  AV_FLOAT_TEXT: 'av:floatText',        // {x, y, text, color}
});

export class EventBus {
  constructor() {
    /** @type {Map<string, Array<{fn: Function, owner: string, once: boolean}>>} */
    this.map = new Map();
    /** Вызывается при исключении в обработчике: (err, eventName) */
    this.onError = null;
    /** Отладка: если задано, вызывается для каждого emit. */
    this.trace = null;
  }

  /**
   * Подписка. Возвращает функцию отписки.
   * @param {string} name
   * @param {(payload: any, name: string) => void} fn
   * @param {string} [owner] — имя модуля (для offOwner и отладки)
   */
  on(name, fn, owner = 'core') {
    let list = this.map.get(name);
    if (!list) this.map.set(name, (list = []));
    list.push({ fn, owner, once: false });
    return () => this.off(name, fn);
  }

  once(name, fn, owner = 'core') {
    const off = this.on(name, fn, owner);
    const list = this.map.get(name);
    list[list.length - 1].once = true;
    return off;
  }

  off(name, fn) {
    const list = this.map.get(name);
    if (!list) return;
    const i = list.findIndex((l) => l.fn === fn);
    if (i >= 0) list.splice(i, 1);
  }

  /** Снять все подписки модуля. */
  offOwner(owner) {
    for (const [name, list] of this.map) {
      this.map.set(name, list.filter((l) => l.owner !== owner));
    }
  }

  emit(name, payload = {}) {
    if (this.trace) this.trace(name, payload);
    const list = this.map.get(name);
    if (!list || list.length === 0) return;
    // копия: обработчики могут подписываться/отписываться во время emit
    const copy = list.slice();
    for (const l of copy) {
      if (l.once) this.off(name, l.fn);
      try {
        l.fn(payload, name);
      } catch (err) {
        if (this.onError) this.onError(err, name, l.owner);
        else throw err;
      }
    }
  }

  listenerCount(name) {
    return this.map.get(name)?.length ?? 0;
  }
}
