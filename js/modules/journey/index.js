/**
 * МОДУЛЬ journey — путь поезда: карта маршрута, станции, отправление/прибытие, топливо, Гниль,
 * биомы актов, рассказчик событий, фракции и репутация, засады в пути.
 * Владелец: js/modules/journey/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * ЧТО СДЕЛАТЬ
 *  1. Маршрут: 12 станций, 3 акта (Лес Шёпота 1–4, Пепельные пустоши 5–8, Ледяные пики 9–12), боссы на 4, 8, 12
 *     (спавн через game.api.combat.spawnRaid({kind: 'boss', ...})). Состояние — свой сериализатор
 *     game.save.registerSerializer({id: 'journey', order: 70, ...}).
 *  2. Биомы: game.defs.biomes.add({id: 'ash', palette, gen, generate?}, 'journey') и 'ice' — палитры для рендера
 *     (см. CORE_BIOMES в js/sim/worldgen.js), деревья/растения биома (game.defs.plants), руины станций.
 *  3. Переезд на новую станцию: game.train.unstamp(); новая карта generateStation(game, {biome, stationIndex});
 *     перенести поселенцев/предметы поезда; game.train.stamp(map.railY, x0). Вагоны — game.train.addCar(type),
 *     типы вагонов — game.defs.wagonTypes. Лагерь на земле бросается (часть ресурсов можно разобрать заранее).
 *  4. Топливо: локомотив ест кристаллы маны (предмет 'mana_crystal') / уголь; нет топлива — поезд стоит, Гниль
 *     подступает (таймер стоянки, визуал наступающей Гнили — слой order 85).
 *  5. В пути: сцена движения (поезд едет, фон прокручивается), засады (бой на крышах), события.
 *  6. Рассказчик: game.defs.create('incidents') — ≥ 30 событий (рейды, болезни, беженцы, поломка вагона, засуха,
 *     свадьба, ссора, находка), сложность (Мирный/Обычный/Жестокий).
 *  7. Фракции: Вольные торговцы, Инквизиция, Культ Гнили, Лесные кланы — репутация, отношение.
 *  8. API: game.provide('journey', { getBiome, getStation, isTravelling, getFuel, depart }, 'journey').
 *  9. UI: карта маршрута (F4), панель локомотива/отправления (L).
 *
 * КЛАВИШИ (выделены): F4 — карта маршрута, L — локомотив/отправление.
 * СОБЫТИЯ: 'journey:departing' {station}, 'journey:travelling' {from, to}, 'journey:arrived' {station},
 *          'journey:incident' {id}, 'journey:rotAdvance' {level}, 'journey:factionChanged' {faction, value}.
 */
export function register(game) {
  void game;
}
