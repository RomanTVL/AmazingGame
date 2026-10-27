// Браузерный сценарий MVP-5 (ui): главное меню → новая игра (имя колонии/лидера, сид, сложность) → игра (обучение) →
// Esc → сохранить → выйти в меню → загрузить → продолжить; настройки (язык, грубая речь); экран конца игры; экран победы.
// Скриншоты — tests/screens/ui-*.png. Запуск: node tests/ui.browser.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/opt/pw-browsers';
const require = createRequire(import.meta.url);
let playwright;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try {
    playwright = require(p);
    break;
  } catch {
    /* следующий */
  }
}
if (!playwright) {
  console.error('Playwright не найден');
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });

const server = await startServer(0);
const port = server.address().port;
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
const g = (fn, arg) => page.evaluate(fn, arg);
const frames = (n = 2) => g((k) => new Promise((res) => {
  let i = 0;
  const f = () => (++i >= k ? res() : requestAnimationFrame(f));
  requestAnimationFrame(f);
}), n);
const shot = async (name) => {
  const file = path.join(SHOTS, `ui-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${path.relative(process.cwd(), file)}`);
};
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else problems.push(msg);
};
const screen = () => g(() => window.__game.api.ui.screen());
/** Клик по виджету ui по его id (прямоугольник прошлого кадра). */
async function clickWidget(id) {
  await frames(2);
  const r = await g((i) => window.__game.api.ui.widgetRect(i), id);
  if (!r) throw new Error(`нет виджета ${id}`);
  await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
  await frames(1);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await frames(3);
}
async function typeInto(id, text, clear = 0) {
  await clickWidget(id);
  for (let i = 0; i < clear; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 15 });
  await frames(2);
}

