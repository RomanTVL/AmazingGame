/**
 * МОДУЛЬ ui — интерфейс: главное меню, пауза, настройки, работы (F1), журнал (F3), инвентарь (Tab),
 * сохранения (F5/F6), уведомления, панель поселенцев, инспектор, экран конца игры.
 * Владелец: js/modules/ui/** . Контракт ядра: docs/ARCHITECTURE.md (раздел UI).
 *
 * ЧТО СДЕЛАТЬ
 *  1. Главное меню: main.js сразу стартует колонию-фон (game.newGame), меню — модальная панель (modal: true) поверх.
 *     НОВАЯ ИГРА (без перезагрузки страницы): game.newGame({seed, scenarioId, difficulty, colonyName, leaderName,
 *     leaderGender, look: {curls 5..9, curlLen 0.6..1.4, crystal '#hex', scar}, roster: [{name, gender, age, bio, traits,
 *     skills, look, role}]}) — сценарии game.defs.scenarios.all() (nameKey, descKey, difficulty, rerolls, colonists),
 *     сложности game.defs.difficulties.all(); кандидаты для реролла — game.api.mind.generateCandidate(rng, opts)
 *     (rng = new RNG(`${seed}:roster:${n}`) из js/core/rng.js); превью лидера — тот же отрисовщик пешки. Поля ввода (имя, сид) —
 *     game.input.captureText('ui') … releaseText(): пока захвачено, игровые клавиши молчат, текст — game.input.typed.
 *     Продолжить — game.save.listSlots() / loadSlot(slot) (может бросить на битом сейве — try/catch).
 *  2. Пауза/меню по Esc: ядро шлёт 'ui:menuRequested', если нет открытых панелей (Esc закрывает верхнюю панель).
 *  3. Настройки: язык (game.settings.set('lang', 'en')), громкости (masterVolume/musicVolume/sfxVolume),
 *     «Грубая речь» (rudeSpeech), тряска (shake), цифры урона (damageNumbers), переназначение клавиш
 *     (game.input.bindings, game.input.rebind(action, key), конфликты — game.input.conflicts).
 *  4. Работы (F1): таблица поселенцы × game.defs.workTypes, приоритеты 0–4 (game.jobs.getPriority / setPriority).
 *  5. Журнал (F3): game.log (заполняется game.api.ui.notify). Переопределите game.provide('ui', { notify }) для
 *     красивых «писем» — но сохраните запись в game.log и событие 'ui:notify'.
 *  6. Инвентарь (Tab): лидер/наведённый поселенец — pawn.carry, pawn.inventory, pawn.equipment; склад — game.items.totals().
 *  7. Сохранения: F5 — быстрое сохранение (game.save.saveSlot('quick'); 0 = хранилище отказало, ядро уже уведомило),
 *     F6 — загрузка (game.save.loadSlot('quick')), слоты в меню. Автосейв раз в игровой день ('time:day').
 *  8. Панель поселенцев сверху слева (портреты-кружки цвета pawn.color, настроение, клик — камера к нему:
 *     game.camera.followId), уведомления справа (ядро рисует простые тосты HUD 'core:toasts' — замените:
 *     game.ui.hud.remove('core:toasts')), инспектор выбранной сущности.
 *  9. Конец игры: 'colony:lost' → модальный экран; 'game:victory' {ending, stats} → финал; 'leader:changed' → баннер
 *     «Власть переходит к ...».
 * 10. Облачка реплик 'pawn:said' (совместно с av) — оверлей пешки game.render.registerPawnOverlay({id: 'ui:bubbles', ...}).
 * 11. Цели: переопределите game.provide('ui', { setObjective(id, text, opts), clearObjective(id) }) — заглушка хранит
 *     их в game.colony.objectives (сохраняется); HUD целей рисуете вы.
 *
 * КЛАВИШИ (выделены, js/core/keymap.js): Esc — меню (ядро: 'ui:back' → 'ui:menuRequested'), F1 — работы ('panel:work'),
 *          F3 — журнал ('panel:log'), F5 — быстрое сохранение ('ui:quicksave'), F6 — быстрая загрузка ('ui:quickload'),
 *          F10 — настройки ('panel:settings'), Tab — инвентарь ('panel:inventory').
 * Помощники рисования: game.ui.panel/button/text/bar/list/tooltip (js/engine/ui.js), тема THEME.
 */
export function register(game) {
  void game;
}
