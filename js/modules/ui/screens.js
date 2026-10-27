// Полноэкранные экраны модуля ui (только отрисовка, браузер): главное меню (фон — поезд ночью), новая игра,
// сохранения/загрузка, настройки, пауза, конец игры, победа. Логика действий — M.act (index.js).
// Координаты — единицы UI Kit (CSS px / uiScale). Клики — из захвата экрана (Kit mode 'screen').
import { C, SERIF, MONO } from './kit.js';
import { MenuScene } from './scenes.js';
import { call, isReal, nameOf, savedAtText } from './util.js';
import { TUTORIAL_SETTING } from './tutorial.js';

const BTN_H = 44;

export function drawScreens(ctx, game, M, view) {
  const R = M.R;
  const id = R.screen[R.screen.length - 1];
  if (!id) return;
  const k = M.kit;
  k.begin(ctx, 'screen');
  k.time = R.realTime;
  if (R.focusFor !== id) {
    R.focusFor = id;
    k.focus = null;
  }
  // фон
  if (R.screen[0] === 'main') {
    M.scene ||= new MenuScene();
    M.scene.draw(ctx, view.w, view.h, R.realTime, view.dt);
  } else {
    ctx.fillStyle = id === 'over' ? 'rgba(10,2,8,0.78)' : 'rgba(3,4,14,0.7)';
    ctx.fillRect(0, 0, view.w, view.h);
  }
  k.push(ctx);
  const W = view.w / k.s;
  const H = view.h / k.s;
  k.block(0, 0, W, H);
  k.beginFocus();
  const fn = SCREENS[id];
  if (fn) fn(ctx, game, M, W, H);
  drawMsg(game, M, W, H);
  k.pop(ctx);
  k.drawTip(ctx, view.w, view.h);
}

function drawMsg(game, M, W, H) {
  const m = M.R.msg;
  if (!m || M.R.realTime > m.until) return;
  const k = M.kit;
  const w = Math.min(560, k.measure(m.text, 14, 600) + 40);
  const a = Math.min(1, (m.until - M.R.realTime) * 2);
  k.ctx.globalAlpha = a;
  k.pill(W / 2 - w / 2, H - 70, w, 34, m.bad ? C.bad : C.cyan);
  k.text(m.text, W / 2, H - 53, { align: 'center', baseline: 'middle', size: 14, bold: true, color: m.bad ? C.bad : C.text });
  k.ctx.globalAlpha = 1;
}

/** Панель по центру с заголовком → внутренний прямоугольник. */
function centerPanel(M, W, H, w, h, title, accent = C.line, titleColor = C.cyan) {
  const x = Math.round((W - w) / 2);
  const y = Math.round(Math.max(20, (H - h) / 2));
  const r = M.kit.panel(x, y, w, h, { title, accent, titleColor, titleSize: 18, bg: C.bg2 });
  return { ...r, px: x, py: y, pw: w, ph: h };
}

// ---------- Главное меню ----------
function mainScreen(ctx, game, M, W, H) {
  const k = M.kit;
  const t = (key, v) => game.t(key, v);
  const x = Math.max(48, W * 0.08);
  let y = Math.max(40, H * 0.16);
  k.text(t('ui.title'), x, y, { size: Math.min(64, W * 0.05), bold: true, family: SERIF, color: '#f4eaff', glow: 18, glowColor: C.pink });
  y += Math.min(64, W * 0.05) + 16;
  k.text(t('ui.subtitle'), x + 2, y, { size: 16, color: C.ice, alpha: 0.85 });
  y = Math.max(y + 60, H * 0.4);
  const bw = 320;
  const latest = M.latestSave();
  const items = [
    ['new', t('ui.menu.newGame'), 'plus', null, false, () => M.act.open('new')],
    ['cont', t('ui.menu.cont'), 'play', latest ? slotMeta(game, latest) : t('ui.menu.contNone'), !latest, () => M.act.loadSlot(latest.slot)],
    ['load', t('ui.menu.load'), 'load', null, false, () => M.act.open('load')],
    ['settings', t('ui.menu.settings'), 'gear', null, false, () => M.act.open('settings')],
  ];
  for (const [id, label, icon, sub, disabled, fn] of items) {
    const h = sub ? 54 : BTN_H + 4;
    if (k.button(`main:${id}`, x, y, bw, h, label, { icon, sub, disabled, align: 'left', size: 17, accent: id === 'new' ? C.cyan : C.line })) fn();
    y += h + 12;
  }
  k.text(t('ui.hintNav'), x, H - 36, { size: 12, color: C.faint });
}

