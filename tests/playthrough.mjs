// Сквозное прохождение MVP (Playwright), как настоящий игрок, без параметров адреса:
//   главное меню → «Новая игра» (имя колонии/лидера, сид, сложность) → станция 0 (WASD, рубка E, чертёж кровати B,
//   «К оружию!» R, карта F4 — выбор пути) → гудок H из кабины → посадка → в путь → … станции 1–4 → Костяной дракон →
//   экран победы; затем путь к концу игры (загрузка автосейва станции 4, лидер не сражается) → экран конца игры.
//   На каждой станции: автосейв по прибытии, сохранение в ячейку через паузу → выход в меню → загрузка → проверка.
//   Время на станциях и в пути проматывается тиками симуляции прямо в странице (как ускорение времени), лидера в бою
//   ведёт помощник (клавиши WASD + заклинания через game.api.combat), в кабину — перенос (setPosition).
//   Экраны и окна — настоящими кликами/клавишами. Ошибок консоли быть не должно; печатает FPS.
// Скриншоты — tests/screens/play-*.png. Запуск: node tests/playthrough.mjs [--seed 7] [--difficulty normal]
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
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const SEED = String(arg('seed', '7'));
const DIFF = arg('difficulty', 'normal');
const W = 1600;
const H = 900;

const server = await startServer(0);
const port = server.address().port;
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
const g = (fn, a) => page.evaluate(fn, a);
const wait = (ms) => page.waitForTimeout(ms);
const frames = (n = 2) => g((k) => new Promise((res) => {
  let i = 0;
  const f = () => (++i >= k ? res() : requestAnimationFrame(f));
  requestAnimationFrame(f);
}), n);
const shot = async (name) => {
  const file = path.join(SHOTS, `play-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${path.relative(process.cwd(), file)}`);
};
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else problems.push(msg);
  return !!cond;
};
const log = (s) => console.log(`  · ${s}`);
const screen = () => g(() => window.__game.api.ui.screen());
const fpsFor = (ms) => g((dur) => new Promise((res) => {
  let n = 0;
  const t0 = performance.now();
  const f = () => {
    n++;
    if (performance.now() - t0 < dur) requestAnimationFrame(f);
    else res((n * 1000) / (performance.now() - t0));
  };
  requestAnimationFrame(f);
}), ms);
const fpsLog = [];
async function measureFps(label, ms = 2500) {
  const f = await fpsFor(ms);
  fpsLog.push({ label, fps: f });
  log(`FPS (${label}): ${f.toFixed(1)}`);
  return f;
}

/** Клик по виджету ui по его id (прямоугольник прошлого кадра). */
async function clickWidget(id) {
  await frames(2);
  const r = await g((i) => window.__game.api.ui.widgetRect(i), id);
  if (!r) throw new Error(`нет виджета ${id} (экран ${await screen()})`);
  await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
  await frames(1);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await frames(3);
}
async function typeInto(id, text) {
  await clickWidget(id);
  await page.keyboard.type(text, { delay: 10 });
  await frames(2);
}
async function tap(code, ms = 90) {
  await page.keyboard.down(code);
  await wait(ms);
  await page.keyboard.up(code);
  await frames(3);
}

