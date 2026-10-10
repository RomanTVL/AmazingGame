// Карта стоянки: сетка клеток со слоями (типизированные массивы).
// Каждая клетка: terrain, floor, flags (рельсы), roof, room, building (id), plant (id),
// а также производные: cost (0 = непроходимо), blocksVision, blocksLight.
// Предметы на клетке ищутся через game.entities.atTile(x, y, 'item').
import { EVENTS } from '../core/events.js';
import { CHUNK } from '../core/constants.js';
import { rleEncode, rleDecode } from '../core/save.js';

/** Базовые типы ландшафта. cost — множитель времени шага (0 = непроходимо). */
export const CORE_TERRAIN = [
  { id: 'grass', nameKey: 'terrain.grass', cost: 1, buildable: true, fertile: 1 },
  { id: 'dirt', nameKey: 'terrain.dirt', cost: 1, buildable: true, fertile: 0.7 },
  { id: 'stone', nameKey: 'terrain.stone', cost: 1.05, buildable: true, fertile: 0 },
  { id: 'water', nameKey: 'terrain.water', cost: 0, buildable: false, water: true, fertile: 0 },
  { id: 'sand', nameKey: 'terrain.sand', cost: 1.25, buildable: true, fertile: 0.2 },
  { id: 'snow', nameKey: 'terrain.snow', cost: 1.4, buildable: true, fertile: 0 },
  { id: 'ash', nameKey: 'terrain.ash', cost: 1.1, buildable: true, fertile: 0.1 },
];

/** Полы. Индекс 0 зарезервирован под «нет пола». cost < 1 — быстрее ходить. */
export const CORE_FLOORS = [
  { id: 'none', nameKey: 'floor.none', cost: 1 },
  { id: 'wagon_planks', nameKey: 'floor.wagon_planks', cost: 0.85, train: true },
  { id: 'wood_floor', nameKey: 'floor.wood_floor', cost: 0.9, materials: { wood: 2 }, workToBuild: 60 },
  { id: 'stone_tiles', nameKey: 'floor.stone_tiles', cost: 0.9, materials: { stone: 2 }, workToBuild: 90 },
];

export function registerMapDefs(game) {
  const terrain = game.defs.create('terrain', { indexed: true });
  const floors = game.defs.create('floors', { indexed: true });
  terrain.addAll(CORE_TERRAIN);
  floors.addAll(CORE_FLOORS);
}

export class TileMap {
  constructor(game, w, h, biome = 'forest') {
    this.game = game;
    this.w = w;
    this.h = h;
    this.biome = biome;
    const n = w * h;
    this.n = n;
    this.terrain = new Uint8Array(n);
    this.floor = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.roof = new Uint8Array(n);
    this.room = new Int32Array(n);
    this.building = new Int32Array(n);
    this.plant = new Int32Array(n);
    this.cost = new Float32Array(n);
    this.blocksVision = new Uint8Array(n);
    this.blocksLight = new Uint8Array(n);
    /** Растёт при любом изменении проходимости/структуры. Кэши сверяются с ним. */
    this.version = 0;
    this._batch = 0;
    this._batchRect = null;
    this.railY = -1;
    const grass = game.defs.terrain.get('grass')?.index ?? 0;
    this.terrain.fill(grass);
    for (let i = 0; i < n; i++) this._recompute(i);
  }

