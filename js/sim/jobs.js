// Система работ (как в RimWorld):
//  - workTypes   — типы работ (столбцы таблицы приоритетов): game.defs.workTypes
//  - jobTypes    — виды задач; каждая знает, как найти цели и из каких «шагов» (toils) состоит
//  - toils       — элементарные шаги: goto, wait, work, pickup, drop, interact (+ модули добавляют свои)
//  - designations — пометки игрока (рубить, добывать, собрать...) → источник целей для jobTypes
//  - reservations — чтобы двое не делали одно и то же
// Задачи (job) — runtime-объекты, НЕ сохраняются: после загрузки пешки найдут работу заново.
import { EVENTS } from '../core/events.js';
import { moveTo, stopMoving, pathDone } from './pawn.js';
import { chebyshev, safeNum } from '../core/math.js';

export const CORE_WORK_TYPES = [
  { id: 'doctoring', order: 10, nameKey: 'work.doctoring', skill: 'medicine', defaultPriority: 2 },
  { id: 'construction', order: 20, nameKey: 'work.construction', skill: 'construction', defaultPriority: 3 },
  { id: 'mining', order: 30, nameKey: 'work.mining', skill: 'mining', defaultPriority: 3 },
  { id: 'cutting', order: 40, nameKey: 'work.cutting', skill: 'plants', defaultPriority: 3 },
  { id: 'growing', order: 50, nameKey: 'work.growing', skill: 'plants', defaultPriority: 3 },
  { id: 'cooking', order: 60, nameKey: 'work.cooking', skill: 'cooking', defaultPriority: 3 },
  { id: 'hunting', order: 70, nameKey: 'work.hunting', skill: 'shooting', defaultPriority: 3 },
  { id: 'crafting', order: 80, nameKey: 'work.crafting', skill: 'crafting', defaultPriority: 3 },
  { id: 'hauling', order: 90, nameKey: 'work.hauling', skill: null, defaultPriority: 3 },
  { id: 'cleaning', order: 100, nameKey: 'work.cleaning', skill: null, defaultPriority: 4 },
  { id: 'research', order: 110, nameKey: 'work.research', skill: 'intellect', defaultPriority: 4 },
];

/** Ключи резервирования. */
export const resKey = {
  entity: (id) => `e${id}`,
  cell: (x, y) => `c${x},${y}`,
};

export class JobManager {
  constructor(game) {
    this.game = game;
    /** key → pawnId */
    this.reservations = new Map();
    this.nextJobId = 1;
    this._byWorkType = null;
  }

  registerDefs() {
    const defs = this.game.defs;
    defs.create('workTypes', { sortBy: 'order', defaults: { defaultPriority: 3, order: 100 } });
    defs.create('jobTypes', { defaults: { priority: 50, adjacent: false } });
    defs.create('toils');
    defs.workTypes.onAdd(() => (this._byWorkType = null));
    defs.jobTypes.onAdd(() => (this._byWorkType = null));
  }

  // ---------- Регистрация ----------
  /** {id, nameKey, order, skill, defaultPriority} */
  registerWorkType(def, owner = 'core') {
    return this.game.defs.workTypes.add(def, owner);
  }

  /**
   * Вид задачи.
   * @param {object} def
   * @param {string} def.id
   * @param {string|null} def.workType — id типа работ (null — служебная задача: еда, сон, прогулка)
   * @param {string} [def.labelKey] — i18n-ключ описания («рубит дерево»)
   * @param {boolean} [def.adjacent] — цель непроходима, работать стоя рядом
   * @param {(game, pawn) => Iterable<{x:number, y:number, targetId?:number, data?:object}>} [def.findTargets]
   * @param {(game, pawn) => object|null} [def.findJob] — полностью свой поиск (вместо findTargets)
   * @param {(game, pawn, spec) => boolean} [def.canDo]
   * @param {(game, pawn, job) => object[]} def.makeToils
   * @param {(game, pawn, job) => string[]} [def.reserve] — ключи резервирования (по умолчанию e<targetId>)
   * @param {(game, pawn, job) => boolean} [def.failIf] — проверка каждый тик
   * @param {(game, pawn, job, result) => void} [def.onEnd]
   */
  registerJobType(def, owner = 'core') {
    if (typeof def.makeToils !== 'function') throw new Error(`[jobs] ${def.id}: нужен makeToils`);
    return this.game.defs.jobTypes.add(def, owner);
  }