function slotMeta(game, s) {
  const m = s.meta || {};
  const when = savedAtText(game, m.savedAt);
  const main = game.t('ui.slots.meta', { day: m.day ?? '?', leader: m.leader || '—', n: m.colonists ?? '?' });
  return when ? `${main} · ${when}` : main;
}

export function slotName(game, slot) {
  if (slot === 'auto') return game.t('ui.slots.auto');
  if (slot === 'quick') return game.t('ui.slots.quick');
  const m = /^slot(\d+)$/.exec(slot);
  return m ? game.t('ui.slots.slot', { n: m[1] }) : slot;
}

// ---------- Новая игра ----------
function newGameScreen(ctx, game, M, W, H) {
  const k = M.kit;
  const t = (key, v) => game.t(key, v);
  const F = M.R.ng;
  const r = centerPanel(M, W, H, 580, 500, t('ui.ng.title'));
  let y = r.y + 4;
  // сценарий
  const sc = game.defs.scenarios.get(F.scenarioId);
  k.text(t('ui.ng.scenario'), r.x, y, { size: 12, color: C.dim });
  y += 18;
  k.text(sc ? t(sc.nameKey) : F.scenarioId, r.x, y, { size: 16, bold: true, color: C.gold });
  y += 24;
  if (sc?.descKey) y += k.para(t(sc.descKey), r.x, y, r.w, { size: 12, color: C.dim, maxLines: 3 }) + 8;
  y += 18;
  // поля
  const fw = (r.w - 16) / 2;
  F.colony = k.textField('ng:colony', r.x, y, fw, 34, F.colony, { label: t('ui.ng.colony'), placeholder: t('colony.defaultName'), maxLen: 28 });
  F.leader = k.textField('ng:leader', r.x + fw + 16, y, fw, 34, F.leader, { label: t('ui.ng.leader'), placeholder: t('ui.ng.leaderPh'), maxLen: 28 });
  y += 34 + 30;
  F.seed = k.textField('ng:seed', r.x, y, fw, 34, F.seed, { label: t('ui.ng.seed'), maxLen: 16 });
  if (k.button('ng:dice', r.x + fw + 8, y, 40, 34, '', { icon: 'dice', tooltip: t('ui.ng.reroll') })) F.seed = String(Math.floor(Math.random() * 1e9));
  y += 34 + 22;
  // сложность
  k.text(t('ui.ng.difficulty'), r.x, y, { size: 12, color: C.dim });
  y += 18;
  const diffs = game.defs.difficulties.all();
  const opts = diffs.map((d) => ({ id: d.id, label: t(d.nameKey), color: d.id === 'brutal' ? C.bad : d.id === 'hard' ? C.warn : d.id === 'easy' ? C.good : C.cyan }));
  const nd = k.chips('ng:diff', r.x, y, r.w, opts, F.difficulty, { h: 32 });
  if (nd) F.difficulty = nd;
  y += 42;
  const dd = game.defs.difficulties.get(F.difficulty);
  if (dd?.descKey) k.para(t(dd.descKey), r.x, y, r.w, { size: 12, color: C.dim, maxLines: 3 });
  // кнопки
  const by = r.py + r.ph - BTN_H - 18;
  if (k.button('ng:back', r.x, by, 150, BTN_H, t('ui.menu.back'), { icon: 'back' })) M.act.back();
  if (k.button('ng:start', r.x + r.w - 220, by, 220, BTN_H, t('ui.ng.start'), { icon: 'train', accent: C.cyan, size: 16 })) M.act.startNewGame();
}

