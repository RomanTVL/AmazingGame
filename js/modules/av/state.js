// av — общее runtime-состояние модуля (не сохраняется, кроме того, что пишет сериализатор 'av').
// Время эффектов — РЕАЛЬНЫЕ секунды (S.now), чтобы анимации шли и на паузе/при хит-стопе.

export function createState(game) {
  const S = {
    game,
    /** Реальное время модуля, с (растёт в кадровой системе av:frame). */
    now: 0,
    frameNo: 0,
    /** Вспышки сущностей: id → {t0, dur, k} */
    flashes: new Map(),
    /** Социальные сцены: массив + индекс по пешке. */
    scenes: [],
    sceneOf: new Map(),
    /** Idle-анимации: id → {still, anim, t, cool, seed} */
    idle: new Map(),
    /** Холод/голод/температура (кэш раз в секунду): id → {cold, hungry, t} */
    body: new Map(),
    /** Позы: id → {pose, t0, tick0, until} — для дуги прыжка, броска лопаты и т.п. */
    poses: new Map(),
    /** Кудри (пружинные цепочки) лидера/наследника: id → curl sim */
    curls: new Map(),
    /** Кто кого несёт (перестраивается каждый кадр): carriedId → carrier */
    carriers: new Map(),
    /** Умирающие: id → {startTick, untilTick} */
    dying: new Map(),
    /** Последний кадр, в котором пешку нарисовал av: id → frameNo */
    drawn: new Map(),
    /** Погода. */
    weather: { kind: 'clear', intensity: 0, wind: 0.2, fog: 0, source: 'auto', since: 0 },
    /** Погода, переданная journey событием / setWeather: {kind, intensity, wind, untilTick} | null (сохраняется). */
    weatherOverride: null,
    /** Плавные значения для рендера погоды. */
    wx: { rain: 0, snow: 0, ash: 0, fog: 0, wind: 0.2, storm: 0, dark: 0 },
    lightning: { t: -10, next: 8, flash: 0, x: 0, y: 0 },
    /** Поезд: ритм стыков, качание, тормоза, топка. */
    rail: { dist: 0, joints: 0, jolt: 0, swing: 0, swingV: 0, cupT: -10, chuff: 0, wasMoving: false },
    braking: 0,
    blackSmokeUntil: -10,
    rotGlowUntil: -10,
    rotBehindTick: -1e9,
    boiler: 'ok',
    stokes: [],
    debris: [],
    arrival: null,
    deathFx: { t0: -10, dur: 0, amount: 0 },
    desat: { cur: 0, target: 0, until: -1 },
    screenFlash: { t0: -10, dur: 0.2, color: '#ffffff', alpha: 0 },
    music: null,
    forceMusic: null,
    deathMusicUntil: -10,
    /** Временные источники света: [{x, y, radius, color, intensity, t0, dur, flicker}] */
    lights: [],
    /** Всплывающие тексты. */
    floats: [],
    hitStopUntil: -1,
    raidActive: false,
    bossActive: false,
    _ts: null,
    _tsFrame: -1,
  };
  return S;
}

/** Сброс runtime-кэшей (новая игра / загрузка / смена станции). */
export function resetState(S, reason) {
  S.flashes.clear();
  S.scenes.length = 0;
  S.sceneOf.clear();
  S.idle.clear();
  S.body.clear();
  S.poses.clear();
  S.carriers.clear();
  S.dying.clear();
  S.drawn.clear();
  S.stokes.length = 0;
  S.debris.length = 0;
  S.lights.length = 0;
  S.floats.length = 0;
  S.raidActive = false;
  S.bossActive = false;
  S.braking = 0;
  S.blackSmokeUntil = -10;
  S.boiler = 'ok';
  if (reason !== 'station') {
    S.curls.clear();
    S.weatherOverride = null;
    S.rotBehindTick = -1e9;
    S.rotGlowUntil = -10;
    S.arrival = null;
  } else {
    // новая станция: кудри остаются (тот же лидер), погода journey — новая
    S.weatherOverride = null;
  }
  S.rail.dist = 0;
  S.rail.jolt = 0;
}
