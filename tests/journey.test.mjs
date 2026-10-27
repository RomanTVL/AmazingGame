// Тест модуля journey (headless, MVP-4): маршрут 4×2, Гниль, рассказчик и события, засада, поездка через все 4 станции
// (смена карты, перевоз поселенцев и вещей, биомы лес/пустошь, дорисовка станций), Костяной дракон и 'game:victory',
// сохранение посреди перегона. Запуск: node tests/journey.test.mjs
import { createGame, startNewColony } from '../js/core/boot.js';
import { TICKS_PER_HOUR as H, TICKS_PER_DAY as DAY } from '../js/core/constants.js';
import { INCIDENTS } from '../js/modules/journey/teller.js';

let fails = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) {
    fails++;
    console.error(`  ✗ ${msg}`);
  } else console.log(`  ✓ ${msg}`);
};
const run = (g, n) => {
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) {
      g.frame(1 / 60);
      g.input.endFrame();
    }
    g.step();
  }
};
async function make(seed = 11, opts = {}) {
  const g = await createGame({ headless: true, seed });
  startNewColony(g, { seed, ...opts });
  return g;
}
const Jx = (g) => g.api.journey.debugState();
const enemies = (g) => g.entities.listKind('pawn').filter((p) => p.faction === 'enemy' && !p.dead);
const killEnemies = (g) => {
  for (const p of enemies(g)) g.api.health.kill(p, 'test', {});
};
const terrainCount = (g, id) => {
  const ix = g.defs.terrain.get(id).index;
  let n = 0;
  for (let i = 0; i < g.map.n; i++) if (g.map.terrain[i] === ix) n++;
  return n;
};
const addCoal = (g, n) => {
  const tender = g.train.carOfType('tender');
  const c = g.train.interior(tender)[2];
  g.items.spawn('coal', n, c.x, c.y);
};
/** Ждать, пока cond() не станет истиной (не больше max тиков), по пути убирая врагов, если clear. */
function until(g, cond, max, clear = false) {
  let k = 0;
  while (!cond() && k < max) {
    run(g, 30);
    k += 30;
    if (clear) killEnemies(g);
    if (g.errors.length) break;
  }
  return k;
}

// ---------------------------------------------------------------- 1. регистрация
console.log('1. Регистрация');
{
  const g = await make();
  ok(g.modules.includes('journey') && g.errors.length === 0, `модуль подключён без ошибок (${g.errors.map((e) => e.message)})`);
  ok(g.providers.journey?.getStation === 'journey' && g.providers.journey?.depart === 'journey', 'journey предоставляет getStation/depart');
  ok(g.providers.journey?.getTrainState === 'train', 'getTrainState — у train (не переопределён)');
  for (const id of ['rot', 'cinder', 'lava_crack', 'gravel', 'travel_void']) ok(g.defs.terrain.has(id), `ландшафт ${id}`);
  ok(g.defs.biomes.has('ash') && g.defs.biomes.has('travel'), 'биомы ash и travel');
  ok(g.input.bindings.get('panel:route')?.keys?.[0] === 'F4', 'F4 — карта маршрута');
  ok(g.ui.panels.has('route') && g.ui.hud.has('journey:status'), 'панель маршрута и HUD');
  ok(g.render.layers.has('journey:travel'), 'слой «в пути»');
  ok(g.defs.difficulties.get('hard').threat > g.defs.difficulties.get('easy').threat, 'параметры сложности');
  const st = g.api.journey.getStation();
  ok(st.index === 0 && st.id === 'start' && st.name, `стартовая станция (${st.name})`);
  ok(typeof g.api.journey.getAmbientTemp() === 'number', 'getAmbientTemp');
}

// ---------------------------------------------------------------- 2. маршрут
console.log('2. Маршрут');
{
  const g = await make(11);
  const r = g.api.journey.getRoute();
  ok(r.steps.length === 4 && r.steps.every((s) => s.length === 2), 'маршрут: 4 шага по 2 варианта');
  ok(r.steps.flat().every((o) => ['forest', 'ash', 'village', 'ruins'].includes(o.type)), 'типы: лес / пустошь / деревня / руины');
  ok(r.steps.every((s) => s[0].type !== s[1].type), 'варианты шага различаются');
  ok(r.steps[0].every((o) => o.biome === 'forest') && r.steps[3].every((o) => o.biome === 'ash'), 'шаг 1 — лес, шаг 4 — пустошь');
  ok(r.steps[3].every((o) => o.boss === 'bone_dragon'), 'станция 4 — Костяной дракон');
  ok(r.legs.every((t) => t >= 30 * 60 && t <= 60 * 60), `перегоны 30–60 с при 1x (${r.legs.map((t) => (t / 60) | 0).join(', ')} с)`);
  const g2 = await make(11);
  ok(JSON.stringify(g2.api.journey.getRoute()) === JSON.stringify(r), 'маршрут детерминирован от сида');
  ok(!g.api.journey.choose(2, 0), 'выбрать можно только следующий шаг');
  ok(g.api.journey.choose(1, 1) && g.api.journey.getState().choice[0] === 1, 'выбор варианта шага 1');
}

