// Браузерный сценарий MVP-4 (train + journey): HUD пути, карта маршрута F4, гудок H из кабины → посадка → поездка
// (земля с прокруткой), прибытие на новую станцию (лес / пустошь), победа над драконом. Скриншоты — tests/screens/journey-*.png. Запуск: node tests/journey.browser.mjs [--seed 42]
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
  const file = path.join(SHOTS, `journey-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${path.relative(process.cwd(), file)}`);
};
const toScreen = (x, y) => g(([wx, wy]) => window.__game.camera.worldToScreen(wx, wy), [x + 0.5, y + 0.5]);
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else problems.push(msg);
};
/** Прогнать тики симуляции прямо в странице (быстро), пока cond не станет истиной; рядовых врагов убираем. */
const fastUntil = (cond, max) => g(([c, m]) => {
  const game = window.__game;
  const f = new Function('game', `return (${c})`);
  let k = 0;
  while (!f(game) && k < m) {
    game.step();
    k++;
    if (k % 30 === 0) for (const p of game.entities.listKind('pawn')) if (p.faction === 'enemy' && !p.dead && !p.boss) game.api.health.kill(p, 'test', {});
  }
  return k;
}, [cond, max]);
const refuel = (step, type) => g(([s, ty]) => {
  const game = window.__game;
  const r = game.api.journey.getRoute();
  const i = ty ? r.steps[s - 1].findIndex((o) => o.type === ty) : 0;
  game.api.journey.choose(s, i < 0 ? 0 : i);
  const t = game.train.carOfType('tender');
  const c = game.train.interior(t)[2];
  if (game.api.train.fuelUnits() < 60) game.items.spawn('coal', 60, c.x, c.y);
  return game.api.train.depart({ force: true });
}, [step, type]);
const noon = (zoom) => g((z) => {
  const game = window.__game;
  game.time.setHour?.(12);
  game.camera.zoom = z;
  game.camera.targetZoom = z;
}, zoom);

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?seed=${SEED}`);
  await page.waitForFunction(() => window.__game && window.__game.map && window.__game.renderer, null, { timeout: 15000 });
  await frames(20);
  await noon(1.2);
  const info = await g(() => {
    const game = window.__game;
    return { scen: game.colony.scenarioId, cars: game.train.cars.map((c) => c.type), fuel: game.api.train.fuelUnits(), hud: game.ui.hud.has('journey:status') };
  });
  check(info.scen === 'three_survivors' && info.fuel === 90 && info.hud, `старт: ${JSON.stringify(info)}`);
  await frames(10);
  await shot('01-start');
  // F4 — карта маршрута
  await page.keyboard.press('F4');
  await frames(4);
  check(await g(() => window.__game.ui.isOpen('route')), 'F4 открыл карту маршрута');
  await shot('02-route');
  check(await g(() => window.__game.api.journey.getState().choice[0] === null), 'путь ещё не выбран');
  await g(() => window.__game.api.journey.choose(1, 0));
  await page.keyboard.press('F4');
  await frames(2);
  // лидер в кабину, H — посадка (настоящая клавиша)
  await g(() => {
    const game = window.__game;
    const r = game.train.locomotive.rect;
    game.entities.setPosition(game.getLeader(), r.x + 2.5, r.y + 3.5);
    game.setSpeed(3);
  });
  await frames(10);
  await page.keyboard.down('KeyH');
  await wait(120);
  await page.keyboard.up('KeyH');
  await wait(700);
  check(await g(() => !!window.__game.train.ops.boarding || window.__game.api.journey.getState().phase === 'travel'), 'H в кабине — посадка');
  await page.waitForFunction(() => window.__game.api.journey.getState().phase === 'travel', null, { timeout: 40000 });
  check(true, 'поезд отправился');
  await g(() => window.__game.setSpeed(1));
  await noon(0.9);
  await wait(1500);
  await shot('03-travel');
  const travel = await g(() => ({ biome: window.__game.map.biome, moving: window.__game.api.journey.isMoving(), fuel: window.__game.api.train.fuelUnits() }));
  check(travel.biome === 'travel' && travel.moving, `в пути: ${JSON.stringify(travel)}`);
  // доехать (быстро) — новая станция
  const k = await fastUntil("game.api.journey.getState().phase !== 'travel'", 20000);
  await noon(1);
  await frames(30);
  const st = await g(() => ({ st: window.__game.api.journey.getStation(), biome: window.__game.map.biome, col: window.__game.colonists().length }));
  check(st.st.index === 1 && st.biome === 'forest', `прибыли за ${k} тиков: ${st.st.name} (${st.st.type}), поселенцев ${st.col}`);
  await shot('04-station1');
  // до станции 3 (пустошь)
  for (let step = 2; step <= 3; step++) {
    await refuel(step, step === 3 ? 'ash' : null);
    await fastUntil("game.api.journey.getState().phase !== 'travel'", 20000);
  }
  await noon(1);
  await frames(30);
  const st3 = await g(() => ({ st: window.__game.api.journey.getStation(), biome: window.__game.map.biome }));
  check(st3.st.index === 3 && st3.biome === 'ash', `станция 3: ${st3.st.name} (${st3.biome})`);
  await shot('05-station3-ash');
  // станция 4 и дракон
  await refuel(4, null);
  await fastUntil("game.api.journey.getState().phase !== 'travel'", 20000);
  await fastUntil("game.entities.listKind('pawn').some((p) => p.boss?.id === 'bone_dragon')", 4500);
  await noon(1);
  await frames(20);
  await shot('06-dragon');
  await g(() => {
    const game = window.__game;
    const d = game.entities.listKind('pawn').find((p) => p.boss?.id === 'bone_dragon');
    if (d) game.api.health.kill(d, 'test', {});
  });
  await fastUntil('game.api.journey.getState().victory', 600);
  await frames(20);
  check(await g(() => window.__game.api.journey.getState().victory && window.__game.ui.isOpen('journey_victory')), 'победа: окно');
  await shot('07-victory');
  const errs = await g(() => window.__game.errors.map((e) => `${e.where}: ${e.message || e}`));
  if (errs.length) problems.push(...errs);
} catch (err) {
  problems.push(`exception: ${err.stack || err}`);
}
await browser.close();
server.close();
const failed = problems.length > 0;
for (const p of problems) console.error(`  ✗ ${p}`);
console.log(failed ? '✗ FAIL' : '✓ PASS');
process.exit(failed ? 1 : 0);
