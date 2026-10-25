// Тест модуля health (headless): части тела, урон, «упал», последнее дыхание и слова, смерть и «Павшие»,
// горе, наследник и посох, ИИ-лечение и спасение, переноска, похороны и речь, сожжение, хирургия, болезни,
// гниение, сохранение. Запуск: node tests/health.test.mjs
import { createGame, startNewColony } from '../js/core/boot.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../js/core/constants.js';

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
    g.step();
    if (i % 4 === 0) {
      g.frame(1 / 60);
      g.input.endFrame();
    }
  }
};

async function make(seed = 11) {
  const g = await createGame({ headless: true, seed });
  startNewColony(g, { seed, scenarioId: 'standard' });
  g.systems.setEnabled('combat', false); // без рейдов: проверяем медицину в тишине
  const thoughts = [];
  g.provide('mind', { addThought: (p, id, o) => thoughts.push({ p: p?.id, id, mood: o?.mood }) }, 'test');
  g._thoughts = thoughts;
  return g;
}
const H = (g) => g.api.health;
const events = (g, names) => {
  const log = [];
  for (const n of names) g.events.on(n, (e) => log.push([n, e]), 'test');
  return log;
};
const colonist = (g, i = 0) => g.colonists().filter((p) => !p.isLeader)[i];

