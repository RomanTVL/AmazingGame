// Линия видимости: рекурсивный shadowcasting (Björn Bergström) по 8 октантам + проверка луча (Брезенхем).
// Чистые функции без DOM и без аллокаций в горячем цикле (общий контекст переиспользуется).
//
// shadowcast(opts): отмечает видимые клетки в out[k] |= bit.
//   w, h        — размер карты
//   ox, oy      — клетка-источник
//   radius      — дальность (клетки, дробная)
//   near        — дальность «без света» (ночью): клетки дальше near видны, только если lit[k] (null — всё до radius)
//   opaque      — Uint8Array (1 = закрывает обзор)
//   lit         — Uint8Array | null (1 = освещено)
//   out, bit    — куда писать
//   collect     — массив для индексов видимых клеток (или null)

const OCT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1],
];

const C = { w: 0, h: 0, ox: 0, oy: 0, r: 0, r2: 0, n2: 0, opaque: null, lit: null, out: null, bit: 1, collect: null, count: 0 };

function mark(k) {
  const out = C.out;
  if ((out[k] & C.bit) === 0) {
    out[k] |= C.bit;
    if (C.collect) C.collect.push(k);
  }
  C.count++;
}

function castLight(row, start, end, xx, xy, yx, yy) {
  if (start < end) return;
  const { w, h, ox, oy, r, r2, n2, opaque, lit } = C;
  let newStart = 0;
  for (let j = row; j <= r; j++) {
    let dx = -j - 1;
    const dy = -j;
    let blocked = false;
    while (dx <= 0) {
      dx++;
      const X = ox + dx * xx + dy * xy;
      const Y = oy + dx * yx + dy * yy;
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);
      if (start < rSlope) continue;
      if (end > lSlope) break;
      const inb = X >= 0 && Y >= 0 && X < w && Y < h;
      const k = Y * w + X;
      if (inb) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2 && (d2 <= n2 || (lit !== null && lit[k] === 1))) mark(k);
      }
      const blocking = !inb || opaque[k] === 1;
      if (blocked) {
        if (blocking) {
          newStart = rSlope;
          continue;
        }
        blocked = false;
        start = newStart;
      } else if (blocking && j < r) {
        blocked = true;
        castLight(j + 1, start, lSlope, xx, xy, yx, yy);
        newStart = rSlope;
      }
    }
    if (blocked) break;
  }
}

/** @returns {number} сколько клеток просмотрено (для статистики) */
export function shadowcast(o) {
  const w = o.w;
  const h = o.h;
  const ox = o.ox | 0;
  const oy = o.oy | 0;
  if (ox < 0 || oy < 0 || ox >= w || oy >= h) return 0;
  const radius = Math.max(0.5, o.radius);
  const near = o.near == null ? radius : Math.min(radius, Math.max(0.5, o.near));
  C.w = w;
  C.h = h;
  C.ox = ox;
  C.oy = oy;
  C.r = Math.ceil(radius);
  C.r2 = radius * radius;
  C.n2 = near * near;
  C.opaque = o.opaque;
  C.lit = o.lit || null;
  C.out = o.out;
  C.bit = o.bit || 1;
  C.collect = o.collect || null;
  C.count = 0;
  mark(oy * w + ox);
  for (let i = 0; i < 8; i++) castLight(1, 1, 0, OCT[0][i], OCT[1][i], OCT[2][i], OCT[3][i]);
  C.opaque = C.lit = C.out = C.collect = null;
  return C.count;
}

/**
 * Свободен ли луч между клетками (концы не проверяются): Брезенхем по маске opaque.
 * @returns {boolean}
 */
export function clearLine(w, opaque, x0, y0, x1, y1) {
  x0 |= 0;
  y0 |= 0;
  x1 |= 0;
  y1 |= 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if (x === x1 && y === y1) return true;
    if ((x !== x0 || y !== y0) && opaque[y * w + x] === 1) return false;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Первая клетка по лучу (от источника к цели), для которой pred(k) === true; иначе null.
 * Возвращает {x, y} (центр клетки) — используется для значка шума «на краю тумана».
 */
export function firstAlongLine(w, h, x0, y0, x1, y1, pred) {
  x0 |= 0;
  y0 |= 0;
  x1 |= 0;
  y1 |= 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if (x >= 0 && y >= 0 && x < w && y < h && pred(y * w + x)) return { x: x + 0.5, y: y + 0.5 };
    if (x === x1 && y === y1) return null;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Многоугольник «кольца голоса»: для n лучей из (cx, cy) — радиус, до которого доходит голос:
 * R без преград; если луч упёрся в стену раньше — max(расстояние до стены, R/2).
 * @returns {Float32Array} n радиусов
 */
export function voicePolygon(w, h, opaque, cx, cy, R, n = 72) {
  const out = new Float32Array(n);
  const step = 0.35;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let wall = Infinity;
    let px = Math.floor(cx);
    let py = Math.floor(cy);
    for (let d = step; d <= R; d += step) {
      const x = Math.floor(cx + ca * d);
      const y = Math.floor(cy + sa * d);
      if (x === px && y === py) continue;
      px = x;
      py = y;
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      if (opaque[y * w + x] === 1) {
        wall = d;
        break;
      }
    }
    out[i] = wall >= R ? R : Math.max(wall, R / 2);
  }
  return out;
}