  /** Шаг задачи: {id, start?(game, pawn, toil, job) → 'done'|'failed'|void, tick(game, pawn, toil, job, dt) → 'running'|'done'|'failed'} */
  registerToil(def, owner = 'core') {
    return this.game.defs.toils.add(def, owner);
  }

  jobTypesFor(workTypeId) {
    if (!this._byWorkType) {
      this._byWorkType = new Map();
      for (const jt of this.game.defs.jobTypes.all()) {
        if (!jt.workType) continue;
        if (!this._byWorkType.has(jt.workType)) this._byWorkType.set(jt.workType, []);
        this._byWorkType.get(jt.workType).push(jt);
      }
      for (const list of this._byWorkType.values()) list.sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
    }
    return this._byWorkType.get(workTypeId) || [];
  }

  // ---------- Приоритеты ----------
  defaultPriorities() {
    const out = {};
    for (const wt of this.game.defs.workTypes.all()) out[wt.id] = wt.defaultPriority ?? 3;
    return out;
  }

  /** 0 = не делает, 1 = высший, 4 = низший. */
  getPriority(pawn, workTypeId) {
    const v = pawn.workPriorities?.[workTypeId];
    if (v === undefined) return this.game.defs.workTypes.get(workTypeId)?.defaultPriority ?? 3;
    return v;
  }

  setPriority(pawn, workTypeId, value) {
    pawn.workPriorities ||= {};
    pawn.workPriorities[workTypeId] = Math.max(0, Math.min(4, value | 0));
    this.game.events.emit(EVENTS.WORK_PRIORITY, { pawn, workType: workTypeId, value: pawn.workPriorities[workTypeId] });
  }

  // ---------- Резервирование ----------
  isReserved(key, pawn) {
    const r = this.reservations.get(key);
    return r !== undefined && (!pawn || r !== pawn.id);
  }

  reserve(key, pawn) {
    const r = this.reservations.get(key);
    if (r !== undefined && r !== pawn.id) return false;
    this.reservations.set(key, pawn.id);
    return true;
  }

  release(key, pawn) {
    if (!pawn || this.reservations.get(key) === pawn.id) this.reservations.delete(key);
  }

  releaseAll(pawn) {
    for (const [k, v] of this.reservations) if (v === pawn.id) this.reservations.delete(k);
  }

  // ---------- Создание/запуск задач ----------
  /** Создать задачу из spec ({x, y, targetId, data, priority, manual}). */
  createJob(typeId, pawn, spec = {}) {
    const type = this.game.defs.jobTypes.require(typeId);
    const job = {
      id: this.nextJobId++,
      type: typeId,
      workType: type.workType,
      pawnId: pawn.id,
      targetId: spec.targetId || 0,
      x: spec.x ?? Math.floor(pawn.x),
      y: spec.y ?? Math.floor(pawn.y),
      data: spec.data || {},
      priority: spec.priority ?? type.priority ?? 50,
      manual: !!spec.manual,
      toils: [],
      i: 0,
      startedTick: this.game.time.tick,
      reserved: [],
    };
    job.toils = type.makeToils(this.game, pawn, job) || [];
    return job;
  }

