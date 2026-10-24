// Поезд: локомотив + вагоны. Каждый вагон «штампуется» в карту как прямоугольный интерьер:
// пол, крыша, стены (с окнами), двери (боковые и торцевые), переходы-гармошки между вагонами,
// фикстуры (постройки поезда: мана-двигатель локомотива и т.п.).
//
// Состояние поезда — ПРОСТЫЕ ДАННЫЕ (JSON) в game.train: модули могут дописывать свои поля
// (train.fuel, train.engine, train.data.<модуль>, car.upgrades, car.data.<модуль>) — они сохраняются
// автоматически (кроме полей с префиксом '_'). Контракт — docs/ARCHITECTURE.md, раздел «Поезд».
//
// Перестройка состава: train.addCar/removeCar → train.restamp() (содержимое вагонов едет вместе с ними).
// Переезд на новую карту: game.changeStation(opts) (js/sim/station.js).
import { EVENTS } from '../core/events.js';

/**
 * Типы вагонов: game.defs.wagonTypes. Схема WagonTypeDef:
 * {id, nameKey, length (клеток, со стенами), color (неон стен), light (цвет ламп), locomotive?, stockpile?,
 *  fixtures?: [{defId, dx, dy, rot?, props?}] — постройки поезда относительно левого верхнего угла вагона}
 */
export const CORE_WAGON_TYPES = [
  {
    id: 'locomotive', nameKey: 'wagon.locomotive', length: 10, color: '#5ef2ff', light: '#9ff8ff', locomotive: true,
    fixtures: [{ defId: 'mana_engine', dx: 6, dy: 2 }],
  },
  { id: 'residential', nameKey: 'wagon.residential', length: 12, color: '#ffb86b', light: '#ffcf8a' },
  { id: 'kitchen', nameKey: 'wagon.kitchen', length: 12, color: '#ff7a5c', light: '#ffb08a' },
  { id: 'storage', nameKey: 'wagon.storage', length: 12, color: '#ffd27a', light: '#ffe6b0', stockpile: true },
  { id: 'workshop', nameKey: 'wagon.workshop', length: 12, color: '#8fa8ff', light: '#c6d2ff' },
  { id: 'greenhouse', nameKey: 'wagon.greenhouse', length: 12, color: '#7dff6a', light: '#d4ffb0' },
  { id: 'infirmary', nameKey: 'wagon.infirmary', length: 12, color: '#ff8fa3', light: '#ffd1da' },
  { id: 'battle', nameKey: 'wagon.battle', length: 12, color: '#ff4f4f', light: '#ff9a8a' },
  { id: 'hearse', nameKey: 'wagon.hearse', length: 10, color: '#b39ddb', light: '#d8ccff' },
];

/** Состав по умолчанию: с хвоста (запад) к голове (восток). */
export const DEFAULT_CONSIST = ['workshop', 'storage', 'kitchen', 'residential', 'locomotive'];
export const CAR_HEIGHT = 7; // включая стены → внутри 5 рядов
/** map.room вагона = TRAIN_ROOM_BASE + car.id (комнаты на земле — модуль build — используют id < TRAIN_ROOM_BASE). */
export const TRAIN_ROOM_BASE = 10000;

const WAGON_DEFAULTS = { length: 12, color: '#ffb86b', light: '#ffcf8a' };
const FALLBACK_WAGON = Object.freeze({ id: '?', nameKey: 'wagon.unknown', ...WAGON_DEFAULTS });
/** Поля Train, которые ядро сериализует особо (остальные собственные поля — как есть). */
const CORE_FIELDS = new Set(['cars']);

export function registerTrainDefs(game) {
  game.defs.create('wagonTypes', { defaults: WAGON_DEFAULTS });
  game.defs.wagonTypes.addAll(CORE_WAGON_TYPES);
}

