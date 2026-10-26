// Ядро модуля build (MVP): индексы (чертежи по клеткам, двери), правила размещения, чертежи → готовые постройки,
// снос с возвратом части материалов, разрушение (рейды), двери (открыты, когда рядом пешка; закрытая — блокирует
// обзор и свет). Без DOM: всё здесь работает и в headless.
import { TILE_FLAG } from '../../core/constants.js';
import { TRAIN_ROOM_BASE, nearestPassable } from '../../sim/train.js';

export const OWNER = 'build';
/** События модуля. */
export const BEV = {
  PLACED: 'build:placed',
  COMPLETED: 'build:completed',
  DECONSTRUCTED: 'build:deconstructed',
  DESTROYED: 'build:destroyed',
  CANCELLED: 'build:cancelled',
  DELIVERED: 'build:delivered',
  FLOOR: 'build:floorCompleted',
  DOOR: 'build:doorChanged',
};
/** Доля материалов, возвращаемая при сносе и при разрушении. */
export const REFUND_DECONSTRUCT = 0.5;
export const REFUND_DESTROY = 0.25;
const DOOR_RADIUS = 1.25;
const DOOR_EVERY = 4; // тиков между проверками дверей
const MAX_POPS = 48;

export class Build {
  constructor(game) {
    this.game = game;
    this.rt = this.freshRuntime();
    /** UI-состояние (ui.js) — не сохраняется. */
    this.ui = null;
    this._buf = [];
  }

  freshRuntime() {
    return {
      mapRef: null,
      bp: null, // Int32Array: id чертежа постройки на клетке
      fbp: null, // Int32Array: id чертежа пола на клетке
      doors: new Set(),
      pops: [],
      totals: null,
      totalsTick: -1,
    };
  }

