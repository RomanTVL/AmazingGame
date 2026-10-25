// Обзор: маски видимости и исследованного, источники обзора (лидер, камеры, вышки, маяк, поселенцы при
// передатчике), двери, ночь и свет, «последнее известное», «только для глаз лидера», топливо построек.
// Всё детерминировано (без game.rng), пересчёт — по изменениям, а не каждый тик.
import { EVENTS } from '../../core/events.js';
import { rleEncode, rleDecode } from '../../core/save.js';
import { shadowcast, clearLine } from './fov.js';
import {
  BIT, DAY_RADIUS, CREW_RADIUS, MIN_RADIUS, NIGHT_SHRINK, CAMERA_RADIUS, TOWER_RADIUS, LIGHTHOUSE_RADIUS,
  MONITOR_LEADER_RADIUS, DOOR_OPEN_RADIUS, DEF, TICKS_HOUR,
} from './constants.js';

const O = 'vision';

export function createState(game) {
  return {
    game,
    enabled: true,
    map: null,
    w: 0,
    h: 0,
    n: 0,
    vis: null, // Uint8Array, биты BIT
    explored: null, // Uint8Array
    opaque: null, // закрывает обзор (стены, закрытые двери, деревья, скалы)
    opaqueTall: null, // то же без растений (вышки видят поверх деревьев; слух — «через стены»)
    lit: null, // освещённые клетки (ночь)
    doorOpen: null,
    renderHide: null, // клетки «невидимых для всех, кроме лидера» сущностей (рендер)
    lists: { [BIT.LEADER]: [], [BIT.STRUCT]: [], [BIT.CREW]: [] },
    camLos: new Map(), // id камеры → индексы видимых ею клеток (для пульта)
    dirty: null, // прямоугольник изменений карты {x0, y0, x1, y1}
    opaqueStamp: 0,
    doors: [],
    doorsDirty: true,
    sources: [],
    sourcesDirty: true,
    leaderKey: '',
    leaderTick: -1e9,
    othersTick: -1e9,
    litTick: -1e9,
    litOn: false,
    forceLeader: true,
    forceOthers: true,
    lastKnown: new Map(), // id → {x, y, tick}
    onlyLeader: new Set(),
    onlyLeaderTick: -1e9,
    viewing: false, // лидер смотрит в пульт камер
    deadCams: [], // [{id, n, tick}] — разбитые камеры («НЕТ СИГНАЛА»)
    camOrder: [], // id камер в порядке подключения
    exploredCount: 0,
    stats: { casts: 0, cells: 0 },
    // заполняют другие части модуля
    noises: [],
    rings: [],
    acks: [],
    prompts: [],
    pending: [],
  };
}

// ---------------------------------------------------------------- помощники
export function nightRadius(base, night) {
  return Math.max(MIN_RADIUS, base * (1 - NIGHT_SHRINK * night));
}

function bdef(game, e) {
  return e ? game.defs.buildings.get(e.defId) : null;
}

/** Работает ли постройка (построена, цела, есть топливо, если нужно). */
export function isActive(game, e) {
  if (!e || e.removed || e.blueprint || (e.hp !== undefined && e.hp <= 0) || e.broken) return false;
  const def = bdef(game, e);
  if (def?.fuel && !(fuelOf(game, e) > 0)) return false;
  return true;
}

export function fuelOf(game, e) {
  const def = bdef(game, e);
  if (!def?.fuel) return Infinity;
  if (!Number.isFinite(e.fuel)) e.fuel = def.fuel.start ?? def.fuel.max * 0.5;
  return e.fuel;
}

export function inFootprint(e, tx, ty) {
  return tx >= e.x && ty >= e.y && tx < e.x + (e.w || 1) && ty < e.y + (e.h || 1);
}

export function adjacentTo(e, px, py, reach = 1) {
  const tx = Math.floor(px);
  const ty = Math.floor(py);
  return tx >= e.x - reach && ty >= e.y - reach && tx <= e.x + (e.w || 1) - 1 + reach && ty <= e.y + (e.h || 1) - 1 + reach;
}

export function hostilesNear(game, pawn, r) {
  let n = 0;
  for (const o of game.entities.queryRadius(pawn.x, pawn.y, r, 'pawn')) {
    if (o.dead || o.downed) continue;
    if (game.api.combat.isHostile(pawn, o)) n++;
  }
  return n;
}

