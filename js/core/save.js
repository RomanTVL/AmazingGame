// Сохранение/загрузка. Каждая подсистема регистрирует сериализатор:
//   game.save.registerSerializer({ id, order, save(game) → JSON-данные, load(game, data) })
// Сейв = { format, version, meta, data: { [id]: ... } } → JSON → хранилище.
import { Registry } from './registry.js';
import { EVENTS } from './events.js';
import { SAVE_FORMAT, SAVE_VERSION, GAME_VERSION } from './constants.js';

const PREFIX = 'lasttrain.save.';

export class SaveManager {
  constructor(game) {
    this.game = game;
    this.serializers = new Registry('serializers', { sortBy: 'order', defaults: { order: 100 } });
  }

  /**
   * @param {{id: string, order?: number, save: (game) => any, load: (game, data: any) => void}} def
   *   order: меньше — раньше (meta 0, time 10, map 20, entities 30, colony 40, ... модули 100+).
   */
  registerSerializer(def, owner = 'core') {
    if (typeof def.save !== 'function' || typeof def.load !== 'function') {
      throw new Error(`[save] сериализатор ${def.id} должен иметь save() и load()`);
    }
    return this.serializers.add(def, owner);
  }

  /** Снимок состояния в JS-объект. */
  snapshot() {
    const game = this.game;
    const data = {};
    for (const s of this.serializers.all()) {
      try {
        data[s.id] = s.save(game);
      } catch (err) {
        game.error(err, `save:${s.id}`);
      }
    }
    return {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      gameVersion: GAME_VERSION,
      meta: {
        day: game.time.day,
        hour: game.time.hourInt,
        colonists: game.colonists().length,
        leader: game.getLeader()?.name ?? '',
        savedAt: typeof Date !== 'undefined' ? Date.now() : 0,
      },
      data,
    };
  }

  /** Восстановить из снимка (полностью заменяет текущий мир). */
  restore(snap) {
    if (!snap || snap.format !== SAVE_FORMAT) throw new Error('[save] неизвестный формат сейва');
    const game = this.game;
    game.resetWorld();
    for (const s of this.serializers.all()) {
      if (snap.data[s.id] === undefined) continue;
      try {
        s.load(game, snap.data[s.id]);
      } catch (err) {
        game.error(err, `load:${s.id}`);
      }
    }
  }

  toJSON() {
    return JSON.stringify(this.snapshot());
  }

  fromJSON(json) {
    this.restore(JSON.parse(json));
  }

  saveSlot(slot = 'quick') {
    this.game.events.emit(EVENTS.SAVE_BEFORE, { slot });
    const json = this.toJSON();
    this.game.storage.setItem(PREFIX + slot, json);
    this.game.events.emit(EVENTS.SAVE_AFTER, { slot, bytes: json.length });
    return json.length;
  }

  loadSlot(slot = 'quick') {
    const json = this.game.storage.getItem(PREFIX + slot);
    if (!json) return false;
    this.fromJSON(json);
    this.game.events.emit(EVENTS.LOAD_AFTER, { slot });
    return true;
  }

  hasSlot(slot = 'quick') {
    return !!this.game.storage.getItem(PREFIX + slot);
  }

  deleteSlot(slot) {
    this.game.storage.removeItem(PREFIX + slot);
  }

  /** Список слотов с мета-данными: [{slot, meta}] */
  listSlots() {
    const keys = this.game.storage.keys ? this.game.storage.keys() : [];
    const out = [];
    for (const k of keys) {
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        const snap = JSON.parse(this.game.storage.getItem(k));
        out.push({ slot: k.slice(PREFIX.length), meta: snap.meta });
      } catch {
        /* битый слот */
      }
    }
    return out;
  }
}

// --- Утилиты для компактной сериализации типизированных массивов (RLE) ---

/** Массив чисел → RLE [value, count, value, count, ...] */
export function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

export function rleDecode(rle, target) {
  let p = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const v = rle[i];
    const n = rle[i + 1];
    for (let j = 0; j < n; j++) target[p++] = v;
  }
  return target;
}
