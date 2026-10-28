// Абстракция хранилища: localStorage в браузере, память в Node/приватном режиме.

class MemoryStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  /** @returns {boolean} записано ли */
  setItem(k, v) {
    this.m.set(k, String(v));
    return true;
  }
  removeItem(k) {
    this.m.delete(k);
  }
  keys() {
    return [...this.m.keys()];
  }
}

/** Обёртка с try/catch: localStorage может бросать (квота, приватный режим). */
class SafeStorage {
  constructor(backend) {
    this.b = backend;
    this.fallback = new MemoryStorage();
  }
  getItem(k) {
    const mem = this.fallback.getItem(k);
    if (mem !== null) return mem; // запасная копия свежее (запись в localStorage не удалась)
    try {
      return this.b.getItem(k);
    } catch {
      return null;
    }
  }
  /** @returns {boolean} false — localStorage отказал (квота/приватный режим), значение только в памяти вкладки */
  setItem(k, v) {
    try {
      this.b.setItem(k, v);
      this.fallback.removeItem(k);
      return true;
    } catch {
      this.fallback.setItem(k, v);
      return false;
    }
  }
  removeItem(k) {
    this.fallback.removeItem(k);
    try {
      this.b.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  keys() {
    const out = new Set(this.fallback.keys());
    try {
      for (let i = 0; i < this.b.length; i++) out.add(this.b.key(i));
    } catch {
      /* ignore */
    }
    return [...out];
  }
}

export function createStorage(forceMemory = false) {
  if (!forceMemory) {
    try {
      const ls = globalThis.localStorage;
      if (ls) {
        const k = '__lt_test__';
        ls.setItem(k, '1');
        ls.removeItem(k);
        return new SafeStorage(ls);
      }
    } catch {
      /* нет доступа — память */
    }
  }
  return new MemoryStorage();
}
