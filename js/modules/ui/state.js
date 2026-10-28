// Состояние модуля ui. S — сохраняемое (сериализатор 'ui'), R — runtime (кэши, выделение, тосты, облачка).
// Сюда же — подсчёт событий для «Итогов перегона», журнал причин авторитета/памяти, память о павших.
import { EVENTS } from '../../core/events.js';
import { TICKS_PER_HOUR } from '../../core/constants.js';
import { call, isReal, nameOf, hashPick, isColonistPawn } from './util.js';

const AUTH_KEEP = 12;

export function createSaved() {
  return {
    authLog: [], // [{delta, reason, value, tick}]
    memLog: [],
    fallen: [], // свой список павших (запасной к health.getFallen): [{id, name, age, cause, day, tick, wasLeader, color, left}]
    leg: null, // идущий перегон
    lastLeg: null, // итоги последнего перегона
    tutorial: { i: 0, done: {}, finished: false },
    raids: 0,
    peak: 0,
    boarding: null, // {untilTick, ids: number[], startTick}
    stations: 0,
  };
}

export function createRuntime() {
  return {
    selectedId: 0,
    hoverId: 0,
    hoverSince: 0,
    hoverCand: 0,
    toasts: [], // {entry, born, ttl}
    bubbles: new Map(), // pawnId → {text, born, ttl}
    markers: [], // {x, y, label, born, ttl, color}
    alerts: [],
    alertsAt: -1,
    breaks: new Map(), // pawnId → kind
    raid: null, // {faction, count, startTick}
    banner: null, // {text, sub, born, ttl, color, icon}
    realTime: 0,
    followByUi: 0,
    lastClick: { id: 0, t: 0 },
    pendingAutosave: null,
    legSample: { fuel: null },
    trainState: null,
    trainStateAt: -1,
    tutorialFlash: 0,
    leaderStart: null,
    regSeen: null,
  };
}

/** Снимок текущих пар «друзей» для итогов перегона: ['a:b', ...] (a < b). */
function friendPairs(game) {
  const out = [];
  for (const p of game.colonists()) {
    const rel = p.relations;
    if (!rel || typeof rel !== 'object') continue;
    for (const [oid, r] of Object.entries(rel)) {
      const id = Number(oid);
      if (!(id > p.id)) continue;
      const kind = r?.kind;
      if (kind === 'friend' || kind === 'lover' || kind === 'spouse' || (Number(r?.opinion) >= 60 && !kind)) out.push(`${p.id}:${id}`);
    }
  }
  return out;
}

/** Состояние поезда (реальный модуль train), кэш на кадр/тик. */
export function trainState(game, R) {
  if (!isReal(game, 'journey', 'getTrainState')) return null;
  const tick = game.time.tick;
  if (R.trainStateAt === tick && R.trainState) return R.trainState;
  R.trainState = call(game, 'journey', 'getTrainState', [], null);
  R.trainStateAt = tick;
  return R.trainState;
}

export function fuelAmount(game, R) {
  const f = isReal(game, 'journey', 'getFuel') ? call(game, 'journey', 'getFuel', [], null) : null;
  if (f && Number.isFinite(f.amount)) return f.amount;
  const ts = trainState(game, R);
  if (ts && Number.isFinite(ts.fuel)) return ts.fuel;
  return null;
}

export function travelling(game, R) {
  if (call(game, 'journey', 'isTravelling', [], false)) return true;
  const ts = trainState(game, R);
  return !!ts?.moving;
}

/**
 * Подписки, которые ведут сохраняемое состояние. M = {game, S(), R}.
 */
export function wireState(game, M) {
  const O = 'ui';
  const on = (n, f) => game.events.on(n, f, O);

  on(EVENTS.MIND_AUTHORITY_CHANGED, ({ value, delta, reason }) => {
    const S = M.S;
    S.authLog.push({ value, delta, reason: reason || '', tick: game.time.tick });
    if (S.authLog.length > AUTH_KEEP) S.authLog.splice(0, S.authLog.length - AUTH_KEEP);
  });
  on(EVENTS.HEALTH_MEMORY_CHANGED, ({ value, delta, reason }) => {
    const S = M.S;
    S.memLog.push({ value, delta, reason: reason || '', tick: game.time.tick });
    if (S.memLog.length > AUTH_KEEP) S.memLog.splice(0, S.memLog.length - AUTH_KEEP);
  });

  on(EVENTS.PAWN_DIED, ({ pawn, cause }) => {
    if (!pawn || pawn.faction !== 'colony' || pawn.animal) return;
    const S = M.S;
    if (S.fallen.some((f) => f.id === pawn.id)) return;
    const rec = { id: pawn.id, name: pawn.name, nameless: !!pawn.nameless, age: pawn.age, cause: cause || '', day: game.time.day, tick: game.time.tick, wasLeader: !!pawn.isLeader, color: pawn.color };
    S.fallen.push(rec);
    if (S.leg) S.leg.fallen.push(pawn.name);
    M.R.breaks.delete(pawn.id);
    if (M.R.selectedId === pawn.id) M.R.selectedId = 0;
  });
  on(EVENTS.JOURNEY_LEFT_BEHIND, ({ pawn }) => {
    if (!pawn) return;
    const S = M.S;
    if (!S.fallen.some((f) => f.id === pawn.id)) S.fallen.push({ id: pawn.id, name: pawn.name, age: pawn.age, cause: 'left', day: game.time.day, tick: game.time.tick, left: true, color: pawn.color });
    if (S.leg) S.leg.left.push(pawn.name);
  });

  on('mind:breakStarted', ({ pawn, kind }) => pawn && M.R.breaks.set(pawn.id, kind || 'break'));
  on('mind:breakEnded', ({ pawn }) => pawn && M.R.breaks.delete(pawn.id));
  on('combat:raidStarted', (e) => {
    M.R.raid = { faction: e?.faction || '', count: e?.count || 0, startTick: game.time.tick };
  });
  on('combat:raidEnded', () => {
    M.R.raid = null;
    M.S.raids++;
  });

  // посадка
  on(EVENTS.JOURNEY_BOARDING, (e) => {
    const ids = (Array.isArray(e?.missing) ? e.missing : []).map((m) => (typeof m === 'object' ? m?.id : m)).filter((x) => Number.isFinite(x));
    M.S.boarding = { untilTick: Number(e?.untilTick) || game.time.tick + 1800, ids, startTick: game.time.tick };
  });

  // перегон
  const startLeg = (station) => {
    const S = M.S;
    if (S.leg) return;
    S.leg = {
      from: stationName(game, station),
      startTick: game.time.tick,
      hours: 0,
      dist: 0,
      fuel: 0,
      jokes: {},
      jokeNames: {},
      friendsAtStart: friendPairs(game),
      fallen: [],
      left: [],
    };
    M.R.legSample.fuel = fuelAmount(game, M.R);
    M.S.boarding = null;
  };
  on('journey:departing', ({ station } = {}) => startLeg(station));
  on('journey:travelling', ({ from } = {}) => startLeg(from));
  on(EVENTS.MIND_SOCIAL, (e) => {
    const leg = M.S.leg;
    if (!leg || !e || e.kind !== 'joke' || !e.a) return;
    leg.jokes[e.a.id] = (leg.jokes[e.a.id] || 0) + 1;
    leg.jokeNames[e.a.id] = e.a.name;
  });
  on('journey:arrived', (e = {}) => {
    const S = M.S;
    S.stations++;
    const sum = finishLeg(game, M, e.station);
    S.lastLeg = sum;
    M.R.pendingAutosave = 'arrival';
    M.onLegFinished?.(sum);
  });
}