  reset() {
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

  dirty() {
    this.rt.mapRef = null;
  }

  rebuild() {
    const game = this.game;
    const map = game.map;
    const rt = this.rt;
    rt.mapRef = map;
    rt.bp = new Int32Array(map.n);
    rt.fbp = new Int32Array(map.n);
    rt.doors.clear();
    for (const e of game.entities.ofKind('blueprint')) this.gridSet(e, true);
    for (const b of game.entities.ofKind('building')) this.track(b, true);
  }

  gridSet(e, on) {
    const map = this.game.map;
    const grid = e.layer === 'floor' ? this.rt.fbp : this.rt.bp;
    if (!grid || !map) return;
    for (let j = 0; j < (e.h || 1); j++)
      for (let i = 0; i < (e.w || 1); i++) {
        const x = e.x + i;
        const y = e.y + j;
        if (!map.inBounds(x, y)) continue;
        const k = map.idx(x, y);
        if (on) grid[k] = e.id;
        else if (grid[k] === e.id) grid[k] = 0;
      }
  }

  track(b, add) {
    const def = this.game.defs.buildings.get(b.defId);
    if (!add) {
      this.rt.doors.delete(b.id);
      return;
    }
    if (def?.door && !b.train) {
      this.rt.doors.add(b.id);
      if (b.open) this.applyDoor(b, def);
    }
  }

  // ---------------- Помощники клеток ----------------
  inWagonK(k) {
    return this.game.map.room[k] >= TRAIN_ROOM_BASE;
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

  // ---------------- Размещение ----------------
  /**
   * Проверка размещения постройки. @returns {{ok, reason, chop: number[]|null, mine: number[]|null, rot}}
   * Причины: unknown, bounds, occupied, shell, blueprint, plant, terrain, rail, needWagon, needGround.
   * opts.noAuto — не предлагать вырубку/добычу (деревья и скалы мешают).
   */
  check(defId, x, y, rot = 0, opts = {}) {
    const game = this.game;
    const map = game.map;
    const res = { ok: false, reason: '', chop: null, mine: null, rot: 0 };
    const def = game.defs.buildings.get(defId);
    const fail = (r) => {
      res.reason = r;
      return res;
    };
    if (!def || !map || !this.ensure()) return fail('unknown');
    if (!Number.isFinite(x) || !Number.isFinite(y)) return fail('bounds');
    x = Math.floor(x);
    y = Math.floor(y);
    rot = def.rotatable ? (rot | 0) & 3 : 0;
    res.rot = rot;
    const [w, h] = game.entities.footprintSize(def, rot);
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
          if (bd?.natural && bd.mineable && !opts.noAuto && !bd.indestructible) {
            if (!(res.mine ||= []).includes(b.id)) res.mine.push(b.id);
          } else return fail(b?.train || bd?.category === 'train' ? 'shell' : 'occupied');
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
        if (!map.terrainDef(tx, ty).buildable && !map.floor[k]) return fail('terrain');
        const wag = this.inWagonK(k);
        if (this.isGangwayK(k)) return fail('shell');
        if ((map.flags[k] & TILE_FLAG.RAIL) && !wag) return fail('rail');
        if (def.placeableOn === 'wagon' && !wag) return fail('needWagon');
        if (def.placeableOn === 'ground' && wag) return fail('needGround');
      }
    res.ok = true;
    return res;
  }

  canPlace(defId, x, y, rot = 0, opts = {}) {
    return this.check(defId, x, y, rot, opts).ok;
  }

  costOf(def) {
    return { ...(def?.materials || {}) };
  }

  /**
   * Поставить постройку. opts.blueprint — чертёж (материалы принесут, построят поселенцы или лидер);
   * иначе сразу готовая (с проверкой canPlace; opts.force — без проверок, сносит растения/скалы/чертежи).
   * opts: {rot, blueprint, force}
   * @returns {object|null} чертёж (kind 'blueprint') или готовая постройка
   */
  place(defId, x, y, opts = {}) {
    const game = this.game;
    const def = game.defs.buildings.get(defId);
    if (!def || !game.map || !this.ensure()) return null;
    x = Math.floor(x);
    y = Math.floor(y);
    const rot = def.rotatable ? (opts.rot | 0) & 3 : 0;
    if (!opts.blueprint) {
      if (!opts.force && !this.check(defId, x, y, rot, { noAuto: true }).ok) return null;
      return this.spawnBuilt(def, x, y, { rot, cost: this.costOf(def), force: !!opts.force });
    }
    const chk = this.check(defId, x, y, rot);
    if (!chk.ok) return null;
    const [w, h] = game.entities.footprintSize(def, rot);
    const bp = game.entities.spawn('blueprint', {
      layer: 'building', buildDefId: defId, x, y, rot, w, h,
      cost: this.costOf(def), delivered: {}, work: 0, workTotal: Math.max(10, def.workToBuild ?? 100),
      faction: 'colony', placedTick: game.time.tick,
    });
    for (const id of chk.chop || []) {
      const p = game.entities.get(id);
      if (p) game.designations.add('chop', p.x, p.y);
    }
    for (const id of chk.mine || []) {
      const r = game.entities.get(id);
      if (r) game.designations.add('mine', r.x, r.y);
    }
    game.events.emit(BEV.PLACED, { entity: bp });
    return bp;
  }

  /** Проверка пола (только на земле). */
  checkFloor(floorId, x, y, opts = {}) {
    const game = this.game;
    const map = game.map;
    const res = { ok: false, reason: '', chop: null };
    const fail = (r) => Object.assign(res, { reason: r });
    if (!map || !this.ensure()) return fail('unknown');
    x = Math.floor(x);
    y = Math.floor(y);
    if (!map.inBounds(x, y)) return fail('bounds');
    const k = map.idx(x, y);
    if (this.rt.fbp[k]) return fail('blueprint');
    const fd = game.defs.floors.get(floorId);
    if (!fd || fd.index === 0) return fail('unknown');
    if (this.inWagonK(k) || this.isGangwayK(k) || map.roof[k] === 1) return fail('shell');
    if (map.floor[k] === fd.index) return fail('same');
    if (map.floor[k] && map.floorDef(x, y)?.train) return fail('shell');
    if (!map.terrainDef(x, y).buildable) return fail('terrain');
    if (map.flags[k] & TILE_FLAG.RAIL) return fail('rail');
    const b = map.buildingAt(x, y);
    if (b) {
      const bd = game.defs.buildings.get(b.defId);
      if (b.train || bd?.natural || (bd && !bd.passable)) return fail('occupied');
    }
    const pid = map.plant[k];
    if (pid) {
      const p = game.entities.get(pid);
      const pd = p && game.defs.plants.get(p.defId);
      if (pd?.blocksMove) {
        if (pd.choppable && !opts.noAuto) res.chop = [pid];
        else return fail('plant');
      }
    }
    res.ok = true;
    return res;
  }

  /** Чертёж пола; opts.force — положить сразу. */
  placeFloor(floorId, x, y, opts = {}) {
    const game = this.game;
    const map = game.map;
    if (!map || !this.ensure()) return null;
    x = Math.floor(x);
    y = Math.floor(y);
    const chk = this.checkFloor(floorId, x, y, { noAuto: !!opts.force });
    if (!chk.ok) return null;
    if (opts.force) {
      map.setFloor(x, y, floorId);
      return { x, y, floorId };
    }
    const fd = game.defs.floors.get(floorId);
    const bp = game.entities.spawn('blueprint', {
      layer: 'floor', floorId, x, y, w: 1, h: 1, cost: { ...(fd?.materials || {}) }, delivered: {}, work: 0,
      workTotal: Math.max(10, fd?.workToBuild ?? 60), faction: 'colony', placedTick: game.time.tick,
    });
    for (const id of chk.chop || []) {
      const p = game.entities.get(id);
      if (p) game.designations.add('chop', p.x, p.y);
    }
    game.events.emit(BEV.PLACED, { entity: bp });
    return bp;
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

  /** Что мешает начать стройку: 'plant' | 'rock' | 'shell' | 'bounds' | '' */
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
    const defId = c.defId;
    bp.delivered ||= {};
    bp.delivered[defId] = (bp.delivered[defId] || 0) + n;
    c.count -= n;
    if (c.count <= 0) pawn.carry = null;
    this.game.events.emit(BEV.DELIVERED, { blueprint: bp, pawn, defId, count: n });
    this.game.audio.play('drop', { x: bp.x + 0.5, y: bp.y + 0.5, vol: 0.5 });
    return true;
  }

  /** Отменить чертёж (принесённое возвращается целиком). */
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

  /** Достроить чертёж (работа завершена). */
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
    const e = this.spawnBuilt(def, x, y, { rot, cost: bp.cost, builtBy: pawn?.id || 0 });
    if (!e) return null;
    this.juice(e, def);
    game.events.emit(BEV.COMPLETED, { entity: e, pawn: pawn || null });
    return e;
  }

