// Дымовой тест в headless Chromium (Playwright, установлен глобально).
// Запуск: node tests/browser.mjs [--seed 42] [--keep]
// Поднимает статический сервер, открывает игру 1600×900, жмёт WASD/E/C+мышь/колесо, снимает скриншоты
// в tests/screens/*.png, меряет FPS. Падает при любой ошибке консоли/страницы или game.errors.
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
  console.error('Playwright не найден (ожидается /opt/node22/lib/node_modules/playwright)');
  process.exit(2);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const argSeed = process.argv.indexOf('--seed');
const SEED = argSeed > 0 ? process.argv[argSeed + 1] : '42';

const server = await startServer(0);
const port = server.address().port;
const browser = await playwright.chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  if (msg.type() === 'warning') console.log(`  [warn] ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));

const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${path.relative(process.cwd(), file)}`);
};
const hold = async (key, ms) => {
  await page.keyboard.down(key);
  await wait(ms);
  await page.keyboard.up(key);
};
const g = (fn, arg) => page.evaluate(fn, arg);

let fps = 0;
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?seed=${SEED}`);
  await page.waitForFunction(() => window.__game && window.__game.map && window.__game.renderer, null, { timeout: 15000 });
  await page.mouse.move(800, 450);
  await wait(1500);
  await shot('01-start');

  // ходьба
  await hold('d', 900);
  await hold('s', 700);
  await hold('a', 500);
  const moved = await g(() => {
    const l = window.__game.getLeader();
    return { x: l.x, y: l.y };
  });
  console.log(`  лидер в (${moved.x.toFixed(1)}, ${moved.y.toFixed(1)})`);
  await shot('02-walk');

  // E по ближайшему дереву: наводим мышь и жмём E
  const tree = await g(() => {
    const game = window.__game;
    const l = game.getLeader();
    const trees = game.entities.queryRadius(l.x, l.y, 7.5, 'plant', (e) => game.defs.plants.get(e.defId)?.choppable);
    trees.sort((a, b) => Math.hypot(a.x - l.x, a.y - l.y) - Math.hypot(b.x - l.x, b.y - l.y));
    const t = trees[0];
    if (!t) return null;
    const s = game.camera.worldToScreen(t.x + 0.5, t.y + 0.5);
    return { id: t.id, sx: s.x, sy: s.y };
  });
  if (tree) {
    await page.mouse.move(tree.sx, tree.sy);
    await wait(150);
    await page.keyboard.press('e');
    await wait(2500);
    await shot('03-chop');
    await wait(3500);
    const chopped = await g((id) => !window.__game.entities.get(id), tree.id);
    console.log(`  дерево срублено: ${chopped}`);
    if (!chopped) problems.push('лидер не срубил дерево по E');
  } else problems.push('нет дерева рядом с лидером');

  // C + перетаскивание: пометить рощу
  const area = await g(() => {
    const game = window.__game;
    const l = game.getLeader();
    const trees = game.entities.queryRadius(l.x, l.y, 12, 'plant', (e) => game.defs.plants.get(e.defId)?.choppable);
    const t = trees[Math.floor(trees.length / 2)] || trees[0];
    const a = game.camera.worldToScreen(t.x - 2, t.y - 2);
    const b = game.camera.worldToScreen(t.x + 3, t.y + 3);
    return { a, b };
  });
  await page.keyboard.down('c');
  await page.mouse.move(area.a.x, area.a.y);
  await page.mouse.down();
  await page.mouse.move((area.a.x + area.b.x) / 2, (area.a.y + area.b.y) / 2, { steps: 4 });
  await page.mouse.move(area.b.x, area.b.y, { steps: 4 });
  await shot('04-designate-drag');
  await page.mouse.up();
  await page.keyboard.up('c');
  const des = await g(() => window.__game.designations.count());
  console.log(`  пометок: ${des}`);
  if (des < 1) problems.push('C+перетаскивание не поставило пометок');

  // ускорение времени, поселенцы работают
  await page.keyboard.press('Equal');
  await page.keyboard.press('Equal');
  await wait(4000);
  await shot('05-colonists-work');
  await page.keyboard.press('Minus');
  await page.keyboard.press('Minus');

  // зум
  await page.mouse.move(800, 450);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -120);
    await wait(60);
  }
  await wait(700);
  await shot('06-zoom-in');
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 120);
    await wait(60);
  }
  await wait(700);
  await shot('07-zoom-out');
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -120);
    await wait(60);
  }

  // FPS (днём) — 3 секунды
  fps = await g(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n++;
          if (performance.now() - t0 < 3000) requestAnimationFrame(f);
          else res((n * 1000) / (performance.now() - t0));
        };
        requestAnimationFrame(f);
      }),
  );
  console.log(`  FPS днём: ${fps.toFixed(1)}`);

  // ночь
  await g(() => window.__game.time.setHour(23));
  await page.mouse.move(820, 430);
  await wait(1200);
  await shot('08-night');
  const fpsNight = await g(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n++;
          if (performance.now() - t0 < 2000) requestAnimationFrame(f);
          else res((n * 1000) / (performance.now() - t0));
        };
        requestAnimationFrame(f);
      }),
  );
  console.log(`  FPS ночью: ${fpsNight.toFixed(1)}`);
  fps = Math.min(fps, fpsNight);

  // сумерки + отладка + подсказка при наведении на поселенца
  await g(() => window.__game.time.setHour(19.5));
  await page.keyboard.press('F9');
  const col = await g(() => {
    const game = window.__game;
    const p = game.colonists().find((c) => !c.isLeader);
    const s = game.camera.worldToScreen(p.x, p.y);
    return s;
  });
  await page.mouse.move(col.x, col.y);
  await wait(800);
  await shot('09-dusk-debug-tooltip');
  await page.keyboard.press('F9');

  // пауза
  await page.keyboard.press('Space');
  const paused = await g(() => window.__game.paused);
  if (!paused) problems.push('Пробел не ставит паузу');
  await page.keyboard.press('Space');

  // сохранение/загрузка в браузере
  const saveOk = await g(() => {
    const game = window.__game;
    const n = game.entities.count;
    game.save.saveSlot('test');
    const ok = game.save.loadSlot('test');
    game.save.deleteSlot('test');
    return ok && game.entities.count === n;
  });
  if (!saveOk) problems.push('сохранение/загрузка в браузере не совпали');
  await wait(500);

  const gameErrors = await g(() => window.__game.errors.map((e) => `${e.where}: ${e.message}`));
  problems.push(...gameErrors.map((e) => `game.error ${e}`));
  const stats = await g(() => {
    const game = window.__game;
    return { ents: game.entities.count, jobs: game.stats.jobsDone, colonists: game.colonists().length, keyConflicts: game.input.conflicts.length };
  });
  console.log(`  сущностей ${stats.ents}, работ ${stats.jobs}, поселенцев ${stats.colonists}, конфликтов клавиш ${stats.keyConflicts}`);
} catch (err) {
  problems.push(`исключение теста: ${err.message}`);
  await shot('99-failure').catch(() => {});
} finally {
  await browser.close();
  server.close();
}

console.log('—'.repeat(60));
console.log(`FPS (мин. из день/ночь): ${fps.toFixed(1)} при 1600×900`);
if (problems.length) {
  console.error(`✗ FAIL (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
if (fps < 30) console.warn('⚠ FPS ниже 30 (headless-Chromium рисует программно; на реальном GPU быстрее)');
console.log('✓ PASS');
