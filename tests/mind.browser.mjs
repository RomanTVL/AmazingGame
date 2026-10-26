// Браузерный сценарий модуля mind: пузыри разговоров над пешками (значок темы; ссора — красный пузырь),
// значок срыва. Скриншоты — tests/screens/mind-*.png. Запуск: node tests/mind.browser.mjs [--seed 42]
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
const shot = async (name) => {
  const file = path.join(SHOTS, `mind-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${path.relative(process.cwd(), file)}`);
};

let failed = false;
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?seed=${SEED}`);
  await page.waitForFunction(() => window.__game && window.__game.map && window.__game.renderer, null, { timeout: 15000 });
  await wait(500);
  const info = await g(() => {
    const game = window.__game;
    game.time.setHour?.(11);
    game.systems.setEnabled('combat', false);
    const L = game.getLeader();
    const cs = game.colonists().filter((p) => !p.isLeader);
    const M = game.api.mind;
    cs.forEach((p, i) => {
      if (p.job) game.jobs.endJob(p, 'cancelled');
      game.entities.setPosition(p, L.x + 1.5 + (i % 2) * 1.1, L.y + 1.2 + (i >> 1) * 2.2);
    });
    const r1 = M.converse(cs[0], cs[1], { stand: true });
    // ссора: перебираем беседы, пока не выйдет красный пузырь
    let r2 = null;
    for (let i = 0; i < 300 && !(r2 && r2.red); i++) r2 = M.converse(cs[2], cs[3]);
    game.camera.zoom = 2.2;
    game.camera.x = L.x + 2;
    game.camera.y = L.y + 2;
    return { r1, r2, talks: game.colonists().length };
  });
  console.log(`  беседа: ${info.r1?.kind}/${info.r1?.glyph}, ссора: ${info.r2?.red}`);
  await wait(700);
  await shot('01-talk-bubbles');
  // срыв
  await g(() => {
    const game = window.__game;
    const cs = game.colonists().filter((p) => !p.isLeader);
    game.api.mind.startBreak(cs[0], 'minor', 'cry');
  });
  await wait(900);
  await shot('02-break');
  const moods = await g(() => window.__game.colonists().map((p) => Math.round(window.__game.api.mind.getMood(p) * 100)));
  console.log(`  настроение: ${moods.join(', ')}`);
  const errs = await g(() => window.__game.errors.map((e) => String(e.message || e)));
  if (errs.length) problems.push(...errs);
} catch (err) {
  problems.push(`exception: ${err.stack || err}`);
}
await browser.close();
server.close();
if (problems.length) {
  failed = true;
  for (const p of problems) console.error(`  ✗ ${p}`);
}
console.log(failed ? '✗ FAIL' : '✓ PASS');
process.exit(failed ? 1 : 0);
