// Ядро модуля build: состояние, индексы (чертежи по клеткам, источники тепла, двери, повреждённое),
// правила размещения, чертежи → готовые постройки, разборка, урон/разрушение, ремонт, качество.
// Без DOM: всё здесь работает и в headless.
import { EVENTS } from '../../core/events.js';
import { TILE_FLAG, TICKS_PER_HOUR } from '../../core/constants.js';
import { TRAIN_ROOM_BASE, nearestPassable } from '../../sim/train.js';
import { clamp, safeNum } from '../../core/math.js';

export const OWNER = 'build';
export const QUALITY = ['awful', 'poor', 'normal', 'good', 'excellent', 'masterwork'];
export const QUALITY_BEAUTY = [0.4, 0.7, 1, 1.3, 1.6, 2.2];
export const QUALITY_COMFORT = [0.75, 0.88, 1, 1.1, 1.2, 1.35];
/** События модуля (имена — контракт для других модулей, см. отчёт). */
export const BEV = {
  PLACED: 'build:placed',
  COMPLETED: 'build:completed',
  DECONSTRUCTED: 'build:deconstructed',
  DESTROYED: 'build:destroyed',
  DAMAGED: 'build:damaged',
  CANCELLED: 'build:cancelled',
  REPAIRED: 'build:repaired',
  DELIVERED: 'build:delivered',
  FLOOR: 'build:floorCompleted',
  DOOR: 'build:doorChanged',
  ROOMS: 'build:roomsChanged',
  ROOM: 'build:roomChanged',
  SAT: 'build:sat',
  STOOD: 'build:stood',
  PLAQUE: 'build:plaqueAssigned',
};
export const DIR4 = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W
const MAX_POPS = 48;

export class Build {
  constructor(game) {
    this.game = game;
    this.state = this.freshState();
    this.rt = this.freshRuntime();
    /** UI-состояние (ui.js) — не сохраняется. */
    this.ui = null;
    this._pawnBuf = [];
    this._entBuf = [];
  }

  freshState() {
    return { home: null, fallen: [] };
  }

  freshRuntime() {
    return {
      mapRef: null,
      bp: null, // Int32Array: id чертежа постройки на клетке
      fbp: null, // Int32Array: id чертежа пола на клетке
      heat: new Set(),
      doors: new Set(),
      damaged: new Set(),
      traps: new Set(),
      plaques: new Set(),
      roomsDirty: true,
      rooms: new Map(),
      roomList: [],
      statsVersion: 1,
      pops: [],
      maskKey: null,
      sit: null,
      plaquePending: false,
      lastRects: new Map(),
      trapCd: new Map(),
      totals: null,
      totalsTick: -1,
    };
  }

  /** Сброс мира (world:reset). Павшие (запасной список) переживают смену станции. */
  reset(reason) {
    const fallen = reason === 'station' ? this.state.fallen : [];
    this.state = this.freshState();
    this.state.fallen = fallen;
    this.rt = this.freshRuntime();
  }

  t(key, vars) {
    return this.game.t(key, vars);
  }

  // ---------------- Индексы ----------------
  /** Привести индексы к текущей карте (ленивая перестройка при смене карты/загрузке). */
  ensure() {
    const map = this.game.map;
    if (!map) return false;
    if (this.rt.mapRef !== map || !this.rt.bp || this.rt.bp.length !== map.n) this.rebuild();
    return true;
  }

  rebuild() {
    const game = this.game;
    const map = game.map;
    const rt = this.rt;
    rt.mapRef = map;
    rt.bp = new Int32Array(map.n);
    rt.fbp = new Int32Array(map.n);
    rt.heat.clear();
    rt.doors.clear();
    rt.damaged.clear();
    rt.traps.clear();
    rt.plaques.clear();
    for (const e of game.entities.ofKind('blueprint')) this.gridSet(e, true);
    for (const b of game.entities.ofKind('building')) this.track(b, true);
    rt.roomsDirty = true;
    rt.statsVersion++;
    if (this.state.home && this.state.home.length !== map.n) this.state.home = null;
  }

