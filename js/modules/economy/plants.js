// Растениеводство: культуры (картофель, хлебная трава, рунная тыква, лечебная трава, дремоцвет, кровавый мох),
// зона выращивания 'grow' на плодородной земле, ящики/гидролотки в вагонах, лампы роста.
// Цикл: посев (задача 'sow', работа «Растения») → рост раз в час (свет, влага, сезон, температура) →
// сбор (задача 'harvest_crop') → урожай (+ семена). Серая ржа (blight): game.api.economy.blight(opts).
import { resKey } from '../../sim/jobs.js';
import { OWNER, S, clamp, call, notify, report, hash01s, carFurnitureCells, cellFree } from './state.js';
import { idx, each } from './idx.js';

const k = (id) => `economy.plant.${id}`;

/** crop: {growDays, yield, minLight, maxLight?, damp?, seed?, seedChance?, contraband?} */
export const CROPS = [
  { id: 'crop_potato', color: '#d9b26f', leaf: '#7dff6a', crop: { growDays: 5, yield: { potato: 9 }, minLight: 0.3, work: 110 } },
  { id: 'crop_bread_grass', color: '#f2d98a', leaf: '#b4ff6a', crop: { growDays: 4, yield: { grain: 8, straw: 4 }, minLight: 0.3, work: 120 } },
  { id: 'crop_rune_pumpkin', color: '#ff9f43', leaf: '#3dffc5', crop: { growDays: 8, yield: { rune_pumpkin: 3 }, minLight: 0.35, seed: 'seeds_rune_pumpkin', seedChance: 0.6, work: 160 }, light: { radius: 1.2, color: '#ff9f43', intensity: 0.35 } },
  { id: 'crop_healing_herb', color: '#7dff9a', leaf: '#5effc8', crop: { growDays: 6, yield: { healing_herb: 4 }, minLight: 0.3, work: 110 } },
  { id: 'crop_dremotsvet', color: '#c77dff', leaf: '#8f7dff', crop: { growDays: 7, yield: { dremotsvet: 5 }, minLight: 0.6, seed: 'seeds_dremotsvet', seedChance: 0.5, contraband: true, work: 140 } },
  { id: 'crop_blood_moss', color: '#ff3a5a', leaf: '#b0203a', crop: { growDays: 9, yield: { blood_moss: 4 }, minLight: 0, maxLight: 0.2, damp: true, seed: 'spores_blood_moss', seedChance: 0.5, contraband: true, work: 140 } },
];
export const CROP_IDS = CROPS.map((c) => c.id);

const SEASON_MUL = { spring: 1, summer: 1.15, autumn: 0.75, winter: 0 };

export function registerPlants(game, drawCrop) {
  for (const c of CROPS) {
    if (game.defs.plants.has(c.id)) continue;
    game.defs.plants.add({
      nameKey: k(c.id), blocksMove: false, blocksVision: false, pathCost: 1.15, choppable: false, harvestYield: null,
      regrowHours: Infinity, workToHarvest: c.crop.work, biomes: [], canopy: 0.32, bake: false, ...c,
      draw: (ctx, e, g, view, def) => drawCrop(ctx, e, g, view, def),
    }, OWNER);
  }
  if (!game.defs.zoneTypes.has('grow')) game.defs.zoneTypes.add({ id: 'grow', nameKey: 'economy.zone.grow', color: '#7dff6a', storage: false }, OWNER);

  registerJobs(game);
  game.events.on('time:hour', () => growHour(game), OWNER);
  game.events.on('colony:started', () => autoGarden(game), OWNER);
  game.events.on('train:stamped', () => furnishGreenhouses(game), OWNER);
}

