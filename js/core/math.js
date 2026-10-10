// Математические помощники. Чистые функции, без состояния.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
/** Экспоненциальное сглаживание, не зависящее от частоты кадров. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const approach = (cur, target, step) =>
  cur < target ? Math.min(cur + step, target) : Math.max(cur - step, target);
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};
/** Расстояние Чебышёва (клетки по 8 направлениям). */
export const chebyshev = (ax, ay, bx, by) => Math.max(Math.abs(bx - ax), Math.abs(by - ay));
export const manhattan = (ax, ay, bx, by) => Math.abs(bx - ax) + Math.abs(by - ay);
/** Октильная эвристика для A* (диагональ = √2). */
export const octile = (dx, dy) => {
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  return dx > dy ? dx + 0.41421356 * dy : dy + 0.41421356 * dx;
};

export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const angleDiff = (a, b) => wrapAngle(b - a);
export const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;

// --- Векторы (объекты {x, y}) ---
export const vec = (x = 0, y = 0) => ({ x, y });
export const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const vscale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const vlen = (a) => Math.hypot(a.x, a.y);
export const vdot = (a, b) => a.x * b.x + a.y * b.y;
export const vnorm = (a) => {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const vrot = (a, ang) => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
export const vfromAngle = (ang, len = 1) => ({ x: Math.cos(ang) * len, y: Math.sin(ang) * len });

// --- Отрезки и прямоугольники ---
/** Расстояние от точки до отрезка AB. */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp01(t);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Пересекаются ли отрезки AB и CD. */
export function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Обход клеток по линии (Брезенхем) от (x0,y0) до (x1,y1) включительно.
 * cb(x, y) может вернуть false, чтобы остановить обход. Возвращает true, если дошли до конца.
 * Полезно для линии видимости (модуль vision) и выстрелов (combat).
 */
export function lineTiles(x0, y0, x1, y1, cb) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (cb(x0, y0) === false) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export const rectContains = (rx, ry, rw, rh, x, y) => x >= rx && y >= ry && x < rx + rw && y < ry + rh;
export const rectsOverlap = (ax, ay, aw, ah, bx, by, bw, bh) =>
  ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;

/** Нормализованный прямоугольник из двух углов (для выделения мышью). */
export function rectFromPoints(x0, y0, x1, y1) {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

// --- Хеши для детерминированной «случайной» косметики ---
/** 32-битный хеш двух целых (для косметики и шума; не меняет RNG). */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}
/** Хеш в [0, 1). */
export const hash01 = (x, y, seed = 0) => hash2(x, y, seed) / 4294967296;

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export const TAU = Math.PI * 2;
