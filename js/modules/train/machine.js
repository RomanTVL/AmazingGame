// Локомотив как машина: фикстуры двигателя, угольный ларь и тендер, учёт топлива, модель котла (жар → давление → ход),
// рунный заряд, трещина котла, пожар на крыше (дрова на позициях 4–5), снимок состояния для API.
import { EVENTS } from '../../core/events.js';
import { TICKS_PER_HOUR, FACTION } from '../../core/constants.js';
import { clamp } from '../../core/math.js';
import {
  REG_SPEED, HEAT_DECAY, FUEL_HEAT, FUEL_IDS, VERSTS_PER_HOUR, MAX_HEAT, MAX_PRESSURE, VALVE_PRESSURE, CRACK_PRESSURE,
  CRACK_SECONDS, CRACK_DAMAGE, BOOST_PRESSURE, ACCEL, COAST, BUNKER_CELLS, RUNE, RUNE_CORE_IDS, STEAM_FIXTURES, RUNE_FIXTURES,
} from './constants.js';
import { rt, loco, ops, scen, hasUpgrade, isTravelling, isInLoco, inRect, notify, normalizeLoco, normalizeOps } from './state.js';

// ---------------- Фикстуры двигателя ----------------

export function desiredFixtures(engine) {
  return (engine === 'rune' ? RUNE_FIXTURES : STEAM_FIXTURES).map((f) => ({ ...f }));
}

/**
 * Привести фикстуры локомотива к типу двигателя. Для уже стоящего поезда — без полной перекладки:
 * лишние фикстуры снимаются, недостающие ставятся на месте (как это сделал бы stamp).
 * @returns {boolean} что-то менялось
 */
export function syncEngineFixtures(game) {
  const tr = game.train;
  const L = loco(game);
  const car = tr?.locomotive;
  if (!tr || !L || !car) return false;
  const want = desiredFixtures(L.engine);
  const same = car.replaceFixtures === true && JSON.stringify(car.fixtures || []) === JSON.stringify(want);
  if (!same) {
    car.replaceFixtures = true;
    car.fixtures = want;
  }
  if (!tr.stamped || !car.rect || !game.map) return !same;
  const r = car.rect;
  const present = [];
  for (const b of game.entities.queryRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, 'building')) {
    if (b.train && b.fixture && b.carId === car.id) present.push(b);
  }
  const key = (defId, x, y) => `${defId}@${x},${y}`;
  const wantKeys = new Set(want.map((f) => key(f.defId, r.x + f.dx, r.y + f.dy)));
  let changed = !same;
  for (const b of present) {
    if (!wantKeys.has(key(b.defId, b.x, b.y))) {
      game.entities.remove(b, 'train');
      changed = true;
    }
  }
  const haveKeys = new Set(present.filter((b) => !b.removed).map((b) => key(b.defId, b.x, b.y)));
  const def = tr.carDef(car);
  for (const f of want) {
    if (haveKeys.has(key(f.defId, r.x + f.dx, r.y + f.dy))) continue;
    if (!game.defs.buildings.has(f.defId)) continue;
    const x = r.x + f.dx;
    const y = r.y + f.dy;
    // предметы на месте новой фикстуры — рядом
    const bd = game.defs.buildings.get(f.defId);
    const [w, h] = game.entities.footprintSize(bd, f.rot || 0);
    const moved = [];
    for (const it of game.entities.queryRect(x, y, x + w - 1, y + h - 1, 'item')) moved.push(it);
    for (const it of moved) {
      const { defId, count, forbidden } = it;
      game.entities.remove(it, 'train');
      game.items.spawn(defId, count, r.x + 2, r.y + 3, { forbidden });
    }
    game.entities.spawn('building', {
      ...(f.props || {}), defId: f.defId, x, y, rot: f.rot || 0, train: true, fixture: true,
      carIndex: car.index, carId: car.id, tint: def.color,
    });
    changed = true;
  }
  if (changed) {
    tr.nudgePawns();
    tr.invalidateLights();
    rt(game).fireboxId = 0;
    rt(game).coreId = 0;
  }
  return changed;
}