// ---------------- среда: свет, влага, тепло ----------------
/** Освещённость клетки для растений 0..1 (средняя за сутки): солнце снаружи, окна вагона, лампы роста. */
export function plantLight(game, x, y) {
  const map = game.map;
  const i = map.idx(x, y);
  let sun = 0.9;
  if (map.roof[i] > 0) {
    sun = 0;
    for (const b of game.entities.queryRect(x - 2, y - 2, x + 2, y + 2, 'building')) {
      if (game.defs.buildings.get(b.defId)?.window) {
        sun = 0.42;
        break;
      }
    }
  }
  let lamp = 0;
  for (const id of idx(game).lamps) {
    const l = game.entities.get(id);
    if (!l) continue;
    const r = game.defs.buildings.get(l.defId)?.growLamp?.radius ?? 3.5;
    if ((l.x + 0.5 - x - 0.5) ** 2 + (l.y + 0.5 - y - 0.5) ** 2 <= r * r) {
      lamp = 0.95;
      break;
    }
  }
  return Math.max(sun, lamp);
}

export function plantDamp(game, x, y) {
  const b = game.map.buildingAt(x, y);
  if (b && game.defs.buildings.get(b.defId)?.planter?.damp) return true;
  const map = game.map;
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) if (map.inBounds(x + dx, y + dy) && map.terrainDef(x + dx, y + dy)?.water) return true;
  return false;
}

/** Температура у клетки, °C: снаружи — journey, в вагоне — + тепло вагона (+ теплица держит тепло). */
export function plantTemp(game, x, y) {
  let t = call(game, 'journey', 'getAmbientTemp');
  if (!Number.isFinite(t)) t = 15;
  const car = game.train?.carAt(x, y);
  if (car) {
    const h = call(game, 'journey', 'getCarHeat', car.index);
    t += Number.isFinite(h) ? h : 0;
    if (car.type === 'greenhouse') t += 8;
    else t += 3;
  }
  return t;
}

function tempMul(t) {
  if (t < 0) return 0;
  if (t < 8) return 0.5;
  if (t <= 32) return 1;
  if (t <= 40) return 0.6;
  return 0.2;
}

/** Плодородие клетки для посева (0 — нельзя): ящик/лоток или земля без пола. */
export function cellFertility(game, x, y) {
  const map = game.map;
  if (!map.inBounds(x, y)) return 0;
  const b = map.buildingAt(x, y);
  const bd = b && game.defs.buildings.get(b.defId);
  if (bd?.planter) return bd.planter.fertility ?? 1;
  if (b) return 0;
  if (map.floor[map.idx(x, y)]) return 0;
  const f = map.terrainDef(x, y)?.fertile ?? 0;
  const biomeMul = map.biome === 'ash' ? 0.6 : 1;
  return f >= 0.4 ? f * biomeMul : 0;
}

/**
 * Условия для культуры на клетке: {ok, light, damp, temp, why} — why: 'dark'|'bright'|'dry'|'cold'|'winter'|null.
 */
export function cropConditions(game, cropId, x, y) {
  const def = game.defs.plants.get(cropId);
  const c = def?.crop;
  if (!c) return { ok: false, why: 'none' };
  const light = plantLight(game, x, y);
  const damp = plantDamp(game, x, y);
  const temp = plantTemp(game, x, y);
  const outdoor = !(game.map.roof[game.map.idx(x, y)] > 0);
  let why = null;
  if (c.maxLight !== undefined && light > c.maxLight) why = 'bright';
  else if (light < (c.minLight ?? 0.3)) why = 'dark';
  else if (c.damp && !damp) why = 'dry';
  else if (temp < 0) why = 'cold';
  else if (outdoor && SEASON_MUL[game.time.season] === 0) why = 'winter';
  return { ok: !why, light, damp, temp, outdoor, why };
}

