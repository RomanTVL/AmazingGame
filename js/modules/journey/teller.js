// journey — рассказчик (MVP): рейды по прибытии и через время (вместо запасного рассказчика combat — он молчит,
// когда journey предоставляет getStation), 7 простых событий, диалоги (беженец просится в поезд).
import { createPawn, PAWN_COLORS } from '../../sim/pawn.js';
import { hours, notify, safe, diff, raidActive, jrng } from './state.js';
import { BOSS_STEP } from './route.js';

const cd = (J, id) => J.S.teller.cd[id] ?? -1e12;

function cap(game) {
  return 20 + 22 * game.colonists().filter((p) => !p.downed).length;
}

function trainSpot(J, near = 6) {
  const game = J.game;
  const c = game.train?.center();
  if (!c || !game.map) return null;
  const side = jrng(J).chance(0.5) ? -1 : 1;
  return game.map.randomPassableNear(jrng(J), c.x + jrng(J).int(-10, 10), c.y + side * near, 4, 40, (x, y) => !game.train.carAt(x, y));
}

function storageCell(J) {
  const game = J.game;
  const tr = game.train;
  const car = tr?.carOfType('storage') || tr?.cars?.[0];
  const cells = car ? tr.interior(car).filter((c) => game.map.isPassable(c.x, c.y)) : [];
  return cells.length ? cells[jrng(J).int(0, cells.length - 1)] : null;
}

/** Вещи «найдены»: на стоянке — рядом с поездом, в пути — в вагон-склад. */
function giveItems(J, list) {
  const game = J.game;
  const spot = J.S.phase === 'travel' ? storageCell(J) : trainSpot(J, 5) || storageCell(J);
  if (!spot) return false;
  for (const [id, n] of list) if (game.defs.items.has(id) && n > 0) game.items.spawn(id, n, spot.x, spot.y);
  return true;
}

function pickColonists(J, n) {
  const list = J.game.colonists().filter((p) => !p.downed);
  return jrng(J).shuffle(list).slice(0, n);
}

/** События. phases — где возможны; good — доброе (вес × incidentGood). */
export const INCIDENTS = [
  {
    id: 'refugee', weight: 2, good: true, phases: ['station', 'wild'],
    can: (J) => J.game.colonists().length < 8 && !J.S.dialogs.length,
    run(J) {
      const game = J.game;
      const rng = jrng(J);
      const gender = rng.chance(0.5) ? 'male' : 'female';
      const spec = safe(J, 'candidate', () => game.api.mind.generateCandidate(rng, { gender, role: 'refugee', lang: game.i18n.lang }), null) || {};
      J.S.dialogs.push({ id: J.S.uid++, kind: 'refugee', spec, expires: game.time.tick + hours(8) });
      J.R.openDialog = true;
      notify(J, 'journey.inc.refugee', { name: spec.name || '?' }, 'info');
      return true;
    },
  },
  {
    id: 'supplies', weight: 3, good: true, phases: ['station', 'wild', 'travel'],
    run(J) {
      const rng = jrng(J);
      if (!giveItems(J, [['ration', rng.int(5, 10)], ['coal', rng.int(6, 14)]])) return false;
      notify(J, 'journey.inc.supplies', {}, 'good');
      return true;
    },
  },
  {
    id: 'coal_find', weight: 2, good: true, phases: ['station', 'wild'],
    run(J) {
      const game = J.game;
      const spot = trainSpot(J, 11);
      if (!spot || !game.defs.buildings.has('coal_seam')) return false;
      let n = 0;
      for (let i = 0; i < 6; i++) {
        const x = spot.x + (i % 3);
        const y = spot.y + Math.floor(i / 3);
        if (!game.map.isPassable(x, y) || game.map.buildingAt(x, y) || game.train.carAt(x, y)) continue;
        const pl = game.map.plantAt(x, y);
        if (pl) game.entities.remove(pl, 'cleared');
        const b = game.entities.spawn('building', { defId: 'coal_seam', x, y, natural: true });
        if (b) {
          game.designations.add('mine', x, y);
          n++;
        }
      }
      if (!n) return false;
      notify(J, 'journey.inc.coal', {}, 'good', { x: spot.x, y: spot.y });
      return true;
    },
  },
  {
    id: 'quarrel', weight: 2, good: false, phases: ['station', 'wild', 'travel'],
    can: (J) => J.game.colonists().length >= 2,
    run(J) {
      const game = J.game;
      const [a, b] = pickColonists(J, 2);
      if (!a || !b) return false;
      game.api.mind.addThought(a, 'journey_quarrel', { otherPawnId: b.id });
      game.api.mind.addThought(b, 'journey_quarrel', { otherPawnId: a.id });
      game.api.mind.say(a, game.t('journey.inc.quarrelSay'));
      notify(J, 'journey.inc.quarrel', { a: a.name, b: b.name }, 'bad');
      return true;
    },
  },
  {
    id: 'song', weight: 2, good: true, phases: ['station', 'wild', 'travel'],
    run(J) {
      const game = J.game;
      const list = game.colonists();
      if (!list.length) return false;
      for (const p of list) game.api.mind.addThought(p, 'journey_song', {});
      notify(J, 'journey.inc.song', { name: jrng(J).pick(list).name }, 'good');
      return true;
    },
  },
  {
    id: 'wolves', weight: 1.5, good: false, phases: ['station', 'wild'],
    can: (J) => !raidActive(J) && J.S.step < BOSS_STEP && J.S.rot.level === 0,
    run(J) {
      const game = J.game;
      const points = Math.round(Math.min(cap(game), 22 * jrng(J).int(1, 2)) * diff(J).threat);
      const res = safe(J, 'spawnRaid', () => game.api.combat.spawnRaid({ points, faction: 'rot_beasts' }), null);
      if (!res) return false;
      notify(J, 'journey.inc.wolves', {}, 'danger');
      return true;
    },
  },
  {
    id: 'wanderer', weight: 1.5, good: true, phases: ['station', 'wild', 'travel'],
    run(J) {
      if (!giveItems(J, [['medicine_herbal', jrng(J).int(2, 4)]])) return false;
      notify(J, 'journey.inc.wanderer', {}, 'good');
      return true;
    },
  },
];