// ---------------------------------------------------------------- 1. тело и ёмкости
console.log('1. Части тела, ёмкости, урон');
{
  const g = await make();
  const p = colonist(g);
  ok(p.health.conds.length === 0 && H(g).getCapacity(p, 'moving') === 1, 'здоровая пешка: ёмкости 100%');
  ok(g.defs.bodyParts.has('brain') && g.defs.bodyParts.has('toes_r') && g.defs.conditions.has('grey_rot'), 'реестры bodyParts/conditions');
  const log = events(g, ['health:injured', 'health:partLost', 'health:downed']);
  const dealt = H(g).applyDamage(p, 14, { part: 'left_leg', type: 'cut' });
  ok(dealt > 0 && p.health.conds.some((c) => c.id === 'cut' && /_l$/.test(c.part)), 'порез левой ноги');
  ok(H(g).getCapacity(p, 'moving') < 1 && H(g).moveSpeedFactor(p) < 1, 'движение снижено');
  ok(log.some(([n]) => n === 'health:injured'), "событие 'health:injured'");
  run(g, 60);
  ok(p.health.bloodLoss > 0, 'кровопотеря растёт');
  H(g).applyDamage(p, 18, { part: 'right_arm', type: 'blunt' });
  ok(H(g).aimShake(p) > 0, 'aimShake от правой руки');
  H(g).applyDamage(p, 400, { part: 'arm_l', type: 'cut' });
  const lost = log.find(([n]) => n === 'health:partLost');
  ok(lost && lost[1].part && Number.isFinite(lost[1].x) && lost[1].severed, "отсечение: 'health:partLost' {part, x, y, severed}");
  ok(!H(g).canCarry(p), 'без руки нельзя нести');
  ok(['burn', 'stab', 'bite', 'frost', 'rune'].every((t) => {
    const q = colonist(g, 1);
    return H(g).applyDamage(q, 3, { type: t }) > 0;
  }), 'все типы урона применяются');
  const s = H(g).getSummary(p);
  ok(s.ratio < 1 && typeof s.label === 'string' && Array.isArray(s.conditions), 'getSummary');
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message).join('; ')})`);
}

// ---------------------------------------------------------------- 2. мгновенная смерть, «Павшие», горе
console.log('2. Смерть, «Павшие», горе');
{
  const g = await make();
  const p = colonist(g);
  const friend = colonist(g, 1);
  friend.relations = { [p.id]: { kind: 'friend', opinion: 60 } };
  const log = events(g, ['pawn:died', 'health:deathScene']);
  H(g).applyDamage(p, 60, { part: 'brain', type: 'stab' });
  const died = log.find(([n]) => n === 'pawn:died');
  ok(p.dead && died && died[1].cause === 'brain_destroyed', 'удар в мозг — мгновенная смерть');
  const corpse = died[1].corpse;
  ok(corpse && corpse.kind === 'corpse' && corpse.fallenId > 0 && corpse.rot === 0, 'труп с записью «Павших»');
  const rec = H(g).getFallen()[0];
  ok(rec && rec.name === p.name && rec.kind === 'died' && rec.epitaph && rec.story, 'запись: имя, эпитафия, история');
  ok(log.some(([n]) => n === 'health:deathScene'), "событие 'health:deathScene'");
  ok(g._thoughts.some((t) => t.p === friend.id && t.id === 'friend_died') && g._thoughts.some((t) => t.id === 'colonist_died'), 'горе: друг и вся колония');
  ok(g.log.some((l) => l.text.includes(p.name)), 'запись в журнале');
}

// ---------------------------------------------------------------- 3. последнее дыхание и последние слова
console.log('3. Последнее дыхание, последние слова, стабилизация');
{
  const g = await make();
  const L = g.getLeader();
  const p = colonist(g);
  const log = events(g, ['health:lastBreath', 'health:lastWords', 'pawn:died']);
  g.setSpeed(3);
  p.health.bloodLoss = 1.05;
  H(g).applyDamage(p, 1, { part: 'leg_l', type: 'blunt' });
  ok(p.dying && p.downed && p.pose === 'dying' && !p.dead, 'кровопотеря → последнее дыхание, а не смерть');
  ok(log.some(([n]) => n === 'health:lastBreath') && g.speed === 1, "'health:lastBreath' и скорость 1×");
  const mem0 = H(g).getMemory();
  g.entities.setPosition(L, p.x + 1, p.y);
  const text = H(g).hearLastWords(L, p);
  ok(typeof text === 'string' && text.length > 5 && p.dying.heard, `последние слова: «${text}»`);
  ok(H(g).getMemory() === mem0 + 4, 'Память +4');
  run(g, 400);
  ok(p.dead && H(g).getFallen().find((r) => r.pawnId === p.id)?.lastWordsHeard, 'умер, слова услышаны (запись)');
  ok(g._thoughts.some((t) => t.id === 'last_words_heard') || g.colonists().every((o) => !o.relations?.[p.id]), 'близкие: «Услышали последние слова»');
  // никто не услышал
  for (const o of g.colonists()) o.workPriorities.doctoring = 0;
  const memLog = events(g, ['health:memoryChanged']);
  const q = colonist(g, 0);
  q.health.bloodLoss = 1.05;
  H(g).applyDamage(q, 1, { part: 'leg_r', type: 'blunt' });
  g.entities.setPosition(g.getLeader(), Math.max(1, q.x - 30), q.y);
  for (const o of g.colonists()) if (o !== q && Math.hypot(o.x - q.x, o.y - q.y) < 4) g.entities.setPosition(o, Math.max(1, q.x - 25), q.y);
  run(g, 2500);
  ok(q.dead && memLog.some(([, e]) => e.reason === 'missed_last_words' && e.delta === -2), 'никто не услышал: смерть, Память −2');
  ok(g.log.some((l) => /Никто не услышал/.test(l.text)), 'журнал: «Никто не услышал последних слов …»');
  // стабилизация
  const r = colonist(g, 0);
  r.health.bloodLoss = 1.05;
  H(g).applyDamage(r, 1, { part: 'foot_l', type: 'blunt' });
  ok(r.dying && H(g).stabilize(r) && !r.dying && r.downed && !r.dead, 'стабилизация: снова просто «упал»');
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message).join('; ')})`);
}