  /** Назначить задачу пешке. Текущая задача отменяется. @returns {boolean} */
  startJob(pawn, job) {
    if (!job || pawn.dead) return false;
    const type = this.game.defs.jobTypes.get(job.type);
    const keys = type.reserve ? type.reserve(this.game, pawn, job) : job.targetId ? [resKey.entity(job.targetId)] : [];
    for (const k of keys) if (this.isReserved(k, pawn)) return false;
    if (pawn.job) this.endJob(pawn, 'cancelled');
    for (const k of keys) this.reserve(k, pawn);
    job.reserved = keys;
    pawn.job = job;
    pawn.asleep = false;
    this.game.events.emit(EVENTS.JOB_STARTED, { pawn, job });
    return true;
  }

  /** Завершить текущую задачу пешки. result: 'done' | 'failed' | 'cancelled' */
  endJob(pawn, result = 'done') {
    const job = pawn.job;
    if (!job) return;
    pawn.job = null;
    for (const k of job.reserved) this.release(k, pawn);
    pawn.workProgress = null;
    pawn.asleep = false;
    const toil = job.toils[job.i];
    if (toil?._started) {
      const td = this.game.defs.toils.get(toil.type);
      td?.end?.(this.game, pawn, toil, job, result);
    }
    stopMoving(pawn);
    const type = this.game.defs.jobTypes.get(job.type);
    try {
      type?.onEnd?.(this.game, pawn, job, result);
    } finally {
      if (pawn.carry && !job.keepCarry && result !== 'done') this.game.items.dropCarried(pawn);
      if (result === 'done') this.game.stats.jobsDone++;
      else if (result === 'failed') {
        this.game.stats.jobsFailed++;
        pawn._thinkCooldown = 40;
      }
      this.game.events.emit(EVENTS.JOB_ENDED, { pawn, job, result });
    }
  }

  /** Найти работу по приоритетам (1..4) и порядку типов работ. */
  findWork(pawn) {
    if (!this.game.api.health.canWork(pawn)) return null;
    const wts = this.game.defs.workTypes.all();
    for (let lvl = 1; lvl <= 4; lvl++) {
      for (const wt of wts) {
        if (this.getPriority(pawn, wt.id) !== lvl) continue;
        for (const jt of this.jobTypesFor(wt.id)) {
          const job = this.tryJobType(jt, pawn);
          if (job) return job;
        }
      }
    }
    return null;
  }

  /** Попробовать создать задачу данного вида для пешки (ближайшая доступная цель). */
  tryJobType(jt, pawn, opts = {}) {
    const game = this.game;
    if (jt.findJob) {
      const spec = jt.findJob(game, pawn);
      return spec ? this.createJob(jt.id, pawn, spec) : null;
    }
    if (!jt.findTargets) return null;
    const px = pawn.x;
    const py = pawn.y;
    const cands = [];
    for (const c of jt.findTargets(game, pawn)) {
      if (c.targetId && this.isReserved(resKey.entity(c.targetId), pawn)) continue;
      const dx = c.x + 0.5 - px;
      const dy = c.y + 0.5 - py;
      cands.push({ c, d: dx * dx + dy * dy });
    }
    if (cands.length === 0) return null;
    cands.sort((a, b) => a.d - b.d);
    const max = Math.min(cands.length, opts.maxChecks || 24);
    for (let i = 0; i < max; i++) {
      const c = cands[i].c;
      if (jt.canDo && !jt.canDo(game, pawn, c)) continue;
      const t = c.targetId ? game.entities.get(c.targetId) : null;
      if (!game.pathfinder.canReach(px, py, c.x, c.y, jt.adjacent, t?.w || 1, t?.h || 1)) continue;
      return this.createJob(jt.id, pawn, c);
    }
    return null;
  }

  /**
   * Ручная работа лидера (E): та же задача, но назначенная игроком.
   * Движение WASD отменяет её (см. player/controller.js).
   */
  startManual(pawn, typeId, spec) {
    const jt = this.game.defs.jobTypes.require(typeId);
    if (jt.canDo && !jt.canDo(this.game, pawn, spec)) return false;
    const job = this.createJob(typeId, pawn, { ...spec, manual: true, priority: 100 });
    return this.startJob(pawn, job);
  }