/** Есть ли работающая постройка вида defId (опц. — рядом с точкой). */
export function findActive(V, defId, near) {
  const game = V.game;
  refreshSources(V);
  for (const id of V.sources) {
    const e = game.entities.get(id);
    if (!e || e.defId !== defId || !isActive(game, e)) continue;
    if (near && !adjacentTo(e, near.x, near.y, near.reach ?? 1)) continue;
    return e;
  }
  return null;
}

export function hasTransmitter(V) {
  return !!findActive(V, DEF.TRANSMITTER);
}

export function hasBell(V) {
  return !!findActive(V, DEF.BELL);
}

// ---------------------------------------------------------------- массивы и карта
export function ensure(V) {
  const game = V.game;
  const map = game.map;
  if (!map) return false;
  if (V.map === map && V.vis) return true;
  V.map = map;
  V.w = map.w;
  V.h = map.h;
  V.n = map.w * map.h;
  V.vis = new Uint8Array(V.n);
  V.explored = new Uint8Array(V.n);
  V.opaque = new Uint8Array(V.n);
  V.opaqueTall = new Uint8Array(V.n);
  V.lit = new Uint8Array(V.n);
  V.doorOpen = new Uint8Array(V.n);
  V.renderHide = new Uint8Array(V.n);
  for (const k of Object.keys(V.lists)) V.lists[k].length = 0;
  V.camLos.clear();
  V.dirty = { x0: 0, y0: 0, x1: map.w - 1, y1: map.h - 1 };
  V.doorsDirty = true;
  V.sourcesDirty = true;
  V.forceLeader = V.forceOthers = true;
  V.litTick = -1e9;
  V.exploredCount = 0;
  bump(V);
  return true;
}

export function bump(V) {
  V.game.vision.version++;
  V.game.events.emit('vision:changed', {});
}

function markDirty(V, x, y, w, h) {
  if (!V.map) return;
  const r = V.dirty;
  const x1 = x + w - 1;
  const y1 = y + h - 1;
  if (!r) V.dirty = { x0: x, y0: y, x1, y1 };
  else {
    r.x0 = Math.min(r.x0, x);
    r.y0 = Math.min(r.y0, y);
    r.x1 = Math.max(r.x1, x1);
    r.y1 = Math.max(r.y1, y1);
  }
}

function recomputeOpaque(V) {
  const r = V.dirty;
  if (!r) return false;
  V.dirty = null;
  const game = V.game;
  const map = V.map;
  const x0 = Math.max(0, r.x0);
  const y0 = Math.max(0, r.y0);
  const x1 = Math.min(V.w - 1, r.x1);
  const y1 = Math.min(V.h - 1, r.y1);
  let changed = false;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const k = y * V.w + x;
      const bv = map.blocksVision[k] === 1;
      let tall = false;
      if (bv && map.building[k]) tall = !!bdef(game, game.entities.get(map.building[k]))?.blocksVision;
      const open = V.doorOpen[k] === 1;
      const o = bv && !open ? 1 : 0;
      const t = tall && !open ? 1 : 0;
      if (V.opaque[k] !== o || V.opaqueTall[k] !== t) {
        V.opaque[k] = o;
        V.opaqueTall[k] = t;
        changed = true;
      }
    }
  if (changed) V.opaqueStamp++;
  return changed;
}

function rescanDoors(V) {
  const game = V.game;
  V.doors.length = 0;
  for (const b of game.entities.ofKind('building')) if (bdef(game, b)?.door) V.doors.push(b.id);
  V.doorsDirty = false;
}

