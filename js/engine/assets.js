// Процедурные «ассеты»: кэшированные канвасы (спрайты, свечения). Создаются лениво — безопасно для headless.

/** Новый канвас (OffscreenCanvas, если есть; иначе <canvas>). */
export function makeCanvas(w, h) {
  w = Math.max(1, Math.ceil(w));
  h = Math.max(1, Math.ceil(h));
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('[assets] нет Canvas (headless?) — не рисуйте в headless-режиме');
}

const cache = new Map();
/** Предел числа спрайтов в кэше: при переполнении выбрасываются самые старые (защита от утечки памяти). */
export const SPRITE_CACHE_MAX = 3000;

/**
 * Получить закэшированный спрайт: key — уникальная строка, draw(ctx, w, h) рисует один раз.
 * Пример: sprite('tree:pine:3', 64, 64, (ctx) => {...})
 * Ключ должен описывать ВСЁ, от чего зависит картинка (цвет, вариант, размер), и иметь конечное число значений.
 */
export function sprite(key, w, h, draw) {
  let c = cache.get(key);
  if (!c) {
    c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    draw(ctx, w, h);
    if (cache.size >= SPRITE_CACHE_MAX) {
      let drop = Math.ceil(SPRITE_CACHE_MAX / 10);
      for (const k of cache.keys()) {
        cache.delete(k);
        if (--drop <= 0) break;
      }
    }
    cache.set(key, c);
  }
  return c;
}

export function clearSpriteCache(prefix) {
  if (!prefix) cache.clear();
  else for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

export function spriteCacheSize() {
  return cache.size;
}