// ---------------------------------------------------------------- 3. Гниль
console.log('3. Гниль');
{
  const g = await make(12);
  const J = Jx(g);
  const left = g.api.journey.getState().rotHoursLeft;
  ok(left > 25 && left <= 30, `таймер Гнили на старте ≈ fora сценария (${left.toFixed(1)} ч)`);
  const adv = [];
  g.events.on('journey:rotAdvance', (e) => adv.push(e.level), 'test');
  J.S.rot.deadline = g.time.tick + 10;
  run(g, 20);
  ok(adv[0] === 1 && g.api.journey.getState().rotLevel === 1, 'срок вышел — Гниль пришла (уровень 1)');
  ok(terrainCount(g, 'rot') > 0, `земля чернеет (${terrainCount(g, 'rot')} клеток Гнили)`);
  const rot1 = terrainCount(g, 'rot');
  const beasts = [];
  g.events.on('combat:raidStarted', (e) => beasts.push(e.faction), 'test');
  run(g, 7 * H);
  ok(g.api.journey.getState().rotLevel >= 2 && terrainCount(g, 'rot') > rot1, 'Гниль ползёт дальше');
  ok(beasts.includes('rot_beasts'), `пришли гнилые волки (${beasts})`);
  ok(g.errors.length === 0, `без ошибок (${g.errors.map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 4. рассказчик и события
console.log('4. Рассказчик и события');
{
  const g = await make(13);
  const J = Jx(g);
  ok(J.S.teller.nextRaid > g.time.tick + 2 * DAY, 'первый рейд — не раньше ~3 суток');
  ok(INCIDENTS.length >= 5 && INCIDENTS.length <= 8, `простых событий: ${INCIDENTS.length}`);
  const ran = [];
  for (const d of INCIDENTS) {
    if (d.id === 'wolves') continue;
    const n0 = g.entities.count;
    const r = d.run(J);
    if (r) ran.push(d.id);
    void n0;
  }
  ok(ran.length >= 5, `события срабатывают: ${ran.join(', ')}`);
  ok(J.S.dialogs.length === 1, 'беженец просится — диалог');
  const c0 = g.colonists().length;
  ok(g.api.journey.answer(J.S.dialogs[0].id, true) && g.colonists().length === c0 + 1, 'беженца взяли — поселенцев +1');
  const inc = [];
  g.events.on('journey:incident', (e) => inc.push(e.id), 'test');
  J.S.teller.nextIncident = g.time.tick + 1;
  J.S.teller.cd = {};
  run(g, 60);
  ok(inc.length === 1, `рассказчик сам выбрал событие (${inc[0]})`);
  // рейд по расписанию (вместо запасного рассказчика combat)
  let raids = 0;
  g.events.on('combat:raidStarted', () => raids++, 'test');
  J.S.teller.nextRaid = g.time.tick + 1;
  run(g, 60);
  ok(raids === 1, 'рассказчик journey шлёт рейд');
  g.api.combat.debugState().S.autoRaidTick = g.time.tick + 1;
  run(g, 2 * H);
  ok(g.api.combat.debugState().S.autoRaidN === 0, 'запасной рассказчик combat молчит');
  ok(g.errors.length === 0, `без ошибок (${g.errors.map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 5. засада
console.log('5. Засада в пути');
{
  const g = await make(14);
  const J = Jx(g);
  g.api.journey.choose(1, 0);
  ok(g.api.train.depart({ force: true }), 'отправление');
  ok(g.map.biome === 'travel' && g.api.journey.isTravelling() && g.api.journey.isMoving(), 'в пути: карта-полоса, поезд движется');
  ok(g.colonists().every((p) => g.api.train.isAboard(p)), 'все поселенцы в вагонах');
  ok(!g.map.isPassable(g.train.x0 - 2, g.train.railY - 6), 'вокруг поезда — непроходимая насыпь');
  run(g, 600);
  ok(g.colonists().every((p) => g.api.train.isAboard(p)), 'жизнь в вагонах: никто не выпал за борт');
  J.S.leg.ambushAt = J.S.leg.t + 1;
  J.S.leg.ambushDone = false;
  run(g, 4);
  ok(J.S.leg.halt === 'ambush' && !g.api.journey.isMoving(), 'засада: поезд встал');
  ok(terrainCount(g, 'gravel') > 0 && enemies(g).length > 0, `у поезда гравий и враги (${enemies(g).length})`);
  const t0 = J.S.leg.t;
  run(g, 60);
  ok(J.S.leg.t === t0, 'пока бой — перегон не идёт');
  killEnemies(g);
  until(g, () => !J.S.leg?.halt, 2000);
  ok(!J.S.leg.halt && g.api.journey.isMoving(), 'засада отбита — поезд трогается');
  ok(terrainCount(g, 'gravel') === 0 && g.colonists().every((p) => g.api.train.isAboard(p)), 'гравий убран, все на борту');
  ok(g.errors.length === 0, `без ошибок (${g.errors.map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 6. путь через 4 станции до победы
console.log('6. Четыре станции → победа');
{
  const g = await make(15, { difficulty: 'easy' });
  const J = Jx(g);
  const evs = [];
  for (const n of ['journey:departing', 'journey:travelling', 'journey:arriving', 'journey:arrived', 'station:changed', 'game:victory'])
    g.events.on(n, (e) => evs.push([n, e]), 'test');
  const route = g.api.journey.getRoute();
  const seenBiomes = new Set();
  const seenTypes = new Set();
  for (let step = 1; step <= 4; step++) {
    const idx = route.steps[step - 1].findIndex((o) => !seenTypes.has(o.type));
    const pick = idx < 0 ? 0 : idx;
    const opt = route.steps[step - 1][pick];
    ok(g.api.journey.choose(step, pick), `шаг ${step}: выбран «${opt.type}»`);
    if (g.api.train.fuelUnits() < 60) addCoal(g, 60);
    // метка в вагоне-складе: должна доехать
    const store = g.train.carOfType('storage');
    const sc = g.train.interior(store).find((c) => !g.items.itemAt(c.x, c.y)) || g.train.interior(store)[0];
    g.items.spawn('cloth', 3, sc.x, sc.y);
    const cloth0 = g.items.count('cloth');
    // гудок из кабины → посадка → отправление
    const L = g.getLeader();
    if (L) {
      const lr = g.train.locomotive.rect;
      g.entities.setPosition(L, lr.x + 2.5, lr.y + 3.5);
    }
    ok(g.api.train.startBoarding(), `шаг ${step}: посадка`);
    until(g, () => J.S.phase === 'travel', 2400, true);
    ok(J.S.phase === 'travel' && g.map.biome === 'travel', `шаг ${step}: поезд в пути`);
    const colon = g.colonists().length;
    const k = until(g, () => J.S.phase !== 'travel', 12000, true);
    ok(J.S.phase === 'station' && J.S.step === step, `шаг ${step}: прибыли (${k} тиков, перегон ${(J.S.stats.legs && route.legs[step - 1]) / 60 | 0} с)`);
    ok(g.map.biome === opt.biome, `шаг ${step}: карта по биому «${g.map.biome}»`);
    ok(g.colonists().length >= Math.max(0, colon - 2), `шаг ${step}: поселенцы доехали (${g.colonists().length})`);
    ok(g.items.count('cloth') >= cloth0, `шаг ${step}: вещи в вагонах доехали`);
    seenBiomes.add(g.map.biome);
    seenTypes.add(opt.type);
    if (opt.type === 'village') ok(g.entities.listKind('building').some((b) => b.defId === 'hut_wall'), 'деревня: хижины');
    if (opt.type === 'ruins') ok(g.entities.listKind('building').some((b) => b.defId === 'ruin_wall'), 'руины: развалины');
    if (opt.type === 'ash') ok(g.entities.listKind('building').some((b) => b.defId === 'coal_seam'), 'пустошь: уголь');
    ok(g.entities.listKind('building').some((b) => b.cache || g.defs.buildings.get(b.defId)?.cache), `шаг ${step}: тайник на станции`);
    const left = g.api.journey.getState().rotHoursLeft;
    ok(left > 20, `шаг ${step}: таймер Гнили заново (${left.toFixed(0)} ч)`);
    killEnemies(g);
  }
  ok(seenBiomes.has('forest') && seenBiomes.has('ash'), 'побывали в лесу и пустоши');
  ok(!g.api.journey.canDepart(), 'со станции 4 дальше не уехать');
  // дракон
  ok(Jx(g).S.boss.at - g.time.tick > 5 * H, 'дракон — через несколько часов (время перевязать раны)');
  until(g, () => g.entities.listKind('pawn').some((p) => p.boss?.id === 'bone_dragon'), 7 * H);
  const dragon = g.entities.listKind('pawn').find((p) => p.boss?.id === 'bone_dragon');
  ok(!!dragon, 'Костяной дракон появился');
  if (dragon) g.api.health.kill(dragon, 'test', {});
  killEnemies(g);
  run(g, 200);
  const vic = evs.find(([n]) => n === 'game:victory');
  ok(!!vic && vic[1].ending && vic[1].stats?.legs === 4, `событие game:victory (${JSON.stringify(vic?.[1]?.stats)})`);
  ok(g.api.journey.getState().victory && g.api.journey.getState().phase === 'ended', 'игра окончена победой');
  const order = evs.filter(([n]) => n !== 'game:victory').slice(0, 5).map(([n]) => n).join(' → ');
  ok(order === 'journey:departing → station:changed → journey:travelling → journey:arriving → station:changed', `порядок событий (${order})`);
  ok(evs.filter(([n]) => n === 'journey:arrived').length === 4, 'прибытий: 4');
  run(g, 2 * H);
  ok(evs.filter(([n]) => n === 'game:victory').length === 1, 'победа — один раз');
  ok(g.errors.length === 0, `без ошибок (${g.errors.slice(0, 3).map((e) => `${e.where}: ${e.message}`)})`);
}

// ---------------------------------------------------------------- 7. сохранение посреди перегона
console.log('7. Сохранение');
{
  const g = await make(16);
  g.api.journey.choose(1, 1);
  g.api.train.depart({ force: true });
  run(g, 700);
  const J = Jx(g);
  const t = J.S.leg.t;
  const json = g.save.toJSON();
  const g2 = await createGame({ headless: true, seed: 1 });
  g2.save.fromJSON(json);
  const J2 = Jx(g2);
  ok(J2.S.phase === 'travel' && J2.S.leg.t === t && J2.S.choice[0] === 1, 'фаза, ход перегона и выбор сохраняются');
  ok(JSON.stringify(J2.S.route) === JSON.stringify(J.S.route), 'маршрут сохраняется');
  ok(g2.map.biome === 'travel' && g2.colonists().every((p) => g2.api.train.isAboard(p)), 'после загрузки — в пути, все в вагонах');
  until(g2, () => J2.S.phase !== 'travel', 8000, true);
  ok(J2.S.phase === 'station' && J2.S.step === 1, 'после загрузки поезд доехал');
  ok(g2.errors.length === 0 && g.errors.length === 0, `без ошибок (${[...g.errors, ...g2.errors].map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 8. лидер игрока: голод и усталость
console.log('8. Лидер: голод и усталость');
{
  const g = await make(17);
  g.systems.setEnabled('combat', false);
  const L = g.getLeader();
  ok(L.controlled === 'player', 'лидер под управлением игрока');
  L.needs.food = 0.22;
  run(g, 400);
  ok(g.log.some((l) => l.text === g.t('journey.leader.hungry', { name: L.name })), 'предупреждение «лидер голоден»');
  ok(g.ui.hud.has('journey:leaderNeeds'), 'HUD-подсказка о голоде');
  ok(L.needs.food > 0.5 || ['eat', 'mind_eat'].includes(L.job?.type), `стоит без дела — сам поел (${L.needs.food.toFixed(2)}, ${L.job?.type})`);
  L.needs.rest = 0.15;
  run(g, 600);
  ok(g.log.some((l) => l.text === g.t('journey.leader.tired', { name: L.name })), 'предупреждение «лидер устал»');
  ok(L.job?.type === 'sleep' || L.asleep || L.needs.rest > 0.3, `стоит без дела — прилёг (${L.job?.type})`);
  ok(g.errors.length === 0, `без ошибок (${g.errors.map((e) => e.message)})`);
}

console.log(`${checks - fails}/${checks} проверок`);
if (fails) {
  console.error(`✗ FAIL: ${fails}`);
  process.exitCode = 1;
} else console.log('✓ PASS');