/** Зона-ларь у топки (паровоз) и фильтры тендеров. Вызывается на каждом 'train:stamped'. */
export function ensureZones(game) {
  const tr = game.train;
  const L = loco(game);
  if (!tr?.stamped || !L) return;
  const zones = game.zones;
  const car = tr.locomotive;
  const all = [...zones.zones.values()];
  const bunker = car && all.find((z) => z.data?.bunker && z.data?.carId === car.id);
  if (L.engine === 'steam' && car?.rect && !bunker) {
    const r = car.rect;
    const cells = BUNKER_CELLS.map(([dx, dy]) => [r.x + dx, r.y + dy]).filter(([x, y]) => game.map.inBounds(x, y) && !game.map.buildingAt(x, y));
    if (cells.length) {
      zones.create('stockpile', cells, {
        name: game.t('train.zone.bunker'), priority: 4, color: '#ff8a3d', filter: { items: FUEL_IDS.slice() },
        data: { carIndex: car.index, carId: car.id, train: true, bunker: true },
      });
    }
  } else if (L.engine !== 'steam' && bunker) zones.remove(bunker);
  for (const c of tr.cars) {
    if (!tr.carDef(c).fuelOnly) continue;
    const z = all.find((zz) => zz.data?.carId === c.id && !zz.data?.bunker);
    if (z && !z.data.tender) {
      z.filter = { items: FUEL_IDS.slice() };
      z.data.tender = true;
      z.name = game.t('train.wagon.tender');
      z.color = '#c9a46b';
      zones._changed?.(z);
    }
  }
}

// ---------------- Поиск построек ----------------

function findInLoco(game, pred) {
  const car = game.train?.locomotive;
  const r = car?.rect;
  if (!r) return null;
  for (const b of game.entities.queryRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, 'building')) {
    if (!b.removed && pred(b) && b.x >= r.x && b.y >= r.y) return b;
  }
  return null;
}

export function firebox(game) {
  const R = rt(game);
  const e = R.fireboxId && game.entities.get(R.fireboxId);
  if (e && !e.removed && e.defId === 'firebox') return e;
  const b = findInLoco(game, (x) => x.defId === 'firebox');
  R.fireboxId = b?.id || 0;
  return b;
}

export function runeCore(game) {
  const R = rt(game);
  const e = R.coreId && game.entities.get(R.coreId);
  if (e && !e.removed && RUNE_CORE_IDS.includes(e.defId)) return e;
  const b = findInLoco(game, (x) => RUNE_CORE_IDS.includes(x.defId));
  R.coreId = b?.id || 0;
  return b;
}

export function boilerEntity(game) {
  return findInLoco(game, (x) => x.defId === 'steam_boiler');
}

// ---------------- Топливо ----------------

const FUEL_CAR_TYPES = new Set(['tender', 'storage', 'locomotive']);

/** Сколько топлива в тендере, складах и ларе локомотива: {coal, wood, mana_crystal, total, max, bunker}. Кэш 30 тиков. */
export function fuelStock(game, force = false) {
  const R = rt(game);
  const tick = game.time.tick;
  if (!force && R.fuelCache && tick - R.fuelTick < 30 && tick >= R.fuelTick) return R.fuelCache;
  const out = { coal: 0, wood: 0, mana_crystal: 0, total: 0, max: 0, bunker: 0 };
  const tr = game.train;
  if (tr?.stamped) {
    for (const car of tr.cars) {
      const r = car.rect;
      if (!r || !FUEL_CAR_TYPES.has(car.type) && !tr.carDef(car).locomotive) continue;
      for (const it of game.entities.queryRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, 'item')) {
        if (!inRect(r, it.x, it.y) || !FUEL_IDS.includes(it.defId)) continue;
        out[it.defId] += it.count;
        if (tr.carDef(car).locomotive) out.bunker += it.count;
      }
      if (tr.carDef(car).fuelOnly) out.max += (r.w - 2) * (r.h - 2) * 75;
    }
    if (loco(game)?.engine === 'steam') out.max += BUNKER_CELLS.length * 75;
  }
  out.total = out.coal + out.wood + out.mana_crystal;
  R.fuelCache = out;
  R.fuelTick = tick;
  return out;
}

export function invalidateFuel(game) {
  rt(game).fuelTick = -1e9;
}

export function fuelAllowed(game, defId) {
  const L = loco(game);
  return FUEL_IDS.includes(defId) && L?.fuelPolicy?.[defId] !== false;
}

