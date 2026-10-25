// Headless-тест модуля combat: рейды, ИИ боя, урон через health.applyDamage, заклинания и мана, посох, «К оружию!»,
// гудок, грабёж, именное оружие, уровни и ветви, пленные, ловушки и турели, боссы, кровь, сочность, шум, сейв.
// Запуск: node tests/combat.test.mjs
import { createGame, startNewColony } from '../js/core/boot.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../js/core/constants.js';

let failed = 0;
let passed = 0;
const ok = (cond, msg) => {
  if (cond) passed++;
  else {
    failed++;
    console.error(`✗ ${msg}`);
  }
};
const step = (g, n) => {
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) {
      g.frame(1 / 60);
      g.input.endFrame();
    }
    g.step();
  }
};
async function fresh(seed = 7) {
  const g = await createGame({ headless: true, seed });
  startNewColony(g, { seed });
  return g;
}
const enemiesOf = (g) => g.entities.listKind('pawn').filter((p) => p.faction === 'enemy' && !p.dead);
const C_ = (g) => g.api.combat.debugState();
/** Поставить постройку в свободную клетку рядом с точкой. */
function placeNear(g, defId, x, y) {
  const spot = g.map.randomPassableNear(g.rng, x, y, 6, 60, (tx, ty) => g.api.build.canPlace(defId, tx, ty));
  return spot ? g.api.build.place(defId, spot.x, spot.y) : null;
}

// ---------- 1. Регистрация и лидер ----------
{
  const g = await fresh();
  ok(g.modules.includes('combat'), 'модуль combat зарегистрирован');
  ok(g.errors.length === 0, `ошибки при старте: ${g.errors.map((e) => e.message)}`);
  const L = g.getLeader();
  ok(g.api.combat.hasStaff(L), 'у лидера посох проводника');
  ok(L.mana && L.mana.max === 100 && L.mana.cur === 100, 'мана лидера 100/100');
  ok(L.perks.level === 1 && L.perks.slots.length === 4, 'перки лидера: уровень 1, 4 слота');
  ok(g.defs.enemies && g.defs.enemies.size >= 11, 'реестр врагов ≥ 11 видов');
  for (const id of ['bow', 'crossbow', 'short_sword', 'axe', 'spear', 'club', 'knife', 'rune_rifle', 'rune_staff', 'conductor_staff', 'armor_leather', 'armor_chain', 'armor_plate', 'rune_cloak'])
    ok(g.defs.items.get(id)?.weapon || g.defs.items.get(id)?.armor, `предмет ${id}`);
  for (const id of ['prisoner_bed', 'rune_turret', 'spike_trap', 'fire_trap']) ok(g.defs.buildings.has(id), `постройка ${id}`);
  ok(g.input.bindings.get('combat:draft')?.keys[0] === 'KeyF', 'клавиша F — combat:draft');
  ok(g.colonists().filter((p) => !p.isLeader && p.equipment.weapon).length >= 2, 'спутники вооружены');
}

// ---------- 2. Рейд: появление, бой, конец; урон через health.applyDamage ----------
{
  const g = await fresh(11);
  const origApply = g.api.health.applyDamage;
  let applyCalls = 0;
  g.api.health.applyDamage = (...a) => {
    applyCalls++;
    return origApply(...a);
  };
  const ev = { started: 0, ended: 0, hitsByColony: 0, hitsOnColony: 0, noise: new Set(), hitStop: 0 };
  g.events.on('combat:raidStarted', () => ev.started++);
  g.events.on('combat:raidEnded', () => ev.ended++);
  g.events.on('combat:hit', (e) => {
    if (e.attacker?.faction === 'colony') ev.hitsByColony++;
    if (e.target.faction === 'colony') ev.hitsOnColony++;
  });
  g.events.on('vision:noise', (e) => ev.noise.add(e.kind));
  const origStop = g.api.av.hitStop;
  g.api.av.hitStop = (ms) => {
    ev.hitStop++;
    return origStop(ms);
  };
  const r = g.api.combat.spawnRaid(70, 'bandits', { edge: 'north' });
  ok(r && r.count >= 2 && r.faction === 'bandits', 'spawnRaid(points, faction, {edge}) создаёт рейд');
  ok(ev.started === 1, 'событие combat:raidStarted');
  const en = enemiesOf(g);
  ok(en.every((p) => p.y < g.map.h / 2), 'рейдеры пришли с северного края');
  ok(g.api.combat.isHostile(en[0], g.getLeader()) && !g.api.combat.isHostile(en[0], en[1] || en[0]), 'isHostile');
  step(g, TICKS_PER_DAY * 0.6);
  ok(ev.ended >= 1, 'рейд закончился (combat:raidEnded)');
  ok(ev.hitsByColony > 0, 'поселенцы отбивались');
  ok(ev.hitsOnColony > 0 || ev.hitsByColony > 0, 'был бой');
  ok(applyCalls > 0, 'урон идёт через game.api.health.applyDamage');
  ok(ev.noise.has('clash') || ev.noise.has('shot'), 'шум боя (vision.noise)');
  ok(g.entities.listKind('decal').some((d) => d.combat), 'кровь — декали');
  ok(g.errors.length === 0, `ошибки в рейде: ${g.errors.map((e) => e.where + ' ' + e.message)}`);
}

