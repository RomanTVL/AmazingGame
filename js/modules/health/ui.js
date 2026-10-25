// Отрисовка и интерфейс health: панель «Здоровье» (F2) со схемой тела, «Павшие» (F8), надгробная речь,
// сцена смерти и последние слова (экранный слой), лежачие/несомые пешки, трупы по стадиям гниения, могилы, гроб,
// подсказки, HUD тревог. Всё DOM/Canvas — только внутри draw().
import { TILE, TICKS_PER_HOUR } from '../../core/constants.js';
import { drawGlow } from '../../render/glow.js';
import { rgba, mix } from '../../render/color.js';
import { drawPawnBody, drawLeader } from '../../render/pawns.js';
import { THEME, roundRect } from '../../engine/ui.js';
import { BODY_PARTS, PART, CAPACITIES } from './defs.js';
import { computeCache, PART_INDEX, tendNeed, condDef } from './model.js';
import { firstName, causeLabel } from './death.js';
import { rotStage, keptAt, activeFuneral, eulogyOptions } from './funeral.js';
import { availableOps, scheduleOp, isPatient } from './care.js';
import { getFallenById } from './death.js';
import { carriedOf } from './carry.js';

const T = TILE;
const RED = '#ff4f6d';
const YEL = '#ffd36b';
const GRN = '#3dffc5';

function effColor(e) {
  if (e >= 0.95) return GRN;
  if (e >= 0.5) return mix(YEL, GRN, (e - 0.5) / 0.45);
  return mix(RED, YEL, Math.max(0, e) / 0.5);
}

/** Перенос строки по ширине. */
function wrap(ui, text, maxW, size = 13, bold = false) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ui.measure(t, size, bold) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function yearsText(game, n) {
  const lang = game.i18n.lang;
  return `${n} ${game.i18n.plural(n, lang === 'ru' ? ['год', 'года', 'лет'] : ['year', 'years'])}`;
}

// ------------------------------------------------------------------ схема тела (координаты 160×300)
const SHAPES = {
  head: ['circle', 80, 30, 19],
  brain: ['circle', 80, 25, 9],
  eye_l: ['circle', 72, 31, 3.2],
  eye_r: ['circle', 88, 31, 3.2],
  ear_l: ['ellipse', 59, 31, 3.5, 6],
  ear_r: ['ellipse', 101, 31, 3.5, 6],
  jaw: ['rect', 70, 42, 20, 7],
  neck: ['rect', 73, 50, 14, 13],
  torso: ['rect', 52, 63, 56, 94],
  ribs: ['rect', 58, 72, 44, 26],
  spine: ['rect', 78, 66, 4, 88],
  heart: ['circle', 89, 86, 6],
  lung_l: ['ellipse', 67, 86, 7, 11],
  lung_r: ['ellipse', 99, 92, 5, 9],
  liver: ['ellipse', 68, 112, 9, 6],
  stomach: ['ellipse', 92, 114, 8, 6],
  kidney_l: ['ellipse', 66, 134, 4.5, 6],
  kidney_r: ['ellipse', 94, 134, 4.5, 6],
  shoulder_l: ['circle', 43, 71, 9],
  arm_l: ['rect', 31, 80, 13, 52],
  hand_l: ['rect', 29, 134, 15, 14],
  fingers_l: ['rect', 29, 149, 15, 8],
  shoulder_r: ['circle', 117, 71, 9],
  arm_r: ['rect', 116, 80, 13, 52],
  hand_r: ['rect', 116, 134, 15, 14],
  fingers_r: ['rect', 116, 149, 15, 8],
  leg_l: ['rect', 56, 159, 21, 86],
  foot_l: ['rect', 52, 247, 25, 11],
  toes_l: ['rect', 52, 260, 25, 6],
  leg_r: ['rect', 83, 159, 21, 86],
  foot_r: ['rect', 83, 247, 25, 11],
  toes_r: ['rect', 83, 260, 25, 6],
};
const DRAW_ORDER = ['torso', 'neck', 'head', 'jaw', 'shoulder_l', 'arm_l', 'hand_l', 'fingers_l', 'shoulder_r', 'arm_r', 'hand_r', 'fingers_r', 'leg_l', 'foot_l', 'toes_l', 'leg_r', 'foot_r', 'toes_r', 'ear_l', 'ear_r', 'ribs', 'spine', 'lung_l', 'lung_r', 'heart', 'liver', 'stomach', 'kidney_l', 'kidney_r', 'brain', 'eye_l', 'eye_r'];

function shapePath(ctx, s, ox, oy, k) {
  ctx.beginPath();
  if (s[0] === 'circle') ctx.arc(ox + s[1] * k, oy + s[2] * k, s[3] * k, 0, Math.PI * 2);
  else if (s[0] === 'ellipse') ctx.ellipse(ox + s[1] * k, oy + s[2] * k, s[3] * k, s[4] * k, 0, 0, Math.PI * 2);
  else roundRect(ctx, ox + s[1] * k, oy + s[2] * k, s[3] * k, s[4] * k, Math.min(5, s[3] * k * 0.3));
}

