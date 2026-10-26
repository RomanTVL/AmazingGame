// Браузерный сценарий модуля build: меню B (клик по пункту), призрак под мышью, протяжка стены мышью, дверь и
// кровать, поселенцы строят. Скриншоты — tests/screens/build-*.png. Запуск: node tests/build.browser.mjs [--seed 42]
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
  const file = path.join(SHOTS, `build-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${path.relative(process.cwd(), file)}`);
};
const toScreen = (x, y) => g(([wx, wy]) => window.__game.camera.worldToScreen(wx, wy), [x + 0.5, y + 0.5]);
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else problems.push(msg);
};
async function dragCells(x0, y0, x1, y1) {
  const a = await toScreen(x0, y0);
  const b = await toScreen(x1, y1);
  await page.mouse.move(a.x, a.y);
  await frames(2);
  await page.mouse.down();
  await frames(2);
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await frames(2);
  await page.mouse.up();
  await frames(2);
}

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?seed=${SEED}`);
  await page.waitForFunction(() => window.__game && window.__game.map && window.__game.renderer, null, { timeout: 15000 });
  await frames(20);
  // день, без рейдов; свободное место рядом с лидером
  const area = await g(() => {
    const game = window.__game;
    game.time.setHour?.(11);
    game.systems.setEnabled('combat', false);
    game.camera.zoom = 1.7;
    game.camera.targetZoom = 1.7;
    const map = game.map;
    const L = game.getLeader();
    const good = (x, y) => {
      if (!map.inBounds(x, y)) return false;
      const k = map.idx(x, y);
      return !map.building[k] && !map.plant[k] && !map.roof[k] && map.room[k] === 0 && map.cost[k] > 0 && !game.items.itemAt(x, y) &&
        map.terrainDef(x, y).buildable && !map.floor[k] && !(map.flags[k] & 1) && !game.zones.zoneAt(x, y);
    };
    const cx = Math.floor(L.x);
    const cy = Math.floor(L.y);
    for (let r = 2; r < 30; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          let all = true;
          for (let j = -1; j <= 5 && all; j++) for (let i = -1; i <= 6 && all; i++) if (!good(cx + dx + i, cy + dy + j)) all = false;
          if (all && game.pathfinder.canReach(L.x, L.y, cx + dx, cy + dy, true)) {
            // лидер встаёт рядом, камера следит за ним
            game.entities.setPosition(L, cx + dx + 3.5, cy + dy + 6.5);
            return { x: cx + dx, y: cy + dy };
          }
        }
    return null;
  });
  check(!!area, `место для стройки: ${JSON.stringify(area)}`);
  await frames(30);
  // B — меню; клик по первому пункту вкладки «Стены и двери»
  await page.keyboard.press('b');
  await frames(4);
  check(await g(() => window.__game.ui.isOpen('build')), 'B открыл меню стройки');
  await page.mouse.move(120, 192);
  await frames(3);
  await page.mouse.down();
  await frames(1);
  await page.mouse.up();
  await frames(3);
  const tool = await g(() => window.__game.api.build.getTool());
  check(tool.id === 'wood_wall', `клик по пункту выбрал деревянную стену (${tool.id})`);
  // призрак: зелёный на свободном месте
  const s = await toScreen(area.x + 2, area.y + 1);
  await page.mouse.move(s.x, s.y);
  await frames(4);
  await shot('01-menu-ghost');
  // протяжка стены линией
  await dragCells(area.x, area.y + 1, area.x + 4, area.y + 1);
  let n = await g(() => window.__game.entities.listKind('blueprint').length);
  check(n === 5, `протяжка поставила 5 чертежей стены (${n})`);
  // дверь и кровать
  await g(() => window.__game.api.build.setTool('place', { id: 'door_wood' }));
  await dragCells(area.x + 5, area.y + 1, area.x + 5, area.y + 1);
  await g(() => window.__game.api.build.setTool('place', { id: 'bed', rot: 0 }));
  await page.keyboard.press('g');
  await frames(2);
  const red = await toScreen(area.x, area.y + 1); // на чертеже стены — красный
  await page.mouse.move(red.x, red.y);
  await frames(4);
  await shot('02-ghost-red');
  await dragCells(area.x + 1, area.y + 3, area.x + 1, area.y + 3);
  n = await g(() => window.__game.entities.listKind('blueprint').length);
  check(n === 7, `дверь и кровать — чертежи (${n})`);
  await page.mouse.move(800, 860);
  await frames(4);
  await shot('03-blueprints');
  // время идёт — поселенцы приносят материалы и строят
  await g(() => {
    const game = window.__game;
    for (let i = 0; i < 12 * 600 && game.entities.countKind('blueprint') > 0; i++) game.step();
    game.time.setHour?.(13); // снимок днём
  });
  await frames(10);
  const built = await g(([x, y]) => {
    const game = window.__game;
    const at = (tx, ty) => game.map.buildingAt(tx, ty)?.defId || null;
    return { wall: at(x + 2, y + 1), door: at(x + 5, y + 1), bed: at(x + 1, y + 3), left: game.entities.listKind('blueprint').length };
  }, [area.x, area.y]);
  check(built.wall === 'wood_wall' && built.door === 'door_wood' && built.bed === 'bed' && built.left === 0, `построено: ${JSON.stringify(built)}`);
  await g(() => window.__game.api.build.setTool(null));
  await frames(6);
  await shot('04-built');
  // зона склада с фильтром
  await page.keyboard.press('z');
  await frames(2);
  await dragCells(area.x, area.y + 3 + 2, area.x + 3, area.y + 3 + 2);
  const sm = await toScreen(area.x + 4, area.y + 4);
  await page.mouse.move(sm.x, sm.y);
  await frames(4);
  await shot('05-zone');
  await page.keyboard.press('Escape');
  await frames(2);
  const errs = await g(() => window.__game.errors.map((e) => String(e.message || e)));
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