  // ---------- Выполнение ----------
  tickPawn(pawn, dt) {
    const job = pawn.job;
    if (!job) return;
    const game = this.game;
    const type = game.defs.jobTypes.get(job.type);
    if (type?.failIf && type.failIf(game, pawn, job)) {
      this.endJob(pawn, 'failed');
      return;
    }
    let guard = 0;
    while (pawn.job === job && guard++ < 4) {
      const toil = job.toils[job.i];
      if (!toil) {
        this.endJob(pawn, 'done');
        return;
      }
      const td = game.defs.toils.get(toil.type);
      if (!td) {
        game.error(new Error(`[jobs] нет toil "${toil.type}"`), 'jobs');
        this.endJob(pawn, 'failed');
        return;
      }
      let r;
      if (!toil._started) {
        toil._started = true;
        r = td.start?.(game, pawn, toil, job);
      }
      if (r !== 'done' && r !== 'failed') r = td.tick(game, pawn, toil, job, dt);
      if (pawn.job !== job) return; // задачу сменили изнутри шага
      if (r === 'failed') {
        this.endJob(pawn, 'failed');
        return;
      }
      if (r !== 'done') return; // running
      td.end?.(game, pawn, toil, job, 'done');
      job.i++;
      if (job.i >= job.toils.length) {
        this.endJob(pawn, 'done');
        return;
      }
      // следующий шаг стартует в этом же тике (мгновенные шаги не тратят тик)
    }
  }
}

// ---------------- Пометки (designations) ----------------
export class DesignationManager {
  constructor(game) {
    this.game = game;
    /** type → Map<idx, {type, x, y, targetId}> */
    this.byType = new Map();
    /** targetId → Set<designation> */
    this.byTarget = new Map();
    game.events.on(EVENTS.ENTITY_REMOVED, ({ entity }) => this.removeTarget(entity.id));
    game.events.on(EVENTS.ENTITY_MOVED, ({ entity }) => this._targetMoved(entity));
  }

  /** Цель пометки переехала (setPosition): переносим её пометки на новую клетку. */
  _targetMoved(entity) {
    const set = this.byTarget.get(entity.id);
    const map = this.game.map;
    if (!set || !map) return;
    for (const d of set) {
      const m = this._map(d.type);
      if (map.inBounds(d.x, d.y) && m.get(map.idx(d.x, d.y)) === d) m.delete(map.idx(d.x, d.y));
      d.x = Math.floor(entity.x);
      d.y = Math.floor(entity.y);
      if (map.inBounds(d.x, d.y)) m.set(map.idx(d.x, d.y), d);
      else set.delete(d);
    }
  }

  /**
   * Тип пометки.
   * {id, nameKey, color, glyph, jobType, valid(game, x, y) → targetId|0}
   */
  registerType(def, owner = 'core') {
    if (typeof def.valid !== 'function') throw new Error(`[designations] ${def.id}: нужен valid()`);
    const d = this.game.defs.designations.add(def, owner);
    if (!this.byType.has(d.id)) this.byType.set(d.id, new Map());
    return d;
  }

  _map(type) {
    let m = this.byType.get(type);
    if (!m) this.byType.set(type, (m = new Map()));
    return m;
  }

  /** Поставить пометку. @returns {object|null} */
  add(type, x, y) {
    const def = this.game.defs.designations.get(type);
    const map = this.game.map;
    if (!def || !map || !map.inBounds(x, y)) return null;
    const targetId = def.valid(this.game, x, y);
    if (!targetId) return null;
    const target = this.game.entities.get(targetId);
    const tx = target ? target.x : x;
    const ty = target ? target.y : y;
    const idx = map.idx(tx, ty);
    const m = this._map(type);
    if (m.has(idx)) return m.get(idx);
    const d = { type, x: tx, y: ty, targetId };
    m.set(idx, d);
    if (targetId) {
      if (!this.byTarget.has(targetId)) this.byTarget.set(targetId, new Set());
      this.byTarget.get(targetId).add(d);
    }
    this.game.events.emit(EVENTS.DESIGNATION_ADDED, d);
    return d;
  }

