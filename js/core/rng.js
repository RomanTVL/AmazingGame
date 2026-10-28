// Детерминированный генератор случайных чисел (mulberry32).
// ВАЖНО: в симуляции используйте только game.rng (или его fork), никогда Math.random.

/** FNV-1a хеш строки → uint32. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  /** @param {number|string} seed */
  constructor(seed = 1) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    if (this.seed === 0) this.seed = 0x9e3779b9;
    this.state = this.seed;
  }

  /** Число в [0, 1). */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Вещественное в [min, max). */
  range(min, max) {
    return min + (max - min) * this.next();
  }

  /** Целое в [min, max] включительно. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr.length ? arr[Math.floor(this.next() * arr.length)] : undefined;
  }

  /** Взвешенный выбор: items — массив, weight(item) → число ≥ 0. */
  weighted(items, weight) {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Нормальное распределение (Бокс–Мюллер). */
  normal(mean = 0, sd = 1) {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Независимый поток, зависящий только от исходного сида и метки.
   * Используйте для подсистем (worldgen, имена), чтобы не сбивать основной поток.
   */
  fork(label) {
    return new RNG((hashString(String(label)) ^ Math.imul(this.seed, 2654435761)) >>> 0);
  }

  getState() {
    return { seed: this.seed, state: this.state };
  }

  setState(s) {
    this.seed = s.seed >>> 0;
    this.state = s.state >>> 0;
  }
}
