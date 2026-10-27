// Тест модуля ui (headless, MVP-5): стек экранов (пауза по Esc, назад), новая игра из формы → game.newGame со сценарием
// «Трое выживших», сохранение в ячейку и загрузка (в т.ч. битый сейв), автосохранение по прибытии на станцию,
// экран конца игры (статистика, павшие), экран победы, обучение (6 подсказок, отключение), строки ru/en.
// Запуск: node tests/ui.test.mjs
import { createGame, startNewColony } from '../js/core/boot.js';
import { registerStrings } from '../js/modules/ui/strings.js';
import { STEPS } from '../js/modules/ui/tutorial.js';
import { overStats, fallenList } from '../js/modules/ui/screens.js';

let fails = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) {
    fails++;
    console.error(`  ✗ ${msg}`);
  } else console.log(`  ✓ ${msg}`);
};
const run = (g, n) => {
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) {
      g.frame(1 / 60);
      g.input.endFrame();
    }
    g.step();
  }
};
const frame = (g) => {
  g.frame(1 / 60);
  g.input.endFrame();
};

const g = await createGame({ headless: true, seed: 3 });
startNewColony(g, { seed: 3 });
const U = g.api.ui;

console.log('1. Модуль и экраны');
{
  ok(g.modules.includes('ui'), 'модуль ui зарегистрирован');
  ok(['screen', 'openScreen', 'closeScreens', 'menuAction', 'newGameForm', 'widgetRect', 'tutorial'].every((f) => typeof U[f] === 'function'), 'API ui: screen/openScreen/closeScreens/menuAction/…');
  ok(typeof U.notify === 'function' && typeof U.setObjective === 'function', 'заглушки ядра ui.notify/setObjective на месте');
  frame(g);
  ok(U.screen() === null, 'в headless меню при старте не открывается');
  ok(g.render.layers.has('ui:screens') && g.ui.hud.has('ui:tutorial') && g.ui.panels.has('ui_screen'), 'слой экранов, HUD обучения, модальная панель зарегистрированы');
  g.events.emit('ui:menuRequested', {});
  ok(U.screen() === 'pause', 'Esc (ui:menuRequested) → пауза');
  U.openScreen('settings');
  ok(U.screen() === 'settings', 'пауза → настройки');
  U.menuAction('escape');
  ok(U.screen() === 'pause', 'Esc в настройках → назад в паузу');
  U.menuAction('escape');
  ok(U.screen() === null, 'Esc в паузе → продолжить');
  ok(!U.openScreen('nope'), 'неизвестный экран не открывается');
  ok(g.settings.get('ui.tutorial') === true, "настройка 'ui.tutorial' по умолчанию включена");
}

console.log('2. Новая игра');
{
  U.openScreen('main');
  U.menuAction('new');
  const F = U.newGameForm();
  ok(U.screen() === 'new' && F.scenarioId === 'three_survivors' && F.difficulty === 'normal' && /^\d+$/.test(F.seed), `форма новой игры: ${JSON.stringify(F)}`);
  const okStart = U.menuAction('start', { colony: 'Ковчег', leader: 'Ада Лавлейс', seed: '4242', difficulty: 'hard' });
  ok(okStart && U.screen() === null, 'старт закрывает меню');
  ok(g.colony.name === 'Ковчег' && g.getLeader()?.name === 'Ада Лавлейс' && g.colony.difficulty === 'hard' && g.colony.scenarioId === 'three_survivors' && g.seed === 4242, `game.newGame: ${g.colony.name}, ${g.getLeader()?.name}, ${g.colony.difficulty}, ${g.colony.scenarioId}, сид ${g.seed}`);
  U.menuAction('start', { colony: '', leader: '', seed: 'abc' });
  ok(g.colony.name === g.t('colony.defaultName') && g.seed === 'abc', `пустые поля → имя по умолчанию, строковый сид (${g.colony.name}, ${g.seed})`);
  U.menuAction('start', { colony: 'Ковчег', leader: 'Ада Лавлейс', seed: '4242', difficulty: 'hard' });
}

console.log('3. Обучение');
{
  let T = U.tutorial();
  ok(T.active && T.step === 'move' && STEPS.length === 6, `первая подсказка — WASD (${JSON.stringify(T)})`);
  ok(STEPS.map((s) => s.key).join(' ') === 'WASD E B R H F4', 'шаги: WASD, E, B, R, H, F4');
  g.input.setKey('KeyD', true);
  frame(g);
  g.input.setKey('KeyD', false);
  frame(g);
  T = U.tutorial();
  ok(T.done.move && T.step === 'chop', 'WASD засчитан → дальше рубка');
  g.events.emit('player:interact', { pawn: g.getLeader(), interaction: { id: 'chop' } });
  g.events.emit('build:placed', { entity: { buildDefId: 'bed' } });
  g.events.emit('player:callToArms', { leader: g.getLeader() });
  g.events.emit('journey:horn', { pattern: 'short' });
  T = U.tutorial();
  ok(T.done.chop && T.done.bed && T.done.arms && T.done.horn && T.step === 'route', `E, B, R, H засчитаны по событиям → карта F4 (${T.step})`);
  g.settings.set('ui.tutorial', false);
  ok(!U.tutorial().active, 'подсказки отключаются настройкой');
  g.settings.set('ui.tutorial', true);
  ok(U.tutorial().active, '…и включаются обратно');
  U.openScreen('pause');
  ok(!U.tutorial().active, 'при открытом экране подсказка скрыта');
  U.closeScreens();
}

