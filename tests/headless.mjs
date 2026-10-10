// Headless-симуляция в Node: колония живёт N игровых дней на максимальной скорости, бот водит лидера.
// Запуск: node tests/headless.mjs --days 10 --seed 42
// Падает (exit 1), если были исключения (game.errors) или нарушены инварианты.
import { createGame, startNewColony } from '../js/core/boot.js';
import { TICKS_PER_DAY } from '../js/core/constants.js';
import { RNG } from '../js/core/rng.js';
import { makeEatJob, makeSleepJob } from '../js/sim/needs.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);
const DAYS = Number(args.days ?? 3);
const SEED = args.seed !== undefined ? Number(args.seed) || String(args.seed) : 12345;
const QUIET = !!args.quiet;

// DOM-гвард: если модуль тронет DOM в register()/sim — упадём явно
for (const k of ['window', 'document', 'localStorage']) {
  if (k in globalThis) throw new Error(`[headless] неожиданный глобал ${k}`);
}

const log = (...a) => !QUIET && console.log(...a);
const fail = (msg) => {
  console.error(`✗ FAIL: ${msg}`);
  process.exitCode = 1;
};

const t0 = performance.now();
const game = await createGame({ headless: true, seed: SEED });
startNewColony(game, { seed: SEED });
log(`Игра создана за ${(performance.now() - t0).toFixed(0)} мс. Сид ${SEED}, модули: ${game.modules.join(', ')}`);
log(`Карта ${game.map.w}×${game.map.h}, сущностей ${game.entities.count}, поселенцев ${game.colonists().length}`);

// ---------- Бот лидера ----------
const bot = new RNG(`bot:${SEED}`);
const input = game.input;
let botState = { dir: [0, 0], until: 0, mode: 'wander' };
const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };

function botFrame(tick) {
  const p = game.getLeader();
  if (!p) return;
  // голод — идём есть
  if (((p.needs.food ?? 1) < 0.35 || (p.needs.rest ?? 1) < 0.15) && !p.job) {
    for (const k of Object.values(KEYS)) input.setKey(k, false);
    const job = p.needs.food < 0.35 ? makeEatJob(game, p) : makeSleepJob(game, p);
    if (job) game.jobs.startJob(p, job);
    return;
  }
  if (p.job) return;
  if (tick >= botState.until) {
    const r = bot.next();
    botState.until = tick + bot.int(30, 240);
    if (r < 0.45) botState.dir = [bot.int(-1, 1), bot.int(-1, 1)];
    else if (r < 0.6) botState.dir = [0, 0];
    else {
      // идём к дереву и рубим (E)
      botState.dir = [0, 0];
      const trees = game.entities.queryRadius(p.x, p.y, 7, 'plant', (e) => game.defs.plants.get(e.defId)?.choppable);
      if (trees.length) {
        const tr = trees[bot.int(0, trees.length - 1)];
        input.setMouseWorld(tr.x + 0.5, tr.y + 0.5);
        input.mouse.inside = true;
        input.tap('KeyE');
      }
    }
  }
  input.setKey(KEYS.right, botState.dir[0] > 0);
  input.setKey(KEYS.left, botState.dir[0] < 0);
  input.setKey(KEYS.down, botState.dir[1] > 0);
  input.setKey(KEYS.up, botState.dir[1] < 0);
}

// пометки рубки — раз в день бот помечает рощу у поезда
function designateGrove() {
  const c = game.train.center();
  const x0 = Math.floor(c.x + bot.int(-30, 30));
  const y0 = Math.floor(c.y + (bot.chance(0.5) ? -1 : 1) * bot.int(8, 18));
  const n = game.designations.addRect(['chop', 'harvest', 'mine'], x0 - 3, y0 - 3, x0 + 3, y0 + 3);
  return n;
}

// ---------- Прогон ----------
const totalTicks = DAYS * TICKS_PER_DAY;
const ts = performance.now();
let designated = designateGrove();
let leaderChanges = 0;
game.events.on('leader:changed', () => leaderChanges++);
let deaths = 0;
game.events.on('pawn:died', () => deaths++);
let lastDay = 1;
for (let tick = 0; tick < totalTicks; tick++) {
  if (tick % 4 === 0) {
    botFrame(tick);
    game.frame(1 / 60);
    input.endFrame();
  }
  game.step();
  if (game.time.day !== lastDay) {
    lastDay = game.time.day;
    designated += designateGrove();
    const c = game.colonists();
    log(`  день ${lastDay}: поселенцев ${c.length}, предметов ${game.entities.countKind('item')}, деревьев ${game.entities.countKind('plant')}, работ ${game.stats.jobsDone}, еда лидера ${(game.getLeader()?.needs.food ?? 0).toFixed(2)}`);
  }
  if (game.errors.length) break;
}
const simMs = performance.now() - ts;

