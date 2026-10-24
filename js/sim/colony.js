// Старт новой колонии (сценарии, сложность), наследование власти, конец игры, сериализаторы ядра.
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
 * Сценарий по умолчанию — 'three_survivors' (его и остальные настоящие сценарии регистрирует модуль train);
 * если такого нет — встроенный CORE_SCENARIO 'standard' (прежний старт ядра: лидер + 4, полный состав).
 */
export const DEFAULT_SCENARIO = 'three_survivors';
export const CORE_SCENARIO = 'standard';
export const DEFAULT_DIFFICULTY = 'normal';

/** Внешность лидера по умолчанию (opts.look поверх, с ограничениями LOOK_LIMITS). */
export const DEFAULT_LEADER_LOOK = Object.freeze({ curls: 7, curlLen: 1, crystal: '#5ef2ff', scar: false });

/** Нормализовать внешность лидера: curls 5..9, curlLen 0.6..1.4, crystal '#rgb'/'#rrggbb', scar bool. */
export function normalizeLook(look = {}) {
  const num = (v, a, b, d) => (Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d);
  const d = DEFAULT_LEADER_LOOK;
  return {
    ...look,
    curls: Math.round(num(look.curls, 5, 9, d.curls)),
    curlLen: num(look.curlLen, 0.6, 1.4, d.curlLen),
    crystal: typeof look.crystal === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(look.crystal) ? look.crystal : d.crystal,
    scar: !!look.scar,
  };
}

/**
 * Сценарии старта: game.defs.scenarios (sortBy 'order'). Схема ScenarioDef:
 * {id, nameKey, descKey, order?,
 *  difficulty?: 'easy'|'normal'|'hard'|'brutal' — оценка сценария и сложность по умолчанию (opts.difficulty важнее),
 *  rerolls?: 0..3 — сколько перебросов состава даёт экран новой игры (данные для ui),
 *  colonists?: number — спутников, кроме лидера (по умолчанию 4; при opts.roster — его длина),
 *  consist?: string[] — типы вагонов с хвоста к голове (локомотив последним),
 *  items?: [[defId, count], ...] — в вагон-склад (неизвестные defId пропускаются с console.warn),
 *  silver?: number — серебро (предмет 'silver', если его зарегистрировал economy; иначе game.colony.silver),
 *  rotGapHours?: number — фора до Гнили в часах (читает journey), engine?: 'steam'|'rune' (читает train),
 *  flags?: object — сливаются в game.colony.flags,
 *  biome?, w?, h? — карта первой стоянки, leader?: object — поля лидера поверх стандартных,
 *  colonist?: (game, index, rng) → object — поля i-го сгенерированного спутника,
 *  apply?(game, opts, ctx) — ПОСЛЕ карты, поезда, пешек и запасов, ДО 'colony:started';
 *     ctx = {scenario, map, train, leader, colonists, rng}}
 */
export const CORE_SCENARIOS = [
  {
    id: CORE_SCENARIO, order: 1000, nameKey: 'scenario.standard.name', descKey: 'scenario.standard.desc',
    difficulty: 'normal', rerolls: 0, colonists: 4, items: STARTING_ITEMS, consist: DEFAULT_CONSIST, engine: 'rune', flags: {},
  },
];

/**
 * Уровни сложности (выбор игрока): game.defs.difficulties (sortBy 'order'). Схема: {id, nameKey, descKey, order, ...}.
 * Числовые параметры (угроза рейдов, щедрость событий) добавляет модуль journey: defs.difficulties.extend(id, {...}).
 */
export const CORE_DIFFICULTIES = [
  { id: 'easy', order: 10, nameKey: 'difficulty.easy.name', descKey: 'difficulty.easy.desc' },
  { id: 'normal', order: 20, nameKey: 'difficulty.normal.name', descKey: 'difficulty.normal.desc' },
  { id: 'hard', order: 30, nameKey: 'difficulty.hard.name', descKey: 'difficulty.hard.desc' },
  { id: 'brutal', order: 40, nameKey: 'difficulty.brutal.name', descKey: 'difficulty.brutal.desc' },
];

/** Сценарий по id; без id — DEFAULT_SCENARIO, если зарегистрирован, иначе CORE_SCENARIO. */
export function resolveScenario(game, id) {
  const reg = game.defs.scenarios;
  return reg.get(id) || reg.get(DEFAULT_SCENARIO) || reg.get(CORE_SCENARIO) || CORE_SCENARIOS[0];
}

/**
 * Новая колония: карта станции + поезд + лидер + спутники + запасы + сценарий. Полностью заменяет текущий мир
 * (можно вызывать повторно без перезагрузки страницы — это и есть «Новая игра» из меню).
 * opts: {seed?, scenarioId?, difficulty?, colonyName?, leaderName?, leaderGender?, look? (внешность лидера),
 *        roster? (спеки пешек {name, gender, age, bio, traits, skills, look, role}; role 'leader' — лидер),
 *        biome?, w?, h?, colonists?, consist?, items?, ...любые поля для scenario.apply}
 */
