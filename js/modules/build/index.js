/**
 * МОДУЛЬ build — стройка, чертежи, мебель, зоны, инструменты пометок.
 * Владелец: js/modules/build/** (правьте только эту папку). Контракт ядра: docs/ARCHITECTURE.md.
 *
 * ЧТО СДЕЛАТЬ
 *  1. Определения построек (≥ 25): game.defs.buildings.add({...BuildingDef}, 'build') — стены (дерево/камень),
 *     двери, частокол, кровать, спальник, стол, стул, печь (кухня), верстак, алхимический стол, стеллаж (storage: true),
 *     лампа/факел (light: {...}), грядка/гидропоника, могила/надгробие (для health), ловушки, бойницы и т.п.
 *     Схема BuildingDef — js/sim/content.js (BUILDING_DEFAULTS): size, passable, blocksVision, blocksLight, hp,
 *     materials {wood: 5}, workToBuild, category, placeableOn: 'wagon'|'ground'|'both', draw(ctx, e, game, view)?,
 *     bake (статичная отрисовка в кэш тайлов: def.paintBaked(ctx, px, py, e, game)), light, bed, door, storage.
 *     Полы: game.defs.floors.add({id, nameKey, cost, materials, workToBuild}).
 *  2. Чертежи и стройка: сущность-чертёж (вид 'blueprint' через game.entities.registerKind('blueprint', {static: true}))
 *     или building с полем {blueprint: true, progress, delivered: {}}; задачи (game.jobs.registerJobType):
 *     'deliver' (workType 'hauling' или 'construction') — подносить материалы, 'construct' (workType 'construction'),
 *     'deconstruct' — разбор с возвратом части материалов. Лидер тоже строит руками через E: добавьте
 *     взаимодействие game.defs.interactions.add({id: 'build:construct', order: 15, find(game, pawn, tx, ty)}).
 *  3. Переопределить API: game.provide('build', { canPlace(defId, x, y, rot), place(defId, x, y, {rot}) → чертёж,
 *     deconstruct(entity) }, 'build').
 *  4. UI: меню стройки по клавише B (категории, превью-призрак под курсором зелёный/красный, R — поворот,
 *     ЛКМ — поставить, ПКМ/Esc — отмена) — game.ui.registerPanel({id: 'build', key: 'KeyB', ...}) и слой превью
 *     game.render.registerLayer({id: 'build:ghost', order: 98, ...}). Поворот — клавиша G (выделена build) или
 *     Shift+колесо, пока активен режим стройки.
 *  5. Инструменты пометок (замена временного C ядра): C — рубить/собрать/добыть (ядро уже даёт C+мышь,
 *     можно переиспользовать game.player.applyTool), X — снять пометки/разобрать, Z — зоны складов
 *     (game.zones.create('stockpile', cells, {filter})), фильтры склада по категориям.
 *  6. Комнаты: пересчитывать map.room для построек на земле (заливка, ограниченная стенами/дверями),
 *     крыши (map.roof = 2 для построенной крыши) — для температуры/красоты (mind) и тумана (vision).
 *  7. Сохранение: всё в полях сущностей сохраняется автоматически; своё состояние — game.save.registerSerializer.
 *  8. Строки: game.i18n.add('ru', {build: {...}}) и 'en'.
 *
 * КЛАВИШИ (выделены): B — меню стройки, G — поворот, Z — зоны, X — снять/разобрать, C — пометки (у ядра временно:
 *          действие 'player:designate' — снимите его, если заменяете: game.input.bindings.delete('player:designate')).
 * СОБЫТИЯ, которые стоит слать: 'build:placed' {entity}, 'build:completed' {entity, pawn}, 'build:deconstructed' {entity}.
 */
export function register(game) {
  void game;
}
