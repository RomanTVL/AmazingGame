// Реестр систем: упорядоченный список update-функций.
//   game.systems.add({ id, order, update(game, dt), init?(game) })        — тики симуляции (dt = 1/60)
//   game.frameSystems.add({ id, order, update(game, dtReal), init?(game) }) — каждый кадр (ввод, камера, UI-логика)
// Ошибка в системе не роняет игру: она пишется в game.errors (тесты падают при errors.length > 0).

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class SystemRegistry {
  constructor(game, name) {
    this.game = game;
    this.name = name;
    this.list = [];
    this.byId = new Map();
    this.initialized = false;
  }

  /**
   * @param {{id: string, order?: number, update: (game, dt: number) => void, init?: (game) => void, enabled?: boolean}} sys
   * @param {string} [owner]
   */
  add(sys, owner = 'core') {
    if (!sys?.id || typeof sys.update !== 'function') throw new Error(`[systems:${this.name}] нужна {id, update}`);
    if (this.byId.has(sys.id)) throw new Error(`[systems:${this.name}] дубликат ${sys.id}`);
    sys.order ??= 100;
    sys.enabled ??= true;
    sys.owner = owner;
    sys.ms = 0; // скользящее среднее времени, мс
    this.list.push(sys);
    this.list.sort((a, b) => a.order - b.order);
    this.byId.set(sys.id, sys);
    if (this.initialized && sys.init) sys.init(this.game);
    return sys;
  }

  get(id) {
    return this.byId.get(id);
  }

  remove(id) {
    const s = this.byId.get(id);
    if (!s) return false;
    this.byId.delete(id);
    this.list.splice(this.list.indexOf(s), 1);
    return true;
  }

  setEnabled(id, v) {
    const s = this.byId.get(id);
    if (s) s.enabled = v;
  }

  init() {
    this.initialized = true;
    for (const s of this.list) {
      if (!s.init) continue;
      try {
        s.init(this.game);
      } catch (err) {
        this.game.error(err, `${this.name}.init:${s.id}`);
      }
    }
  }

  run(dt) {
    const game = this.game;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      if (!s.enabled) continue;
      const t0 = now();
      try {
        s.update(game, dt);
      } catch (err) {
        game.error(err, `${this.name}:${s.id}`);
      }
      s.ms = s.ms * 0.95 + (now() - t0) * 0.05;
    }
  }
}