const qbuf = [];
function updateDoors(V) {
  const game = V.game;
  if (V.doorsDirty) rescanDoors(V);
  const isOpenApi = game.api.build?.isDoorOpen;
  let changed = false;
  for (let i = 0; i < V.doors.length; i++) {
    const d = game.entities.get(V.doors[i]);
    if (!d) {
      V.doorsDirty = true;
      continue;
    }
    let open = false;
    if (typeof isOpenApi === 'function') {
      try {
        open = !!isOpenApi(d);
      } catch (err) {
        game.error(err, 'vision.doors');
      }
    } else {
      const cx = d.x + 0.5;
      const cy = d.y + 0.5;
      qbuf.length = 0;
      game.entities.queryRect(d.x - 2, d.y - 2, d.x + 2, d.y + 2, 'pawn', qbuf);
      for (let j = 0; j < qbuf.length; j++) {
        const p = qbuf[j];
        if (p.dead) continue;
        const dx = p.x - cx;
        const dy = p.y - cy;
        if (dx * dx + dy * dy <= DOOR_OPEN_RADIUS * DOOR_OPEN_RADIUS) {
          open = true;
          break;
        }
      }
    }
    for (let yy = 0; yy < (d.h || 1); yy++)
      for (let xx = 0; xx < (d.w || 1); xx++) {
        const x = d.x + xx;
        const y = d.y + yy;
        if (x < 0 || y < 0 || x >= V.w || y >= V.h) continue;
        const k = y * V.w + x;
        const v = open ? 1 : 0;
        if (V.doorOpen[k] !== v) {
          V.doorOpen[k] = v;
          markDirty(V, x, y, 1, 1);
          changed = true;
        }
      }
  }
  return changed;
}

export function refreshSources(V) {
  if (!V.sourcesDirty) return;
  const game = V.game;
  V.sources.length = 0;
  for (const b of game.entities.ofKind('building')) {
    const def = bdef(game, b);
    if (def?.vision || def?.visionLink) V.sources.push(b.id);
  }
  V.sourcesDirty = false;
  // порядок камер для пульта: по id (новые — в конец), разбитые остаются слотами «НЕТ СИГНАЛА»
  const cams = V.sources.filter((id) => game.entities.get(id)?.defId === DEF.CAMERA);
  for (const id of cams) if (!V.camOrder.includes(id)) V.camOrder.push(id);
  V.camOrder = V.camOrder.filter((id) => cams.includes(id) || V.deadCams.some((d) => d.id === id));
}

function updateLit(V) {
  const game = V.game;
  const lit = V.lit;
  lit.fill(0);
  const w = V.w;
  const h = V.h;
  const disc = (x, y, r) => {
    if (!(r > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const rr = r * 0.8;
    const r2 = rr * rr;
    const x0 = Math.max(0, Math.floor(x - rr));
    const x1 = Math.min(w - 1, Math.floor(x + rr));
    const y0 = Math.max(0, Math.floor(y - rr));
    const y1 = Math.min(h - 1, Math.floor(y + rr));
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx + 0.5 - x;
        const dy = ty + 0.5 - y;
        if (dx * dx + dy * dy <= r2) lit[ty * w + tx] = 1;
      }
  };
  for (const p of game.entities.ofKind('pawn')) if (p.light && !p.dead) disc(p.x, p.y, p.light.radius);
  for (const kind of ['building', 'plant', 'item']) {
    for (const e of game.entities.ofKind(kind)) {
      if (e.blueprint) continue;
      const L = e.light || game.entities.defOf(e)?.light;
      if (!L) continue;
      if (kind === 'building' && game.defs.buildings.get(e.defId)?.fuel && !(fuelOf(game, e) > 0)) continue;
      disc(e.x + (e.w || 1) / 2, e.y + (e.h || 1) / 2, L.radius);
    }
  }
  if (game.train?.stamped) for (const L of game.train.lights()) disc(L.x, L.y, L.radius);
  V.litOn = true;
}

// ---------------------------------------------------------------- касты
function clearBit(V, bit) {
  const list = V.lists[bit];
  const vis = V.vis;
  const inv = ~bit;
  for (let i = 0; i < list.length; i++) vis[list[i]] &= inv;
  list.length = 0;
}

function explore(V, list, from) {
  const ex = V.explored;
  let n = 0;
  for (let i = from; i < list.length; i++) {
    const k = list[i];
    if (ex[k] === 0) {
      ex[k] = 1;
      n++;
    }
  }
  V.exploredCount += n;
}

function cast(V, bit, ox, oy, radius, near, tall, collect) {
  const list = V.lists[bit];
  const from = list.length;
  const cells = shadowcast({
    w: V.w, h: V.h, ox, oy, radius, near, opaque: tall ? V.opaqueTall : V.opaque,
    lit: V.litOn ? V.lit : null, out: V.vis, bit, collect: list,
  });
  V.stats.casts++;
  V.stats.cells += cells;
  explore(V, list, from);
  if (collect) for (let i = from; i < list.length; i++) collect.push(list[i]);
}

/** Вышка, в которой стоит пешка (или null). */
export function towerAt(V, tx, ty) {
  const game = V.game;
  for (const id of V.sources) {
    const e = game.entities.get(id);
    if (e?.defId === DEF.TOWER && !e.blueprint && inFootprint(e, tx, ty)) return e;
  }
  return null;
}

function leaderParams(V, leader) {
  const game = V.game;
  const night = game.time.nightFactor;
  const tx = Math.floor(leader.x);
  const ty = Math.floor(leader.y);
  const mul = Number.isFinite(leader.perks?.visionMul) ? leader.perks.visionMul : 1;
  if (V.viewing) return { ox: tx, oy: ty, radius: MONITOR_LEADER_RADIUS, near: MONITOR_LEADER_RADIUS, tall: false };
  const tower = towerAt(V, tx, ty);
  if (tower) {
    const cx = tower.x + Math.floor((tower.w || 1) / 2);
    const cy = tower.y + Math.floor((tower.h || 1) / 2);
    const R = (bdef(game, tower)?.vision?.radius ?? TOWER_RADIUS) * mul;
    return { ox: cx, oy: cy, radius: R, near: nightRadius(R, night), tall: true };
  }
  const R = DAY_RADIUS * mul;
  return { ox: tx, oy: ty, radius: R, near: nightRadius(R, night), tall: false };
}

function castLeader(V) {
  const game = V.game;
  clearBit(V, BIT.LEADER);
  const L = game.getLeader();
  if (!L) return;
  const p = leaderParams(V, L);
  cast(V, BIT.LEADER, p.ox, p.oy, p.radius, p.near, p.tall, null);
  // своя клетка и соседние — всегда (лидер чувствует, кто рядом)
  const tx = Math.floor(L.x);
  const ty = Math.floor(L.y);
  const list = V.lists[BIT.LEADER];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= V.w || y >= V.h) continue;
      const k = y * V.w + x;
      if ((V.vis[k] & BIT.LEADER) === 0) {
        V.vis[k] |= BIT.LEADER;
        list.push(k);
        if (!V.explored[k]) {
          V.explored[k] = 1;
          V.exploredCount++;
        }
      }
    }
}