function inShape(s, ox, oy, k, mx, my) {
  const x = (mx - ox) / k;
  const y = (my - oy) / k;
  if (s[0] === 'circle') return (x - s[1]) ** 2 + (y - s[2]) ** 2 <= s[3] ** 2;
  if (s[0] === 'ellipse') return ((x - s[1]) / s[3]) ** 2 + ((y - s[2]) / s[4]) ** 2 <= 1;
  return x >= s[1] && x <= s[1] + s[3] && y >= s[2] && y <= s[2] + s[4];
}

function drawBody(ctx, game, ui, pawn, x, y, w, h, time) {
  const k = Math.min(w / 160, h / 275);
  const ox = x + (w - 160 * k) / 2;
  const oy = y + 4;
  const c = computeCache(game, pawn);
  const m = game.input.mouse;
  let hover = null;
  for (const id of DRAW_ORDER) {
    const s = SHAPES[id];
    const i = PART_INDEX[id];
    if (!s || i === undefined) continue;
    const internal = PART[id].internal > 0;
    let col;
    let dash = false;
    if (c.missing[i]) {
      col = '#5c6383';
      dash = true;
    } else if (c.prost[i] >= 0) col = '#5ef2ff';
    else if (c.covered[i]) col = '#4fb8c8';
    else col = effColor(c.eff[i]);
    shapePath(ctx, s, ox, oy, k);
    if (!c.missing[i]) {
      ctx.fillStyle = rgba(col, internal ? 0.32 : 0.14);
      ctx.fill();
    }
    ctx.setLineDash(dash ? [3, 3] : []);
    ctx.strokeStyle = rgba(col, internal ? 0.8 : 0.95);
    ctx.lineWidth = internal ? 1 : 1.6;
    ctx.stroke();
    ctx.setLineDash([]);
    if (!c.missing[i] && c.eff[i] < 0.6 && c.prost[i] < 0) {
      const sx = ox + s[1] * k + (s[0] === 'rect' ? (s[3] * k) / 2 : 0);
      const sy = oy + s[2] * k + (s[0] === 'rect' ? (s[4] * k) / 2 : 0);
      drawGlow(ctx, sx, sy, 16 * k, RED, (0.35 + 0.15 * Math.sin(time * 4)) * (1 - c.eff[i]));
    }
    if (ui.mouseIn(x, y, w, h) && inShape(s, ox, oy, k, m.sx, m.sy)) hover = id;
  }
  if (hover) {
    const i = PART_INDEX[hover];
    const lines = [{ text: game.t(`health.part.${hover}`), bold: true, color: THEME.accent }];
    if (c.missing[i]) lines.push({ text: game.t('health.ui.missing'), color: THEME.dim });
    else if (c.prost[i] >= 0) lines.push({ text: game.t('health.ui.prosthetic', { p: Math.round(c.prost[i] * 100) }), color: '#5ef2ff' });
    else lines.push({ text: game.t('health.ui.partState', { p: Math.round(c.eff[i] * 100) }), color: effColor(c.eff[i]) });
    for (const cd of pawn.health.conds) if (cd.part === hover) lines.push({ text: `• ${condLabel(game, cd)}`, color: condDef(game, cd.id)?.color || THEME.text });
    ui.tooltip(lines);
  }
}

function condLabel(game, cd) {
  const name = cd.label || (game.i18n.has(`health.cond.${cd.id}`) ? game.t(`health.cond.${cd.id}`) : cd.id);
  const def = condDef(game, cd.id);
  const kind = def?.kind || cd.kind;
  let extra = '';
  if (kind === 'injury') extra = ` ${Math.ceil(cd.sev)}`;
  else if (kind === 'disease' || kind === 'chronic') extra = ` ${Math.round((cd.sev ?? 0) * 100)}%`;
  if (cd.tq >= 0 && (kind === 'injury' || kind === 'fracture' || kind === 'disease' || kind === 'missing')) extra += ' ✚';
  return name + extra;
}

// ------------------------------------------------------------------ панель «Здоровье»
function selectedPawn(game, H) {
  let p = H.rt.selectedId ? game.entities.get(H.rt.selectedId) : null;
  if (!p || p.dead || p.removed) {
    p = game.player.hoveredColonist?.(game.getLeader()) || null;
    if (!p) p = game.getLeader();
    H.rt.selectedId = p?.id || 0;
  }
  return p;
}

