// Тест модуля train (headless, MVP-4): сценарий «Трое выживших» (старт по умолчанию), уголь в тендере и расход в пути,
// дикая стоянка без топлива, гудок H (только из кабины; нажать — посадка, удержать — отправление с подтверждением,
// двойной — «К оружию!»), отставшие, API поезда, сохранение. Запуск: node tests/train.test.mjs
import { createGame, startNewColony } from '../js/core/boot.js';
import { TICKS_PER_HOUR as H } from '../js/core/constants.js';

let fails = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) {
    fails++;
    console.error(`  ✗ ${msg}`);
  } else console.log(`  ✓ ${msg}`);
};
/** Тики с кадрами (кадр на каждый 4-й тик, dt кадра = 1/15 с ≈ реальное время при 1x). */
const run = (g, n) => {
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) {
      g.frame(4 / 60);
      g.input.endFrame();
    }
    g.step();
  }
};
/** Только кадры (реальное время без тиков). */
const frames = (g, n, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) {
    g.frame(dt);
    g.input.endFrame();
  }
};
async function make(seed = 21, opts = {}) {
  const g = await createGame({ headless: true, seed });
  startNewColony(g, { seed, ...opts });
  return g;
}
const T = (g) => g.api.train;
const toCab = (g, p = g.getLeader()) => {
  const r = g.train.locomotive.rect;
  g.entities.setPosition(p, r.x + 2.5, r.y + 3.5);
};
const press = (g, ms) => {
  g.input.setKey('KeyH', true);
  frames(g, Math.max(1, Math.round(ms / 16.67)));
  g.input.setKey('KeyH', false);
  frames(g, 1);
};
const outside = (g, p) => {
  const c = g.train.center();
  const s = g.map.randomPassableNear(g.rng, c.x - 20, c.y + 14, 6, 60, (x, y) => !g.train.carAt(x, y));
  if (p.job) g.jobs.endJob(p, 'cancelled');
  g.entities.setPosition(p, s.x + 0.5, s.y + 0.5);
};

// ---------------------------------------------------------------- 1. сценарий
console.log('1. Сценарий «Трое выживших»');
{
  const g = await make();
  ok(g.modules.includes('train') && g.errors.length === 0, `модуль подключён (${g.errors.map((e) => e.message)})`);
  ok(g.defs.scenarios.has('three_survivors') && g.colony.scenarioId === 'three_survivors', 'сценарий по умолчанию — three_survivors');
  ok(g.colonists().length === 3 && g.colonists().filter((p) => p.isLeader).length === 1, 'лидер + 2 спутника');
  ok(g.train.cars.map((c) => c.type).join(',') === 'residential,storage,tender,locomotive', `состав: ${g.train.cars.map((c) => c.type)}`);
  ok(g.getScenario().engine === 'steam' && T(g).usesFuel(), 'паровоз (тратит топливо)');
  ok(T(g).fuelUnits() === 72 && g.items.count('coal') === 72, `уголь в тендере: ${T(g).fuelUnits()}`);
  const food = g.items.count('ration') * 0.8 + g.items.count('berries') * 0.1;
  ok(food >= 3 * 1.5 * 9.5, `еды ≈ на 10 дней для троих (${food.toFixed(0)} сытости)`);
  const tz = [...g.zones.zones.values()].find((z) => z.data?.carId === g.train.carOfType('tender').id);
  ok(tz && tz.filter?.items?.includes('coal') && !g.zones.accepts(tz, 'ration') && tz.priority === 4, 'зона тендера — только топливо, высокий приоритет');
  ok(g.defs.buildings.has('coal_seam') && g.defs.items.has('coal'), 'уголь и угольный пласт');
  const s = g.api.journey.getTrainState();
  ok(s.engine === 'steam' && s.moving === false && s.fuel === 72, 'getTrainState');
  ok(g.api.journey.getFuel().amount === 72, 'getFuel');
  const g2 = await make(21, { scenarioId: 'standard' });
  ok(!g2.api.train.usesFuel() && g2.errors.length === 0, 'запасной сценарий standard (рунный) работает без топлива');
}

// ---------------------------------------------------------------- 2. гудок: только из кабины, посадка
console.log('2. Гудок и посадка');
{
  const g = await make(22);
  const L = g.getLeader();
  const horns = [];
  g.events.on('journey:horn', (e) => horns.push(e.pattern), 'test');
  const boards = [];
  g.events.on('journey:boarding', (e) => boards.push(e), 'test');
  g.entities.setPosition(L, g.train.center().x, g.train.railY + 8.5);
  ok(!g.api.journey.isInCab(L), 'лидер не в кабине');
  press(g, 100);
  frames(g, 40);
  ok(horns.length === 0 && !g.train.ops.boarding, 'вне кабины гудок не работает');
  ok(g.log.some((l) => l.text === g.t('train.horn.cabOnly')), 'подсказка «только из кабины»');
  toCab(g);
  ok(g.api.journey.isInCab(L), 'лидер в кабине');
  const p = g.colonists().find((x) => !x.isLeader);
  outside(g, p);
  ok(!T(g).isAboard(p), 'спутник снаружи');
  press(g, 120);
  frames(g, 40); // > 0,4 с — короткий гудок
  ok(horns[0] === 'short' && g.train.ops.boarding && boards.length === 1, 'нажать H — короткий гудок и посадка');
  ok(g.train.ops.boarding.untilTick - g.time.tick > 1700, 'посадка — 30 с');
  run(g, 120);
  ok(p.job?.data?.board || T(g).isAboard(p), `спутник бежит к поезду (${p.job?.type})`);
  let k = 0;
  while (g.api.journey.getState().phase !== 'travel' && k < 1900) {
    run(g, 30);
    k += 30;
  }
  ok(g.api.journey.getState().phase === 'travel', `все сели — поезд ушёл (${k} тиков)`);
  ok(g.colonists().length === 3 && T(g).leftBehind().length === 0, 'никто не остался');
}