console.log('4. Сохранение и загрузка');
{
  U.openScreen('pause');
  U.menuAction('save');
  ok(U.screen() === 'save', 'пауза → ячейки сохранения');
  const bytes = U.menuAction('saveSlot', 'slot1');
  ok(bytes > 0 && g.save.hasSlot('slot1') && U.screen() === 'pause', `сохранено в slot1 (${(bytes / 1024).toFixed(0)} КБ), назад в паузу`);
  U.closeScreens();
  const tick = g.time.tick;
  run(g, 120);
  U.menuAction('exit');
  ok(U.screen() === 'main', 'выйти в меню');
  U.menuAction('start', { colony: 'Чужая', seed: '1' });
  ok(g.colony.name === 'Чужая', 'другая игра');
  U.openScreen('main');
  ok(U.menuAction('loadSlot', 'slot1') === true && U.screen() === null, 'загрузка slot1 закрывает меню');
  ok(g.colony.name === 'Ковчег' && g.time.tick === tick && g.getLeader()?.name === 'Ада Лавлейс', `состояние восстановлено (${g.colony.name}, тик ${g.time.tick})`);
  ok(U.tutorial().step === 'route' && U.tutorial().done.horn, 'прогресс обучения сохранился в сейве');
  g.storage.setItem('lasttrain.save.broken', '{oops');
  U.openScreen('load');
  const errs0 = g.errors.length;
  ok(U.menuAction('loadSlot', 'broken') === false && U.screen() === 'load' && g.colony.name === 'Ковчег', 'битый сейв не загружается, меню остаётся');
  ok(U.menuAction('loadSlot', 'missing') === false, 'пустая ячейка не загружается');
  ok(g.errors.length === errs0, 'битый сейв не пишет в game.errors');
  g.storage.removeItem('lasttrain.save.broken');
  U.closeScreens();
  ok(!g.save.hasSlot('auto'), 'автосохранения ещё нет');
  g.events.emit('journey:arrived', { station: { index: 1, name: 'Тест' } });
  frame(g);
  ok(g.save.hasSlot('auto'), 'автосохранение по прибытии на станцию');
  ok(g.log.some((l) => l.text === g.t('ui.slots.autosaved')), 'уведомление об автосохранении');
}

console.log('5. Конец игры и победа');
{
  run(g, 60);
  const names = g.colonists().map((p) => p.name);
  for (const p of g.colonists()) g.api.health.kill(p, 'starvation', {});
  ok(g.colony.lost && U.screen() === 'over', 'colony:lost → экран конца игры');
  const fl = fallenList(g, { S: { fallen: [] } });
  ok(fl.length >= names.length && names.every((n) => fl.some((f) => f.name === n)), `павшие в списке: ${fl.map((f) => f.name).join(', ')}`);
  const st = overStats(g, { S: { raids: 1, peak: 3, stations: 0, fallen: [] } });
  ok(st.length === 6 && st.every(([l, v]) => typeof l === 'string' && v !== undefined), `статистика: ${st.map(([l, v]) => `${l}=${v}`).join(', ')}`);
  U.menuAction('escape');
  ok(U.screen() === 'over', 'Esc не закрывает экран конца игры');
  U.menuAction('new');
  ok(U.screen() === 'new', 'конец игры → новая игра');
  U.menuAction('back');
  ok(U.screen() === 'over', '…назад');
  ok(U.menuAction('loadSlot', 'slot1') && !g.colony.lost && U.screen() === null, 'конец игры → загрузка');
  g.events.emit('game:victory', { ending: 'bone_dragon', stats: { day: 9, survivors: 3, stations: 4 } });
  ok(U.screen() === 'victory', 'game:victory → экран победы');
  U.menuAction('resume');
  ok(U.screen() === null, 'победа → продолжить');
}

console.log('6. Строки ru/en');
{
  const store = {};
  registerStrings({ i18n: { add: (lang, o) => (store[lang] = o) } });
  const flat = (o, p = '', out = []) => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, `${p}${k}.`, out);
      else out.push(`${p}${k}`);
    }
    return out;
  };
  const ru = flat(store.ru).sort();
  const en = flat(store.en).sort();
  ok(ru.length > 80 && ru.join() === en.join(), `ключи ru = en (${ru.length})`);
  const miss = [...g.i18n.missing].filter((k) => k.startsWith('ui.'));
  ok(miss.length === 0, `нет пропущенных ключей ui (${miss.join(', ')})`);
}

ok(g.errors.length === 0, `без ошибок (${g.errors.map((e) => `${e.where}: ${e.message}`)})`);
ok(g.input.conflicts.length === 0, 'без конфликтов клавиш');

console.log(`${checks - fails}/${checks} проверок`);
if (fails) {
  console.error(`✗ FAIL: ${fails}`);
  process.exitCode = 1;
} else console.log('✓ PASS');