// ---------- Сохранение / загрузка ----------
function slotsScreen(mode) {
  return (ctx, game, M, W, H) => {
    const k = M.kit;
    const t = (key, v) => game.t(key, v);
    const saving = mode === 'save';
    const list = M.slots();
    const rows = saving
      ? ['slot1', 'slot2', 'slot3'].map((slot) => list.find((s) => s.slot === slot) || { slot, meta: null })
      : list.slice().sort((a, b) => (b.meta?.savedAt || 0) - (a.meta?.savedAt || 0));
    const rowH = 58;
    const h = Math.min(H - 40, 120 + Math.max(1, rows.length) * (rowH + 8) + BTN_H);
    const r = centerPanel(M, W, H, 540, h, t(saving ? 'ui.slots.saveTitle' : 'ui.slots.loadTitle'));
    let y = r.y + 4;
    if (!rows.length) {
      k.text(t('ui.slots.none'), r.x, y + 10, { size: 14, color: C.dim });
    }
    const listH = r.py + r.ph - BTN_H - 30 - y;
    k.scrollArea(`slots:${mode}`, r.x, y, r.w, listH, rows.length * (rowH + 8), (sc) => {
      rows.forEach((s, i) => {
        const ry = y + i * (rowH + 8) - sc;
        const sub = s.meta ? slotMeta(game, s) : t('ui.slots.empty');
        const label = slotName(game, s.slot);
        if (k.button(`slot:${mode}:${s.slot}`, r.x, ry, r.w - 6, rowH, label, { sub, align: 'left', icon: saving ? 'save' : 'load', accent: s.slot === 'auto' ? C.gold : C.line })) {
          if (saving) M.act.saveSlot(s.slot);
          else M.act.loadSlot(s.slot);
        }
      });
    });
    if (k.button(`slots:${mode}:back`, r.x, r.py + r.ph - BTN_H - 18, 150, BTN_H, t('ui.menu.back'), { icon: 'back' })) M.act.back();
  };
}

// ---------- Настройки ----------
function settingsScreen(ctx, game, M, W, H) {
  const k = M.kit;
  const t = (key, v) => game.t(key, v);
  const set = game.settings;
  const r = centerPanel(M, W, H, 540, 440, t('ui.set.title'));
  let y = r.y + 4;
  k.text(t('ui.set.lang'), r.x + 10, y + 15, { baseline: 'middle', size: 14 });
  const lang = k.chips('set:lang', r.x + r.w * 0.42, y, r.w * 0.58, [
    { id: 'ru', label: 'Русский' },
    { id: 'en', label: 'English' },
  ], game.i18n.lang, { h: 30 });
  if (lang) set.set('lang', lang);
  y += 44;
  for (const [key, label] of [['masterVolume', 'ui.set.master'], ['musicVolume', 'ui.set.music'], ['sfxVolume', 'ui.set.sfx']]) {
    const v = Number(set.get(key));
    const nv = k.slider(`set:${key}`, r.x, y, r.w, t(label), Number.isFinite(v) ? v : 0.8, 0, 1, 0.05);
    if (nv !== undefined) set.set(key, nv);
    y += 42;
  }
  y += 6;
  const toggles = [
    ['rudeSpeech', 'ui.set.rude', 'ui.set.rudeTip'],
    ['shake', 'ui.set.shake', null],
    [TUTORIAL_SETTING, 'ui.set.tutorial', null],
  ];
  for (const [key, label, tip] of toggles) {
    const nv = k.toggle(`set:${key}`, r.x, y, r.w, t(label), set.get(key) !== false, { h: 34, tooltip: tip ? t(tip) : undefined });
    if (nv !== undefined) set.set(key, nv);
    y += 40;
  }
  if (k.button('set:back', r.x, r.py + r.ph - BTN_H - 18, 150, BTN_H, t('ui.menu.back'), { icon: 'back' })) M.act.back();
}