/** Параметры обзора постройки-источника (или null, если не работает). */
export function sourceParams(V, e) {
  const game = V.game;
  const def = bdef(game, e);
  if (!def?.vision || !isActive(game, e)) return null;
  const night = game.time.nightFactor;
  const leader = game.getLeader();
  let R = def.vision.radius ?? CAMERA_RADIUS;
  if (e.defId === DEF.CAMERA) R += Number.isFinite(leader?.perks?.cameraRadius) ? leader.perks.cameraRadius : 0;
  if (def.vision.manned) {
    // вышка видит, только когда в ней дозорный (свежая отметка _mannedTick от задачи дозора)
    if (!(game.time.tick - (e._mannedTick ?? -1e9) < 40)) return null;
  }
  const cx = e.x + Math.floor((e.w || 1) / 2);
  const cy = e.y + Math.floor((e.h || 1) / 2);
  const near = def.vision.nightVision ? R : nightRadius(R, night);
  return { ox: cx, oy: cy, radius: R, near, tall: !!def.vision.overTrees };
}

function castOthers(V) {
  const game = V.game;
  clearBit(V, BIT.STRUCT);
  clearBit(V, BIT.CREW);
  refreshSources(V);
  V.camLos.clear();
  for (const id of V.sources) {
    const e = game.entities.get(id);
    if (!e) continue;
    const p = sourceParams(V, e);
    if (!p) continue;
    let collect = null;
    if (e.defId === DEF.CAMERA) V.camLos.set(e.id, (collect = []));
    cast(V, BIT.STRUCT, p.ox, p.oy, p.radius, p.near, p.tall, collect);
  }
  if (hasTransmitter(V)) {
    const night = game.time.nightFactor;
    const leader = game.getLeader();
    for (const p of game.entities.ofKind('pawn')) {
      if (p === leader || p.dead || p.downed || p.asleep || p.faction !== 'colony') continue;
      const R = CREW_RADIUS;
      cast(V, BIT.CREW, Math.floor(p.x), Math.floor(p.y), R, nightRadius(R, night), false, null);
    }
  }
}

