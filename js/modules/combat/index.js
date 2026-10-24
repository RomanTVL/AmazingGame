/**
 * МОДУЛЬ combat — бой: оружие, враги и рейды, маг-лидер и заклинания, призыв «К оружию!», снаряды, кровь.
 * Владелец: js/modules/combat/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * ЧТО СДЕЛАТЬ
 *  1. Оружие и экипировка: предметы (game.defs.items.add({category: 'weapon', weapon: {damage, range, cooldown,
 *     type: 'melee'|'ranged', projectile}}, 'combat')) — луки, арбалеты, мечи, топоры, рунные ружья;
 *     pawn.equipment.weapon = defId.
 *  2. Враги (≥ 8 видов + 3 босса — Костяной дракон, Лич-кукловод, Сердце Гнили): game.defs.create('enemies')
 *     {id, nameKey, hp, speed, weapon, color, draw?}; пешки с faction 'enemy' (createPawn из js/sim/pawn.js).
 *     ИИ врагов — думающие узлы с factions: ['enemy'] (game.ai.registerThinkNode) — атака, штурм дверей, отступление.
 *  3. API: game.provide('combat', { isHostile, isDrafted, setDrafted, attack(attacker, target), spawnRaid({faction,
 *     points, kind, edge}), getMana(pawn), hasStaff(pawn) }, 'combat'). Урон — ТОЛЬКО через
 *     game.api.health.applyDamage(pawn, amount, {part, type, source}). Сущности-снаряды — вид 'projectile' (не сохраняется).
 *  4. Лидер-маг: мана (pawn.mana = {cur, max}), 4 слота заклинаний (огненный шар, цепная молния, ледяное кольцо,
 *     щит рун, лечение, телепорт-блинк...), уровни и выбор 1 из 3, перки — pawn.perks = {} (JSON). Ядро шлёт
 *     события ввода: 'player:spell' {leader, slot, x, y}, 'player:attack' {leader, x, y} (ЛКМ — атака посохом),
 *     'player:dash' {leader, x, y} (Shift — рывок/БЛИНК), 'player:callToArms' {leader} (R).
 *     Клавиши уже зарегистрированы ядром на владельца 'combat' (player:spell1..4, player:attack, player:dash,
 *     player:callToArms). Пробел — ПАУЗА (ядро), блинк на пробел НЕ вешать: блинк = рывок (Shift) или слот 1–4.
 *     Режим выбора цели заклинания, которому нужна ЛКМ: game.input.consume('player:attack') (кадровая система, order < 30).
 *  5. «К оружию!»: ближние поселенцы (в радиусе голоса) — drafted, следуют за лидером и атакуют его цель
 *     (think-узел priority 97, interrupts: true, factions: ['colony']).
 *  6. Призыв/отпуск конкретного поселенца: F (наведённый поселенец) — действие 'combat:draft' (KeyF), draft toggle.
 *  7. Кровь и жёсткость (дозированно): декали (вид 'decal'), брызги — game.fx.emit / пресеты (game.defs.fxPresets),
 *     тряска game.api.av.shake, цифры урона game.api.av.floatText (учесть settings.damageNumbers), стоп-кадр
 *     попадания game.api.av.hitStop(60) (= game.slowMo(0.05, 60)), последний рейдер — game.slowMo(0.3, 600).
 *  8. Рендер: слой снарядов/эффектов (order 70) и HUD маны/слотов (game.ui.registerHud({slot: 'bottom-center'})).
 *  9. Турели и боевой вагон: постройки (через game.defs.buildings.add, category 'security').
 * 10. Именное оружие: событие 'combat:weaponNamed' {item, name}; безымянный враг/поселенец — pawn.nameless = true.
 *
 * КЛАВИШИ (выделены): ЛКМ — атака, 1–4 — заклинания, Shift — рывок/блинк, R — к оружию, F — призвать/отпустить
 *          ('combat:draft'). Таблица — js/core/keymap.js.
 * СОБЫТИЯ: 'combat:hit' {attacker, target, damage, part}, 'combat:raidStarted' {faction, count}, 'combat:raidEnded' {},
 *          'combat:spellCast' {caster, spellId, x, y}, 'combat:levelUp' {pawn, level}, 'combat:weaponNamed' {item, name}.
 */
export function register(game) {
  void game;
}