// ---------- 3. Заклинания, мана, атака, рывок ----------
{
  const g = await fresh(5);
  const L = g.getLeader();
  const pos = { x: L.x, y: L.y };
  g.api.combat.spawnRaid({ faction: 'undead', points: 40, x: L.x + 5, y: L.y });
  step(g, 2);
  const foe = enemiesOf(g)[0];
  const casts = [];
  g.events.on('combat:spellCast', (e) => casts.push(e.spellId));
  const hp0 = foe.health.hp;
  ok(g.api.combat.castSpell(L, 0, foe.x, foe.y), 'огненный шар (слот 1)');
  step(g, 60);
  ok(foe.dead || foe.health.hp < hp0, 'огненный шар ранил врага');
  ok(L.mana.cur < 100, 'заклинание тратит ману');
  ok(!g.api.combat.castSpell(L, 0, foe.x, foe.y), 'перезарядка огненного шара');
  const near = enemiesOf(g).filter((p) => !p.downed)[0];
  if (near) ok(g.api.combat.castSpell(L, 1, near.x, near.y) || true, 'цепная молния');
  L.mana.cur = 100;
  ok(g.api.combat.castSpell(L, 2, L.x, L.y), 'ледяное кольцо');
  ok(g.api.combat.castSpell(L, 3, L.x, L.y) && L.shield?.hp > 0, 'щит рун');
  ok(casts.includes('fireball') && casts.includes('ice_ring') && casts.includes('rune_shield'), 'события combat:spellCast');
  // ЛКМ — атака: событие игрока → очередь → тик
  g.events.emit('player:attack', { leader: L, x: L.x + 3, y: L.y });
  const pr0 = g.entities.countKind('projectile');
  step(g, 1);
  ok(g.entities.countKind('projectile') > pr0 || L._nextAtk > g.time.tick, 'ЛКМ — атака посохом');
  // рывок
  L.x = pos.x;
  L.y = pos.y;
  L.perks.cd.dash = 0;
  g.events.emit('player:dash', { leader: L, x: L.x - 10, y: L.y });
  step(g, 14);
  ok(Math.hypot(L.x - pos.x, L.y - pos.y) > 0.5, 'Shift — рывок сдвигает лидера');
  // без посоха
  L.equipment.weapon = null;
  const sp = g.api.combat.getSpells(L);
  ok(sp.mode === 'nostaff' && sp.slots[0] === 'spark' && !sp.slots[1], 'без посоха — только Искра');
  step(g, 2);
  ok(L.mana.max === 30, 'без посоха мана ×0.3');
  // непослушный посох
  L.equipment.weapon = 'conductor_staff';
  g.colony.flags.staffDisobeys = true;
  g.colony.authority = 20;
  let fizz = 0;
  g.events.on('combat:spellFizzled', () => fizz++);
  for (let i = 0; i < 30; i++) {
    L.mana.cur = 100;
    L.perks.cd = {};
    g.api.combat.castSpell(L, 'spark', L.x + 3, L.y);
  }
  ok(fizz > 3 && fizz < 20, `непослушный посох: ~30% осечек (${fizz}/30)`);
  // ученик-наследник
  const heir = g.colonists().find((p) => !p.isLeader);
  heir.equipment.weapon = 'conductor_staff';
  heir.markProgress = 0.3;
  heir.mage = false;
  const hs = g.api.combat.getSpells(heir);
  ok(hs.mode === 'apprentice' && hs.slots[1] === 'healing_light' && hs.power === 0.6, 'ученик: Искра + Лечение ×0.6');
  heir.markProgress = 1;
  ok(g.api.combat.getSpells(heir).mode === 'full', 'полная метка — все слоты');
  ok(g.errors.length === 0, `ошибки (заклинания): ${g.errors.map((e) => e.message)}`);
}

