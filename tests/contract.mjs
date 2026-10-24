// Контрактные тесты ядра (то, на что опираются модули; см. docs/ARCHITECTURE.md). Быстрые (~2 с), без DOM.
// Запуск: node tests/contract.mjs  (также вызывается из tests/headless.mjs)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGame } from '../js/core/boot.js';
import { EVENTS } from '../js/core/events.js';
import { keymapConflicts, allKeys } from '../js/core/keymap.js';

/** Сигнатуры заглушек game.api (контракт): ns → имена функций. */
export const API_CONTRACT = {
  colony: ['getLeader', 'getColonists', 'chooseHeir', 'transferLeadership'],
  health: ['applyDamage', 'heal', 'kill', 'isDowned', 'canWork', 'moveSpeedFactor', 'workSpeedFactor', 'addCondition', 'hasCondition', 'getSummary',
    'getMemory', 'addMemory', 'isCarrying', 'canCarry', 'recordFallen', 'createFallen', 'getFallen'],
  mind: ['addThought', 'removeThought', 'getMood', 'learn', 'skillLevel', 'skillFactor', 'isInBreak', 'hasTrait', 'say', 'scheduleAllows',
    'getAuthority', 'addAuthority', 'willObey', 'addTrait', 'revealTrait', 'setRelation', 'generateCandidate'],
  vision: ['isVisible', 'isExplored', 'canPawnSee', 'report', 'noise', 'canLeaderHear', 'lastKnown'],
  orders: ['list', 'give', 'openMenu'],
  combat: ['isHostile', 'isDrafted', 'setDrafted', 'attack', 'spawnRaid', 'getMana', 'hasStaff'],
  economy: ['itemValue', 'colonyWealth', 'canAfford', 'consume', 'isAddicted', 'startInspection'],
  journey: ['getBiome', 'getStation', 'isTravelling', 'getFuel', 'depart', 'getTrainState', 'setRegulator', 'getAmbientTemp', 'getCarHeat', 'isInCab'],
  build: ['canPlace', 'place', 'deconstruct'],
  ui: ['notify', 'setObjective', 'clearObjective'],
  av: ['shake', 'floatText', 'play', 'hitStop', 'flash'],
};

const fp = (g) =>
  JSON.stringify(g.colonists().map((p) => [p.id, p.name, p.x.toFixed(3), p.y.toFixed(3), (p.needs.food ?? 0).toFixed(4)])) +
  `|${g.entities.count}|${g.stats.jobsDone}|${g.rng.state}|${g.time.tick}|${g.log.length}`;