  remove(type, x, y) {
    const map = this.game.map;
    if (!map || !map.inBounds(x, y)) return false;
    const m = this._map(type);
    let idx = map.idx(x, y);
    let d = m.get(idx);
    if (!d) {
      // клетка может принадлежать многоклеточной цели
      const b = map.buildingAt(x, y) || map.plantAt(x, y);
      if (b) {
        idx = map.idx(b.x, b.y);
        d = m.get(idx);
      }
    }
    if (!d) return false;
    m.delete(idx);
    this.byTarget.get(d.targetId)?.delete(d);
    this.game.events.emit(EVENTS.DESIGNATION_REMOVED, { type, x: d.x, y: d.y });
    return true;
  }

  removeTarget(targetId) {
    const set = this.byTarget.get(targetId);
    if (!set) return;
    this.byTarget.delete(targetId);
    const map = this.game.map;
    for (const d of set) {
      const m = this._map(d.type);
      if (map) m.delete(map.idx(d.x, d.y));
      this.game.events.emit(EVENTS.DESIGNATION_REMOVED, { type: d.type, x: d.x, y: d.y });
    }
  }

  removeTargetType(targetId, type) {
    const t = this.game.entities.get(targetId);
    if (t) this.remove(type, t.x, t.y);
  }

  get(type, x, y) {
    const map = this.game.map;
    if (!map?.inBounds(x, y)) return null;
    return this._map(type).get(map.idx(x, y)) || null;
  }

  has(type, x, y) {
    return !!this.get(type, x, y);
  }

  forTarget(targetId) {
    return [...(this.byTarget.get(targetId) || [])];
  }

  /** Итератор пометок типа. */
  ofType(type) {
    return this._map(type).values();
  }

  count(type) {
    return type ? this._map(type).size : [...this.byType.values()].reduce((s, m) => s + m.size, 0);
  }

  /**
   * Пометить прямоугольник. types — список типов по приоритету (для каждой клетки берётся первый подходящий).
   * @returns {number} сколько поставлено
   */
  addRect(types, x0, y0, x1, y1) {
    let n = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        for (const t of types) {
          if (this.get(t, x, y)) break;
          if (this.add(t, x, y)) {
            n++;
            break;
          }
        }
    return n;
  }

  removeRect(types, x0, y0, x1, y1) {
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (const t of types) if (this.remove(t, x, y)) n++;
    return n;
  }

  clear() {
    for (const m of this.byType.values()) m.clear();
    this.byTarget.clear();
  }

  serialize() {
    const out = [];
    for (const m of this.byType.values()) for (const d of m.values()) out.push([d.type, d.x, d.y]);
    return out;
  }

  deserialize(list) {
    this.clear();
    for (const [type, x, y] of list) this.add(type, x, y);
  }
}

// ---------------- Базовые шаги (toils) ----------------
/** Цель шага: явные x/y шага важнее targetId задачи (например, «нести на склад» после pickup). */
export function toilTargetId(toil, job) {
  if (toil.targetId !== undefined) return toil.targetId;
  return toil.x !== undefined ? 0 : job.targetId;
}

function targetRect(game, toil, job) {
  const id = toilTargetId(toil, job);
  const t = id ? game.entities.get(id) : null;
  if (id && !t) return null;
  if (t) return { x: t.x, y: t.y, w: t.w || 1, h: t.h || 1, entity: t };
  return { x: toil.x ?? job.x, y: toil.y ?? job.y, w: 1, h: 1, entity: null };
}

function atGoal(pawn, r, adjacent) {
  const px = Math.floor(pawn.x);
  const py = Math.floor(pawn.y);
  if (!adjacent) return px === r.x && py === r.y;
  return px >= r.x - 1 && px <= r.x + r.w && py >= r.y - 1 && py <= r.y + r.h;
}

