// journey — генераторы биомов: Пепельные пустоши (дюны, мёртвые деревья, трещины лавы), Ледяные пики (снег, лёд,
// заснеженные сосны, замёрзшие озёра, скалы) и узкая «полоса пути» (карта, на которой поезд едет между станциями).
// Вызываются ядром из generateStation (js/sim/worldgen.js) через BiomeDef.generate(game, map, rng, opts).
import { fbm, valueNoise } from '../../core/noise.js';

const T = (game, id) => game.defs.terrain.require(id).index;

function natural(game, x, y, rng, g) {
  let defId = 'rock';
  const r = rng.next();
  const coal = game.defs.buildings.has('coal_seam') ? g.coalChance ?? 0.06 : 0;
  if (r < g.manaChance) defId = 'mana_vein';
  else if (r < g.manaChance + g.oreChance) defId = 'ore_iron';
  else if (r < g.manaChance + g.oreChance + coal) defId = 'coal_seam';
  game.entities.spawn('building', { defId, x, y, natural: true });
}

/** Пепельные пустоши. */
export function generateAsh(game, map, rng, opts = {}) {
  const g = { ...(game.defs.biomes.get('ash')?.gen || {}), coalChance: 0.1 };
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
  const lavaMul = opts.lavaMul ?? 1;
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
      else if (ridge > 1 - 0.05 * lavaMul && dr > clear + 3) terr = LAVA;
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
      if (ridge > 0.82 && rng.next() < 0.05) {
        game.entities.spawn('plant', { defId: 'ember_moss', x, y, growth: 1, variant: rng.int(0, 7) });
        continue;
      }
      if (rng.next() < g.bushDensity * (dune > 0.55 ? 1.6 : 0.6)) game.entities.spawn('plant', { defId: 'cinder_bush', x, y, growth: 1, variant: rng.int(0, 7) });
    }
}

/** Ледяные пики. */
export function generateIce(game, map, rng, opts = {}) {
  const g = { ...(game.defs.biomes.get('ice')?.gen || {}), coalChance: 0.05 };
  const s1 = rng.int(1, 1e9);
  const s2 = rng.int(1, 1e9);
  const s3 = rng.int(1, 1e9);
  const s4 = rng.int(1, 1e9);
  const SNOW = T(game, 'snow');
  const ICE = T(game, 'ice');
  const STONE = T(game, 'stone');
  const WATER = T(game, 'water');
  const DIRT = T(game, 'dirt');
  const railY = map.railY;
  const clear = g.railClear ?? 6;
  const peakBoost = opts.peaks ?? 0;
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const i = map.idx(x, y);
      const dr = Math.abs(y - railY);
      const e = fbm(x / 26, y / 26, s1, 5) + peakBoost * (dr / map.h);
      const flat = dr <= clear + 2 ? 0.5 + (e - 0.5) * (dr / (clear + 2)) * 0.5 : e;
      const lake = fbm(x / 21 + 300, y / 21, s2, 4);
      let terr = SNOW;
      if (flat > g.rockLevel - 0.05) terr = STONE;
      else if (lake < 0.33 && dr > clear + 1) terr = lake < 0.21 ? WATER : ICE;
      if (dr <= 1 && valueNoise(x / 3, y, s3) < 0.5) terr = DIRT;
      map.terrain[i] = terr;
      if (dr <= clear || terr === WATER || terr === ICE) continue;
      if (flat > g.rockLevel && terr === STONE) {
        natural(game, x, y, rng, g);
        continue;
      }
      const f = fbm(x / 12 + 200, y / 12 - 100, s4, 3);
      const forest = (f - (1 - g.treeDensity)) * 2.4 + (dr - clear) * 0.008;
      if (forest > 0 && rng.next() < Math.min(0.55, forest)) {
        game.entities.spawn('plant', { defId: 'snow_pine', x, y, growth: 1, variant: rng.int(0, 7) });
        continue;
      }
      if (rng.next() < g.bushDensity * (forest > -0.3 ? 1.5 : 0.5)) game.entities.spawn('plant', { defId: 'frost_bush', x, y, growth: 1, variant: rng.int(0, 7) });
    }
}

/**
 * Полоса пути: вся карта — непроходимая «пустота» (фон рисует слой journey с прокруткой), поезд стоит посередине.
 * Во время остановок journey делает полосу у рельсов проходимой (гравий).
 */
export function generateTravel(game, map) {
  const VOID = T(game, 'travel_void');
  map.terrain.fill(VOID);
}
