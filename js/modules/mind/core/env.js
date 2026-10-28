// Окружение: индекс мебели (столы, сиденья, источники тепла, окна, таблички памяти), красота, комфорт, температура.
import { NEEDS } from '../constants.js';
import { carAt, num, safeCall, provided } from './util.js';

const RELEVANT = (def) => !!def && !def.natural && (def.table || def.sittable || def.heat || def.window || def.plaque || def.bed ||
  def.id === 'window_bench' || def.id === 'memorial_plaque' || Number.isFinite(def.beauty) || Number.isFinite(def.comfort));

/** Пометить индекс устаревшим, если изменилась «значимая» постройка. */
export function touchFurniture(M, e) {
  if (!e || e.kind !== 'building') return;
  if (RELEVANT(M.game.defs.buildings.get(e.defId))) M.R.furnDirty = true;
}

/** Индекс мебели (лениво). */
export function furniture(M) {
  const R = M.R;
  if (R.furn && !R.furnDirty) return R.furn;
  const game = M.game;
  const f = { heat: [], tables: [], seats: [], plaques: [], windows: [], benches: [], smashable: [] };
  for (const b of game.entities.ofKind('building')) {
    const def = game.defs.buildings.get(b.defId);
    if (!def || def.natural || b.blueprint) continue;
    if (def.heat) f.heat.push(b);
    if (def.table) f.tables.push(b);
    if (def.sittable) f.seats.push(b);
    if (def.plaque || def.id === 'memorial_plaque') f.plaques.push(b);
    if (def.id === 'window_bench') f.benches.push(b);
    if (def.window) f.windows.push(b);
    if (!b.train && !def.indestructible && !def.door && def.category !== 'structure' && def.category !== 'train' && (def.table || def.sittable || def.bed || def.category === 'furniture' || def.category === 'light' || def.category === 'misc')) f.smashable.push(b);
  }
  R.furn = f;
  R.furnDirty = false;
  return f;
}

export function centerOf(b) {
  return { x: b.x + (b.w || 1) / 2, y: b.y + (b.h || 1) / 2 };
}

/** Расстояние от точки до прямоугольника постройки (в клетках). */
export function distToBuilding(x, y, b) {
  const dx = Math.max(b.x - x, 0, x - (b.x + (b.w || 1)));
  const dy = Math.max(b.y - y, 0, y - (b.y + (b.h || 1)));
  return Math.hypot(dx, dy);
}

/** Температура в точке, °C: снаружи (journey) + тепло вагона/построек (build.getWarmthAt или свой расчёт). */
export function temperatureAt(M, x, y) {
  const game = M.game;
  let t = num(safeCall(game, 'temp', () => game.api.journey.getAmbientTemp(), 15), 15);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (typeof game.api.build?.getWarmthAt === 'function' && provided(game, 'build', 'getWarmthAt')) {
    return t + num(safeCall(game, 'warmth', () => game.api.build.getWarmthAt(tx, ty), 0), 0);
  }
  const map = game.map;
  if (!map || !map.inBounds(tx, ty)) return t;
  const car = carAt(game, tx, ty);
  if (car) t += 4 + num(safeCall(game, 'carHeat', () => game.api.journey.getCarHeat(car.index), 0), 0);
  else if (map.room[map.idx(tx, ty)] > 0) t += 3;
  for (const b of furniture(M).heat) {
    const def = game.defs.buildings.get(b.defId);
    const r = num(def?.heat?.radius, 3);
    const d = distToBuilding(x, y, b);
    if (d <= r) t += num(def.heat.warmth, 8) * (1 - d / (r + 1));
  }
  return t;
}

/** Цель потребности «тепло» по температуре. */
export function warmthTarget(temp) {
  if (temp < NEEDS.tempComfortLow) return Math.max(0, 1 - (NEEDS.tempComfortLow - temp) / 24);
  if (temp > NEEDS.tempComfortHigh) return Math.max(0.3, 1 - (temp - NEEDS.tempComfortHigh) / 22);
  return 1;
}

const _q = [];

/** Красота окружения 0..1 (радиус 3): мебель/декор (def.beauty), полы, растения, трупы и кровь. */
export function beautyAt(M, x, y) {
  const game = M.game;
  const map = game.map;
  if (!map) return 0.5;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  let s = 0;
  _q.length = 0;
  game.entities.queryRect(tx - 3, ty - 3, tx + 3, ty + 3, 'building', _q);
  for (const b of _q) {
    const def = game.defs.buildings.get(b.defId);
    if (!def) continue;
    if (Number.isFinite(def.beauty)) s += def.beauty;
    else if (def.natural) s += 0.05;
    if (b.hp !== undefined && def.hp && b.hp < def.hp * 0.5) s -= 0.5;
  }
  _q.length = 0;
  game.entities.queryRect(tx - 2, ty - 2, tx + 2, ty + 2, 'plant', _q);
  for (const p of _q) s += 0.12 * num(p.growth, 1);
  _q.length = 0;
  game.entities.queryRect(tx - 3, ty - 3, tx + 3, ty + 3, 'corpse', _q);
  s -= _q.length * 3;
  _q.length = 0;
  game.entities.queryRect(tx - 2, ty - 2, tx + 2, ty + 2, 'decal', _q);
  s -= Math.min(4, _q.length * 0.4);
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const fd = map.floorDef(tx + dx, ty + dy);
      if (fd && Number.isFinite(fd.beauty)) s += fd.beauty * 0.25;
    }
  _q.length = 0;
  return Math.max(0, Math.min(1, 0.45 + s * 0.06));
}

/** Есть ли рядом непогребённое тело (для ситуативной мысли). */
export function corpseNear(M, x, y) {
  _q.length = 0;
  M.game.entities.queryRect(Math.floor(x) - 3, Math.floor(y) - 3, Math.floor(x) + 3, Math.floor(y) + 3, 'corpse', _q);
  const n = _q.some((c) => c.faction === 'colony' || c.faction === undefined);
  _q.length = 0;
  return n;
}

/** Комфорт места: сиденье/кровать под пешкой → значение 0..1 или null (не сидит/не лежит). */
export function comfortTarget(M, p) {
  const game = M.game;
  const map = game.map;
  if (!map) return null;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  const b = map.inBounds(tx, ty) ? game.entities.get(map.building[map.idx(tx, ty)]) : null;
  const def = b ? game.defs.buildings.get(b.defId) : null;
  if (p.asleep) {
    if (def?.bed) return 0.35 + 0.65 * num(def.comfort, 0.6);
    return 0.12;
  }
  if (p.pose === 'sit' || p.pose === 'window' || p.pose === 'toast') {
    if (def?.sittable) return 0.3 + 0.7 * num(def.comfort, 0.5);
    return 0.3;
  }
  return null;
}
