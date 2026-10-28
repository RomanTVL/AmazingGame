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
import { safeNum } from './math.js';
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
import { startNewColony } from '../sim/colony.js';
import { changeStation } from '../sim/station.js';

/**
 * Состояние колонии (сохраняется сериализатором 'meta'; JSON). Модули могут добавлять свои поля.
 * authority 0..100 — авторитет лидера (mind), memory 0..100 — «память» колонии о павших (health),
 * flags — флаги сценария/сюжета (scenario.flags сливаются сюда), objectives — цели для HUD (ui.setObjective).
 */
export function createColonyState() {
  return {
    leaderId: 0, heirId: 0, name: '', lost: false, scenarioId: '', difficulty: 'normal',
    authority: 50, memory: 10, flags: {}, objectives: {},
  };
}

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
    this.colony = createColonyState();
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
    /** Базовый масштаб темпа симуляции (см. get timeScale); замедления — slowMo(). */
    this._timeScale = 1;
    /** id → {scale, leftMs} — активные замедления (реальное время). */
    this._slowMos = new Map();
    this._slowMoId = 0;
    this._errCounts = new Map();
    this.initialized = false;
    this.modules = [];
  }

  /** Короткий перевод. */
  t(key, vars) {
    return this.i18n.t(key, vars);
  }

  /**
   * Записать ошибку (не роняя игру). В тестах errors.length > 0 = провал.
   * Повторы одной и той же ошибки (слой/система падает каждый кадр) пишутся 3 раза, дальше только считаются
   * (errorCounts), чтобы не завалить консоль.
   */
  error(err, where = '?') {
    const message = String(err?.message || err);
    const key = `${where}|${message}`;
    const n = (this._errCounts.get(key) || 0) + 1;
    if (this._errCounts.size > 500) this._errCounts.clear();
    this._errCounts.set(key, n);
    if (n > 3) return;
    this.errors.push({ where, message, stack: err?.stack });
    if (this.errors.length > 200) this.errors.shift();
    console.error(`[game:${where}]${n === 3 ? ' (дальнейшие повторы скрыты)' : ''}`, err);
  }

  /** Сколько раз случалась каждая ошибка: Map 'where|message' → count. */
  get errorCounts() {
    return this._errCounts;
  }

  /**
   * Переопределить функции межмодульного API: game.provide('health', { applyDamage(...) {...} }, 'health')
   */
  provide(ns, impl, owner = ns) {
    this.api[ns] ||= {};
    for (const [k, fn] of Object.entries(impl)) {
      if (typeof fn !== 'function') {
        this.error(new Error(`[api] ${ns}.${k} от ${owner}: нужна функция — пропущено`), 'provide');
        continue;
      }
      const prev = this.providers[ns]?.[k];
      if (prev && prev !== owner) console.warn(`[api] ${ns}.${k}: реализация ${prev} заменена реализацией ${owner}`);
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

  /**
   * Новая игра без перезагрузки страницы (главное меню модуля ui):
   *   game.newGame({ seed, scenarioId, difficulty, colonyName, leaderName, ... })
   * Полностью заменяет мир; см. startNewColony (js/sim/colony.js) и docs/ARCHITECTURE.md «Новая игра».
   */
  newGame(opts = {}) {
    return startNewColony(this, opts);
  }

  /** Переезд поезда на новую стоянку (модуль journey): см. js/sim/station.js. @returns {object} новая карта */
  changeStation(opts = {}) {
    return changeStation(this, opts);
  }

  /**
   * Очистить мир перед новой колонией / загрузкой. Шлёт 'world:reset' {reason} — модули сбрасывают свои
   * runtime-кэши (НЕ defs и не подписки).
   * @param {'new'|'load'|string} [reason]
   */
  resetWorld(reason = 'new') {
    this.train = null;
    this.entities.clear();
    this.designations.clear();
    this.zones.clear();
    this.jobs.reservations.clear();
    this.map = null;
    this.colony = createColonyState();
    this.time.reset();
    this.log.length = 0;
    for (const k of Object.keys(this.stats)) if (typeof this.stats[k] === 'number') this.stats[k] = 0;
    this.fx.clear();
    this.player?.reset?.();
    this.camera.followId = 0;
    this._slowMos.clear();
    this.events.emit(EVENTS.WORLD_RESET, { reason });
  }

  // ---------- Время ----------
  get speedIndex() {
    return this.paused ? 0 : this.speed;
  }

  /**
   * Темп симуляции относительно реального времени (множитель к game.speed в главном цикле браузера):
   * базовый масштаб × самое сильное активное замедление slowMo. Кадровые системы/UI/камера идут в реальном времени.
   * В headless ни на что не влияет (тики идут вызовами step()) — детерминизм не зависит от замедлений.
   */
  get timeScale() {
    let min = 1;
    for (const m of this._slowMos.values()) if (m.scale < min) min = m.scale;
    return this._timeScale * min;
  }

  set timeScale(v) {
    this._timeScale = safeNum(v, 0, 8, 1);
  }

  /**
   * Замедлить время: scale 0..1 (0 — стоп-кадр) на realMs реальных миллисекунд (Infinity — до slowMoEnd).
   * Одновременные запросы не складываются: действует самый медленный. @returns {number} id для slowMoEnd
   * Примеры: колесо приказов 0.25 (Infinity), «хит-стоп» 0.05 на 60 мс, последний рейдер 0.3 на 600 мс.
   */
  slowMo(scale, realMs = Infinity) {
    const id = ++this._slowMoId;
    this._slowMos.set(id, { scale: safeNum(scale, 0, 1, 1), leftMs: realMs > 0 ? realMs : 0 });
    return id;
  }

  /** Снять замедление по id. @returns {boolean} */
  slowMoEnd(id) {
    return this._slowMos.delete(id);
  }

  /** Описание сценария текущей колонии (game.defs.scenarios) или null. */
  getScenario() {
    return this.defs.scenarios?.get(this.colony.scenarioId) || null;
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

  /** Логика кадра (ввод, камера, UI): реальное dt. Здесь же истекают замедления slowMo. */
  frame(dtReal) {
    if (this._slowMos.size) {
      const ms = (Number.isFinite(dtReal) ? dtReal : 0) * 1000;
      for (const [id, m] of this._slowMos) {
        m.leftMs -= ms;
        if (m.leftMs <= 0) this._slowMos.delete(id);
      }
    }
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
