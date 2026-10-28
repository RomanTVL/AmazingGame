// Прогон «разумного игрока» (headless, MVP-4): обычная сложность; на станции ~12 ч (добыча угля, тайники), затем
// гудок из кабины и в путь; лидер стреляет заклинаниями по ближайшим врагам и бьёт посохом вплотную; на станции 4 —
// бой с Костяным драконом. Печатает итоги по сидам; падает только на исключениях.
// Запуск: node tests/journey.play.mjs [--seeds 1,2,3] [--difficulty normal]
import { createGame, startNewColony } from '../js/core/boot.js';
import { TICKS_PER_HOUR as H, TICKS_PER_DAY as DAY } from '../js/core/constants.js';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const SEEDS = String(arg('seeds', '1,2,3')).split(',').map(Number);
const DIFF = arg('difficulty', 'normal');
const QUIET = process.argv.includes('--quiet');

function enemiesNear(g, p, r) {
  return g.entities.queryRadius(p.x, p.y, r, 'pawn').filter((e) => e.faction === 'enemy' && !e.dead && !e.downed && !e.prisoner);
}

const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
function moveKeys(g, dx, dy) {
  const inp = g.input;
  inp.setKey(KEYS.right, dx > 0.3);
  inp.setKey(KEYS.left, dx < -0.3);
  inp.setKey(KEYS.down, dy > 0.3);
  inp.setKey(KEYS.up, dy < -0.3);
}

/** Лидер: идёт к бою, держит дистанцию (от дракона — дальше), бьёт заклинаниями, вплотную — посохом. */
function leaderFight(g) {
  const L = g.getLeader();
  if (!L || L.downed) return moveKeys(g, 0, 0);
  const foes = enemiesNear(g, L, 28);
  if (!foes.length) return moveKeys(g, 0, 0);
  foes.sort((a, b) => (a.x - L.x) ** 2 + (a.y - L.y) ** 2 - ((b.x - L.x) ** 2 + (b.y - L.y) ** 2));
  // мелочь рядом (призванные скелеты) — сперва её, потом босса
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
  const hurt = (L.health?.hp ?? 100) / (L.health?.maxHp ?? 100) < 0.6 || g.api.health.getSummary?.(L)?.ratio < 0.6;
  if (hurt && !L.shield && mana >= 35 && C.castSpell(L, 'rune_shield', L.x, L.y)) return;
  if (close.length >= 2 && mana >= 30 && C.castSpell(L, 'chain_lightning', t.x, t.y)) return;
  if (mana >= 25 && d > 2.5 && C.castSpell(L, 'fireball', t.x, t.y)) return;
  if (mana >= 28 && d < 3.5 && C.castSpell(L, 'ice_ring', L.x, L.y)) return;
  if (d < 1.6) C.attack(L, t);
}

function designateFuel(g) {
  let n = 0;
  for (const b of g.entities.listKind('building')) {
    const def = g.defs.buildings.get(b.defId);
    if (!(b.defId === 'coal_seam' || def?.cache)) continue;
    if (g.designations.has('mine', b.x, b.y)) continue;
    if (g.designations.add('mine', b.x, b.y)) n++;
  }
  return n;
}

function toCab(g) {
  const L = g.getLeader();
  if (!L || L.downed) return;
  const r = g.train.locomotive.rect;
  if (L.job) g.jobs.endJob(L, 'cancelled');
  g.entities.setPosition(L, r.x + 2.5, r.y + 3.5);
}