function drawHealthPanel(ctx, game, ui, r, H) {
  const list = game.entities.listKind('pawn').filter((p) => isPatient(p));
  const pawn = selectedPawn(game, H);
  // выбор пешки
  let bx = r.x;
  let by = r.y;
  for (const p of list) {
    const label = firstName(p.name);
    const bw = Math.min(110, Math.max(54, ui.measure(label, 12) + 22));
    if (bx + bw > r.x + r.w) {
      bx = r.x;
      by += 24;
    }
    const s = game.api.health.getSummary(p);
    if (ui.button(bx, by, bw, 20, label, { active: p === pawn, size: 12 })) H.rt.selectedId = p.id;
    ctx.fillStyle = effColor(s.ratio);
    ctx.fillRect(bx + 4, by + 16, (bw - 8) * s.ratio, 2);
    bx += bw + 4;
  }
  if (!pawn) return;
  const top = by + 30;
  const c = computeCache(game, pawn);
  const time = performance.now() / 1000;
  // схема
  const bodyW = 170;
  ctx.fillStyle = 'rgba(94,242,255,0.04)';
  roundRect(ctx, r.x, top, bodyW, 300, 8);
  ctx.fill();
  drawBody(ctx, game, ui, pawn, r.x + 5, top + 6, bodyW - 10, 288, time);
  // правая колонка
  const x = r.x + bodyW + 14;
  const w = r.x + r.w - x;
  let y = top;
  const s = game.api.health.getSummary(pawn);
  ui.text(pawn.name, x, y, { size: 16, bold: true, color: pawn.color || THEME.text });
  const tag = pawn.isLeader ? game.t('health.ui.leader') : pawn.id === game.colony.heirId ? game.t('health.ui.heir') : pawn.prisoner ? game.t('health.ui.prisoner') : '';
  if (tag) ui.text(tag, x + w, y + 3, { size: 11, color: THEME.accent, align: 'right' });
  y += 22;
  let status = s.label;
  if (pawn.dying) status += ` · ${Math.max(0, Math.ceil((pawn.dying.untilTick - game.time.tick) / 60))} ${game.t('health.ui.sec')}`;
  ui.text(status, x, y, { size: 13, color: pawn.dying || pawn.downed ? RED : effColor(s.ratio) });
  y += 22;
  for (const cap of CAPACITIES) {
    const v = c.caps[cap] ?? 1;
    ui.text(game.t(`health.cap.${cap}`), x, y, { size: 12, color: THEME.dim });
    ui.bar(x + 120, y + 4, w - 160, 7, Math.min(1, v), effColor(v));
    ui.text(`${Math.round(v * 100)}%`, x + w, y, { size: 11, align: 'right', color: THEME.text });
    y += 17;
  }
  const bl = pawn.health.bloodLoss || 0;
  ui.text(game.t('health.ui.bloodLoss'), x, y, { size: 12, color: THEME.dim });
  ui.bar(x + 120, y + 4, w - 160, 7, bl, RED);
  ui.text(`${Math.round(bl * 100)}%`, x + w, y, { size: 11, align: 'right' });
  y += 17;
  ui.text(game.t('health.ui.pain'), x, y, { size: 12, color: THEME.dim });
  ui.bar(x + 120, y + 4, w - 160, 7, Math.min(1, c.pain), '#ff9f43');
  ui.text(`${Math.round(c.pain * 100)}%`, x + w, y, { size: 11, align: 'right' });
  y += 17;
  if (c.bleed > 0.01) {
    const hrs = bl < 1 ? ((1 - bl) / c.bleed) * 24 : 0;
    ui.text(game.t('health.ui.bleeding', { rate: Math.round(c.bleed * 100), h: hrs.toFixed(hrs < 10 ? 1 : 0) }), x, y, { size: 12, color: RED });
    y += 17;
  }
  // список состояний
  y += 4;
  const conds = pawn.health.conds;
  const listH = Math.max(40, top + 300 - y);
  if (!conds.length) ui.text(game.t('health.ui.healthy'), x, y + 4, { size: 12, color: THEME.good });
  else {
    ui.list('health:conds', x, y, w, listH, conds, 18, (cx, cd, rx, ry, rw) => {
      const def = condDef(game, cd.id);
      cx.fillStyle = def?.color || cd.color || '#c9b8ff';
      cx.beginPath();
      cx.arc(rx + 6, ry + 9, 3.5, 0, Math.PI * 2);
      cx.fill();
      ui.text(condLabel(game, cd), rx + 16, ry + 2, { size: 12 });
      if (cd.part) ui.text(game.t(`health.part.${cd.part}`), rx + rw - 6, ry + 2, { size: 11, color: THEME.dim, align: 'right' });
    });
  }
  // нижние кнопки
  let yb = top + 312;
  let xb = r.x;
  if (pawn.faction === 'colony' && !pawn.isLeader && !pawn.prisoner) {
    const isHeir = game.colony.heirId === pawn.id;
    if (ui.button(xb, yb, 200, 24, game.t(isHeir ? 'health.ui.heirSet' : 'health.ui.makeHeir'), { active: isHeir, size: 12 })) game.api.health.setHeir(isHeir ? null : pawn);
    xb += 208;
  }
  const need = tendNeed(game, pawn);
  if (need > 0) ui.text(game.t('health.ui.needsTend', { n: need }), xb, yb + 5, { size: 12, color: THEME.warn });
  yb += 30;
  const ops = availableOps(H, pawn);
  const pending = pawn.health.ops || [];
  for (const op of ops.slice(0, 4)) {
    const label = op.kind === 'amputate' ? game.t('health.ui.opAmputate', { part: game.t(`health.part.${op.part}`) }) : game.t('health.ui.opInstall', { item: game.t(`health.item.${op.item}`), part: game.t(`health.part.${op.part}`) });
    const queued = pending.some((o) => o.kind === op.kind && o.part === op.part);
    const disabled = op.kind === 'install' && !op.have;
    if (ui.button(r.x, yb, r.w, 22, queued ? `${label} — ${game.t('health.ui.queued')}` : label, { active: queued, disabled: disabled && !queued, size: 12, tooltip: disabled ? game.t('health.ui.noItem') : null }) && !queued) scheduleOp(H, pawn, op);
    yb += 26;
  }
  if (yb < r.y + r.h - 18) ui.text(game.t('health.ui.hint'), r.x, r.y + r.h - 16, { size: 11, color: THEME.dim });
}

