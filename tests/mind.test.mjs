// Тест модуля mind (headless, MVP-2): потребности, мысли и id других модулей, настроение и срывы, черты,
// навыки, биографии, разговоры, карточка, авторитет, сохранение. Запуск: node tests/mind.test.mjs
import { createGame, startNewColony } from '../js/core/boot.js';
import { TICKS_PER_HOUR as H, TICKS_PER_DAY as DAY } from '../js/core/constants.js';
import { createPawn } from '../js/sim/pawn.js';
import { RNG } from '../js/core/rng.js';

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
async function make(seed = 5) {
  const g = await createGame({ headless: true, seed });
  startNewColony(g, { seed });
  g.systems.setEnabled('combat', false); // без рейдов
  return g;
}
const M = (g) => g.api.mind;
const ai = (g) => g.colonists().filter((p) => !p.isLeader && p.controlled !== 'player');
const events = (g, names) => {
  const log = [];
  for (const n of names) g.events.on(n, (e) => log.push([n, e]), 'test');
  return log;
};
const free = (g, p) => {
  if (p.job) g.jobs.endJob(p, 'cancelled');
};
/** Свободная проходимая клетка вагона (по типу). */
function carCell(g, type, dx = 0) {
  const car = g.train.cars.find((c) => c.type === type) || g.train.cars[0];
  const r = car.rect;
  for (let y = r.y + 1; y < r.y + r.h - 1; y++)
    for (let x = r.x + 2 + dx; x < r.x + r.w - 1; x++) if (g.map.isPassable(x, y) && !g.map.buildingAt(x, y) && !g.items.itemAt(x, y)) return { x, y };
  return null;
}

// ---------------------------------------------------------------- 1. реестры, id мыслей других модулей
console.log('1. Реестры и мысли других модулей');
{
  const g = await make();
  ok(g.modules.includes('mind') && g.providers.mind?.addThought === 'mind', 'модуль mind подключён и предоставляет addThought');
  ok(g.defs.thoughts.size >= 15, `мыслей ≥ 15 (${g.defs.thoughts.size})`);
  ok(g.defs.traits.size >= 15, `черт ≥ 15 (${g.defs.traits.size})`);
  ok(g.defs.skills.size === 12 && g.defs.workTypes.all().every((w) => !w.skill || g.defs.skills.has(w.skill)), 'навыки: 12, все workTypes[].skill есть');
  const ids = [
    // ядро
    'ate_raw', 'ate_meal', 'ate_ration', 'slept_on_floor', 'slept_in_bed', 'hungry', 'starving', 'exhausted',
    // health
    'friend_died', 'lover_died', 'family_died', 'rival_died', 'colonist_died', 'leader_died', 'saw_corpse', 'saw_corpse_enemy',
    'smelled_corpse', 'not_buried', 'buried_properly', 'last_words_heard', 'nobody_heard', 'said_goodbye', 'cremated_horror',
    'he_carries_us', 'eulogy_moved', 'eulogy_angry', 'in_pain', 'lost_limb', 'keepsake_comfort', 'got_prosthetic', 'was_rescued',
    // combat / train
    'prisoner_released', 'execution_justice', 'witnessed_execution', 'recruited_prisoner', 'healed_by_leader', 'named_weapon',
    'was_puppet', 'called_by_name', 'humiliated', 'leader_stoked',
    // свои MVP
    'ate_at_table', 'ate_without_table', 'good_chat', 'argued', 'insulted', 'catharsis', 'saw_breakdown',
  ];
  const missing = ids.filter((id) => !g.defs.thoughts.has(id));
  ok(missing.length === 0, `все id мыслей ядра/health/combat зарегистрированы${missing.length ? `: нет ${missing.join(', ')}` : ''}`);
  const keyless = g.defs.thoughts.all().filter((d) => !g.i18n.has(d.nameKey));
  ok(keyless.length === 0, `у всех мыслей есть подпись ru${keyless.length ? `: ${keyless.map((d) => d.id).join(', ')}` : ''}`);
  g.i18n.lang = 'en';
  ok(g.t('mind.thought.good_chat') === 'Nice chat' && g.t('mind.break.cry') !== 'mind.break.cry', 'строки en');
  g.i18n.lang = 'ru';
  ok(g.systems.get('needs')?.enabled === false && !!g.systems.get('mind:needs'), "система ядра 'needs' выключена, работает 'mind:needs'");
  for (const id of ['eat', 'sleep', 'work', 'mentalBreak', 'joy', 'social']) ok(g.ai.getNode(id)?.owner === 'mind', `узел ИИ '${id}' — mind`);
  ok(g.render.pawnOverlays.has('mind:bubbles'), 'оверлей пузырей mind:bubbles');
}

