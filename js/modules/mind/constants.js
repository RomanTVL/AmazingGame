// Настройки баланса модуля mind (потребности, настроение, срывы, навыки, отношения).
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../core/constants.js';

export const H = TICKS_PER_HOUR;
export const DAY = TICKS_PER_DAY;

/** Потребности: id → {decayPerDay (бодрствуя), label key}. Значения 0..1 (1 — удовлетворена). */
export const NEED_IDS = ['food', 'rest', 'joy', 'comfort', 'beauty', 'social', 'outdoors', 'warmth'];

export const NEEDS = {
  foodPerDay: 1.5,
  restPerHourAwake: 1 / 17,
  restPerHourBed: 1 / 6,
  restPerHourFloor: 1 / 8,
  joyPerDay: 0.9,
  socialPerDay: 0.8,
  outdoorsPerDayInside: 0.55,
  outdoorsPerHourOutside: 0.6,
  hungryAt: 0.3,
  starvingAt: 0.12,
  tiredAt: 0.18,
  starveDamagePerHour: 1,
  /** скорость приближения comfort/beauty/warmth к цели окружения (в час) */
  envRatePerHour: 0.6,
  /** комфортная температура */
  tempComfortLow: 12,
  tempComfortHigh: 27,
};

export const MOOD = {
  /** базовое настроение (без мыслей) */
  base: 0.55,
  /** скорость приближения к целевому (экспонента в час) */
  ratePerHour: 0.55,
  minor: 0.35,
  major: 0.2,
  extreme: 0.08,
  /** средний интервал между срывами под порогом, в игровых часах */
  mtbHours: { minor: 60, major: 36, extreme: 14 },
  /** вдохновение: настроение не ниже, часов подряд, шанс в сутки, длительность (ч) */
  inspireAt: 0.85,
  inspireAfterHours: 12,
  inspireChancePerDay: 0.2,
  inspireHours: 24,
};

export const SKILL = {
  maxLevel: 20,
  passionMul: { none: 0.35, minor: 1, major: 1.5 },
  /** опыт до следующего уровня */
  xpFor: (level) => 100 + 50 * level,
};

export const SOCIAL = {
  /** как часто (тиков) пешка «оглядывается» в поисках собеседника */
  checkEvery: 75,
  /** радиус мгновенного разговора (клетки) */
  talkRange: 2.6,
  /** базовый шанс начать разговор за проверку (умножается на нужду в общении) */
  baseChance: 0.12,
  friendAt: 30,
  rivalAt: -30,
  ticks: { chat: 300, joke: 300, deep: 540, argue: 360, comfort: 420, insult: 240, romance: 420, toast: 240 },
};

export const AUTHORITY = {
  workSeen: 0.3,
  workSeenCapPerDay: 4,
  stokedCapPerDay: 3,
  funeralSpeech: 3,
  bossKill: 5,
  diedDrafted: -2,
  insisted: -3,
  execution: -5,
  didItHimself: 1,
};

/** Задачи, во время которых пешка «свободна» (её можно позвать поговорить). */
export const FREE_JOBS = new Set(['wander', 'wait', 'mind_joy', 'mind_talk']);
