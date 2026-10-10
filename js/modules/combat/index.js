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
 *     points, kind, edge}), getMana(pawn) }, 'combat'). Урон — ТОЛЬКО через game.api.health.applyDamage(pawn, amount,
 *     {part, type, source}). Сущности-снаряды — вид 'projectile' (уже есть, не сохраняется).
 *  4. Лидер-маг: мана (pawn.mana = {cur, max}), 4 слота заклинаний (огненный шар, цепная молния, ледяное кольцо,
 *     щит рун, лечение, телепорт-блинк...), уровни и выбор 1 из 3. Ядро шлёт события ввода:
 *     'player:spell' {leader, slot, x, y}, 'player:attack' {leader, x, y} (ЛКМ — атака посохом),
 *     'player:dash' {leader, x, y} (Shift — рывок/блинк), 'player:callToArms' {leader} (R).
 *     Клавиши уже зарегистрированы ядром на владельца 'combat' (player:spell1..4, player:attack, player:dash, player:callToArms).
 *  5. «К оружию!»: ближние поселенцы (в радиусе голоса) — drafted, следуют за лидером и атакуют его цель
 *     (think-узел priority 97, interrupts: true, factions: ['colony']).
 *  6. Призыв/отпуск конкретного поселенца: F (наведённый поселенец) — draft toggle.
 *  7. Кровь и жёсткость (дозированно): декали (вид 'decal'), брызги — game.fx.emit / пресеты (game.defs.fxPresets),
 *     тряска game.api.av.shake, цифры урона game.api.av.floatText (учесть settings.damageNumbers).
 *  8. Рендер: слой снарядов/эффектов (order 70) и HUD маны/слотов (game.ui.registerHud({slot: 'bottom-center'})).
 *  9. Турели и боевой вагон: постройки (через game.defs.buildings.add, category 'security').
 *
 * КЛАВИШИ (выделены): ЛКМ — атака, 1–4 — заклинания, Shift — рывок, R — к оружию, F — призвать/отпустить поселенца.
 * СОБЫТИЯ: 'combat:hit' {attacker, target, damage, part}, 'combat:raidStarted' {faction, count}, 'combat:raidEnded' {},
 *          'combat:spellCast' {caster, spellId, x, y}, 'combat:levelUp' {pawn, level}.
 */
export function register(game) {
  void game;
}