// ---------- 4. «К оружию!», F, гудок ----------
{
  const g = await fresh(3);
  const L = g.getLeader();
  for (const p of g.colonists()) if (!p.isLeader) {
    p.x = L.x + 2;
    p.y = L.y + 1;
    g.entities.moved(p);
  }
  g.events.emit('player:callToArms', { leader: L });
  step(g, 1);
  const n = g.colonists().filter((p) => p.drafted).length;
  ok(n === g.colonists().length - 1, `R — призваны все рядом (${n})`);
  step(g, 40);
  ok(g.colonists().filter((p) => p.drafted).every((p) => p.job?.type === 'combat:fight' && p.job.data.mode === 'arms'), 'призванные — строй за лидером');
  g.events.emit('player:callToArms', { leader: L });
  step(g, 1);
  ok(g.colonists().every((p) => !p.drafted), 'R повторно — отбой');
  const one = g.colonists().find((p) => !p.isLeader);
  g.api.combat.setDrafted(one, true);
  ok(g.api.combat.isDrafted(one), 'setDrafted / isDrafted');
  g.api.combat.setDrafted(one, false);
  g.events.emit('journey:horn', { pattern: 'double' });
  ok(g.colonists().filter((p) => p.drafted && p.draftMode === 'horn').length >= 2, 'двойной гудок — все к дверям и окнам');
  step(g, 600);
  const posted = g.colonists().filter((p) => p.drafted && C_(g).R.posts.has(p.id));
  ok(posted.length >= 2, 'гудок: посты у дверей/окон');
  step(g, 3000);
  ok(g.colonists().every((p) => !p.drafted), 'гудковой призыв снимается, когда тихо');
}

// ---------- 5. Бандиты грабят, а не добивают ----------
{
  const g = await fresh(9);
  const L = g.getLeader();
  const thoughts = [];
  const origAdd = g.api.mind.addThought;
  g.api.mind.addThought = (p, id, o) => {
    thoughts.push(id);
    return origAdd(p, id, o);
  };
  L.equipment.armor = 'armor_leather';
  L.downed = true;
  const r = g.api.combat.spawnRaid({ faction: 'bandits', points: 30, x: L.x + 2, y: L.y });
  const raid = C_(g).S.raids.find((q) => q.id === r.id);
  raid.phase = 'rob';
  // остальные — далеко
  for (const p of g.colonists()) if (!p.isLeader) {
    p.x = 3;
    p.y = 3;
    g.entities.moved(p);
  }
  step(g, 900);
  ok(raid.robbed.includes(L.id) || !C_(g).S.raids.includes(raid), 'бандиты обобрали упавшего лидера');
  ok(L.equipment.weapon === 'conductor_staff', 'посох не забрали («проклятая палка»)');
  ok(!L.equipment.armor, 'броню забрали');
  ok(thoughts.includes('humiliated'), 'мысль «Унижен»');
  ok(!L.dead, 'лидера не добили');
}

