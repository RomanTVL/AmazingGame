// Генерация карты стоянки по биому. Биом — запись в game.defs.biomes:
// { id, nameKey, palette: {...для рендера}, gen: {...параметры}, generate?(game, map, rng, opts) }
// Если у биома есть generate — он полностью заменяет стандартный генератор (модуль journey добавит
// пепельные пустоши, ледяные пики, руины станций и т.д.).
import { TileMap } from './map.js';
import { fbm, valueNoise } from '../core/noise.js';
import { TILE_FLAG } from '../core/constants.js';
import { EVENTS } from '../core/events.js';

export const CORE_BIOMES = [
  {
    id: 'forest',
    nameKey: 'biome.forest',
    palette: {
      bg: '#04060c',
      terrain: {
        grass: { base: '#0a1613', alt: '#0c1b16', speck: '#15382a', tuft: '#2fae6e' },
        dirt: { base: '#141009', alt: '#17120c', speck: '#2a1f14', tuft: null },
        stone: { base: '#101320', alt: '#121628', speck: '#262c44', tuft: null },
        water: { base: '#041127', alt: '#05142e', speck: '#0a2a52', edge: '#2bd9ff' },
        sand: { base: '#1a170f', alt: '#1d1a11', speck: '#2f2a1a', tuft: null },
        snow: { base: '#1a2232', alt: '#1d2638', speck: '#2c3850', tuft: null },
        ash: { base: '#131113', alt: '#161316', speck: '#2a2428', tuft: null },
      },
      rail: '#8fa0ff',
      rune: '#b77dff',
      fog: '#000208',
      nightTint: '#0a1030',
    },
    gen: {
      trees: { tree_pine: 5, tree_birch: 3, tree_oak: 1 },
      treeDensity: 0.56,
      bushDensity: 0.022,
      glowcapDensity: 0.012,
      waterLevel: 0.3,
      rockLevel: 0.7,
      oreChance: 0.1,
      manaChance: 0.04,
      railClear: 6,
    },
  },
];

export function registerBiomes(game) {
  game.defs.create('biomes');
  game.defs.biomes.addAll(CORE_BIOMES);
}

/**
 * Создать карту стоянки. Устанавливает game.map и заполняет её сущностями (деревья, камни).
 * @returns {TileMap}
 */
export function generateStation(game, opts = {}) {
  const biomeId = opts.biome || 'forest';
  const biome = game.defs.biomes.require(biomeId);
  const w = opts.w || 140;
  const h = opts.h || 90;
  const rng = game.rng.fork(`world:${biomeId}:${opts.stationIndex ?? 0}`);
  const map = new TileMap(game, w, h, biomeId);
  map.railY = opts.railY ?? Math.floor(h / 2);
  game.setMap(map);
  map.batch(() => {
    if (biome.generate) biome.generate(game, map, rng, opts);
    else defaultGenerate(game, map, rng, biome);
    // рельсы через всю карту
    for (let x = 0; x < w; x++) {
      const i = map.idx(x, map.railY);
      map.flags[i] |= TILE_FLAG.RAIL;
      if (x % 8 === 4) map.flags[i] |= TILE_FLAG.RAIL_RUNE;
    }
  });
  map.recomputeAll();
  game.events.emit(EVENTS.MAP_GENERATED, { map, biome: biomeId });
  return map;
}

function defaultGenerate(game, map, rng, biome) {
  const g = biome.gen;
  const s1 = rng.int(1, 1e9);
  const s2 = rng.int(1, 1e9);
  const s3 = rng.int(1, 1e9);
  const s4 = rng.int(1, 1e9);
  const T = (id) => game.defs.terrain.require(id).index;
  const GRASS = T('grass');
  const DIRT = T('dirt');
  const STONE = T('stone');
  const WATER = T('water');
  const SAND = T('sand');
  const treeIds = Object.keys(g.trees);
  const railY = map.railY;
  const clear = g.railClear ?? 6;

  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const i = map.idx(x, y);
      const dr = Math.abs(y - railY);
      const e = fbm(x / 26, y / 26, s1, 4);
      const m = fbm(x / 18 + 50, y / 18, s2, 3);
      // ближе к рельсам рельеф сглаживается
      const flat = dr <= clear + 2 ? 0.5 + (e - 0.5) * (dr / (clear + 2)) * 0.5 : e;
      let terr = GRASS;
      if (flat < g.waterLevel && dr > clear + 1) terr = WATER;
      else if (flat < g.waterLevel + 0.035 && dr > clear) terr = SAND;
      else if (flat > g.rockLevel - 0.04) terr = STONE;
      else if (m < 0.36) terr = DIRT;
      if (dr <= 1 && terr === GRASS && valueNoise(x / 3, y, s4) < 0.5) terr = DIRT; // утоптанная насыпь
      map.terrain[i] = terr;

      if (dr <= clear || terr === WATER) continue;
      // скалы и руда
      if (flat > g.rockLevel && terr === STONE) {
        let defId = 'rock';
        const r = rng.next();
        if (r < g.manaChance) defId = 'mana_vein';
        else if (r < g.manaChance + g.oreChance) defId = 'ore_iron';
        game.entities.spawn('building', { defId, x, y, natural: true });
        continue;
      }
      if (terr === SAND) continue;
      // лес
      const f = fbm(x / 13 + 200, y / 13 - 100, s3, 3);
      const forest = (f - (1 - g.treeDensity)) * 2.4 + (dr - clear) * 0.01;
      if (forest > 0 && rng.next() < Math.min(0.62, forest)) {
        const defId = rng.weighted(treeIds, (id) => g.trees[id]);
        game.entities.spawn('plant', { defId, x, y, growth: 1, variant: rng.int(0, 7) });
        continue;
      }
      if (rng.next() < g.bushDensity * (forest > -0.4 ? 1.6 : 0.6)) {
        game.entities.spawn('plant', { defId: 'bush_berry', x, y, growth: 1, variant: rng.int(0, 7) });
        continue;
      }
      if (forest > 0.05 && rng.next() < g.glowcapDensity * 3) {
        game.entities.spawn('plant', { defId: 'glowcap', x, y, growth: 1, variant: rng.int(0, 7) });
      }
    }
  }
}