// ---------- помощники в странице: проматывание времени и бой лидера ----------
const HELPERS = `
window.__pt = (() => {
  const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
  const enemiesNear = (g, p, r) => g.entities.queryRadius(p.x, p.y, r, 'pawn').filter((e) => e.faction === 'enemy' && !e.dead && !e.downed && !e.prisoner);
  function moveKeys(g, dx, dy) {
    const inp = g.input;
    inp.setKey(KEYS.right, dx > 0.3);
    inp.setKey(KEYS.left, dx < -0.3);
    inp.setKey(KEYS.down, dy > 0.3);
    inp.setKey(KEYS.up, dy < -0.3);
  }
  // лидер: идёт к бою, держит дистанцию, бьёт заклинаниями, вплотную — посохом (как tests/journey.play.mjs)
  function fight(g) {
    const L = g.getLeader();
    if (!L || L.downed) return moveKeys(g, 0, 0);
    const foes = enemiesNear(g, L, 28);
    if (!foes.length) return moveKeys(g, 0, 0);
    foes.sort((a, b) => (a.x - L.x) ** 2 + (a.y - L.y) ** 2 - ((b.x - L.x) ** 2 + (b.y - L.y) ** 2));
    const t = foes.find((f) => !f.boss && Math.hypot(f.x - L.x, f.y - L.y) < 7) || foes.find((f) => f.boss) || foes[0];
    const d = Math.hypot(t.x - L.x, t.y - L.y);
    const want = t.boss ? 7 : 5;
    const ux = (t.x - L.x) / (d || 1);
    const uy = (t.y - L.y) / (d || 1);
    if (d > want + 3) moveKeys(g, ux, uy);
    else if (d < want - 2) moveKeys(g, -ux, -uy);
    else moveKeys(g, 0, 0);
    if (d > 11) return;
    if (L.job) g.jobs.endJob(L, 'cancelled');
    const C = g.api.combat;
    const mana = C.getMana(L)?.cur ?? 0;
    const close = foes.filter((f) => Math.hypot(f.x - L.x, f.y - L.y) < 11);
    const hurt = (g.api.health.getSummary?.(L)?.ratio ?? 1) < 0.6;
    if (hurt && !L.shield && mana >= 35 && C.castSpell(L, 'rune_shield', L.x, L.y)) return;
    if (close.length >= 2 && mana >= 30 && C.castSpell(L, 'chain_lightning', t.x, t.y)) return;
    if (mana >= 25 && d > 2.5 && C.castSpell(L, 'fireball', t.x, t.y)) return;
    if (mana >= 28 && d < 3.5 && C.castSpell(L, 'ice_ring', L.x, L.y)) return;
    if (d < 1.6) C.attack(L, t);
  }
  // лидер не сражается: идёт к дракону и стоит рядом
  function approach(g) {
    const L = g.getLeader();
    const d = L && g.entities.listKind('pawn').find((p) => p.boss && !p.dead);
    if (!d || L.downed) return moveKeys(g, 0, 0);
    if (L.job) g.jobs.endJob(L, 'cancelled');
    const k = Math.hypot(d.x - L.x, d.y - L.y);
    if (k > 2.5) moveKeys(g, (d.x - L.x) / k, (d.y - L.y) / k);
    else moveKeys(g, 0, 0);
  }
  const stats = { removedBeds: [], raids: 0, ambushes: 0, deaths: [], left: [], arrived: [], victory: null, lost: false, casts: 0 };
  let wired = false;
  function wire(g) {
    if (wired) return;
    wired = true;
    g.events.on('combat:raidStarted', (e) => (e.kind === 'ambush' ? stats.ambushes++ : stats.raids++), 'test');
    g.events.on('pawn:died', (e) => e.pawn.faction === 'colony' && stats.deaths.push(e.pawn.name + ':' + e.cause), 'test');
    g.events.on('journey:leftBehind', (e) => stats.left.push(e.pawn.name), 'test');
    g.events.on('journey:arrived', (e) => stats.arrived.push(e.station.index), 'test');
    g.events.on('game:victory', (e) => (stats.victory = e), 'test');
    g.events.on('colony:lost', () => (stats.lost = true), 'test');
    g.events.on('combat:spellCast', () => stats.casts++, 'test');
    g.events.on('entity:removed', ({ entity, reason }) => {
      if ((entity.defId === 'bed' || /bed/.test(entity.buildDefId || '')) && entity.kind !== 'item') stats.removedBeds.push(entity.kind + ':' + reason + '@' + g.time.tick);
    }, 'test');
  }
  /** n тиков симуляции (кадровые системы — раз в 4 тика); stop(g) — ранний выход. */
  function run(n, o = {}) {
    const g = window.__game;
    wire(g);
    const stop = o.stop ? new Function('game', 'return (' + o.stop + ')') : null;
    let i = 0;
    for (; i < n; i++) {
      if (i % 4 === 0) {
        g.frame(4 / 60);
        g.input.endFrame();
      }
      if (o.fight && i % 12 === 0) fight(g);
      if (o.passive && i % 12 === 0) approach(g);
      g.step();
      if (g.errors.length || g.colony.lost || g.api.journey.getState().victory) break;
      if (stop && i % 10 === 0 && stop(g)) break;
    }
    moveKeys(g, 0, 0);
    return i;
  }
  function designateFuel() {
    const g = window.__game;
    let n = 0;
    for (const b of g.entities.listKind('building')) {
      const def = g.defs.buildings.get(b.defId);
      if (!(b.defId === 'coal_seam' || def?.cache)) continue;
      if (g.designations.has('mine', b.x, b.y)) continue;
      if (g.designations.add('mine', b.x, b.y)) n++;
    }
    return n;
  }
  function toCab() {
    const g = window.__game;
    const L = g.getLeader();
    if (!L || L.downed) return false;
    const r = g.train.locomotive.rect;
    if (L.job) g.jobs.endJob(L, 'cancelled');
    g.entities.setPosition(L, r.x + 2.5, r.y + 3.5);
    return true;
  }
  /** Упавших заносим в вагон (как перенос на руках, удержание E). */
  function carryDowned() {
    const g = window.__game;
    for (const p of g.api.train.missing()) {
      if (!p.downed) continue;
      const car = g.train.carOfType('residential') || g.train.cars[0];
      const c = g.train.interior(car).find((q) => g.map.isPassable(q.x, q.y) && !g.map.buildingAt(q.x, q.y));
      if (c) g.entities.setPosition(p, c.x + 0.5, c.y + 0.5);
    }
  }
  function info() {
    const g = window.__game;
    const J = g.api.journey;
    const st = J.getState();
    const s = J.getStation();
    return {
      phase: st.phase, step: st.step, choice: st.choice, victory: st.victory, rotLeft: st.rotHoursLeft,
      station: s && { index: s.index, name: s.name, type: s.type }, biome: g.map?.biome, day: g.time.day, hour: g.time.hourInt, tick: g.time.tick,
      colonists: g.colonists().map((p) => p.name), leader: g.getLeader()?.name || null, fuel: g.api.train.fuelUnits(), need: J.fuelNeed(),
      canDepart: J.canDepart(), raid: g.api.combat.isRaidActive(), lost: !!g.colony.lost, screen: g.api.ui.screen(), errors: g.errors.length,
    };
  }
  return { run, fight, moveKeys, designateFuel, toCab, carryDowned, info, stats };
})();
`;
const info = () => g(() => window.__pt.info());
const run = (n, o = {}) => g(([k, opts]) => window.__pt.run(k, opts), [n, o]);
/** Проматывать порциями (между ними — настоящие кадры), пока stop не истинно. */
async function runUntil(stop, max, o = {}) {
  let done = 0;
  while (done < max) {
    const k = await run(Math.min(1200, max - done), { ...o, trace: undefined, stop });
    done += k;
    await frames(2);
    if (o.trace) log(await g(o.trace));
    const ok = await g((s) => new Function('game', `return (${s})`)(window.__game), stop);
    if (ok) return { ok: true, ticks: done };
    if (await g(() => window.__game.errors.length || window.__game.colony.lost || window.__game.api.journey.getState().victory)) return { ok: false, ticks: done };
  }
  return { ok: false, ticks: done };
}
const toScreen = (x, y) => g(([wx, wy]) => window.__game.camera.worldToScreen(wx, wy), [x, y]);