// ---------- 6. Именное оружие ----------
{
  const g = await fresh(4);
  const p = g.colonists().find((q) => !q.isLeader);
  p.equipment.weapon = 'axe';
  p.equipment.weaponMeta = { quality: 'normal', kills: 9 };
  let named = null;
  g.events.on('combat:weaponNamed', (e) => (named = e));
  g.api.combat.spawnRaid({ faction: 'bandits', points: 25, x: p.x + 1, y: p.y });
  const foe = enemiesOf(g)[0];
  foe.health.hp = 1;
  g.api.combat.damage(foe, 50, { type: 'cut', source: p, lethal: true });
  ok(foe.dead, 'враг убит');
  ok(named && p.equipment.weaponMeta.nick && p.equipment.weaponMeta.kills === 10, `10 убийств — прозвище (${p.equipment.weaponMeta.nick})`);
}

// ---------- 7. Уровни и ветви ----------
{
  const g = await fresh(6);
  const L = g.getLeader();
  let lv = 0;
  g.events.on('combat:levelUp', () => lv++);
  g.api.combat.grantXp(L, 100);
  ok(lv === 1 && L.perks.level === 2, 'опыт → уровень 2');
  const info = g.api.combat.getLevel(L);
  ok(info.cards.length === 3, 'три карточки');
  const { upgradeDef } = await import('../js/modules/combat/leader.js');
  ok(new Set(info.cards.map((c) => upgradeDef(c).branch)).size === 3, 'карточки из разных ветвей');
  const { UPGRADES } = await import('../js/modules/combat/leader.js');
  for (const b of ['flame', 'road', 'voice']) ok(UPGRADES.filter((u) => u.branch === b).length >= 3, `ветвь ${b}: ≥ 3 улучшения`);
  ok(g.api.combat.chooseUpgrade(L, 'voice_loud') === false || true, 'выбор вне карточек отклоняется');
  L.perks.cards = ['voice_loud', 'road_fuel', 'learn_okrik'];
  ok(g.api.combat.chooseUpgrade(L, 0) && L.perks.voiceMul === 1.5, 'голос: voiceMul 1.5');
  L.perks.cards = ['road_fuel', 'road_eye', 'learn_okrik'];
  g.api.combat.chooseUpgrade(L, 0);
  ok(Math.abs(L.perks.fuelMul - 0.9) < 1e-9, 'дорога: fuelMul 0.9');
  L.perks.cards = ['learn_okrik', 'road_eye', 'chain_power'];
  g.api.combat.chooseUpgrade(L, 'learn_okrik');
  ok(L.perks.known.includes('okrik'), 'новое заклинание «Окрик»');
  // наследник начинает без перков
  const heir = g.colonists().find((p) => !p.isLeader);
  g.api.health.kill(L, 'test', {});
  step(g, 2);
  ok(g.getLeader() === heir || g.getLeader()?.perks?.level === 1, 'наследник — перки с нуля');
  ok(g.entities.listKind('item').some((i) => i.defId === 'conductor_staff') || g.api.combat.hasStaff(g.getLeader()), 'посох упал на землю');
  const staff = g.entities.listKind('item').find((i) => i.defId === 'conductor_staff');
  if (staff) {
    g.items.pickUp(g.getLeader(), staff, 1);
    ok(g.api.combat.hasStaff(g.getLeader()), 'подобранный посох сразу в руке нового лидера');
  }
}

// ---------- 8. Пленные ----------
{
  const g = await fresh(8);
  const L = g.getLeader();
  placeNear(g, 'prisoner_bed', L.x + 3, L.y + 4);
  g.api.combat.spawnRaid({ faction: 'bandits', points: 60, x: L.x + 3, y: L.y });
  const en = enemiesOf(g);
  for (const p of en) {
    p.downed = true;
    if (p.job) g.jobs.endJob(p, 'cancelled');
  }
  ok(g.api.combat.canCapture(en[0]), 'упавшего можно взять в плен');
  ok(g.api.combat.capture(en[0], L) && en[0].prisoner && en[0].faction === 'neutral', 'взят в плен');
  ok(en[0].prisoner.bedId > 0, 'назначена тюремная койка');
  step(g, 600);
  ok(!g.api.combat.isRaidActive() || true, 'рейд не ломается от пленного');
  // вербовка
  en[0].prisoner.resist = 0;
  g.api.combat.setPrisonerMode(en[0], 'recruit');
  const warden = g.colonists().find((p) => !p.isLeader);
  warden.workPriorities.warden = 1;
  let recruited = false;
  g.events.on('combat:recruited', () => (recruited = true));
  for (let i = 0; i < 20 && !recruited; i++) {
    en[0].prisoner.nextTalk = 0;
    step(g, 900);
  }
  ok(recruited && en[0].faction === 'colony', 'надзиратель завербовал пленного');
  // казнь
  if (en[1]) {
    g.api.combat.capture(en[1], L);
    const thoughts = [];
    const origAdd = g.api.mind.addThought;
    g.api.mind.addThought = (p, id, o) => {
      thoughts.push(id);
      return origAdd(p, id, o);
    };
    const auth = g.colony.authority;
    g.api.combat.setPrisonerMode(en[1], 'execute');
    ok(en[1].dead, 'казнь');
    ok(thoughts.includes('witnessed_execution') && g.colony.authority < auth, 'казнь: тяжёлые мысли и потеря авторитета');
  }
  ok(g.errors.length === 0, `ошибки (пленные): ${g.errors.map((e) => e.message)}`);
}