// ---------------------------------------------------------------- 2. потребности
console.log('2. Потребности');
{
  const g = await make();
  const p = ai(g)[0];
  const n = p.needs;
  ok(['food', 'rest', 'joy', 'comfort', 'social'].every((k) => Number.isFinite(n[k]) && n[k] >= 0 && n[k] <= 1), 'еда, сон, отдых, комфорт, общение заданы 0..1');
  // падают со временем (пешку держим в ожидании)
  free(g, p);
  const before = { ...n };
  g.jobs.startJob(p, g.jobs.createJob('wait', p, { data: { ticks: 3 * H } }));
  run(g, 2 * H);
  ok(n.food < before.food && n.joy < before.joy && n.social < before.social, 'еда, отдых и общение падают со временем');
  // голод → идёт есть
  n.food = 0.15;
  free(g, p);
  let ate = false;
  g.events.on('pawn:ate', (e) => {
    if (e.pawn === p) ate = true;
  }, 'test');
  for (let i = 0; i < 40 && !ate; i++) run(g, 60);
  ok(ate && n.food > 0.3, `голодный поел (еда ${n.food.toFixed(2)})`);
  // усталость → спит (на полу — без кроватей)
  const th = events(g, ['mind:thought']);
  n.rest = 0.05;
  free(g, p);
  run(g, 120);
  ok(p.job?.type === 'sleep' || p.asleep, 'уставший пошёл спать');
  for (let i = 0; i < 40 && (p.asleep || p.job?.type === 'sleep'); i++) run(g, 300);
  ok(n.rest > 0.5, `выспался (бодрость ${n.rest.toFixed(2)})`);
  ok(th.some(([, e]) => e.pawn === p && (e.id === 'slept_on_floor' || e.id === 'slept_in_bed')), 'мысль о сне (на полу/в кровати)');
  // скука → отдыхает
  n.joy = 0.1;
  free(g, p);
  run(g, 60);
  ok(p.job?.type === 'mind_joy', `скучающий пошёл отдыхать (${p.job?.type})`);
  const j0 = n.joy;
  run(g, 600);
  ok(n.joy > j0, 'отдых восполняется');
  // одиночество → идёт поговорить
  n.social = 0.1;
  n.joy = 0.9;
  free(g, p);
  run(g, 60);
  ok(p.job?.type === 'mind_talk', `одинокий пошёл поговорить (${p.job?.type})`);
  ok(g.errors.length === 0, `без ошибок (${g.errors.map((e) => e.message || e).join('; ')})`);
}