// ---------------------------------------------------------------- 3. удержание: отправление с подтверждением, отставшие
console.log('3. Отправление и отставшие');
{
  const g = await make(23);
  toCab(g);
  const [a, b] = g.colonists().filter((x) => !x.isLeader);
  outside(g, a);
  a.downed = true; // не может бежать
  const left = [];
  g.events.on('journey:leftBehind', (e) => left.push(e), 'test');
  press(g, 1100);
  ok(g.train.ops.confirm?.ids?.includes(a.id), 'удержать H — подтверждение со списком не севших');
  ok(g.api.journey.getState().phase === 'station', 'без подтверждения не едем');
  T(g).confirmDepart(false);
  ok(!g.train.ops.confirm && g.train.ops.boarding, '«Ждать» — посадка продолжается');
  press(g, 1100);
  ok(T(g).confirmDepart(true), '«Отправляться» — поехали');
  ok(left.length === 1 && left[0].pawn === a && a.removed, 'опоздавший остался на станции');
  ok(g.colonists().length === 2 && g.colonists().includes(b), `в поезде двое (${g.colonists().length})`);
  ok(T(g).leftBehind()[0]?.name === a.name, 'запись об отставшем');
  ok(g.log.some((l) => l.text.includes(a.name) && l.type === 'bad'), 'запись в журнале');
  ok(g.api.journey.isTravelling(), 'поезд в пути');
}

// ---------------------------------------------------------------- 4. двойной гудок
console.log('4. Двойной гудок');
{
  const g = await make(24);
  toCab(g);
  const horns = [];
  g.events.on('journey:horn', (e) => horns.push(e.pattern), 'test');
  press(g, 80);
  frames(g, 5);
  press(g, 80);
  frames(g, 40);
  ok(horns.join(',') === 'double' && !g.train.ops.boarding, `двойной гудок — «К оружию!», без посадки (${horns})`);
}

// ---------------------------------------------------------------- 5. расход угля, дикая стоянка
console.log('5. Уголь в пути и дикая стоянка');
{
  const g = await make(25);
  g.api.journey.choose(1, 0);
  const f0 = T(g).fuelUnits();
  ok(T(g).depart({ force: true }), 'отправление');
  run(g, H);
  const f1 = T(g).fuelUnits();
  ok(f1 < f0 && f0 - f1 >= 6 && f0 - f1 <= 10, `в пути уголь расходуется (${f0} → ${f1} за час)`);
  ok(g.api.journey.getTrainState().moving, 'getTrainState.moving');
  // оставить чуть-чуть
  for (const it of g.entities.listKind('item').filter((i) => i.defId === 'coal')) g.items.take(it, it.count);
  const tender = g.train.carOfType('tender');
  const c = g.train.interior(tender)[1];
  g.items.spawn('coal', 2, c.x, c.y);
  let out = 0;
  g.events.on('train:outOfFuel', () => out++, 'test');
  const legT = g.api.journey.getState().leg.t;
  run(g, H);
  ok(out === 1, 'уголь кончился — событие');
  const st = g.api.journey.getState();
  ok(st.phase === 'wild' && g.map.biome !== 'travel', `поезд встал на дикой стоянке (${g.map.biome})`);
  ok(g.api.journey.getStation().wild && g.colonists().length === 3, 'дикая стоянка, все на месте');
  ok(st.leg && st.leg.t >= legT, 'перегон не потерян');
  ok(g.entities.listKind('building').some((b) => b.defId === 'coal_seam'), 'рядом есть уголь');
  // дрова как топливо: 3 полена = 1 единица
  const c2 = g.train.interior(tender)[4];
  g.items.spawn('wood', 30, c2.x, c2.y);
  ok(T(g).fuelUnits() === 10, `дрова в тендере — топливо (${T(g).fuelUnits()})`);
  g.items.spawn('coal', 60, c.x, c.y);
  ok(g.api.journey.canDepart() && T(g).depart({ force: true }), 'топливо есть — снова в путь');
  ok(g.api.journey.getState().phase === 'travel' && g.api.journey.getState().leg.t === st.leg.t, 'перегон продолжается с того же места');
  ok(g.errors.length === 0, `без ошибок (${g.errors.map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 6. сохранение
console.log('6. Сохранение');
{
  const g = await make(26);
  toCab(g);
  const a = g.colonists().find((x) => !x.isLeader);
  outside(g, a);
  a.downed = true;
  T(g).startBoarding();
  T(g).depart({ force: true });
  run(g, 300);
  const json = g.save.toJSON();
  const g2 = await createGame({ headless: true, seed: 1 });
  g2.save.fromJSON(json);
  ok(g2.api.train.leftBehind().length === 1 && g2.train.ops.departures === 1, 'отставшие и отправления сохраняются');
  ok(g2.api.train.fuelUnits() === T(g).fuelUnits(), 'уголь сохраняется');
  run(g2, 600);
  ok(g2.errors.length === 0 && g.errors.length === 0, `без ошибок (${[...g.errors, ...g2.errors].map((e) => e.message)})`);
}

console.log(`${checks - fails}/${checks} проверок`);
if (fails) {
  console.error(`✗ FAIL: ${fails}`);
  process.exitCode = 1;
} else console.log('✓ PASS');