export const CORE_TOILS = [
  {
    // Идти к клетке/сущности. {type:'goto', x?, y?, targetId?, adjacent?}
    id: 'goto',
    start(game, pawn, toil, job) {
      const r = targetRect(game, toil, job);
      if (!r) return 'failed';
      toil._r = r;
      if (atGoal(pawn, r, toil.adjacent)) return 'done';
      if (!moveTo(game, pawn, r.x, r.y, { adjacent: toil.adjacent, w: r.w, h: r.h })) return 'failed';
      return undefined;
    },
    tick(game, pawn, toil, job) {
      const tid = toilTargetId(toil, job);
      if (tid && !game.entities.get(tid)) return 'failed';
      if (pawn.pathFailed && !pawn.path) return 'failed';
      if (pathDone(pawn)) {
        if (atGoal(pawn, toil._r, toil.adjacent)) return 'done';
        toil._retries = (toil._retries || 0) + 1;
        if (toil._retries > 2) return 'failed';
        const r = toil._r;
        if (!moveTo(game, pawn, r.x, r.y, { adjacent: toil.adjacent, w: r.w, h: r.h })) return 'failed';
      }
      return 'running';
    },
    end(game, pawn) {
      stopMoving(pawn);
    },
  },
  {
    // Подождать. {type:'wait', ticks}
    id: 'wait',
    tick(game, pawn, toil) {
      toil._t = (toil._t || 0) + 1;
      return toil._t >= (toil.ticks || 60) ? 'done' : 'running';
    },
  },
  {
    // Работа с прогрессом. {type:'work', ticks, workType?, targetId?, fx?, onDone(game, pawn, job) → 'failed'?, onTick?}
    id: 'work',
    start(game, pawn, toil, job) {
      toil._p = 0;
      toil._hit = 0;
      const id = toilTargetId(toil, job);
      if (id && !game.entities.get(id)) return 'failed';
      return undefined;
    },
    tick(game, pawn, toil, job, dt) {
      const id = toilTargetId(toil, job);
      const t = id ? game.entities.get(id) : null;
      if (id && !t) return 'failed';
      const tx = t ? t.x + (t.w || 1) / 2 : (toil.x ?? job.x) + 0.5;
      const ty = t ? t.y + (t.h || 1) / 2 : (toil.y ?? job.y) + 0.5;
      if (Math.abs(tx - pawn.x) + Math.abs(ty - pawn.y) > 0.05) pawn.dir = Math.atan2(ty - pawn.y, tx - pawn.x);
      const wt = toil.workType || job.workType;
      let speed = safeNum(game.api.health.workSpeedFactor(pawn), 0, 10) * (wt ? safeNum(game.api.mind.skillFactor(pawn, wt), 0, 10) : 1);
      if (pawn.isLeader && pawn.controlled === 'player') speed *= 1.25; // лидер работает азартнее
      toil._p += speed * dt * 60;
      const total = Math.max(1, toil.ticks || 60);
      pawn.workProgress = { x: tx, y: ty, p: Math.min(1, toil._p / total), fx: toil.fx };
      if (wt) {
        const skill = game.defs.workTypes.get(wt)?.skill;
        if (skill) game.api.mind.learn(pawn, skill, 0.05);
      }
      toil._hit += dt * 60;
      if (toil.fx && toil._hit >= 36) {
        toil._hit = 0;
        game.events.emit(EVENTS.WORK_HIT, { pawn, job, x: tx, y: ty, fx: toil.fx });
      }
      if (toil.onTick && toil.onTick(game, pawn, job, toil) === 'failed') return 'failed';
      if (toil._p >= total) {
        pawn.workProgress = null;
        const r = toil.onDone ? toil.onDone(game, pawn, job, toil) : undefined;
        return r === 'failed' ? 'failed' : 'done';
      }
      return 'running';
    },
    end(game, pawn) {
      pawn.workProgress = null;
    },
  },
  {
    // Взять предмет. {type:'pickup', targetId, count}
    id: 'pickup',
    start(game, pawn, toil, job) {
      const item = game.entities.get(toil.targetId ?? job.targetId);
      if (!item || item.kind !== 'item') return 'failed';
      if (chebyshev(Math.floor(pawn.x), Math.floor(pawn.y), item.x, item.y) > 1) return 'failed';
      const n = game.items.pickUp(pawn, item, toil.count ?? item.count);
      return n > 0 ? 'done' : 'failed';
    },
    tick() {
      return 'done';
    },
  },
  {
    // Положить несомое. {type:'drop', x?, y?} (по умолчанию — под ноги)
    id: 'drop',
    start(game, pawn, toil) {
      if (!pawn.carry) return 'done';
      game.items.dropCarried(pawn, toil.x, toil.y);
      return 'done';
    },
    tick() {
      return 'done';
    },
  },
  {
    // Произвольное действие. {type:'interact', fn(game, pawn, job, toil) → 'done'|'failed'|'running'}
    id: 'interact',
    tick(game, pawn, toil, job) {
      return toil.fn ? toil.fn(game, pawn, job, toil) || 'done' : 'done';
    },
  },
];

