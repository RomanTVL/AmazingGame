// journey — генераторы: Пепельная пустошь (дюны, мёртвые деревья, трещины лавы, уголь), «полоса пути» (карта, на
// которой поезд едет между станциями) и дорисовка станций по типу (деревня, руины, тайники).
// Вызываются ядром из generateStation (js/sim/worldgen.js) через BiomeDef.generate(game, map, rng, opts).
import { fbm, valueNoise } from '../../core/noise.js';

const T = (game, id) => game.defs.terrain.require(id).index;

function natural(game, x, y, rng, g) {
  let defId = 'rock';
  const r = rng.next();
  const coal = game.defs.buildings.has('coal_seam') ? g.coalChance ?? 0.08 : 0;
  if (r < g.manaChance) defId = 'mana_vein';
  else if (r < g.manaChance + g.oreChance) defId = 'ore_iron';
  else if (r < g.manaChance + g.oreChance + coal) defId = 'coal_seam';
  if (!game.defs.buildings.has(defId)) defId = 'rock';
  game.entities.spawn('building', { defId, x, y, natural: true });
}

/** Пепельная пустошь. */
export function generateAsh(game, map, rng) {
  const g = game.defs.biomes.get('ash').gen;
  const s1 = rng.int(1, 1e9);
  const s2 = rng.int(1, 1e9);
  const s3 = rng.int(1, 1e9);
  const s4 = rng.int(1, 1e9);
  const s5 = rng.int(1, 1e9);
  const ASH = T(game, 'ash');
  const CINDER = T(game, 'cinder');
  const STONE = T(game, 'stone');
  const LAVA = T(game, 'lava_crack');
  const SAND = T(game, 'sand');
  const WATER = T(game, 'water');
  const DIRT = T(game, 'dirt');
  const railY = map.railY;
  const clear = g.railClear ?? 6;
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const i = map.idx(x, y);
      const dr = Math.abs(y - railY);
      const e = fbm(x / 30, y / 30, s1, 4);
      const flat = dr <= clear + 2 ? 0.5 + (e - 0.5) * (dr / (clear + 2)) * 0.5 : e;
      const dune = fbm(x / 9 + 100, y / 24, s2, 3);
      const ridge = 1 - Math.abs(2 * fbm(x / 17, y / 17, s3, 3) - 1);
      let terr = dune < 0.42 ? CINDER : ASH;
      if (flat < g.waterLevel && dr > clear + 1) terr = WATER;
      else if (flat < g.waterLevel + 0.04 && dr > clear) terr = SAND;
      else if (flat > g.rockLevel - 0.04) terr = STONE;
      else if (ridge > 0.95 && dr > clear + 3) terr = LAVA;
      if (dr <= 1 && valueNoise(x / 3, y, s4) < 0.55) terr = DIRT;
      map.terrain[i] = terr;
      if (dr <= clear || terr === WATER || terr === LAVA) continue;
      if (flat > g.rockLevel && terr === STONE) {
        natural(game, x, y, rng, g);
        continue;
      }
      if (terr === SAND) continue;
      const f = fbm(x / 14 + 200, y / 14 - 100, s5, 3);
      const grove = (f - (1 - g.treeDensity)) * 2.2 + (dr - clear) * 0.006;
      if (grove > 0 && rng.next() < Math.min(0.32, grove)) {
        game.entities.spawn('plant', { defId: 'dead_tree', x, y, growth: 1, variant: rng.int(0, 7) });
        continue;
      }
      if (rng.next() < g.bushDensity * (dune > 0.55 ? 1.6 : 0.6)) game.entities.spawn('plant', { defId: 'cinder_bush', x, y, growth: 1, variant: rng.int(0, 7) });
    }
}

/** Полоса пути: вся карта — непроходимая «пустота» (фон рисует слой journey с прокруткой). */
export function generateTravel(game, map) {
  map.terrain.fill(T(game, 'travel_void'));
}

/** Сделать клетки у поезда проходимыми (засада: поезд встал, бой у вагонов). */
export function layGravel(game, pad = 11) {
  const tr = game.train;
  const map = game.map;
  if (!tr?.stamped || !map) return;
  const top = tr.railY - 3;
  map.batch(() => {
    for (let y = Math.max(0, top - pad); y < Math.min(map.h, top + 7 + pad); y++)
      for (let x = Math.max(0, tr.x0 - pad); x < Math.min(map.w, tr.x0 + tr.length + pad); x++) map.setTerrain(x, y, 'gravel');
  });
}

/** Вернуть «пустоту» вокруг поезда (после засады). */
export function clearGravel(game) {
  const map = game.map;
  if (!map) return;
  const G = T(game, 'gravel');
  map.batch(() => {
    for (let i = 0; i < map.n; i++) if (map.terrain[i] === G) map.setTerrain(i % map.w, Math.floor(i / map.w), 'travel_void');
  });
}