/** Копия JSON-данных без полей с префиксом '_' (рекурсивно — только верхний уровень объекта). */
function plain(obj, skip) {
  const out = {};
  for (const k of Object.keys(obj)) {
    if (k[0] === '_' || skip?.has(k)) continue;
    out[k] = obj[k];
  }
  return JSON.parse(JSON.stringify(out));
}

export class Train {
  constructor(game, consist = DEFAULT_CONSIST) {
    Object.defineProperty(this, 'game', { value: game, enumerable: false, writable: true });
    /** @type {Array<{id:number, index:number, type:string, rect:{x,y,w,h}|null, roomId:number, fixtures:object[], data:object}>} */
    this.cars = [];
    this.nextCarId = 1;
    this.railY = 0;
    this.x0 = 0;
    this.stamped = false;
    /** Свободный мешок данных модулей: train.data.journey = {...}. Сохраняется. */
    this.data = {};
    this._lights = null;
    for (const type of consist) this.cars.push(this._newCar(type));
    this._reindex();
  }

  _newCar(type, data) {
    return { id: this.nextCarId++, index: 0, type, rect: null, roomId: 0, fixtures: [], data: data || {} };
  }

  _reindex() {
    this.cars.forEach((c, i) => (c.index = i));
  }

  /** Определение типа вагона (для неизвестного типа — запасное, чтобы не падать на старых сейвах). */
  carDef(car) {
    return this.game.defs.wagonTypes.get(car?.type) || FALLBACK_WAGON;
  }

  get length() {
    let n = 0;
    for (const c of this.cars) n += (this.carDef(c).length ?? 12) + 1;
    return Math.max(0, n - 1);
  }

  get locomotive() {
    return this.cars.find((c) => this.carDef(c).locomotive) || null;
  }

  carById(id) {
    return this.cars.find((c) => c.id === id) || null;
  }

  /**
   * Добавить вагон. По умолчанию — перед локомотивом. opts: {index?, position?: 'tail'|'head', data?, restamp?}.
   * Шлёт 'train:carAdded' {train, car}. Поезд на карте меняется только после restamp() (или opts.restamp = true).
   */
  addCar(type, opts = {}) {
    if (!this.game.defs.wagonTypes.has(type)) this.game.error(new Error(`[train] неизвестный тип вагона ${type}`), 'train.addCar');
    const car = this._newCar(type, opts.data);
    let at = opts.index;
    if (at === undefined) {
      if (opts.position === 'tail') at = 0;
      else if (opts.position === 'head') at = this.cars.length;
      else {
        const loco = this.cars.findIndex((c) => this.carDef(c).locomotive);
        at = loco >= 0 ? loco : this.cars.length;
      }
    }
    at = Math.max(0, Math.min(this.cars.length, at | 0));
    this.cars.splice(at, 0, car);
    this._reindex();
    this.game.events.emit(EVENTS.TRAIN_CAR_ADDED, { train: this, car });
    if (opts.restamp) this.restamp();
    return car;
  }

  /**
   * Отцепить вагон (объект вагона, его id или индекс). Шлёт 'train:carRemoved' {train, car}.
   * Содержимое отцепленного вагона остаётся лежать на карте; restamp() переложит остальные вагоны.
   * @returns {object|null} отцепленный вагон
   */
  removeCar(carOrIndex, opts = {}) {
    const car = typeof carOrIndex === 'object' ? carOrIndex : typeof carOrIndex === 'number' ? this.cars[carOrIndex] : null;
    const i = this.cars.indexOf(car);
    if (i < 0) return null;
    this.cars.splice(i, 1);
    this._reindex();
    if (car.rect) (this._detachedRects ||= []).push(car.rect);
    car.rect = null;
    this.game.events.emit(EVENTS.TRAIN_CAR_REMOVED, { train: this, car });
    if (opts.restamp) this.restamp();
    return car;
  }

  center() {
    if (!this.stamped) return null;
    return { x: this.x0 + this.length / 2, y: this.railY + 0.5 };
  }

