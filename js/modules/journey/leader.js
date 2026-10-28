// journey — забота о лидере под управлением игрока (MVP): лидер сам не ест и не спит, поэтому —
// предупреждения при голоде/усталости (уведомление + HUD) и «сам поест / приляжет», если игрок оставил его стоять
// без дела (нет ввода, нет задачи) и это безопасно (mayAutoCare). WASD отменяет (задача ручная).
import { makeEatJob, makeSleepJob } from '../../sim/needs.js';
import { notify, safe, bossPending, hours } from './state.js';

const HUNGRY = 0.3;
const STARVING = 0.15;
const TIRED = 0.2;
const EXHAUSTED = 0.1;
const IDLE_EAT = 120; // тиков стоять без дела (2 с при 1x)
const IDLE_SLEEP = 300;
const CAB_IDLE = 1200; // в кабине (у гудка) — ждать дольше (20 с при 1x)
const BOSS_SLEEP_H = 2; // не ложиться, если до босса станции меньше 2 ч
const BOSS_EAT_H = 1;
const BOSS_WAKE_H = 1; // прилёгший сам лидер встаёт за час до босса

/** Враги на карте (любые активные — не только рядом). */
function hostilesOnMap(game) {
  for (const e of game.entities.ofKind('pawn')) if (e.faction === 'enemy' && !e.dead && !e.downed && !e.prisoner && !e.leaving) return true;
  return false;
}

/**
 * Можно ли лидеру самому отойти поесть/поспать. Нельзя: враги на карте; на стоянке — посадка, а в кабине — пока
 * не простоит без дела CAB_IDLE (или не дошёл до предела);
 * сон — когда до босса станции меньше BOSS_SLEEP_H ч, еда — меньше BOSS_EAT_H ч (или он уже здесь).
 */
function mayAutoCare(J, L, kind) {
  const game = J.game;
  const S = J.S;
  if (hostilesOnMap(game)) return false;
  if (S.phase !== 'travel') {
    // сборы в путь: лидер у гудка в кабине — не уходит
    if (safe(J, 'boarding', () => game.api.journey.getTrainState?.()?.boarding, null)) return false;
    // в кабине — только если стоит без дела долго (игрок явно не собирается гудеть) или уже на пределе
    const dire = kind === 'eat' ? (L.needs.food ?? 1) < STARVING : (L.needs.rest ?? 1) < EXHAUSTED;
    if (!dire && J.R.leaderIdle < CAB_IDLE && safe(J, 'isInCab', () => game.api.journey.isInCab?.(L), false)) return false;
  }
  if (bossPending(J) && (S.boss.spawned || S.boss.at - game.time.tick < hours(kind === 'sleep' ? BOSS_SLEEP_H : BOSS_EAT_H))) return false;
  return true;
}

/** Будить ли лидера, прилёгшего самому: враги на карте или босс вот-вот (или уже здесь). */
function mustWake(J) {
  const S = J.S;
  if (bossPending(J) && (S.boss.spawned || S.boss.at - J.game.time.tick < hours(BOSS_WAKE_H))) return true;
  return hostilesOnMap(J.game);
}

export function leaderNeedsTick(J) {
  const game = J.game;
  const L = game.getLeader();
  if (!L || L.controlled !== 'player' || L.downed || !L.needs) return;
  const R = J.R;
  const food = L.needs.food ?? 1;
  const rest = L.needs.rest ?? 1;
  // предупреждения: один раз на каждое пересечение порога
  const warn = (key, cond, msg, type) => {
    if (cond && !R.warned[key]) {
      R.warned[key] = true;
      notify(J, msg, { name: L.name }, type, { pawnId: L.id });
    } else if (!cond) R.warned[key] = false;
  };
  warn('hungry', food < HUNGRY, 'journey.leader.hungry', 'bad');
  warn('starving', food < STARVING, 'journey.leader.starving', 'danger');
  warn('tired', rest < TIRED, 'journey.leader.tired', 'bad');
  warn('exhausted', rest < EXHAUSTED, 'journey.leader.exhausted', 'danger');
  // прилёг сам, а враг рядом / босс на подходе — подъём
  if (L.job?.type === 'sleep' && L.job.data?.autoCare && game.time.tick % 30 === 0 && mustWake(J)) {
    game.jobs.endJob(L, 'cancelled');
    notify(J, 'journey.leader.autoWake', { name: L.name }, 'danger', { pawnId: L.id });
  }
  // стоит без дела?
  const idle = !L.job && !(L.moveInput && (L.moveInput.x || L.moveInput.y));
  R.leaderIdle = idle ? R.leaderIdle + 1 : 0;
  if (!idle || game.time.tick % 30 !== 0) return;
  if (food < HUNGRY && R.leaderIdle >= IDLE_EAT && mayAutoCare(J, L, 'eat')) {
    const job = makeEatJob(game, L);
    if (job) {
      job.manual = true;
      if (game.jobs.startJob(L, job)) notify(J, 'journey.leader.autoEat', { name: L.name }, 'info', { pawnId: L.id });
    }
    return;
  }
  if (rest < TIRED && R.leaderIdle >= IDLE_SLEEP && mayAutoCare(J, L, 'sleep')) {
    const job = makeSleepJob(game, L);
    if (job) {
      job.manual = true;
      job.data.autoCare = true;
      if (game.jobs.startJob(L, job)) notify(J, 'journey.leader.autoSleep', { name: L.name }, 'info', { pawnId: L.id });
    }
  }
}

/** Строка для HUD (или null). */
export function leaderNeedsLine(game) {
  const L = game.getLeader();
  if (!L || L.controlled !== 'player' || !L.needs) return null;
  if ((L.needs.food ?? 1) < HUNGRY) return { key: 'journey.leader.hudHungry', bad: (L.needs.food ?? 1) < STARVING };
  if ((L.needs.rest ?? 1) < TIRED) return { key: 'journey.leader.hudTired', bad: (L.needs.rest ?? 1) < EXHAUSTED };
  return null;
}