// ---------- Пауза ----------
function pauseScreen(ctx, game, M, W, H) {
  const k = M.kit;
  const t = (key, v) => game.t(key, v);
  const items = [
    ['resume', 'ui.pause.resume', 'play', () => M.act.closeAll()],
    ['save', 'ui.pause.save', 'save', () => M.act.open('save')],
    ['load', 'ui.pause.load', 'load', () => M.act.open('load')],
    ['settings', 'ui.pause.settings', 'gear', () => M.act.open('settings')],
    ['exit', 'ui.pause.exit', 'door', () => M.act.exitToMenu()],
  ];
  const h = 96 + items.length * (BTN_H + 10);
  const r = centerPanel(M, W, H, 360, h, t('ui.pause.title'));
  const sub = `${game.colony?.name || t('colony.defaultName')} · ${t('ui.pause.day', { day: game.time.day })}`;
  k.text(sub, r.x, r.y, { size: 13, color: C.dim, maxW: r.w });
  let y = r.y + 28;
  for (const [id, key, icon, fn] of items) {
    if (k.button(`pause:${id}`, r.x, y, r.w, BTN_H, t(key), { icon, align: 'left', danger: id === 'exit' })) fn();
    y += BTN_H + 10;
  }
}

// ---------- Конец игры / победа ----------
function causeText(game, rec) {
  if (rec.kind === 'left' || rec.left || rec.cause === 'left') return game.t('ui.over.left');
  const c = rec.cause || 'unknown';
  if (game.i18n.has(`health.cause.${c}`)) return game.t(`health.cause.${c}`);
  return String(c).replace(/_/g, ' ');
}

/** Павшие: список модуля health (если он есть), иначе свой. */
export function fallenList(game, M) {
  const h = isReal(game, 'health', 'getFallen') ? call(game, 'health', 'getFallen', [], null) : null;
  const list = Array.isArray(h) && h.length ? h : M.S.fallen;
  return list.filter((r) => !r.faction || r.faction === 'colony');
}

function drawFallen(game, M, x, y, w, h, list) {
  const k = M.kit;
  k.text(game.t('ui.over.fallen'), x, y, { size: 13, bold: true, color: C.violet });
  y += 24;
  h -= 24;
  if (!list.length) {
    k.para(game.t('ui.over.noFallen'), x, y, w, { size: 12, color: C.dim });
    return;
  }
  const rowH = 38;
  k.scrollArea('fallen', x, y, w, h, list.length * rowH, (sc) => {
    list.forEach((rec, i) => {
      const ry = y + i * rowH - sc;
      const col = rec.color || C.dim;
      k.ctx.fillStyle = col;
      k.ctx.beginPath();
      k.ctx.arc(x + 8, ry + 11, 5, 0, Math.PI * 2);
      k.ctx.fill();
      const name = rec.nameless ? '???' : rec.name || '???';
      k.text(rec.wasLeader ? `♔ ${name}` : name, x + 22, ry + 4, { size: 13, bold: true, color: C.text, maxW: w - 90 });
      k.text(game.t('ui.pause.day', { day: rec.day ?? '?' }), x + w - 10, ry + 5, { size: 11, align: 'right', color: C.faint, font: `11px ${MONO}` });
      k.text(causeText(game, rec), x + 22, ry + 21, { size: 11, color: C.dim, maxW: w - 30 });
    });
  });
}

function drawStats(M, x, y, w, rows) {
  const k = M.kit;
  for (const [label, value] of rows) {
    k.text(label, x, y, { size: 13, color: C.dim, maxW: w - 60 });
    k.text(String(value), x + w, y, { size: 14, bold: true, align: 'right', color: C.text, font: `600 14px ${MONO}` });
    k.sep(x, y + 22, w, C.line, 0.25);
    y += 30;
  }
  return y;
}

export function overStats(game, M) {
  const S = M.S;
  const st = call(game, 'journey', 'getState', [], null);
  const fallen = fallenList(game, M);
  return [
    [game.t('ui.stat.days'), game.time.day],
    [game.t('ui.stat.stations'), Number.isFinite(st?.step) ? st.step : S.stations],
    [game.t('ui.stat.raids'), S.raids],
    [game.t('ui.stat.peak'), S.peak],
    [game.t('ui.stat.jobs'), game.stats.jobsDone || 0],
    [game.t('ui.stat.dead'), fallen.filter((r) => !(r.kind === 'left' || r.left)).length],
  ];
}

