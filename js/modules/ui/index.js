/**
 * МОДУЛЬ ui — интерфейс: главное меню, пауза, настройки, работы (F1), журнал (F3), инвентарь (Tab),
 * сохранения (F5/F6), уведомления, панель поселенцев, инспектор, экран конца игры.
 * Владелец: js/modules/ui/** . Контракт ядра: docs/ARCHITECTURE.md (раздел UI).
 *
 * ЧТО СДЕЛАТЬ
 *  1. Главное меню: новая игра (выбор сложности — сохранить в game.settings или journey), продолжить
 *     (game.save.listSlots / loadSlot), настройки, выход. Сейчас main.js сразу стартует колонию: сделайте экран
 *     меню модальной панелью (modal: true) поверх уже сгенерированной сцены или слушайте 'game:init'.
 *  2. Пауза/меню по Esc: ядро шлёт 'ui:menuRequested', если нет открытых панелей (Esc закрывает верхнюю панель).
 *  3. Настройки: язык (game.settings.set('lang', 'en')), громкости (masterVolume/musicVolume/sfxVolume),
 *     «Грубая речь» (rudeSpeech), тряска (shake), цифры урона (damageNumbers), переназначение клавиш
 *     (game.input.bindings, game.input.rebind(action, key), конфликты — game.input.conflicts).
 *  4. Работы (F1): таблица поселенцы × game.defs.workTypes, приоритеты 0–4 (game.jobs.getPriority / setPriority).
 *  5. Журнал (F3): game.log (заполняется game.api.ui.notify). Переопределите game.provide('ui', { notify }) для
 *     красивых «писем» — но сохраните запись в game.log и событие 'ui:notify'.
 *  6. Инвентарь (Tab): лидер/наведённый поселенец — pawn.carry, pawn.inventory, pawn.equipment; склад — game.items.totals().
 *  7. Сохранения: F5 — быстрое сохранение (game.save.saveSlot('quick')), F6 — загрузка (game.save.loadSlot('quick')),
 *     слоты в меню. Автосейв раз в игровой день ('time:day').
 *  8. Панель поселенцев сверху слева (портреты-кружки цвета pawn.color, настроение, клик — камера к нему:
 *     game.camera.followId), уведомления справа (ядро рисует простые тосты HUD 'core:toasts' — замените:
 *     game.ui.hud.remove('core:toasts')), инспектор выбранной сущности.
 *  9. Конец игры: 'colony:lost' → модальный экран; 'leader:changed' → баннер «Власть переходит к ...».
 * 10. Облачка реплик 'pawn:said' (совместно с av) — слой order 98.
 *
 * КЛАВИШИ (выделены): Esc — меню (через ui:menuRequested), F1 — работы, F3 — журнал, F5 — быстрое сохранение,
 *          F6 — быстрая загрузка, F10 — настройки, Tab — инвентарь.
 * Помощники рисования: game.ui.panel/button/text/bar/list/tooltip (js/engine/ui.js), тема THEME.
 */
export function register(game) {
  void game;
}
