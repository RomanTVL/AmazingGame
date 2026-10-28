// Универсальные реестры определений (defs). Всё расширяемое содержимое игры —
// предметы, постройки, работы, звуки, слои отрисовки — хранится в реестрах.
// Модули добавляют записи через registry.add(def, 'имяМодуля') и НЕ правят файлы ядра.

export class Registry {
  /**
   * @param {string} name
   * @param {object} [opts]
   * @param {object} [opts.defaults] — поля по умолчанию для каждой записи
   * @param {boolean} [opts.indexed] — присваивать def.index (стабильный номер; для Uint8-слоёв карты)
   * @param {string} [opts.sortBy] — поддерживать сортировку all() по этому числовому полю (например 'order')
   * @param {(def: object) => void} [opts.validate] — бросает Error при некорректной записи
   */
  constructor(name, opts = {}) {
    this.name = name;
    this.opts = opts;
    /** @type {Map<string, any>} */
    this.map = new Map();
    this.list = [];
    this.byIndexList = [];
    this.listeners = [];
  }

  /**
   * Добавить запись. Повтор id — ошибка, если не указано def.override = true
   * (тогда запись заменяется, индекс сохраняется).
   */
  add(def, owner = 'core') {
    if (!def || typeof def.id !== 'string' || !def.id) {
      throw new Error(`[registry:${this.name}] запись без id`);
    }
    const prev = this.map.get(def.id);
    if (prev && !def.override) {
      throw new Error(`[registry:${this.name}] дубликат id "${def.id}" (владелец ${prev.owner}, добавляет ${owner})`);
    }
    const full = this.opts.defaults ? { ...this.opts.defaults, ...def } : def;
    full.owner = owner;
    if (this.opts.validate) this.opts.validate(full);
    if (this.opts.indexed) {
      full.index = prev ? prev.index : this.byIndexList.length;
      this.byIndexList[full.index] = full;
    }
    this.map.set(full.id, full);
    if (prev) this.list[this.list.indexOf(prev)] = full;
    else this.list.push(full);
    if (this.opts.sortBy) {
      const k = this.opts.sortBy;
      this.list.sort((a, b) => (a[k] ?? 0) - (b[k] ?? 0));
    }
    for (const fn of this.listeners) fn(full);
    return full;
  }

  /** Добавить несколько записей. */
  addAll(defs, owner = 'core') {
    return defs.map((d) => this.add(d, owner));
  }

  /** Дополнить/переопределить поля существующей записи (Object.assign). */
  extend(id, patch) {
    const def = this.require(id);
    Object.assign(def, patch);
    if (this.opts.sortBy) {
      const k = this.opts.sortBy;
      this.list.sort((a, b) => (a[k] ?? 0) - (b[k] ?? 0));
    }
    return def;
  }

  remove(id) {
    const def = this.map.get(id);
    if (!def) return false;
    this.map.delete(id);
    this.list.splice(this.list.indexOf(def), 1);
    if (this.opts.indexed) this.byIndexList[def.index] = undefined;
    return true;
  }

  get(id) {
    return this.map.get(id);
  }

  require(id) {
    const d = this.map.get(id);
    if (!d) throw new Error(`[registry:${this.name}] нет записи "${id}"`);
    return d;
  }

  has(id) {
    return this.map.has(id);
  }

  byIndex(i) {
    return this.byIndexList[i];
  }

  /** Массив записей (в порядке добавления или sortBy). Не мутируйте. */
  all() {
    return this.list;
  }

  ids() {
    return this.list.map((d) => d.id);
  }

  filter(fn) {
    return this.list.filter(fn);
  }

  find(fn) {
    return this.list.find(fn);
  }

  get size() {
    return this.list.length;
  }

  /** Подписка на добавление записей (включая будущие). */
  onAdd(fn) {
    this.listeners.push(fn);
  }
}

/** Набор именованных реестров: game.defs.items, game.defs.buildings, ... */
export class DefRegistries {
  constructor() {
    Object.defineProperty(this, '_names', { value: [], enumerable: false });
  }

  /** Создать реестр (или вернуть существующий с тем же именем). */
  create(name, opts = {}) {
    if (this[name]) return this[name];
    const r = new Registry(name, opts);
    this[name] = r;
    this._names.push(name);
    return r;
  }

  names() {
    return this._names.slice();
  }
}