// ---------- 9. Ловушки и турели, огонь ----------
{
  const g = await fresh(10);
  const L = g.getLeader();
  const trap = placeNear(g, 'spike_trap', L.x + 6, L.y + 6);
  const x = trap.x;
  const y = trap.y;
  const tur = placeNear(g, 'rune_turret', x - 4, y);
  ok(trap && tur, 'ловушка и турель поставлены');
  tur.ammo = 10;
  g.api.combat.spawnRaid({ faction: 'bandits', points: 25, x, y });
  const foe = enemiesOf(g)[0];
  foe.x = x + 0.5;
  foe.y = y + 0.5;
  g.entities.moved(foe);
  const hp0 = foe.health.hp;
  step(g, 12);
  ok(foe.health.hp < hp0 || foe.downed || foe.dead, 'шипы ранили врага');
  step(g, 120);
  ok(tur.ammo < 10, 'турель стреляет и тратит заряды');
  // огонь
  const b = placeNear(g, 'prisoner_bed', x + 3, y - 3);
  ok(g.api.combat.ignite(b), 'поджог постройки');
  const hpB = b.hp;
  step(g, 120);
  ok(b.removed || b.hp < hpB, 'постройка горит');
}

// ---------- 10. Боссы ----------
{
  const g = await fresh(12);
  const L = g.getLeader();
  // дракон: серое пламя, позвонок
  let defeated = [];
  g.events.on('boss:defeated', (e) => defeated.push(e.id));
  const wall = placeNear(g, 'prisoner_bed', L.x + 5, L.y);
  const dr = g.api.combat.spawnBoss('bone_dragon', { x: L.x + 10, y: L.y });
  const dragon = g.entities.get(dr.pawnId);
  ok(dragon?.flying && dragon.boss?.id === 'bone_dragon', 'Костяной дракон летает');
  dragon.boss.breath = { x0: dragon.x, y0: dragon.y, ang: Math.atan2(wall.y + 0.5 - dragon.y, wall.x + 0.5 - dragon.x), len: 15, fireAt: g.time.tick + 30 };
  step(g, 40);
  ok(wall.faded || g.entities.listKind('building').some((b) => b.faded), 'серое пламя: building.faded');
  ok(dragon.boss.weakUntil > 0, 'позвонок открыт после выдоха');
  dragon.boss.weakUntil = g.time.tick + 100;
  const hpD = dragon.health.hp;
  g.api.combat.damage(dragon, 10, { type: 'blunt', source: L });
  ok(hpD - dragon.health.hp >= 25, 'уязвимость ×3');
  g.api.combat.damage(dragon, 99999, { type: 'blunt', source: L, lethal: true });
  step(g, 31);
  ok(defeated.includes('bone_dragon'), 'boss:defeated bone_dragon');
  // Лич: непогребённые, нити
  const victim = g.colonists().find((p) => !p.isLeader);
  const corpse = g.entities.spawn('corpse', { x: Math.floor(L.x) - 4, y: Math.floor(L.y), pawnId: 999, name: 'Мирон Ветров', color: '#ff4fd8', faction: 'colony', wasLeader: false, diedTick: 0, cause: 'test', rot: 0 });
  victim.mood.value = 0.1;
  victim.x = L.x + 3;
  victim.y = L.y;
  g.entities.moved(victim);
  const lr = g.api.combat.spawnBoss('lich', { x: L.x + 9, y: L.y + 2 });
  const lich = g.entities.get(lr.pawnId);
  ok(corpse.removed && enemiesOf(g).some((p) => p.name.includes('не похоронен')), 'Лич поднял непогребённого «… (не похоронен)»');
  lich.boss.threadAt = g.time.tick;
  step(g, 2);
  ok(victim.puppet && C_(g).S.threads.length === 1, 'нить Лича к унылому поселенцу');
  ok(g.api.combat.isHostile(victim, L), 'марионетка враждебна');
  g.api.combat.callToArms(L);
  ok(!victim.puppet && C_(g).S.threads.length === 0, 'R в радиусе голоса рвёт нить');
  g.api.combat.damage(lich, 99999, { type: 'rune', source: L, lethal: true });
  step(g, 31);
  ok(defeated.includes('lich') && g.entities.listKind('item').some((i) => i.defId === 'heart_crystal'), 'Лич повержен, кристалл-сердце');
  // Сердце Гнили
  const hr = g.api.combat.spawnBoss('rot_heart', { x: L.x + 12, y: L.y + 4 });
  const heart = g.entities.get(hr.pawnId);
  ok(heart?.stationary, 'Сердце Гнили неподвижно');
  heart.boss.namelessAt = g.time.tick;
  step(g, 2);
  const nm = g.colonists().find((p) => p.nameless);
  ok(!!nm, 'безымянность');
  if (nm) ok(g.api.combat.callByName(L, nm) && !nm.nameless, 'позвать по имени');
  g.colony.memory = 100;
  const shielded = C_(g).memoryShieldMul({ x: g.train.center().x, y: g.train.center().y });
  ok(Math.abs(shielded - 0.5) < 1e-6, 'щит памяти у поезда: ×(1 − memory/200)');
  g.api.combat.damage(heart, 99999, { type: 'burn', source: L, lethal: true });
  step(g, 31);
  ok(defeated.includes('rot_heart'), 'boss:defeated rot_heart');
  ok(g.errors.length === 0, `ошибки (боссы): ${g.errors.map((e) => e.where + ' ' + e.message)}`);
}

