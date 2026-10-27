// Обучение: 6 подсказок на первой станции (WASD, рубка E, кровать B, «К оружию!» R, гудок H, карта F4).
// Подсказка засчитывается, когда игрок сделал действие (или нажал «Дальше»); выключается настройкой 'ui.tutorial'.
// Состояние — в сохраняемом S.tutorial {done: {id: true}, finished}; карточка — HUD слева (только отрисовка).
import { EVENTS } from '../../core/events.js';
import { C, MONO } from './kit.js';
import { call } from './util.js';

export const TUTORIAL_SETTING = 'ui.tutorial';

/** Шаги обучения: key — подпись клавиши, actions — удержание любого из действий засчитывает шаг. */
export const STEPS = [
  { id: 'move', key: 'WASD', actions: ['player:up', 'player:down', 'player:left', 'player:right'] },
  { id: 'chop', key: 'E' },
  { id: 'bed', key: 'B' },
  { id: 'arms', key: 'R', actions: ['player:callToArms'] },
  { id: 'horn', key: 'H', actions: ['journey:horn'] },
  { id: 'route', key: 'F4' },
];

function tut(M) {
  const S = M.S;
  if (!S.tutorial || typeof S.tutorial !== 'object') S.tutorial = { done: {}, finished: false };
  S.tutorial.done ||= {};
  return S.tutorial;
}

export function markDone(M, id) {
  const T = tut(M);
  if (T.finished || T.done[id]) return;
  T.done[id] = true;
  if (STEPS.every((s) => T.done[s.id])) {
    T.finished = true;
    M.R.tutDoneAt = M.game.time.tick;
  }
}

/** На первой станции (не в пути)? */
export function atFirstStation(game) {
  if (call(game, 'journey', 'isTravelling', [], false)) return false;
  const st = call(game, 'journey', 'getStation', [], null);
  return !st || ((st.index ?? 0) === 0 && (st.id ?? 'start') === 'start');
}

export function currentStep(M) {
  const T = tut(M);
  if (T.finished) return null;
  return STEPS.find((s) => !T.done[s.id]) || null;
}

/** Показывать ли карточку обучения сейчас. */
export function tutorialActive(M) {
  const game = M.game;
  if (game.settings.get(TUTORIAL_SETTING) === false) return false;
  if (!game.map || game.colony?.lost || !game.getLeader()) return false;
  if (M.R.screen.length) return false;
  if (!currentStep(M)) return false;
  return atFirstStation(game);
}

/** Подписки (засчитывание шагов по событиям). */
export function wireTutorial(game, M) {
  const O = 'ui';
  const on = (n, f) => game.events.on(n, f, O);
  on(EVENTS.PLAYER_INTERACT, ({ pawn } = {}) => {
    if (pawn && pawn === game.getLeader()) markDone(M, 'chop');
  });
  on(EVENTS.PLANT_CUT, ({ pawn } = {}) => {
    if (pawn && pawn === game.getLeader()) markDone(M, 'chop');
  });
  on('build:placed', ({ entity } = {}) => {
    const id = String(entity?.buildDefId || entity?.defId || '');
    if (/bed/.test(id)) markDone(M, 'bed');
  });
  on(EVENTS.PLAYER_CALL_TO_ARMS, () => markDone(M, 'arms'));
  on(EVENTS.JOURNEY_HORN, () => markDone(M, 'horn'));
  on(EVENTS.UI_PANEL_OPENED, ({ id } = {}) => {
    if (id === 'route') markDone(M, 'route');
  });
}

/** Кадр: нажатые клавиши шагов (isDown не зависит от того, кто поглотил нажатие). */
export function tutorialFrame(game, M) {
  if (M.R.screen.length || !game.map) return;
  const T = tut(M);
  if (T.finished) return;
  for (const s of STEPS) {
    if (T.done[s.id] || !s.actions) continue;
    if (s.actions.some((a) => game.input.isDown(a))) markDone(M, s.id);
  }
}

/** HUD-карточка обучения (слот 'left'). */
export function drawTutorial(ctx, game, M, box) {
  const k = M.kit;
  const T = tut(M);
  const step = currentStep(M);
  if (!step) return 0;
  k.begin(ctx, 'hud');
  k.time = M.R.realTime;
  k.push(ctx);
  const s = k.s;
  const x = box.x / s;
  const y = box.y / s;
  const w = 300;
  const text = game.t(`ui.tut.${step.id}`);
  const tw = w - 92;
  const th = k.paraHeight(text, tw, { size: 13 });
  const h = Math.max(96, 44 + th + 30);
  const i = STEPS.indexOf(step) + 1;
  const pulse = 0.5 + 0.5 * Math.sin(M.R.realTime * 3);
  // карточка не перехватывает мышь мира (кроме своих кнопок)
  k.panel(x, y, w, h, { accent: C.cyan, block: false, glowMul: 1 + pulse });
  k.text(game.t('ui.tut.head', { i, n: STEPS.length }), x + 14, y + 11, { size: 11, bold: true, color: C.cyan });
  // клавиша
  const kw = Math.max(46, k.measure(step.key, 16, 700, MONO) + 18);
  const kx = x + 14;
  const ky = y + 34;
  ctx.fillStyle = 'rgba(94,242,255,0.12)';
  ctx.strokeStyle = `rgba(94,242,255,${0.55 + 0.4 * pulse})`;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(kx, ky, Math.min(kw, 62), 40, 7) : ctx.rect(kx, ky, Math.min(kw, 62), 40);
  ctx.fill();
  ctx.stroke();
  k.text(step.key, kx + Math.min(kw, 62) / 2, ky + 20, { align: 'center', baseline: 'middle', font: `700 ${step.key.length > 3 ? 13 : 16}px ${MONO}`, color: '#fff' });
  k.para(text, x + 84, y + 32, tw, { size: 13, color: C.text });
  // кнопки
  if (k.button('tut:skip', x + w - 92, y + h - 30, 80, 22, game.t('ui.tut.skip'), { size: 11, focus: false, ghost: true })) markDone(M, step.id);
  if (k.button('tut:off', x + w - 28, y + 7, 18, 18, '×', { size: 12, focus: false, ghost: true, tooltip: game.t('ui.tut.off') })) game.settings.set(TUTORIAL_SETTING, false);
  // прогресс
  for (let j = 0; j < STEPS.length; j++) {
    ctx.fillStyle = T.done[STEPS[j].id] ? C.cyan : j === i - 1 ? 'rgba(94,242,255,0.5)' : 'rgba(140,147,184,0.3)';
    ctx.fillRect(x + 14 + j * 14, y + h - 18, 10, 3);
  }
  k.pop(ctx);
  return h * s;
}
