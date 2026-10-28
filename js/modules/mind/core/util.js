// Общие помощники модуля mind.
import { hash2 } from '../../../core/math.js';
import { TRAIN_ROOM_BASE } from '../../../sim/train.js';

export const isFemale = (p) => p?.gender === 'female';
export const firstName = (p) => String(p?.name || '???').split(' ')[0];
export const displayName = (p) => (p?.nameless ? '???' : firstName(p));

/** Живой поселенец колонии (не животное). */
export function isColonistPawn(p) {
  return !!p && p.kind === 'pawn' && !p.dead && !p.removed && p.faction === 'colony' && !p.animal && !p.prisoner;
}

/** Поселенец под управлением ИИ (не лидер-игрок). */
export function isAiColonist(p) {
  return isColonistPawn(p) && p.controlled !== 'player';
}

export function colonists(game, out = []) {
  out.length = 0;
  for (const p of game.entities.ofKind('pawn')) if (isColonistPawn(p)) out.push(p);
  return out;
}

/** Косметический детерминированный выбор (не трогает game.rng): индекс 0..n-1. */
export function hpick(n, a, b, salt = 0) {
  if (n <= 1) return 0;
  return hash2((a | 0) + salt * 7919, b | 0, 0x6d696e64) % n;
}

export const hchance = (p, a, b, salt = 0) => (hash2((a | 0) + salt * 7919, b | 0, 0x2c1b3c6d) % 10000) / 10000 < p;

/** Едет ли поезд сейчас. */
export function isTravelling(game) {
  try {
    if (game.api.journey.isTravelling?.()) return true;
    return !!game.api.journey.getTrainState?.()?.moving;
  } catch (err) {
    game.error(err, 'mind.isTravelling');
    return false;
  }
}

export function trainState(game) {
  try {
    return game.api.journey.getTrainState?.() || null;
  } catch {
    return null;
  }
}

/** Вагон в клетке (или null). */
export function carAt(game, x, y) {
  return game.train?.stamped ? game.train.carAt(Math.floor(x), Math.floor(y)) : null;
}

export function inTrain(game, x, y) {
  return !!carAt(game, x, y);
}

export function isRoofed(game, x, y) {
  const map = game.map;
  if (!map) return false;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return map.inBounds(tx, ty) && map.roof[map.idx(tx, ty)] > 0;
}

/** Ключ «комнаты» для слухов: вагон, комната на земле или улица. */
export function roomKey(game, x, y) {
  const map = game.map;
  if (!map) return 'out';
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!map.inBounds(tx, ty)) return 'out';
  const r = map.room[map.idx(tx, ty)];
  return r ? `r${r}` : 'out';
}

/** «на кухне», «в жилом вагоне», «у поезда»… */
export function placeLabel(game, x, y) {
  const car = carAt(game, x, y);
  if (car) {
    const k = `mind.place.${car.type}`;
    return game.i18n.has(k) ? game.t(k) : game.t('mind.place.car');
  }
  const map = game.map;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (map?.inBounds(tx, ty)) {
    const r = map.room[map.idx(tx, ty)];
    if (r > 0 && r < TRAIN_ROOM_BASE) return game.t('mind.place.room');
  }
  return game.t('mind.place.out');
}

/** Текст реплики: вариант по косметическому хешу; изредка (≈1/10) — грубый вариант через tRude. */
export function sayLine(game, key, vars = {}, seedA = 0, seedB = 0) {
  const i18n = game.i18n;
  const v = { ...vars, variant: hpick(97, seedA, seedB, 3) };
  const rudeKey = `${key}_rude`;
  if (i18n.has(rudeKey) && hchance(0.1, seedA, seedB, 11)) return i18n.tRude(key, rudeKey, v);
  return i18n.t(key, v);
}

/** Мужской/женский вариант ключа (ключ_f — для женщин, если есть). */
export function gkey(game, key, female) {
  return female && game.i18n.has(`${key}_f`) ? `${key}_f` : key;
}

/** Подменить местоимения в репликах о проводнике, если проводник — женщина. */
export function genderizeLeader(game, text, leader) {
  if (!isFemale(leader) || typeof text !== 'string') return text;
  if (game.i18n.lang === 'en') {
    return text.replace(/\bhe\b/g, 'she').replace(/\bHe\b/g, 'She').replace(/\bhim\b/g, 'her').replace(/\bhis\b/g, 'her').replace(/\bhimself\b/g, 'herself');
  }
  const pairs = [
    [/\bОн\b/g, 'Она'], [/\bон\b/g, 'она'], [/\bсам\b/g, 'сама'], [/\bнего\b/g, 'неё'], [/\bним\b/g, 'ней'], [/\bего\b/g, 'её'],
    [/Хороший он/g, 'Хорошая она'], [/Строгий, но справедливый/g, 'Строгая, но справедливая'], [/толковый/g, 'толковая'],
    [/сбежит/g, 'сбежит'], [/не спит, всё карты смотрит/g, 'не спит, всё карты смотрит'], [/спас/g, 'спасла'], [/орал\?/g, 'орала?'],
    [/выискался/g, 'выискалась'], [/подводил/g, 'подводила'], [/Переживает/g, 'Переживает'],
  ];
  let s = text;
  for (const [re, r] of pairs) s = s.replace(re, r);
  return s;
}

/** Безопасный вызов чужого API (цель может быть заглушкой или бросить). */
export function safeCall(game, where, fn, fallback = undefined) {
  try {
    return fn();
  } catch (err) {
    game.error(err, `mind.${where}`);
    return fallback;
  }
}

/** Предоставил ли модуль (не ядро-заглушка) функцию API. */
export function provided(game, ns, fn) {
  const owner = game.providers?.[ns]?.[fn];
  return !!owner && owner !== 'core';
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