/**
 * Фабрика задач «поработать над вещью по пометке» (рубка, добыча, сбор).
 * Используется ядром для chop/mine/harvest; модули могут делать так же (например, разборка).
 */
export function thingWorkJob({ id, workType, designation, labelKey, fx, kind, workTicks, canTarget, complete, priority = 50 }) {
  return {
    id,
    workType,
    labelKey,
    designation,
    adjacent: true,
    priority,
    *findTargets(game) {
      for (const d of game.designations.ofType(designation)) yield { x: d.x, y: d.y, targetId: d.targetId };
    },
    canDo(game, pawn, spec) {
      const t = game.entities.get(spec.targetId);
      return !!t && t.kind === kind && canTarget(game, t);
    },
    makeToils(game, pawn, job) {
      const t = game.entities.get(job.targetId);
      const def = t ? game.entities.defOf(t) : null;
      return [
        { type: 'goto', targetId: job.targetId, adjacent: true },
        {
          type: 'work',
          ticks: def ? workTicks(def, t) : 60,
          workType,
          targetId: job.targetId,
          fx,
          onDone: (g, p) => {
            const target = g.entities.get(job.targetId);
            if (!target) return 'failed';
            complete(g, p, target);
            g.designations.removeTargetType(job.targetId, designation);
            return undefined;
          },
        },
      ];
    },
  };
}

