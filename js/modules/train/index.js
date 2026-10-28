/**
 * МОДУЛЬ train (MVP) — сценарий старта «Трое выживших», уголь в тендере и его расход в пути, гудок H (посадка,
 * отправление, двойной — «К оружию!»), отставшие, API поезда. Владелец: js/modules/train/** .
 * Контракт ядра: docs/ARCHITECTURE.md (§4 «Новая игра», §9 «Поезд», §13 «Действия E», §18 «API»).
 *
 * Файлы MVP: scenario.js (сценарии), defs.js (уголь, пласт, тендер, звуки), fuel.js (топливо), haul.js (подноска угля
 * в тендер, когда его мало), horn.js (гудок, посадка,
 * отправление, отставшие, окно подтверждения), strings.js; state.js — помощники (на борту, в кабине…).
 * Черновики на после MVP (не подключены): machine.js, stoke.js, constants.js — котёл, топка, регулятор, рунный двигатель,
 * депо, остальные сценарии.
 *
 * СОСТОЯНИЕ: game.train.ops = {boarding, confirm, leftBehind[], departures, fuelAcc, fuelBurnt} (JSON, сохраняется с поездом).
 * КЛАВИШИ: H — 'journey:horn' (ядро зарегистрировало на владельца train).
 * СОБЫТИЯ: 'journey:horn' {pattern: 'short'|'long'|'double'}, 'journey:boarding' {untilTick, missing},
 *          'journey:leftBehind' {pawn, station}, 'train:outOfFuel' {}.
 * API: game.api.journey (от train): getTrainState(), getFuel(), isInCab(pawn).
 *      game.api.train: startBoarding(opts), cancelBoarding(), depart({force}), confirmDepart(go), missing(), isAboard(p),
 *      fuelUnits(), usesFuel(), burnPerHour(), leftBehind().
 */
import { registerDefs } from './defs.js';
import { registerStrings } from './strings.js';
import { registerScenarios } from './scenario.js';
import { ops, isAboard } from './state.js';
import { fuelUnits, burnTick, usesFuel, legsLeft, FUEL_MAX, BURN_PER_HOUR } from './fuel.js';
import { registerFuelHauling } from './haul.js';
import {
  isInCab, missingPawns, startBoarding, cancelBoarding, depart, confirmDepart, boardingTick, hornInput, registerBoardingAI, registerHornInteraction,
  registerDepartPanel, resetHornRuntime,
} from './horn.js';

const OWNER = 'train';

