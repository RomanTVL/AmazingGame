// Поезд: локомотив + вагоны. Каждый вагон «штампуется» в карту как прямоугольный интерьер:
// пол, крыша, стены (с окнами), двери (боковые и торцевые), переходы-гармошки между вагонами.
// Поезд можно снять с карты (unstamp) и поставить на новую (stamp) — так модуль journey
// переносит колонию на следующую станцию.
import { EVENTS } from '../core/events.js';

/**
 * Типы вагонов: game.defs.wagonTypes. Схема:
 * {id, nameKey, length (клеток, со стенами), color (неон стен), light (цвет ламп), locomotive?, stockpile?}
 */
export const CORE_WAGON_TYPES = [
  { id: 'locomotive', nameKey: 'wagon.locomotive', length: 10, color: '#5ef2ff', light: '#9ff8ff', locomotive: true },
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

export function registerTrainDefs(game) {
  game.defs.create('wagonTypes', { defaults: { length: 12, color: '#ffb86b', light: '#ffcf8a' } });
  game.defs.wagonTypes.addAll(CORE_WAGON_TYPES);
}

export class Train {
  constructor(game, consist = DEFAULT_CONSIST) {
    this.game = game;
    this.cars = consist.map((type, index) => ({ index, type, rect: null, roomId: 0 }));
    this.railY = 0;
    this.x0 = 0;
    this.stamped = false;
    this._lights = null;
  }

  carDef(car) {
    return this.game.defs.wagonTypes.get(car.type);
  }

  get length() {
    let n = 0;
    for (const c of this.cars) n += (this.carDef(c)?.length ?? 12) + 1;
    return n - 1;
  }

  /** Добавить вагон (перед локомотивом). Требует restamp. */
  addCar(type) {
    const loco = this.cars.findIndex((c) => this.carDef(c)?.locomotive);
    const car = { index: 0, type, rect: null, roomId: 0 };
    if (loco >= 0) this.cars.splice(loco, 0, car);
    else this.cars.push(car);
    this.cars.forEach((c, i) => (c.index = i));
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

  /** Поставить поезд на карту: railY — ряд рельсов, x0 — левый край хвостового вагона. */
  stamp(railY, x0) {
    const game = this.game;
    const map = game.map;
    if (this.stamped) this.unstamp();
    this.railY = railY;
    this.x0 = x0;
    const top = railY - Math.floor(CAR_HEIGHT / 2);
    let x = x0;
    // расчистка полосы под поезд (+1 клетка)
    map.batch(() => {
      const len = this.length;
      for (let yy = top - 1; yy <= top + CAR_HEIGHT; yy++)
        for (let xx = x0 - 1; xx <= x0 + len; xx++) {
          if (!map.inBounds(xx, yy)) continue;
          for (const e of game.entities.atTile(xx, yy)) {
            if (e.kind === 'pawn') continue;
            if (e.kind === 'building' && e.train) continue;
            game.entities.remove(e, 'train');
          }
          const td = map.terrainDef(xx, yy);
          if (td.water || !td.buildable) map.setTerrain(xx, yy, 'dirt');
        }

      this.cars.forEach((car, ci) => {
        const def = this.carDef(car);
        const w = def.length;
        car.rect = { x, y: top, w, h: CAR_HEIGHT };
        car.roomId = 100 + ci;
        const isLoco = !!def.locomotive;
        const midX = x + Math.floor(w / 2);
        const wall = (tx, ty, defId) =>
          game.entities.spawn('building', { defId, x: tx, y: ty, train: true, carIndex: ci, tint: def.color });
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
        if (isLoco) {
          game.entities.spawn('building', { defId: 'mana_engine', x: x + w - 4, y: railY - 1, train: true, carIndex: ci, tint: def.color });
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
    });
    this.stamped = true;
    this._lights = null;
    // склад
    const zones = game.zones;
    for (const car of this.cars) {
      if (!this.carDef(car)?.stockpile) continue;
      const cells = this.interior(car).map((c) => [c.x, c.y]);
      const z = [...zones.zones.values()].find((zz) => zz.data?.carIndex === car.index);
      if (!z) zones.create('stockpile', cells, { name: game.t('wagon.storage'), priority: 3, data: { carIndex: car.index, train: true } });
    }
    game.events.emit(EVENTS.TRAIN_STAMPED, { train: this });
  }

  /** Снять поезд с карты (постройки поезда, пол, крыша, зоны вагонов). Пешки и предметы остаются. */
  unstamp() {
    const game = this.game;
    const map = game.map;
    if (!this.stamped || !map) return;
    map.batch(() => {
      for (const b of game.entities.listKind('building')) if (b.train) game.entities.remove(b, 'train');
      for (const car of this.cars) {
        const r = car.rect;
        if (!r) continue;
        for (let y = r.y; y < r.y + r.h; y++)
          for (let x = r.x - 1; x <= r.x + r.w; x++) {
            if (!map.inBounds(x, y)) continue;
            const i = map.idx(x, y);
            if (map.floor[i] === game.defs.floors.get('wagon_planks').index) map.setFloor(x, y, null);
            map.roof[i] = 0;
            map.room[i] = 0;
          }
      }
    });
    for (const z of [...game.zones.zones.values()]) if (z.data?.train) game.zones.remove(z);
    this.stamped = false;
    this._lights = null;
    game.events.emit(EVENTS.TRAIN_UNSTAMPED, { train: this });
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
      const car = this.cars[b.carIndex];
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

  serialize() {
    return { cars: this.cars.map((c) => ({ type: c.type, rect: c.rect, roomId: c.roomId })), railY: this.railY, x0: this.x0, stamped: this.stamped };
  }

  static deserialize(game, d) {
    const t = new Train(game, d.cars.map((c) => c.type));
    d.cars.forEach((c, i) => {
      t.cars[i].rect = c.rect;
      t.cars[i].roomId = c.roomId;
    });
    t.railY = d.railY;
    t.x0 = d.x0;
    t.stamped = d.stamped;
    return t;
  }
}