export function registerThoughts(game) {
  if (!game.providers.mind?.registerThought) return;
  game.api.mind.registerThought({ id: 'journey_quarrel', mood: -6, hours: 24, stack: 2, label: { ru: 'Поссорились', en: 'Had a quarrel' } });
  game.api.mind.registerThought({ id: 'journey_song', mood: 5, hours: 12, stack: 1, label: { ru: 'Пели у огня', en: 'Sang by the fire' } });
}

/** Начало игры: передышка перед первым рейдом. */
export function startTeller(J) {
  const now = J.game.time.tick;
  const rng = jrng(J);
  J.S.teller = { nextRaid: now + hours(rng.range(66, 90)), nextIncident: now + hours(rng.range(8, 14)), cd: {} };
}

/** Прибытие: опасная станция — рейд скоро. */
export function onArrivalTeller(J, danger = 1) {
  const now = J.game.time.tick;
  const rng = jrng(J);
  const T = J.S.teller;
  if (J.S.step >= BOSS_STEP && J.S.phase === 'station') T.nextRaid = now + hours(9999);
  else if (rng.chance(Math.min(0.85, 0.25 * danger * diff(J).threat))) T.nextRaid = now + hours(rng.range(1.5, 4));
  else T.nextRaid = now + hours(rng.range(48, 72));
  T.nextIncident = Math.min(T.nextIncident, now + hours(rng.range(4, 10)));
}

function raidFaction(J) {
  const rng = jrng(J);
  const biome = J.game.map?.biome;
  return biome === 'ash' ? rng.pick(['bandits', 'cultists', 'undead']) : rng.pick(['bandits', 'bandits', 'rot_beasts']);
}

function fireIncident(J) {
  const game = J.game;
  const now = game.time.tick;
  const good = diff(J).incidentGood;
  const list = INCIDENTS.filter((d) => d.phases.includes(J.S.phase) && now - cd(J, d.id) >= hours(36) && (!d.can || safe(J, `can:${d.id}`, () => d.can(J), false)));
  if (!list.length) return;
  const d = jrng(J).weighted(list, (x) => x.weight * (x.good ? good : 1));
  if (!d) return;
  if (safe(J, `inc:${d.id}`, () => d.run(J), false)) {
    J.S.teller.cd[d.id] = now;
    J.S.stats.incidents++;
    game.events.emit('journey:incident', { id: d.id });
  }
}

/** Тик рассказчика. */
export function tellerTick(J) {
  const S = J.S;
  if (S.phase === 'ended') return;
  const game = J.game;
  const now = game.time.tick;
  const T = S.teller;
  // диалоги: без ответа — уходят
  for (const d of S.dialogs.slice()) {
    if (now < d.expires) continue;
    S.dialogs.splice(S.dialogs.indexOf(d), 1);
    notify(J, 'journey.inc.refugeeLeft', {}, 'info');
  }
  if ((S.phase === 'station' || S.phase === 'wild') && now >= T.nextRaid) {
    if (raidActive(J)) T.nextRaid = now + hours(2);
    else {
      const rng = jrng(J);
      const points = Math.round(Math.min(cap(game), 16 + S.step * 8 + game.time.day * 2 + rng.int(0, 6)) * diff(J).threat);
      const res = safe(J, 'spawnRaid', () => game.api.combat.spawnRaid({ points, faction: raidFaction(J) }), null);
      if (res) S.stats.raids++;
      T.nextRaid = now + hours(res ? rng.range(72, 120) : 3);
    }
  }
  if (now >= T.nextIncident) {
    fireIncident(J);
    T.nextIncident = now + hours(jrng(J).range(10, 20));
  }
}

/** Ответ на диалог. accept — принять беженца. */
export function answerDialog(J, id, accept) {
  const S = J.S;
  const d = S.dialogs.find((x) => x.id === id) || (id === undefined || id === null ? S.dialogs[0] : null);
  if (!d) return false;
  S.dialogs.splice(S.dialogs.indexOf(d), 1);
  if (!accept) {
    notify(J, 'journey.inc.refugeeNo', {}, 'info');
    return true;
  }
  const game = J.game;
  const spot = trainSpot(J, 4) || storageCell(J);
  if (!spot) return false;
  const n = game.colonists().length;
  const p = createPawn(game, {
    ...d.spec, isLeader: false, controlled: 'ai', x: spot.x + 0.5, y: spot.y + 0.5, color: d.spec.color || PAWN_COLORS[(n + 3) % PAWN_COLORS.length],
  });
  notify(J, 'journey.inc.refugeeYes', { name: p.name }, 'good', { pawnId: p.id });
  return true;
}
