/**
 * МОДУЛЬ journey — путь: карта маршрута, фаза в пути (прокрутка фона), станции и генерация биомов, фронт Гнили,
 * рассказчик и колода событий (в т.ч. встречи на путях), сюжет и лор (Серый путник), фракции и репутация,
 * концовки и победа.
 * Локомотив, котёл, топливо, гудок/посадка, вагоны и сценарии старта — у модуля train (js/modules/train).
 * Владелец: js/modules/journey/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * ЧТО СДЕЛАТЬ
 *  1. Маршрут: 12 станций, 3 акта (Лес Шёпота 1–4, Пепельные пустоши 5–8, Ледяные пики 9–12), боссы на 4, 8, 12
 *     (спавн через game.api.combat.spawnRaid({kind: 'boss', ...})). Состояние — свой сериализатор
 *     game.save.registerSerializer({id: 'journey', order: 70, ...}); сброс — на 'world:reset' {reason: 'new'|'load'}.
 *  2. Биомы: game.defs.biomes.add({id: 'ash', palette, gen, generate?}, 'journey') и 'ice' — палитры для рендера
 *     (см. CORE_BIOMES в js/sim/worldgen.js), деревья/растения биома (game.defs.plants), руины станций.
 *  3. Переезд на новую станцию: game.changeStation({biome, stationIndex, w?, h?}) (js/sim/station.js) — ядро уносит
 *     всё содержимое вагонов и всех живых поселенцев на новую карту (лагерь, деревья, враги снаружи остаются),
 *     отменяет задачи, шлёт 'world:reset' {reason: 'station'} → 'map:generated' → 'train:stamped' →
 *     'station:changed' {map, train, carried, opts}. КОГДА ехать решаете вы (после посадки от train).
 *  4. Фаза в пути: сцена движения (поезд едет, фон прокручивается — слой order 85), встречи на путях (засады, бой на
 *     крышах), прибытие — 'journey:arriving' {station}, затем changeStation и 'journey:arrived' {station}.
 *  5. Гниль: фронт/давление, таймер стоянки; фора старта — scenario.rotGapHours (game.getScenario()); визуал
 *     наступающей Гнили — слой order 85; 'journey:rotAdvance' {level}, 'journey:rotBehind' {}.
 *  6. Рассказчик: game.defs.create('incidents') — ≥ 30 событий (рейды, болезни, беженцы, поломка вагона, засуха,
 *     свадьба, ссора, находка); сложность — game.colony.difficulty (id из game.defs.difficulties: easy|normal|hard|
 *     brutal); числовые параметры добавьте сами: game.defs.difficulties.extend('normal', {threat: 1, ...}).
 *  7. Фракции: Вольные торговцы, Инквизиция, Культ Гнили, Лесные кланы — репутация, отношение.
 *  8. Сюжет и концовки: акты ('journey:actChanged' {act}), Серый путник, финал — 'game:victory' {ending, stats}.
 *  9. API (пространство journey делят journey и train): game.provide('journey', { getBiome, getStation, isTravelling,
 *     depart, getAmbientTemp() → °C }, 'journey'). getFuel, getTrainState, setRegulator, getCarHeat, isInCab
 *     предоставляет train — не переопределяйте их.
 * 10. UI: карта маршрута (F4) — game.ui.registerPanel({id: 'route', key: 'F4', ...}) → действие 'panel:route'.
 *     Цели на экране — game.api.ui.setObjective(id, text) / clearObjective(id).
 *
 * КЛАВИШИ (выделены): F4 — карта маршрута ('panel:route'). (L, H, [, ] — у train.)
 * СОБЫТИЯ: 'journey:departing' {station}, 'journey:travelling' {from, to}, 'journey:arriving' {station},
 *          'journey:arrived' {station}, 'journey:incident' {id}, 'journey:rotAdvance' {level}, 'journey:rotBehind' {},
 *          'journey:actChanged' {act}, 'journey:factionChanged' {faction, value}, 'game:victory' {ending, stats}.
 */
export function register(game) {
  void game;
}