try {
  // 1. главное меню при запуске без параметров
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.__game && window.__game.map && window.__game.renderer, null, { timeout: 15000 });
  await frames(30);
  const boot = await g(() => ({ screen: window.__game.api.ui.screen(), paused: window.__game.paused, modal: window.__game.ui.modalOpen }));
  check(boot.screen === 'main' && boot.paused && boot.modal, `старт: главное меню, игра на паузе ${JSON.stringify(boot)}`);
  await page.mouse.move(800, 450);
  await frames(10);
  await shot('01-menu');

  // 2. новая игра
  await clickWidget('main:new');
  check((await screen()) === 'new', 'кнопка «Новая игра» открыла экран новой игры');
  // вставка из буфера (Ctrl+V → событие paste) и Ctrl+A
  await clickWidget('ng:colony');
  await page.keyboard.type('xyz');
  await page.keyboard.press('Control+A');
  await g(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Kovcheg');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await frames(3);
  check((await g(() => window.__game.api.ui.newGameForm().colony)) === 'Kovcheg', 'поле ввода: Ctrl+A и вставка из буфера');
  await typeInto('ng:leader', 'Ada Test');
  const seed0 = await g(() => window.__game.api.ui.newGameForm().seed);
  await typeInto('ng:seed', '4242'); // клик выделяет весь текст — набор заменяет случайный сид
  check(seed0 !== '4242' && (await g(() => window.__game.api.ui.newGameForm().seed)) === '4242', 'сид: набор заменяет выделенный текст');
  await clickWidget('ng:seed:clear');
  check((await g(() => window.__game.api.ui.newGameForm().seed)) === '', 'сид: кнопка «×» очищает поле');
  await page.keyboard.type('4242', { delay: 15 });
  await frames(2);
  await clickWidget('ng:diff:hard');
  await page.mouse.move(800, 860);
  await frames(4);
  await shot('02-new-game');
  await clickWidget('ng:start');
  await frames(10);
  const ng = await g(() => {
    const game = window.__game;
    return { screen: game.api.ui.screen(), paused: game.paused, colony: game.colony.name, leader: game.getLeader()?.name, diff: game.colony.difficulty, scen: game.colony.scenarioId, seed: game.seed, typing: game.input.textCapture, modal: game.ui.modalOpen };
  });
  check(!ng.screen && !ng.paused && !ng.typing && !ng.modal, `новая игра: экран закрыт, время идёт ${JSON.stringify(ng)}`);
  check(ng.colony === 'Kovcheg' && ng.leader === 'Ada Test' && ng.diff === 'hard' && ng.scen === 'three_survivors' && String(ng.seed) === '4242', `новая игра: параметры ${JSON.stringify(ng)}`);

  // 3. игра: WASD двигает лидера, обучение засчитывает шаг
  const p0 = await g(() => ({ x: window.__game.getLeader().x, tut: window.__game.api.ui.tutorial() }));
  check(p0.tut.active && p0.tut.step === 'move', `обучение: первая подсказка WASD ${JSON.stringify(p0.tut)}`);
  await g(() => {
    const game = window.__game;
    game.time.setHour?.(12);
  });
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await page.keyboard.up('d');
  await frames(5);
  const p1 = await g(() => ({ x: window.__game.getLeader().x, tut: window.__game.api.ui.tutorial() }));
  check(p1.x > p0.x + 0.5, `лидер идёт на D (${p0.x.toFixed(1)} → ${p1.x.toFixed(1)})`);
  check(p1.tut.done.move && p1.tut.step === 'chop', `обучение: WASD засчитан, дальше рубка ${JSON.stringify(p1.tut)}`);
  await frames(10);
  await shot('03-play-tutorial');
  const ui0 = await g(() => {
    const game = window.__game;
    const txt = game.t('hint.start');
    const e = game.log.find((l) => l.text === txt);
    return { toastHidden: !!e && e._shownAt < 0, card: game.api.ui.widgetRect('tut:skip') };
  });
  check(ui0.toastHidden, 'стартовый тост ядра не дублирует обучение');
  check(ui0.card && ui0.card.y > 900 * 0.6, `карточка обучения внизу слева (${JSON.stringify(ui0.card)})`);
  await clickWidget('tut:skip');
  check((await g(() => window.__game.api.ui.tutorial().step)) === 'bed', 'обучение: «Дальше» переключает подсказку');
  // шаг «кровать»: B открывает стройку с выбранной кроватью, карточка не под панелью
  await page.keyboard.press('b');
  await frames(6);
  const bp = await g(() => {
    const game = window.__game;
    const def = game.ui.panels.get('build');
    return { open: game.ui.isOpen('build'), tool: game.api.build.getTool(), panelBottom: 70 + Math.min(def.height, 900 - 120), card: game.api.ui.widgetRect('tut:skip'), cardFrame: game.api.ui.widgetRect('tut:skip')?.frame };
  });
  check(bp.open && bp.tool.id === 'bed', `B на шаге «кровать»: меню стройки с кроватью (${JSON.stringify(bp.tool)})`);
  check(bp.card && bp.card.y > bp.panelBottom, `карточка обучения не перекрывается меню стройки (${bp.card?.y} > ${bp.panelBottom})`);
  await shot('03b-build-tutorial');
  await g(() => window.__game.api.build.setTool(null));
  await frames(3);
  // H вне кабины — шаг не засчитан
  await page.keyboard.press('h');
  await frames(4);
  check(!(await g(() => window.__game.api.ui.tutorial().done.horn)), 'H вне кабины не засчитывает шаг «гудок»');

  // 4. Esc → пауза → сохранить в ячейку 1
  await page.keyboard.press('Escape');
  await frames(4);
  const pz = await g(() => ({ screen: window.__game.api.ui.screen(), paused: window.__game.paused }));
  check(pz.screen === 'pause' && pz.paused, `Esc: пауза ${JSON.stringify(pz)}`);
  await page.keyboard.press('KeyW');
  await page.keyboard.press('Space');
  await frames(3);
  check(await g(() => window.__game.paused && window.__game.api.ui.screen() === 'pause'), 'в паузе игровые клавиши молчат');
  await shot('04-pause');
  await clickWidget('pause:save');
  check((await screen()) === 'save', 'пауза → «Сохранить»: экран ячеек');
  await shot('05-save');
  await clickWidget('slot:save:slot1');
  const saved = await g(() => ({ has: window.__game.save.hasSlot('slot1'), tick: window.__game.time.tick, screen: window.__game.api.ui.screen(), x: window.__game.getLeader().x }));
  check(saved.has && saved.screen === 'pause', `сохранено в ячейку 1, назад в паузу ${JSON.stringify(saved)}`);

  // 5. выйти в меню → загрузить
  await clickWidget('pause:exit');
  check((await screen()) === 'main', 'пауза → «Выйти в меню»');
  await frames(10);
  await shot('06-menu-continue');
  // портим текущую игру, чтобы загрузка была заметна
  await g(() => window.__game.newGame({ seed: 1, colonyName: 'Chuzhaya' }));
  await clickWidget('main:load');
  check((await screen()) === 'load', 'меню → «Загрузить»: список сохранений');
  await shot('07-load');
  await clickWidget('slot:load:slot1');
  await frames(5);
  const ld = await g(() => ({ screen: window.__game.api.ui.screen(), paused: window.__game.paused, colony: window.__game.colony.name, tick: window.__game.time.tick, x: window.__game.getLeader()?.x, tut: window.__game.api.ui.tutorial() }));
  check(!ld.screen && !ld.paused && ld.colony === 'Kovcheg' && ld.tick >= saved.tick && ld.tick < saved.tick + 600, `загружено: ${JSON.stringify({ ...ld, tut: undefined })}`);
  check(ld.tut.step === 'bed', `обучение сохранилось в сейве: ${ld.tut.step}`);
  // 6. продолжить игру
  const t0 = ld.tick;
  await frames(30);
  check((await g(() => window.__game.time.tick)) > t0, 'после загрузки игра продолжается');

  // 7. настройки: язык и грубая речь
  await page.keyboard.press('Escape');
  await frames(3);
  await clickWidget('pause:settings');
  check((await screen()) === 'settings', 'пауза → «Настройки»');
  // ползунок: клик (нажал и отпустил в одном кадре) сразу меняет значение
  const vol0 = await g(() => window.__game.settings.get('musicVolume'));
  const sr = await g(() => window.__game.api.ui.widgetRect('set:musicVolume'));
  await page.mouse.click(sr.x + sr.w - 70, sr.y + sr.h / 2);
  await frames(3);
  const vol1 = await g(() => window.__game.settings.get('musicVolume'));
  check(vol1 > vol0 + 0.2, `ползунок громкости: клик применяет значение (${vol0} → ${vol1})`);
  await g((v) => window.__game.settings.set('musicVolume', v), vol0);
  await clickWidget('set:lang:en');
  const rude0 = await g(() => window.__game.settings.get('rudeSpeech'));
  await clickWidget('set:rudeSpeech');
  const st = await g(() => ({ lang: window.__game.i18n.lang, rude: window.__game.settings.get('rudeSpeech') }));
  check(st.lang === 'en' && st.rude === !rude0, `настройки: язык EN, грубая речь переключена ${JSON.stringify(st)}`);
  await page.mouse.move(10, 10);
  await frames(4);
  await shot('08-settings-en');
  await clickWidget('set:lang:ru');
  await clickWidget('set:rudeSpeech');
  await page.keyboard.press('Escape');
  await frames(3);
  check((await screen()) === 'pause', 'Esc в настройках — назад в паузу');
  await page.keyboard.press('Escape');
  await frames(3);
  check(!(await screen()) && !(await g(() => window.__game.paused)), 'Esc в паузе — продолжить');

  // 8. экран конца игры
  await g(() => {
    const game = window.__game;
    for (const p of game.colonists()) game.api.health.kill(p, 'starvation', {});
  });
  await frames(10);
  const ov = await g(() => ({ screen: window.__game.api.ui.screen(), lost: window.__game.colony.lost, paused: window.__game.paused }));
  check(ov.screen === 'over' && ov.lost && ov.paused, `конец игры: экран ${JSON.stringify(ov)}`);
  await page.mouse.move(10, 10);
  await frames(6);
  await shot('09-game-over');
  await clickWidget('over:menu');
  check((await screen()) === 'main', 'конец игры → главное меню');
  await clickWidget('main:cont');
  const ct = await g(() => ({ screen: window.__game.api.ui.screen(), colony: window.__game.colony.name, lost: window.__game.colony.lost }));
  check(!ct.screen && ct.colony === 'Kovcheg' && !ct.lost, `меню → «Продолжить»: последний сейв ${JSON.stringify(ct)}`);

  // 9. экран победы (событие journey 'game:victory')
  await g(() => window.__game.events.emit('game:victory', { ending: 'bone_dragon', stats: { day: 9, survivors: window.__game.colonists().length, leftBehind: 1, stations: 4, raids: 2, ambushes: 1 } }));
  await frames(10);
  check((await screen()) === 'victory', 'победа: экран итогов');
  await page.mouse.move(10, 10);
  await frames(6);
  await shot('10-victory');
  await clickWidget('win:cont');
  check(!(await screen()) && !(await g(() => window.__game.paused)), 'победа → «Продолжить»: игра идёт');

  const errs = await g(() => window.__game.errors.map((e) => `${e.where}: ${e.message || e}`));
  if (errs.length) problems.push(...errs);
  const missing = await g(() => [...window.__game.i18n.missing]);
  if (missing.length) problems.push(`нет перевода: ${missing.slice(0, 10).join(', ')}`);
} catch (err) {
  problems.push(`exception: ${err.stack || err}`);
}
await browser.close();
server.close();
const failed = problems.length > 0;
for (const p of problems) console.error(`  ✗ ${p}`);
console.log(failed ? '✗ FAIL' : '✓ PASS');
process.exit(failed ? 1 : 0);