/** Множитель «ценности» топлива: лопата, черты и вдохновение кочегара, улучшения, перки лидера. */
export function fuelValue(game, pawn, defId, quality) {
  let v = FUEL_HEAT[defId] ?? game.defs.items.get(defId)?.fuel?.heat ?? 5;
  if (quality === 'perfect') v *= 1.15;
  if (pawn && game.api.mind.hasTrait(pawn, 'son_of_engineer')) v *= 1.2;
  const insp = pawn?.inspiration;
  if (insp === 'stoker' || insp?.id === 'stoker' || insp?.kind === 'stoker') v *= 1.15;
  if (hasUpgrade(game, 'wide_grate')) v *= 1.1;
  v /= fuelMul(game);
  return v;
}

/** Перк лидера «Руны пути»: −10% топлива (perks.fuelMul 0.9). */
export function fuelMul(game) {
  const m = game.getLeader()?.perks?.fuelMul;
  return Number.isFinite(m) ? clamp(m, 0.5, 1.5) : 1;
}

// ---------------- Модель котла ----------------

/** Целевой жар для кочегаров: 50 + 8·регулятор (на стоянке — как на «0»). */
export function stokeTarget(game) {
  const L = loco(game);
  const reg = isTravelling(game) ? L.regulator : 0;
  return 50 + 8 * reg;
}

/** Работает ли кочегарка: паровоз цел и (в пути, идёт посадка или «разводим пары»). */
export function stokingActive(game) {
  const L = loco(game);
  if (!L || L.engine !== 'steam' || L.boilerState === 'cracked') return false;
  const O = ops(game);
  return isTravelling(game) || !!O?.boarding || !!L.raiseSteam;
}

export function crackLimit(game) {
  return CRACK_SECONDS * (hasUpgrade(game, 'reinforced_boiler') ? 2 : 1);
}

function setBoilerState(game, state) {
  const L = loco(game);
  if (L.boilerState === state) return;
  const prev = L.boilerState;
  L.boilerState = state;
  game.events.emit(EVENTS.JOURNEY_BOILER, { state, prev, pressure: L.pressure, heat: L.heat, boilerHp: L.boilerHp });
  if (state === 'valve') notify(game, game.t('train.note.valve'), 'bad', posOfFirebox(game));
}

function posOfFirebox(game) {
  const b = firebox(game) || boilerEntity(game);
  return b ? { x: b.x + 0.5, y: b.y + 0.5 } : {};
}

/** Трещина котла: −50 прочности, нет тяги, ожог ближайшего к топке. */
export function crackBoiler(game, reason = 'pressure') {
  const L = loco(game);
  if (!L || L.engine !== 'steam' || L.boilerState === 'cracked') return false;
  L.boilerHp = Math.max(0, L.boilerHp - (reason === 'pressure' ? CRACK_DAMAGE : 0));
  L.crackT = 0;
  L.pressure *= 0.35;
  const fb = firebox(game);
  if (fb) {
    let best = null;
    let bd = 8;
    for (const p of game.entities.queryRadius(fb.x + 0.5, fb.y + 0.5, 8, 'pawn')) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - fb.x - 0.5, p.y - fb.y - 0.5);
      if (d < bd || (d === bd && best && p.id < best.id)) {
        best = p;
        bd = d;
      }
    }
    if (best) game.api.health.applyDamage(best, 10, { type: 'burn', part: 'torso' });
    game.api.vision.noise(fb.x + 0.5, fb.y + 0.5, 25, 'explosion');
  }
  setBoilerState(game, 'cracked');
  game.api.av.play('train:crack', posOfFirebox(game));
  game.api.av.shake(0.6);
  notify(game, game.t('train.note.cracked'), 'danger', posOfFirebox(game));
  return true;
}

/** Ремонт котла (задача repair_boiler): трещина заделана, прочность восстановлена. */
export function repairBoiler(game) {
  const L = loco(game);
  if (!L) return false;
  L.boilerHp = 100;
  L.crackT = 0;
  if (L.boilerState === 'cracked') setBoilerState(game, 'ok');
  notify(game, game.t('train.note.repaired'), 'good', posOfFirebox(game));
  return true;
}

/** Урон котлу извне (таран завала, шлагбаума): ≤ 0 → трещина. */
export function damageBoiler(game, amount, reason = 'impact') {
  const L = loco(game);
  if (!L || L.engine !== 'steam' || !(amount > 0)) return L?.boilerHp ?? 0;
  L.boilerHp = Math.max(0, L.boilerHp - amount);
  if (L.boilerHp <= 0) crackBoiler(game, reason);
  return L.boilerHp;
}