// ---------------------------------------------------------------- тик
export function visionTick(V) {
  const game = V.game;
  if (!game.map || !V.enabled) return;
  ensure(V);
  const tick = game.time.tick;
  let changed = false;
  if (tick % 4 === 0 || V.forceLeader) updateDoors(V);
  if (recomputeOpaque(V)) V.forceOthers = true;
  // свет ночью (ночные радиусы зависят от него)
  const night = game.time.nightFactor;
  if (night > 0.02) {
    if (tick - V.litTick >= 30) {
      V.litTick = tick;
      updateLit(V);
      V.forceOthers = true;
      V.forceLeader = true;
    }
  } else if (V.litOn) {
    V.litOn = false;
    V.forceLeader = V.forceOthers = true;
  }
  const L = game.getLeader();
  const key = L ? `${L.id}|${Math.floor(L.x)},${Math.floor(L.y)}|${V.opaqueStamp}|${V.viewing ? 1 : 0}|${Math.round(night * 20)}` : '-';
  if (V.forceLeader || key !== V.leaderKey || tick - V.leaderTick >= 60) {
    V.forceLeader = false;
    V.leaderKey = key;
    V.leaderTick = tick;
    castLeader(V);
    changed = true;
  }
  if (V.forceOthers || tick - V.othersTick >= 20) {
    V.forceOthers = false;
    V.othersTick = tick;
    castOthers(V);
    changed = true;
  }
  if (changed) bump(V);
  if (tick % 15 === 0) updateLastKnown(V);
  if (tick - V.onlyLeaderTick >= 60) rescanOnlyLeader(V);
}

// ---------------------------------------------------------------- запросы
export function tileK(V, tx, ty) {
  tx = Math.floor(tx);
  ty = Math.floor(ty);
  if (!V.vis || tx < 0 || ty < 0 || tx >= V.w || ty >= V.h) return -1;
  return ty * V.w + tx;
}

export function isVisible(V, tx, ty) {
  if (!V.enabled) return true;
  if (!V.vis) return !V.game.map; // карты ещё нет — не мешаем
  const k = tileK(V, tx, ty);
  return k >= 0 && V.vis[k] !== 0;
}

export function isExplored(V, tx, ty) {
  if (!V.enabled) return true;
  if (!V.vis) return !V.game.map;
  const k = tileK(V, tx, ty);
  return k >= 0 && V.explored[k] !== 0;
}

export function leaderSees(V, tx, ty) {
  if (!V.enabled) return true;
  const k = tileK(V, tx, ty);
  return k >= 0 && (V.vis[k] & BIT.LEADER) !== 0;
}

/** Видит ли пешка клетку своими глазами (радиус, ночь, свет, стены). */
export function canPawnSee(V, pawn, tx, ty) {
  if (!V.enabled) return true;
  if (!pawn || pawn.dead || !V.vis) return false;
  const game = V.game;
  if (pawn === game.getLeader() && pawn.controlled === 'player') return leaderSees(V, tx, ty);
  if (pawn.asleep || pawn.downed) return false;
  const k = tileK(V, tx, ty);
  if (k < 0) return false;
  const px = Math.floor(pawn.x);
  const py = Math.floor(pawn.y);
  const dx = Math.floor(tx) + 0.5 - (px + 0.5);
  const dy = Math.floor(ty) + 0.5 - (py + 0.5);
  const d2 = dx * dx + dy * dy;
  const R = CREW_RADIUS;
  if (d2 > R * R) return false;
  const near = nightRadius(R, game.time.nightFactor);
  if (d2 > near * near && !(V.litOn && V.lit[k])) return false;
  return clearLine(V.w, V.opaque, px, py, Math.floor(tx), Math.floor(ty));
}

/** Свободна ли линия между точками от стен и закрытых дверей (деревья не мешают) — для слуха и голоса. */
export function wallsBetween(V, x0, y0, x1, y1) {
  if (!V.vis) return false;
  return !clearLine(V.w, V.opaqueTall, Math.floor(x0), Math.floor(y0), Math.floor(x1), Math.floor(y1));
}