// ---------------- рост (раз в час) ----------------
function growHour(game) {
  if (!game.map) return;
  const x = idx(game);
  const season = SEASON_MUL[game.time.season] ?? 1;
  let blightSpread = null;
  for (const p of each(game, x.crops)) {
    const def = game.defs.plants.get(p.defId);
    const c = def?.crop;
    if (!c) continue;
    if (p.blight > 0) {
      p.blight = Math.min(1, p.blight + 0.07);
      if (p.blight >= 1) {
        game.entities.remove(p, 'blight');
        continue;
      }
      if (p.blight > 0.3) (blightSpread ||= []).push(p);
    }
    const cond = cropConditions(game, p.defId, p.x, p.y);
    p._why = cond.why;
    if (cond.temp < -2 && cond.outdoor) {
      p.frost = (p.frost || 0) + 0.12;
      if (p.frost >= 1) {
        game.entities.remove(p, 'frost');
        continue;
      }
    }
    if ((p.growth ?? 0) >= 1 || !cond.ok) continue;
    const fert = cellFertility(game, p.x, p.y) || 0.5;
    const sMul = cond.outdoor ? season : 1;
    const g = (fert * sMul * tempMul(cond.temp) * (p.blight > 0 ? 0.3 : 1)) / (c.growDays * 24);
    p.growth = Math.min(1, (p.growth ?? 0) + g);
  }
  // ржа расползается на соседние культуры
  if (blightSpread) {
    for (const p of blightSpread) {
      for (const n of game.entities.queryRect(p.x - 1, p.y - 1, p.x + 1, p.y + 1, 'plant')) {
        if (n === p || !(n.blight > 0 === false || !n.blight)) continue;
        if (!game.defs.plants.get(n.defId)?.crop) continue;
        if (game.rng.chance(0.1 * p.blight)) n.blight = 0.05;
      }
    }
  }
}

// ---------------- серая ржа ----------------
/** Заражение посевов. opts: {count = 3, x?, y?}. @returns {number} сколько растений заражено */
export function blight(game, opts = {}) {
  const list = [...each(game, idx(game).crops)].filter((p) => !(p.blight > 0));
  if (!list.length) return 0;
  const n = Math.max(1, Math.min(list.length, opts.count ?? 3));
  let pool = list;
  if (Number.isFinite(opts.x) && Number.isFinite(opts.y)) pool = list.sort((a, b) => (a.x - opts.x) ** 2 + (a.y - opts.y) ** 2 - ((b.x - opts.x) ** 2 + (b.y - opts.y) ** 2));
  else pool = game.rng.shuffle(list.slice());
  for (let i = 0; i < n; i++) pool[i].blight = 0.05;
  const p0 = pool[0];
  report(game, game.t('economy.blight.started'), { type: 'bad', x: p0.x, y: p0.y });
  game.events.emit('economy:blight', { count: n });
  return n;
}

// ---------------- задачи ----------------
function registerJobs(game) {
  const jobs = game.jobs;

  jobs.registerJobType({
    id: 'sow',
    workType: 'growing',
    labelKey: 'economy.job.sow',
    priority: 40,
    *findTargets(game, pawn) {
      for (const t of sowTargets(game)) {
        if (game.jobs.isReserved(resKey.cell(t.x, t.y), pawn)) continue;
        yield t;
      }
    },
    canDo(game, pawn, spec) {
      return canSowNow(game, spec.data.crop, spec.x, spec.y, pawn);
    },
    reserve: (g, p, job) => [resKey.cell(job.x, job.y)],
    makeToils(game, pawn, job) {
      return [
        { type: 'goto', x: job.x, y: job.y },
        {
          type: 'work', ticks: 100, workType: 'growing', x: job.x, y: job.y, fx: 'harvest',
          onDone: (g, p) => (sowCrop(g, job.data.crop, job.x, job.y, p) ? undefined : 'failed'),
        },
      ];
    },
  }, OWNER);

  jobs.registerJobType({
    id: 'harvest_crop',
    workType: 'growing',
    labelKey: 'economy.job.harvest',
    priority: 60,
    adjacent: true,
    *findTargets(game) {
      for (const p of each(game, idx(game).crops)) if ((p.growth ?? 0) >= 1 && !(p.blight > 0.25)) yield { x: p.x, y: p.y, targetId: p.id };
    },
    canDo: (game, pawn, spec) => {
      const p = game.entities.get(spec.targetId);
      return !!p && (p.growth ?? 0) >= 1;
    },
    makeToils(game, pawn, job) {
      const p = game.entities.get(job.targetId);
      const def = p && game.defs.plants.get(p.defId);
      return [
        { type: 'goto', targetId: job.targetId, adjacent: true },
        {
          type: 'work', ticks: def?.crop?.work ?? 120, workType: 'growing', targetId: job.targetId, fx: 'harvest',
          onDone: (g, pw) => {
            const plant = g.entities.get(job.targetId);
            if (!plant) return 'failed';
            harvestCrop(g, plant, pw);
            return undefined;
          },
        },
      ];
    },
  }, OWNER);

  jobs.registerJobType({
    id: 'cut_blight',
    workType: 'growing',
    labelKey: 'economy.job.cut_blight',
    priority: 70,
    adjacent: true,
    *findTargets(game) {
      for (const p of each(game, idx(game).crops)) if (p.blight > 0.15) yield { x: p.x, y: p.y, targetId: p.id };
    },
    makeToils(game, pawn, job) {
      return [
        { type: 'goto', targetId: job.targetId, adjacent: true },
        {
          type: 'work', ticks: 70, workType: 'growing', targetId: job.targetId, fx: 'chop',
          onDone: (g) => {
            const plant = g.entities.get(job.targetId);
            if (!plant) return 'failed';
            g.entities.remove(plant, 'cut_blight');
            return undefined;
          },
        },
      ];
    },
  }, OWNER);
}