// ---------------------------------------------------------------- 3. кровать и стол
console.log('3. Кровать, стол, стул');
{
  const g = await make(6);
  g.defs.buildings.add({ id: 'test_bed', bed: true, size: [1, 1], passable: true, pathCost: 1.5, comfort: 0.8, category: 'furniture' }, 'test');
  g.defs.buildings.add({ id: 'test_table', table: true, size: [1, 1], category: 'furniture' }, 'test');
  g.defs.buildings.add({ id: 'test_chair', sittable: true, size: [1, 1], passable: true, comfort: 0.6, category: 'furniture' }, 'test');
  const p = ai(g)[1];
  const c = carCell(g, 'residential');
  const bed = g.api.build.place('test_bed', c.x, c.y, { force: true });
  const k = carCell(g, 'kitchen', 2);
  const table = g.api.build.place('test_table', k.x, k.y, { force: true });
  const chair = g.api.build.place('test_chair', k.x + 1, k.y, { force: true });
  ok(bed && table && chair, 'кровать, стол и стул поставлены');
  const th = events(g, ['mind:thought']);
  free(g, p);
  p.needs.rest = 0.05;
  for (let i = 0; i < 60 && !th.some(([, e]) => e.pawn === p && /^slept_/.test(e.id)); i++) run(g, 300);
  ok(th.some(([, e]) => e.pawn === p && e.id === 'slept_in_bed'), 'спал в кровати → «Выспался в кровати»');
  // еда за столом
  g.items.spawn('ration', 5, k.x - 1, k.y);
  free(g, p);
  p.needs.food = 0.15;
  for (let i = 0; i < 60 && !th.some(([, e]) => e.pawn === p && /^ate_(at|without)/.test(e.id)); i++) run(g, 60);
  ok(th.some(([, e]) => e.pawn === p && e.id === 'ate_at_table'), 'поел за столом → «Поел за столом»');
  ok(g.errors.length === 0, 'без ошибок');
}

// ---------------------------------------------------------------- 4. мысли и настроение
console.log('4. Мысли и настроение');
{
  const g = await make();
  const p = ai(g)[0];
  const mood0 = M(g).getMood(p);
  ok(mood0 > 0 && mood0 < 1, `настроение 0..1 (${mood0.toFixed(2)})`);
  const log = events(g, ['mind:thought']);
  M(g).addThought(p, 'friend_died', { otherPawnId: 999 });
  ok(p.thoughts.some((t) => t.id === 'friend_died') && log.length === 1, "addThought → pawn.thoughts + 'mind:thought'");
  M(g).addThought(p, 'friend_died', { otherPawnId: 999 });
  ok(p.thoughts.filter((t) => t.id === 'friend_died').length === 1, 'та же мысль о том же человеке обновляется, а не дублируется');
  M(g).addThought(p, 'no_such_thought');
  ok(!p.thoughts.some((t) => t.id === 'no_such_thought') && g.errors.length === 0, 'неизвестная мысль без mood пропускается без ошибок');
  M(g).addThought(p, 'adhoc_test', { mood: -3, days: 1 });
  ok(p.thoughts.some((t) => t.id === 'adhoc_test') && g.defs.thoughts.has('adhoc_test'), 'неизвестная мысль с mood регистрируется на лету');
  M(g).addThought(p, 'lover_died', { mood: -20 });
  M(g).addThought(p, 'humiliated');
  run(g, 4 * H);
  const mood1 = M(g).getMood(p);
  ok(mood1 < mood0 - 0.15, `плохие мысли снижают настроение (${mood0.toFixed(2)} → ${mood1.toFixed(2)})`);
  M(g).removeThought(p, 'lover_died');
  M(g).removeThought(p, 'friend_died');
  M(g).removeThought(p, 'humiliated');
  M(g).removeThought(p, 'adhoc_test');
  M(g).addThought(p, 'catharsis');
  run(g, 4 * H);
  ok(M(g).getMood(p) > mood1 + 0.1, 'хорошие мысли поднимают настроение');
  // истечение
  M(g).addThought(p, 'execution_justice');
  ok(p.thoughts.some((t) => t.id === 'execution_justice'), 'мысль добавлена на сутки');
  run(g, DAY + H);
  ok(!p.thoughts.some((t) => t.id === 'execution_justice'), 'мысль истекает по сроку');
  const sheet = M(g).getSheet(p);
  ok(Number.isInteger(sheet.mood) && sheet.mood >= 0 && sheet.mood <= 100, `getSheet: настроение 0..100 (${sheet.mood})`);
}

