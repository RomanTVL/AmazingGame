// Настройки игрока (сохраняются в хранилище отдельно от сейвов).
import { EVENTS } from './events.js';

const KEY = 'lasttrain.settings';

export const DEFAULT_SETTINGS = Object.freeze({
  lang: 'ru',            // 'ru' | 'en'
  masterVolume: 0.8,
  musicVolume: 0.45,
  sfxVolume: 0.8,
  rudeSpeech: true,      // «Грубая речь»: мат изредка; выкл → мягкие варианты
  shake: true,           // тряска экрана
  damageNumbers: true,   // всплывающие цифры урона
  showDebug: false,      // F9
  edgeGlow: true,        // неоновое свечение (можно выключить на слабых ПК)
  keybinds: {},          // action → key (переназначения игрока)
});

export class Settings {
  constructor(storage, events) {
    this.storage = storage;
    this.events = events;
    this.values = { ...DEFAULT_SETTINGS, keybinds: {} };
    this.load();
  }

  load() {
    try {
      const raw = this.storage.getItem(KEY);
      if (raw) Object.assign(this.values, JSON.parse(raw));
    } catch {
      /* битые настройки — игнорируем */
    }
  }

  save() {
    try {
      this.storage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      /* ignore */
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.save();
    this.events?.emit(EVENTS.SETTINGS_CHANGED, { key, value });
  }

  /** Модуль объявляет свою настройку со значением по умолчанию (если её ещё нет). */
  registerDefault(key, value) {
    if (!(key in this.values)) this.values[key] = value;
  }
}