/** Видна ли сущность игроку (учитывает «только для глаз лидера», статичные — по исследованному). */
export function isEntityVisible(V, e) {
  if (!V.enabled || !e) return true;
  if (e.onlyLeaderSees) return !V.viewing && leaderSees(V, e.x, e.y);
  if (e.kind === 'pawn' || e.kind === 'projectile' || e.kind === 'item') return isVisible(V, e.x, e.y);
  return isExplored(V, e.x, e.y);
}

// ---------------------------------------------------------------- последнее известное, «только лидеру»
function updateLastKnown(V) {
  const game = V.game;
  const tick = game.time.tick;
  for (const p of game.entities.ofKind('pawn')) {
    if (p.dead) continue;
    if (!isEntityVisible(V, p)) continue;
    let r = V.lastKnown.get(p.id);
    if (!r) V.lastKnown.set(p.id, (r = { x: 0, y: 0, tick: 0 }));
    r.x = Math.round(p.x * 10) / 10;
    r.y = Math.round(p.y * 10) / 10;
    r.tick = tick;
  }
}

export function lastKnown(V, id) {
  const game = V.game;
  const e = game.entities.get(id);
  if (e && !e.dead && isEntityVisible(V, e)) return { x: e.x, y: e.y, tick: game.time.tick, visible: true };
  const r = V.lastKnown.get(id);
  return r ? { x: r.x, y: r.y, tick: r.tick, visible: false } : null;
}

function rescanOnlyLeader(V, full = false) {
  const game = V.game;
  V.onlyLeaderTick = game.time.tick;
  if (full) V.onlyLeader.clear();
  for (const p of game.entities.ofKind('pawn')) {
    if (p.onlyLeaderSees && !p.dead) V.onlyLeader.add(p.id);
    else V.onlyLeader.delete(p.id);
  }
  if (full) for (const kind of ['building', 'item', 'corpse']) for (const e of game.entities.ofKind(kind)) if (e.onlyLeaderSees) V.onlyLeader.add(e.id);
}

/** Рендер: пометить клетки «только для лидера» сущностей, которые сейчас не видны его глазам (или все — для камер). */
export function prepareRenderHide(V, all) {
  const hide = V.renderHide;
  if (!hide) return;
  const game = V.game;
  if (V._hidden) for (const k of V._hidden) hide[k] = 0;
  const list = (V._hidden ||= []);
  list.length = 0;
  for (const id of V.onlyLeader) {
    const e = game.entities.get(id);
    if (!e) continue;
    if (!all && !V.viewing && leaderSees(V, e.x, e.y)) continue;
    const k = tileK(V, e.x, e.y);
    if (k < 0) continue;
    hide[k] = 1;
    list.push(k);
  }
}