// ---------------------------------------------------------------- 5. срыв и восстановление
console.log('5. Срыв и восстановление');
{
  const g = await make(7);
  const p = ai(g)[0];
  const log = events(g, ['mind:breakStarted', 'mind:breakEnded']);
  for (const id of ['lover_died', 'humiliated', 'was_puppet', 'nobody_heard', 'insulted']) M(g).addThought(p, id, { mood: -15, days: 3 });
  for (let i = 0; i < 4 * 24 && !M(g).isInBreak(p); i++) run(g, H / 4);
  ok(M(g).isInBreak(p) && log.some(([n]) => n === 'mind:breakStarted'), `при низком настроении — срыв (${p.mindBreak?.kind}, настроение ${(M(g).getMood(p) * 100) | 0})`);
  ok(['sad_wander', 'cry', 'hide_in_room'].includes(p.mindBreak?.kind), 'вид срыва: бродит / плачет / прячется');
  run(g, 60);
  ok(p.job?.type === 'mind_break', `во время срыва — задача mind_break (${p.job?.type})`);
  const obey = M(g).willObey(p, 'goto');
  ok(obey.ok === false && typeof obey.reply === 'string', 'в срыве не слушается приказов');
  for (const id of ['lover_died', 'humiliated', 'was_puppet', 'nobody_heard', 'insulted']) M(g).removeThought(p, id);
  for (let i = 0; i < 40 && M(g).isInBreak(p); i++) run(g, H / 2);
  ok(!M(g).isInBreak(p) && log.some(([n]) => n === 'mind:breakEnded'), 'срыв закончился сам');
  ok(p.thoughts.some((t) => t.id === 'catharsis'), 'после срыва — «Катарсис» (восстановление)');
  run(g, 120);
  ok(p.job?.type !== 'mind_break', 'после срыва — обычные дела');
  // принудительный срыв каждого вида
  const q = ai(g)[1];
  for (const kind of ['sad_wander', 'cry', 'hide_in_room']) {
    M(g).startBreak(q, 'major', kind);
    run(g, 90);
    ok(q.mindBreak?.kind === kind && q.job?.type === 'mind_break', `срыв «${kind}»: задача выполняется`);
    M(g).endBreak(q);
  }
  ok(g.errors.length === 0, 'без ошибок');
}

// ---------------------------------------------------------------- 6. черты и навыки
console.log('6. Черты и навыки');
{
  const g = await make();
  const all = g.colonists();
  ok(all.every((p) => Array.isArray(p.traits) && p.traits.length >= 1 && p.traits.every((t) => g.defs.traits.has(t))), 'у всех поселенцев есть черты из реестра');
  const p = ai(g)[0];
  const keep = p.traits.slice();
  p.traits = ['workaholic'];
  const fw = M(g).skillFactor(p, 'construction');
  p.traits = ['lazy'];
  const fl = M(g).skillFactor(p, 'construction');
  ok(fw > fl * 1.3, `черты влияют числами: трудоголик ${fw.toFixed(2)} > лентяй ${fl.toFixed(2)}`);
  p.traits = ['optimist'];
  run(g, 60);
  const opt = M(g).getSheet(p).thoughts.find((t) => t.id === 'trait_optimist');
  ok(opt && opt.mood > 0, 'оптимист: постоянный плюс к настроению');
  p.traits = keep;
  const L = g.getLeader();
  ok(M(g).skillLevel(L, 'magic') >= 6, 'лидер-маг: магия ≥ 6');
  const s = M(g).getSkill(p, 'mining');
  ok(Number.isFinite(s.level) && Number.isFinite(s.xp) && ['none', 'minor', 'major'].includes(s.passion), 'getSkill → {level, xp, passion}');
  const ups = events(g, ['mind:skillUp']);
  const sk = ['mining', 'construction', 'plants', 'crafting', 'cooking'].find((id) => !M(g).getSkill(p, id).incapable);
  const lv0 = M(g).skillLevel(p, sk);
  M(g).gainXp(p, sk, 5000);
  ok(M(g).skillLevel(p, sk) > lv0 && ups.length > 0, `gainXp поднимает уровень ${sk} (${lv0} → ${M(g).skillLevel(p, sk)}), 'mind:skillUp'`);
  const sk2 = ['cooking', 'plants', 'crafting', 'construction'].find((id) => id !== sk && !M(g).getSkill(p, id).incapable);
  const lv1 = M(g).skillLevel(p, sk2);
  M(g).learn(p, sk2, 3000);
  ok(M(g).skillLevel(p, sk2) > lv1, 'learn (ядро) тоже даёт опыт');
  const wt = g.defs.workTypes.all().find((w) => w.skill === sk)?.id;
  ok(M(g).skillFactor(p, wt) > fl, `высокий навык ускоряет работу (${wt}: ${M(g).skillFactor(p, wt).toFixed(2)})`);
}