// ---------- шаги ----------
/** F4 → клик по карточке варианта следующего шага (раскладка панели 'route' из js/modules/journey/ui.js). */
async function chooseRoute(step, pick) {
  await tap('F4');
  await frames(4);
  check(await g(() => window.__game.ui.isOpen('route')), `F4: карта маршрута (шаг ${step})`);
  const opts = await g((s) => window.__game.api.journey.getRoute().steps[s - 1].map((o) => o.type), step);
  const idx = pick(opts);
  const pw = Math.min(820, W - 40);
  const ph = Math.min(400, H - 120);
  const ix = (W - pw) / 2 + 12;
  const iy = (H - ph) / 2 + 36;
  const cw = (pw - 24 - 16) / 5;
  const x = ix + step * cw + 8 + (cw - 18) / 2;
  const y = iy + 18 + idx * (122 + 22) + 61;
  await page.mouse.move(x, y);
  await frames(2);
  await page.mouse.click(x, y);
  await frames(4);
  const ch = await g((s) => window.__game.api.journey.getState().choice[s - 1], step);
  check(ch === idx, `маршрут: клик по карточке «${opts[idx]}» (шаг ${step}, варианты ${opts.join('/')})`);
  if (step === 1) await shot('03-route');
  await tap('F4');
  check(!(await g(() => window.__game.ui.isOpen('route'))), 'F4 закрыл карту');
}