  completeFloor(bp, pawn) {
    const game = this.game;
    const { x, y, floorId } = bp;
    game.entities.remove(bp, 'built');
    const p = game.map.plantAt(x, y); // мелкие растения под полом убираются
    if (p && !game.defs.plants.get(p.defId)?.blocksMove) game.entities.remove(p, 'cleared');
    game.map.setFloor(x, y, floorId);
    this.pop(x, y, 1, 1, game.defs.floors.get(floorId)?.color || '#ffd27a');
    game.events.emit(BEV.FLOOR, { x, y, floorId, pawn: pawn || null });
    return true;
  }

  /** Создать готовую постройку. Убирает мелкие растения, рассыпает вещи из-под непроходимой, сдвигает пешек. */
  spawnBuilt(def, x, y, o = {}) {
    const game = this.game;
    const map = game.map;
    const rot = def.rotatable ? (o.rot | 0) & 3 : 0;
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
          if (b && game.defs.buildings.get(b.defId)?.natural) game.entities.remove(b, 'cleared');
          const bp = this.rt.bp?.[map.idx(tx, ty)];
          if (bp) this.cancel(game.entities.get(bp));
        }
      }
    const props = { defId: def.id, x, y, rot, faction: 'colony', builtTick: game.time.tick };
    if (o.cost) props.cost = { ...o.cost };
    if (o.builtBy) props.builtBy = o.builtBy;
    const e = game.entities.spawn('building', props);
    if (!def.passable) {
      if (!def.storage) this.displaceItems(x, y, w, h);
      this.nudgePawns(x, y, w, h);
    }
    if (def.storage) this.ensureStorageZone(e);
    return e;
  }

  /** Сундуку/стеллажу — склад на его клетках (если там ещё нет складской зоны). */
  ensureStorageZone(e) {
    const game = this.game;
    if (!game.defs.zoneTypes.has('stockpile')) return;
    const cells = [];
    for (let j = 0; j < (e.h || 1); j++)
      for (let i = 0; i < (e.w || 1); i++) {
        const z = game.zones.zoneAt(e.x + i, e.y + j);
        if (z && game.zones.isStorage(z)) continue;
        cells.push([e.x + i, e.y + j]);
      }
    if (!cells.length) return;
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
    const out = this._buf;
    out.length = 0;
    game.entities.queryRect(x, y, x + w - 1, y + h - 1, 'pawn', out);
    for (const p of out.slice()) {
      if (p.dead) continue;
      const spot = nearestPassable(map, Math.floor(p.x), Math.floor(p.y));
      if (!spot) continue;
      p.path = null;
      p.pathI = 0;
      game.entities.setPosition(p, spot.x + 0.5, spot.y + 0.5);
    }
  }

  /** Вспышка «готово» (рисует ui.js), пыль и звук. */
  pop(x, y, w, h, color) {
    this.rt.pops.push({ x, y, w, h, color, t0: -1 });
    if (this.rt.pops.length > MAX_POPS) this.rt.pops.shift();
  }

  juice(e, def) {
    const game = this.game;
    this.pop(e.x, e.y, e.w || 1, e.h || 1, def.color || '#ffd27a');
    if (game.isHeadless) return;
    const cx = e.x + (e.w || 1) / 2;
    const cy = e.y + (e.h || 1) / 2;
    game.fx.preset('dust', cx, cy, { count: 14, speed: 1.6 });
    game.audio.play('build_done', { x: cx, y: cy });
  }

  // ---------------- Снос, разрушение ----------------
  canDeconstruct(e) {
    if (!e || e.removed || e.kind !== 'building') return false;
    const def = this.game.defs.buildings.get(e.defId);
    if (!def || def.natural || def.indestructible || e.train || def.category === 'train') return false;
    return e.faction === 'colony' || def.buildable !== false;
  }

  /** Возврат материалов: доля f от стоимости (вниз). */
  refundOf(e, f) {
    const def = this.game.defs.buildings.get(e.defId);
    const cost = e.cost || this.costOf(def);
    const out = {};
    for (const [id, n] of Object.entries(cost)) {
      const k = Math.floor(n * f);
      if (k > 0) out[id] = k;
    }
    return out;
  }

  /** Разобрать сразу: вернуть половину материалов. */
  deconstructNow(e, pawn = null, opts = {}) {
    const game = this.game;
    if (!opts.force && !this.canDeconstruct(e)) return false;
    const { x, y } = e;
    const refund = this.refundOf(e, REFUND_DECONSTRUCT);
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

  /** Разрушение (прочность 0 — рейд, огонь): четверть материалов остаётся на месте. Зовёт combat. */
  destroy(e, opts = {}) {
    const game = this.game;
    if (!e || e.removed) return false;
    const def = game.defs.buildings.get(e.defId);
    const { x, y } = e;
    const refund = def && !def.natural ? this.refundOf(e, REFUND_DESTROY) : {};
    this.removeStorageZone(e);
    game.entities.remove(e, 'destroyed');
    for (const [id, n] of Object.entries(refund)) if (game.defs.items.has(id)) game.items.spawn(id, n, x, y);
    game.events.emit(BEV.DESTROYED, { entity: e, x, y, cause: opts.reason || opts.cause || 'damage', source: opts.source || null });
    if (!game.isHeadless) {
      const cx = x + (e.w || 1) / 2;
      const cy = y + (e.h || 1) / 2;
      game.fx.preset('dust', cx, cy, { count: 24, speed: 2.2 });
      game.fx.preset('chips', cx, cy, { count: 10, color: def?.color || '#c98a4b' });
      game.audio.play('build_collapse', { x: cx, y: cy });
    }
    return true;
  }

  maxHp(e, def = this.game.defs.buildings.get(e.defId)) {
    return Math.max(1, def?.hp ?? 100);
  }

  // ---------------- Двери ----------------
  /** Тик: дверь открыта, пока в ней или рядом пешка. */
  updateDoors(tick) {
    if (tick % DOOR_EVERY !== 0 || !this.ensure() || !this.rt.doors.size) return;
    const game = this.game;
    for (const id of this.rt.doors) {
      const e = game.entities.get(id);
      if (!e || e.removed) {
        this.rt.doors.delete(id);
        continue;
      }
      const out = this._buf;
      out.length = 0;
      game.entities.queryRadius(e.x + 0.5, e.y + 0.5, DOOR_RADIUS, 'pawn', (p) => !p.dead, out);
      const open = out.length > 0;
      if (open === !!e.open) continue;
      e.open = open;
      this.applyDoor(e);
      game.events.emit(BEV.DOOR, { entity: e, open });
    }
  }

  /** Привести слои обзора/света клетки двери к её состоянию (ядро считает дверь по def — закрытой). */
  applyDoor(e, def = this.game.defs.buildings.get(e.defId)) {
    const map = this.game.map;
    if (!map || !def || !map.inBounds(e.x, e.y)) return;
    const k = map.idx(e.x, e.y);
    if (map.building[k] !== e.id) return;
    map.blocksVision[k] = !e.open && def.blocksVision ? 1 : 0;
    map.blocksLight[k] = !e.open && def.blocksLight ? 1 : 0;
    map.version++;
  }

  /** После map:changed ядро пересчитало клетки — вернуть открытые двери в этой области. */
  reapplyDoors(x0, y0, w, h) {
    if (!this.rt.doors.size) return;
    for (const id of this.rt.doors) {
      const e = this.game.entities.get(id);
      if (!e?.open) continue;
      if (e.x >= x0 && e.y >= y0 && e.x < x0 + w && e.y < y0 + h) this.applyDoor(e);
    }
  }

  isDoorOpen(e) {
    return !!e?.open;
  }

  // ---------------- Разное ----------------
  displayName(e) {
    if (!e) return '';
    if (e.kind === 'blueprint') return this.t('build.tt.blueprint', { name: this.t(this.defOfBp(e)?.nameKey || '') });
    const def = this.game.defs.buildings.get(e.defId);
    return def ? this.t(def.nameKey) : String(e.defId);
  }

  /** Сумма вещей колонии (кэш на 30 тиков) — подсветка «по карману» в меню. */
  totals() {
    const tick = this.game.time.tick;
    if (!this.rt.totals || tick - this.rt.totalsTick > 30 || tick < this.rt.totalsTick) {
      this.rt.totals = this.game.items.totals();
      this.rt.totalsTick = tick;
    }
    return this.rt.totals;
  }
}
