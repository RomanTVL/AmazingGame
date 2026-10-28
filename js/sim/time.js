// Игровые часы: тики → день/час, день/ночь, сезоны.
import { TICKS_PER_HOUR, HOURS_PER_DAY } from '../core/constants.js';
import { EVENTS } from '../core/events.js';
import { smoothstep } from '../core/math.js';

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const DAYS_PER_SEASON = 15;

export class Clock {
  constructor(game) {
    this.game = game;
    this.tick = 0;
    /** Час, с которого начинается игра (смещение). */
    this.startHour = 7;
    this._lastHour = -1;
  }

  /** Новая игра: тик 0, 07:00 первого дня. */
  reset() {
    this.tick = 0;
    this.startHour = 7;
    this._lastHour = -1;
    this._lastDay = undefined;
  }

  get totalHours() {
    return this.startHour + this.tick / TICKS_PER_HOUR;
  }

  /** День, начиная с 1. */
  get day() {
    return Math.floor(this.totalHours / HOURS_PER_DAY) + 1;
  }

  /** Час суток, дробный [0, 24). */
  get hour() {
    return this.totalHours % HOURS_PER_DAY;
  }

  get hourInt() {
    return Math.floor(this.hour);
  }

  get minute() {
    return Math.floor((this.hour % 1) * 60);
  }

  /** Освещённость 0 (ночь) .. 1 (день). Рассвет 4–7, закат 18–21. */
  get daylight() {
    const h = this.hour;
    if (h >= 7 && h < 18) return 1;
    if (h >= 4 && h < 7) return smoothstep(4, 7, h);
    if (h >= 18 && h < 21) return 1 - smoothstep(18, 21, h);
    return 0;
  }

  get nightFactor() {
    return 1 - this.daylight;
  }

  isNight() {
    const h = this.hour;
    return h >= 21 || h < 5;
  }

  /** Часы сна по умолчанию (модуль mind может заменить расписанием). */
  isSleepTime() {
    const h = this.hour;
    return h >= 22 || h < 6;
  }

  get seasonIndex() {
    return Math.floor((this.day - 1) / DAYS_PER_SEASON) % SEASONS.length;
  }

  get season() {
    return SEASONS[this.seasonIndex];
  }

  /** 'HH:MM' */
  clockString() {
    const h = String(this.hourInt).padStart(2, '0');
    const m = String(Math.floor(this.minute / 10) * 10).padStart(2, '0');
    return `${h}:${m}`;
  }

  /** Отладка: перевести часы на час h (вперёд в пределах суток). */
  setHour(h) {
    let delta = (h - this.hour) % 24;
    if (delta < 0) delta += 24;
    this.startHour += delta;
  }

  /** Тиков до заданного количества часов. */
  static hours(h) {
    return Math.round(h * TICKS_PER_HOUR);
  }

  advance() {
    this.tick++;
    const hi = this.hourInt;
    if (hi !== this._lastHour) {
      const prevDay = this._lastDay;
      this._lastHour = hi;
      this.game.events.emit(EVENTS.TIME_HOUR, { day: this.day, hour: hi });
      if (prevDay !== undefined && this.day !== prevDay) {
        this.game.events.emit(EVENTS.TIME_DAY, { day: this.day });
      }
      this._lastDay = this.day;
    }
  }

  serialize() {
    return { tick: this.tick, startHour: this.startHour };
  }

  deserialize(d) {
    this.tick = d.tick;
    this.startHour = d.startHour;
    this._lastHour = this.hourInt;
    this._lastDay = this.day;
  }
}