/** Гудок из кабины (настоящая клавиша H) → посадка → отправление. */
async function departNow(label) {
  // лидер упал или идёт бой — ждём (как игрок), до 8 ч
  const ready = "!game.getLeader()?.downed && !game.api.combat.isRaidActive()";
  if (!(await g((c) => new Function('game', `return (${c})`)(window.__game), ready))) {
    const w = await runUntil(ready, 8 * 600, { fight: true });
    log(`${label}: ждали лидера/конца боя ${(w.ticks / 600).toFixed(1)} ч`);
  }
  await g(() => window.__pt.carryDowned());
  await g(() => window.__pt.toCab());
  await frames(6);
  await tap('KeyH', 110);
  await wait(600);
  await frames(4);
  const b = await g(() => !!window.__game.train.ops?.boarding || window.__game.api.journey.getState().phase === 'travel');
  if (!check(b, `${label}: H в кабине — посадка`)) {
    log(JSON.stringify({ ...(await info()), leaderDowned: await g(() => !!window.__game.getLeader()?.downed), inCab: await g(() => window.__game.api.train.isInCab?.(window.__game.getLeader())) }));
    return false;
  }
  // посадка 30 с игрового времени; не севшие — окно подтверждения «Ехать»
  let k = 0;
  while (k < 4000) {
    k += await run(300, { fight: true, stop: "game.api.journey.getState().phase === 'travel' || !!game.train.ops?.confirm" });
    const st = await g(() => ({ phase: window.__game.api.journey.getState().phase, confirm: !!window.__game.train.ops?.confirm, boarding: !!window.__game.train.ops?.boarding }));
    if (st.phase === 'travel') break;
    if (st.confirm) {
      const miss = await g(() => window.__game.api.train.missing().map((p) => `${p.name}${p.downed ? ' (упал)' : ''}`));
      log(`не сели: ${miss.join(', ')} — «Ехать»`);
      await frames(4);
      await g(() => window.__game.api.train.confirmDepart(true));
    } else if (!st.boarding) {
      await g(() => window.__pt.toCab());
      await tap('KeyH', 110);
      await wait(600);
    }
  }
  const ok = (await g(() => window.__game.api.journey.getState().phase)) === 'travel';
  check(ok, `${label}: поезд отправился (${k} тиков посадки)`);
  return ok;
}

/** Сохранить через паузу в ячейку, выйти в меню, загрузить, сравнить. */
async function saveLoadCycle(tag) {
  await page.keyboard.press('Escape');
  await frames(4);
  if (!check((await screen()) === 'pause', `${tag}: Esc — пауза`)) return;
  const before = await info(); // на паузе — время стоит
  await clickWidget('pause:save');
  await clickWidget('slot:save:slot1');
  check(await g(() => window.__game.save.hasSlot('slot1')), `${tag}: сохранено в ячейку 1`);
  await clickWidget('pause:exit');
  check((await screen()) === 'main', `${tag}: выход в меню`);
  await clickWidget('main:load');
  await clickWidget('slot:load:slot1');
  await frames(10);
  const after = await info();
  // в пути уголь горит: после загрузки до проверки проходит несколько кадров
  const same = !after.screen && after.phase === before.phase && after.step === before.step && after.station?.index === before.station?.index
    && after.colonists.length === before.colonists.length && Math.abs(after.fuel - before.fuel) <= (before.phase === 'travel' ? 1 : 0) && after.biome === before.biome && after.tick >= before.tick && after.tick < before.tick + 600;
  check(same, `${tag}: загрузка ячейки 1 — та же станция ${after.station?.index} (${after.biome}), поселенцев ${after.colonists.length}, угля ${after.fuel}`);
  if (!same) log(`до ${JSON.stringify(before)}\n    после ${JSON.stringify(after)}`);
  await frames(20);
  check((await g(() => window.__game.time.tick)) > after.tick, `${tag}: после загрузки время идёт`);
}

/** Стоянка: добыча угля, выживание; выйти, когда угля хватает и пробыли ≥ minHours (или скоро Гниль). */
async function stay(tag, minHours) {
  const HT = 600;
  await g(() => window.__pt.designateFuel());
  const t0 = (await info()).tick;
  for (let guard = 0; guard < 80; guard++) {
    await run(HT / 2, { fight: true });
    await frames(2);
    const s = await info();
    if (s.lost || s.errors || s.victory) return s;
    if (guard % 6 === 0) await g(() => window.__pt.designateFuel());
    const stayed = (s.tick - t0) / HT;
    const rotSoon = s.rotLeft < 2;
    const fuelOk = s.canDepart && s.fuel >= (s.need ?? 0) + 6;
    if (((stayed >= minHours && fuelOk) || (rotSoon && s.canDepart)) && (!s.raid || rotSoon)) {
      log(`${tag}: пробыли ${stayed.toFixed(0)} ч, угля ${s.fuel} (нужно ${s.need}), поселенцев ${s.colonists.length}`);
      return s;
    }
  }
  return info();
}

