// Шина событий (pub/sub). Модули общаются через неё, не импортируя друг друга.
// Полный список событий и форм payload — в docs/ARCHITECTURE.md (раздел «События»).

/**
 * Документированные имена событий ядра. Модули могут вводить свои события
 * с префиксом своего модуля: 'combat:hit', 'mind:breakStarted' и т.п.
 */
export const EVENTS = Object.freeze({
  // Жизненный цикл игры
  GAME_INIT: 'game:init',               // {game} — после register всех модулей и init систем
  WORLD_RESET: 'world:reset',           // {reason: 'new'|'load'|'station'} — мир очищен: сбросьте свои runtime-кэши
  COLONY_STARTED: 'colony:started',     // {seed, biome, scenarioId, difficulty, opts} — новая колония готова (после scenario.apply)
  COLONY_LOST: 'colony:lost',           // {day} — не осталось живых поселенцев
  STATION_CHANGED: 'station:changed',   // {map, train, carried: number, opts} — поезд переехал на новую карту (game.changeStation)
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
  ENTITY_MOVED: 'entity:moved',         // {entity, fromX, fromY} — game.entities.setPosition (НЕ каждый шаг пешки)
  ITEM_CHANGED: 'item:changed',         // {item, delta}
  // Поселенцы
  PAWN_SPAWNED: 'pawn:spawned',         // {pawn}
  PAWN_DIED: 'pawn:died',               // {pawn, corpse, cause, opts}
  PAWN_ATE: 'pawn:ate',                 // {pawn, item, defId, nutrition}
  PAWN_SLEPT: 'pawn:slept',             // {pawn, bed (entity|null), onFloor}
  PAWN_WOKE: 'pawn:woke',               // {pawn}
  PAWN_SAID: 'pawn:said',               // {pawn, text}
  LEADER_DIED: 'leader:died',           // {pawn, heir|null}
  LEADER_CHANGED: 'leader:changed',     // {from (pawn|null; null, если прежний лидер погиб), to}
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
  PLAYER_INTERACT: 'player:interact',   // {pawn, interaction} — нажата E (для hold-взаимодействий — начало удержания)
  PLAYER_INTERACT_END: 'player:interactEnd', // {pawn, interaction, heldMs} — отпущена E у hold-взаимодействия
  PLAYER_ORDER_MENU: 'player:orderMenu',// {leader, target (pawn|null), x, y}
  PLAYER_CALL_TO_ARMS: 'player:callToArms', // {leader}
  PLAYER_SPELL: 'player:spell',         // {leader, slot (0..3), x, y}
  PLAYER_ATTACK: 'player:attack',       // {leader, x, y}
  PLAYER_DASH: 'player:dash',           // {leader, x, y}
  // Поезд
  TRAIN_STAMPED: 'train:stamped',       // {train} — поезд поставлен на карту (стены, полы, фикстуры, зоны готовы)
  TRAIN_UNSTAMPED: 'train:unstamped',   // {train}
  TRAIN_CAR_ADDED: 'train:carAdded',    // {train, car} — train.addCar (до restamp)
  TRAIN_CAR_REMOVED: 'train:carRemoved',// {train, car} — train.removeCar (до restamp)
  // UI / прочее
  UI_NOTIFY: 'ui:notify',               // {text, type, x?, y?, pawnId?}
  UI_PANEL_OPENED: 'ui:panelOpened',    // {id}
  UI_PANEL_CLOSED: 'ui:panelClosed',    // {id}
  UI_MENU_REQUESTED: 'ui:menuRequested',// {} — Esc при отсутствии открытых панелей
  SETTINGS_CHANGED: 'settings:changed', // {key, value}
  SAVE_BEFORE: 'save:before',           // {slot}
  SAVE_AFTER: 'save:after',             // {slot, bytes, ok} — ok=false: хранилище отказало (квота), сейв только в памяти
  LOAD_AFTER: 'load:after',             // {slot|null} — после game.save.restore/fromJSON/loadSlot
  AV_FLOAT_TEXT: 'av:floatText',        // {x, y, text, color}

  // ---- События модулей: ядро только объявляет имена (шлёт модуль-владелец, см. docs/ARCHITECTURE.md) ----
  GAME_VICTORY: 'game:victory',                 // {ending, stats} — journey
  JOURNEY_HORN: 'journey:horn',                 // {pattern} — train (гудок)
  JOURNEY_BOARDING: 'journey:boarding',         // {untilTick, missing: pawn[]} — train (посадка перед отправлением)
  JOURNEY_LEFT_BEHIND: 'journey:leftBehind',    // {pawn, station} — train (опоздавший остался на станции)
  JOURNEY_STOKE: 'journey:stoke',               // {pawn, x, y, quality, fuel} — train (заброс топлива в топку)
  JOURNEY_BOILER: 'journey:boiler',             // {state} — train ('ok'|'low'|'high'|'critical'|...)
  JOURNEY_ARRIVING: 'journey:arriving',         // {station} — journey
  JOURNEY_ACT_CHANGED: 'journey:actChanged',    // {act} — journey
  JOURNEY_ROT_BEHIND: 'journey:rotBehind',      // {} — journey (Гниль отстала)
  MIND_SOCIAL: 'mind:social',                   // {a, b, kind, glyphs, audible, ticks} — mind
  MIND_AUTHORITY_CHANGED: 'mind:authorityChanged', // {value, delta, reason} — mind (заглушка ядра тоже шлёт)
  HEALTH_LAST_BREATH: 'health:lastBreath',      // {pawn, untilTick} — health
  HEALTH_LAST_WORDS: 'health:lastWords',        // {pawn, heard, text} — health
  HEALTH_MEMORY_CHANGED: 'health:memoryChanged',// {value, delta, reason} — health (заглушка ядра тоже шлёт)
  HEALTH_FUNERAL: 'health:funeral',             // {record, rite, speechId} — health
  ORDERS_REFUSED: 'orders:refused',             // {pawn, orderId, reply} — vision (приказы)
  VISION_NOISE: 'vision:noise',                 // {x, y, radius, kind} — vision (заглушка ядра тоже шлёт)
  COMBAT_WEAPON_NAMED: 'combat:weaponNamed',    // {item, name} — combat
  ECONOMY_INSPECTION_STARTED: 'economy:inspectionStarted', // {...opts} — economy
  ECONOMY_INSPECTION_ENDED: 'economy:inspectionEnded',     // {found, fine} — economy
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