// ---------------------------------------------------------------- открыть область (поезд, отладка, сюжет)
export function reveal(V, x0, y0, x1, y1) {
  if (!ensure(V)) return 0;
  let n = 0;
  for (let y = Math.max(0, y0); y <= Math.min(V.h - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(V.w - 1, x1); x++) {
      const k = y * V.w + x;
      if (!V.explored[k]) {
        V.explored[k] = 1;
        n++;
      }
    }
  V.exploredCount += n;
  if (n) bump(V);
  return n;
}

export function revealTrain(V) {
  const train = V.game.train;
  if (!train?.stamped) return;
  for (const car of train.cars) {
    const r = car.rect;
    if (r) reveal(V, r.x - 1, r.y - 1, r.x + r.w, r.y + r.h);
  }
}

// ---------------------------------------------------------------- топливо (кристаллы маны)
function fuelTick(V) {
  const game = V.game;
  refreshSources(V);
  for (const id of V.sources) {
    const e = game.entities.get(id);
    const def = e && bdef(game, e);
    if (!def?.fuel || e.blueprint) continue;
    const before = fuelOf(game, e);
    if (!(before > 0)) continue;
    e.fuel = Math.max(0, Math.round((before - def.fuel.perDay / 24) * 1e4) / 1e4);
    if (e.fuel <= 0) {
      game.api.ui.notify(game.t('vision.msg.outOfFuel', { name: game.t(def.nameKey) }), { type: 'bad', x: e.x, y: e.y });
      V.forceOthers = true;
    }
  }
}

// ---------------------------------------------------------------- регистрация
export function registerSight(game, V) {
  const ev = game.events;
  ev.on(EVENTS.WORLD_RESET, () => {
    V.map = null;
    V.vis = null;
    V.lastKnown.clear();
    V.onlyLeader.clear();
    V.viewing = false;
    V.deadCams.length = 0;
    V.camOrder.length = 0;
    V.sources.length = 0;
    V.doors.length = 0;
    V.sourcesDirty = V.doorsDirty = true;
    V.leaderKey = '';
    V.onlyLeaderTick = -1e9;
  }, O);
  ev.on(EVENTS.MAP_GENERATED, () => ensure(V), O);
  ev.on(EVENTS.MAP_CHANGED, ({ x, y, w, h }) => markDirty(V, x, y, w, h), O);
  ev.on(EVENTS.TRAIN_STAMPED, () => {
    ensure(V);
    revealTrain(V);
    V.doorsDirty = V.sourcesDirty = true;
    V.forceLeader = V.forceOthers = true;
  }, O);
  const onBuilding = (e) => {
    if (!e) return;
    if (e.onlyLeaderSees) V.onlyLeader.add(e.id);
    if (e.kind !== 'building') return;
    const def = bdef(game, e);
    if (!def) return;
    if (def.door) V.doorsDirty = true;
    if (def.vision || def.visionLink) {
      V.sourcesDirty = true;
      V.forceOthers = true;
    }
  };
  ev.on(EVENTS.ENTITY_SPAWNED, ({ entity }) => onBuilding(entity), O);
  ev.on(EVENTS.ENTITY_REMOVED, ({ entity, reason }) => {
    onBuilding(entity);
    V.onlyLeader.delete(entity.id);
    if (entity.kind === 'pawn' && reason !== 'died') V.lastKnown.delete(entity.id);
    if (entity.defId === DEF.CAMERA && reason !== 'train' && reason !== 'relocated' && V.camOrder.includes(entity.id)) {
      V.deadCams.push({ id: entity.id, tick: game.time.tick, x: entity.x, y: entity.y });
    }
  }, O);
  const rebuild = () => {
    if (!ensure(V)) return;
    revealTrain(V);
    V.doorsDirty = V.sourcesDirty = true;
    V.forceLeader = V.forceOthers = true;
    V.leaderKey = '';
    rescanOnlyLeader(V, true);
    visionTick(V);
  };
  ev.on(EVENTS.COLONY_STARTED, rebuild, O);
  ev.on(EVENTS.STATION_CHANGED, rebuild, O);
  ev.on(EVENTS.LOAD_AFTER, rebuild, O);
  ev.on(EVENTS.LEADER_CHANGED, () => {
    V.forceLeader = true;
    V.viewing = false;
  }, O);
  ev.on(EVENTS.TIME_HOUR, () => fuelTick(V), O);

  game.systems.add({ id: 'vision', order: 55, update: () => visionTick(V) }, O);

  // сохранение: исследованное (RLE), последнее известное, разбитые камеры
  game.save.registerSerializer({
    id: 'vision',
    order: 75,
    save(g) {
      if (!V.vis) return null;
      const lk = [];
      for (const [id, r] of V.lastKnown) if (g.entities.get(id)?.faction === 'colony' || !g.entities.get(id)) lk.push([id, r.x, r.y, r.tick]);
      return {
        w: V.w,
        h: V.h,
        explored: rleEncode(V.explored),
        lastKnown: lk.slice(-200),
        deadCams: V.deadCams.slice(-8),
        camOrder: V.camOrder.slice(),
      };
    },
    load(g, d) {
      if (!d || !ensure(V)) return;
      if (d.w === V.w && d.h === V.h && d.explored) {
        rleDecode(d.explored, V.explored);
        let n = 0;
        for (let i = 0; i < V.n; i++) n += V.explored[i];
        V.exploredCount = n;
      }
      V.lastKnown.clear();
      for (const [id, x, y, tick] of d.lastKnown || []) V.lastKnown.set(id, { x, y, tick });
      V.deadCams = (d.deadCams || []).slice();
      V.camOrder = (d.camOrder || []).slice();
    },
  }, O);
}

export { TICKS_HOUR, LIGHTHOUSE_RADIUS };