// ------------------------------------------------------------------ панель «Павшие»
const RITE_KEYS = { grave: 'health.fallen.riteGrave', fire: 'health.fallen.riteFire', none: 'health.fallen.riteNone' };

function drawFallenPanel(ctx, game, ui, r, H) {
  const mem = game.api.health.getMemory();
  ui.text(game.t('health.fallen.memory', { v: Math.round(mem) }), r.x, r.y, { size: 13, color: '#c9b8ff' });
  ui.bar(r.x + 190, r.y + 5, r.w - 190, 7, mem / 100, '#c9b8ff');
  const recs = H.state.fallen.slice().reverse();
  const top = r.y + 24;
  if (!recs.length) {
    ui.text(game.t('health.fallen.empty'), r.x + r.w / 2, top + 120, { size: 15, color: THEME.dim, align: 'center' });
    return;
  }
  let sel = recs.find((x) => x.id === H.rt.fallenSel) || recs[0];
  const lw = 220;
  const clicked = ui.list('health:fallen', r.x, top, lw, r.h - 28, recs, 40, (cx, rec, rx, ry, rw, rh) => {
    if (rec === sel) {
      cx.fillStyle = 'rgba(201,184,255,0.12)';
      cx.fillRect(rx, ry, rw, rh);
    }
    cx.fillStyle = rec.color || '#ffffff';
    cx.beginPath();
    cx.arc(rx + 10, ry + 13, 4, 0, Math.PI * 2);
    cx.fill();
    ui.text(rec.name, rx + 22, ry + 4, { size: 13, bold: true, color: rec.kind === 'left' ? THEME.dim : THEME.text });
    const sub = `${game.t('health.fallen.dayN', { d: rec.day })} · ${rec.kind === 'left' ? game.t('health.fallen.left') : causeLabel(game, rec.cause)}`;
    ui.text(sub, rx + 22, ry + 21, { size: 11, color: THEME.dim });
  });
  if (clicked) {
    H.rt.fallenSel = clicked.id;
    sel = clicked;
  }
  // карточка
  const x = r.x + lw + 18;
  const w = r.x + r.w - x;
  let y = top + 4;
  ctx.fillStyle = 'rgba(201,184,255,0.05)';
  roundRect(ctx, x - 8, top, w + 8, r.h - 28, 8);
  ctx.fill();
  ui.text(sel.name, x, y, { size: 20, bold: true, color: sel.color || THEME.text, glow: 6, glowColor: sel.color });
  y += 30;
  const head = [yearsText(game, sel.age), sel.kind === 'left' ? game.t('health.fallen.left') : causeLabel(game, sel.cause)];
  if (sel.wasLeader) head.push(game.t('health.fallen.wasLeader'));
  ui.text(head.join(' · '), x, y, { size: 13, color: THEME.dim });
  y += 20;
  ui.text(game.t('health.fallen.where', { d: sel.day, st: sel.station?.name || '—' }), x, y, { size: 12, color: THEME.dim });
  y += 26;
  if (sel.story) {
    for (const line of wrap(ui, `«${sel.story}»`, w - 8, 13)) {
      ui.text(line, x, y, { size: 13, color: THEME.text });
      y += 18;
    }
    y += 8;
  }
  ui.text(game.t('health.fallen.epitaph'), x, y, { size: 11, color: THEME.accent });
  y += 16;
  for (const line of wrap(ui, sel.epitaph || '—', w - 8, 13)) {
    ui.text(line, x, y, { size: 13, color: '#e8dcff' });
    y += 18;
  }
  y += 10;
  if (sel.kind !== 'left') {
    ui.text(game.t('health.fallen.lastWords'), x, y, { size: 11, color: THEME.accent });
    y += 16;
    const lw2 = sel.lastWordsHeard && sel.lastWords ? `«${sel.lastWords}»` : game.t('health.fallen.nobodyHeard');
    for (const line of wrap(ui, lw2, w - 8, 12)) {
      ui.text(line, x, y, { size: 12, color: sel.lastWordsHeard ? THEME.text : THEME.dim });
      y += 17;
    }
    y += 10;
    ui.text(game.t(RITE_KEYS[sel.rite] || RITE_KEYS.none), x, y, { size: 12, color: sel.rite === 'none' ? THEME.warn : THEME.good });
    y += 18;
    if (sel.funeral?.speech) {
      for (const line of wrap(ui, game.t('health.fallen.speech', { s: sel.funeral.speech }), w - 8, 12)) {
        ui.text(line, x, y, { size: 12, color: THEME.dim });
        y += 17;
      }
    }
    if (sel.keepsakeDefId) ui.text(game.t(sel.keepsakeKept ? 'health.fallen.keepsakeKept' : 'health.fallen.keepsake', { item: game.t(`health.item.${sel.keepsakeDefId}`) }), x, y, { size: 12, color: THEME.dim });
  }
}