export function startNewColony(game, opts = {}) {
  const scenario = resolveScenario(game, opts.scenarioId);
  if (opts.scenarioId && scenario.id !== opts.scenarioId) console.warn(`[colony] нет сценария ${opts.scenarioId} — взят ${scenario.id}`);
  game.resetWorld('new');
  if (opts.seed !== undefined && opts.seed !== null && opts.seed !== '') game.reseed(opts.seed);
  const want = opts.difficulty || scenario.difficulty;
  const difficulty = want && game.defs.difficulties.has(want) ? want : DEFAULT_DIFFICULTY;
  Object.assign(game.colony, {
    name: opts.colonyName || game.t('colony.defaultName'),
    scenarioId: scenario.id,
    difficulty,
    flags: { ...(scenario.flags || {}) },
  });
  const train = new Train(game, opts.consist || scenario.consist || DEFAULT_CONSIST);
  const map = generateStation(game, {
    biome: opts.biome || scenario.biome || 'forest',
    w: Math.max(opts.w || scenario.w || 140, train.length + 8), // карта всегда вмещает поезд
    h: Math.max(opts.h || scenario.h || 90, 24),
    stationIndex: 0,
  });
  game.train = train;
  train.stamp(map.railY, Math.floor((map.w - train.length) / 2));

  const rng = game.rng.fork('colonists');
  const lang = game.i18n.lang;
  const res = train.carOfType('residential') || train.cars[0];
  const r = res.rect;
  const roster = Array.isArray(opts.roster) ? opts.roster.filter((x) => x && typeof x === 'object') : null;
  const leaderSpec = roster?.find((x) => x.role === 'leader') || null;
  const companions = roster ? roster.filter((x) => x !== leaderSpec) : null;

  // Лидер — маг-проводник: белобрысый, кудрявый, посох с кристаллом
  const leaderGender = (leaderSpec?.gender || opts.leaderGender) === 'female' ? 'female' : 'male';
  const leaderName = generateName(rng, lang, leaderGender); // имя генерируется всегда — поток RNG не зависит от выбора игрока
  const leaderAge = rng.int(26, 34);
  const leader = createPawn(game, {
    name: leaderName,
    gender: leaderGender,
    age: leaderAge,
    mage: true,
    color: LEADER_COLOR,
    hairColor: '#ffffff',
    speed: 4.4,
    dir: Math.PI / 2,
    light: { radius: 4.8, color: '#c8f6ff', intensity: 0.9, flicker: 0.05 },
    ...(scenario.leader || {}),
    ...(leaderSpec || {}),
    ...(opts.leaderName ? { name: opts.leaderName } : {}),
    look: normalizeLook({ ...(scenario.leader?.look || {}), ...(leaderSpec?.look || {}), ...(opts.look || {}) }),
    isLeader: true,
    controlled: 'player',
    x: r.x + Math.floor(r.w / 2) + 0.5,
    y: r.y + r.h + 1.5,
  });
  game.colony.leaderId = leader.id;

  const n = companions ? companions.length : Math.max(0, opts.colonists ?? scenario.colonists ?? 4);
  const inner = train.interior(res);
  const colonists = [];
  for (let i = 0; i < n; i++) {
    const gender = rng.chance(0.5) ? 'male' : 'female';
    const c = inner[(i * 7 + 3) % inner.length];
    const generated = {
      name: generateName(rng, lang, gender),
      gender,
      age: rng.int(18, 62),
      color: PAWN_COLORS[i % PAWN_COLORS.length],
      hairColor: rng.pick(['#3b2a20', '#d8b07a', '#1c1c24', '#8a4b2f', '#c9c3b8']),
      dir: rng.range(-Math.PI, Math.PI),
    };
    const spec = companions ? companions[i] : scenario.colonist ? scenario.colonist(game, i, rng) || {} : {};
    colonists.push(createPawn(game, { ...generated, ...spec, isLeader: false, controlled: 'ai', x: c.x + 0.5, y: c.y + 0.5 }));
  }

  // запасы
  const store = train.carOfType('storage') || train.cars[0];
  const cells = train.interior(store);
  const items = opts.items ?? scenario.items ?? STARTING_ITEMS;
  const missing = [];
  items.forEach(([id, count], i) => {
    if (!game.defs.items.has(id)) {
      missing.push(id);
      return;
    }
    const c = cells[(i * 2) % cells.length];
    game.items.spawn(id, count, c.x, c.y);
  });
  const silver = opts.silver ?? scenario.silver ?? 0;
  if (silver > 0) {
    if (game.defs.items.has('silver')) {
      const c = cells[(items.length * 2 + 1) % cells.length];
      game.items.spawn('silver', silver, c.x, c.y);
    } else game.colony.silver = (game.colony.silver || 0) + silver;
  }
  if (missing.length) console.warn(`[colony] сценарий ${scenario.id}: нет предметов ${missing.join(', ')} — пропущены`);

  if (scenario.apply) {
    try {
      scenario.apply(game, opts, { scenario, map, train, leader, colonists, rng });
    } catch (err) {
      game.error(err, `scenario:${scenario.id}`);
    }
  }

  game.events.emit(EVENTS.COLONY_STARTED, { seed: game.seed, biome: map.biome, scenarioId: scenario.id, difficulty, opts });
  game.api.ui.notify(game.t('hint.start'), { type: 'info' });
  return game;
}

export function registerColony(game) {
  game.defs.create('scenarios', { sortBy: 'order', defaults: { order: 100 } });
  game.defs.scenarios.addAll(CORE_SCENARIOS);
  game.defs.create('difficulties', { sortBy: 'order', defaults: { order: 100 } });
  game.defs.difficulties.addAll(CORE_DIFFICULTIES);

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