let reached = 0;
let bedsBuilt = 0;
const stuck = [];
let victory = false;
let defeatOk = false;
try {
  // 1. главное меню (без параметров адреса)
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__game && window.__game.map && window.__game.renderer, null, { timeout: 15000 });
  await frames(30);
  check((await screen()) === 'main', 'запуск: главное меню');
  await page.addScriptTag({ content: HELPERS });
  await page.mouse.move(W / 2, H / 2);
  await frames(10);
  await shot('01-menu');
  await measureFps('меню');

  // 2. новая игра
  await clickWidget('main:new');
  check((await screen()) === 'new', 'меню → «Новая игра»');
  await typeInto('ng:colony', 'Kovcheg');
  await typeInto('ng:leader', 'Ada');
  await typeInto('ng:seed', SEED);
  await clickWidget(`ng:diff:${DIFF}`);
  await shot('02-new-game');
  await clickWidget('ng:start');
  await frames(10);
  const s0 = await info();
  check(!s0.screen && s0.leader === 'Ada' && s0.station?.index === 0 && s0.colonists.length >= 3, `новая игра: станция 0, ${s0.colonists.length} поселенцев, угля ${s0.fuel}`);
  await g(() => window.__game.time.setHour?.(9));

  // 3. станция 0: WASD, рубка E, кровать B, «К оружию!» R
  await page.keyboard.down('KeyD');
  await wait(600);
  await page.keyboard.up('KeyD');
  await frames(4);
  check((await g(() => window.__game.api.ui.tutorial().done.move)), 'WASD: лидер идёт, шаг обучения засчитан');
  const tree = await g(() => {
    const game = window.__game;
    const L = game.getLeader();
    let best = null;
    for (const pl of game.entities.listKind('plant')) {
      const def = game.defs.plants.get(pl.defId);
      if (!def?.choppable) continue;
      const d = Math.hypot(pl.x + 0.5 - L.x, pl.y + 0.5 - L.y);
      if (!best || d < best.d) best = { x: pl.x, y: pl.y, d };
    }
    if (!best) return null;
    // встать рядом с деревом (ходьба сюда — те же WASD)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
      if (game.map.isPassable(best.x + dx, best.y + dy)) {
        game.entities.setPosition(L, best.x + dx + 0.5, best.y + dy + 0.5);
        break;
      }
    }
    return best;
  });
  check(!!tree, 'на станции есть дерево');
  if (tree) {
    const sp = await toScreen(tree.x + 0.5, tree.y + 0.5);
    await page.mouse.move(sp.x, sp.y);
    await frames(4);
    await tap('KeyE');
    await run(240);
    await frames(4);
    check(await g(() => window.__game.api.ui.tutorial().done.chop), 'E по дереву: рубка (шаг обучения засчитан)');
  }
  await page.mouse.move(W / 2, H / 2 - 120);
  await tap('KeyB');
  await frames(4);
  check(await g(() => window.__game.ui.isOpen('build') && window.__game.api.build.getTool().id === 'bed' && window.__game.api.build.getTool().tab === 'furniture'), 'B: меню стройки на вкладке «Мебель», выбрана кровать');
  // подсказка: «поставьте её в вагоне» — лидер идёт в жилой вагон, кровать — на свободную клетку вагона
  const spot = await g(() => {
    const game = window.__game;
    const L = game.getLeader();
    const car = game.train.carOfType('residential') || game.train.cars[0];
    const cells = game.train.interior(car);
    const free = cells.filter((q) => game.api.build.canPlace('bed', q.x, q.y, 0));
    if (!free.length) return null;
    const c = cells[Math.floor(cells.length / 2)];
    if (L.job) game.jobs.endJob(L, 'cancelled');
    game.entities.setPosition(L, c.x + 0.5, c.y + 0.5);
    free.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
    const f = free.find((q) => Math.hypot(q.x - c.x, q.y - c.y) >= 2) || free[0];
    return { x: f.x, y: f.y, car: car.type };
  });
  await frames(40);
  const beds = () => g(() => ({ built: window.__game.entities.listKind('building').filter((b) => b.defId === 'bed').length, bp: window.__game.entities.listKind('blueprint').filter((b) => /bed/.test(b.buildDefId || b.defId || '')).length }));
  const beds0 = await beds();
  if (check(!!spot, 'место под кровать')) {
    const sp = await toScreen(spot.x + 0.5, spot.y + 0.5);
    await page.mouse.move(sp.x, sp.y);
    await frames(3);
    await page.mouse.click(sp.x, sp.y);
    await frames(4);
    check(await g(() => window.__game.api.ui.tutorial().done.bed), 'ЛКМ: чертёж кровати поставлен');
    await shot('02b-bed');
  }
  await page.mouse.click(W / 2, H / 2, { button: 'right' });
  await frames(3);
  await tap('KeyB');
  await frames(3);
  // поселенцы — рядом с лидером (иначе «Никто не услышал призыва»)
  await g(() => {
    const game = window.__game;
    const L = game.getLeader();
    for (const p of game.colonists()) if (p !== L && !p.asleep && Math.hypot(p.x - L.x, p.y - L.y) > 6) {
      const cx = Math.floor(L.x);
      const cy = Math.floor(L.y);
      const q = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]].map(([dx, dy]) => ({ x: cx + dx, y: cy + dy })).find((c) => game.map.isPassable(c.x, c.y));
      if (q) game.entities.setPosition(p, q.x + 0.5, q.y + 0.5);
    }
  });
  await tap('KeyR');
  const armed = await g(() => window.__game.colonists().filter((p) => p.drafted && !p.isLeader).length);
  check(await g(() => window.__game.api.ui.tutorial().done.arms), `R: «К оружию!» (откликнулись ${armed})`);
  await run(300);
  await tap('KeyR'); // подсказка: «Ещё раз R — Отбой»
  check((await g(() => window.__game.colonists().filter((p) => p.drafted && !p.isLeader).length)) === 0, 'R ещё раз: «Отбой», все вернулись к делам');
  await measureFps('станция 0, день');
  await chooseRoute(1, (o) => Math.max(0, o.indexOf('forest')));
  await saveLoadCycle('станция 0');

  // 4. станции 0..3: выживание → отправление → путь → прибытие
  for (let step = 0; step < 4; step++) {
    const st = await stay(`станция ${step}`, step === 0 ? 10 : 12);
    if (st.lost || st.errors) break;
    if (step === 0) {
      const b = await beds();
      if (!check(b.built > beds0.built && b.bp === 0, `чертёж кровати в вагоне построен (кроватей ${beds0.built} → ${b.built})`)) {
        log(await g(() => {
          const game = window.__game;
          return JSON.stringify({ bps: game.entities.listKind('blueprint').map((e) => ({ id: e.buildDefId || e.defId, x: e.x, y: e.y, needs: game.api.build.needs(e) })), wood: game.items.count('wood'), removed: window.__pt.stats.removedBeds });
        }));
      }
      bedsBuilt = b.built;
    }
    if (step === 1 && !(await g(() => window.__pt.stats.raids))) {
      // рейд по сценарию MVP-6: если рассказчик ещё не прислал — бандиты к стоянке
      log('рейд рассказчика ещё не был — вызываем бандитов');
      await g(() => window.__game.api.combat.spawnRaid({ points: 60, faction: 'bandits' }));
      const r = await runUntil('!game.api.combat.isRaidActive()', 12000, { fight: true });
      check(r.ok, `рейд отбит за ${(r.ticks / 600).toFixed(1)} ч`);
      await frames(4);
      await shot('04-raid-after');
    }
    if (step > 0) {
      const lowFuel = st.fuel < 50;
      const score = (t) => (lowFuel ? { ash: 3, ruins: 2, village: 1, forest: 0 } : { village: 3, forest: 2, ash: 1, ruins: 0 })[t] ?? 0;
      await chooseRoute(step + 1, (o) => (score(o[0]) >= score(o[1]) ? 0 : 1));
    }
    if (!(await departNow(`станция ${step}`))) break;
    if (step === 0) {
      await frames(30);
      await shot('05-travel');
      await measureFps('в пути');
    }
    if (step === 1) {
      // сохранение посреди перегона
      await run(1500, { fight: true });
      await saveLoadCycle('в пути');
      check((await info()).phase === 'travel', 'в пути: после загрузки поезд всё ещё едет');
    }
    // в пути (засады, развилка) → прибытие; дикая стоянка — добыть топливо и снова в путь
    for (let leg = 0; leg < 4; leg++) {
      const r = await runUntil("game.api.journey.getState().phase !== 'travel'", 30000, { fight: true });
      const s = await info();
      if (s.lost || s.errors) break;
      if (s.phase === 'wild') {
        log(`дикая стоянка: угля ${s.fuel}, нужно ${s.need}`);
        await stay('дикая стоянка', 2);
        await departNow('дикая стоянка');
        continue;
      }
      if (!r.ok) break;
      break;
    }
    const a = await info();
    if (a.phase !== 'station' || a.step !== step + 1) {
      problems.push(`не доехали до станции ${step + 1}: ${JSON.stringify(a)}`);
      break;
    }
    reached = a.step;
    if (a.step === 1) check((await beds()).built >= bedsBuilt, `кровать из вагона приехала на станцию 1 (${(await beds()).built})`);
    await frames(20);
    check(await g(() => window.__game.save.hasSlot('auto')), `станция ${a.step} «${a.station.name}» (${a.biome}): прибыли, автосейв, поселенцев ${a.colonists.length}, угля ${a.fuel}`);
    await g(() => {
      const game = window.__game;
      if (game.time.hourInt < 7 || game.time.hourInt > 19) game.time.setHour?.(10);
    });
    await frames(20);
    await shot(`06-station${a.step}`);
    await measureFps(`станция ${a.step}`);
    await saveLoadCycle(`станция ${a.step}`);
    if (a.step === 2) {
      // перезагрузка страницы → главное меню → «Продолжить» (последний сейв)
      const before = await info();
      await page.reload();
      await page.waitForFunction(() => window.__game && window.__game.map && window.__game.renderer, null, { timeout: 15000 });
      await frames(20);
      await page.addScriptTag({ content: HELPERS });
      check((await screen()) === 'main', 'перезагрузка страницы: главное меню');
      await clickWidget('main:cont');
      await frames(10);
      const c = await info();
      check(!c.screen && c.step === 2 && c.phase === 'station' && c.colonists.length === before.colonists.length && c.fuel === before.fuel,
        `«Продолжить» после перезагрузки: станция ${c.station?.index} «${c.station?.name}», поселенцев ${c.colonists.length}, угля ${c.fuel}`);
    }
  }

  // 5. станция 4: Костяной дракон → победа
  if (reached === 4) {
    await g(() => window.__pt.designateFuel());
    const d = await runUntil("game.entities.listKind('pawn').some((p) => p.boss?.id === 'bone_dragon')", 9000, { fight: true });
    check(d.ok, `дракон появился через ${(d.ticks / 600).toFixed(1)} ч`);
    await frames(20);
    await shot('07-dragon');
    await measureFps('бой с драконом');
    const trace = () => {
      const game = window.__game;
      const d = game.entities.listKind('pawn').find((p) => p.boss?.id === 'bone_dragon');
      const L = game.getLeader();
      const hp = (p) => Math.round((game.api.health.getSummary(p)?.ratio ?? 1) * 100);
      return `д${game.time.day} ${game.time.hourInt}ч дракон ${d ? `${Math.round(d.health?.hp ?? -1)} hp, фаза ${d.boss?.phase}` : 'нет'} · лидер ${L ? `${hp(L)}% мана ${Math.round(game.api.combat.getMana(L)?.cur ?? 0)}${L.downed ? ' упал' : ''} до дракона ${d ? Math.hypot(d.x - L.x, d.y - L.y).toFixed(0) : '-'}` : 'нет'} · отряд ${game.colonists().map((p) => `${hp(p)}%${p.downed ? '↓' : ''}`).join(' ')} · заклинаний ${window.__pt.stats.casts}`;
    };
    // как игрок: проиграли бой — «Конец игры» → «Загрузить» → автосейв станции 4 → ещё попытка (до 3)
    let prev = null; // как закончилась прошлая попытка: 'lost' | 'stuck'
    for (let attempt = 1; attempt <= 3 && !victory; attempt++) {
      if (prev === 'lost') {
        await page.mouse.move(10, 10);
        await frames(6);
        if (!defeatOk) await shot('09-game-over');
        const ov = await info();
        defeatOk ||= check(ov.lost && ov.screen === 'over', `дракон победил (попытка ${attempt - 1}): экран «Конец игры»`);
        await clickWidget('over:load');
        await clickWidget('slot:load:auto');
      } else if (prev === 'stuck') {
        // бой завис — игрок загружает автосейв из паузы
        await page.keyboard.press('Escape');
        await frames(4);
        await clickWidget('pause:load');
        await clickWidget('slot:load:auto');
      }
      if (prev) {
        await frames(10);
        const la = await info();
        if (!check(!la.screen && la.step === 4 && !la.lost && !la.victory, `загрузка автосейва станции 4 (попытка ${attempt})`)) break;
      }
      const v = await runUntil('game.api.journey.getState().victory', 14400, { fight: true, trace: process.env.TRACE ? trace : null });
      await frames(20);
      const vs = await info();
      victory = v.ok && vs.screen === 'victory';
      prev = vs.lost ? 'lost' : 'stuck';
      if (!victory && !vs.lost) {
        const why = await g(() => {
          const game = window.__game;
          const d = game.entities.listKind('pawn').find((p) => p.boss && !p.dead);
          return `дракон ${d ? `${Math.round(d.health?.hp ?? -1)} hp, фаза ${d.boss?.phase}` : 'нет'}, поселенцы: ${game.colonists().map((p) => `${p.name}${p.downed ? ' (упал)' : ''}`).join(', ')}`;
        });
        stuck.push(why);
        log(`бой завис за сутки: ${why}`);
      }
      log(`бой с драконом, попытка ${attempt}: ${victory ? 'победа' : vs.lost ? 'колония пала' : 'не закончен'} (${(v.ticks / 600).toFixed(1)} ч)`);
    }
    check(victory, 'победа над драконом: экран итогов');
    if (victory) {
      await page.mouse.move(10, 10);
      await frames(6);
      await shot('08-victory');
      await clickWidget('win:cont');
      check(!(await screen()), 'победа → «Продолжить»');
    }
  }

  // 6. путь к концу игры (если его ещё не было): автосейв станции 4, лидер не сражается — до экрана «Конец игры»
  if (reached === 4 && !defeatOk) {
    await page.keyboard.press('Escape');
    await frames(4);
    await clickWidget('pause:exit');
    await clickWidget('main:load');
    await clickWidget('slot:load:auto');
    await frames(10);
    const la = await info();
    check(!la.screen && la.step === 4 && !la.victory, `загружен автосейв станции 4 (${la.station?.name})`);
    const r = await runUntil('game.colony.lost', 4 * 14400, { passive: true });
    await frames(10);
    let ov = await info();
    if (!ov.lost) {
      log(`за ${(r.ticks / 600).toFixed(0)} ч колония не пала (${ov.victory ? 'отряд победил дракона' : 'бой идёт'}) — добиваем голодом`);
      await g(() => {
        const game = window.__game;
        for (const p of game.colonists()) game.api.health.kill(p, 'starvation', {});
      });
      await frames(10);
      ov = await info();
    }
    defeatOk = ov.lost && ov.screen === 'over';
    check(defeatOk, `конец игры: экран «over» (${JSON.stringify({ lost: ov.lost, screen: ov.screen, deaths: (await g(() => window.__pt.stats.deaths)).length })})`);
    await page.mouse.move(10, 10);
    await frames(6);
    await shot('09-game-over');
    await clickWidget('over:menu');
    check((await screen()) === 'main', 'конец игры → главное меню');
  }

  const stats = await g(() => window.__pt.stats);
  log(`итоги: рейдов ${stats.raids}, засад ${stats.ambushes}, заклинаний ${stats.casts}, погибли [${stats.deaths.join('; ')}], оставлены [${stats.left.join(', ')}]`);
  const errs = await g(() => window.__game.errors.map((e) => `${e.where}: ${e.message || e}`));
  if (errs.length) problems.push(...errs);
  const missing = await g(() => [...window.__game.i18n.missing]);
  if (missing.length) problems.push(`нет перевода: ${missing.slice(0, 10).join(', ')}`);
} catch (err) {
  problems.push(`exception: ${err.stack || err}`);
}
await browser.close();
server.close();
check(reached === 4, `дошли до станции ${reached} из 4`);
const minFps = Math.min(...fpsLog.map((f) => f.fps));
console.log(`Станций: ${reached}/4 · победа: ${victory ? 'да' : 'нет'} · конец игры: ${defeatOk ? 'да' : 'нет'} · FPS мин. ${Number.isFinite(minFps) ? minFps.toFixed(1) : '-'} (${fpsLog.map((f) => `${f.label} ${f.fps.toFixed(0)}`).join(', ')})`);
if (stuck.length) console.warn(`⚠ бой с драконом зависал: ${stuck.join(' | ')}`);
const failed = problems.length > 0 || !victory || !defeatOk;
for (const p of problems) console.error(`  ✗ ${p}`);
console.log(failed ? '✗ FAIL' : '✓ PASS');
process.exit(failed ? 1 : 0);