  carAt(x, y) {
    for (const c of this.cars) {
      const r = c.rect;
      if (r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return c;
    }
    return null;
  }

  carOfType(type) {
    return this.cars.find((c) => c.type === type) || null;
  }

  /** Клетки интерьера вагона (без стен): массив {x, y}. */
  interior(car) {
    const r = car.rect;
    const out = [];
    if (!r) return out;
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) out.push({ x, y });
    return out;
  }

  /** Фикстуры вагона: def.fixtures типа + car.fixtures экземпляра (car.replaceFixtures = true — только свои). */
  fixturesOf(car) {
    const own = car.fixtures || [];
    if (car.replaceFixtures) return own;
    return [...(this.carDef(car).fixtures || []), ...own];
  }

  /**
   * Поставить поезд на карту: railY — ряд рельсов, x0 — левый край хвостового вагона (сдвигается, чтобы влезть).
   * Полоса под поезд расчищается: растения и постройки сносятся, предметы рассыпаются рядом, трупы и пешки
   * сдвигаются на ближайшую проходимую клетку. opts.zones — зоны из captureZones() для восстановления.
   */
  stamp(railY, x0, opts = {}) {
    const game = this.game;
    const map = game.map;
    if (!map) throw new Error('[train] stamp: нет карты');
    if (this.stamped) this.unstamp();
    const len = this.length;
    if (len + 2 > map.w || CAR_HEIGHT + 2 > map.h) throw new Error(`[train] поезд длиной ${len} не помещается на карту ${map.w}×${map.h}`);
    x0 = Math.max(1, Math.min(map.w - 1 - len, Math.floor(x0)));
    const top = Math.max(1, Math.min(map.h - 1 - CAR_HEIGHT, railY - Math.floor(CAR_HEIGHT / 2)));
    railY = top + Math.floor(CAR_HEIGHT / 2);
    this.railY = railY;
    this.x0 = x0;
    let x = x0;
    const displacedItems = [];
    const displaced = [];
    map.batch(() => {
      // расчистка полосы под поезд (+1 клетка)
      for (let yy = top - 1; yy <= top + CAR_HEIGHT; yy++)
        for (let xx = x0 - 1; xx <= x0 + len; xx++) {
          if (!map.inBounds(xx, yy)) continue;
          for (const e of game.entities.atTile(xx, yy)) {
            if (e.kind === 'pawn' || e.removed) continue;
            if (e.kind === 'item') {
              displacedItems.push({ defId: e.defId, count: e.count, x: e.x, y: e.y, forbidden: !!e.forbidden });
              game.entities.remove(e, 'train');
            } else if (e.kind === 'corpse') displaced.push(e);
            else if (e.kind !== 'decal') game.entities.remove(e, 'train');
          }
          const td = map.terrainDef(xx, yy);
          if (td.water || !td.buildable) map.setTerrain(xx, yy, 'dirt');
        }

      this.cars.forEach((car, ci) => {
        const def = this.carDef(car);
        const w = def.length;
        car.rect = { x, y: top, w, h: CAR_HEIGHT };
        car.roomId = TRAIN_ROOM_BASE + car.id;
        const isLoco = !!def.locomotive;
        const midX = x + Math.floor(w / 2);
        const wall = (tx, ty, defId) =>
          game.entities.spawn('building', { defId, x: tx, y: ty, train: true, carIndex: ci, carId: car.id, tint: def.color });
        for (let ty = top; ty < top + CAR_HEIGHT; ty++)
          for (let tx = x; tx < x + w; tx++) {
            const edgeX = tx === x || tx === x + w - 1;
            const edgeY = ty === top || ty === top + CAR_HEIGHT - 1;
            map.setFloor(tx, ty, 'wagon_planks');
            map.roof[map.idx(tx, ty)] = 1;
            map.room[map.idx(tx, ty)] = car.roomId;
            if (!edgeX && !edgeY) continue;
            const corner = edgeX && edgeY;
            let defId = 'wagon_wall';
            if (!corner) {
              if (edgeY && tx === midX) defId = 'wagon_door';
              else if (edgeX && ty === railY) {
                const front = tx === x + w - 1;
                defId = isLoco && front ? 'wagon_window' : 'wagon_door';
              } else if (edgeY && (tx - x) % 3 === 1 && Math.abs(tx - midX) > 1) defId = 'wagon_window';
              else if (isLoco && edgeX && tx === x + w - 1) defId = 'wagon_window';
            }
            wall(tx, ty, defId);
          }
        for (const f of this.fixturesOf(car)) {
          if (!game.defs.buildings.has(f.defId)) {
            game.error(new Error(`[train] фикстура ${f.defId} вагона ${car.type}: нет такой постройки`), 'train.stamp');
            continue;
          }
          game.entities.spawn('building', {
            ...(f.props || {}),
            defId: f.defId, x: x + (f.dx | 0), y: top + (f.dy | 0), rot: f.rot || 0,
            train: true, fixture: true, carIndex: ci, carId: car.id, tint: def.color,
          });
        }
        x += w;
        // переход между вагонами
        if (ci < this.cars.length - 1) {
          map.setFloor(x, railY, 'wagon_planks');
          map.roof[map.idx(x, railY)] = 1;
          map.room[map.idx(x, railY)] = 0;
          wall(x, railY - 1, 'wagon_wall').gangway = true;
          wall(x, railY + 1, 'wagon_wall').gangway = true;
          x += 1;
        }
      });
      map.touch(x0 - 1, top - 1, len + 2, CAR_HEIGHT + 2);
    });
    this.stamped = true;
    this._lights = null;
    // зоны: восстановить снятые (captureZones), затем склад по умолчанию для вагонов-складов без зоны
    if (opts.zones) this.restoreZones(opts.zones);
    const zones = game.zones;
    for (const car of this.cars) {
      if (!this.carDef(car).stockpile) continue;
      const has = [...zones.zones.values()].some((zz) => zz.data?.carId === car.id);
      if (has) continue;
      const cells = this.interior(car).map((c) => [c.x, c.y]);
      zones.create('stockpile', cells, { name: game.t('wagon.storage'), priority: 3, data: { carIndex: car.index, carId: car.id, train: true } });
    }
    // рассыпанное и сдвинутое
    for (const it of displacedItems) game.items.spawn(it.defId, it.count, it.x, it.y, { forbidden: it.forbidden });
    for (const e of displaced) {
      const spot = nearestPassable(map, e.x, e.y);
      if (spot && (spot.x !== e.x || spot.y !== e.y)) game.entities.setPosition(e, spot.x, spot.y);
    }
    this.nudgePawns();
    game.events.emit(EVENTS.TRAIN_STAMPED, { train: this });
  }

