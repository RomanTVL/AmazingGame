/**
 * МОДУЛЬ vision — туман войны, линия видимости, камеры-глаза, вышки, маяк; ПРИКАЗЫ лидера (Q) и колокол.
 * Владелец: js/modules/vision/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * ЧТО СДЕЛАТЬ — ОБЗОР
 *  1. Видимость: лидер видит только то, что в прямой видимости. Стены вагонов, закрытые двери, деревья, скалы
 *     закрывают обзор — слой map.blocksVision (1 = блокирует; у дверей def.door — открыта, если в ней/рядом пешка).
 *     Алгоритм — shadowcasting или лучи (js/core/math.js: lineTiles). Пересчёт — при движении лидера/источников,
 *     не каждый тик (кэш, version).
 *  2. API: game.provide('vision', { isVisible(tx, ty), isExplored(tx, ty), canPawnSee(pawn, tx, ty),
 *     report(text, opts), noise(x, y, radius, kind), canLeaderHear(x, y), lastKnown(entityId) }, 'vision') и
 *     game.vision.enabled = true; game.vision.version++ при изменении (рендер тумана js/render/fog.js читает
 *     isVisible/isExplored и version). Карта сменилась ('world:reset', 'map:generated', 'station:changed') —
 *     пересоздайте свои массивы под game.map.w×h. Шум (выстрел, гудок, крик) — 'vision:noise' {x, y, radius, kind}.
 *  3. «Память»: исследованные, но не видимые клетки — затемнены, показывают последнее известное (рендер уже скрывает
 *     динамические сущности вне видимости и показывает статичные на исследованных клетках).
 *  4. Источники обзора: рунные камеры-глаза (постройка, радиус, нужна мана), смотровые вышки, Маяк, часовые
 *     с передатчиком — game.defs.buildings.add({..., vision: {radius}}, 'vision').
 *  5. Сообщения вне обзора: задержка и неточность («крики из вагона-кухни!») — оберните game.api.vision.report;
 *     модули шлют сообщения о событиях в точке через game.api.vision.report(text, {x, y, type}).
 *
 * ЧТО СДЕЛАТЬ — ПРИКАЗЫ
 *  6. Q: ядро шлёт 'player:orderMenu' {leader, target, x, y} и вызывает game.api.orders.openMenu(leader, target).
 *     Радиальное меню: «иди строй / руби / лечи / охраняй / за мной / стой». Голос: радиус слышимости.
 *     Пока колесо открыто — замедление: id = game.slowMo(0.25, Infinity), при закрытии game.slowMoEnd(id).
 *     game.provide('orders', { list(leader, pawn), give(leader, pawn, orderId, target), openMenu(leader, pawn) }, 'vision').
 *  7. Исполнение: think-узел 'order' (priority 85, interrupts: true, factions: ['colony']) — читает pawn.order.
 *     Послушание — game.api.mind.willObey(pawn, orderId) → {ok, reply}; отказ — 'orders:refused' {pawn, orderId, reply}.
 *  8. Сигнальный колокол / рунный передатчик — постройка, приказы всему поезду.
 *  9. Камера: V — переключить обзор на камеры (если есть).
 *
 * КЛАВИШИ (выделены): Q — приказы (ядро зарегистрировало 'player:orders' на владельца 'vision'), V — вид камер
 *          ('vision:cameras').
 * СОБЫТИЯ: 'vision:changed' {}, 'vision:noise' {x, y, radius, kind}, 'orders:given' {leader, pawn, orderId},
 *          'orders:completed' {pawn, orderId}, 'orders:refused' {pawn, orderId, reply}.
 */
export function register(game) {
  void game;
}
