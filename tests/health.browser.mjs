// Браузерный сценарий модуля health: раненые и лежачие, панель «Здоровье» (F2), последнее дыхание и слова,
// сцена смерти, переноска, похороны и речь, «Павшие» (F8). Скриншоты — tests/screens/health-*.png.
// Запуск: node tests/health.browser.mjs [--seed 42]
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
const argSeed = process.argv.indexOf('--seed');
const SEED = argSeed > 0 ? process.argv[argSeed + 1] : '42';

const server = await startServer(0);
const port = server.address().port;
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
const wait = (ms) => page.waitForTimeout(ms);
const g = (fn, arg) => page.evaluate(fn, arg);
const frames = (n = 2) => g((k) => new Promise((res) => {
  let i = 0;
  const f = () => (++i >= k ? res() : requestAnimationFrame(f));
  requestAnimationFrame(f);
}), n);
const shot = async (name) => {
  const file = path.join(SHOTS, `health-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${path.relative(process.cwd(), file)}`);
};
const toScreen = (wx, wy) => g(([x, y]) => window.__game.camera.worldToScreen(x, y), [wx, wy]);

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?seed=${SEED}&scenario=standard`); // полный состав, как в health.test (MVP-4: старт по умолчанию — «Трое выживших»)
  await page.waitForFunction(() => window.__game && window.__game.map && window.__game.renderer, null, { timeout: 15000 });
  await frames(20);
  // раненые: порезы, перелом, отсечённая рука; лежачий
  await g(() => {
    const game = window.__game;
    game.time.setHour?.(11);
    game.systems.setEnabled('combat', false);
    const L = game.getLeader();
    const cs = game.colonists().filter((p) => !p.isLeader);
    const H = game.api.health;
    cs.forEach((p, i) => game.entities.setPosition(p, L.x + 2 + i * 1.2, L.y + 1.5));
    H.applyDamage(cs[0], 14, { part: 'arm_r', type: 'cut' });
    H.applyDamage(cs[0], 9, { part: 'head', type: 'blunt' });
    H.applyDamage(cs[1], 33, { part: 'leg_l', type: 'blunt' });
    H.applyDamage(cs[1], 33, { part: 'leg_r', type: 'cut' });
    H.applyDamage(cs[2], 300, { part: 'arm_l', type: 'cut' });
    H.addCondition(cs[2], 'infection', { part: 'hand_r', severity: 0.3 });
    game.api.health.setHeir(cs[3]);
    window.__hp = cs.map((p) => p.id);
    game.ui.openPanel('health');
    window.__healthSel = cs[1].id;
    game.api.health.debugState().rt.selectedId = cs[1].id;
  });
  await wait(900);
  await shot('01-panel-downed');
  await g(() => {
    const game = window.__game;
    game.api.health.debugState().rt.selectedId = window.__hp[2];
  });
  await wait(400);
  await shot('02-panel-limb');
  // последнее дыхание
  await g(() => {
    const game = window.__game;
    game.ui.closePanel('health');
    const p = game.entities.get(window.__hp[0]);
    p.health.bloodLoss = 1.05;
    game.api.health.applyDamage(p, 1, { part: 'foot_l', type: 'blunt' });
  });
  await wait(1200);
  await shot('03-last-breath');
  const hint = await g(() => {
    const game = window.__game;
    const L = game.getLeader();
    const p = game.entities.get(window.__hp[0]);
    game.entities.setPosition(L, p.x - 1, p.y);
    game.input.setMouseWorld(p.x, p.y);
    return null;
  });
  void hint;
  await frames(4);
  await page.keyboard.press('e');
  await wait(1500);
  await shot('04-last-words');
  await g(() => window.__game.setSpeed(3));
  await page.waitForFunction(() => window.__game.api.health.debugState().rt.scene?.t > 1.6, null, { timeout: 30000 });
  await shot('05-death-scene');
  await g(() => window.__game.setSpeed(1));
  await wait(6000);
  // переноска упавшего
  await g(() => {
    const game = window.__game;
    const L = game.getLeader();
    const p = game.entities.get(window.__hp[1]);
    game.entities.setPosition(L, p.x + 1, p.y);
    game.api.health.startCarry(L, p);
  });
  await page.keyboard.down('d');
  await wait(800);
  await page.keyboard.up('d');
  await shot('06-carry');
  await g(() => window.__game.api.health.dropCarry(window.__game.getLeader()));
  // похороны: ускорить до могилы
  await g(() => window.__game.setSpeed(3));
  await page.waitForFunction(() => window.__game.entities.listKind('building').some((b) => b.defId === 'grave' && b.occupied), null, { timeout: 90000 });
  await g(() => {
    const game = window.__game;
    game.setSpeed(1);
    const gr = game.entities.listKind('building').find((b) => b.defId === 'grave' && b.occupied);
    const L = game.getLeader();
    game.entities.setPosition(L, gr.x + 1.5, gr.y + 0.5);
    game.camera.snapTo?.(gr.x, gr.y);
  });
  await wait(1500);
  await shot('07-funeral-eulogy');
  await g(() => window.__game.api.health.chooseEulogy(0));
  await wait(600);
  await shot('08-grave');
  await g(() => {
    const game = window.__game;
    game.api.health.createFallen({ name: 'Гаврила Грибов', age: 41, cause: 'fever' }, { corpse: true, x: Math.floor(game.getLeader().x) + 2, y: Math.floor(game.getLeader().y) + 1, rot: 0.5 });
    game.api.health.createFallen({ name: 'Старый Фрол', age: 70 }, { corpse: true, x: Math.floor(game.getLeader().x) + 3, y: Math.floor(game.getLeader().y) + 2, rot: 1 });
    game.ui.openPanel('fallen');
  });
  await wait(600);
  await shot('09-fallen');
  await g(() => {
    const game = window.__game;
    game.ui.closePanel('fallen');
    game.time.setHour?.(23);
  });
  await wait(800);
  await shot('10-night-graves');
  const errs = await g(() => window.__game.errors.map((e) => `${e.where}: ${e.message}`));
  for (const e of errs) problems.push(`game.error ${e}`);
} catch (err) {
  problems.push(`исключение теста: ${err.stack || err}`);
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  for (const p of problems.slice(0, 20)) console.error(`✗ ${p}`);
  console.error('✗ FAIL');
  process.exit(1);
}
console.log('✓ PASS');