function overScreen(ctx, game, M, W, H) {
  const k = M.kit;
  const t = (key, v) => game.t(key, v);
  const r = centerPanel(M, W, H, 700, 480, t('ui.over.title'), C.bad, '#ff8f9a');
  k.text(t('ui.over.sub', { day: M.R.lostDay ?? game.time.day }), r.x, r.y, { size: 14, color: C.text, family: SERIF });
  const top = r.y + 34;
  const colW = (r.w - 30) / 2;
  k.text(t('ui.over.stats'), r.x, top, { size: 13, bold: true, color: C.violet });
  drawStats(M, r.x, top + 28, colW, overStats(game, M));
  drawFallen(game, M, r.x + colW + 30, top, colW, r.py + r.ph - BTN_H - 40 - top, fallenList(game, M));
  const by = r.py + r.ph - BTN_H - 18;
  const bw = (r.w - 24) / 3;
  if (k.button('over:load', r.x, by, bw, BTN_H, t('ui.over.load'), { icon: 'load' })) M.act.open('load');
  if (k.button('over:new', r.x + bw + 12, by, bw, BTN_H, t('ui.over.newGame'), { icon: 'plus', accent: C.cyan })) M.act.open('new');
  if (k.button('over:menu', r.x + (bw + 12) * 2, by, bw, BTN_H, t('ui.over.menu'), { icon: 'door' })) M.act.exitToMenu();
}

function victoryScreen(ctx, game, M, W, H) {
  const k = M.kit;
  const t = (key, v) => game.t(key, v);
  const v = M.R.victory || {};
  const st = v.stats || {};
  const r = centerPanel(M, W, H, 700, 500, t('ui.win.title'), C.gold, C.gold);
  k.text(t('ui.win.sub'), r.x, r.y, { size: 15, color: C.text, family: SERIF });
  const top = r.y + 34;
  const colW = (r.w - 30) / 2;
  const fallen = fallenList(game, M);
  const rows = [
    [t('ui.stat.days'), st.day ?? game.time.day],
    [t('ui.stat.stations'), st.stations ?? M.S.stations],
    [t('ui.stat.survivors'), st.survivors ?? game.colonists().length],
    [t('ui.stat.left'), st.leftBehind ?? 0],
    [t('ui.stat.raids'), (st.raids || 0) + (st.ambushes || 0) + (st.rotWaves || 0) || M.S.raids],
    [t('ui.stat.dead'), fallen.filter((f) => !(f.kind === 'left' || f.left)).length],
  ];
  k.text(t('ui.over.stats'), r.x, top, { size: 13, bold: true, color: C.gold });
  let y = drawStats(M, r.x, top + 28, colW, rows) + 10;
  k.text(t('ui.win.survivors'), r.x, y, { size: 13, bold: true, color: C.gold });
  y += 22;
  const names = game.colonists().filter((p) => !p.animal).map((p) => nameOf(game, p)).join(', ');
  k.para(names || '—', r.x, y, colW, { size: 12, color: C.text, maxLines: 4 });
  drawFallen(game, M, r.x + colW + 30, top, colW, r.py + r.ph - BTN_H - 40 - top, fallen);
  const by = r.py + r.ph - BTN_H - 18;
  const bw = (r.w - 12) / 2;
  if (k.button('win:cont', r.x, by, bw, BTN_H, t('ui.win.cont'), { icon: 'play', accent: C.gold })) M.act.closeAll();
  if (k.button('win:menu', r.x + bw + 12, by, bw, BTN_H, t('ui.win.menu'), { icon: 'door' })) M.act.exitToMenu();
}

const SCREENS = {
  main: mainScreen,
  new: newGameScreen,
  load: slotsScreen('load'),
  save: slotsScreen('save'),
  settings: settingsScreen,
  pause: pauseScreen,
  over: overScreen,
  victory: victoryScreen,
};

export const SCREEN_IDS = Object.keys(SCREENS);
