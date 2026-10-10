/**
 * МОДУЛЬ av — аудио и визуальная полировка: библиотека звуков, адаптивная музыка, частицы, погода,
 * тряска, цифры урона, пост-эффекты, сцена смерти (приглушение звука).
 * Владелец: js/modules/av/** . Контракт ядра: docs/ARCHITECTURE.md.
 *
 * ЧТО СДЕЛАТЬ
 *  1. Звуки: game.audio.registerSfx(id, {layers, cooldown, jitter}) — процедурные (js/engine/audio.js, CORE_SFX);
 *     звуки для событий всех модулей: шаги по разным поверхностям, двери, удары, выстрелы, заклинания, крики,
 *     смерть (тихий «звон»), UI. Отклик ядра на события — js/engine/index.js (registerFeedback, владелец 'core-fx');
 *     можно снять game.events.offOwner('core-fx') и сделать свой богаче.
 *  2. Музыка: адаптивная (день/ночь/биом/бой/горе) — замените game.audio.music своим объектом с update(dt)
 *     (см. AmbientMusic). Учитывать settings.musicVolume (game.audio.applyVolumes()).
 *  3. Частицы: пресеты game.defs.fxPresets.add({id, emit(fx, x, y, opts)}) — кровь, искры, магия, дым поезда,
 *     светлячки ночью в лесу, пепел, снег. Пул — game.fx (js/engine/particles.js).
 *  4. Погода: дождь, снег, пепел, туман — слой order 85 (game.render.registerLayer({space: 'world'|'screen'})).
 *  5. Экранные эффекты: виньетка, «бloom»-подсветка неона (дёшево: аддитивные спрайты glow.js), вспышки урона —
 *     слой order 150 (space: 'screen').
 *  6. API: game.provide('av', { shake(amount), floatText(x, y, text, color), play(sfxId, opts) }, 'av').
 *     Цифры урона — только если game.settings.get('damageNumbers'); тряска — если 'shake'.
 *  7. Сцена смерти (событие 'health:deathScene' или 'pawn:died'): приглушить звук, медленная пауза, без шуток.
 *  8. Мьют: F10 занята ui (настройки) — используйте 'KeyM' для mute (выделена av).
 *
 * КЛАВИШИ (выделены): M — звук вкл/выкл.
 */
export function register(game) {
  void game;
}