export function stationName(game, st) {
  if (!st) {
    const cur = call(game, 'journey', 'getStation', [], null);
    st = cur;
  }
  if (!st) return '';
  if (typeof st === 'string') return game.i18n.has(st) ? game.t(st) : st;
  if (st.name) return game.i18n.has(st.name) ? game.t(st.name) : st.name;
  if (st.nameKey) return game.t(st.nameKey);
  if (Number.isFinite(st.index)) return game.t('ui.leg.stationN', { n: st.index });
  return '';
}

/** Каждые 30 тиков — набегает путь/время/топливо перегона. */
export function sampleLeg(game, M) {
  const leg = M.S.leg;
  if (!leg) return;
  const R = M.R;
  if (travelling(game, R)) {
    const ts = trainState(game, R);
    const dtH = 30 / TICKS_PER_HOUR;
    leg.hours += dtH;
    const sp = Number(ts?.speed);
    leg.dist += (Number.isFinite(sp) ? sp : 1) * 10 * dtH;
  }
  const f = fuelAmount(game, R);
  if (f !== null && R.legSample.fuel !== null && f < R.legSample.fuel) leg.fuel += R.legSample.fuel - f;
  R.legSample.fuel = f;
}

function finishLeg(game, M, station) {
  const S = M.S;
  const leg = S.leg || {
    from: '', startTick: Math.max(0, game.time.tick - TICKS_PER_HOUR * 12), hours: 0, dist: 0, fuel: 0, jokes: {}, jokeNames: {}, friendsAtStart: friendPairs(game), fallen: [], left: [],
  };
  S.leg = null;
  // кто шутил больше всех
  let best = null;
  for (const [id, n] of Object.entries(leg.jokes)) if (!best || n > best.n || (n === best.n && Number(id) < best.id)) best = { id: Number(id), n };
  const jp = best ? game.entities.get(best.id) : null;
  const joker = best ? { name: jp ? nameOf(game, jp) : leg.jokeNames[best.id] || '?', n: best.n } : null;
  // новые дружбы
  const before = new Set(leg.friendsAtStart);
  const now = friendPairs(game);
  const friends = [];
  for (const k of now) {
    if (before.has(k)) continue;
    const [a, b] = k.split(':').map(Number);
    const A = game.entities.get(a);
    const B = game.entities.get(b);
    if (A && B) friends.push(`${nameOf(game, A)} — ${nameOf(game, B)}`);
  }
  // случайная цитата из журнала за перегон (без ГСЧ симуляции: хеш от тика)
  const pool = game.log.filter((e) => e && e.tick >= leg.startTick && typeof e.text === 'string' && e.text.length > 12 && e.text.length < 220);
  const quote = pool.length ? pool[hashPick(leg.startTick + pool.length * 7, pool.length)].text : '';
  const distApi = Number(station?.distance ?? station?.dist);
  return {
    from: leg.from,
    to: stationName(game, station),
    dist: Number.isFinite(distApi) && distApi > 0 ? distApi : leg.dist,
    hours: leg.hours > 0 ? leg.hours : (game.time.tick - leg.startTick) / TICKS_PER_HOUR,
    fuel: leg.fuel,
    joker,
    friends: friends.slice(0, 4),
    fallen: leg.fallen.slice(),
    left: leg.left.slice(),
    quote,
    day: game.time.day,
    tick: game.time.tick,
  };
}

/** Обновить пиковое число поселенцев (для финальной статистики). */
export function trackPeak(game, S) {
  let n = 0;
  for (const p of game.entities.ofKind('pawn')) if (isColonistPawn(p)) n++;
  if (n > S.peak) S.peak = n;
}
