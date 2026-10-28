/**
 * МОДУЛЬ journey (MVP) — путь: маршрут из 4 станций с выбором из 2 вариантов на каждом шаге (карта F4), фаза «в пути»
 * (карта-полоса с прокруткой земли, развилка, засады), дикая стоянка без топлива, станции по биому (лес / пепельная
 * пустошь; типы лес / пустошь / деревня / руины), Гниль (таймер стоянки, наступление, гнилые волки), рассказчик
 * (рейды и 7 событий), Костяной дракон на станции 4 и победа 'game:victory'.
 * Локомотив, топливо, гудок/посадка, сценарии старта — у модуля train. Владелец: js/modules/journey/** .
 * Контракт ядра: docs/ARCHITECTURE.md (§8.3 генерация, §9.6 changeStation, §16 UI, §18 API, §19 сохранение).
 *
 * Файлы: route.js (маршрут), state.js (состояние, помощники), travel.js (отправление, путь, засада, дикая стоянка,
 * прибытие), rot.js (Гниль), teller.js (рейды, события, беженец), worldgen.js (пустошь, полоса пути, деревни/руины),
 * defs.js (ландшафт, биомы, растения, постройки, сложность), ui.js (HUD, F4, окна, слой пути), strings.js.
 * После MVP: 12 станций и 3 акта, ледяные пики, сюжет/лор/Попутчик в сером, фракции, концовки кроме одной.
 *
 * СОСТОЯНИЕ: сериализатор 'journey' (order 70); сброс на 'world:reset' {reason: 'new'|'load'}.
 * КЛАВИШИ: F4 — карта маршрута ('panel:route').
 * СОБЫТИЯ: 'journey:departing' {station}, 'journey:travelling' {from, to}, 'journey:arriving' {station},
 *          'journey:arrived' {station}, 'journey:incident' {id}, 'journey:rotAdvance' {level}, 'game:victory' {ending, stats}.
 * API (game.api.journey, от journey): getBiome, getStation, isTravelling, depart, getAmbientTemp; добавлено — canDepart,
 *   departHint, fuelNeed, isMoving, getRoute, choose(step, idx), answer(dialogId?, accept), getState (+ bossPending — босс станции впереди или на карте), debugState.
 * Лидер игрока: предупреждения о голоде/усталости, «сам поест/приляжет», если стоит без дела (leader.js).
 */
import { EVENTS } from '../../core/events.js';
import { registerDefs } from './defs.js';
import { registerStrings } from './strings.js';
import { generateRoute, BOSS_STEP, STEP_BIOME } from './route.js';
import { createState, stationInfo, targetOption, hours, notify, safe, bossPending } from './state.js';
import { canDepart, depart, choose, travelTick, wildStop, isTravelling, isMoving, fuelNeed, departHint } from './travel.js';
import { leaderNeedsTick } from './leader.js';
import { rotTick, startRotTimer, rotHoursFor, rotHoursLeft } from './rot.js';
import { tellerTick, startTeller, registerThoughts, answerDialog } from './teller.js';
import { registerUI } from './ui.js';

const OWNER = 'journey';

