// ЕДИНАЯ РАСКЛАДКА КЛАВИШ (контракт). Ядро регистрирует свои действия само (CORE_KEYS, PLAYER_KEYS,
// RESERVED_PLAYER_KEYS); действия модулей регистрирует модуль-владелец ИМЕННО с этими именами и клавишами:
//   game.input.registerKey('build:rotate', 'KeyG', 'build', { label: 'build.key.rotate' })
//   game.ui.registerPanel({ id: 'build', key: 'KeyB', ... })   // → действие 'panel:build'
// Тест tests/headless.mjs проверяет, что в таблице нет конфликтов, а ядро зарегистрировало то, что в ней записано.
// Новую клавишу модулю — сначала сюда (и в docs/ARCHITECTURE.md), потом в код модуля.
//
// Правила:
//  - голая клавиша срабатывает и с Shift (но не с Ctrl/Alt) → не вешайте действия на 'Shift+X': Shift — рывок/блинк;
//  - ЛКМ ('Mouse0') — атака лидера; модуль, которому в своём режиме нужна ЛКМ (стройка, выбор цели заклинания),
//    вызывает game.input.consume('player:attack') в кадровой системе с order < 30 (или в panel.handleInput);
//  - ПКМ ('Mouse2') — контекстная отмена/снятие (C+ПКМ — снять пометки, ПКМ — отмена стройки); как действие не регистрируется;
//  - Пробел — пауза (как в RimWorld). Блинк мага — рывок (Shift) или заклинание в слоте 1–4, НЕ пробел;
//  - скорость времени — Numpad1–3 и +/− (цифры 1–4 — заклинания);
//  - никаких Ctrl+буква в игровых привязках (Ctrl+W закрывает вкладку), никаких Shift+E и т.п. (Shift — рывок).
import { CORE_KEYS } from '../engine/index.js';
import { PLAYER_KEYS, RESERVED_PLAYER_KEYS, RESERVED_MODULE_KEYS } from '../player/controller.js';

/** Клавиши модулей: [action, key | key[], owner, описание]. */
export const MODULE_KEYS = [
  // build
  ['panel:build', 'KeyB', 'build', 'меню стройки'],
  ['build:rotate', 'KeyG', 'build', 'поворот чертежа (в режиме стройки)'],
  ['build:zones', 'KeyZ', 'build', 'инструмент зон складов'],
  ['build:clear', 'KeyX', 'build', 'снять пометки / разобрать'],
  // combat (player:* уже зарегистрированы ядром на владельца combat)
  ['combat:draft', 'KeyF', 'combat', 'призвать/отпустить наведённого поселенца'],
  // vision (player:orders — ядро, владелец vision)
  ['vision:cameras', 'KeyV', 'vision', 'вид рунных камер'],
  // mind
  ['panel:character', 'KeyI', 'mind', 'карточка персонажа'],
  ['panel:schedule', 'F7', 'mind', 'расписание и отношения'],
  // health
  ['panel:health', 'F2', 'health', 'здоровье'],
  ['panel:fallen', 'F8', 'health', 'Павшие'],
  // economy
  ['panel:trade', 'KeyT', 'economy', 'торговля'],
  ['panel:bills', 'KeyK', 'economy', 'производство / заказы'],
  // journey (маршрут)
  ['panel:route', 'F4', 'journey', 'карта маршрута'],
  // train (локомотив; journey:horn/regUp/regDown — ядро, владелец train)
  ['panel:train', 'KeyL', 'train', 'панель локомотива / отправление'],
  // ui (Esc — ядро 'ui:back' → событие 'ui:menuRequested')
  ['panel:work', 'F1', 'ui', 'работы (приоритеты)'],
  ['panel:log', 'F3', 'ui', 'журнал'],
  ['ui:quicksave', 'F5', 'ui', 'быстрое сохранение'],
  ['ui:quickload', 'F6', 'ui', 'быстрая загрузка'],
  ['panel:settings', 'F10', 'ui', 'настройки'],
  ['panel:inventory', 'Tab', 'ui', 'инвентарь'],
  // av
  ['av:mute', 'KeyM', 'av', 'звук вкл/выкл'],
];

/** Свободные клавиши (на будущее; занимать — через эту таблицу): */
export const FREE_KEYS = ['KeyJ', 'KeyN', 'KeyO', 'KeyP', 'KeyU', 'KeyY', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Backquote', 'F11*', 'F12*'];

/** Полная таблица: [{action, keys: string[], owner, registeredBy: 'core'|'module', note}]. */
export function allKeys() {
  const out = [];
  const add = (action, key, owner, registeredBy, note) =>
    out.push({ action, keys: Array.isArray(key) ? key : [key], owner, registeredBy, note: note || '' });
  for (const [a, k, label] of CORE_KEYS) add(a, k, 'core', 'core', label);
  for (const [a, k, label] of PLAYER_KEYS) add(a, k, 'core', 'core', label);
  for (const [a, k, label, owner] of RESERVED_PLAYER_KEYS) add(a, k, owner, 'core', label);
  for (const [a, k, label, owner] of RESERVED_MODULE_KEYS) add(a, k, owner, 'core', label);
  for (const [a, k, owner, note] of MODULE_KEYS) add(a, k, owner, 'module', note);
  return out;
}

/** Конфликты внутри таблицы: [{key, a, b}] (пустой массив = раскладка корректна). */
export function keymapConflicts() {
  const seen = new Map();
  const out = [];
  for (const b of allKeys()) {
    for (const k of b.keys) {
      if (seen.has(k)) out.push({ key: k, a: seen.get(k), b: b.action });
      else seen.set(k, b.action);
    }
  }
  return out;
}