// ---------------------------------------------------------------- 4. ИИ: спасение и перевязка
console.log('4. Врачи: спасение, перевязка, кормление');
{
  const g = await make(12);
  const p = colonist(g);
  const log = events(g, ['health:tended', 'health:carryEnded', 'health:downed']);
  g.entities.setPosition(p, p.x, Math.max(2, g.train.railY - 9));
  H(g).applyDamage(p, 33, { part: 'leg_l', type: 'cut' });
  H(g).applyDamage(p, 33, { part: 'leg_r', type: 'cut' });
  ok(p.downed, `упал (${p.downedReason})`);
  run(g, TICKS_PER_HOUR * 4);
  ok(log.some(([n, e]) => n === 'health:carryEnded' && e.target === p && e.reason === 'rescue'), 'раненого отнесли в вагон');
  ok(log.some(([n, e]) => n === 'health:tended' && e.patient === p), 'раненого перевязали');
  ok(H(g).tendNeed(p) === 0 && !p.dead, 'все раны обработаны, жив');
  const roof = g.map.roof[g.map.idx(Math.floor(p.x), Math.floor(p.y))];
  ok(roof > 0, 'лежит под крышей вагона');
  p.needs.food = 0.1;
  run(g, TICKS_PER_HOUR * 3);
  ok(p.needs.food > 0.1 || !p.downed, 'лежачего покормили (или он встал)');
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message).join('; ')})`);
}

// ---------------------------------------------------------------- 5. переноска (E лидера)
console.log('5. Переноска');
{
  const g = await make();
  const L = g.getLeader();
  const p = colonist(g);
  H(g).applyDamage(p, 30, { part: 'leg_l', type: 'blunt' });
  H(g).applyDamage(p, 30, { part: 'leg_r', type: 'blunt' });
  if (!p.downed) H(g).applyDamage(p, 30, { part: 'torso', type: 'blunt' });
  g.entities.setPosition(L, p.x + 1, p.y);
  ok(H(g).startCarry(L, p) && H(g).isCarrying(L) && p.pose === 'carried' && L.pose === 'carry', 'лидер поднял раненого');
  ok(H(g).moveSpeedFactor(L) <= 0.6 + 1e-6, 'скорость с ношей ×0.6');
  g.entities.setPosition(L, L.x + 3, L.y);
  run(g, 2);
  ok(Math.abs(p.x - L.x) < 0.1, 'ноша следует за несущим');
  H(g).applyDamage(L, 12, { part: 'torso', type: 'blunt' });
  ok(!H(g).isCarrying(L) && !p.carriedById, 'удар ≥10 роняет ношу');
  // интеракция E на трупе
  const rec = H(g).createFallen({ name: 'Гаврила Тестов', age: 41, cause: 'fever' }, { corpse: true, x: Math.floor(L.x) + 1, y: Math.floor(L.y) });
  ok(rec && rec.corpse && H(g).getFallen().includes(rec), 'createFallen: запись + тело');
  ok(H(g).startCarry(L, rec.corpse) && L.carryCorpseId === rec.corpse.id, 'тело на руках');
  ok(H(g).moveSpeedFactor(L) <= 0.4 + 1e-6, 'тело тащат ×0.4');
  H(g).dropCarry(L);
  ok(!L.carryCorpseId && !rec.corpse.carriedById, 'тело положено');
}

// ---------------------------------------------------------------- 6. наследник, посох, конец игры
console.log('6. Наследник, посох, «colony:lost»');
{
  const g = await make();
  const L = g.getLeader();
  const heir = colonist(g, 2);
  H(g).setHeir(heir);
  ok(H(g).getHeir() === heir && g.colony.heirId === heir.id, 'setHeir/getHeir');
  const log = events(g, ['leader:died', 'leader:changed', 'colony:lost']);
  L.health.bloodLoss = 1.05;
  H(g).applyDamage(L, 1, { part: 'foot_r', type: 'blunt' });
  ok(L.dying && g.getLeader() === L && !g.colony.lost, 'умирающий лидер — не конец игры');
  run(g, 2600);
  ok(L.dead && g.getLeader() === heir && heir.controlled === 'player', 'власть перешла к наследнику');
  ok(log.some(([n, e]) => n === 'leader:died' && e.heir === heir), "'leader:died' {heir}");
  const staff = g.entities.listKind('item').find((i) => i.defId === 'conductor_staff');
  ok(staff && g.colony.objectives?.take_staff, 'посох у тела, цель «Забери посох»');
  ok(g._thoughts.filter((t) => t.id === 'leader_died').length >= 3, 'горе по лидеру у всех');
  heir.markProgress = 0;
  for (let i = 0; i < 3; i++) g.events.emit('journey:arrived', { station: null });
  ok(heir.markProgress === 1 && g.log.some((l) => /Метка проводника/.test(l.text)), 'метка проводника у наследника за 3 прибытия');
  for (const p of g.colonists()) H(g).kill(p, 'test');
  ok(g.colony.lost && log.some(([n]) => n === 'colony:lost'), "'colony:lost' когда никого не осталось");
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message).join('; ')})`);
}

