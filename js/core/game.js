// Game — корневой объект. Создаётся через createGame() (js/core/boot.js).
// Форма объекта (контракт для модулей) описана в docs/ARCHITECTURE.md, раздел «Объект Game».
import { EventBus, EVENTS } from './events.js';
import { DefRegistries } from './registry.js';
import { RNG } from './rng.js';
import { Settings } from './settings.js';
import { I18n, setActiveI18n } from './i18n.js';
import { SaveManager } from './save.js';
import { createStorage } from './storage.js';
import { createApi } from './api.js';
import { DT, SPEEDS, FACTION } from './constants.js';
import { Clock } from '../sim/time.js';
import { SystemRegistry } from '../sim/systems.js';
import { EntityManager } from '../sim/entities.js';
import { Pathfinder } from '../sim/pathfinding.js';
import { JobManager, DesignationManager } from '../sim/jobs.js';
import { ItemManager, ZoneManager } from '../sim/items.js';
import { AIManager } from '../ai/ai.js';
import { Input } from '../engine/input.js';
import { Camera } from '../engine/camera.js';
import { UI } from '../engine/ui.js';
import { AudioEngine } from '../engine/audio.js';
import { Particles } from '../engine/particles.js';
import { RenderRegistry } from '../render/renderer.js';

export class Game {
  /**
   * @param {{headless?: boolean, seed?: number|string, storage?: object}} [opts]
   */
  constructor(opts = {}) {
    this.isHeadless = !!opts.headless;
    this.errors = [];
    this.events = new EventBus();
    this.events.onError = (err, name, owner) => this.error(err, `event:${name}(${owner})`);
    this.storage = opts.storage || createStorage(this.isHeadless);
    this.settings = new Settings(this.storage, this.events);
    this.i18n = new I18n(this.settings);
    setActiveI18n(this.i18n);
    this.seed = opts.seed ?? 12345;
    this.rng = new RNG(this.seed);

    // реестры определений
    this.defs = new DefRegistries();
    this.defs.create('designations');
    this.defs.create('sfx');
    this.defs.create('fxPresets');

    // системы
    this.systems = new SystemRegistry(this, 'systems');
    this.frameSystems = new SystemRegistry(this, 'frame');

    // мир
    this.time = new Clock(this);
    this.map = null;
    this.train = null;
    this.entities = new EntityManager(this);
    this.pathfinder = new Pathfinder(this);
    this.jobs = new JobManager(this);
    this.jobs.registerDefs();
    this.designations = new DesignationManager(this);
    this.zones = new ZoneManager(this);
    this.items = new ItemManager(this);
    this.ai = new AIManager(this);
    this.colony = { leaderId: 0, heirId: 0, name: '', lost: false };
    /** Видимость (модуль vision заменит). enabled=false → всё видно, туман не рисуется. */
    this.vision = {
      enabled: false,
      version: 0,
      isVisible: (tx, ty) => this.api.vision.isVisible(tx, ty),
      isExplored: (tx, ty) => this.api.vision.isExplored(tx, ty),
    };
    this.log = [];
    this.stats = { jobsDone: 0, jobsFailed: 0, ticks: 0 };

    // межмодульные вызовы
    this.api = createApi(this);
    this.providers = {};

    // сохранения
    this.save = new SaveManager(this);

    // движок (DOM подключается позже в main.js; в headless — виртуальный)
    this.input = new Input(this);
    this.camera = new Camera(this);
    this.ui = new UI(this);
    this.audio = new AudioEngine(this);
    this.fx = new Particles(this);
    this.render = new RenderRegistry(this);
    this.player = null; // PlayerController (js/player/controller.js)

    // время
    this.speed = 1;
    this.paused = false;
    this.initialized = false;
    this.modules = [];
  }

  /** Короткий перевод. */
  t(key, vars) {
    return this.i18n.t(key, vars);
  }

  /** Записать ошибку (не роняя игру). В тестах errors.length > 0 = провал. */
  error(err, where = '?') {
    this.errors.push({ where, message: String(err?.message || err), stack: err?.stack });
    if (this.errors.length > 200) this.errors.shift();
    console.error(`[game:${where}]`, err);
  }

  /**
   * Переопределить функции межмодульного API: game.provide('health', { applyDamage(...) {...} }, 'health')
   */
  provide(ns, impl, owner = ns) {
    this.api[ns] ||= {};
    for (const [k, fn] of Object.entries(impl)) {
      this.api[ns][k] = fn;
      (this.providers[ns] ||= {})[k] = owner;
    }
  }

  /** Вызывается после регистрации всех модулей. */
  init() {
    if (this.initialized) return;
    this.systems.init();
    this.frameSystems.init();
    this.initialized = true;
    this.events.emit(EVENTS.GAME_INIT, { game: this });
  }

  reseed(seed) {
    this.seed = seed;
    this.rng = new RNG(seed);
  }

  /** Установить карту (сбрасывает зависимые кэши). */
  setMap(map) {
    this.map = map;
    this.zones.cellZone = null;
    this.zones._ensure();
    this.pathfinder.n = 0;
  }

  /** Очистить мир перед новой колонией / загрузкой. */
  resetWorld() {
    if (this.train) this.train = null;
    this.entities.clear();
    this.designations.clear();
    this.zones.clear();
    this.jobs.reservations.clear();
    this.map = null;
    this.colony = { leaderId: 0, heirId: 0, name: '', lost: false };
    this.time.tick = 0;
    this.time.startHour = 7;
  }

  // ---------- Время ----------
  get speedIndex() {
    return this.paused ? 0 : this.speed;
  }

  setSpeed(s) {
    s = Math.max(1, Math.min(SPEEDS.length - 1, s | 0));
    this.speed = s;
    this.paused = false;
    this.events.emit(EVENTS.GAME_SPEED, { speed: this.speed, paused: this.paused });
  }

  togglePause(v) {
    this.paused = v === undefined ? !this.paused : !!v;
    this.events.emit(EVENTS.GAME_SPEED, { speed: this.speed, paused: this.paused });
  }

  /** Один тик симуляции (1/60 с игрового времени). */
  step() {
    this.time.advance();
    this.stats.ticks++;
    this.systems.run(DT);
  }

  /** Логика кадра (ввод, камера, UI): реальное dt. */
  frame(dtReal) {
    this.frameSystems.run(dtReal);
  }

  // ---------- Помощники ----------
  getLeader() {
    const p = this.entities.get(this.colony.leaderId);
    return p && !p.dead ? p : null;
  }

  /** Живые поселенцы колонии (включая лидера). */
  colonists() {
    const out = [];
    for (const p of this.entities.ofKind('pawn')) if (!p.dead && p.faction === FACTION.COLONY) out.push(p);
    return out;
  }

  defOf(e) {
    return this.entities.defOf(e);
  }
}
