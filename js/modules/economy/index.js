/**
 * МОДУЛЬ economy — предметы и производство: готовка, ремесло, растениеводство (теплица), торговля,
 * вещества (Дремотная пыль, Огнекровь) и зелья, ценность/богатство.
 * Владелец: js/modules/economy/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * ЧТО СДЕЛАТЬ
 *  1. Предметы: game.defs.items.add({...ItemDef}, 'economy') — схема в js/sim/items.js (CORE_ITEMS): ткань, кожа,
 *     металл, доски, травы, семена, блюда (простая/изысканная еда), сушёное мясо, зелья (7: лечебное, противоядие,
 *     от инфекции, сна, храбрости, огненное, ночного зрения), сырьё веществ (дремоцвет, кровавый мох), вещества.
 *     Вещества — ВЫМЫШЛЕННЫЕ: никаких реальных названий и рецептов.
 *  2. Производство: «заказы» (bills) на верстаках (постройки регистрирует build или вы сами с category 'production'):
 *     game.defs.create('recipes') — {id, station: buildingDefId, ingredients {}, products {}, work, skill, workType};
 *     задача 'doBill' (workType 'cooking'|'crafting'). Панель заказов — клавиша K.
 *  3. Растениеводство: зона выращивания (game.defs.zoneTypes.add({id: 'grow', storage: false, ...})), посев/уход/сбор
 *     (workType 'growing'), растения-культуры в game.defs.plants (с ростом). Кровавый мох — в тёмных влажных вагонах.
 *  4. Вещества и зелья: употребление (задача 'ingest'), эффекты через game.api.health.addCondition(pawn, id, {severity})
 *     и game.api.mind.addThought; привыкание, ломка, передоз; политика употребления pawn.drugPolicy
 *     (never|party|break|free).
 *  5. Торговля: торговцы на станциях (journey шлёт 'journey:arrived'), панель торговли (T), валюта (предмет
 *     'silver' или кристаллы маны), цены от value; Инквизиция — конфискация веществ (по событию от journey).
 *  6. API: game.provide('economy', { itemValue(defId), colonyWealth(), canAfford(cost), consume(cost, x, y),
 *     trade(trader, offer) }, 'economy'). Базовые операции с предметами — game.items (spawn/take/count/consume/findNearest).
 *  7. Склады: фильтры зон (zone.filter = {categories, items, deny}) — UI фильтров у build (зоны), логика — game.zones.accepts.
 *  8. Еда для mind: блюда с def.nutrition и foodKind 'meal' дают мысль 'ate_meal' (ядро уже вызывает).
 *
 * КЛАВИШИ (выделены): T — торговля, K — производство/заказы.
 * СОБЫТИЯ: 'economy:crafted' {pawn, recipeId, products}, 'economy:traded' {trader, gave, got}, 'economy:ingested' {pawn, defId}.
 */
export function register(game) {
  void game;
}