/** Стоимость ремонта: 20 металла или 6 деталей (если их нет в игре — 20 железной руды). */
export function repairCosts(game) {
  const out = [];
  if (game.defs.items.has('metal')) out.push({ metal: 20 });
  if (game.defs.items.has('components')) out.push({ components: 6 });
  if (!out.length) out.push({ iron_ore: 20 });
  return out;
}

export function affordableRepairCost(game) {
  return repairCosts(game).find((c) => game.api.economy.canAfford(c)) || null;
}

/** Тиковая система локомотива (order 75). */
export function tickLoco(game, dt) {
  const L = game.train?.loco;
  if (!L || !game.map) return;
  const O = ops(game);
  const travelling = isTravelling(game);
  const reg = L.regulator | 0;
  const effReg = travelling ? reg : 0;
  const tick = game.time.tick;
  let target = 0;
  if (L.engine === 'steam') {
    const decay = HEAT_DECAY[effReg] * (hasUpgrade(game, 'lagging') ? 0.85 : 1);
    L.heat = clamp(L.heat - decay * dt, 0, MAX_HEAT);
    if (L.boilerState === 'cracked') {
      L.pressure = Math.max(0, L.pressure - 6 * dt);
      L.crackT = 0;
    } else {
      L.pressure = clamp(L.pressure + ((L.heat - 30) / 20 - 0.4 * effReg - 0.02 * L.pressure) * dt, 0, MAX_PRESSURE);
      if (L.pressure > CRACK_PRESSURE) L.crackT += dt;
      else L.crackT = 0;
      if (L.crackT >= crackLimit(game)) crackBoiler(game, 'pressure');
      else setBoilerState(game, L.pressure > VALVE_PRESSURE ? 'valve' : 'ok');
    }
    if (L.boilerState !== 'cracked') {
      const p = L.pressure;
      target = REG_SPEED[reg] * clamp(p / 40, 0, 1) * (p > BOOST_PRESSURE && reg >= 4 ? 1.1 : 1) * (tick < L.smokeUntil ? 0.9 : 1);
    }
  } else {
    L.heat = 0;
    L.pressure = 0;
    L.crackT = 0;
    if (L.boilerState !== 'ok') setBoilerState(game, 'ok');
    target = L.battery > 0 ? REG_SPEED[reg] : 0;
    if (travelling && reg > 0 && L.battery > 0) {
      const drain = (RUNE.drainPerHour * REG_SPEED[reg] ** 2 * fuelMul(game) * (hasUpgrade(game, 'rune_cells') ? 0.8 : 1) * dt * 60) / TICKS_PER_HOUR;
      L.battery = Math.max(0, L.battery - drain);
      if (L.battery <= 0) notify(game, game.t('train.note.batteryEmpty'), 'danger');
    }
  }
  if (!travelling) L.speed = 0;
  else {
    if (target > L.speed) L.speed = Math.min(target, L.speed + ACCEL * dt);
    else L.speed = Math.max(target, L.speed - COAST * dt);
    L.distance += (L.speed * VERSTS_PER_HOUR * dt * 60) / TICKS_PER_HOUR;
  }
  // тёплый кожух топки: def.heat читают build (тепло клетки) и mind (кот, «погреться у топки»)
  if (tick % 60 === 0) {
    const fd = game.defs.buildings.get('firebox');
    if (fd?.heat) fd.heat.warmth = Math.round(12 * clamp(L.heat / 40, 0, 1));
  }
  // пожар на крыше
  if (O?.roofFire) tickRoofFire(game, dt);
}

// ---------------- Пожар на крыше (искры дров) ----------------

/** Раз в игровой час: дрова + позиция 4–5 в пути → 5% «пожар на крыше» случайного вагона. */
export function hourlyFuelEffects(game) {
  const L = loco(game);
  const O = ops(game);
  if (!L || !O || L.engine !== 'steam' || O.roofFire) return;
  if (!isTravelling(game) || L.regulator < 4 || L.lastFuel !== 'wood' || L.speed < 0.05) return;
  if (hasUpgrade(game, 'spark_arrester')) return;
  if (!game.rng.chance(0.05)) return;
  const cars = game.train.cars.filter((c) => !game.train.carDef(c).locomotive && c.rect);
  if (!cars.length) return;
  startRoofFire(game, game.rng.pick(cars));
}