  idx(x, y) {
    return y * this.w + x;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  terrainDef(x, y) {
    return this.game.defs.terrain.byIndex(this.terrain[this.idx(x, y)]);
  }

  floorDef(x, y) {
    const f = this.floor[this.idx(x, y)];
    return f ? this.game.defs.floors.byIndex(f) : null;
  }

  setTerrain(x, y, id) {
    const i = this.idx(x, y);
    this.terrain[i] = this.game.defs.terrain.require(id).index;
    this.refresh(x, y);
  }

  setFloor(x, y, id) {
    const i = this.idx(x, y);
    this.floor[i] = id ? this.game.defs.floors.require(id).index : 0;
    this.refresh(x, y);
  }

  setRoof(x, y, v) {
    this.roof[this.idx(x, y)] = v;
    this.touch(x, y);
  }

  setRoom(x, y, roomId) {
    this.room[this.idx(x, y)] = roomId;
  }

  hasFlag(x, y, f) {
    return (this.flags[this.idx(x, y)] & f) !== 0;
  }

  setFlag(x, y, f, on = true) {
    const i = this.idx(x, y);
    if (on) this.flags[i] |= f;
    else this.flags[i] &= ~f;
    this.touch(x, y);
  }

  /** Пересчитать производные слои клетки и отметить изменение. */
  refresh(x, y) {
    this._recompute(this.idx(x, y));
    this.touch(x, y);
  }

  _recompute(i) {
    const defs = this.game.defs;
    const terr = defs.terrain.byIndex(this.terrain[i]);
    let c = terr ? terr.cost : 1;
    const f = this.floor[i];
    if (f) {
      const fd = defs.floors.byIndex(f);
      if (fd && (c > 0 || fd.bridge)) c = fd.cost ?? 1;
    }
    let bv = 0;
    let bl = 0;
    const bid = this.building[i];
    if (bid) {
      const b = this.game.entities.get(bid);
      const bd = b && defs.buildings.get(b.defId);
      if (bd) {
        if (!bd.passable) c = 0;
        else if (c > 0) c = Math.max(c, bd.pathCost ?? c);
        if (bd.blocksVision) bv = 1;
        if (bd.blocksLight) bl = 1;
      }
    }
    const pid = this.plant[i];
    if (pid) {
      const p = this.game.entities.get(pid);
      const pd = p && defs.plants.get(p.defId);
      if (pd) {
        if (pd.blocksMove) c = 0;
        else if (c > 0) c *= pd.pathCost ?? 1;
        if (pd.blocksVision) bv = 1;
      }
    }
    this.cost[i] = c;
    this.blocksVision[i] = bv;
    this.blocksLight[i] = bl;
  }

  /** Отметить изменение области (версия, грязные чанки отрисовки, событие map:changed). */
  touch(x, y, w = 1, h = 1) {
    this.version++;
    if (this._batch > 0) {
      const r = this._batchRect;
      if (!r) this._batchRect = { x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 };
      else {
        r.x0 = Math.min(r.x0, x);
        r.y0 = Math.min(r.y0, y);
        r.x1 = Math.max(r.x1, x + w - 1);
        r.y1 = Math.max(r.y1, y + h - 1);
      }
      return;
    }
    this.game.events.emit(EVENTS.MAP_CHANGED, { x, y, w, h });
  }

  /** Сгруппировать много изменений в одно событие map:changed. */
  batch(fn) {
    this._batch++;
    try {
      fn();
    } finally {
      this._batch--;
      if (this._batch === 0 && this._batchRect) {
        const r = this._batchRect;
        this._batchRect = null;
        this.game.events.emit(EVENTS.MAP_CHANGED, { x: r.x0, y: r.y0, w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1 });
      }
    }
  }

  /** Полный пересчёт производных слоёв (после загрузки). */
  recomputeAll() {
    for (let i = 0; i < this.n; i++) this._recompute(i);
    this.touch(0, 0, this.w, this.h);
  }

  isPassable(x, y) {
    return this.inBounds(x, y) && this.cost[this.idx(x, y)] > 0;
  }

  costAt(x, y) {
    return this.inBounds(x, y) ? this.cost[this.idx(x, y)] : 0;
  }

  isRoofed(x, y) {
    return this.inBounds(x, y) && this.roof[this.idx(x, y)] > 0;
  }

  roomAt(x, y) {
    return this.inBounds(x, y) ? this.room[this.idx(x, y)] : 0;
  }

  buildingAt(x, y) {
    if (!this.inBounds(x, y)) return null;
    const id = this.building[this.idx(x, y)];
    return id ? this.game.entities.get(id) : null;
  }

  plantAt(x, y) {
    if (!this.inBounds(x, y)) return null;
    const id = this.plant[this.idx(x, y)];
    return id ? this.game.entities.get(id) : null;
  }

  chunkOf(x, y) {
    return { cx: Math.floor(x / CHUNK), cy: Math.floor(y / CHUNK) };
  }

  /** Случайная проходимая клетка в радиусе r (детерминированно через rng). */
  randomPassableNear(rng, x, y, r, tries = 24, pred = null) {
    for (let k = 0; k < tries; k++) {
      const tx = Math.round(x + rng.range(-r, r));
      const ty = Math.round(y + rng.range(-r, r));
      if (this.isPassable(tx, ty) && (!pred || pred(tx, ty))) return { x: tx, y: ty };
    }
    return null;
  }

  serialize() {
    const ids = (reg, arr) => ({ palette: reg.byIndexList.map((d) => d?.id ?? null), rle: rleEncode(arr) });
    return {
      w: this.w,
      h: this.h,
      biome: this.biome,
      railY: this.railY,
      terrain: ids(this.game.defs.terrain, this.terrain),
      floor: ids(this.game.defs.floors, this.floor),
      flags: rleEncode(this.flags),
      roof: rleEncode(this.roof),
      room: rleEncode(this.room),
    };
  }

  /** Восстановить слои. Палитра id → индекс переводится через реестры (устойчиво к новым defs). */
  static deserialize(game, d) {
    const map = new TileMap(game, d.w, d.h, d.biome);
    map.railY = d.railY;
    const remap = (reg, packed, target) => {
      const tmp = rleDecode(packed.rle, new Int32Array(target.length));
      // палитра: позиция = индекс на момент сохранения → id → текущий индекс
      const table = packed.palette.map((id) => reg.get(id)?.index ?? 0);
      for (let i = 0; i < target.length; i++) target[i] = table[tmp[i]] ?? 0;
    };
    remap(game.defs.terrain, d.terrain, map.terrain);
    remap(game.defs.floors, d.floor, map.floor);
    rleDecode(d.flags, map.flags);
    rleDecode(d.roof, map.roof);
    rleDecode(d.room, map.room);
    return map;
  }
}
