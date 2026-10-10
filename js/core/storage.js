// Абстракция хранилища: localStorage в браузере, память в Node/приватном режиме.

class MemoryStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
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
    try {
      return this.b.getItem(k);
    } catch {
      return this.fallback.getItem(k);
    }
  }
  setItem(k, v) {
    try {
      this.b.setItem(k, v);
    } catch {
      this.fallback.setItem(k, v);
    }
  }
  removeItem(k) {
    try {
      this.b.removeItem(k);
    } catch {
      this.fallback.removeItem(k);
    }
  }
  keys() {
    try {
      const out = [];
      for (let i = 0; i < this.b.length; i++) out.push(this.b.key(i));
      return out;
    } catch {
      return this.fallback.keys();
    }
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