/** Все клетки, где можно что-то посеять: [{x, y, data: {crop}}]. */
export function* sowTargets(game) {
  const map = game.map;
  if (!map) return;
  const x = idx(game);
  for (const b of each(game, x.planters)) {
    const crop = b.cropId;
    if (!crop) continue;
    for (let j = 0; j < (b.h || 1); j++)
      for (let i = 0; i < (b.w || 1); i++) {
        const cx = b.x + i;
        const cy = b.y + j;
        if (map.plant[map.idx(cx, cy)]) continue;
        yield { x: cx, y: cy, data: { crop } };
      }
  }
  for (const z of game.zones.zones.values()) {
    if (z.type !== 'grow' || !z.data?.crop) continue;
    for (const i of z.cells) {
      if (map.plant[i] || map.building[i]) continue;
      const cx = i % map.w;
      const cy = (i - cx) / map.w;
      yield { x: cx, y: cy, data: { crop: z.data.crop } };
    }
  }
}

export function canSowNow(game, cropId, x, y) {
  const def = game.defs.plants.get(cropId);
  if (!def?.crop || !game.map) return false;
  const map = game.map;
  if (map.plant[map.idx(x, y)]) return false;
  if (game.items.itemAt(x, y)) return false;
  if (cellFertility(game, x, y) <= 0) return false;
  const outdoor = !(map.roof[map.idx(x, y)] > 0);
  if (outdoor && SEASON_MUL[game.time.season] === 0) return false;
  if (plantTemp(game, x, y) < 0) return false;
  if (def.crop.seed && game.items.count(def.crop.seed) <= 0) return false;
  return true;
}

export function sowCrop(game, cropId, x, y, pawn) {
  if (!canSowNow(game, cropId, x, y, pawn)) return null;
  const def = game.defs.plants.get(cropId);
  if (def.crop.seed && !game.items.consume({ [def.crop.seed]: 1 }, x, y)) return null;
  const plant = game.entities.spawn('plant', { defId: cropId, x, y, growth: 0.02, variant: Math.floor(hash01s(`${x}:${y}:${game.time.tick}`) * 8), sownDay: game.time.day });
  game.events.emit('economy:sown', { pawn, plant });
  return plant;
}