export async function runContractTests({ log = console.log } = {}) {
  const failures = [];
  const check = (cond, msg) => {
    if (!cond) failures.push(msg);
  };
  const run = (g, ticks) => {
    for (let i = 0; i < ticks; i++) g.step();
  };
  const allErrors = [];
  const make = async (seed = 1) => {
    const g = await createGame({ headless: true, seed });
    allErrors.push(g);
    return g;
  };

  // --- клавиши ---
  check(keymapConflicts().length === 0, `конфликты в таблице клавиш: ${JSON.stringify(keymapConflicts())}`);
  const G0 = await make();
  for (const b of allKeys()) {
    if (b.registeredBy !== 'core') continue;
    const reg = G0.input.bindings.get(b.action);
    check(reg && reg.owner === b.owner && JSON.stringify(reg.keys) === JSON.stringify(b.keys), `ядро не зарегистрировало ${b.action} как в keymap`);
  }
  check(G0.input.conflicts.length === 0, `конфликты клавиш в рантайме: ${JSON.stringify(G0.input.conflicts)}`);

  // --- события и API ---
  const evs = Object.values(EVENTS);
  check(new Set(evs).size === evs.length, 'дубли имён в EVENTS');
  for (const [ns, fns] of Object.entries(API_CONTRACT))
    for (const fn of fns) check(typeof G0.api[ns]?.[fn] === 'function', `нет заглушки game.api.${ns}.${fn}`);
  check(G0.defs.scenarios.has('standard') && G0.defs.difficulties.has('normal'), 'нет реестров scenarios/difficulties');

  // --- новая игра без перезагрузки == свежая игра ---
  const A = await make();
  A.newGame({ seed: 11 });
  A.designations.addRect(['chop'], 40, 20, 90, 70);
  A.slowMo(0.3);
  run(A, 6000);
  A.newGame({ seed: 22, colonyName: 'Тест', leaderName: 'Иван Тестов' });
  run(A, 2000);
  const B = await make();
  B.newGame({ seed: 22, colonyName: 'Тест', leaderName: 'Иван Тестов' });
  run(B, 2000);
  check(fp(A) === fp(B), 'newGame на уже игравшей игре ≠ свежей игре (resetWorld неполон)');
  check(A.getLeader()?.name === 'Иван Тестов' && A.colony.name === 'Тест', 'leaderName/colonyName не применены');
  check(A.timeScale === 1, 'slowMo пережил новую игру');

  // --- сценарии ---
  B.defs.scenarios.add(
    {
      id: 'test:alone', nameKey: 't', descKey: 't', difficulty: 'brutal', colonists: 0, items: [['wood', 5], ['no_such_item', 1]], silver: 7,
      flags: { naked: true }, apply(game, opts, ctx) { ctx.leader.naked = true; game.__applied = opts.flag; },
    },
    'test',
  );
  const warn = console.warn;
  console.warn = () => {};
  B.newGame({ seed: 5, scenarioId: 'test:alone', flag: 7, look: { curls: 20, crystal: 'red' }, roster: [{ role: 'leader', name: 'Л', skills: { magic: { level: 7 } } }] });
  console.warn = warn;
  const L = B.getLeader();
  check(B.colonists().length === 1 && B.items.count('wood') === 5 && B.__applied === 7, 'сценарий: colonists/items/apply');
  check(B.colony.scenarioId === 'test:alone' && B.colony.difficulty === 'brutal' && B.colony.flags.naked && B.colony.silver === 7, 'сценарий: поля колонии');
  check(L.name === 'Л' && L.skills.magic.level === 7 && L.naked && L.look.curls === 9 && L.look.crystal === '#5ef2ff' && L.markProgress === 1, 'roster/look лидера');

  // --- перестройка состава: содержимое едет с вагоном ---
  const T = await make(3);
  T.newGame({ seed: 3, scenarioId: 'standard' });
  T.defs.buildings.add({ id: 'test_bed', nameKey: 't', size: [1, 2], bed: true, passable: true }, 'test');
  T.designations.registerType({ id: 'test_des', nameKey: 't', valid: (g, x, y) => g.map.buildingAt(x, y)?.id || 0 }, 'test');
  const lr = { ...T.train.locomotive.rect };
  const bed = T.api.build.place('test_bed', lr.x + 2, lr.y + 2, { force: true });
  T.designations.add('test_des', bed.x, bed.y);
  const store = T.train.carOfType('storage');
  [...T.zones.zones.values()].find((z) => z.data?.carId === store.id).filter = { categories: ['food'] };
  const itemsBefore = JSON.stringify([...T.items.totals()]);
  let added = 0;
  T.events.on('train:carAdded', () => added++);
  const car = T.train.addCar('greenhouse', { restamp: true });
  const lr2 = T.train.locomotive.rect;
  check(added === 1 && car.rect && lr2.x > lr.x, 'addCar + restamp');
  check(bed.x - lr2.x === 2 && bed.y - lr2.y === 2 && T.map.buildingAt(bed.x, bed.y) === bed, 'мебель не уехала вместе с локомотивом');
  check(T.designations.get('test_des', bed.x, bed.y)?.targetId === bed.id, 'пометка не переехала за целью');
  check([...T.zones.zones.values()].find((z) => z.data?.carId === store.id)?.filter?.categories?.[0] === 'food', 'фильтр склада вагона потерян');
  check(JSON.stringify([...T.items.totals()]) === itemsBefore, 'предметы потерялись при restamp');
  check(T.entities.listKind('building').filter((b) => b.defId === 'mana_engine').length === 1, 'фикстура двигателя не одна');
  T.train.removeCar(car, { restamp: true });
  const planks = T.defs.floors.get('wagon_planks').index;
  let stray = 0;
  for (let y = 0; y < T.map.h; y++)
    for (let x = 0; x < T.map.w; x++) if (T.map.floor[T.map.idx(x, y)] === planks && !T.train.carAt(x, y) && y !== T.train.railY) stray++;
  check(stray === 0 && T.train.cars.length === 5, `после removeCar остался пол вагона (${stray})`);
  run(T, 3000);

  // --- смена стоянки + сохранение модульных полей поезда ---
  T.train.fuel = 17;
  T.train.data.train = { pressure: 3 };
  T.train.locomotive.upgrades = ['boiler'];
  const n0 = T.colonists().length;
  let carried = 0;
  T.events.on('station:changed', (e) => (carried = e.carried));
  T.changeStation({ stationIndex: 1 });
  check(carried > 0 && T.colonists().length === n0, 'changeStation: поселенцы потеряны');
  check(T.entities.get(bed.id) && T.map.buildingAt(bed.x, bed.y) === bed, 'changeStation: мебель не переехала');
  run(T, 3000);
  const json = T.save.toJSON();
  const K = await make();
  K.save.fromJSON(json);
  const once = JSON.stringify(K.save.snapshot().data);
  K.save.fromJSON(json);
  check(JSON.stringify(K.save.snapshot().data) === once, 'двойная загрузка ≠ одинарной');
  check(K.train.fuel === 17 && K.train.data.train.pressure === 3 && K.train.locomotive.upgrades[0] === 'boiler', 'поля модулей на поезде не сохранились');
  check(K.entities.count === T.entities.count && K.colony.authority === T.colony.authority, 'загрузка: состояние не совпало');
  run(K, 3000);

  // --- устойчивость к NaN от модулей ---
  const N = await make(9);
  N.newGame({ seed: 9 });
  N.provide('health', { moveSpeedFactor: () => NaN, workSpeedFactor: () => undefined }, 'test');
  N.input.setKey('KeyD', true);
  for (let i = 0; i < 600; i++) {
    if (i % 4 === 0) N.frame(1 / 60);
    N.step();
  }
  check(N.colonists().every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 'NaN-множитель испортил позиции');

  // --- slowMo ---
  const S = await make();
  const s1 = S.slowMo(0.25);
  S.slowMo(0.05, 60);
  const lowest = S.timeScale;
  S.frame(0.08);
  const after = S.timeScale;
  S.slowMoEnd(s1);
  check(lowest === 0.05 && after === 0.25 && S.timeScale === 1, `slowMo: ${lowest}, ${after}, ${S.timeScale}`);

  // --- hold-взаимодействие E ---
  const H = await make();
  H.newGame({ seed: 2 });
  const P = H.getLeader();
  let started = 0;
  let held = -1;
  H.defs.interactions.add({
    id: 'test:hold', order: 1, hold: true,
    find: (game, p, tx, ty) => (tx === Math.floor(p.x) && ty === Math.floor(p.y) ? { label: 'hold' } : null),
    onHoldStart: () => started++,
    onRelease: (game, p, ms) => (held = ms),
  }, 'test');
  H.input.setMouseWorld(P.x, P.y);
  H.input.mouse.inside = true;
  H.input.setKey('KeyE', true);
  for (let i = 0; i < 30; i++) {
    H.frame(1 / 60);
    H.input.endFrame();
  }
  H.input.setKey('KeyE', false);
  H.frame(1 / 60);
  check(started === 1 && Math.abs(held - 500) < 40, `hold E: старт ${started}, удержание ${held} мс`);

  // --- наследование власти и конец игры ---
  const D = await make();
  D.newGame({ seed: 8, scenarioId: 'standard' });
  const first = D.getLeader();
  const designated = D.colonists().find((p) => p !== first);
  D.colony.heirId = designated.id;
  const seen = [];
  D.events.on('leader:died', (e) => seen.push(['died', e.pawn.id, e.heir?.id]));
  D.events.on('leader:changed', (e) => seen.push(['changed', e.to.id]));
  D.events.on('colony:lost', () => seen.push(['lost']));
  D.api.health.kill(first, 'test');
  check(D.getLeader() === designated && designated.controlled === 'player' && D.player.pawn === designated && D.colony.heirId === 0, 'наследник не получил управление');
  check(JSON.stringify(seen) === JSON.stringify([['died', first.id, designated.id], ['changed', designated.id]]), `события наследования: ${JSON.stringify(seen)}`);
  for (const p of D.colonists()) D.api.health.kill(p, 'test');
  check(D.colony.lost && seen.at(-1)[0] === 'lost' && !D.getLeader(), 'нет colony:lost после гибели всех');
  run(D, 600);

  for (const g of allErrors) for (const e of g.errors) failures.push(`game.error [${e.where}] ${e.message}`);
  log(`Контракт ядра: ${failures.length ? `${failures.length} нарушений` : 'OK'}`);
  return failures;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const f = await runContractTests();
  for (const m of f) console.error(`  ✗ ${m}`);
  if (f.length) process.exit(1);
  console.log('✓ PASS');
}