// ---------------------------------------------------------------- 7. биографии и кандидаты
console.log('7. Биографии');
{
  const g = await make();
  const p = ai(g)[0];
  const bio = M(g).getBio(p);
  ok(bio && bio.childhood?.title && typeof bio.childhood.title === 'string' && !bio.childhood.title.startsWith('mind.'), `getBio: детство «${bio?.childhood?.title}»`);
  ok(typeof bio.summary === 'string' && Array.isArray(bio.lines), 'getBio: summary и lines');
  ok(typeof bio.lastWords === 'string' && bio.lastWords.length > 5 && !bio.lastWords.startsWith('mind.'), `последние слова: «${bio.lastWords}»`);
  ok(Number.isFinite(p.age) && typeof p.name === 'string', 'имя и возраст');
  const a = M(g).generateCandidate(new RNG('cand'), { role: 'colonist' });
  const b = M(g).generateCandidate(new RNG('cand'), { role: 'colonist' });
  ok(JSON.stringify(a) === JSON.stringify(b) && a.name && a.bio && a.traits.length && Object.keys(a.skills).length === 12, 'generateCandidate детерминирован и полон');
  const r = createPawn(g, { name: 'Тест Тестов', age: 33, x: p.x, y: p.y, faction: 'colony', bio: 'Своя история.', traits: ['optimist'], skills: { cooking: { level: 9 } } });
  ok(r.bio === 'Своя история.' && r.traits.join() === 'optimist' && r.skills.cooking.level === 9 && r.skills.mining, 'roster не перезаписан, недостающее дополнено');
  ok(M(g).getBio(r).summary === 'Своя история.', 'getBio для строки-биографии');
}

// ---------------------------------------------------------------- 8. разговоры
console.log('8. Разговоры');
{
  const g = await make(8);
  const [a, b] = ai(g);
  const log = events(g, ['mind:social']);
  const c = carCell(g, 'residential');
  free(g, a);
  free(g, b);
  g.entities.setPosition(a, c.x + 0.5, c.y + 0.5);
  g.entities.setPosition(b, c.x + 1.5, c.y + 0.5);
  a.needs.social = 0.5;
  b.needs.social = 0.5;
  const s0 = a.needs.social;
  const r = M(g).converse(a, b, { stand: true });
  ok(r && log.length === 1 && log[0][1].a === a && log[0][1].b === b && Array.isArray(log[0][1].glyphs), `беседа: 'mind:social' {a, b, kind, glyphs} (${r?.kind}, ${r?.glyph})`);
  ok(b.job?.type === 'mind_talk', 'собеседник остановился поговорить');
  run(g, 30);
  const facing = Math.abs(Math.atan2(a.y - b.y, a.x - b.x) - b.dir) < 0.2;
  ok(facing && b.pose === 'talk', 'повернулся лицом к собеседнику, поза talk');
  ok(a.needs.social > s0 - 0.01 || r.red, 'общение восполняется');
  // много бесед — изредка ссора (красный пузырь)
  let red = 0;
  let total = 0;
  for (let i = 0; i < 200; i++) {
    const x = M(g).converse(a, b);
    total++;
    if (x.red) red++;
  }
  ok(red > 0 && red < total * 0.4, `ссоры изредка: ${red} из ${total}`);
  // спонтанные беседы рядом
  const n0 = log.length;
  ai(g).forEach((p, i) => {
    free(g, p);
    p.needs.social = 0.4;
    g.entities.setPosition(p, c.x + 0.5 + (i % 2), c.y + 0.5 + (i >> 1));
    g.jobs.startJob(p, g.jobs.createJob('wait', p, { data: { ticks: 3 * H } }));
  });
  run(g, 3 * H);
  ok(log.length > n0, `пешки рядом сами заводят разговор (${log.length - n0} за 3 ч)`);
  ok(g.errors.length === 0, 'без ошибок');
}

