// Тест модуля build (headless, MVP-3): меню и постройки, призрак/проверки размещения, протяжка, поворот, ПКМ,
// чертёж → подноска → стройка, лидер строит удержанием E, двери (обзор), склад Z с фильтром, снос/отмена X
// с возвратом, разрушение рейдом, сохранение. Запуск: node tests/build.test.mjs
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
const frame = (g) => {
  g.frame(1 / 60);
  g.input.endFrame();
};
const run = (g, n) => {
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) frame(g);
    g.step();
  }
};
async function make(seed = 7) {
  const g = await createGame({ headless: true, seed });
  startNewColony(g, { seed });
  g.systems.setEnabled('combat', false); // без рейдов
  g.input.mouse.inside = true;
  return g;
}
const B = (g) => g.api.build;
/** Свободный прямоугольник земли w×h рядом с лидером (без растений, предметов, поезда). */
function freeArea(g, w, h, from = g.getLeader()) {
  const map = g.map;
  const cx = Math.floor(from.x);
  const cy = Math.floor(from.y);
  const good = (x, y) => {
    if (!map.inBounds(x, y)) return false;
    const k = map.idx(x, y);
    return !map.building[k] && !map.plant[k] && !map.roof[k] && map.room[k] === 0 && map.cost[k] > 0 && !g.items.itemAt(x, y) &&
      map.terrainDef(x, y).buildable && !map.floor[k] && !(map.flags[k] & 1) && !g.zones.zoneAt(x, y);
  };
  for (let r = 2; r < 40; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x0 = cx + dx;
        const y0 = cy + dy;
        let all = true;
        for (let j = -1; j <= h && all; j++) for (let i = -1; i <= w && all; i++) if (!good(x0 + i, y0 + j)) all = false;
        if (all && g.pathfinder.canReach(from.x, from.y, x0, y0, true)) return { x: x0, y: y0 };
      }
  return null;
}
const mouseAt = (g, x, y) => g.input.setMouseWorld(x + 0.5, y + 0.5);
/** Протяжка мышью: нажать в (x0,y0), отпустить в (x1,y1). btn 0 — ЛКМ, 2 — ПКМ. */
function drag(g, x0, y0, x1, y1, btn = 0) {
  const code = `Mouse${btn}`;
  mouseAt(g, x0, y0);
  g.input.setKey(code, true);
  frame(g);
  mouseAt(g, x1, y1);
  frame(g);
  g.input.setKey(code, false);
  frame(g);
}
const blueprints = (g) => g.entities.listKind('blueprint');
const onlyLeaderWorks = (g, on) => {
  for (const p of g.colonists()) {
    if (p.isLeader) continue;
    for (const wt of ['construction', 'hauling']) g.jobs.setPriority(p, wt, on ? 0 : 3);
    if (on && p.job) g.jobs.endJob(p, 'cancelled');
  }
};

// ---------------------------------------------------------------- 1. регистрация, меню
console.log('1. Регистрация и меню B');
{
  const g = await make();
  ok(g.modules.includes('build') && g.errors.length === 0, `модуль build подключён без ошибок (${g.errors.map((e) => e.message)})`);
  for (const fn of ['canPlace', 'place', 'deconstruct', 'placeBlueprint', 'destroy', 'setTool']) ok(g.providers.build?.[fn] === 'build', `api.build.${fn} от build`);
  const ids = ['wood_wall', 'stone_wall', 'door_wood', 'bed', 'bedroll', 'table', 'chair', 'torch', 'chest', 'shelf'];
  for (const id of ids) ok(g.defs.buildings.get(id)?.owner === 'build', `постройка ${id}`);
  ok(g.defs.floors.has('wood_floor'), 'пол wood_floor (ядро)');
  const keys = { 'panel:build': 'KeyB', 'build:rotate': 'KeyG', 'build:zones': 'KeyZ', 'build:clear': 'KeyX' };
  for (const [a, k] of Object.entries(keys)) ok(g.input.bindings.get(a)?.keys[0] === k && g.input.bindings.get(a)?.owner === 'build', `клавиша ${k} → ${a}`);
  ok(g.input.conflicts.length === 0, 'нет конфликтов клавиш');
  ok(g.ui.panels.has('build'), 'панель build');
  const { menuItems } = await import('../js/modules/build/ui.js');
  const tab = (t) => menuItems(g, t).map((i) => i.id);
  ok(['wood_wall', 'stone_wall', 'door_wood', 'wood_floor'].every((id) => tab('walls').includes(id)), `«Стены и двери»: ${tab('walls')}`);
  ok(['bed', 'bedroll', 'table', 'chair'].every((id) => tab('furniture').includes(id)), `«Мебель»: ${tab('furniture')}`);
  ok(tab('light').includes('torch'), `«Свет»: ${tab('light')}`);
  ok(['chest', 'shelf'].every((id) => tab('storage').includes(id)), `«Склад»: ${tab('storage')}`);
  ok(!['rune_turret', 'spike_trap', 'grave'].some((id) => [...tab('walls'), ...tab('furniture'), ...tab('light'), ...tab('storage')].includes(id)), 'лишнего (турели, ловушки, могилы) в меню нет');
  g.input.tap('KeyB');
  frame(g);
  ok(g.ui.isOpen('build') && B(g).getTool().mode === 'place', 'B открывает меню');
  g.i18n.setLang?.('en');
  ok(g.t('build.b.door_wood') === 'Door' || g.i18n.tables.en['build.b.door_wood'] === 'Door', 'строки en');
  ok(g.i18n.tables.ru['build.tab.walls'] === 'Стены и двери', 'строки ru');
}