export function startRoofFire(game, car) {
  const O = ops(game);
  if (!O || !car) return false;
  O.roofFire = { carId: car.id, startTick: game.time.tick, hp: 100, hours: 0 };
  const name = game.t(game.train.carDef(car).nameKey);
  const r = car.rect;
  const pos = r ? { x: r.x + r.w / 2, y: r.y + 0.5 } : {};
  notify(game, game.t('train.note.roofFire', { car: name }), 'danger', pos);
  game.events.emit('journey:incident', { id: 'roof_fire', carId: car.id, source: 'train' });
  game.api.vision.noise(pos.x ?? 0, pos.y ?? 0, 10, 'cry');
  game.api.av.play('train:fire', pos);
  return true;
}

function tickRoofFire(game, dt) {
  const O = ops(game);
  const f = O.roofFire;
  const car = game.train.carById(f.carId);
  if (!car?.rect || f.hp <= 0) {
    O.roofFire = null;
    return;
  }
  const age = game.time.tick - f.startTick;
  if (age > 0 && age % TICKS_PER_HOUR === 0) {
    f.hours++;
    burnDamage(game, car);
    if (f.hours >= 3) {
      O.roofFire = null;
      notify(game, game.t('train.note.roofBurntOut', { car: game.t(game.train.carDef(car).nameKey) }), 'bad');
    }
  }
  void dt;
}

/** Час огня: горят дерево/ткань/еда в вагоне, кто внутри — обожжён. */
function burnDamage(game, car) {
  const r = car.rect;
  const flammable = [];
  for (const it of game.entities.queryRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, 'item')) {
    const d = game.defs.items.get(it.defId);
    if (d && (it.defId === 'wood' || d.category === 'material' || d.category === 'food' || it.defId === 'coal')) flammable.push(it);
  }
  for (const it of flammable) game.items.take(it, Math.max(1, Math.ceil(it.count * 0.15)));
  for (const p of game.entities.queryRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, 'pawn')) {
    if (!p.dead && p.faction === FACTION.COLONY) game.api.health.applyDamage(p, 2, { type: 'burn' });
  }
}

/** Тушение (шаг работы): −1/3 «здоровья» огня за тик работы одного человека. */
export function douseFire(game, amount) {
  const O = ops(game);
  const f = O?.roofFire;
  if (!f) return true;
  f.hp -= amount;
  if (f.hp <= 0) {
    const car = game.train.carById(f.carId);
    O.roofFire = null;
    notify(game, game.t('train.note.roofFireOut', { car: car ? game.t(game.train.carDef(car).nameKey) : '' }), 'good');
    return true;
  }
  return false;
}

// ---------------- Тепло вагонов ----------------

/** Тепло вагона над наружной температурой: паровоз (жар > 30) греет 1-й вагон за собой на +20, 2-й на +10. */
export function carHeat(game, carIndex) {
  const L = game.train?.loco;
  const tr = game.train;
  if (!L || !tr || L.engine !== 'steam' || L.heat <= 30) return 0;
  const li = tr.locomotive?.index;
  if (li === undefined) return 0;
  const behind = li - carIndex;
  if (behind === 1) return 20;
  if (behind === 2) return 10;
  return 0;
}

// ---------------- Состояние для API ----------------

export function rotGap(game) {
  const j = game.api.journey;
  for (const fn of ['getRotGapHours', 'getRotGap']) {
    if (typeof j[fn] !== 'function') continue;
    try {
      const v = j[fn]();
      if (Number.isFinite(v)) return v;
      if (v && Number.isFinite(v.hours)) return v.hours;
    } catch (err) {
      game.error(err, `train:journey.${fn}`);
    }
  }
  const pushed = game.train?.ops?.rotGap;
  if (pushed && Number.isFinite(pushed.hours)) return pushed.hours;
  const jd = game.train?.data?.journey;
  if (jd && Number.isFinite(jd.rotGapHours)) return jd.rotGapHours;
  return null;
}