// ---------- Сохранение/загрузка ----------
const before = { ents: game.entities.count, pawns: game.entities.countKind('pawn'), items: game.items.totals(), tick: game.time.tick, des: game.designations.count() };
const json = game.save.toJSON();
const game2 = await createGame({ headless: true, seed: 1 });
game2.save.fromJSON(json);
const after = { ents: game2.entities.count, pawns: game2.entities.countKind('pawn'), items: game2.items.totals(), tick: game2.time.tick, des: game2.designations.count() };
if (after.ents !== before.ents) fail(`сейв: сущностей ${before.ents} → ${after.ents}`);
if (after.pawns !== before.pawns) fail(`сейв: пешек ${before.pawns} → ${after.pawns}`);
if (after.tick !== before.tick) fail(`сейв: тик ${before.tick} → ${after.tick}`);
if (after.des !== before.des) fail(`сейв: пометок ${before.des} → ${after.des}`);
for (const [k, v] of before.items) if (after.items.get(k) !== v) fail(`сейв: ${k} ${v} → ${after.items.get(k)}`);
// продолжаем загруженную игру полдня
for (let i = 0; i < TICKS_PER_DAY / 2; i++) game2.step();
if (!game2.getLeader() && game2.colonists().length) fail('после загрузки нет лидера');

// ---------- Детерминизм: тот же сид → то же состояние ----------
async function fingerprint(seed, ticks) {
  const g = await createGame({ headless: true, seed });
  startNewColony(g, { seed });
  g.designations.addRect(['chop'], 50, 30, 60, 38);
  for (let i = 0; i < ticks; i++) g.step();
  return JSON.stringify(g.colonists().map((p) => [p.id, p.x.toFixed(3), p.y.toFixed(3), p.needs.food.toFixed(4)])) + g.entities.count + ':' + g.stats.jobsDone;
}
const fa = await fingerprint(777, 3000);
const fb = await fingerprint(777, 3000);
if (fa !== fb) fail('недетерминированная симуляция: одинаковый сид дал разные состояния');

// ---------- Итоги ----------
const errors = [...game.errors, ...game2.errors];
const tps = (game.stats.ticks / simMs) * 1000;
console.log('—'.repeat(60));
console.log(`Дней: ${DAYS} (${game.stats.ticks} тиков) за ${(simMs / 1000).toFixed(2)} с → ${tps.toFixed(0)} тиков/с (${(tps / 60).toFixed(0)}× реального времени)`);
console.log(`Поселенцев живо: ${game.colonists().length}, смертей: ${deaths}, смен лидера: ${leaderChanges}`);
console.log(`Предметов (стопок): ${game.entities.countKind('item')}, всего дерева: ${game.items.count('wood')}, еды-сухпайков: ${game.items.count('ration')}, ягод: ${game.items.count('berries')}`);
console.log(`Работ выполнено: ${game.stats.jobsDone}, сорвано: ${game.stats.jobsFailed}, пометок поставлено: ${designated}, осталось: ${game.designations.count()}`);
console.log(`A*: поисков ${game.pathfinder.stats.searches}, из кэша ${game.pathfinder.stats.cacheHits}, недостижимо ${game.pathfinder.stats.failed}`);
console.log(`Сейв: ${(json.length / 1024).toFixed(1)} КБ, загрузка OK: ${after.ents === before.ents}`);
console.log(`Детерминизм: ${fa === fb ? 'OK' : 'НЕТ'}`);
console.log(`Ошибок: ${errors.length}`);
if (errors.length) {
  for (const e of errors.slice(0, 10)) console.error(`  [${e.where}] ${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n')}`);
  fail(`${errors.length} исключений`);
}
const missing = [...game.i18n.missing];
if (missing.length) console.warn(`Нет перевода для ключей: ${missing.slice(0, 20).join(', ')}`);
if (game.stats.jobsDone < DAYS * 5) fail(`слишком мало выполненных работ: ${game.stats.jobsDone}`);
if (game.input.conflicts.length) fail(`конфликты клавиш: ${JSON.stringify(game.input.conflicts)}`);
if (!process.exitCode) console.log('✓ PASS');
