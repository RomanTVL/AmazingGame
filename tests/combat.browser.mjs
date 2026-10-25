// Браузерный сценарий модуля combat: рейд у поезда, атака лидера (ЛКМ), заклинания 1–4, «К оружию!» (R),
// рывок (Shift), карточки уровня, пленные, боссы. Скриншоты — tests/screens/combat-*.png. Падает при ошибках консоли.
// Запуск: node tests/combat.browser.mjs [--seed 42]
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
  const file = path.join(SHOTS, `combat-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${path.relative(process.cwd(), file)}`);
};
const toScreen = (wx, wy) => g(([x, y]) => window.__game.camera.worldToScreen(x, y), [wx, wy]);

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?seed=${SEED}`);
  await page.waitForFunction(() => window.__game && window.__game.map && window.__game.renderer, null, { timeout: 15000 });
  await frames(20);
  // рейд разбойников у лидера (днём)
  const info = await g(() => {
    const game = window.__game;
    game.time.setHour?.(11);
    const L = game.getLeader();
    const r = game.api.combat.spawnRaid({ faction: 'bandits', points: 90, x: L.x + 9, y: L.y + 1 });
    return { r, L: { x: L.x, y: L.y } };
  });
  console.log('  рейд:', JSON.stringify(info.r));
  await wait(1500);
  await shot('01-raid');
  // R — к оружию
  await page.keyboard.press('r');
  await frames(4);
  const drafted = await g(() => window.__game.colonists().filter((p) => p.drafted).length);
  console.log(`  призвано: ${drafted}`);
  // ЛКМ по врагу, заклинания
  const foe = await g(() => {
    const game = window.__game;
    const L = game.getLeader();
    const e = game.entities.listKind('pawn').filter((p) => p.faction === 'enemy' && !p.downed).sort((a, b) => Math.hypot(a.x - L.x, a.y - L.y) - Math.hypot(b.x - L.x, b.y - L.y))[0];
    return e ? { x: e.x, y: e.y } : null;
  });
  if (foe) {
    const s = await toScreen(foe.x, foe.y);
    await page.mouse.move(s.x, s.y);
    await frames(3);
    await page.mouse.down();
    await frames(2);
    await page.mouse.up();
    await wait(200);
    await page.keyboard.press('1');
    await wait(450);
    await shot('02-fireball');
    await page.keyboard.press('2');
    await wait(120);
    await shot('03-chain');
    await page.keyboard.press('3');
    await wait(150);
    await shot('04-ice');
    await page.keyboard.press('4');
    await wait(200);
  }
  await page.keyboard.press('ShiftLeft');
  await wait(1500);
  await shot('05-melee');
  const mana = await g(() => window.__game.api.combat.getMana(window.__game.getLeader()));
  console.log(`  мана после заклинаний: ${JSON.stringify(mana)}`);
  if (!(mana && mana.cur < mana.max)) problems.push('заклинания не тратят ману');
  // ночной бой
  await g(() => window.__game.time.setHour?.(23));
  await wait(1200);
  await shot('06-night');
  // уровень: выдать опыт и открыть карточки
  await g(() => {
    const game = window.__game;
    game.time.setHour?.(12);
    game.api.combat.grantXp(game.getLeader(), 200);
    game.ui.openPanel('combat_levelup');
  });
  await wait(400);
  await shot('07-levelup');
  await g(() => window.__game.ui.closePanel('combat_levelup'));
  // пленный
  await g(() => {
    const game = window.__game;
    const L = game.getLeader();
    for (const p of game.entities.listKind('pawn')) if (p.faction === 'enemy' && !p.dead) {
      p.downed = true;
      p.health.hp = 5;
      if (p.job) game.jobs.endJob(p, 'cancelled');
    }
    const bed = game.api.build.place('prisoner_bed', Math.floor(L.x) - 3, Math.floor(L.y) + 2, { force: true });
    const d = game.entities.listKind('pawn').find((p) => p.faction === 'enemy' && p.downed);
    if (d) game.api.combat.capture(d, L);
    game.debug_bed = !!bed;
    game.ui.openPanel('combat_prisoners');
  });
  await wait(1500);
  await shot('08-prisoners');
  await g(() => window.__game.ui.closePanel('combat_prisoners'));
  // боссы
  for (const id of ['bone_dragon', 'lich', 'rot_heart']) {
    await g((bid) => {
      const game = window.__game;
      const L = game.getLeader();
      for (const p of game.entities.listKind('pawn')) if (p.faction === 'enemy') game.entities.remove(p, 'test');
      game.api.combat.debugState().S.raids.length = 0;
      game.api.combat.spawnBoss(bid, { x: L.x + 7, y: L.y - 2 });
    }, id);
    await wait(1500);
    if (id === 'bone_dragon') {
      await g(() => {
        const game = window.__game;
        const L = game.getLeader();
        const d = game.entities.listKind('pawn').find((p) => p.boss?.id === 'bone_dragon');
        d.boss.breath = { x0: d.x, y0: d.y, ang: Math.atan2(L.y - d.y, L.x - d.x), len: 15, fireAt: game.time.tick + 120 };
      });
      await wait(800);
      await shot('09-boss-dragon-telegraph');
      await wait(1400);
    }
    if (id === 'lich') {
      await g(() => {
        const game = window.__game;
        const L = game.getLeader();
        const v = game.colonists().find((p) => !p.isLeader && !p.downed);
        if (v) {
          v.mood.value = 0.1;
          v.drafted = false;
          v.x = L.x + 4;
          v.y = L.y + 3;
          game.entities.moved(v);
        }
        const lich = game.entities.listKind('pawn').find((p) => p.boss?.id === 'lich');
        lich.boss.threadAt = game.time.tick;
      });
      await wait(1200);
    }
    await shot(`09-boss-${id}`);
  }
  // все фракции + оборона, ускоренно
  await g(() => {
    const game = window.__game;
    const L = game.getLeader();
    for (const p of game.entities.listKind('pawn')) if (p.faction === 'enemy') game.entities.remove(p, 'test');
    game.api.combat.debugState().S.raids.length = 0;
    const near = (defId, dx, dy) => {
      const s2 = game.map.randomPassableNear(game.rng, L.x + dx, L.y + dy, 4, 40, (x, y) => game.api.build.canPlace(defId, x, y));
      return s2 ? game.api.build.place(defId, s2.x, s2.y) : null;
    };
    const t = near('rune_turret', 3, 3);
    if (t) t.ammo = 40;
    near('spike_trap', 6, 2);
    near('fire_trap', 6, 4);
    game.api.combat.spawnRaid({ faction: 'cultists', points: 80, x: L.x + 12, y: L.y + 4 });
    game.api.combat.spawnRaid({ faction: 'undead', points: 70, x: L.x - 12, y: L.y + 5 });
    game.api.combat.spawnRaid({ faction: 'rot_beasts', points: 60, x: L.x + 4, y: L.y + 12 });
    game.events.emit('journey:horn', { pattern: 'double' });
    game.setSpeed(3);
  });
  await wait(5000);
  await shot('10-mixed');
  await g(() => window.__game.setSpeed(1));
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