export function register(game) {
  const J = { game, S: createState(), R: freshRuntime() };
  registerStrings(game);
  registerDefs(game);
  registerUI(J);

  const on = (ev, fn) => game.events.on(ev, fn, OWNER);
  on(EVENTS.WORLD_RESET, ({ reason }) => {
    if (reason === 'station') return;
    J.S = createState();
    J.R = freshRuntime();
    J._rng = null;
  });
  on(EVENTS.COLONY_STARTED, () => {
    const S = J.S;
    S.route = generateRoute(game.rng.fork('journey:route'));
    S.stats.startTick = game.time.tick;
    startRotTimer(J, rotHoursFor(J, 0));
    startTeller(J);
    game.api.ui.setObjective('journey', game.t('journey.obj.start'));
  });
  on(EVENTS.GAME_INIT, () => registerThoughts(game));
  on('train:outOfFuel', () => wildStop(J));
  on('boss:defeated', (e) => {
    if (e?.id === 'bone_dragon' || J.S.step >= BOSS_STEP) victory(J);
  });

  // ---------- системы ----------
  game.systems.add({
    id: 'journey',
    order: 100,
    update() {
      const S = J.S;
      if (!S.route || !game.map) return;
      if (S.phase === 'travel') travelTick(J);
      else if (S.phase === 'station' || S.phase === 'wild') {
        rotTick(J);
        bossTick(J);
      }
      if (game.time.tick % 30 === 0) tellerTick(J);
      if (S.phase !== 'ended') leaderNeedsTick(J);
    },
  }, OWNER);

  // ---------- сохранение ----------
  game.save.registerSerializer({
    id: 'journey',
    order: 70,
    save() {
      if (J._rng) J.S.rng = J._rng.getState();
      return JSON.parse(JSON.stringify(J.S));
    },
    load(g, data) {
      J.S = { ...createState(), ...(data || {}) };
      J.R = freshRuntime();
      J._rng = null;
    },
  }, OWNER);

  // ---------- API ----------
  game.provide('journey', {
    getBiome: () => game.map?.biome === 'travel' ? targetOption(J)?.biome || STEP_BIOME[J.S.leg?.to] || 'forest' : game.map?.biome ?? 'forest',
    getStation: () => stationInfo(J),
    isTravelling: () => isTravelling(J),
    isMoving: () => isMoving(J),
    canDepart: () => canDepart(J),
    departHint: () => departHint(J),
    fuelNeed: () => fuelNeed(J),
    depart: () => depart(J),
    getAmbientTemp() {
      const biome = game.api.journey.getBiome();
      const base = biome === 'ash' ? 24 : 12;
      return base - (1 - (game.time.daylight ?? 1)) * 6;
    },
    getRoute: () => (J.S.route ? JSON.parse(JSON.stringify(J.S.route)) : null),
    choose: (step, idx) => choose(J, step, idx),
    answer: (id, accept) => answerDialog(J, id, accept),
    getState: () => ({
      phase: J.S.phase, step: J.S.step, choice: J.S.choice.slice(), leg: J.S.leg ? { ...J.S.leg } : null,
      rotLevel: J.S.rot.level, rotHoursLeft: rotHoursLeft(J), victory: !!J.S.victory, dialogs: J.S.dialogs.length,
      bossPending: bossPending(J), bossSpawned: !!J.S.boss.spawned, bossAt: J.S.boss.at,
    }),
    debugState: () => J,
  }, OWNER);

}

function freshRuntime() {
  return { expect: null, scroll: 0, speedVis: 0, openRoute: false, openDialog: false, showVictory: false, warned: {}, leaderIdle: 0 };
}

function bossTick(J) {
  const S = J.S;
  const game = J.game;
  if (S.phase !== 'station' || S.step < BOSS_STEP || S.boss.defeated || S.victory) return;
  const now = game.time.tick;
  if (!S.boss.spawned) {
    if (now < S.boss.at) return;
    const res = safe(J, 'spawnBoss', () => game.api.combat.spawnBoss?.('bone_dragon', {}), null);
    if (res) S.boss.spawned = true;
    else S.boss.at = now + hours(1);
    return;
  }
  // запасная проверка: дракона нет в живых (событие могло не прийти)
  if (now % 120 === 0) {
    const alive = game.entities.listKind('pawn').some((p) => p.boss?.id === 'bone_dragon' && !p.dead);
    if (!alive) victory(J);
  }
}

function victory(J) {
  const S = J.S;
  const game = J.game;
  if (S.victory || S.step < BOSS_STEP) return;
  S.boss.defeated = true;
  S.phase = 'ended';
  const survivors = game.colonists().length;
  const leftBehind = safe(J, 'leftBehind', () => game.api.train.leftBehind?.()?.length ?? 0, 0);
  S.victory = { tick: game.time.tick, day: game.time.day, survivors, leftBehind };
  const stats = { ...S.stats, day: game.time.day, survivors, leftBehind, stations: S.step };
  game.events.emit(EVENTS.GAME_VICTORY, { ending: 'bone_dragon', stats });
  game.api.av.play('journey_victory', {});
  notify(J, 'journey.victory.notify', {}, 'good');
  game.api.ui.setObjective('journey', game.t('journey.obj.victory'));
  J.R.showVictory = true;
}