export function harvestCrop(game, plant, pawn) {
  const def = game.defs.plants.get(plant.defId);
  const c = def?.crop;
  if (!c) return null;
  const { x, y } = plant;
  game.entities.remove(plant, 'harvested');
  const products = {};
  const skillMul = 0.85 + Math.min(20, call(game, 'mind', 'skillLevel', pawn, 'plants') ?? 3) * 0.02;
  for (const [id, n] of Object.entries(c.yield)) {
    if (!game.defs.items.has(id)) continue;
    const cnt = Math.max(1, Math.round(n * skillMul * (0.85 + game.rng.next() * 0.3)));
    game.items.spawn(id, cnt, x, y);
    products[id] = cnt;
  }
  if (c.seed && game.defs.items.has(c.seed) && game.rng.chance(c.seedChance ?? 0.5)) {
    const n = game.rng.int(1, 2);
    game.items.spawn(c.seed, n, x, y);
    products[c.seed] = n;
  }
  call(game, 'mind', 'learn', pawn, 'plants', 20);
  game.events.emit('economy:harvested', { pawn, plantDefId: plant.defId, products, x, y });
  return products;
}

// ---------------- обустройство на старте ----------------
/** Огород у полустанка, если в составе нет теплицы: 6×2 плодородных клеток рядом с поездом (картофель). */
function autoGarden(game) {
  const train = game.train;
  const map = game.map;
  if (!train?.stamped || !map) return;
  if (train.cars.some((c) => c.type === 'greenhouse')) return;
  const res = train.carOfType('residential') || train.cars[0];
  const r = res?.rect;
  if (!r) return;
  const cy0 = r.y + r.h + 3;
  for (let dy = 0; dy < 6; dy++)
    for (let off = 0; off < 30; off++) {
      for (const sgn of [1, -1]) {
        const x0 = r.x + sgn * off;
        const y0 = cy0 + dy;
        if (fitsGarden(game, x0, y0, 6, 2)) {
          const cells = [];
          for (let j = 0; j < 2; j++) for (let i = 0; i < 6; i++) cells.push([x0 + i, y0 + j]);
          game.zones.create('grow', cells, { name: game.t('economy.zone.garden'), data: { crop: 'crop_potato' } });
          return;
        }
      }
    }
}

function fitsGarden(game, x0, y0, w, h) {
  const map = game.map;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = x0 + i;
      const y = y0 + j;
      if (!map.inBounds(x, y) || cellFertility(game, x, y) < 0.6) return false;
      const k = map.idx(x, y);
      if (map.plant[k] || map.building[k] || map.roof[k] || game.zones.zoneAt(x, y)) return false;
      if (map.flags[k] & 1) return false;
      if (game.items.itemAt(x, y)) return false;
    }
  return true;
}

/** Вагон-теплица без мебели: ящики вдоль стен и две лампы роста (один раз на вагон). */
function furnishGreenhouses(game) {
  const train = game.train;
  if (!train?.stamped) return;
  for (const car of train.cars) {
    if (car.type !== 'greenhouse' || !car.rect) continue;
    car.data ||= {};
    if (car.data.economyFurnished) continue;
    car.data.economyFurnished = true;
    const r = car.rect;
    const cells = carFurnitureCells(game, car);
    const crops = ['crop_potato', 'crop_healing_herb', 'crop_bread_grass'];
    let n = 0;
    for (const c of cells) {
      if (c.y !== r.y + 1 && c.y !== r.y + r.h - 2) continue;
      if (c.x <= r.x + 1 || c.x >= r.x + r.w - 2) continue;
      if (!cellFree(game, c.x, c.y)) continue;
      const b = game.entities.spawn('building', { defId: 'planter', x: c.x, y: c.y, faction: 'colony' });
      b.cropId = crops[Math.floor(n / 3) % crops.length];
      n++;
    }
    for (const [lx, ly] of [[r.x + 3, r.y + 2], [r.x + r.w - 4, r.y + r.h - 3]]) {
      if (cellFree(game, lx, ly)) game.entities.spawn('building', { defId: 'grow_lamp', x: lx, y: ly, faction: 'colony' });
    }
  }
}

/** Причина «не растёт» для подсказки. */
export function whyText(game, why) {
  return why ? game.t(`economy.plant.why.${why}`) : '';
}

export { SEASON_MUL };
void clamp;
void notify;
void S;