// ------------------------------------------------------------------ речь у могилы
function drawEulogyPanel(ctx, game, ui, r, H) {
  const f = activeFuneral(H);
  const rec = f && getFallenById(H, f.fallenId);
  if (!f || !rec || f.speech) {
    ui.text(game.t('health.eulogy.none'), r.x, r.y, { size: 13, color: THEME.dim });
    return;
  }
  ui.text(game.t('health.eulogy.prompt', { name: rec.name }), r.x, r.y, { size: 13, color: THEME.dim });
  let y = r.y + 26;
  const opts = eulogyOptions(H, rec);
  opts.forEach((o, i) => {
    const lines = wrap(ui, o.text, r.w - 30, 13);
    const bh = 10 + lines.length * 17;
    const hover = ui.mouseIn(r.x, y, r.w, bh);
    ctx.fillStyle = hover ? 'rgba(201,184,255,0.16)' : 'rgba(20,24,48,0.85)';
    roundRect(ctx, r.x, y, r.w, bh, 6);
    ctx.fill();
    ctx.strokeStyle = hover ? '#c9b8ff' : 'rgba(108,92,255,0.5)';
    ctx.lineWidth = 1;
    roundRect(ctx, r.x + 0.5, y + 0.5, r.w - 1, bh - 1, 6);
    ctx.stroke();
    lines.forEach((l, j) => ui.text(j === 0 ? `${i + 1}. ${l}` : `    ${l}`, r.x + 10, y + 6 + j * 17, { size: 13 }));
    ui.block(r.x, y, r.w, bh);
    if (ui.clicked(r.x, y, r.w, bh)) {
      game.audio.play('ui_click');
      game.api.health.chooseEulogy(i);
    }
    y += bh + 8;
  });
  if (ui.button(r.x + r.w - 140, y, 140, 22, game.t('health.eulogy.silent'), { size: 12 })) {
    H.rt.eulogyDismissed[f.id] = true;
    H.rt.eulogyOpen = false;
    game.ui.closePanel('health_eulogy');
  }
}

// ------------------------------------------------------------------ сцена смерти / последние слова (экран)
function setFilter(H, v) {
  if (typeof document === 'undefined') return;
  const val = v > 0.01 ? `grayscale(${v.toFixed(2)}) brightness(${(1 - v * 0.18).toFixed(2)})` : '';
  if (H.rt._filter === val) return;
  H.rt._filter = val;
  for (const cv of document.querySelectorAll('canvas')) cv.style.filter = val;
}

function sceneLayer(H) {
  return {
    id: 'health:scene',
    order: 160,
    space: 'screen',
    draw(ctx, game, view) {
      const ui = game.ui;
      const prevCtx = ui.ctx;
      ui.ctx = ctx;
      try {
        drawScene(ctx, game, view, H, ui);
      } finally {
        ui.ctx = prevCtx;
      }
    },
  };
}

function drawScene(ctx, game, view, H, ui) {
  {
    {
      const dt = Math.min(0.1, view.dt || 0.016);
      if (H.rt.clearFilter) {
        H.rt.clearFilter = false;
        setFilter(H, 0);
      }
      // умирающие: приглушённый мир, пульс по краям
      let dying = null;
      for (const p of game.colonists()) if (p.dying) dying = p;
      if (dying && !H.rt.scene) {
        const left = Math.max(0, dying.dying.untilTick - game.time.tick);
        const pulse = 0.5 + 0.5 * Math.sin(view.time * (left < 600 ? 5 : 3));
        const g = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.35, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.7);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(40,0,12,${(0.35 + 0.15 * pulse).toFixed(3)})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, view.w, view.h);
        const txt = game.t('health.scene.dying', { name: firstName(dying.name), s: Math.ceil(left / 60) });
        ui.text(txt, view.w / 2, 84, { size: 15, bold: true, align: 'center', color: '#ffb3c1', glow: 6, glowColor: '#ff4f6d' });
      }
      const s = H.rt.scene;
      if (s) {
        s.t += dt;
        const a = Math.min(1, s.t / 0.8, Math.max(0, (s.dur - s.t) / 1.2));
        setFilter(H, a * 0.85);
        const cy = view.h * 0.42;
        ctx.fillStyle = `rgba(0,0,0,${(0.62 * a).toFixed(3)})`;
        ctx.fillRect(0, cy - 90, view.w, 190);
        ctx.globalAlpha = a;
        ui.text(s.name, view.w / 2, cy - 62, { size: 34, bold: true, align: 'center', color: '#f2f0ff', glow: 10, glowColor: s.color || '#c9b8ff' });
        ui.text(s.sub, view.w / 2, cy - 16, { size: 15, align: 'center', color: '#b9b4d6' });
        if (s.line) {
          const lines = wrap(ui, `«${s.line}»`, Math.min(760, view.w - 80), 15);
          lines.slice(0, 3).forEach((l, i) => ui.text(l, view.w / 2, cy + 14 + i * 21, { size: 15, align: 'center', color: '#d8d4ee' }));
        }
        if (s.heir && s.t > 2) {
          ctx.globalAlpha = a * Math.min(1, (s.t - 2) / 0.8);
          ui.text(s.heir, view.w / 2, cy + 82, { size: 15, bold: true, align: 'center', color: '#5ef2ff', glow: 6 });
        }
        ctx.globalAlpha = 1;
        if (s.t >= s.dur) {
          H.rt.scene = null;
          setFilter(H, 0);
        }
      }
      const q = H.rt.quote;
      if (q) {
        q.t += dt;
        const a = Math.min(1, q.t / 0.7, Math.max(0, (q.dur - q.t) / 1));
        const lines = wrap(ui, `«${q.text}»`, Math.min(680, view.w - 80), 17);
        const y0 = view.h * 0.7 - lines.length * 12;
        ctx.fillStyle = `rgba(4,4,12,${(0.6 * a).toFixed(3)})`;
        roundRect(ctx, view.w / 2 - Math.min(380, view.w / 2 - 20), y0 - 16, Math.min(760, view.w - 40), lines.length * 24 + 52, 10);
        ctx.fill();
        ctx.globalAlpha = a;
        lines.forEach((l, i) => ui.text(l, view.w / 2, y0 + i * 24, { size: 17, align: 'center', color: '#fff6e8' }));
        ui.text(`— ${q.name}`, view.w / 2, y0 + lines.length * 24 + 8, { size: 13, align: 'center', color: q.color || '#c9b8ff' });
        ctx.globalAlpha = 1;
        if (q.t >= q.dur) H.rt.quote = null;
      }
    }
  }
}

