// Менеджер сущностей. Сущность — простой JSON-совместимый объект:
//   { id, kind, defId?, x, y, ...компоненты }
// Поля, начинающиеся с '_', — служебные (не сохраняются). Ссылки на другие сущности — только по id.
//
// Виды (kinds): pawn, item, building, plant, corpse, projectile, decal (+ модули могут добавлять свои
// через game.entities.registerKind). Статичные виды индексируются по клеткам, динамичные — по чанкам.
import { EVENTS } from '../core/events.js';
import { CHUNK } from '../core/constants.js';

const BKEY = (cx, cy) => cx + cy * 4096;

export class EntityManager {
  constructor(game) {
    this.game = game;
    this.nextId = 1;
    /** @type {Map<number, any>} */
    this.byId = new Map();
    /** @type {Map<string, Map<number, any>>} */
    this.byKind = new Map();
    /** kind → {id, static, defs (имя реестра), transient: string[]} */
    this.kinds = new Map();
    /** Статичные сущности по клетке: idx → массив */
    this.tileIndex = new Map();
    /** Чанки: key → Set сущностей (все виды) */
    this.buckets = new Map();
    this.registerKind('pawn', {
      static: false,
      transient: ['job', 'path', 'pathI', 'pathGoal', 'moveInput', 'workProgress'],
      restore: (e) => {
        e.moveInput = { x: 0, y: 0 };
        e.job = null;
        e.path = null;
        e.pathI = 0;
        e.asleep = false;
      },
    });
    this.registerKind('item', { static: true, defs: 'items' });
    this.registerKind('building', { static: true, defs: 'buildings' });
    this.registerKind('plant', { static: true, defs: 'plants' });
    this.registerKind('corpse', { static: true });
    this.registerKind('projectile', { static: false, saved: false });
    this.registerKind('decal', { static: true });
  }

  /**
   * Новый вид сущностей.
   * @param {string} id
   * @param {{static?: boolean, defs?: string, transient?: string[], saved?: boolean, restore?: (e) => void}} opts
   *   static — индексировать по клетке; defs — имя реестра game.defs для defOf();
   *   transient — поля, которые не сохраняются; saved=false — вид вообще не сохраняется;
   *   restore(e) — восстановить runtime-поля после загрузки.
   */
  registerKind(id, opts = {}) {
    this.kinds.set(id, {
      id,
      static: !!opts.static,
      defs: opts.defs || null,
      transient: opts.transient || [],
      saved: opts.saved !== false,
      restore: opts.restore || null,
    });
    if (!this.byKind.has(id)) this.byKind.set(id, new Map());
  }