export function registerJobDefs(game) {
  const jobs = game.jobs;
  for (const wt of CORE_WORK_TYPES) jobs.registerWorkType(wt);
  for (const t of CORE_TOILS) jobs.registerToil(t);

  game.designations.registerType({
    id: 'chop',
    nameKey: 'designation.chop',
    color: '#ff9f43',
    glyph: 'axe',
    jobType: 'chop',
    valid(game, x, y) {
      const p = game.map.plantAt(x, y);
      return p && game.defs.plants.get(p.defId)?.choppable ? p.id : 0;
    },
  });
  game.designations.registerType({
    id: 'harvest',
    nameKey: 'designation.harvest',
    color: '#7dff6a',
    glyph: 'hand',
    jobType: 'harvest',
    valid(game, x, y) {
      const p = game.map.plantAt(x, y);
      const d = p && game.defs.plants.get(p.defId);
      return d?.harvestYield && (p.growth ?? 1) >= 1 ? p.id : 0;
    },
  });
  game.designations.registerType({
    id: 'mine',
    nameKey: 'designation.mine',
    color: '#5ad1ff',
    glyph: 'pick',
    jobType: 'mine',
    valid(game, x, y) {
      const b = game.map.buildingAt(x, y);
      return b && game.defs.buildings.get(b.defId)?.mineable ? b.id : 0;
    },
  });

  jobs.registerJobType(
    thingWorkJob({
      id: 'chop',
      workType: 'cutting',
      designation: 'chop',
      labelKey: 'job.chop',
      fx: 'chop',
      kind: 'plant',
      workTicks: (def) => def.workToCut ?? 300,
      canTarget: (game, t) => !!game.defs.plants.get(t.defId)?.choppable,
      complete(game, pawn, plant) {
        cutPlant(game, plant, pawn, false);
      },
    }),
  );
  jobs.registerJobType(
    thingWorkJob({
      id: 'harvest',
      workType: 'growing',
      designation: 'harvest',
      labelKey: 'job.harvest',
      fx: 'harvest',
      kind: 'plant',
      workTicks: (def) => def.workToHarvest ?? 120,
      canTarget: (game, t) => !!game.defs.plants.get(t.defId)?.harvestYield && (t.growth ?? 1) >= 1,
      complete(game, pawn, plant) {
        cutPlant(game, plant, pawn, true);
      },
    }),
  );
  jobs.registerJobType(
    thingWorkJob({
      id: 'mine',
      workType: 'mining',
      designation: 'mine',
      labelKey: 'job.mine',
      fx: 'mine',
      kind: 'building',
      workTicks: (def) => def.workToMine ?? 400,
      canTarget: (game, t) => !!game.defs.buildings.get(t.defId)?.mineable,
      complete(game, pawn, rock) {
        mineThing(game, rock, pawn);
      },
    }),
  );

  // Прогулка (служебная задача для ИИ без работы)
  jobs.registerJobType({
    id: 'wander',
    workType: null,
    labelKey: 'job.wander',
    priority: 10,
    makeToils(game, pawn, job) {
      return [
        { type: 'goto', x: job.x, y: job.y },
        { type: 'wait', ticks: job.data.wait ?? 120 },
      ];
    },
  });
  jobs.registerJobType({
    id: 'wait',
    workType: null,
    labelKey: 'job.idle',
    priority: 5,
    makeToils(game, pawn, job) {
      return [{ type: 'wait', ticks: job.data.ticks ?? 90 }];
    },
  });
  // Идти в точку (приказы, бегство). data.wait — подождать по прибытии.
  jobs.registerJobType({
    id: 'goto',
    workType: null,
    labelKey: 'job.goto',
    priority: 60,
    makeToils(game, pawn, job) {
      const t = [{ type: 'goto', x: job.x, y: job.y }];
      if (job.data.wait) t.push({ type: 'wait', ticks: job.data.wait });
      return t;
    },
  });
}

/** Срубить/собрать растение: выдать урожай, убрать (или обнулить рост). */
export function cutPlant(game, plant, pawn, harvestOnly) {
  const def = game.defs.plants.get(plant.defId);
  if (!def) return;
  const x = plant.x;
  const y = plant.y;
  const yieldTable = harvestOnly ? def.harvestYield : def.yield;
  if (harvestOnly && def.harvestYield) {
    plant.growth = 0;
    game.designations.removeTargetType(plant.id, 'harvest');
    game.map.touch(x, y);
  } else {
    game.entities.remove(plant, 'cut');
  }
  const growth = harvestOnly ? 1 : plant.growth ?? 1;
  for (const [itemId, n] of Object.entries(yieldTable || {})) {
    const count = Math.max(1, Math.round(n * (0.8 + game.rng.next() * 0.4) * (0.4 + 0.6 * growth)));
    game.items.spawn(itemId, count, x, y);
  }
  game.events.emit(EVENTS.PLANT_CUT, { plant, pawn, harvestOnly: !!harvestOnly });
}

/** Добыть камень/руду. */
export function mineThing(game, thing, pawn) {
  const def = game.defs.buildings.get(thing.defId);
  const x = thing.x;
  const y = thing.y;
  game.entities.remove(thing, 'mined');
  for (const [itemId, n] of Object.entries(def?.yield || {})) {
    game.items.spawn(itemId, Math.max(1, Math.round(n * (0.85 + game.rng.next() * 0.3))), x, y);
  }
  game.events.emit(EVENTS.THING_MINED, { thing, pawn });
}