export function register(game) {
  registerStrings(game);
  registerDefs(game);
  registerScenarios(game);
  registerBoardingAI(game);
  registerHornInteraction(game);
  registerFuelHauling(game);
  registerDepartPanel(game);

  const R = { fuelTick: -1e9, fuel: 0 };
  const cachedFuel = () => {
    const now = game.time.tick;
    if (now - R.fuelTick >= 30 || now < R.fuelTick) {
      R.fuelTick = now;
      R.fuel = game.train?.stamped ? fuelUnits(game) : 0;
    }
    return R.fuel;
  };
  const moving = () => {
    const f = game.api.journey.isMoving;
    return typeof f === 'function' ? !!f() : false;
  };

  // ---------- состояние ----------
  const on = (ev, fn) => game.events.on(ev, fn, OWNER);
  on('world:reset', ({ reason }) => {
    R.fuelTick = -1e9;
    resetHornRuntime(game);
    if (reason !== 'station' && game.train?.ops) game.train.ops.boarding = null;
  });
  on('colony:started', () => ops(game));
  on('train:stamped', () => {
    R.fuelTick = -1e9;
    // зона тендера — только топливо, важнее обычного склада
    const tender = game.train?.carOfType('tender');
    if (!tender) return;
    for (const z of game.zones.zones.values()) {
      if (z.data?.carId !== tender.id || z.data.fuelSet) continue;
      z.filter = { items: ['coal', 'wood'] };
      z.priority = 4;
      z.name = game.t('train.wagon.tender');
      z.data.fuelSet = true;
    }
  });
  on('game:init', () => {
    if (game.providers.mind?.registerThought) {
      game.api.mind.registerThought({ id: 'train_left_friend', mood: -8, hours: 72, stack: 3, label: { ru: 'Мы бросили своего', en: 'We abandoned one of ours' } });
    }
  });

  // ---------- системы ----------
  game.systems.add({
    id: 'train:fuel',
    order: 80,
    update(g) {
      const O = g.train?.ops;
      if (!O) return;
      if (!moving()) {
        O.outOfFuel = false;
        return;
      }
      if (O.outOfFuel) return;
      if (!burnTick(g)) {
        O.outOfFuel = true;
        R.fuelTick = -1e9;
        g.api.ui.notify(g.t('train.fuel.out'), { type: 'danger' });
        g.events.emit('train:outOfFuel', {});
      }
    },
  }, OWNER);
  game.systems.add({ id: 'train:boarding', order: 88, update: (g) => boardingTick(g) }, OWNER);
  game.frameSystems.add({ id: 'train:horn', order: 33, update: (g, dt) => hornInput(g, dt) }, OWNER);

  // ---------- API ----------
  game.provide('journey', {
    getTrainState() {
      const m = moving();
      const fuel = cachedFuel();
      return {
        engine: game.getScenario?.()?.engine === 'rune' ? 'rune' : 'steam',
        moving: m, speed: m ? 1 : 0, regulator: m ? 0.8 : 0, heat: m ? 70 : 20, pressure: m ? 60 : 0, boilerState: 'ok',
        fuel, battery: 100, noise: m ? 1 : 0.1, rotGapHours: null, rotGapExact: false,
        boarding: game.train?.ops?.boarding ? { untilTick: game.train.ops.boarding.untilTick } : null,
      };
    },
    getFuel() {
      if (!game.train) return null;
      return { kind: usesFuel(game) ? 'coal' : 'mana', amount: usesFuel(game) ? cachedFuel() : FUEL_MAX, max: FUEL_MAX };
    },
    isInCab: (pawn) => isInCab(game, pawn),
  }, OWNER);
  game.provide('train', {
    startBoarding: (opts) => startBoarding(game, opts || {}),
    cancelBoarding: () => cancelBoarding(game),
    depart: (opts) => depart(game, opts || {}),
    confirmDepart: (go) => confirmDepart(game, !!go),
    missing: () => missingPawns(game),
    isAboard: (p) => isAboard(game, p),
    fuelUnits: () => (game.train?.stamped ? fuelUnits(game) : 0),
    usesFuel: () => usesFuel(game),
    burnPerHour: () => (usesFuel(game) ? BURN_PER_HOUR : 0),
    leftBehind: () => (game.train?.ops?.leftBehind || []).slice(),
  }, OWNER);

  // ---------- HUD: топливо и посадка ----------
  game.ui.registerHud({
    id: 'train:fuel',
    slot: 'bottom-right',
    order: 5,
    height: (g) => (g.train && g.map ? (g.train.ops?.boarding && !g.train.ops.boarding.auto ? 50 : 28) : 0),
    draw(ctx, g, ui, box) {
      if (!g.train || !g.map) return 0;
      const T = ui.theme;
      const w = 250;
      const x = box.x - w;
      let y = box.y;
      const O = g.train.ops;
      const B = O?.boarding && !O.boarding.auto ? O.boarding : null;
      const h = B ? 46 : 24;
      ui.panel(x, y, w, h, { accent: '#ffb347' });
      if (usesFuel(g)) {
        const n = cachedFuel();
        const col = n <= 0 ? T.bad : n < 30 ? T.warn : T.text;
        ui.text(g.t('train.fuel.hud', { n }), x + 10, y + 5, { size: 13, bold: true, color: col });
        let need = null;
        if (typeof g.api.journey.fuelNeed === 'function') need = g.api.journey.fuelNeed();
        const right = need ? g.t('train.fuel.need', { need }) : n > 0 ? g.t('train.fuel.legs', { legs: legsLeft(n) }) : g.t('train.fuel.none');
        ui.text(right, x + w - 10, y + 6, { size: 12, color: need && n < need ? T.warn : T.dim, align: 'right' });
      } else ui.text(g.t('train.fuel.rune'), x + 10, y + 5, { size: 13, color: T.accent });
      if (B) {
        y += 24;
        const sec = Math.max(0, Math.ceil((B.untilTick - g.time.tick) / 60));
        ui.text(g.t('train.hud.boarding', { sec, n: missingPawns(g).length }), x + 10, y + 3, { size: 12, color: T.warn });
      }
      return h + 4;
    },
  }, OWNER);

}
