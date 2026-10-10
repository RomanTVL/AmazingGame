// Старт новой колонии, наследование власти, конец игры, сериализаторы ядра.
import { EVENTS } from '../core/events.js';
import { FACTION } from '../core/constants.js';
import { generateStation } from './worldgen.js';
import { Train, DEFAULT_CONSIST } from './train.js';
import { TileMap } from './map.js';
import { createPawn, generateName, PAWN_COLORS, LEADER_COLOR } from './pawn.js';

/** Стартовые запасы (в вагоне-складе). */
export const STARTING_ITEMS = [
  ['wood', 75], ['wood', 45], ['ration', 40], ['berries', 30], ['medicine_herbal', 10],
  ['mana_crystal', 24], ['cloth', 20], ['stone', 30],
];

/**
 * Новая колония: карта станции + поезд + лидер + поселенцы + запасы.
 * opts: {seed?, biome?, w?, h?, colonists?, consist?}
 */
export function startNewColony(game, opts = {}) {
  game.resetWorld();
  if (opts.seed !== undefined) game.reseed(opts.seed);
  const map = generateStation(game, { biome: opts.biome || 'forest', w: opts.w || 140, h: opts.h || 90 });
  const train = new Train(game, opts.consist || DEFAULT_CONSIST);
  game.train = train;
  train.stamp(map.railY, Math.floor((map.w - train.length) / 2));

  const rng = game.rng.fork('colonists');
  const lang = game.i18n.lang;
  const res = train.carOfType('residential') || train.cars[0];
  const r = res.rect;

  // Лидер — маг-проводник: белобрысый, кудрявый, посох с кристаллом
  const leader = createPawn(game, {
    name: generateName(rng, lang, 'male'),
    gender: 'male',
    age: rng.int(26, 34),
    isLeader: true,
    controlled: 'player',
    mage: true,
    color: LEADER_COLOR,
    hairColor: '#ffffff',
    speed: 4.4,
    x: r.x + Math.floor(r.w / 2) + 0.5,
    y: r.y + r.h + 1.5,
    dir: Math.PI / 2,
    light: { radius: 4.8, color: '#c8f6ff', intensity: 0.9, flicker: 0.05 },
  });
  game.colony.leaderId = leader.id;

  const n = opts.colonists ?? 4;
  const inner = train.interior(res);
  for (let i = 0; i < n; i++) {
    const gender = rng.chance(0.5) ? 'male' : 'female';
    const c = inner[(i * 7 + 3) % inner.length];
    createPawn(game, {
      name: generateName(rng, lang, gender),
      gender,
      age: rng.int(18, 62),
      color: PAWN_COLORS[i % PAWN_COLORS.length],
      hairColor: rng.pick(['#3b2a20', '#d8b07a', '#1c1c24', '#8a4b2f', '#c9c3b8']),
      x: c.x + 0.5,
      y: c.y + 0.5,
      dir: rng.range(-Math.PI, Math.PI),
    });
  }

  // запасы
  const store = train.carOfType('storage') || train.cars[0];
  const cells = train.interior(store);
  STARTING_ITEMS.forEach(([id, count], i) => {
    const c = cells[(i * 2) % cells.length];
    game.items.spawn(id, count, c.x, c.y);
  });

  game.events.emit(EVENTS.COLONY_STARTED, { seed: game.seed, biome: map.biome });
  game.api.ui.notify(game.t('hint.start'), { type: 'info' });
  return game;
}

export function registerColony(game) {
  // Смерть: наследование и проигрыш
  game.events.on(EVENTS.PAWN_DIED, ({ pawn }) => {
    if (pawn.faction !== FACTION.COLONY) return;
    const wasLeader = pawn.id === game.colony.leaderId;
    if (wasLeader) {
      const heir = game.api.colony.chooseHeir(pawn);
      game.events.emit(EVENTS.LEADER_DIED, { pawn, heir: heir || null });
      if (heir) {
        game.api.colony.transferLeadership(heir);
        game.api.ui.notify(game.t('colony.heir', { dead: pawn.name, heir: heir.name }), { type: 'danger', pawnId: heir.id });
      } else {
        game.colony.leaderId = 0;
      }
    }
    if (game.colonists().length === 0 && !game.colony.lost) {
      game.colony.lost = true;
      game.api.ui.notify(game.t('colony.lost'), { type: 'danger' });
      game.events.emit(EVENTS.COLONY_LOST, { day: game.time.day });
    }
  });

  // --- Сериализаторы ядра ---
  const S = game.save;
  S.registerSerializer({
    id: 'meta',
    order: 0,
    save: (g) => ({ seed: g.seed, rng: g.rng.getState(), colony: g.colony, stats: g.stats }),
    load(g, d) {
      g.seed = d.seed;
      g.rng.setState(d.rng);
      Object.assign(g.colony, d.colony);
      Object.assign(g.stats, d.stats);
    },
  });
  S.registerSerializer({
    id: 'time',
    order: 10,
    save: (g) => g.time.serialize(),
    load: (g, d) => g.time.deserialize(d),
  });
  S.registerSerializer({
    id: 'map',
    order: 20,
    save: (g) => g.map?.serialize() ?? null,
    load(g, d) {
      if (d) g.setMap(TileMap.deserialize(g, d));
    },
  });
  S.registerSerializer({
    id: 'train',
    order: 25,
    save: (g) => g.train?.serialize() ?? null,
    load(g, d) {
      g.train = d ? Train.deserialize(g, d) : null;
    },
  });
  S.registerSerializer({
    id: 'entities',
    order: 30,
    save: (g) => g.entities.serialize(),
    load(g, d) {
      g.entities.deserialize(d);
      g.map?.recomputeAll();
    },
  });
  S.registerSerializer({
    id: 'zones',
    order: 40,
    save: (g) => g.zones.serialize(),
    load: (g, d) => g.zones.deserialize(d),
  });
  S.registerSerializer({
    id: 'designations',
    order: 50,
    save: (g) => g.designations.serialize(),
    load: (g, d) => g.designations.deserialize(d),
  });
  S.registerSerializer({
    id: 'log',
    order: 60,
    save: (g) => g.log.slice(-100).map(({ text, type, tick, day }) => ({ text, type, tick, day })),
    load(g, d) {
      g.log.length = 0;
      g.log.push(...d);
    },
  });
}