// ------------------------------------------------------------------ пешки: лежачие, несомые
function wrapPawnDrawer(game) {
  const r = game.render;
  const base = r.drawers.get('pawn');
  if (!base) return;
  const drawBase = (ctx, p, g, view) => base.draw(ctx, p, g, view);
  r.registerDrawer('pawn', {
    draw(ctx, p, g, view) {
      const custom = p.drawAs && r.defDrawers.get(p.drawAs);
      if (custom?.draw && !p.carriedById) return custom.draw(ctx, p, g, view);
      if (p.downed || p.carriedById) {
        const x = p.x * T;
        const y = p.y * T;
        ctx.save();
        if (p.carriedById) {
          ctx.translate(x, y - 9);
          ctx.rotate(Math.PI / 2 + (p.dir || 0) * 0.15);
          ctx.scale(0.9, 0.9);
          ctx.translate(-x, -y);
        } else {
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 2);
          ctx.translate(-x, -y);
          ctx.globalAlpha = p.dying ? 0.8 : 0.9;
        }
        if (custom?.draw) custom.draw(ctx, p, g, view);
        else drawBase(ctx, p, g, view);
        ctx.restore();
        return;
      }
      drawBase(ctx, p, g, view);
    },
    drawEmissive: base.drawEmissive ? (ctx, p, g, view, a) => base.drawEmissive(ctx, p, g, view, p.dying ? a * 0.4 : a) : undefined,
  });
}

