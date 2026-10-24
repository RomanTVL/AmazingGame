// Предметы, стопки на клетках, зоны складов и переноска (hauling).
// Предмет — сущность kind 'item': {defId, count, x, y, forbidden?}. Одна стопка на клетку.
import { EVENTS } from '../core/events.js';
import { resKey } from './jobs.js';

/**
 * Базовые предметы. Схема ItemDef:
 * {id, nameKey, category: 'resource'|'food'|'medicine'|'material'|'fuel'|'misc'|..., stackLimit, value,
 *  nutrition? (0..1 за единицу), foodKind?: 'raw'|'meal'|'preserved', medicine?: {potency},
 *  color, icon: 'logs'|'stone'|'ore'|'crystal'|'berries'|'meat'|'box'|'meal'|'cross'|'bag'|..., glow?: boolean}
 */
export const CORE_ITEMS = [
  { id: 'wood', nameKey: 'item.wood', category: 'resource', stackLimit: 75, value: 1.2, color: '#c98a4b', icon: 'logs' },
  { id: 'stone', nameKey: 'item.stone', category: 'resource', stackLimit: 75, value: 0.8, color: '#9aa3b5', icon: 'stone' },
  { id: 'iron_ore', nameKey: 'item.iron_ore', category: 'resource', stackLimit: 75, value: 2, color: '#d98e6c', icon: 'ore' },
  { id: 'mana_crystal', nameKey: 'item.mana_crystal', category: 'fuel', stackLimit: 50, value: 6, color: '#5ef2ff', icon: 'crystal', glow: true },
  { id: 'berries', nameKey: 'item.berries', category: 'food', stackLimit: 75, value: 0.6, nutrition: 0.1, foodKind: 'raw', color: '#ff4f7a', icon: 'berries' },
  { id: 'meat_raw', nameKey: 'item.meat_raw', category: 'food', stackLimit: 75, value: 0.8, nutrition: 0.12, foodKind: 'raw', color: '#ff6b6b', icon: 'meat' },
  { id: 'ration', nameKey: 'item.ration', category: 'food', stackLimit: 50, value: 3, nutrition: 0.8, foodKind: 'preserved', color: '#ffd27a', icon: 'box' },
  { id: 'meal_simple', nameKey: 'item.meal_simple', category: 'food', stackLimit: 10, value: 4, nutrition: 0.9, foodKind: 'meal', color: '#ffb347', icon: 'meal' },
  { id: 'medicine_herbal', nameKey: 'item.medicine_herbal', category: 'medicine', stackLimit: 25, value: 8, medicine: { potency: 0.6 }, color: '#7dff9a', icon: 'cross' },
  { id: 'cloth', nameKey: 'item.cloth', category: 'material', stackLimit: 75, value: 1.5, color: '#d8c8ff', icon: 'bag' },
];

export const CORE_ZONE_TYPES = [
  { id: 'stockpile', nameKey: 'zone.stockpile', color: '#ffd27a', storage: true },
];

export function registerItemDefs(game) {
  game.defs.create('items', { defaults: { stackLimit: 75, value: 1, category: 'misc', icon: 'box', color: '#cccccc' } });
  game.defs.create('zoneTypes');
  game.defs.items.addAll(CORE_ITEMS);
  game.defs.zoneTypes.addAll(CORE_ZONE_TYPES);
}