  /** Пешки, оказавшиеся в стене/непроходимой клетке, — на ближайшую проходимую. */
  nudgePawns() {
    const game = this.game;
    const map = game.map;
    if (!map) return;
    for (const p of game.entities.ofKind('pawn')) {
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.y);
      if (map.isPassable(tx, ty)) continue;
      const spot = nearestPassable(map, tx, ty);
      if (!spot) continue;
      p.path = null;
      p.pathI = 0;
      game.entities.setPosition(p, spot.x + 0.5, spot.y + 0.5);
    }
  }

  /** Снять поезд с карты (постройки поезда, пол, крыша, комнаты, зоны вагонов-складов). Пешки и предметы остаются. */
  unstamp() {
    const game = this.game;
    const map = game.map;
    if (!this.stamped || !map) return;
    const planks = game.defs.floors.get('wagon_planks').index;
    // габарит всех вагонов (и отцепленных после последнего stamp): там, где пол вагона, — снимаем пол/крышу/комнату
    const rects = [...this.cars.map((c) => c.rect), ...(this._detachedRects || [])].filter(Boolean);
    map.batch(() => {
      for (const b of game.entities.listKind('building')) if (b.train) game.entities.remove(b, 'train');
      if (!rects.length) return;
      const bx0 = Math.max(0, Math.min(...rects.map((r) => r.x)) - 1);
      const by0 = Math.max(0, Math.min(...rects.map((r) => r.y)));
      const bx1 = Math.min(map.w - 1, Math.max(...rects.map((r) => r.x + r.w)));
      const by1 = Math.min(map.h - 1, Math.max(...rects.map((r) => r.y + r.h - 1)));
      for (let y = by0; y <= by1; y++)
        for (let x = bx0; x <= bx1; x++) {
          const i = map.idx(x, y);
          if (map.floor[i] !== planks) continue;
          map.setFloor(x, y, null);
          map.roof[i] = 0;
          map.room[i] = 0;
        }
      map.touch(bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1);
    });
    for (const z of [...game.zones.zones.values()]) if (z.data?.train) game.zones.remove(z);
    for (const car of this.cars) car.rect = null;
    this._detachedRects = null;
    this.stamped = false;
    this._lights = null;
    game.events.emit(EVENTS.TRAIN_UNSTAMPED, { train: this });
  }

  /**
   * Что лежит/стоит в вагонах: [{entity, carId, dx, dy}] — позиция относительно угла вагона.
   * Постройки поезда (train: true) и снаряды не входят. filter(e) необязателен.
   */
  captureContents(filter = null) {
    const out = [];
    if (!this.stamped) return out;
    const game = this.game;
    for (const car of this.cars) {
      const r = car.rect;
      if (!r) continue;
      for (const e of game.entities.queryRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1)) {
        if ((e.kind === 'building' && e.train) || e.kind === 'projectile' || e.removed) continue;
        if (e.x < r.x || e.y < r.y || e.x >= r.x + r.w || e.y >= r.y + r.h) continue;
        if (filter && !filter(e)) continue;
        out.push({ entity: e, carId: car.id, dx: e.x - r.x, dy: e.y - r.y });
      }
    }
    return out;
  }

  /**
   * Снять с карты зоны, целиком лежащие внутри вагонов (склад вагона, грядки теплицы...), и вернуть их
   * в относительных координатах: [{carId, id, type, name, color, priority, filter, data, cells: [[dx, dy], ...]}].
   */
  captureZones() {
    const out = [];
    const game = this.game;
    const map = game.map;
    if (!this.stamped || !map) return out;
    for (const z of [...game.zones.zones.values()]) {
      if (!z.cells.length) continue;
      const x0 = z.cells[0] % map.w;
      const car = this.carAt(x0, (z.cells[0] - x0) / map.w);
      if (!car) continue;
      const r = car.rect;
      const rel = [];
      let inside = true;
      for (const i of z.cells) {
        const x = i % map.w;
        const y = (i - x) / map.w;
        if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) {
          inside = false;
          break;
        }
        rel.push([x - r.x, y - r.y]);
      }
      if (!inside) continue;
      out.push({ carId: car.id, id: z.id, type: z.type, name: z.name, color: z.color, priority: z.priority, filter: z.filter, data: z.data, cells: rel });
      game.zones.remove(z);
    }
    return JSON.parse(JSON.stringify(out));
  }

  /** Восстановить зоны из captureZones() по текущему положению вагонов. */
  restoreZones(list) {
    const game = this.game;
    for (const z of list || []) {
      const car = this.carById(z.carId);
      const r = car?.rect;
      if (!r || !game.defs.zoneTypes.has(z.type)) continue;
      const cells = z.cells.map(([dx, dy]) => [r.x + dx, r.y + dy]).filter(([x, y]) => game.map.inBounds(x, y));
      const id = game.zones.zones.has(z.id) ? undefined : z.id;
      const data = { ...(z.data || {}), carId: car.id };
      if (data.carIndex !== undefined) data.carIndex = car.index;
      game.zones.create(z.type, cells, { id, name: z.name, color: z.color, priority: z.priority, filter: z.filter, data });
    }
  }

  /**
   * Переложить поезд на той же карте после addCar/removeCar (или смены фикстур): содержимое вагонов
   * (мебель, предметы, трупы, пешки) и зоны внутри вагонов едут вместе со своими вагонами.
   * Задачи пешек отменяются (координаты устарели). @returns {boolean}
   */
  restamp() {
    const game = this.game;
    if (!game.map) return false;
    if (!this.stamped) {
      this.stamp(this.railY || game.map.railY, this.x0);
      return true;
    }
    for (const p of game.entities.ofKind('pawn')) {
      if (p.job) {
        p.job.keepCarry = true;
        game.jobs.endJob(p, 'cancelled');
      }
    }
    const contents = this.captureContents();
    const zones = this.captureZones();
    for (const c of contents) {
      c.fromX = c.entity.x;
      c.fromY = c.entity.y;
      game.entities.detach(c.entity);
    }
    this.unstamp();
    this.stamp(this.railY, this.x0, { zones });
    for (const c of contents) {
      const r = this.carById(c.carId)?.rect;
      const e = c.entity;
      if (r) {
        e.x = r.x + c.dx;
        e.y = r.y + c.dy;
      }
      game.entities.attach(e, { movedFrom: { x: c.fromX, y: c.fromY } });
    }
    this.nudgePawns();
    return true;
  }

  /**
   * Источники света поезда (лампы внутри, свет из окон наружу). Кэшируется.
   * Формат источника: {x, y, radius, color, intensity, flicker?}
   */
  lights() {
    if (this._lights) return this._lights;
    const out = [];
    const game = this.game;
    for (const car of this.cars) {
      const r = car.rect;
      if (!r) continue;
      const def = this.carDef(car);
      for (let x = r.x + 3; x < r.x + r.w - 2; x += 4) {
        out.push({ x: x + 0.5, y: this.railY + 0.5, radius: 3.6, color: def.light, intensity: 0.95, flicker: 0.04, carIndex: car.index });
      }
    }
    for (const b of game.entities.ofKind('building')) {
      if (!b.train || b.defId !== 'wagon_window') continue;
      const car = (b.carId && this.carById(b.carId)) || this.cars[b.carIndex];
      const r = car?.rect;
      if (!r) continue;
      const def = this.carDef(car);
      let ox = 0;
      let oy = 0;
      if (b.y === r.y) oy = -1.1;
      else if (b.y === r.y + r.h - 1) oy = 1.1;
      else if (b.x === r.x + r.w - 1) ox = 1.4;
      out.push({ x: b.x + 0.5 + ox, y: b.y + 0.5 + oy, radius: ox ? 3.2 : 1.9, color: def.light, intensity: 0.5, window: true });
    }
    this._lights = out;
    return out;
  }

  /** Сброс кэша света (после изменения вагонов модулем без restamp). */
  invalidateLights() {
    this._lights = null;
  }

  /** Все собственные поля, кроме game и '_'-полей (модульные поля сохраняются автоматически). */
  serialize() {
    const out = plain(this, CORE_FIELDS);
    out.cars = this.cars.map((c) => plain(c));
    return out;
  }

  static deserialize(game, d) {
    const t = new Train(game, []);
    for (const [k, v] of Object.entries(d || {})) {
      if (k === 'cars' || k[0] === '_') continue;
      t[k] = v;
    }
    t.data ||= {};
    t.cars = (d?.cars || []).map((c) => {
      const car = { ...c };
      car.rect ??= null;
      car.roomId ??= 0;
      car.fixtures ||= [];
      car.data ||= {};
      return car;
    });
    for (const c of t.cars) if (!c.id) c.id = t.nextCarId++;
    t.nextCarId = Math.max(t.nextCarId || 1, ...t.cars.map((c) => c.id + 1));
    t._reindex();
    return t;
  }
}

/** Ближайшая проходимая клетка к (x, y) по спирали (до r = 6). */
export function nearestPassable(map, x, y, maxR = 6) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (map.isPassable(x, y)) return { x, y };
  for (let r = 1; r <= maxR; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (map.isPassable(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
  return null;
}