// ---------------------------------------------------------------- 9. карточка, авторитет
console.log('9. getSheet, авторитет, послушание');
{
  const g = await make();
  const p = ai(g)[0];
  const s = M(g).getSheet(p);
  ok(s && s.needs.length === 5 && s.skills.length === 12 && s.traits.length >= 1 && Array.isArray(s.thoughts) && s.bio && Array.isArray(s.relations), 'getSheet: нужды, навыки, черты, мысли, биография, отношения');
  ok(s.traits.every((t) => t.label && !t.label.startsWith('mind.')), 'getSheet: подписи черт');
  const log = events(g, ['mind:authorityChanged']);
  const a0 = M(g).getAuthority();
  ok(M(g).addAuthority(500, 'test') === 100 && log.length === 1 && M(g).getAuthority() === 100, 'addAuthority клампит до 100 и шлёт событие');
  M(g).addAuthority(a0 - 100, 'test');
  ok(M(g).getAuthority() === a0, 'getAuthority');
  ok(M(g).willObey(p, 'goto').ok === true, 'willObey: в норме слушается');
}

// ---------------------------------------------------------------- 10. сохранение, 20 дней
console.log('10. Сохранение и долгий прогон');
{
  const g = await make(9);
  run(g, DAY);
  const p = ai(g)[0];
  M(g).startBreak(p, 'minor', 'cry');
  M(g).addThought(p, 'deep_talk');
  const json = g.save.toJSON();
  const g2 = await createGame({ headless: true, seed: 9 });
  g2.save.fromJSON(json);
  const p2 = g2.entities.get(p.id);
  ok(p2 && p2.mindBreak?.kind === 'cry' && p2.thoughts.some((t) => t.id === 'deep_talk') && p2.skills.mining?.level === p.skills.mining.level, 'срыв, мысли и навыки сохраняются');
  run(g2, H * 6);
  ok(g2.errors.length === 0, 'после загрузки — без ошибок');
  // долгий прогон: настроение меняется, беседы идут, ошибок нет
  const ev = events(g, ['mind:social', 'mind:thought']);
  const moods = new Map(ai(g).map((x) => [x.id, x.mood.value]));
  g.systems.setEnabled('combat', true);
  run(g, 4 * DAY);
  ok(ev.some(([n]) => n === 'mind:social') && ev.some(([n]) => n === 'mind:thought'), `за 4 дня: бесед ${ev.filter(([n]) => n === 'mind:social').length}, мыслей ${ev.filter(([n]) => n === 'mind:thought').length}`);
  ok(ai(g).some((x) => Math.abs(x.mood.value - (moods.get(x.id) ?? x.mood.value)) > 0.02), 'настроение меняется');
  const missing = [...(g.i18n.missing || [])].filter((k) => String(k).startsWith('mind.'));
  ok(missing.length === 0, `нет пропущенных строк mind.*${missing.length ? `: ${missing.slice(0, 5).join(', ')}` : ''}`);
  ok(g.errors.length === 0, `без ошибок (${g.errors.slice(0, 3).map((e) => e.message || e).join('; ')})`);
}

console.log('—'.repeat(50));
console.log(`${checks - fails}/${checks} проверок`);
if (fails) {
  console.log(`✗ FAIL: ${fails}`);
  process.exit(1);
}
console.log('✓ PASS');