// ---------------- дорисовка станции по типу ----------------

function freeRect(game, x0, y0, w, h) {
  const map = game.map;
  const tr = game.train;
  for (let y = y0 - 1; y <= y0 + h; y++)
    for (let x = x0 - 1; x <= x0 + w; x++) {
      if (!map.inBounds(x, y)) return false;
      if (tr?.carAt(x, y)) return false;
      if (Math.abs(y - map.railY) <= 7) return false;
      const td = map.terrainDef(x, y);
      if (!td || td.cost <= 0) return false;
      const b = map.buildingAt(x, y);
      if (b) return false;
    }
  return true;
}

function clearPlants(game, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const p = game.map.plantAt(x, y);
      if (p) game.entities.remove(p, 'cleared');
    }
}

function findSpot(game, rng, w, h, tries = 60) {
  const map = game.map;
  const cx = game.train?.center()?.x ?? map.w / 2;
  for (let k = 0; k < tries; k++) {
    const x = Math.floor(cx + rng.int(-40, 40) - w / 2);
    const side = rng.chance(0.5) ? -1 : 1;
    const y = Math.floor(map.railY + side * rng.int(9, 22) - h / 2);
    if (freeRect(game, x, y, w, h)) return { x, y };
  }
  return null;
}

function spawnB(game, defId, x, y) {
  if (!game.defs.buildings.has(defId) || game.map.buildingAt(x, y)) return null;
  const p = game.map.plantAt(x, y);
  if (p) game.entities.remove(p, 'cleared');
  return game.entities.spawn('building', { defId, x, y, natural: !!game.defs.buildings.get(defId).natural, station: true });
}

/** Хижина или развалины: периметр стен (keep — доля уцелевших), дверной проём, тайник внутри. */
function hut(game, rng, wallId, keep, cacheId) {
  const w = rng.int(5, 7);
  const h = rng.int(4, 6);
  const s = findSpot(game, rng, w, h);
  if (!s) return 0;
  clearPlants(game, s.x, s.y, w, h);
  const doorX = s.x + rng.int(1, w - 2);
  const doorY = rng.chance(0.5) ? s.y : s.y + h - 1;
  for (let y = s.y; y < s.y + h; y++)
    for (let x = s.x; x < s.x + w; x++) {
      const edge = x === s.x || y === s.y || x === s.x + w - 1 || y === s.y + h - 1;
      if (!edge || (x === doorX && y === doorY)) continue;
      if (rng.next() < keep) spawnB(game, wallId, x, y);
    }
  const c = spawnB(game, cacheId, s.x + Math.floor(w / 2), s.y + Math.floor(h / 2));
  if (c) game.designations.add('mine', c.x, c.y);
  return 1;
}

/** Тайник в чистом поле. */
function looseCache(game, rng, cacheId) {
  const s = findSpot(game, rng, 1, 1);
  if (!s) return 0;
  const c = spawnB(game, cacheId, s.x, s.y);
  if (c) game.designations.add('mine', c.x, c.y);
  return c ? 1 : 0;
}

/** Угольные пласты кучкой (2–5 штук). */
function coalCluster(game, rng, n) {
  const s = findSpot(game, rng, 3, 3);
  if (!s) return 0;
  let k = 0;
  for (let i = 0; i < 9 && k < n; i++) {
    const x = s.x + (i % 3);
    const y = s.y + Math.floor(i / 3);
    if (spawnB(game, 'coal_seam', x, y)) k++;
  }
  return k;
}

/**
 * Дорисовать станцию по типу: 'forest' — чаща (дерево, уголь мало), 'ash' — пустошь (уголь), 'village' — хижины с
 * припасами, 'ruins' — развалины с тайниками (опаснее). @returns {object} счётчики
 */
export function decorateStation(game, type, rng) {
  const out = { huts: 0, caches: 0, coal: 0 };
  if (!game.map) return out;
  if (type === 'village') {
    const n = rng.int(3, 4);
    for (let i = 0; i < n; i++) out.huts += hut(game, rng, 'hut_wall', 0.97, i === 0 ? 'cache_medicine' : 'cache_supplies');
    out.caches += looseCache(game, rng, 'cache_coal');
  } else if (type === 'ruins') {
    const n = rng.int(3, 5);
    for (let i = 0; i < n; i++) out.huts += hut(game, rng, 'ruin_wall', 0.55, ['cache_supplies', 'cache_medicine', 'cache_coal'][i % 3]);
    out.caches += looseCache(game, rng, 'cache_coal');
  } else if (type === 'ash') {
    out.coal += coalCluster(game, rng, rng.int(3, 5));
    out.caches += looseCache(game, rng, 'cache_supplies');
  } else {
    out.coal += coalCluster(game, rng, rng.int(2, 3));
    out.caches += looseCache(game, rng, 'cache_supplies');
  }
  return out;
}
