/**
 * МОДУЛЬ health — здоровье по частям тела, ранения, медицина, смерть, горе, похороны, «Павшие», наследник.
 * Владелец: js/modules/health/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * ЧТО СДЕЛАТЬ
 *  1. Тело: game.defs.create('bodyParts') — голова, туловище, руки, ноги, глаза, органы (hp, vital, влияние на
 *     движение/работу/зрение). pawn.health = {parts: {...}, conditions: [...], bleeding, pain, consciousness}.
 *     Инициализация на 'pawn:spawned' (не забыть лидера и врагов).
 *  2. Состояния (hediffs): game.defs.create('conditions') — порез, ушиб, ожог, перелом, кровотечение, инфекция,
 *     шрам, ампутация, протез (деревянная нога, рунная рука), болезни; опьянение/ломка — их регистрирует economy
 *     через ваш API addCondition.
 *  3. API (переопределить): game.provide('health', {
 *       applyDamage(pawn, amount, {part, type, source}) → нанесённый урон,
 *       heal(pawn, amount), kill(pawn, cause, opts) — ОБЯЗАТЕЛЬНО сохранить поведение ядра: pawn.dead = true,
 *         game.jobs.endJob, сброс груза, труп (game.entities.spawn('corpse', ...)), game.entities.remove(pawn),
 *         событие 'pawn:died' {pawn, corpse, cause} — на него завязано наследование власти (js/sim/colony.js);
 *       isDowned, canWork, moveSpeedFactor, workSpeedFactor, addCondition, hasCondition, getSummary }, 'health').
 *  4. Медицина: тип работ 'doctoring' уже есть; задачи 'tend' (перевязка с лекарством/без), 'rescue' (отнести
 *     упавшего в кровать/лазарет), 'feedPatient'. Лидер лечит руками через E (game.defs.interactions.add).
 *  5. Смерть: сцена (game.api.ui.notify + событие 'health:deathScene' {pawn, years, lastWords} для ui/av),
 *     серьёзный тон (без мата), имя и годы жизни, последняя строка биографии.
 *  6. Горе: при 'pawn:died' → game.api.mind.addThought(other, 'friend_died'|'lover_died'|'colonist_died', {otherPawnId}).
 *  7. Трупы: гниение (corpse.rot), мысль 'saw_corpse'; катафалк-вагон (wagonType 'hearse') — хранение тел;
 *     похороны на стоянке: могила (постройка; def можно добавить самим) + задача 'bury' + мысль 'buried_properly'.
 *  8. Наследник: game.colony.heirId — UI назначения (в панели здоровья или своей); при желании переопределить
 *     game.api.colony.chooseHeir(exclude) (учесть уважение/отношения из mind). Ядро само передаёт управление.
 *  9. UI: панель здоровья (F2) — части тела, состояния, лечение; «Павшие» (F8) — истории погибших
 *     (храните в своём сериализаторе game.save.registerSerializer({id: 'health', ...})).
 * 10. Тултип: game.ui.registerTooltip({id: 'health', lines(game, hover)}) — ранения наведённой пешки.
 *
 * КЛАВИШИ (выделены): F2 — здоровье, F8 — Павшие.
 * СОБЫТИЯ: 'health:injured' {pawn, part, type, amount}, 'health:downed' {pawn}, 'health:healed' {pawn}, 'health:buried' {corpse}.
 */
export function register(game) {
  void game;
}