async function play(seed) {
  const g = await createGame({ headless: true, seed });
  startNewColony(g, { seed, difficulty: DIFF });
  const J = g.api.journey;
  const T = g.api.train;
  const log = (s) => !QUIET && console.log(`  [${seed}] д${g.time.day} ${String(g.time.hourInt).padStart(2, '0')}ч ${s}`);
  let lost = false;
  g.events.on('colony:lost', () => (lost = true), 'test');
  let victory = null;
  g.events.on('game:victory', (e) => (victory = e), 'test');
  g.events.on('journey:arrived', (e) => log(`прибыли: ${e.station.name} (${e.station.type}), поселенцев ${g.colonists().length}, угля ${T.fuelUnits()}`), 'test');
  g.events.on('journey:leftBehind', (e) => log(`оставлен: ${e.pawn.name}`), 'test');
  g.events.on('pawn:died', (e) => e.pawn.faction === 'colony' && log(`погиб ${e.pawn.name}${e.pawn.isLeader ? ' (лидер)' : ''}: ${e.cause}`), 'test');
  g.events.on('combat:bossSpawned', () => log(`дракон! здоровье: ${g.colonists().map((p) => `${p.name.split(' ')[0]} ${Math.round((g.api.health.getSummary(p)?.ratio ?? 1) * 100)}%${p.downed ? ' упал' : ''}`).join(', ')}`), 'test');
  g.events.on('combat:raidStarted', (e) => log(`нападение: ${e.faction} ×${e.count} (${e.kind})`), 'test');
  if (process.env.COALDEBUG) {
    const cnt = {};
    const inT = (it) => g.train.stamped && g.train.carAt(Math.floor(it.x), Math.floor(it.y))?.type === 'tender';
    g.events.on('item:changed', ({ item, delta }) => {
      if (delta < 0 && (item.defId === 'coal' || item.defId === 'wood') && inT(item)) {
        const k = `${J.getState().phase} ${item.defId}: ${new Error().stack.split('\n')[4].trim().slice(0, 80)}`;
        cnt[k] = (cnt[k] || 0) - delta;
      }
    }, 'test');
    g.events.on('entity:removed', ({ entity, reason }) => {
      if (entity.kind === 'item' && (entity.defId === 'coal' || entity.defId === 'wood') && inT(entity)) {
        const k = `${J.getState().phase} rm ${entity.defId} ${reason}: ${new Error().stack.split('\n')[5].trim().slice(0, 80)}`;
        cnt[k] = (cnt[k] || 0) + 1;
      }
    }, 'test');
    g.events.on('journey:departing', () => {
      console.log(JSON.stringify(cnt, null, 1));
      for (const k of Object.keys(cnt)) delete cnt[k];
    }, 'test');
  }
  let casts = 0;
  const dmg = {};
  g.events.on('combat:hit', (e) => {
    if (J.getState().step < 4) return;
    if (!e.target?.boss) {
      if (e.target?.faction === 'colony') {
        const k = `→колония от ${e.attacker?.boss ? 'дракона' : e.attacker?.defId || e.attacker?.enemyId || e.attacker?.name || '?'}:${e.type}`;
        dmg[k] = (dmg[k] || 0) + (e.damage || 0);
      }
      return;
    }
    const k = `${e.attacker?.isLeader ? 'лидер' : e.attacker ? 'спутник' : '?'}:${e.spell || e.type}`;
    dmg[k] = (dmg[k] || 0) + (e.damage || 0);
  }, 'test');
  g.events.on('colony:lost', () => process.env.BOSSDEBUG && console.log(JSON.stringify(dmg)), 'test');
  g.events.on('combat:spellCast', () => casts++, 'test');
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      if (i % 4 === 0) {
        g.frame(4 / 60);
        g.input.endFrame();
      }
      if (i % 12 === 0) leaderFight(g);
      g.step();
      if (g.errors.length || lost || victory) return;
    }
  };
  const MAX = 30 * DAY;
  let arrivedAt = g.time.tick;
  let last = '';
  while (g.time.tick < MAX && !lost && !victory && !g.errors.length) {
    const st = J.getState();
    if (st.phase === 'station' || st.phase === 'wild') {
      if (st.phase + st.step !== last) {
        last = st.phase + st.step;
        arrivedAt = g.time.tick;
        designateFuel(g);
      }
      if (st.step >= 4 && st.phase === 'station') {
        step(H);
        if (process.env.BOSSDEBUG) {
          const d = g.entities.listKind('pawn').find((p) => p.boss?.id === 'bone_dragon');
          const L = g.getLeader();
          log(`дракон hp ${d ? Math.round(d.health?.hp ?? -1) : '-'} фаза ${d?.boss?.phase} · лидер ${L ? `${L.name} мана ${Math.round(L.mana?.cur ?? 0)} ${L.downed ? 'упал' : ''} до дракона ${d ? Math.hypot(d.x - L.x, d.y - L.y).toFixed(0) : '-'}` : 'нет'} · заклинаний ${casts} · стоят ${g.colonists().filter((p) => !p.downed).length}`);
        }
        continue;
      }
      // выбор пути: если угля мало — туда, где уголь (пустошь/руины), иначе — спокойнее (деревня/лес)
      const next = st.step + 1;
      if (st.phase === 'station' && st.choice[next - 1] === null) {
        const opts = J.getRoute().steps[next - 1];
        const lowFuel = T.fuelUnits() < 50;
        const score = (o) => (lowFuel ? { ash: 3, ruins: 2, village: 1, forest: 0 } : { village: 3, forest: 2, ash: 1, ruins: 0 })[o.type];
        J.choose(next, score(opts[0]) >= score(opts[1]) ? 0 : 1);
      }
      const stayed = g.time.tick - arrivedAt;
      const rotSoon = J.getState().rotHoursLeft < 2;
      const fuelOk = J.canDepart() && T.fuelUnits() >= (J.fuelNeed() ?? 0) + 6;
      if ((stayed >= 12 * H && fuelOk) || (rotSoon && J.canDepart())) {
        if (g.api.combat.isRaidActive() && !rotSoon) {
          step(H / 2);
          continue;
        }
        // упавших заносим в вагон (как перенос на руках, удержание E)
        for (const p of T.missing()) {
          if (!p.downed) continue;
          const car = g.train.carOfType('residential') || g.train.cars[0];
          const c = g.train.interior(car).find((q) => g.map.isPassable(q.x, q.y) && !g.map.buildingAt(q.x, q.y));
          if (c) g.entities.setPosition(p, c.x + 0.5, c.y + 0.5);
        }
        toCab(g);
        log(`отправление: угля ${T.fuelUnits()} (нужно ${J.fuelNeed()}), на карте угля ${g.items.count('coal')}, пробыли ${((g.time.tick - arrivedAt) / H).toFixed(0)} ч`);
        if (T.startBoarding()) {
          let k = 0;
          while (J.getState().phase !== 'travel' && k < 3000 && !lost) {
            step(60);
            k += 60;
            if (g.train.ops?.confirm && k > 1900) {
              if (process.env.BOARDDEBUG) for (const p of T.missing()) log(`не сел ${p.name}: job ${p.job?.type} asleep ${p.asleep} downed ${p.downed} drafted ${p.drafted} break ${p.mindBreak?.kind} at ${p.x.toFixed(0)},${p.y.toFixed(0)} reach ${g.pathfinder.canReach(p.x, p.y, g.train.center().x, g.train.center().y, true)}`);
              T.confirmDepart(true);
            }
          }
        }
        continue;
      }
      step(H / 2);
      continue;
    }
    step(H / 2);
  }
  const st = J.getState();
  return {
    seed, victory: !!victory, reached: st.step, phase: st.phase, day: g.time.day, survivors: g.colonists().length,
    left: T.leftBehind().length, wild: J.debugState().S.stats.wildStops, errors: g.errors.length, err: g.errors[0],
  };
}

const res = [];
for (const s of SEEDS) {
  const r = await play(s);
  res.push(r);
  console.log(`сид ${s}: ${r.victory ? 'ПОБЕДА' : 'нет победы'}, дошли до станции ${r.reached} (${r.phase}), день ${r.day}, выжило ${r.survivors}, оставлено ${r.left}, диких стоянок ${r.wild}`);
  if (r.err) console.error(r.err);
}
const wins = res.filter((r) => r.victory).length;
const reach = res.filter((r) => r.reached >= 4).length;
console.log(`Итого (${DIFF}): до станции 4 — ${reach}/${res.length}, побед — ${wins}/${res.length}`);
if (res.some((r) => r.errors)) {
  console.error('✗ FAIL: исключения');
  process.exitCode = 1;
} else console.log('✓ PASS');