// ---------------------------------------------------------------- 2. размещение: призрак, протяжка, поворот, ПКМ
console.log('2. Размещение: проверки, протяжка линией, поворот G, ПКМ');
{
  const g = await make();
  const A = freeArea(g, 8, 6);
  ok(!!A, 'нашлось место');
  const { x, y } = A;
  ok(B(g).canPlace('wood_wall', x, y), 'canPlace на свободной земле');
  const car = g.train.cars[0].rect;
  ok(!B(g).canPlace('wood_wall', car.x, car.y), 'нельзя на обшивку вагона');
  ok(!B(g).canPlace('wood_wall', 5, g.train.railY), 'нельзя на рельсы');
  // протяжка стены линией через ввод
  B(g).setTool('place', { id: 'wood_wall' });
  drag(g, x, y, x + 4, y + 1); // главная ось — X
  let bps = blueprints(g);
  ok(bps.length === 5 && bps.every((b) => b.y === y && b.buildDefId === 'wood_wall'), `линия стен: 5 чертежей по X (${bps.length})`);
  ok(B(g).blueprintAt(x + 2, y)?.kind === 'blueprint', 'blueprintAt');
  ok(!B(g).placeBlueprint('wood_wall', x + 1, y), 'второй чертёж на ту же клетку — нельзя');
  // атака посохом не срабатывает в режиме стройки
  let attacks = 0;
  g.events.on('player:attack', () => attacks++, 'test');
  drag(g, x, y + 2, x, y + 2);
  ok(attacks === 0, 'ЛКМ в режиме стройки не бьёт посохом');
  ok(blueprints(g).length === 6, 'одиночная стена');
  // поворот кровати G
  B(g).setTool('place', { id: 'bed', rot: 0 });
  g.input.tap('KeyG');
  frame(g);
  ok(B(g).getTool().rot === 1, 'G поворачивает');
  drag(g, x + 4, y + 4, x + 4, y + 4);
  const bed = blueprints(g).find((b) => b.buildDefId === 'bed');
  ok(bed && bed.w === 2 && bed.h === 1 && bed.rot === 1, `кровать повёрнута 2×1 (${bed?.w}×${bed?.h})`);
  // ПКМ по чертежу — отмена; ПКМ мимо — снять выбор
  const n0 = blueprints(g).length;
  mouseAt(g, x + 4, y + 4);
  g.input.tap('Mouse2');
  frame(g);
  ok(blueprints(g).length === n0 - 1 && !blueprints(g).some((b) => b.buildDefId === 'bed'), 'ПКМ по чертежу — отмена');
  mouseAt(g, x + 7, y + 5);
  g.input.tap('Mouse2');
  frame(g);
  ok(B(g).getTool().id === null, 'ПКМ мимо — снять выбор постройки');
  // пол — прямоугольником
  B(g).setTool('place', { id: 'wood_floor', kind: 'floor' });
  drag(g, x, y + 4, x + 2, y + 5);
  ok(blueprints(g).filter((b) => b.layer === 'floor').length === 6, 'пол прямоугольником 3×2');
  // дерево под чертежом — пометка рубки
  const tree = g.entities.listKind('plant').find((p) => g.defs.plants.get(p.defId)?.choppable && !g.map.roof[g.map.idx(p.x, p.y)] && !g.map.buildingAt(p.x, p.y));
  if (tree) {
    const bp = B(g).placeBlueprint('wood_wall', tree.x, tree.y);
    ok(bp && g.designations.get('chop', tree.x, tree.y), 'дерево под чертежом помечено к рубке');
  }
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 3. чертёж → подноска → стройка
console.log('3. Поселенцы приносят материалы и строят: стена, дверь, кровать, факел, стул');
{
  const g = await make();
  const A = freeArea(g, 8, 6);
  const { x, y } = A;
  const wood0 = g.items.count('wood');
  const done = [];
  const delivered = [];
  g.events.on('build:completed', (e) => done.push(e.entity.defId), 'test');
  g.events.on('build:delivered', (e) => delivered.push(e), 'test');
  for (let i = 0; i < 3; i++) B(g).placeBlueprint('wood_wall', x + i, y);
  B(g).placeBlueprint('door_wood', x + 3, y);
  B(g).placeBlueprint('bed', x + 1, y + 2);
  B(g).placeBlueprint('torch', x + 4, y + 2);
  B(g).placeBlueprint('chair', x + 5, y + 2);
  B(g).placeBlueprint('table', x + 5, y + 4);
  const need = 3 * 5 + 6 + 20 + 4 + 6 + 18;
  run(g, 10 * H);
  ok(delivered.length > 0 && delivered.some((d) => !d.pawn.isLeader), `носильщики приносили материалы (${delivered.length})`);
  ok(blueprints(g).length === 0, `все чертежи построены (осталось ${blueprints(g).length})`);
  for (const id of ['wood_wall', 'door_wood', 'bed', 'torch', 'chair', 'table']) ok(done.includes(id), `построено: ${id}`);
  const wall = g.map.buildingAt(x, y);
  ok(wall?.defId === 'wood_wall' && g.map.cost[g.map.idx(x, y)] === 0 && g.map.blocksVision[g.map.idx(x, y)] === 1, 'стена непроходима и закрывает обзор');
  ok(g.map.buildingAt(x + 1, y + 3)?.defId === 'bed', 'кровать 1×2 на месте');
  ok(wood0 - g.items.count('wood') === need, `дерево потрачено ровно (${wood0 - g.items.count('wood')} из ${need})`);
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 4. лидер строит сам (E)
console.log('4. Лидер: E — принести материалы, удерживать E — строить');
{
  const g = await make();
  onlyLeaderWorks(g, true);
  const L = g.getLeader();
  const A = freeArea(g, 3, 3);
  const bp = B(g).placeBlueprint('stone_wall', A.x, A.y);
  const I = g.defs.interactions.get('build:construct');
  let h = I.find(g, L, bp.x, bp.y);
  ok(h && !h.hold && /Принести|Fetch/.test(h.label), `подсказка «принести» (${h?.label})`);
  h.run(g, L);
  ok(L.job?.type === 'build_deliver', 'лидер пошёл за камнем');
  run(g, 3 * H);
  ok(B(g).needs(bp) === null, `камень принесён (${JSON.stringify(bp.delivered)})`);
  h = I.find(g, L, bp.x, bp.y);
  ok(h?.hold, `подсказка «строить — держите» (${h?.label})`);
  h.onHoldStart(g, L);
  ok(L.job?.type === 'build_construct' && L.job.manual, 'удержание E — ручная стройка');
  run(g, H);
  ok(g.map.buildingAt(bp.x, bp.y)?.defId === 'stone_wall' && blueprints(g).length === 0, 'лидер достроил стену');
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 5. двери
console.log('5. Дверь открывается при пешке, закрытая блокирует обзор');
{
  const g = await make();
  const A = freeArea(g, 5, 5);
  const { x, y } = A;
  // коридор: стены слева/справа от двери
  B(g).place('wood_wall', x, y + 2);
  const door = B(g).place('door_wood', x + 1, y + 2);
  B(g).place('wood_wall', x + 2, y + 2);
  const k = g.map.idx(door.x, door.y);
  for (const p of g.colonists()) {
    if (p.job) g.jobs.endJob(p, 'cancelled');
    g.entities.setPosition(p, x + 4.5, y + 6.5);
    p.controlled = p.isLeader ? p.controlled : 'player'; // не уходят сами
  }
  run(g, 8);
  ok(!door.open && g.map.blocksVision[k] === 1 && g.map.blocksLight[k] === 1, 'закрытая дверь блокирует обзор и свет');
  ok(g.map.cost[k] > 0, 'дверь проходима');
  const p = g.colonists().find((c) => !c.isLeader);
  g.entities.setPosition(p, door.x + 0.5, door.y - 0.4);
  run(g, 8);
  ok(door.open && g.map.blocksVision[k] === 0, 'пешка рядом — дверь открыта, обзор свободен');
  g.map.touch(door.x, door.y); // ядро пересчитало клетку — дверь должна остаться открытой
  ok(g.map.blocksVision[k] === 0, 'после map:changed открытая дверь не закрывает обзор');
  g.entities.setPosition(p, x + 4.5, y + 6.5);
  run(g, 8);
  ok(!door.open && g.map.blocksVision[k] === 1, 'пешка ушла — дверь закрылась');
  const path = g.pathfinder.findPath(door.x, door.y - 1, door.x, door.y + 1);
  ok(path && path.some((c) => c.x === door.x && c.y === door.y), 'путь проходит через дверь');
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 6. склад Z с фильтром
console.log('6. Зона склада (Z) и фильтр');
{
  const g = await make();
  const A = freeArea(g, 6, 4);
  const { x, y } = A;
  g.input.tap('KeyZ');
  frame(g);
  ok(B(g).getTool().mode === 'zone', 'Z — режим зон');
  drag(g, x, y, x + 2, y + 1);
  const z = g.zones.zoneAt(x, y);
  ok(z && z.type === 'stockpile' && z.cells.length === 6 && z.data?.build, `склад 3×2 (${z?.cells.length})`);
  drag(g, x + 3, y, x + 3, y + 1); // продолжение с соседней клетки — новая зона
  drag(g, x + 2, y, x + 4, y); // начато в своей зоне — дописать
  ok(z.cells.length >= 7, `зона расширена (${z.cells.length})`);
  B(g).setZoneFilter(z, 'food');
  ok(z.filter?.categories?.includes('food') && g.zones.accepts(z, 'berries') && !g.zones.accepts(z, 'wood'), 'фильтр «Еда»: ягоды да, дерево нет');
  B(g).setZoneFilter(z, 'all');
  ok(g.zones.accepts(z, 'wood'), 'фильтр «Всё»');
  drag(g, x, y, x, y + 1, 2);
  ok(!g.zones.zoneAt(x, y) && z.cells.length >= 5, 'ПКМ стирает клетки зоны');
  // склад принимает вещи: носильщик кладёт дерево
  B(g).setZoneFilter(z, 'resources');
  z.priority = 4; // важнее склада поезда
  g.items.spawn('wood', 10, x + 8, y + 3);
  run(g, 4 * H);
  const stored = g.entities.listKind('item').filter((i) => i.defId === 'wood' && g.zones.zoneAt(i.x, i.y)?.id === z.id);
  ok(stored.length > 0, 'носильщики несут ресурсы на новый склад');
  g.input.tap('Escape');
  frame(g);
  ok(B(g).getTool().mode === null, 'Esc — выход из режима');
  // сундук сам заводит склад
  const ch = B(g).place('chest', x + 6, y + 3);
  ok(ch && g.zones.isStorage(g.zones.zoneAt(ch.x, ch.y)), 'ящик — клетка склада');
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 7. снос / отмена (X)
console.log('7. Снос и отмена (X) с возвратом материалов');
{
  const g = await make();
  const A = freeArea(g, 6, 4);
  const { x, y } = A;
  // чертёж с принесённым — отмена возвращает всё
  const bp = B(g).placeBlueprint('bed', x, y);
  bp.delivered = { wood: 12 };
  const w0 = g.items.count('wood');
  g.input.tap('KeyX');
  frame(g);
  ok(B(g).getTool().mode === 'clear', 'X — режим сноса');
  drag(g, x, y, x, y);
  ok(bp.removed && g.items.count('wood') - w0 === 12, `отмена чертежа: возврат 12 дерева (${g.items.count('wood') - w0})`);
  // готовая стена — пометка сноса, поселенцы разбирают, возврат половины
  const wall = B(g).place('wood_wall', x + 2, y);
  const table = B(g).place('table', x + 3, y + 2);
  drag(g, x + 2, y, x + 3, y + 2);
  ok(g.designations.get('deconstruct', wall.x, wall.y) && g.designations.get('deconstruct', table.x, table.y), 'стена и стол помечены к сносу');
  drag(g, x + 3, y + 2, x + 3, y + 2, 2);
  ok(!g.designations.get('deconstruct', table.x, table.y), 'ПКМ снимает пометку сноса');
  const w1 = g.items.count('wood');
  const refunds = [];
  g.events.on('build:deconstructed', (e) => refunds.push(e.refund), 'test');
  run(g, 4 * H);
  ok(wall.removed && !g.map.buildingAt(x + 2, y), 'стену разобрали');
  ok(refunds[0]?.wood === 2 && g.items.count('wood') - w1 === 2, `возврат части материалов: 2 из 5 (${JSON.stringify(refunds[0])})`);
  ok(!table.removed, 'стол без пометки цел');
  ok(B(g).deconstruct(table) && g.items.count('wood') - w1 === 2 + 9, 'api.deconstruct — сразу, половина (9 из 18)');
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 8. прочность: рейды ломают
console.log('8. Прочность: урон от combat разрушает постройку');
{
  const g = await make();
  const A = freeArea(g, 4, 3);
  const wall = B(g).place('stone_wall', A.x, A.y);
  ok(wall.hp === undefined || wall.hp === 480, 'прочность каменной стены 480');
  g.api.combat.damage(wall, 100, { source: null });
  ok(!wall.removed && wall.hp === 380, `урон снижает прочность (${wall.hp})`);
  let destroyed = null;
  g.events.on('build:destroyed', (e) => (destroyed = e), 'test');
  const s0 = g.items.count('stone');
  g.api.combat.damage(wall, 1000, { source: null });
  ok(wall.removed && destroyed && !g.map.buildingAt(A.x, A.y), 'стена разрушена');
  ok(g.items.count('stone') - s0 === 1, `обломки: четверть материалов (${g.items.count('stone') - s0})`);
  ok(g.map.cost[g.map.idx(A.x, A.y)] > 0, 'клетка снова проходима');
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message)})`);
}

// ---------------------------------------------------------------- 9. сохранение
console.log('9. Сохранение: чертежи, принесённое, двери, склады');
{
  const g = await make();
  const A = freeArea(g, 5, 4);
  const bp = B(g).placeBlueprint('bed', A.x, A.y);
  bp.delivered = { wood: 7 };
  bp.work = 0;
  const door = B(g).place('door_wood', A.x + 3, A.y);
  B(g).setTool('zone');
  drag(g, A.x, A.y + 3, A.x + 1, A.y + 3);
  B(g).setZoneFilter(g.zones.zoneAt(A.x, A.y + 3), 'food');
  const json = g.save.toJSON();
  const h = await make(8);
  h.save.fromJSON(json);
  const bp2 = h.entities.listKind('blueprint')[0];
  ok(bp2 && bp2.buildDefId === 'bed' && bp2.delivered.wood === 7, 'чертёж и принесённое сохранились');
  ok(h.api.build.blueprintAt(A.x, A.y + 1)?.id === bp2.id, 'индекс чертежей восстановлен');
  ok(!h.api.build.placeBlueprint('wood_wall', A.x, A.y), 'на клетку чертежа после загрузки ставить нельзя');
  const d2 = h.map.buildingAt(door.x, door.y);
  ok(d2?.defId === 'door_wood', 'дверь сохранилась');
  const z2 = h.zones.zoneAt(A.x, A.y + 3);
  ok(z2?.data?.build && z2.filter?.categories?.includes('food'), 'склад и фильтр сохранились');
  run(h, 6 * H);
  ok(h.map.buildingAt(A.x, A.y)?.defId === 'bed', 'после загрузки кровать достроили');
  ok(h.errors.length === 0 && g.errors.length === 0, `ошибок нет (${[...g.errors, ...h.errors].map((e) => e.message)})`);
}

console.log(`\n${checks - fails}/${checks} проверок`);
if (fails) {
  console.error(`✗ FAIL: ${fails}`);
  process.exit(1);
}
console.log('✓ PASS');