const SPIRAL = (() => {
  const out = [];
  for (let r = 0; r <= 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([dx, dy]);
  return out;
})();

export class ItemManager {
  constructor(game) {
    this.game = game;
  }

  def(defId) {
    return this.game.defs.items.get(defId);
  }

  itemAt(x, y) {
    return this.game.entities.atTile(x, y, 'item')[0] || null;
  }

  /** Можно ли положить предмет на клетку (проходима, без непроходимой постройки). */
  canHoldItems(x, y) {
    const map = this.game.map;
    if (!map.inBounds(x, y)) return false;
    const i = map.idx(x, y);
    if (map.cost[i] > 0) return true;
    const b = map.buildingAt(x, y);
    return !!(b && this.game.defs.buildings.get(b.defId)?.storage);
  }

  /** Сколько единиц defId поместится на клетку. */
  roomAt(defId, x, y) {
    if (!this.canHoldItems(x, y)) return 0;
    const lim = this.def(defId)?.stackLimit ?? 75;
    const it = this.itemAt(x, y);
    if (!it) return lim;
    if (it.defId !== defId) return 0;
    return Math.max(0, lim - it.count);
  }

  /**
   * Создать предметы у клетки (слияние со стопками, «рассыпание» по соседним клеткам).
   * @returns {object[]} затронутые стопки
   */
  spawn(defId, count, x, y, opts = {}) {
    const def = this.def(defId);
    if (!def || !(count > 0) || !Number.isFinite(count) || !this.game.map) return [];
    x = Math.floor(x);
    y = Math.floor(y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const map = this.game.map;
    const touched = [];
    let left = Math.floor(count);
    for (const [dx, dy] of SPIRAL) {
      if (left <= 0) break;
      const tx = x + dx;
      const ty = y + dy;
      if (!map.inBounds(tx, ty)) continue;
      const room = this.roomAt(defId, tx, ty);
      if (room <= 0) continue;
      const n = Math.min(room, left);
      const it = this.itemAt(tx, ty);
      if (it) {
        it.count += n;
        this.game.events.emit(EVENTS.ITEM_CHANGED, { item: it, delta: n });
        touched.push(it);
      } else {
        touched.push(this.game.entities.spawn('item', { defId, count: n, x: tx, y: ty, forbidden: !!opts.forbidden }));
      }
      left -= n;
    }
    return touched;
  }

  /** Уменьшить стопку на n (удаляет при 0). @returns {number} сколько взято */
  take(item, n) {
    if (!item || item.removed || !Number.isFinite(n)) return 0;
    const k = Math.min(item.count, Math.max(0, Math.floor(n)));
    item.count -= k;
    if (item.count <= 0) this.game.entities.remove(item, 'taken');
    else this.game.events.emit(EVENTS.ITEM_CHANGED, { item, delta: -k });
    return k;
  }

  /** Пешка берёт предмет в руки (pawn.carry). Чужой груз сначала сбрасывается. */
  pickUp(pawn, item, count) {
    if (!Number.isFinite(count)) count = item.count;
    if (pawn.carry && pawn.carry.defId !== item.defId) this.dropCarried(pawn);
    const lim = this.def(item.defId)?.stackLimit ?? 75;
    const have = pawn.carry?.count ?? 0;
    const n = this.take(item, Math.min(count, lim - have));
    if (n <= 0) return 0;
    pawn.carry = { defId: item.defId, count: have + n };
    this.game.events.emit(EVENTS.ITEM_PICKED, { pawn, defId: item.defId, count: n });
    return n;
  }

  /** Положить несомое на клетку (по умолчанию — под пешку). */
  dropCarried(pawn, x, y) {
    const c = pawn.carry;
    if (!c) return;
    pawn.carry = null;
    const tx = x ?? Math.floor(pawn.x);
    const ty = y ?? Math.floor(pawn.y);
    this.spawn(c.defId, c.count, tx, ty);
    this.game.events.emit(EVENTS.ITEM_DROPPED, { pawn, defId: c.defId, count: c.count, x: tx, y: ty });
  }

  /** Всего единиц предмета (opts.storedOnly — только на складах). */
  count(defId, opts = {}) {
    let n = 0;
    for (const it of this.game.entities.ofKind('item')) {
      if (it.defId !== defId) continue;
      if (opts.storedOnly && !this.isStored(it)) continue;
      n += it.count;
    }
    return n;
  }

  /** Map defId → количество. */
  totals() {
    const m = new Map();
    for (const it of this.game.entities.ofKind('item')) m.set(it.defId, (m.get(it.defId) || 0) + it.count);
    return m;
  }

  /** Лежит ли предмет на складе, который его принимает. */
  isStored(item) {
    const z = this.game.zones.zoneAt(item.x, item.y);
    return !!(z && this.game.zones.isStorage(z) && this.game.zones.accepts(z, item.defId));
  }

  /**
   * Списать ресурсы cost = {defId: n}, начиная с ближайших к точке. Всё или ничего.
   * @returns {boolean}
   */
  consume(cost, nearX = 0, nearY = 0) {
    const entries = Object.entries(cost || {});
    for (const [id, n] of entries) if (this.count(id) < n) return false;
    for (const [id, n] of entries) {
      let left = n;
      const stacks = this.game.entities
        .listKind('item')
        .filter((it) => it.defId === id)
        .sort((a, b) => Math.hypot(a.x - nearX, a.y - nearY) - Math.hypot(b.x - nearX, b.y - nearY));
      for (const it of stacks) {
        if (left <= 0) break;
        left -= this.take(it, left);
      }
    }
    return true;
  }

  /**
   * Ближайший доступный предмет по фильтру (не зарезервирован, не запрещён, достижим).
   * @param {(item, def) => boolean} filter
   */
  findNearest(pawn, filter, opts = {}) {
    const game = this.game;
    const cands = [];
    for (const it of game.entities.ofKind('item')) {
      if (it.forbidden && !opts.allowForbidden) continue;
      const def = this.def(it.defId);
      if (!def || !filter(it, def)) continue;
      if (game.jobs.isReserved(resKey.entity(it.id), pawn)) continue;
      const d = (it.x + 0.5 - pawn.x) ** 2 + (it.y + 0.5 - pawn.y) ** 2;
      if (opts.maxDist && d > opts.maxDist * opts.maxDist) continue;
      cands.push({ it, d });
    }
    cands.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(cands.length, 20); i++) {
      const it = cands[i].it;
      if (game.pathfinder.canReach(pawn.x, pawn.y, it.x, it.y, true)) return it;
    }
    return null;
  }
}

// ---------------- Зоны ----------------
export class ZoneManager {
  constructor(game) {
    this.game = game;
    this.zones = new Map();
    this.nextId = 1;
    this.cellZone = null;
  }

  _ensure() {
    const map = this.game.map;
    if (map && (!this.cellZone || this.cellZone.length !== map.n)) this.cellZone = new Int32Array(map.n);
  }

  /**
   * Создать зону. cells — массив [x, y] пар или индексов.
   * opts: {name, priority (1..4, выше — важнее), filter: {categories?: string[], items?: string[], deny?: string[]}}
   */
  create(type, cells = [], opts = {}) {
    this._ensure();
    const zt = this.game.defs.zoneTypes.require(type);
    const zone = {
      id: opts.id || this.nextId++,
      type,
      name: opts.name || '',
      color: opts.color || zt.color,
      priority: opts.priority ?? 2,
      filter: opts.filter || null,
      cells: [],
      data: opts.data || {},
    };
    this.nextId = Math.max(this.nextId, zone.id + 1);
    this.zones.set(zone.id, zone);
    this.addCells(zone, cells);
    return zone;
  }

  _toIdx(c) {
    const map = this.game.map;
    return Array.isArray(c) ? map.idx(c[0], c[1]) : c;
  }

  addCells(zone, cells) {
    this._ensure();
    for (const c of cells) {
      const i = this._toIdx(c);
      const prev = this.cellZone[i];
      if (prev === zone.id) continue;
      if (prev) this._removeIdx(this.zones.get(prev), i);
      this.cellZone[i] = zone.id;
      zone.cells.push(i);
    }
    this._changed(zone);
  }

  _removeIdx(zone, i) {
    if (!zone) return;
    const p = zone.cells.indexOf(i);
    if (p >= 0) zone.cells.splice(p, 1);
  }

  removeCells(cells) {
    this._ensure();
    const touched = new Set();
    for (const c of cells) {
      const i = this._toIdx(c);
      const z = this.zones.get(this.cellZone[i]);
      if (!z) continue;
      this._removeIdx(z, i);
      this.cellZone[i] = 0;
      touched.add(z);
    }
    for (const z of touched) {
      if (z.cells.length === 0) this.zones.delete(z.id);
      this._changed(z);
    }
  }

  remove(zone) {
    for (const i of zone.cells) this.cellZone[i] = 0;
    this.zones.delete(zone.id);
    this._changed(zone);
  }

  _changed(zone) {
    zone._version = (zone._version || 0) + 1;
    this.game.events.emit(EVENTS.ZONE_CHANGED, { zone });
  }

  zoneAt(x, y) {
    const map = this.game.map;
    if (!this.cellZone || !map?.inBounds(x, y)) return null;
    const id = this.cellZone[map.idx(x, y)];
    return id ? this.zones.get(id) : null;
  }

  isStorage(zone) {
    return !!this.game.defs.zoneTypes.get(zone.type)?.storage;
  }

  accepts(zone, defId) {
    const f = zone.filter;
    if (!f) return true;
    const def = this.game.defs.items.get(defId);
    if (!def) return false;
    if (f.deny?.includes(defId)) return false;
    if (f.items?.includes(defId)) return true;
    if (f.categories) return f.categories.includes(def.category);
    return !f.items;
  }

  /** Подходящая клетка склада для предмета (ближайшая к пешке, не зарезервирована, есть место). */
  findStorageCell(pawn, defId, fromX = pawn.x, fromY = pawn.y) {
    const game = this.game;
    const map = game.map;
    const zones = [...this.zones.values()].filter((z) => this.isStorage(z) && this.accepts(z, defId)).sort((a, b) => b.priority - a.priority);
    for (const z of zones) {
      let best = null;
      let bestD = Infinity;
      for (const i of z.cells) {
        const x = i % map.w;
        const y = (i - x) / map.w;
        if (game.jobs.isReserved(resKey.cell(x, y), pawn)) continue;
        if (game.items.roomAt(defId, x, y) <= 0) continue;
        const d = (x - fromX) ** 2 + (y - fromY) ** 2;
        // предпочитаем доложить в существующую стопку
        const it = game.items.itemAt(x, y);
        const dd = it ? d * 0.25 : d;
        if (dd < bestD) {
          bestD = dd;
          best = { x, y, zone: z };
        }
      }
      if (best && game.pathfinder.canReach(pawn.x, pawn.y, best.x, best.y)) return best;
    }
    return null;
  }

  clear() {
    this.zones.clear();
    this.cellZone = null;
    this.nextId = 1;
  }

  serialize() {
    return [...this.zones.values()].map((z) => ({ ...z, _version: undefined }));
  }

  deserialize(list) {
    this.clear();
    this._ensure();
    for (const z of list) {
      const zone = this.create(z.type, [], { id: z.id, name: z.name, color: z.color, priority: z.priority, filter: z.filter, data: z.data });
      this.addCells(zone, z.cells);
    }
  }
}

// ---------------- Переноска на склад ----------------
export function registerHaulJob(game) {
  game.jobs.registerJobType({
    id: 'haul',
    workType: 'hauling',
    labelKey: 'job.haul',
    findJob(game, pawn) {
      const items = game.items;
      const cands = [];
      for (const it of game.entities.ofKind('item')) {
        if (it.forbidden || items.isStored(it)) continue;
        if (game.defs.items.get(it.defId)?.haulable === false) continue;
        if (game.jobs.isReserved(resKey.entity(it.id), pawn)) continue;
        cands.push({ it, d: (it.x - pawn.x) ** 2 + (it.y - pawn.y) ** 2 });
      }
      if (!cands.length) return null;
      cands.sort((a, b) => a.d - b.d);
      for (let i = 0; i < Math.min(cands.length, 12); i++) {
        const it = cands[i].it;
        if (!game.pathfinder.canReach(pawn.x, pawn.y, it.x, it.y, true)) continue;
        const cell = game.zones.findStorageCell(pawn, it.defId, it.x, it.y);
        if (!cell) continue;
        const room = items.roomAt(it.defId, cell.x, cell.y);
        return { targetId: it.id, x: it.x, y: it.y, data: { dest: { x: cell.x, y: cell.y }, count: Math.min(room, it.count) } };
      }
      return null;
    },
    reserve(game, pawn, job) {
      return [resKey.entity(job.targetId), resKey.cell(job.data.dest.x, job.data.dest.y)];
    },
    makeToils(game, pawn, job) {
      const d = job.data.dest;
      return [
        { type: 'goto', targetId: job.targetId, adjacent: true },
        { type: 'pickup', targetId: job.targetId, count: job.data.count },
        { type: 'goto', x: d.x, y: d.y },
        { type: 'drop', x: d.x, y: d.y },
      ];
    },
  });
}