  gridSet(e, on, fromX = e.x, fromY = e.y) {
    const map = this.game.map;
    const grid = e.layer === 'floor' ? this.rt.fbp : this.rt.bp;
    if (!grid) return;
    const w = e.w || 1;
    const h = e.h || 1;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const x = fromX + i;
        const y = fromY + j;
        if (!map.inBounds(x, y)) continue;
        const k = map.idx(x, y);
        if (on) grid[k] = e.id;
        else if (grid[k] === e.id) grid[k] = 0;
      }
  }

  /** Классифицировать постройку по индексам (тепло, двери, повреждения...). */
  track(b, add) {
    const def = this.game.defs.buildings.get(b.defId);
    const rt = this.rt;
    if (!add) {
      rt.heat.delete(b.id);
      rt.doors.delete(b.id);
      rt.damaged.delete(b.id);
      rt.traps.delete(b.id);
      rt.plaques.delete(b.id);
      if (def && isRoomWall(def)) rt.roomsDirty = true;
      return;
    }
    if (!def) return;
    if (def.heat || b.heat) rt.heat.add(b.id);
    if (def.door) rt.doors.add(b.id);
    if (def.trap) rt.traps.add(b.id);
    if (def.plaque) rt.plaques.add(b.id);
    if (this.needsRepair(b, def)) rt.damaged.add(b.id);
    if (isRoomWall(def)) rt.roomsDirty = true;
  }

  // ---------------- Помощники клеток ----------------
  inWagonK(k) {
    return this.game.map.room[k] >= TRAIN_ROOM_BASE;
  }

  inWagon(x, y) {
    const map = this.game.map;
    return !!map && map.inBounds(x, y) && map.room[map.idx(x, y)] >= TRAIN_ROOM_BASE;
  }

  /** Переход между вагонами / прочая «обшивка» поезда без комнаты. */
  isGangwayK(k) {
    const map = this.game.map;
    return map.roof[k] === 1 && map.room[k] < TRAIN_ROOM_BASE;
  }

  blueprintAt(x, y, anyLayer = false) {
    const map = this.game.map;
    if (!this.ensure() || !map.inBounds(x, y)) return null;
    const k = map.idx(x, y);
    const id = this.rt.bp[k] || (anyLayer ? this.rt.fbp[k] : 0);
    return id ? this.game.entities.get(id) || null : null;
  }

  floorBlueprintAt(x, y) {
    const map = this.game.map;
    if (!this.ensure() || !map.inBounds(x, y)) return null;
    const id = this.rt.fbp[map.idx(x, y)];
    return id ? this.game.entities.get(id) || null : null;
  }

  pawnsIn(x0, y0, x1, y1) {
    const out = this._pawnBuf;
    out.length = 0;
    this.game.entities.queryRect(x0, y0, x1, y1, 'pawn', out);
    let n = 0;
    for (let i = 0; i < out.length; i++) if (!out[i].dead) out[n++] = out[i];
    out.length = n;
    return out;
  }

  nextToDoor(x, y) {
    const map = this.game.map;
    for (const [dx, dy] of DIR4) {
      const b = map.buildingAt(x + dx, y + dy);
      if (b && this.game.defs.buildings.get(b.defId)?.door) return true;
    }
    return false;
  }

  /** Сторона со стеной для настенной вещи (0 N, 1 E, 2 S, 3 W) или -1. pref — желаемая сторона. */
  findMount(x, y, pref = 0) {
    const map = this.game.map;
    let found = -1;
    for (let n = 0; n < 4; n++) {
      const d = (pref + n) & 3;
      const [dx, dy] = DIR4[d];
      const b = map.buildingAt(x + dx, y + dy);
      const bd = b && this.game.defs.buildings.get(b.defId);
      if (bd && !bd.passable && !bd.door && (isRoomWall(bd) || bd.connects === 'wall')) {
        found = d;
        break;
      }
    }
    return found;
  }

  /** Окно вагона рядом с прямоугольником: {dx, dy} направление или null. */
  windowNear(x, y, w = 1, h = 1) {
    const map = this.game.map;
    for (let yy = y - 1; yy <= y + h; yy++)
      for (let xx = x - 1; xx <= x + w; xx++) {
        if (xx >= x && xx < x + w && yy >= y && yy < y + h) continue;
        const b = map.buildingAt(xx, yy);
        if (b && this.game.defs.buildings.get(b.defId)?.window) return { dx: Math.sign(xx - x), dy: Math.sign(yy - y), id: b.id };
      }
    return null;
  }

  // ---------------- Размещение ----------------
  /**
   * Проверка размещения постройки. @returns {{ok, reason, chop: number[]|null, mine: number[]|null, mount, rot}}
   * Причины: unknown, bounds, occupied, shell, blueprint, plant, terrain, rail, needWagon, needGround, door, pawn, items,
   * needWall, needWindow.
   */
  check(defId, x, y, rot = 0, opts = {}) {
    const game = this.game;
    const map = game.map;
    const res = { ok: false, reason: '', chop: null, mine: null, mount: -1, rot: 0 };
    const def = game.defs.buildings.get(defId);
    if (!def || !map || !this.ensure()) {
      res.reason = 'unknown';
      return res;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      res.reason = 'bounds';
      return res;
    }
    x = Math.floor(x);
    y = Math.floor(y);
    rot = def.rotatable ? (rot | 0) & 3 : 0;
    res.rot = rot;
    const fail = (r) => {
      res.reason = r;
      return res;
    };
    const [w, h] = game.entities.footprintSize(def, rot);
    const impass = !def.passable;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const tx = x + i;
        const ty = y + j;
        if (!map.inBounds(tx, ty)) return fail('bounds');
        const k = map.idx(tx, ty);
        const bid = map.building[k];
        if (bid) {
          const b = game.entities.get(bid);
          const bd = b && game.defs.buildings.get(b.defId);
          if (bd?.natural && bd.mineable && !opts.noAuto && !bd.indestructible) (res.mine ||= []).includes(b.id) || res.mine.push(b.id);
          else return fail(b?.train || bd?.category === 'train' ? 'shell' : 'occupied');
        }
        if (this.rt.bp[k]) return fail('blueprint');
        const pid = map.plant[k];
        if (pid) {
          const p = game.entities.get(pid);
          const pd = p && game.defs.plants.get(p.defId);
          if (pd?.blocksMove) {
            if (pd.choppable && !opts.noAuto) (res.chop ||= []).push(pid);
            else return fail('plant');
          }
        }
        const td = map.terrainDef(tx, ty);
        if (!td.buildable && !map.floor[k]) return fail('terrain');
        const wag = this.inWagonK(k);
        if (this.isGangwayK(k)) return fail('shell');
        if ((map.flags[k] & TILE_FLAG.RAIL) && !wag) return fail('rail');
        if (def.placeableOn === 'wagon' && !wag) return fail('needWagon');
        if (def.placeableOn === 'ground' && wag) return fail('needGround');
        if (impass) {
          if (this.nextToDoor(tx, ty)) return fail('door');
          if (this.pawnsIn(tx, ty, tx, ty).length) return fail('pawn');
          if (!def.storage && game.items.itemAt(tx, ty)) return fail('items');
        }
      }
    if (def.wallMounted) {
      res.mount = this.findMount(x, y, rot);
      if (res.mount < 0 && def.wallMounted === true) return fail('needWall');
    }
    if (def.needsWindow && !this.windowNear(x, y, w, h)) return fail('needWindow');
    res.ok = true;
    return res;
  }

  canPlace(defId, x, y, rot = 0) {
    return this.check(defId, x, y, rot).ok;
  }

  /** Стоимость постройки по варианту материалов. */
  costOf(def, opt = 0) {
    const o = def?.materialOptions?.[opt | 0];
    return { ...(o || def?.materials || {}) };
  }

  stuffOf(def, opt = 0) {
    return def?.optionStuff?.[opt | 0] || def?.stuff || 'wood';
  }

  /**
   * Поставить постройку. По умолчанию — чертёж (материалы принесут, построят поселенцы или лидер).
   * opts: {rot, opt (вариант материалов), force (сразу готовая, без проверок), instant (сразу готовая, с проверкой),
   *        quality (0..5 для готовой), silent}
   * @returns {object|null} чертёж (kind 'blueprint') или готовая постройка
   */
  place(defId, x, y, opts = {}) {
    const game = this.game;
    const def = game.defs.buildings.get(defId);
    if (!def || !game.map || !this.ensure()) return null;
    x = Math.floor(x);
    y = Math.floor(y);
    let rot = def.rotatable ? (opts.rot | 0) & 3 : 0;
    const opt = def.materialOptions ? clamp(opts.opt | 0, 0, def.materialOptions.length - 1) : 0;
    let chk = null;
    if (!opts.force) {
      chk = this.check(defId, x, y, rot, { noAuto: !!opts.instant });
      if (!chk.ok) return null;
    }
    if (def.needsWindow) rot = this.autoRotWindow(def, x, y, rot);
    const mount = def.wallMounted ? (chk ? chk.mount : this.findMount(x, y, rot)) : -1;
    if (opts.force || opts.instant) {
      const q = def.quality ? clamp(Number.isFinite(opts.quality) ? opts.quality | 0 : 2, 0, 5) : undefined;
      return this.spawnBuilt(def, x, y, { rot, quality: q, cost: this.costOf(def, opt), stuff: this.stuffOf(def, opt), mount, opt, force: !!opts.force });
    }
    const [w, h] = game.entities.footprintSize(def, rot);
    const bp = game.entities.spawn('blueprint', {
      layer: 'building', buildDefId: defId, x, y, rot, w, h, opt,
      cost: this.costOf(def, opt), delivered: {}, work: 0, workTotal: Math.max(10, def.workToBuild ?? 100),
      faction: 'colony', stuff: this.stuffOf(def, opt), mount, placedTick: game.time.tick,
    });
    for (const id of chk?.chop || []) {
      const p = game.entities.get(id);
      if (p) game.designations.add('chop', p.x, p.y);
    }
    for (const id of chk?.mine || []) {
      const r = game.entities.get(id);
      if (r) game.designations.add('mine', r.x, r.y);
    }
    game.events.emit(BEV.PLACED, { entity: bp });
    return bp;
  }

  /** Лавка у окна смотрит на окно. */
  autoRotWindow(def, x, y, rot) {
    if (!def.rotatable) return rot;
    const wn = this.windowNear(x, y, 1, 1);
    if (!wn) return rot;
    // «перед» при rot 0 — юг; rot 1 — запад; 2 — север; 3 — восток
    if (wn.dy > 0 && !wn.dx) return 0;
    if (wn.dx < 0) return 1;
    if (wn.dy < 0) return 2;
    if (wn.dx > 0) return 3;
    return rot;
  }

  /** Проверка пола: floorId — что положить; null — снять пол. */
  checkFloor(floorId, x, y, opts = {}) {
    const game = this.game;
    const map = game.map;
    const res = { ok: false, reason: '', chop: null };
    if (!map || !this.ensure()) return Object.assign(res, { reason: 'unknown' });
    x = Math.floor(x);
    y = Math.floor(y);
    if (!map.inBounds(x, y)) return Object.assign(res, { reason: 'bounds' });
    const k = map.idx(x, y);
    if (this.rt.fbp[k]) return Object.assign(res, { reason: 'blueprint' });
    const b = map.buildingAt(x, y);
    if (b?.train) return Object.assign(res, { reason: 'shell' });
    const wag = this.inWagonK(k);
    if (this.isGangwayK(k)) return Object.assign(res, { reason: 'shell' });
    if (floorId === null) {
      const cur = map.floorDef(x, y);
      if (!cur) return Object.assign(res, { reason: 'noFloor' });
      if (cur.train) return Object.assign(res, { reason: 'shell' });
      res.ok = true;
      return res;
    }
    const fd = game.defs.floors.get(floorId);
    if (!fd || fd.index === 0) return Object.assign(res, { reason: 'unknown' });
    if (map.floor[k] === fd.index) return Object.assign(res, { reason: 'same' });
    const td = map.terrainDef(x, y);
    if (!td.buildable && !fd.bridge && !(map.floor[k] && map.floorDef(x, y)?.bridge)) return Object.assign(res, { reason: 'terrain' });
    if ((map.flags[k] & TILE_FLAG.RAIL) && !wag) return Object.assign(res, { reason: 'rail' });
    if (fd.placeableOn === 'wagon' && !wag) return Object.assign(res, { reason: 'needWagon' });
    if (fd.placeableOn === 'ground' && wag) return Object.assign(res, { reason: 'needGround' });
    if (b) {
      const bd = game.defs.buildings.get(b.defId);
      if (bd && !bd.passable && isRoomWall(bd)) return Object.assign(res, { reason: 'occupied' });
      if (bd?.natural) return Object.assign(res, { reason: 'occupied' });
    }
    const pid = map.plant[k];
    if (pid) {
      const p = game.entities.get(pid);
      const pd = p && game.defs.plants.get(p.defId);
      if (pd?.blocksMove) {
        if (pd.choppable && !opts.noAuto) res.chop = [pid];
        else return Object.assign(res, { reason: 'plant' });
      }
    }
    res.ok = true;
    return res;
  }

  /** Чертёж пола (floorId) или снятия пола (floorId === null). opts.force — сразу. */
  placeFloor(floorId, x, y, opts = {}) {
    const game = this.game;
    const map = game.map;
    if (!map || !this.ensure()) return null;
    x = Math.floor(x);
    y = Math.floor(y);
    const chk = opts.force ? { ok: true, chop: null } : this.checkFloor(floorId, x, y, opts);
    if (!chk.ok) return null;
    if (opts.force) {
      this.applyFloor(floorId, x, y);
      return { x, y, floorId };
    }
    const cur = map.floorDef(x, y);
    const fd = floorId ? game.defs.floors.get(floorId) : cur;
    const bp = game.entities.spawn('blueprint', {
      layer: 'floor', floorId: floorId || cur?.id || null, remove: floorId === null, x, y, w: 1, h: 1,
      cost: floorId ? { ...(fd?.materials || {}) } : {}, delivered: {}, work: 0,
      workTotal: Math.max(10, Math.round((fd?.workToBuild ?? 60) * (floorId ? 1 : 0.5))), faction: 'colony', placedTick: game.time.tick,
    });
    for (const id of chk.chop || []) {
      const p = game.entities.get(id);
      if (p) game.designations.add('chop', p.x, p.y);
    }
    game.events.emit(BEV.PLACED, { entity: bp });
    return bp;
  }

  /** Положить/снять пол (запоминая полы внутри вагонов — они переживают перестановку и переезд). */
  applyFloor(floorId, x, y) {
    const game = this.game;
    const map = game.map;
    const k = map.idx(x, y);
    const wag = this.inWagonK(k);
    const car = wag ? game.train?.carAt(x, y) : null;
    if (car?.rect) {
      const rec = ((car.data.build ||= {}).floors ||= []);
      const dx = x - car.rect.x;
      const dy = y - car.rect.y;
      const i = rec.findIndex((f) => f[0] === dx && f[1] === dy);
      if (i >= 0) rec.splice(i, 1);
      if (floorId) rec.push([dx, dy, floorId]);
      map.setFloor(x, y, floorId || 'wagon_planks');
    } else map.setFloor(x, y, floorId || null);
    this.rt.statsVersion++;
  }

  /** Поставить запомненные полы вагонов (после train:stamped). */
  applyWagonFloors() {
    const game = this.game;
    const train = game.train;
    const map = game.map;
    if (!train || !map) return;
    this.rt.lastRects.clear();
    map.batch(() => {
      for (const car of train.cars) {
        if (!car.rect) continue;
        this.rt.lastRects.set(car.id, { ...car.rect });
        for (const [dx, dy, fid] of car.data?.build?.floors || []) {
          const x = car.rect.x + dx;
          const y = car.rect.y + dy;
          if (!map.inBounds(x, y) || !game.defs.floors.has(fid)) continue;
          if (x <= car.rect.x || y <= car.rect.y || x >= car.rect.x + car.rect.w - 1 || y >= car.rect.y + car.rect.h - 1) continue;
          map.setFloor(x, y, fid);
        }
      }
    });
  }

  /** Снять наши полы со старых мест вагонов (train:unstamped на той же карте). */
  clearWagonFloors() {
    const game = this.game;
    const train = game.train;
    const map = game.map;
    if (!train || !map) return;
    map.batch(() => {
      for (const car of train.cars) {
        const r = this.rt.lastRects.get(car.id);
        if (!r) continue;
        for (const [dx, dy, fid] of car.data?.build?.floors || []) {
          const x = r.x + dx;
          const y = r.y + dy;
          if (map.inBounds(x, y) && map.floorDef(x, y)?.id === fid) map.setFloor(x, y, null);
        }
      }
    });
    this.rt.lastRects.clear();
  }

  // ---------------- Чертежи ----------------
  defOfBp(bp) {
    return bp.layer === 'floor' ? this.game.defs.floors.get(bp.floorId) : this.game.defs.buildings.get(bp.buildDefId);
  }

  /** Чего не хватает: [[defId, n], ...] или null (всё принесено). */
  needs(bp) {
    let out = null;
    for (const id in bp.cost || {}) {
      const n = (bp.cost[id] || 0) - (bp.delivered?.[id] || 0);
      if (n > 0) (out ||= []).push([id, n]);
    }
    return out;
  }

  hasMaterials(bp) {
    for (const id in bp.cost || {}) if ((bp.delivered?.[id] || 0) < bp.cost[id]) return false;
    return true;
  }

  /** Что мешает начать стройку: 'plant' | 'rock' | '' */
  blockedReason(bp) {
    const game = this.game;
    const map = game.map;
    for (let j = 0; j < (bp.h || 1); j++)
      for (let i = 0; i < (bp.w || 1); i++) {
        const x = bp.x + i;
        const y = bp.y + j;
        if (!map.inBounds(x, y)) return 'bounds';
        const k = map.idx(x, y);
        const pid = map.plant[k];
        if (pid) {
          const p = game.entities.get(pid);
          if (game.defs.plants.get(p?.defId)?.blocksMove) return 'plant';
        }
        if (bp.layer !== 'floor') {
          const b = map.buildingAt(x, y);
          if (b) return b.train ? 'shell' : 'rock';
        }
      }
    return '';
  }

  isReady(bp) {
    return bp.kind === 'blueprint' && !bp.removed && this.hasMaterials(bp) && !this.blockedReason(bp);
  }

  /** Отдать несомое в чертёж. @returns {boolean} */
  depositCarry(bp, pawn) {
    const c = pawn?.carry;
    if (!c || !bp || bp.removed) return false;
    const need = (bp.cost?.[c.defId] || 0) - (bp.delivered?.[c.defId] || 0);
    if (need <= 0) return false;
    const n = Math.min(need, c.count);
    bp.delivered ||= {};
    bp.delivered[c.defId] = (bp.delivered[c.defId] || 0) + n;
    c.count -= n;
    if (c.count <= 0) pawn.carry = null;
    this.game.events.emit(BEV.DELIVERED, { blueprint: bp, pawn, defId: c.defId, count: n });
    this.game.audio.play('drop', { x: bp.x + 0.5, y: bp.y + 0.5, vol: 0.5 });
    return true;
  }

  /** Отменить чертёж (вернуть принесённое целиком). */
  cancel(bp, opts = {}) {
    const game = this.game;
    if (!bp || bp.removed || bp.kind !== 'blueprint') return false;
    const { x, y } = bp;
    const refund = { ...(bp.delivered || {}) };
    game.entities.remove(bp, 'cancelled');
    if (!opts.noRefund) for (const [id, n] of Object.entries(refund)) if (n > 0 && game.defs.items.has(id)) game.items.spawn(id, n, x, y);
    game.events.emit(BEV.CANCELLED, { entity: bp, refund });
    return true;
  }

  /** Множитель скорости стройки (навык — только если mind сам не даёт skillFactor; «Отдохнувший» +10%). */
  workFactor(pawn) {
    const game = this.game;
    let f = 1;
    if (!game.providers?.mind?.skillFactor) {
      const lvl = safeNum(game.api.mind.skillLevel(pawn, 'construction'), 0, 20, 3);
      f *= 0.7 + 0.1 * lvl;
    }
    if (pawn?.rested && pawn.rested.untilTick > game.time.tick) f *= 1.1;
    return clamp(f, 0.3, 4);
  }

  /** Качество по навыку строителя (детерминированно через game.rng). */
  rollQuality(pawn) {
    const game = this.game;
    const lvl = pawn ? safeNum(game.api.mind.skillLevel(pawn, 'construction'), 0, 20, 3) : 3;
    const x = 1.6 + lvl * 0.15 + game.rng.normal(0, 0.7);
    return clamp(Math.round(x), 0, 5);
  }

  /** Достроить чертёж (шаг работы завершён). */
  finish(bp, pawn) {
    if (!bp || bp.removed) return false;
    if (bp.layer === 'floor') return this.completeFloor(bp, pawn);
    return !!this.complete(bp, pawn);
  }

  complete(bp, pawn) {
    const game = this.game;
    const def = game.defs.buildings.get(bp.buildDefId);
    if (!def) {
      game.entities.remove(bp, 'invalid');
      return null;
    }
    const { x, y, rot } = bp;
    game.entities.remove(bp, 'built');
    const q = def.quality ? this.rollQuality(pawn) : undefined;
    const e = this.spawnBuilt(def, x, y, { rot, quality: q, cost: bp.cost, builtBy: pawn?.id || 0, stuff: bp.stuff, mount: bp.mount, opt: bp.opt });
    if (!e) return null;
    this.juice(e, def);
    game.events.emit(BEV.COMPLETED, { entity: e, pawn: pawn || null });
    if (q >= 4 && pawn) {
      game.api.ui.notify(this.t('build.msg.quality', { name: pawn.name, what: this.t(def.nameKey), q: this.t(`build.q.${QUALITY[q]}`) }), { type: 'good', x: e.x, y: e.y, pawnId: pawn.id });
    }
    return e;
  }

  completeFloor(bp, pawn) {
    const game = this.game;
    const { x, y } = bp;
    const fid = bp.remove ? null : bp.floorId;
    const fd = bp.remove ? game.defs.floors.get(bp.floorId) : null;
    game.entities.remove(bp, 'built');
    // мелкие растения под полом убираются
    const p = game.map.plantAt(x, y);
    if (p && !game.defs.plants.get(p.defId)?.blocksMove) game.entities.remove(p, 'cleared');
    this.applyFloor(fid, x, y);
    if (fd && !fd.train) {
      for (const [id, n] of Object.entries(fd.materials || {})) {
        const k = Math.floor(n * 0.5);
        if (k > 0 && game.defs.items.has(id)) game.items.spawn(id, k, x, y);
      }
    }
    this.rt.pops.push({ x, y, w: 1, h: 1, color: fid ? game.defs.floors.get(fid)?.color || '#ffd27a' : '#ff5f6d', t0: -1, floor: true });
    if (this.rt.pops.length > MAX_POPS) this.rt.pops.shift();
    game.events.emit(BEV.FLOOR, { x, y, floorId: fid, pawn: pawn || null });
    return true;
  }

  /**
   * Создать готовую постройку (из чертежа или сразу). Убирает мелкие растения, рассыпает вещи из-под
   * непроходимой постройки, сдвигает пешек.
   */
  spawnBuilt(def, x, y, o = {}) {
    const game = this.game;
    const map = game.map;
    const rot = def.rotatable || def.wallMounted ? (o.rot | 0) & 3 : 0;
    const [w, h] = game.entities.footprintSize(def, rot);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const tx = x + i;
        const ty = y + j;
        if (!map.inBounds(tx, ty)) continue;
        const p = map.plantAt(tx, ty);
        if (p && (o.force || !game.defs.plants.get(p.defId)?.blocksMove)) game.entities.remove(p, 'cleared');
        if (o.force) {
          const b = map.buildingAt(tx, ty);
          const bd = b && game.defs.buildings.get(b.defId);
          if (bd?.natural) game.entities.remove(b, 'cleared');
        }
        const bp = this.rt.bp?.[map.idx(tx, ty)];
        if (bp && o.force) this.cancel(game.entities.get(bp));
      }
    const props = { defId: def.id, x, y, rot, faction: 'colony', builtTick: game.time.tick };
    if (o.quality !== undefined) props.quality = o.quality;
    if (o.cost) props.cost = { ...o.cost };
    if (o.builtBy) props.builtBy = o.builtBy;
    if (o.stuff && o.stuff !== def.stuff) props.stuff = o.stuff;
    if (o.mount >= 0) props.mount = o.mount;
    const e = game.entities.spawn('building', props);
    if (!def.passable) {
      if (!def.storage) this.displaceItems(x, y, w, h);
      this.nudgePawns(x, y, w, h);
    }
    this.afterBuilt(e, def);
    return e;
  }

  afterBuilt(e, def) {
    if (def.storage) this.ensureStorageZone(e);
    if (!this.inWagon(e.x, e.y)) this.markHome(e.x - 1, e.y - 1, e.x + (e.w || 1), e.y + (e.h || 1), true);
    if (def.plaque) this.rt.plaquePending = true;
    this.rt.statsVersion++;
  }

  /** Стеллажу/сундуку — склад на его клетках (если там ещё нет складской зоны). */
  ensureStorageZone(e) {
    const game = this.game;
    const cells = [];
    for (let j = 0; j < (e.h || 1); j++)
      for (let i = 0; i < (e.w || 1); i++) {
        const z = game.zones.zoneAt(e.x + i, e.y + j);
        if (z && game.zones.isStorage(z)) continue;
        cells.push([e.x + i, e.y + j]);
      }
    if (!cells.length || !game.defs.zoneTypes.has('stockpile')) return;
    const z = game.zones.create('stockpile', cells, { name: this.t(game.defs.buildings.get(e.defId)?.nameKey || 'build.zone.stockpile'), priority: 3, color: '#ffe08a', data: { shelfId: e.id } });
    e.zoneId = z.id;
  }

  removeStorageZone(e) {
    const game = this.game;
    if (!e.zoneId) return;
    const z = game.zones.zones.get(e.zoneId);
    if (z && z.data?.shelfId === e.id) game.zones.remove(z);
  }

  displaceItems(x, y, w, h) {
    const game = this.game;
    const list = [];
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) for (const it of game.entities.atTile(x + i, y + j, 'item')) list.push(it);
    for (const it of list) {
      const { defId, count, forbidden } = it;
      game.entities.remove(it, 'displaced');
      game.items.spawn(defId, count, it.x, it.y, { forbidden });
    }
  }

  nudgePawns(x, y, w, h) {
    const game = this.game;
    const map = game.map;
    for (const p of this.pawnsIn(x, y, x + w - 1, y + h - 1).slice()) {
      const spot = nearestPassable(map, Math.floor(p.x), Math.floor(p.y));
      if (!spot) continue;
      p.path = null;
      p.pathI = 0;
      game.entities.setPosition(p, spot.x + 0.5, spot.y + 0.5);
    }
  }

  /** «Чпок»: пыль, звук, поп-масштаб (рисует ui.js). */
  juice(e, def) {
    const game = this.game;
    const cx = e.x + (e.w || 1) / 2;
    const cy = e.y + (e.h || 1) / 2;
    this.rt.pops.push({ id: e.id, x: e.x, y: e.y, w: e.w || 1, h: e.h || 1, color: def.color || '#ffd27a', t0: -1 });
    if (this.rt.pops.length > MAX_POPS) this.rt.pops.shift();
    if (game.isHeadless) return;
    const fx = game.api.av?.effect;
    if (typeof fx === 'function') fx('dust', cx, cy, { count: 14 });
    else game.fx.preset('dust', cx, cy, { count: 14, speed: 1.6 });
    game.api.av.play('build_done', { x: cx, y: cy });
    if (def.heat) game.api.av.play(game.defs.sfx.has('woomph') ? 'woomph' : 'build_woomph', { x: cx, y: cy });
  }

  // ---------------- Разборка, урон, ремонт ----------------
  canDeconstruct(e) {
    if (!e || e.removed || e.kind !== 'building') return false;
    const def = this.game.defs.buildings.get(e.defId);
    if (!def || def.natural || def.indestructible || e.train || def.category === 'train') return false;
    return def.buildable !== false || !!def.rubble || !!def.lockedOf || e.faction === 'colony';
  }

  /** Разобрать сразу: вернуть 50–75% материалов (обломки — их запас). */
  deconstructNow(e, pawn = null, opts = {}) {
    const game = this.game;
    if (!opts.force && !this.canDeconstruct(e)) return false;
    const def = game.defs.buildings.get(e.defId);
    const cost = def?.rubble ? e.salvage || {} : e.cost || this.costOf(def, 0);
    const f = def?.rubble ? 1 : opts.full ? 1 : 0.5 + game.rng.next() * 0.25;
    const { x, y } = e;
    const refund = {};
    for (const [id, n] of Object.entries(cost)) {
      const k = Math.floor(n * f);
      if (k > 0) refund[id] = k;
    }
    this.removeStorageZone(e);
    game.entities.remove(e, 'deconstructed');
    for (const [id, n] of Object.entries(refund)) if (game.defs.items.has(id)) game.items.spawn(id, n, x, y);
    game.events.emit(BEV.DECONSTRUCTED, { entity: e, pawn, refund });
    if (!game.isHeadless) game.fx.preset('dust', x + (e.w || 1) / 2, y + (e.h || 1) / 2, { count: 10 });
    return true;
  }

  designateDeconstruct(e) {
    if (!this.canDeconstruct(e)) return false;
    return !!this.game.designations.add('deconstruct', e.x, e.y);
  }

  maxHp(e, def = this.game.defs.buildings.get(e.defId)) {
    return Math.max(1, def?.hp ?? 100);
  }

  needsRepair(e, def = this.game.defs.buildings.get(e.defId)) {
    if (!def || def.natural || def.rubble) return false;
    if (e.faded) return true;
    if (def.indestructible) return false;
    return (e.hp ?? def.hp ?? 100) < this.maxHp(e, def) - 0.5;
  }

  /** Стадия повреждений для отрисовки: 0 цела, 1 повреждена, 2 разбита. */
  damageStage(e, def) {
    const hp = e.hp ?? def?.hp ?? 100;
    const r = hp / this.maxHp(e, def);
    return r > 0.66 ? 0 : r > 0.33 ? 1 : 2;
  }

  /**
   * Урон постройке. opts: {source, type, cause}. При 0 — разрушение (обломки, часть материалов).
   * @returns {number} оставшаяся прочность (0 — разрушена)
   */
  damage(e, amount, opts = {}) {
    const game = this.game;
    if (!e || e.removed || e.kind !== 'building' || !(amount > 0)) return e?.hp ?? 0;
    const def = game.defs.buildings.get(e.defId);
    if (!def || def.indestructible) return e.hp ?? def?.hp ?? 0;
    const before = this.damageStage(e, def);
    e.hp = Math.max(0, (e.hp ?? def.hp ?? 100) - amount);
    this.rt.damaged.add(e.id);
    game.events.emit(BEV.DAMAGED, { entity: e, amount, source: opts.source || null });
    if (e.hp <= 0) {
      this.destroy(e, opts);
      return 0;
    }
    if (def.bake && this.damageStage(e, def) !== before) game.map.touch(e.x, e.y, e.w || 1, e.h || 1);
    return e.hp;
  }

  /** Разрушение: обломки на месте, 25% материалов вещами, ещё ~25% — в обломках. */
  destroy(e, opts = {}) {
    const game = this.game;
    if (!e || e.removed) return false;
    const def = game.defs.buildings.get(e.defId);
    const { x, y } = e;
    const w = e.w || 1;
    const h = e.h || 1;
    const cost = e.cost || this.costOf(def, 0);
    this.removeStorageZone(e);
    game.entities.remove(e, 'destroyed');
    if (def?.rubble) return true;
    const drop = {};
    const salvage = {};
    for (const [id, n] of Object.entries(cost)) {
      const a = Math.floor(n * 0.25);
      if (a > 0) drop[id] = a;
      const b = Math.floor(n * 0.25);
      if (b > 0) salvage[id] = b;
    }
    const rubbleCells = isRoomWall(def || {}) && w * h <= 4 ? w * h : 1;
    for (let c = 0; c < rubbleCells; c++) {
      const rx = x + (c % w);
      const ry = y + Math.floor(c / w);
      if (!game.map.inBounds(rx, ry) || game.map.buildingAt(rx, ry)) continue;
      game.entities.spawn('building', { defId: 'rubble', x: rx, y: ry, faction: 'colony', salvage: c === 0 ? salvage : {}, variant: (rx * 7 + ry * 13) & 7 });
    }
    for (const [id, n] of Object.entries(drop)) if (game.defs.items.has(id)) game.items.spawn(id, n, x, y);
    game.events.emit(BEV.DESTROYED, { entity: e, x, y, cause: opts.cause || opts.type || 'damage', source: opts.source || null });
    if (!game.isHeadless) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const fx = game.api.av?.effect;
      if (typeof fx === 'function') fx('dust', cx, cy, { count: 24 });
      else game.fx.preset('dust', cx, cy, { count: 24, speed: 2.2 });
      game.fx.preset('chips', cx, cy, { count: 10, color: def?.color || '#c98a4b' });
      game.api.av.shake(0.18);
      game.api.av.play('build_collapse', { x: cx, y: cy });
    }
    return true;
  }

  /** Ремонт завершён: полная прочность, «стёртость» снята. */
  repaired(e, pawn = null) {
    const game = this.game;
    if (!e || e.removed) return false;
    const def = game.defs.buildings.get(e.defId);
    const wasFaded = !!e.faded;
    e.hp = this.maxHp(e, def);
    if (e.faded) e.faded = false;
    this.applyFaded(e, def);
    this.rt.damaged.delete(e.id);
    if (def?.bake) game.map.touch(e.x, e.y, e.w || 1, e.h || 1);
    this.rt.statsVersion++;
    game.events.emit(BEV.REPAIRED, { entity: e, pawn, faded: wasFaded });
    return true;
  }

  /** Привести вид к флагу building.faded (ставит combat: Костяной дракон): серый вид, свет вполсилы. */
  applyFaded(e, def = this.game.defs.buildings.get(e.defId)) {
    e._fadedSeen = !!e.faded;
    if (!def) return;
    if (e.faded) {
      this.rt.damaged.add(e.id);
      if (def.light && (!e.light || e.lightByBuild)) {
        e.light = { ...def.light, intensity: (def.light.intensity ?? 1) * 0.5, color: '#a6adc2' };
        e.lightByBuild = true;
      }
    } else if (e.lightByBuild) {
      delete e.light;
      delete e.lightByBuild;
    }
    if (def.bake) this.game.map.touch(e.x, e.y, e.w || 1, e.h || 1);
    this.rt.statsVersion++;
  }

  /** Работа на ремонт (в единицах работы). */
  repairWork(e, def = this.game.defs.buildings.get(e.defId)) {
    const miss = 1 - (e.hp ?? def?.hp ?? 100) / this.maxHp(e, def);
    return Math.max(40, Math.round((def?.workToBuild ?? 100) * 0.6 * clamp(miss, 0, 1) + (e.faded ? 120 : 0)));
  }

  // ---------------- Свойства построек ----------------
  qualityOf(e) {
    return Number.isFinite(e?.quality) ? clamp(e.quality | 0, 0, 5) : 2;
  }

  beautyOf(e, def = this.game.defs.buildings.get(e.defId)) {
    if (!def) return 0;
    let b = def.beauty || 0;
    if (b > 0 && def.quality) b *= QUALITY_BEAUTY[this.qualityOf(e)];
    if (e.faded) b -= 2;
    const st = this.damageStage(e, def);
    if (st === 2) b -= 1;
    return b;
  }

  comfortOf(e, def = this.game.defs.buildings.get(e?.defId)) {
    if (!def || !def.comfort) return 0;
    let c = def.comfort * (def.quality ? QUALITY_COMFORT[this.qualityOf(e)] : 1);
    if (e.faded) c *= 0.5;
    return clamp(c, 0, 1.5);
  }

  /** Укрытие постройки на клетке (0..1) — для combat. */
  coverAt(x, y) {
    const map = this.game.map;
    if (!map?.inBounds(x, y)) return 0;
    const b = map.buildingAt(x, y);
    if (b) {
      const def = this.game.defs.buildings.get(b.defId);
      let c = def?.cover ?? (def && !def.passable ? (def.natural ? 0.75 : 0.5) : 0);
      if (b.faded) c *= 0.5;
      return clamp(c, 0, 1);
    }
    const p = map.plantAt(x, y);
    if (p && this.game.defs.plants.get(p.defId)?.blocksMove) return 0.4;
    return 0;
  }

  /** Лучшее укрытие цели от стрелка: клетка рядом с целью по направлению к стрелку. */
  coverFor(target, fromX, fromY) {
    if (!target) return 0;
    const tx = Math.floor(target.x);
    const ty = Math.floor(target.y);
    const dx = Math.sign(Math.round(fromX - target.x));
    const dy = Math.sign(Math.round(fromY - target.y));
    let best = this.coverAt(tx, ty) * 0.5;
    if (dx || dy) {
      best = Math.max(best, this.coverAt(tx + dx, ty + dy));
      if (dx && dy) best = Math.max(best, this.coverAt(tx + dx, ty) * 0.8, this.coverAt(tx, ty + dy) * 0.8);
    }
    return clamp(best, 0, 1);
  }

  /** Имя для подсказок: «???» у стёртых, иначе имя (+ качество). */
  displayName(e) {
    if (!e) return '';
    if (e.kind === 'blueprint') return this.t('build.tt.blueprint', { name: this.t(this.defOfBp(e)?.nameKey || '') });
    const def = this.game.defs.buildings.get(e.defId);
    if (e.faded) return '???';
    const name = def ? this.t(def.nameKey) : String(e.defId);
    return def?.quality ? `${name} (${this.t(`build.q.${QUALITY[this.qualityOf(e)]}`)})` : name;
  }

  // ---------------- Дом ----------------
  ensureHome() {
    const map = this.game.map;
    if (!map) return null;
    if (!this.state.home || this.state.home.length !== map.n) this.state.home = new Uint8Array(map.n);
    return this.state.home;
  }

  markHome(x0, y0, x1, y1, on) {
    const map = this.game.map;
    const h = this.ensureHome();
    if (!h) return 0;
    let n = 0;
    for (let y = Math.max(0, y0); y <= Math.min(map.h - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(map.w - 1, x1); x++) {
        const k = map.idx(x, y);
        const v = on ? 1 : 0;
        if (h[k] !== v) {
          h[k] = v;
          n++;
        }
      }
    return n;
  }

  isHome(x, y) {
    const map = this.game.map;
    const h = this.state.home;
    return !!h && !!map && map.inBounds(x, y) && h.length === map.n && h[map.idx(x, y)] === 1;
  }

  /** Сумма вещей колонии (кэш на 30 тиков) — для подсветки «по карману» в меню. */
  totals() {
    const tick = this.game.time.tick;
    if (!this.rt.totals || tick - this.rt.totalsTick > 30) {
      this.rt.totals = this.game.items.totals();
      this.rt.totalsTick = tick;
    }
    return this.rt.totals;
  }

  hoursToTicks(h) {
    return Math.round(h * TICKS_PER_HOUR);
  }
}

/** Ограничивает ли постройка комнату (стены, двери, частокол, скалы). */
export function isRoomWall(def) {
  if (!def) return false;
  if (def.roomWall || def.door) return true;
  if (def.connects === 'wall' && !def.passable) return true;
  if (def.natural && !def.passable) return true;
  return false;
}

export { EVENTS };
