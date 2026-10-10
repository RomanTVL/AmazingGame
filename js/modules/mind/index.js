/**
 * МОДУЛЬ mind — «разум» поселенцев: потребности, настроение, мысли, черты, навыки, отношения, срывы,
 * расписание, биографии, реплики (с «грубой речью»).
 * Владелец: js/modules/mind/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * ЧТО СДЕЛАТЬ
 *  1. Потребности: заменить заглушку js/sim/needs.js — game.systems.setEnabled('needs', false) и своя система
 *     (order 20) для food, rest, joy, comfort, warmth, beauty, social. Узлы ИИ 'eat'/'sleep' можно переопределить
 *     game.ai.registerThinkNode({id: 'eat', override: true, ...}); задачи 'eat'/'sleep' и шаг 'sleep' — переиспользовать.
 *     Добавить узлы: 'joy' (развлечение), 'social' (общение), 'mentalBreak' (priority 99, interrupts: true).
 *  2. Мысли и настроение: game.defs.create('thoughts') — {id, nameKey, mood (+/−), days, stack?};
 *     game.provide('mind', { addThought, removeThought, getMood, ... }). Ядро уже вызывает:
 *     'ate_raw', 'ate_meal', 'ate_ration', 'slept_on_floor', 'slept_in_bed', 'hungry', 'starving', 'exhausted'.
 *     Модуль health будет вызывать горе: 'friend_died', 'lover_died', 'saw_corpse', 'not_buried', 'buried_properly'.
 *  3. Черты (≥ 15): game.defs.create('traits') — трудоголик, лентяй, кровожадный, неженка, обжора, пироман, оптимист,
 *     пессимист, склонность к зависимости и т.д.; влияние через skillFactor/getMood/скорости.
 *  4. Навыки: game.defs.create('skills') — construction, mining, plants, cooking, medicine, crafting, shooting, melee,
 *     magic, trade, social, intellect (id совпадают с workTypes[].skill). pawn.skills[id] = {level, xp, passion}.
 *     game.provide('mind', { learn(pawn, skillId, xp), skillLevel(pawn, skillId), skillFactor(pawn, workTypeId) }).
 *  5. Отношения: pawn.relations = {[otherId]: {opinion, kind: 'friend'|'rival'|'lover'|'family'}}; социальные взаимодействия.
 *  6. Срывы при низком настроении: истерика, запой, бегство, драка, поджог — через think-узел с высоким приоритетом;
 *     isInBreak(pawn). Сообщения через game.api.ui.notify.
 *  7. Расписание: pawn.schedule[24] = 'sleep'|'work'|'joy'|'any'; game.provide('mind', { scheduleAllows(pawn, activity) }).
 *  8. Биографии и имена: при 'pawn:spawned' заполнить pawn.bio = {childhood, adulthood, lines[]}, черты, навыки.
 *     Лидер (pawn.mage === true) — маг: навык magic ≥ 6.
 *  9. Реплики: game.api.mind.say(pawn, text) → событие 'pawn:said' (облачко рисует ui/av). Тексты — через
 *     game.i18n.tRude('mind.say.x.clean', 'mind.say.x.rude') — мат изредка (~1 из 10), не в момент смерти.
 * 10. UI: карточка персонажа (клавиша I) и панель расписания/отношений (F7) — game.ui.registerPanel(...).
 *     Подсказка над пешкой: game.ui.registerTooltip({id: 'mind', lines(game, hover) {...}}).
 * 11. Сохранение: компоненты на пешке сохраняются автоматически (только JSON-данные!).
 *
 * КЛАВИШИ (выделены): I — карточка персонажа, F7 — расписание/отношения.
 * СОБЫТИЯ: 'mind:thought' {pawn, id}, 'mind:breakStarted' {pawn, kind}, 'mind:breakEnded' {pawn}, 'mind:skillUp' {pawn, skill, level}.
 */
export function register(game) {
  void game;
}