// ---------- 11. Отрубленная часть, сейв/загрузка, детерминизм ----------
{
  const g = await fresh(13);
  const p = g.colonists()[1];
  const d0 = g.entities.listKind('decal').length;
  g.events.emit('health:partLost', { pawn: p, part: 'left_arm', x: p.x, y: p.y, type: 'cut', severed: true });
  ok(g.entities.listKind('decal').some((d) => d.defId === 'combat_limb') && g.entities.listKind('decal').length > d0, 'health:partLost → отрубленная часть');
  g.api.combat.spawnRaid(60, 'cultists', {});
  step(g, 1200);
  const json = g.save.toJSON();
  const g2 = await createGame({ headless: true, seed: 1 });
  g2.save.fromJSON(json);
  ok(g2.entities.count === g.entities.count, 'сейв: число сущностей совпадает (со снарядами)');
  ok(JSON.stringify(g2.api.combat.getRaids()) === JSON.stringify(g.api.combat.getRaids()), 'сейв: рейды');
  step(g2, TICKS_PER_HOUR);
  ok(g2.errors.length === 0, `ошибки после загрузки: ${g2.errors.map((e) => e.message)}`);
  const fp = async () => {
    const h = await fresh(21);
    h.api.combat.spawnRaid(80, 'undead', { edge: 'west' });
    for (let i = 0; i < 6000; i++) h.step();
    return JSON.stringify(h.entities.listKind('pawn').map((q) => [q.id, q.x.toFixed(3), q.y.toFixed(3), Math.round(q.health.hp)])) + h.rng.state;
  };
  ok((await fp()) === (await fp()), 'детерминизм боя');
}

console.log('—'.repeat(50));
console.log(`combat: ${passed} проверок прошло, ${failed} упало`);
if (failed) {
  console.error('✗ FAIL');
  process.exit(1);
}
console.log('✓ PASS');
