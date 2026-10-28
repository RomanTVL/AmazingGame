// journey — забота о лидере под управлением игрока (MVP): лидер сам не ест и не спит, поэтому —
// предупреждения при голоде/усталости (уведомление + HUD) и «сам поест / приляжет», если игрок оставил его стоять
// без дела (нет ввода, нет задачи, врагов рядом нет). WASD отменяет (задача ручная).
import { makeEatJob, makeSleepJob } from '../../sim/needs.js';
import { notify } from './state.js';

const HUNGRY = 0.3;
const STARVING = 0.15;
const TIRED = 0.2;
const EXHAUSTED = 0.1;
const IDLE_EAT = 120; // тиков стоять без дела (2 с при 1x)
const IDLE_SLEEP = 300;

function enemiesNear(game, p, r = 14) {
  return game.entities.queryRadius(p.x, p.y, r, 'pawn').some((e) => e.faction === 'enemy' && !e.dead && !e.downed && !e.prisoner);
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
  // стоит без дела?
  const idle = !L.job && !(L.moveInput && (L.moveInput.x || L.moveInput.y));
  R.leaderIdle = idle ? R.leaderIdle + 1 : 0;
  if (!idle || game.time.tick % 30 !== 0) return;
  if (food < HUNGRY && R.leaderIdle >= IDLE_EAT && !enemiesNear(game, L)) {
    const job = makeEatJob(game, L);
    if (job) {
      job.manual = true;
      if (game.jobs.startJob(L, job)) notify(J, 'journey.leader.autoEat', { name: L.name }, 'info', { pawnId: L.id });
    }
    return;
  }
  if (rest < TIRED && R.leaderIdle >= IDLE_SLEEP && !enemiesNear(game, L)) {
    const job = makeSleepJob(game, L);
    if (job) {
      job.manual = true;
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