/** Точный ли отрыв от Гнили: рунный передатчик или живой бывший культист (раскрытый). */
export function rotGapExact(game) {
  const R = rt(game);
  const tick = game.time.tick;
  if (tick - R.transmitterTick >= 120 || tick < R.transmitterTick) {
    R.transmitterTick = tick;
    let found = false;
    for (const b of game.entities.ofKind('building')) {
      if (b.defId === 'rune_transmitter' && !b.blueprint) {
        found = true;
        break;
      }
    }
    R.transmitter = found;
  }
  if (R.transmitter) return true;
  if (game.train?.ops?.rotGap?.exact) return true;
  const S = scen(game);
  if (S?.hidden?.trait === 'ex_cultist' && S.hidden.revealed) {
    const p = game.entities.get(S.hidden.pawnId);
    if (p && !p.dead && p.faction === FACTION.COLONY) return true;
  }
  return false;
}

export function noiseLevel(game) {
  const L = loco(game);
  if (!L || !isTravelling(game) || L.speed < 0.02) return 0;
  if (L.engine === 'rune') return Math.min(0.3, 0.06 * L.regulator);
  return L.regulator >= 4 ? 1 : 0.15 * L.regulator;
}

export function ambushMul(game) {
  const L = loco(game);
  if (!L) return 1;
  if (L.engine === 'rune') return 0.6;
  return L.lastFuel === 'coal' ? 1.2 : 1;
}

/** Снимок состояния локомотива (кэш на тик; не мутировать). */
export function trainState(game) {
  const R = rt(game);
  const tick = game.time.tick;
  if (R.stateSnap && R.stateTick === tick && R.stateSnap._train === game.train) return R.stateSnap;
  const L = game.train?.loco;
  if (!L) {
    return {
      engine: 'steam', moving: false, speed: 0, regulator: 0, heat: 0, pressure: 0, boilerState: 'ok', fuel: 0, battery: 0,
      noise: 0, rotGapHours: rotGap(game), rotGapExact: false,
    };
  }
  const travelling = isTravelling(game);
  const fuel = fuelStock(game);
  const O = ops(game);
  const leader = game.getLeader();
  const outOfFuel = L.engine === 'steam' ? fuel.total <= 0 : L.battery <= 0;
  const snap = {
    engine: L.engine,
    moving: travelling && L.speed > 0.01,
    speed: L.speed,
    regulator: L.regulator,
    heat: L.heat,
    pressure: L.pressure,
    boilerState: L.boilerState,
    fuel: fuel.total,
    battery: L.engine === 'rune' ? L.battery : 0,
    noise: noiseLevel(game),
    rotGapHours: rotGap(game),
    rotGapExact: rotGapExact(game),
    // дополнительно (train):
    travelling,
    vph: L.speed * VERSTS_PER_HOUR,
    boilerHp: L.boilerHp,
    overfeed: tick < L.smokeUntil,
    lastFuel: L.lastFuel,
    fuelBreakdown: { coal: fuel.coal, wood: fuel.wood, mana_crystal: fuel.mana_crystal },
    fuelMax: fuel.max,
    outOfFuel,
    stalled: travelling && L.speed < 0.02 && L.regulator > 0 && (outOfFuel || L.boilerState === 'cracked' || (L.engine === 'steam' && L.heat < 30)),
    ambushMul: ambushMul(game),
    heatTarget: L.engine === 'steam' ? stokeTarget(game) : 0,
    boarding: O?.boarding ? { untilTick: O.boarding.untilTick } : null,
    leaderInCab: isInLoco(game, leader),
    distance: L.distance,
    upgrades: L.upgrades.slice(),
  };
  Object.defineProperty(snap, '_train', { value: game.train, enumerable: false });
  R.stateSnap = snap;
  R.stateTick = tick;
  return snap;
}

export function getFuel(game) {
  const L = loco(game);
  if (!L) return null;
  if (L.engine === 'rune') return { kind: 'battery', amount: L.battery, max: 100 };
  const f = fuelStock(game);
  let kind = L.lastFuel;
  if (!kind) kind = f.coal >= f.wood && f.coal >= f.mana_crystal ? 'coal' : f.wood >= f.mana_crystal ? 'wood' : 'mana_crystal';
  return { kind, amount: f.total, max: f.max, coal: f.coal, wood: f.wood, mana_crystal: f.mana_crystal };
}

/** Создание/нормализация состояния (после загрузки и новой игры). */
export function ensureMachine(game) {
  const L = loco(game);
  const O = ops(game);
  if (!L || !O) return null;
  normalizeLoco(L);
  normalizeOps(O);
  return L;
}
