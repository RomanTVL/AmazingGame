// Индексы своих сущностей (станции, ящики, культуры, тайники, лампы, чайники, торговцы) — чтобы поиск работ
// не перебирал все постройки/растения карты. Строятся лениво; сбрасываются на world:reset/load:after.
import { S } from './state.js';

export function idx(game) {
  const rt = S(game).rt;
  if (!rt.idx) rt.idx = rebuild(game);
  return rt.idx;
}

function empty() {
  return { stations: new Set(), planters: new Set(), crops: new Set(), stashes: new Set(), lamps: new Set(), kettles: new Set(), barrels: new Set(), pawns: new Set() };
}

function classify(game, e, x) {
  if (e.kind === 'building') {
    const d = game.defs.buildings.get(e.defId);
    if (!d) return;
    if (d.econStation) x.stations.add(e.id);
    if (d.planter) x.planters.add(e.id);
    if (d.stash) x.stashes.add(e.id);
    if (d.growLamp) x.lamps.add(e.id);
    if (d.kettle) x.kettles.add(e.id);
    if (d.smellMask) x.barrels.add(e.id);
  } else if (e.kind === 'plant') {
    if (game.defs.plants.get(e.defId)?.crop) x.crops.add(e.id);
  } else if (e.kind === 'pawn') {
    if (e.econTrader || e.econInspector) x.pawns.add(e.id);
  }
}

function rebuild(game) {
  const x = empty();
  for (const kind of ['building', 'plant', 'pawn']) for (const e of game.entities.ofKind(kind)) classify(game, e, x);
  return x;
}

export function registerIndex(game) {
  const owner = 'economy';
  game.events.on('entity:spawned', ({ entity }) => {
    const x = S(game).rt.idx;
    if (x && (entity.kind === 'building' || entity.kind === 'plant' || entity.kind === 'pawn')) classify(game, entity, x);
  }, owner);
  game.events.on('entity:removed', ({ entity }) => {
    const x = S(game).rt.idx;
    if (!x) return;
    for (const set of Object.values(x)) set.delete(entity.id);
  }, owner);
  const reset = () => (S(game).rt.idx = null);
  game.events.on('load:after', reset, owner);
  game.events.on('station:changed', reset, owner);
  game.events.on('colony:started', reset, owner);
}

/** Сущности по множеству id (пропуская удалённые). */
export function* each(game, set) {
  for (const id of set) {
    const e = game.entities.get(id);
    if (e && !e.removed) yield e;
  }
}

/**
 * Индекс предметов на текущий тик: defId → [стопки] (без запрещённых и вещей «с историей»).
 * Строится один раз за тик при первом обращении.
 */
export function itemIndex(game) {
  const rt = S(game).rt;
  if (rt.itemIndexTick === game.time.tick && rt.itemIndex) return rt.itemIndex;
  const m = new Map();
  for (const it of game.entities.ofKind('item')) {
    let arr = m.get(it.defId);
    if (!arr) m.set(it.defId, (arr = []));
    arr.push(it);
  }
  rt.itemIndex = m;
  rt.itemIndexTick = game.time.tick;
  return m;
}