function pawnOverlay(H) {
  return {
    id: 'health:status',
    order: 40,
    draw(ctx, p, view, game) {
      if (p.dead || !p.health?.conds) return;
      const x = p.x * T;
      const y = p.y * T;
      if (p.dying) {
        // гаснущий огонёк над умирающим
        const left = Math.max(0, p.dying.untilTick - game.time.tick);
        const k = Math.min(1, left / 1800);
        const fl = 0.75 + 0.25 * Math.sin(view.time * 9 + p.id) * Math.sin(view.time * 5.3);
        const r = (3 + 3 * k) * fl;
        drawGlow(ctx, x, y - 22, 14 * k + 4, '#ffb347', 0.6 * k * fl + 0.1);
        ctx.fillStyle = `rgba(255,${Math.round(180 + 60 * k)},120,${(0.5 + 0.5 * k).toFixed(2)})`;
        ctx.beginPath();
        ctx.ellipse(x, y - 22, r * 0.6, r, 0, 0, Math.PI * 2);
        ctx.fill();
        if (p.dying.heard) {
          ctx.strokeStyle = 'rgba(255,240,220,0.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y - 22, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
        return;
      }
      if (p.carriedById) return;
      const c = p._hc;
      if (p.downed && p.faction === 'colony') {
        const need = tendNeed(game, p) > 0;
        const a = 0.55 + 0.35 * Math.sin(view.time * 3 + p.id);
        ctx.strokeStyle = need ? `rgba(255,95,109,${a.toFixed(2)})` : `rgba(125,255,154,${(a * 0.7).toFixed(2)})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 20);
        ctx.lineTo(x + 4, y - 20);
        ctx.moveTo(x, y - 24);
        ctx.lineTo(x, y - 16);
        ctx.stroke();
      }
      if (c && c.bleed > 0.25 && !p.noBlood) {
        // капли крови
        const n = c.bleed > 1 ? 3 : c.bleed > 0.6 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const ph = (view.time * 1.3 + i * 0.37 + p.id * 0.13) % 1;
          ctx.fillStyle = `rgba(200,16,42,${(0.9 * (1 - ph)).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(x - 5 + i * 5, y + 2 + ph * 9, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  };
}

// ------------------------------------------------------------------ трупы, могилы, гроб
const fakeBodies = new Map();
function fakeBody(c, carrier) {
  let f = fakeBodies.get(c.id);
  if (!f) {
    if (fakeBodies.size > 300) fakeBodies.clear();
    f = { id: c.id, kind: 'pawn', moving: false, walkPhase: 0, downed: true, asleep: false, carry: null };
    fakeBodies.set(c.id, f);
  }
  f.x = carrier ? carrier.x : c.x + 0.5;
  f.y = carrier ? carrier.y : c.y + 0.5;
  f.dir = 0.4;
  f.color = c.color;
  f.hairColor = c.hairColor;
  f.look = c.look || {};
  f.mage = !!c.mage;
  f.isLeader = !!c.wasLeader;
  f.drawAs = c.drawAs;
  return f;
}

function drawBones(ctx, x, y, t) {
  ctx.strokeStyle = 'rgba(232,226,208,0.85)';
  ctx.fillStyle = 'rgba(232,226,208,0.85)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x + 9, y - 1, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 5, y);
  ctx.lineTo(x - 9, y + 1);
  for (let i = 0; i < 3; i++) {
    ctx.moveTo(x + 1 - i * 3.5, y - 4);
    ctx.lineTo(x + 1 - i * 3.5, y + 4);
  }
  ctx.moveTo(x - 9, y + 1);
  ctx.lineTo(x - 14, y - 3);
  ctx.moveTo(x - 9, y + 1);
  ctx.lineTo(x - 14, y + 5);
  ctx.stroke();
  void t;
}

function corpseDrawer() {
  return {
    draw(ctx, c, game, view) {
      const carrier = c.carriedById ? game.entities.get(c.carriedById) : null;
      const stage = rotStage(c.rot ?? 0);
      const kept = !carrier && keptAt(game, c.x, c.y);
      const x = carrier ? carrier.x * T : c.x * T + 16;
      const y = carrier ? carrier.y * T - 8 : c.y * T + 16;
      ctx.save();
      if (stage === 'bones') {
        drawBones(ctx, x, y, view.time);
        ctx.restore();
        return;
      }
      const f = fakeBody(c, carrier);
      const custom = c.drawAs && game.render.defDrawers.get(c.drawAs);
      ctx.globalAlpha = kept ? 0.55 : 0.82;
      if (custom?.draw) custom.draw(ctx, f, game, view);
      else {
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 2 + 0.25);
        ctx.translate(-f.x * T, -f.y * T);
        if (f.mage) drawLeader(ctx, f, game, view);
        else drawPawnBody(ctx, f, game, view);
      }
      ctx.restore();
      // тёмная вуаль и гниение
      ctx.fillStyle = stage === 'rotting' ? `rgba(70,90,40,${(0.25 + 0.3 * Math.min(1, (c.rot - 0.3) / 0.5)).toFixed(2)})` : 'rgba(10,10,20,0.32)';
      ctx.beginPath();
      ctx.ellipse(x, y, 13, 8, 0.25, 0, Math.PI * 2);
      ctx.fill();
      if (stage === 'rotting' && !kept) {
        ctx.fillStyle = 'rgba(20,20,20,0.85)';
        for (let i = 0; i < 4; i++) {
          const a = view.time * (2 + i * 0.4) + i * 1.7 + c.id;
          ctx.fillRect(x + Math.cos(a) * (8 + i), y - 10 + Math.sin(a * 1.3) * 5, 1.5, 1.5);
        }
      }
      if (c.wasLeader && !carrier) drawGlow(ctx, x, y, 12, '#ffffff', 0.12);
    },
  };
}

function graveDrawer() {
  return {
    draw(ctx, b, game, view) {
      const x = b.x * T;
      const y = b.y * T;
      ctx.fillStyle = 'rgba(60,46,36,0.9)';
      ctx.beginPath();
      ctx.ellipse(x + 16, y + 20, 12, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,100,80,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (!b.occupied) {
        ctx.fillStyle = 'rgba(10,8,6,0.85)';
        ctx.fillRect(x + 8, y + 14, 16, 10);
        return;
      }
      const col = b.stranger ? '#8c93b8' : b.wasLeader ? '#ffffff' : '#c9b8ff';
      ctx.fillStyle = '#1a1830';
      ctx.beginPath();
      ctx.moveTo(x + 9, y + 18);
      ctx.lineTo(x + 9, y + 6);
      ctx.arc(x + 16, y + 6, 7, Math.PI, 0);
      ctx.lineTo(x + 23, y + 18);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.strokeStyle = rgba(col, 0.7);
      ctx.beginPath();
      ctx.moveTo(x + 16, y + 3);
      ctx.lineTo(x + 16, y + 13);
      ctx.moveTo(x + 12.5, y + 6.5);
      ctx.lineTo(x + 19.5, y + 6.5);
      ctx.stroke();
      void view;
    },
    drawEmissive(ctx, b, game, view, alpha) {
      if (!b.occupied) return;
      const fl = 0.85 + 0.15 * Math.sin(view.time * 3 + b.id);
      drawGlow(ctx, b.x * T + 16, b.y * T + 9, 16, b.stranger ? '#8c93b8' : '#c9b8ff', alpha * 0.5 * fl);
    },
  };
}

function coffinDrawer() {
  return {
    draw(ctx, b) {
      const x = b.x * T;
      const y = b.y * T;
      ctx.fillStyle = '#2a1c14';
      ctx.beginPath();
      ctx.moveTo(x + 10, y + 3);
      ctx.lineTo(x + 22, y + 3);
      ctx.lineTo(x + 26, y + 11);
      ctx.lineTo(x + 22, y + 29);
      ctx.lineTo(x + 10, y + 29);
      ctx.lineTo(x + 6, y + 11);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#c98a4b';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    },
  };
}

// ------------------------------------------------------------------ подсказки и HUD
function tooltip(H) {
  return {
    id: 'health',
    order: 30,
    lines(game, hover) {
      const out = [];
      for (const e of hover.entities) {
        if (e.kind === 'pawn' && !e.dead && e.health?.conds && (e.health.conds.length || e.downed) && !e.boss) {
          const s = game.api.health.getSummary(e);
          out.push({ text: `${firstName(e.name)}: ${s.label}`, color: e.dying || e.downed ? RED : effColor(s.ratio) });
          const conds = e.health.conds.slice().sort((a, b) => (b.sev ?? 0) - (a.sev ?? 0)).slice(0, 4);
          for (const cd of conds) out.push({ text: `  ${condLabel(game, cd)}${cd.part ? ` — ${game.t(`health.part.${cd.part}`)}` : ''}`, color: THEME.dim, size: 11 });
          if (e.dying && !e.dying.heard) out.push({ text: game.t('health.tt.lastWords'), color: '#ffd9a0', size: 11 });
        } else if (e.kind === 'corpse') {
          const st = rotStage(e.rot ?? 0);
          out.push({ text: game.t('health.tt.corpse', { name: e.name || '?' }), bold: true, color: THEME.bad });
          out.push({ text: `${causeLabel(game, e.cause)} · ${game.t(`health.tt.rot_${st}`)}`, color: THEME.dim, size: 11 });
          if (keptAt(game, e.x, e.y)) out.push({ text: game.t('health.tt.kept'), color: THEME.good, size: 11 });
        } else if (e.kind === 'building' && e.defId === 'grave' && e.occupied) {
          out.push({ text: game.t('health.tt.grave', { name: e.name || '?' }), bold: true, color: '#c9b8ff' });
          if (e.epitaph) out.push({ text: e.epitaph, color: THEME.dim, size: 11 });
        }
      }
      return out;
    },
  };
}

function alertsHud(H) {
  return {
    id: 'health:alerts',
    slot: 'right',
    order: 20,
    visible: (game) => !!game.map,
    draw(ctx, game, ui, box) {
      let y = box.y;
      const x = game.ui.w - 14;
      let n = 0;
      for (const p of game.colonists()) {
        if (!p.downed && !(p._hc && p._hc.bleed > 0.6)) continue;
        if (n >= 5) break;
        n++;
        let text;
        let color = RED;
        if (p.dying) text = game.t('health.hud.dying', { name: firstName(p.name), s: Math.ceil(Math.max(0, p.dying.untilTick - game.time.tick) / 60) });
        else if (p.downed) {
          text = game.t('health.hud.downed', { name: firstName(p.name) });
          color = '#ff9f43';
        } else text = game.t('health.hud.bleeding', { name: firstName(p.name) });
        const w = ui.measure(text, 12) + 16;
        ctx.fillStyle = 'rgba(30,6,14,0.75)';
        roundRect(ctx, x - w, y, w, 20, 5);
        ctx.fill();
        ui.text(text, x - 8, y + 4, { size: 12, align: 'right', color });
        ui.block(x - w, y, w, 20);
        if (ui.clicked(x - w, y, w, 20)) {
          H.rt.selectedId = p.id;
          game.ui.openPanel('health');
        }
        y += 24;
      }
      const s = H.state.staff;
      if (s) {
        const text = game.t('health.objective.take_staff');
        const w = ui.measure(text, 12) + 16;
        ctx.fillStyle = 'rgba(6,24,30,0.75)';
        roundRect(ctx, x - w, y, w, 20, 5);
        ctx.fill();
        ui.text(text, x - 8, y + 4, { size: 12, align: 'right', color: '#5ef2ff' });
        y += 24;
      }
      return y - box.y;
    },
  };
}

// ------------------------------------------------------------------ регистрация
export function registerUI(game, H) {
  game.ui.registerPanel({ id: 'health', title: 'health.panel.title', key: 'F2', width: 600, height: 560, anchor: 'right', draw: (ctx, g, ui, r) => drawHealthPanel(ctx, g, ui, r, H) }, 'health');
  game.ui.registerPanel({ id: 'fallen', title: 'health.fallen.title', key: 'F8', width: 760, height: 500, anchor: 'center', draw: (ctx, g, ui, r) => drawFallenPanel(ctx, g, ui, r, H) }, 'health');
  game.ui.registerPanel({
    id: 'health_eulogy',
    title: 'health.eulogy.title',
    width: 600,
    height: 330,
    anchor: 'left',
    draw: (ctx, g, ui, r) => drawEulogyPanel(ctx, g, ui, r, H),
    onClose: () => {
      H.rt.eulogyOpen = false;
      const f = activeFuneral(H);
      if (f) H.rt.eulogyDismissed[f.id] = true;
    },
  }, 'health');
  game.ui.registerTooltip(tooltip(H), 'health');
  game.ui.registerHud(alertsHud(H), 'health');
  const r = game.render;
  r.registerLayer(sceneLayer(H), 'health');
  r.registerPawnOverlay(pawnOverlay(H), 'health');
  wrapPawnDrawer(game);
  r.registerDrawer('corpse', corpseDrawer());
  r.registerDefDrawer('grave', graveDrawer());
  r.registerDefDrawer('coffin', coffinDrawer());
  void BODY_PARTS;
  void TICKS_PER_HOUR;
  void carriedOf;
}
