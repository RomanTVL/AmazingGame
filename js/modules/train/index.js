/**
 * МОДУЛЬ train — локомотив и вагоны как машина: двигатели (паровой/рунный), котёл (тепло, давление), регулятор,
 * топка и работа «кочегар» (подброс топлива), виды топлива и расход, гудок/посадка/отставшие, температура вагонов,
 * типы вагонов «тендер» и «салон», покупки в депо (двигатель, вагоны), панель поезда (L) и ДАННЫЕ СЦЕНАРИЕВ СТАРТА.
 * Владелец: js/modules/train/** . Контракт ядра: docs/ARCHITECTURE.md (разделы «Поезд», «Новая игра», «Время»).
 *
 * ЧТО СДЕЛАТЬ
 *  1. Состояние поезда — простые JSON-поля на game.train (сохраняются автоматически, кроме '_'-полей):
 *     game.train.engine ('steam'|'rune'), .fuel, .heat, .pressure, .regulator, .boilerState, .battery…
 *     или game.train.data.train = {...}; по вагону — car.data.train = {heat, ...}. Стабильный id вагона — car.id.
 *     Инициализация — на 'colony:started' (сценарий: game.getScenario().engine) и 'world:reset' (сброс кэшей).
 *  2. Типы вагонов: game.defs.wagonTypes.add({id: 'tender'|'salon', nameKey, length, color, light, fixtures}, 'train').
 *     Фикстуры (топка, котёл, регулятор в кабине) — постройки поезда: def.fixtures = [{defId, dx, dy, rot?, props?}]
 *     у типа вагона (game.defs.wagonTypes.extend('locomotive', {fixtures: [...]})) или car.fixtures у экземпляра
 *     (car.replaceFixtures = true — только свои), затем game.train.restamp(). Фикстуры пересоздаются при каждом stamp —
 *     состояние храните в train/car, а не в сущности. Постройки фикстур регистрируйте сами (category 'train').
 *  3. Покупки в депо: game.train.addCar(type) / removeCar(car) → 'train:carAdded'/'train:carRemoved' → train.restamp()
 *     (содержимое вагонов едет вместе с ними). Смена двигателя — смена фикстур локомотива + restamp().
 *  4. Котёл и топка: системы (game.systems.add, order 70–90) — тепло/давление/расход топлива по регулятору;
 *     тип работ 'stoking' (game.jobs.registerWorkType) и задача 'stoke' (подносить топливо к топке, бросать);
 *     лидер кочегарит руками через hold-взаимодействие E (game.defs.interactions.add({hold: true, onHoldStart,
 *     onRelease(game, pawn, heldMs)}) — тайминг лопаты). События: 'journey:stoke' {pawn, x, y, quality, fuel},
 *     'journey:boiler' {state}.
 *  5. Гудок и посадка: клавиша H — действие 'journey:horn' (ядро уже зарегистрировало на владельца train) →
 *     событие 'journey:horn' {pattern} + game.api.vision.noise(x, y, radius, 'horn'); посадка перед отправлением —
 *     'journey:boarding' {untilTick, missing}; не успевшие — 'journey:leftBehind' {pawn, station}.
 *     Регулятор: ']' / '[' — действия 'journey:regUp' / 'journey:regDown' (зарегистрированы ядром).
 *  6. Температура вагонов: тепло от котла/печей, утечки через двери/окна; game.api.journey.getAmbientTemp() даёт journey.
 *  7. API (пространство journey, предоставляет train): game.provide('journey', { getTrainState() → {engine, moving,
 *     speed, regulator, heat, pressure, boilerState, fuel, battery, noise, rotGapHours, rotGapExact}, getFuel(),
 *     setRegulator(value), getCarHeat(carIndex), isInCab(pawn) }, 'train'). Остальное в journey (маршрут) — у journey.
 *  8. Сценарии старта (данные): game.defs.scenarios.add({id: 'three_survivors' (по умолчанию), nameKey, descKey,
 *     difficulty: 'easy'|'normal'|'hard'|'brutal', order, rerolls 0..3, colonists, consist (локомотив последним),
 *     items [[defId, n]], silver, rotGapHours, engine, flags, apply(game, opts, ctx)}, 'train') — «Трое выживших»,
 *     «Голый одиночка» (colonists: 0, items: [], apply снимает одежду: pawn.naked = true), «Наследник поневоле» и др.
 *     Ядро вызывает apply после генерации карты/поезда/пешек и до 'colony:started'. Встроенный 'standard' — запасной.
 *  9. UI: панель поезда (L) — game.ui.registerPanel({id: 'train', key: 'KeyL', ...}) → действие 'panel:train';
 *     HUD котла (давление/топливо) — game.ui.registerHud({slot: 'bottom-right', ...}).
 * 10. Строки: game.i18n.add('ru', {train: {...}}) и 'en'; свои сериализаторы не нужны, если всё лежит в game.train.
 *
 * КЛАВИШИ (выделены): L — панель поезда ('panel:train'), H — гудок ('journey:horn'), ] / [ — регулятор
 *          ('journey:regUp' / 'journey:regDown'); последние три уже зарегистрированы ядром на владельца train.
 * СОБЫТИЯ (имена объявлены в EVENTS ядра): 'journey:horn', 'journey:boarding', 'journey:leftBehind', 'journey:stoke',
 *          'journey:boiler'.
 */
export function register(game) {
  void game;
}