// ---------------------------------------------------------------- 7. похороны, речь, сожжение, вещи на память
console.log('7. Похороны, речь у могилы, сожжение');
{
  const g = await make(13);
  const p = colonist(g);
  const log = events(g, ['health:buried', 'health:funeral']);
  H(g).kill(p, 'fever');
  const mem0 = H(g).getMemory();
  let grave = null;
  for (let h = 0; h < 24 && !grave; h++) {
    run(g, TICKS_PER_HOUR);
    grave = g.entities.listKind('building').find((b) => b.defId === 'grave' && b.occupied);
  }
  ok(grave && grave.name === p.name && grave.epitaph, 'тело похоронено, надгробие с эпитафией');
  ok(!g.entities.listKind('corpse').some((c) => c.pawnId === p.id), 'труп убран в могилу');
  const L = g.getLeader();
  g.entities.setPosition(L, grave.x + 1.5, grave.y + 0.5);
  run(g, 60);
  const opts = H(g).getEulogyOptions();
  ok(opts.length === 3 && opts.every((o) => o.text), 'три варианта надгробной речи');
  ok(H(g).chooseEulogy(0), 'речь выбрана');
  run(g, TICKS_PER_HOUR * 2);
  const fun = log.find(([n]) => n === 'health:funeral');
  ok(fun && fun[1].rite === 'grave' && fun[1].speechId, "'health:funeral' {rite: grave, speechId}");
  ok(H(g).getMemory() >= mem0 + 6, `Память выросла (+6 за речь): ${mem0} → ${H(g).getMemory()}`);
  ok(g._thoughts.some((t) => t.id === 'said_goodbye'), 'мысль «Попрощались»');
  ok(H(g).getFallen()[0].rite === 'grave', 'в «Павших»: похоронен');
  // сожжение
  g.defs.buildings.add({ id: 'firebox', nameKey: 'test.firebox', size: [1, 1], firebox: true, color: '#ff9f43' }, 'test');
  const fb = g.entities.spawn('building', { defId: 'firebox', x: Math.floor(L.x) + 2, y: Math.floor(L.y), rot: 0 });
  const rec = H(g).createFallen({ name: 'Милава Тестова', gender: 'female', age: 30 }, { corpse: true, x: Math.floor(L.x) + 1, y: Math.floor(L.y) });
  H(g).startCarry(L, rec.corpse);
  const cre = events(g, ['health:cremated']);
  ok(H(g).cremate(L, fb) && rec.rite === 'fire' && cre.length === 1 && cre[0][1].heat === 25, 'сожжение в топке (+25 жара в событии)');
  ok(g.entities.listKind('item').some((i) => i.defId === 'urn'), 'урна с прахом');
  ok(g._thoughts.some((t) => t.id === 'he_carries_us'), 'мысль «Он везёт нас дальше»');
  const plaque = H(g).assignPlaque(null, 999);
  ok(plaque && plaque.plaqueId === 999, 'assignPlaque');
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message).join('; ')})`);
}

// ---------------------------------------------------------------- 8. хирургия, протезы, болезни, гниение
console.log('8. Хирургия, болезни, гниение');
{
  const g = await make();
  const p = colonist(g);
  H(g).applyDamage(p, 500, { part: 'leg_l', type: 'cut' });
  run(g, 60);
  H(g).tend(p, 0.9);
  const ops = H(g).availableOps(p);
  const peg = ops.find((o) => o.kind === 'install' && o.item === 'peg_leg');
  ok(peg && peg.part === 'leg_l', 'доступна операция: деревянная нога');
  ok(H(g).installProsthetic(p, 'peg_leg', 'leg_l') && H(g).hasCondition(p, 'peg_leg'), 'протез поставлен');
  ok(H(g).getCapacity(p, 'moving') > 0.5, `движение с протезом ${H(g).getCapacity(p, 'moving').toFixed(2)}`);
  // ИИ-хирург: назначенная операция + протез на складе
  const r = colonist(g, 2);
  H(g).applyDamage(r, 500, { part: 'leg_r', type: 'cut' });
  H(g).tend(r, 0.9);
  const op = H(g).availableOps(r).find((o) => o.item === 'peg_leg');
  g.items.spawn('peg_leg', 1, Math.floor(r.x) + 1, Math.floor(r.y));
  ok(op && H(g).scheduleSurgery(r, op), 'операция назначена');
  run(g, TICKS_PER_HOUR * 6);
  ok(H(g).hasCondition(r, 'peg_leg') || g.log.some((l) => /Операция .* не удалась/.test(l.text)), 'врач провёл операцию');
  const q = colonist(g, 1);
  H(g).addCondition(q, 'infection', { part: 'arm_r', severity: 0.1 });
  run(g, TICKS_PER_DAY / 2);
  ok(q.health.conds.find((c) => c.id === 'infection')?.sev > 0.1, 'заражение растёт без лечения');
  ok(H(g).availableOps(q).some((o) => o.kind === 'amputate' && o.part === 'arm_r'), 'можно ампутировать заражённую руку');
  ok(H(g).amputate(q, 'arm_r') && !H(g).hasCondition(q, 'infection'), 'ампутация убирает заражение');
  ok(H(g).exposeToRot(colonist(g, 2), 0.1) && H(g).hasCondition(colonist(g, 2), 'grey_rot'), 'Серая гниль');
  for (const o of g.colonists()) o.workPriorities.hauling = 0;
  const rec = H(g).createFallen({ name: 'Тихон Старый', age: 70 }, { corpse: true, x: 5, y: 5 });
  run(g, TICKS_PER_DAY * 2);
  ok((rec.corpse.rot ?? 0) > 0.4, `тело гниёт (rot ${rec.corpse.rot?.toFixed(2)})`);
  ok(g.errors.length === 0, `ошибок нет (${g.errors.map((e) => e.message).join('; ')})`);
}

// ---------------------------------------------------------------- 9. сохранение
console.log('9. Сохранение и загрузка');
{
  const g = await make();
  const p = colonist(g);
  H(g).applyDamage(p, 12, { part: 'arm_l', type: 'cut' });
  H(g).kill(colonist(g, 1), 'infection');
  H(g).addMemory(5, 'test');
  const json = g.save.toJSON();
  const g2 = await createGame({ headless: true, seed: 1 });
  g2.save.fromJSON(json);
  const p2 = g2.entities.get(p.id);
  ok(p2 && p2.health.conds.length === p.health.conds.length, 'ранения сохранились');
  ok(H(g2).getFallen().length === 1 && H(g2).getMemory() === H(g).getMemory(), '«Павшие» и Память сохранились');
  run(g2, 600);
  ok(g2.errors.length === 0, 'после загрузки без ошибок');
}

console.log(`\n${checks - fails}/${checks} проверок`);
if (fails) {
  console.error(`✗ FAIL: ${fails}`);
  process.exit(1);
} else console.log('✓ PASS');