  /** Создать сущность. props должны содержать x, y (клетки; у пешек — дробные). */
  spawn(kind, props = {}) {
    const k = this.kinds.get(kind);
    if (!k) throw new Error(`[entities] неизвестный вид ${kind}`);
    const e = { id: 0, x: 0, y: 0, ...props, kind };
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) {
      // не роняем игру, но сообщаем (тесты падают при game.errors)
      this.game.error(new Error(`[entities] spawn ${kind}${props.defId ? ':' + props.defId : ''}: нечисловая позиция (${props.x}, ${props.y})`), 'entities.spawn');
      e.x = Number.isFinite(e.x) ? e.x : 0;
      e.y = Number.isFinite(e.y) ? e.y : 0;
    }
    if (props.id) {
      if (this.byId.has(props.id)) throw new Error(`[entities] id ${props.id} уже занят`);
      e.id = props.id;
      this.nextId = Math.max(this.nextId, props.id + 1);
    } else e.id = this.nextId++;
    this._add(e, k);
    this.game.events.emit(EVENTS.ENTITY_SPAWNED, { entity: e });
    return e;
  }

  _add(e, k) {
    this.byId.set(e.id, e);
    this.byKind.get(e.kind).set(e.id, e);
    this._index(e, k);
  }

  /** Вписать сущность в пространственные индексы (слои карты, клетки, чанки). */
  _index(e, k = this.kinds.get(e.kind)) {
    const map = this.game.map;
    if (k?.static) {
      const tx = Math.floor(e.x);
      const ty = Math.floor(e.y);
      e.x = tx;
      e.y = ty;
      if (e.kind === 'building') {
        const def = this.game.defs.buildings.get(e.defId);
        const [w, h] = this.footprintSize(def, e.rot || 0);
        e.w = w;
        e.h = h;
        if (e.hp === undefined) e.hp = def?.hp ?? 100;
        if (map) {
          map.batch(() => {
            for (let j = 0; j < h; j++)
              for (let i = 0; i < w; i++) {
                if (!map.inBounds(tx + i, ty + j)) continue;
                map.building[map.idx(tx + i, ty + j)] = e.id;
                map.refresh(tx + i, ty + j);
              }
          });
        }
      } else if (e.kind === 'plant') {
        if (map && map.inBounds(tx, ty)) {
          map.plant[map.idx(tx, ty)] = e.id;
          map.refresh(tx, ty);
        }
      }
      if (map && map.inBounds(tx, ty)) {
        const i = map.idx(tx, ty);
        let arr = this.tileIndex.get(i);
        if (!arr) this.tileIndex.set(i, (arr = []));
        arr.push(e);
      }
    }
    this._bucketAdd(e);
  }

  /** Убрать сущность из пространственных индексов (обратное _index). */
  _unindex(e, k = this.kinds.get(e.kind)) {
    this._bucketRemove(e);
    const map = this.game.map;
    if (!k?.static || !map) return;
    if (e.kind === 'building') {
      map.batch(() => {
        for (let j = 0; j < (e.h || 1); j++)
          for (let i = 0; i < (e.w || 1); i++) {
            const x = e.x + i;
            const y = e.y + j;
            if (!map.inBounds(x, y)) continue;
            const idx = map.idx(x, y);
            if (map.building[idx] === e.id) {
              map.building[idx] = 0;
              map.refresh(x, y);
            }
          }
      });
    } else if (e.kind === 'plant') {
      if (map.inBounds(e.x, e.y)) {
        const idx = map.idx(e.x, e.y);
        if (map.plant[idx] === e.id) {
          map.plant[idx] = 0;
          map.refresh(e.x, e.y);
        }
      }
    }
    if (map.inBounds(e.x, e.y)) {
      const idx = map.idx(e.x, e.y);
      const arr = this.tileIndex.get(idx);
      if (arr) {
        const p = arr.indexOf(e);
        if (p >= 0) arr.splice(p, 1);
        if (arr.length === 0) this.tileIndex.delete(idx);
      }
    }
  }

  _bucketAdd(e) {
    const key = BKEY(Math.floor(e.x / CHUNK), Math.floor(e.y / CHUNK));
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = new Set()));
    b.add(e);
    e._bucket = key;
  }

  _bucketRemove(e) {
    const b = this.buckets.get(e._bucket);
    if (b) {
      b.delete(e);
      if (b.size === 0) this.buckets.delete(e._bucket);
    }
  }

  /** Сообщить, что динамичная сущность сдвинулась (обновление чанка). Дёшево, вызывать после движения. */
  moved(e) {
    const key = BKEY(Math.floor(e.x / CHUNK), Math.floor(e.y / CHUNK));
    if (key !== e._bucket) {
      this._bucketRemove(e);
      this._bucketAdd(e);
    }
  }

  /**
   * Переместить сущность в (x, y) БЕЗ удаления/создания: тот же объект и id, пометки переезжают вместе с ней.
   * Статичные (постройки, предметы, растения) переиндексируются; шлёт 'entity:moved' {entity, fromX, fromY}.
   * Для пошагового движения пешек это не нужно (там p.x/p.y + moved(p)).
   */
  setPosition(e, x, y) {
    if (!e || e.removed) return e;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      this.game.error(new Error(`[entities] setPosition #${e.id}: нечисловая позиция (${x}, ${y})`), 'entities.setPosition');
      return e;
    }
    const fromX = e.x;
    const fromY = e.y;
    const k = this.kinds.get(e.kind);
    if (k?.static) {
      this._unindex(e, k);
      e.x = x;
      e.y = y;
      this._index(e, k);
    } else {
      e.x = x;
      e.y = y;
      this.moved(e);
    }
    this.game.events.emit(EVENTS.ENTITY_MOVED, { entity: e, fromX, fromY });
    return e;
  }

  /** Удалить сущность. reason — строка для подписчиков ('chopped', 'died', 'consumed', ...). */
  remove(e, reason = 'removed') {
    if (!e || e.removed) return;
    e.removed = true;
    const k = this.kinds.get(e.kind);
    this.byId.delete(e.id);
    this.byKind.get(e.kind)?.delete(e.id);
    this._unindex(e, k);
    this.game.events.emit(EVENTS.ENTITY_REMOVED, { entity: e, reason });
  }

  /**
   * Отсоединить сущность от мира БЕЗ события (служебное: перенос поезда на новую карту, game.changeStation).
   * Объект и id сохраняются; вернуть — attach(e).
   */
  detach(e) {
    if (!e || e.removed || !this.byId.has(e.id)) return e;
    this._unindex(e);
    this.byId.delete(e.id);
    this.byKind.get(e.kind)?.delete(e.id);
    return e;
  }

  /**
   * Вернуть отсоединённую сущность (с её id) на текущую карту по её e.x/e.y.
   * Шлёт 'entity:spawned' (новая карта) или, если задан opts.movedFrom {x, y}, — 'entity:moved' (та же карта).
   */
  attach(e, opts = {}) {
    const k = this.kinds.get(e.kind);
    if (!k) throw new Error(`[entities] неизвестный вид ${e.kind}`);
    if (this.byId.has(e.id)) throw new Error(`[entities] id ${e.id} уже занят`);
    delete e.removed;
    this.nextId = Math.max(this.nextId, e.id + 1);
    this._add(e, k);
    if (opts.movedFrom) this.game.events.emit(EVENTS.ENTITY_MOVED, { entity: e, fromX: opts.movedFrom.x, fromY: opts.movedFrom.y });
    else this.game.events.emit(EVENTS.ENTITY_SPAWNED, { entity: e });
    return e;
  }

  get(id) {
    return id ? this.byId.get(id) : undefined;
  }

  /** Итератор по сущностям вида (безопасно удалять во время обхода). */
  ofKind(kind) {
    return (this.byKind.get(kind) || new Map()).values();
  }

  /** Массив сущностей вида (копия). */
  listKind(kind) {
    return [...(this.byKind.get(kind) || new Map()).values()];
  }

  countKind(kind) {
    return this.byKind.get(kind)?.size ?? 0;
  }

  get count() {
    return this.byId.size;
  }

  /** Определение сущности (def из реестра её вида) или null. */
  defOf(e) {
    const k = e && this.kinds.get(e.kind);
    if (!k?.defs) return null;
    return this.game.defs[k.defs]?.get(e.defId) || null;
  }

  /** Сущности на клетке. kind необязателен. Постройки находятся по любой клетке своего размера. */
  atTile(x, y, kind) {
    const map = this.game.map;
    if (!map || !map.inBounds(x, y)) return [];
    if (kind === 'building') {
      const b = map.buildingAt(x, y);
      return b ? [b] : [];
    }
    if (kind === 'plant') {
      const p = map.plantAt(x, y);
      return p ? [p] : [];
    }
    const arr = this.tileIndex.get(map.idx(x, y)) || [];
    let out = kind ? arr.filter((e) => e.kind === kind) : arr.slice();
    if (!kind) {
      const b = map.buildingAt(x, y);
      if (b && !out.includes(b)) out.push(b);
      // динамичные (пешки) на клетке
      for (const e of this.queryRect(x, y, x, y, 'pawn')) out.push(e);
    }
    return out;
  }

  firstAtTile(x, y, kind) {
    return this.atTile(x, y, kind)[0] || null;
  }

  /**
   * Сущности в прямоугольнике клеток [x0..x1]×[y0..y1] (включительно).
   * Постройки ищутся с запасом 4 клетки (по происхождению).
   */
  queryRect(x0, y0, x1, y1, kind, out = []) {
    const m = kind === 'building' || !kind ? 4 : 0;
    const cx0 = Math.floor((x0 - m) / CHUNK);
    const cy0 = Math.floor((y0 - m) / CHUNK);
    const cx1 = Math.floor(x1 / CHUNK);
    const cy1 = Math.floor(y1 / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const b = this.buckets.get(BKEY(cx, cy));
        if (!b) continue;
        for (const e of b) {
          if (kind && e.kind !== kind) continue;
          const ex = Math.floor(e.x);
          const ey = Math.floor(e.y);
          if (ex > x1 || ey > y1) continue;
          if (ex + (e.w || 1) - 1 < x0 || ey + (e.h || 1) - 1 < y0) continue;
          out.push(e);
        }
      }
    return out;
  }

  /** Сущности в радиусе r (по центрам) от точки (x, y). filter(e) необязателен. */
  queryRadius(x, y, r, kind, filter, out = []) {
    const tmp = this.queryRect(Math.floor(x - r), Math.floor(y - r), Math.floor(x + r), Math.floor(y + r), kind);
    const r2 = r * r;
    for (const e of tmp) {
      const cx = e.kind === 'pawn' || e.kind === 'projectile' ? e.x : e.x + (e.w || 1) / 2;
      const cy = e.kind === 'pawn' || e.kind === 'projectile' ? e.y : e.y + (e.h || 1) / 2;
      const dx = cx - x;
      const dy = cy - y;
      if (dx * dx + dy * dy <= r2 && (!filter || filter(e))) out.push(e);
    }
    return out;
  }

  /** Центр сущности в координатах клеток (для пешек — их позиция). */
  center(e) {
    if (e.kind === 'pawn' || e.kind === 'projectile') return { x: e.x, y: e.y };
    return { x: e.x + (e.w || 1) / 2, y: e.y + (e.h || 1) / 2 };
  }

  /** Размер постройки с учётом поворота (rot 1/3 меняют местами w и h). */
  footprintSize(def, rot = 0) {
    const s = def?.size || [1, 1];
    return rot % 2 === 1 ? [s[1], s[0]] : [s[0], s[1]];
  }

  /**
   * УСТАРЕВШЕЕ: пересоздаёт объект (remove 'relocated' + spawn, пометки теряются). Используйте setPosition(e, x, y).
   */
  relocate(e, x, y) {
    const props = { ...e };
    this.remove(e, 'relocated');
    delete props.removed;
    props.x = x;
    props.y = y;
    const k = this.kinds.get(e.kind);
    const ne = { ...props };
    this._add(ne, k);
    this.game.events.emit(EVENTS.ENTITY_SPAWNED, { entity: ne });
    return ne;
  }

  /** Очистить всё без событий. opts.keepNextId — не сбрасывать счётчик id (смена станции). */
  clear(opts = {}) {
    this.byId.clear();
    for (const m of this.byKind.values()) m.clear();
    this.tileIndex.clear();
    this.buckets.clear();
    if (!opts.keepNextId) this.nextId = 1;
  }

  serialize() {
    const out = [];
    for (const e of this.byId.values()) {
      const k = this.kinds.get(e.kind);
      if (!k || !k.saved) continue;
      const o = {};
      for (const key in e) {
        if (key[0] === '_' || key === 'removed' || k.transient.includes(key)) continue;
        o[key] = e[key];
      }
      out.push(o);
    }
    return { nextId: this.nextId, list: out };
  }

  deserialize(data) {
    this.clear();
    // сначала постройки и растения (влияют на карту), потом остальное
    const order = (e) => (e.kind === 'building' ? 0 : e.kind === 'plant' ? 1 : 2);
    const list = data.list.slice().sort((a, b) => order(a) - order(b));
    for (const o of list) {
      const k = this.kinds.get(o.kind);
      if (!k) continue;
      const e = JSON.parse(JSON.stringify(o));
      k.restore?.(e);
      this._add(e, k);
    }
    this.nextId = Math.max(this.nextId, data.nextId);
  }
}
