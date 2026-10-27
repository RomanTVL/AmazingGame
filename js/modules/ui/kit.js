// Неоновый UI-набор модуля ui: масштабируемые (настройка uiScale) примитивы и виджеты immediate-mode.
// Координаты — «единицы UI» (= CSS px × 1/uiScale). Рисуем только внутри draw (в headless не вызывается).
//
//   k.begin(ctx, mode)            — 'hud' (клики из game.input, поглощаются) | 'screen' (клики из захвата экрана)
//   k.push(ctx) … k.pop(ctx)      — ctx.scale(uiScale) для своей отрисовки
//   k.button(id, x, y, w, h, label, opts) → нажата;   k.toggle / k.slider / k.chips / k.stepper / k.textField
//   k.panel(x, y, w, h, opts)     — неоновая подложка;  k.tip(lines) — подсказка (рисует слой ui:overlay)
//   фокус клавиатурой (экраны): ↑/↓/Tab — переход, ←/→ — изменить, Enter/Пробел — нажать.
import { THEME, roundRect } from '../../engine/ui.js';
import { drawGlow } from '../../render/glow.js';
import { rgba, mix } from '../../render/color.js';

export const C = {
  bg: 'rgba(7, 9, 20, 0.9)',
  bg2: 'rgba(14, 18, 38, 0.94)',
  line: '#6c5cff',
  cyan: '#5ef2ff',
  pink: '#ff4fd8',
  gold: '#ffd27a',
  text: '#e8ecff',
  dim: '#8c93b8',
  faint: '#5a6188',
  good: '#7dff6a',
  bad: '#ff5f6d',
  warn: '#ffb347',
  violet: '#b48cff',
  ice: '#9fd8ff',
};

export const FONT = THEME.font;
export const SERIF = 'Georgia, "Palatino Linotype", "Times New Roman", serif';
export const MONO = THEME.mono;

const NAV_NEXT = ['ArrowDown', 'Tab'];
const NAV_PREV = ['ArrowUp'];

export class Kit {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.s = 1;
    this.mode = 'hud';
    /** Захват ввода экрана: {click, rclick, wheel, back, anyKey} (заполняет кадровая система ui:capture). */
    this.cap = { click: false, rclick: false, wheel: 0, back: false, anyKey: false };
    this.interactive = true;
    this.focus = null;
    this.focusables = [];
    this._prevFocusables = [];
    this.activate = null;
    this.navX = 0;
    this.drag = null;
    this.textFocus = null;
    this._typedFrame = -1;
    this.tipLines = null;
    this.time = 0;
    this.frameNo = 0;
    this._wrap = new Map();
    this.scroll = {};
    this.lastHover = null;
    /** Прямоугольники виджетов прошлых кадров (CSS px) по id — для тестов и отладки. */
    this.rects = new Map();
  }

  /** Запомнить прямоугольник виджета (единицы UI → CSS px). */
  note(id, x, y, w, h) {
    const s = this.s;
    this.rects.set(id, { x: x * s, y: y * s, w: w * s, h: h * s, frame: this.frameNo });
  }

  get input() {
    return this.game.input;
  }

  /** Масштаб UI из настроек (0.75..1.6). */
  scale() {
    const v = Number(this.game.settings.get('uiScale'));
    return Number.isFinite(v) ? Math.max(0.75, Math.min(1.6, v)) : 1;
  }

  begin(ctx, mode = 'hud') {
    this.ctx = ctx;
    this.mode = mode;
    this.s = this.scale();
    this.interactive = true;
  }

  push(ctx = this.ctx) {
    ctx.save();
    ctx.scale(this.s, this.s);
  }

  pop(ctx = this.ctx) {
    ctx.restore();
  }

  get mx() {
    return this.input.mouse.sx / this.s;
  }

  get my() {
    return this.input.mouse.sy / this.s;
  }

  // ---------- Ввод ----------
  inside(x, y, w, h) {
    if (!this.interactive) return false;
    const mx = this.mx;
    const my = this.my;
    return mx >= x && my >= y && mx < x + w && my < y + h;
  }

  pressed(btn = 0) {
    if (!this.interactive) return false;
    if (this.mode === 'screen') return btn === 0 ? this.cap.click : btn === 2 ? this.cap.rclick : false;
    return this.input.keyPressed(`Mouse${btn}`);
  }

  take(btn = 0) {
    if (this.mode === 'screen') {
      if (btn === 0) this.cap.click = false;
      else if (btn === 2) this.cap.rclick = false;
    } else this.input.consumeCode(`Mouse${btn}`);
  }

  clicked(x, y, w, h, btn = 0) {
    if (this.pressed(btn) && this.inside(x, y, w, h)) {
      this.take(btn);
      return true;
    }
    return false;
  }

  wheel() {
    if (!this.interactive) return 0;
    if (this.mode === 'screen') {
      const w = this.cap.wheel;
      this.cap.wheel = 0;
      return w;
    }
    const w = this.input.mouse.wheel;
    this.input.mouse.wheel = 0;
    return w;
  }

  /** Отметить область как UI (мир не получит клик) — в CSS px. */
  block(x, y, w, h) {
    const s = this.s;
    this.game.ui.block(x * s, y * s, w * s, h * s);
  }

  // ---------- Фокус (экраны) ----------
  /** Начало кадра экрана: обработать клавиши навигации по фокусу прошлого кадра. */
  beginFocus() {
    this.frameNo++;
    this._prevFocusables = this.focusables;
    this.focusables = [];
    this.activate = null;
    this.navX = 0;
    if (this.textFocus) return;
    const list = this._prevFocusables;
    const inp = this.input;
    const any = (codes) => codes.some((c) => inp.keyPressed(c));
    if (list.length) {
      let i = list.indexOf(this.focus);
      if (any(NAV_NEXT)) this.focus = list[(i + 1 + list.length) % list.length];
      else if (any(NAV_PREV)) this.focus = list[i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length];
      else if (i < 0 && (inp.keyPressed('Enter') || inp.keyPressed('ArrowLeft') || inp.keyPressed('ArrowRight'))) this.focus = list[0];
      else if (inp.keyPressed('Enter') || inp.keyPressed('Space') || inp.keyPressed('NumpadEnter')) this.activate = this.focus;
    }
    if (inp.keyPressed('ArrowLeft')) this.navX = -1;
    if (inp.keyPressed('ArrowRight')) this.navX = 1;
  }

  /** Зарегистрировать фокусируемый виджет; true — в фокусе. Наведение мышью переносит фокус. */
  focusable(id, hover) {
    if (!this.interactive || this.mode !== 'screen') return false;
    this.focusables.push(id);
    if (hover && this.input.mouse.moved) this.focus = id;
    return this.focus === id;
  }

  // ---------- Текст ----------
  font(size = 13, weight = 400, family = FONT) {
    return `${weight} ${size}px ${family}`;
  }

  text(str, x, y, o = {}) {
    const ctx = this.ctx;
    ctx.font = o.font || this.font(o.size || 13, o.bold ? 600 : o.weight || 400, o.family || FONT);
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'top';
    const s = String(str ?? '');
    if (o.glow) drawTextGlow(ctx, s, x, y, o.glowColor || o.color || C.cyan, o.glow === true ? 8 : o.glow);
    if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
    ctx.fillStyle = o.color || C.text;
    let out = s;
    if (o.maxW && ctx.measureText(s).width > o.maxW) out = this.ellipsize(s, o.maxW);
    ctx.fillText(out, x, y);
    if (o.alpha !== undefined) ctx.globalAlpha /= o.alpha;
    return ctx.measureText(out).width;
  }

  measure(str, size = 13, weight = 400, family = FONT) {
    this.ctx.font = this.font(size, weight, family);
    return this.ctx.measureText(String(str ?? '')).width;
  }

  ellipsize(str, maxW) {
    const ctx = this.ctx;
    if (ctx.measureText(str).width <= maxW) return str;
    let lo = 0;
    let hi = str.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(str.slice(0, mid) + '…').width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return str.slice(0, lo) + '…';
  }

  /** Перенос по словам (кэш). */
  wrap(str, maxW, size = 13, weight = 400, family = FONT) {
    const key = `${size}|${weight}|${family}|${maxW | 0}|${str}`;
    let lines = this._wrap.get(key);
    if (lines) return lines;
    const ctx = this.ctx;
    ctx.font = this.font(size, weight, family);
    lines = [];
    for (const para of String(str ?? '').split('\n')) {
      const words = para.split(' ');
      let cur = '';
      for (const wd of words) {
        const test = cur ? `${cur} ${wd}` : wd;
        if (ctx.measureText(test).width > maxW && cur) {
          lines.push(cur);
          cur = wd;
        } else cur = test;
      }
      lines.push(cur);
    }
    if (this._wrap.size > 800) this._wrap.clear();
    this._wrap.set(key, lines);
    return lines;
  }

  /** Абзац с переносом. @returns {number} высота */
  para(str, x, y, maxW, o = {}) {
    const size = o.size || 13;
    const lh = o.lh || Math.round(size * 1.38);
    const lines = this.wrap(str, maxW, size, o.bold ? 600 : o.weight || 400, o.family || FONT);
    const max = o.maxLines || lines.length;
    for (let i = 0; i < Math.min(max, lines.length); i++) {
      let l = lines[i];
      if (i === max - 1 && lines.length > max) l = `${l}…`;
      this.text(l, x, y + i * lh, { ...o, maxW: undefined });
    }
    return Math.min(max, lines.length) * lh;
  }

  paraHeight(str, maxW, o = {}) {
    const size = o.size || 13;
    const lh = o.lh || Math.round(size * 1.38);
    const n = this.wrap(str, maxW, size, o.bold ? 600 : o.weight || 400, o.family || FONT).length;
    return Math.min(o.maxLines || n, n) * lh;
  }

  // ---------- Подложки ----------
  panel(x, y, w, h, o = {}) {
    const ctx = this.ctx;
    const r = o.radius ?? 10;
    const accent = o.accent || C.line;
    if (o.block !== false) this.block(x, y, w, h);
    if (o.glow !== false) drawGlow(ctx, x + w / 2, y + h / 2, Math.max(w, h) * 0.62, accent, 0.05 * (o.glowMul ?? 1));
    ctx.fillStyle = o.bg || C.bg;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    // верхний блик
    const g = ctx.createLinearGradient(0, y, 0, y + Math.min(60, h));
    g.addColorStop(0, rgba(accent, 0.1));
    g.addColorStop(1, rgba(accent, 0));
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, Math.min(60, h), r);
    ctx.fill();
    ctx.strokeStyle = rgba(accent, 0.28);
    ctx.lineWidth = 4;
    roundRect(ctx, x, y, w, h, r);
    ctx.stroke();
    ctx.strokeStyle = rgba(accent, o.borderAlpha ?? 0.95);
    ctx.lineWidth = 1.2;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.stroke();
    if (o.corners !== false) this.corners(x, y, w, h, o.cornerColor || mix(accent, '#ffffff', 0.35));
    if (o.title) {
      this.text(o.title, x + 16, y + 12, { size: o.titleSize || 16, bold: true, color: o.titleColor || C.cyan, glow: 6 });
      ctx.fillStyle = rgba(accent, 0.45);
      ctx.fillRect(x + 14, y + 38, w - 28, 1);
      return { x: x + 14, y: y + 48, w: w - 28, h: h - 60 };
    }
    return { x: x + 12, y: y + 10, w: w - 24, h: h - 20 };
  }

  /** Уголки-скобки неоновой рамки. */
  corners(x, y, w, h, color, len = 9) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + len + 2);
    ctx.lineTo(x + 2, y + 2);
    ctx.lineTo(x + len + 2, y + 2);
    ctx.moveTo(x + w - len - 2, y + 2);
    ctx.lineTo(x + w - 2, y + 2);
    ctx.lineTo(x + w - 2, y + len + 2);
    ctx.moveTo(x + w - 2, y + h - len - 2);
    ctx.lineTo(x + w - 2, y + h - 2);
    ctx.lineTo(x + w - len - 2, y + h - 2);
    ctx.moveTo(x + len + 2, y + h - 2);
    ctx.lineTo(x + 2, y + h - 2);
    ctx.lineTo(x + 2, y + h - len - 2);
    ctx.stroke();
  }

  pill(x, y, w, h, accent = C.line, bg = C.bg) {
    const ctx = this.ctx;
    this.block(x, y, w, h);
    ctx.fillStyle = bg;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = rgba(accent, 0.25);
    ctx.lineWidth = 3;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(accent, 0.85);
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2);
    ctx.stroke();
  }

  sep(x, y, w, color = C.line, a = 0.35) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(0.15, rgba(color, a));
    g.addColorStop(0.85, rgba(color, a));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, 1);
  }

  /** Полоса 0..1 с неоновым кончиком. */
  bar(x, y, w, h, v, color = C.cyan, o = {}) {
    const ctx = this.ctx;
    v = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    ctx.fillStyle = o.bg || 'rgba(255,255,255,0.07)';
    roundRect(ctx, x, y, w, h, Math.min(h / 2, 3));
    ctx.fill();
    if (v > 0) {
      ctx.fillStyle = o.fill || rgba(color, 0.85);
      roundRect(ctx, x, y, Math.max(h, w * v), h, Math.min(h / 2, 3));
      ctx.fill();
      if (o.glow !== false) drawGlow(ctx, x + w * v, y + h / 2, h * 3 + 4, color, 0.35);
    }
    if (o.marks) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      for (let i = 1; i < o.marks; i++) ctx.fillRect(x + (w * i) / o.marks, y, 1, h);
    }
  }

  // ---------- Виджеты ----------
  /** Кнопка. opts: {accent, active, disabled, tooltip, size, sub, align, icon, focus: true, danger, ghost} */
  button(id, x, y, w, h, label, o = {}) {
    const ctx = this.ctx;
    this.note(id, x, y, w, h);
    const hover = !o.disabled && this.inside(x, y, w, h);
    const focused = o.focus !== false && !o.disabled && this.focusable(id, hover);
    this.block(x, y, w, h);
    const accent = o.danger ? C.bad : o.accent || C.line;
    const hot = hover || focused;
    if (hot) this.lastHover = id;
    if (!o.ghost || hot || o.active) {
      ctx.fillStyle = o.active ? rgba(accent, 0.22) : hot ? rgba(accent, 0.2) : 'rgba(18,22,46,0.88)';
      roundRect(ctx, x, y, w, h, o.radius ?? 6);
      ctx.fill();
    }
    if (hot && !o.disabled) drawGlow(ctx, x + w / 2, y + h / 2, Math.max(w, h) * 0.55, accent, 0.18);
    ctx.strokeStyle = o.disabled ? 'rgba(108,92,255,0.25)' : o.active || hot ? mix(accent, '#ffffff', 0.25) : rgba(accent, o.ghost ? 0.35 : 0.6);
    ctx.lineWidth = focused ? 1.8 : 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, o.radius ?? 6);
    ctx.stroke();
    if (focused) {
      const p = 0.5 + Math.sin(this.time * 6) * 0.25;
      ctx.strokeStyle = rgba(C.cyan, p);
      ctx.lineWidth = 1;
      roundRect(ctx, x - 2.5, y - 2.5, w + 5, h + 5, (o.radius ?? 6) + 2);
      ctx.stroke();
    }
    const size = o.size || 14;
    const color = o.disabled ? C.faint : o.color || (o.active || hot ? '#ffffff' : C.text);
    const align = o.align || 'center';
    const tx = align === 'left' ? x + 14 + (o.icon ? 20 : 0) : x + w / 2;
    if (o.icon) {
      const ix = align === 'left' ? x + 16 : x + w / 2 - this.measure(label, size, 600) / 2 - 12;
      drawIcon(ctx, o.icon, ix, y + h / 2, 7, o.disabled ? C.faint : o.iconColor || accent);
    }
    const ty = o.sub ? y + h / 2 - 8 : y + h / 2;
    this.text(label, align === 'center' && o.icon ? tx + 10 : tx, ty, { align, baseline: 'middle', size, bold: true, color, maxW: w > 40 ? w - 20 : w });
    if (o.sub) this.text(o.sub, align === 'center' ? x + w / 2 : tx, y + h / 2 + 9, { align, baseline: 'middle', size: 11, color: C.dim, maxW: w - 20 });
    if (o.tooltip && hover) this.tip(Array.isArray(o.tooltip) ? o.tooltip : [o.tooltip]);
    if (o.disabled) return false;
    if (this.clicked(x, y, w, h) || (this.activate === id && focused)) {
      this.activate = null;
      this.game.audio?.play('ui_click');
      return true;
    }
    return false;
  }

  /** Переключатель. @returns {boolean|undefined} новое значение при изменении */
  toggle(id, x, y, w, label, value, o = {}) {
    const h = o.h || 30;
    this.note(id, x, y, w, h);
    const hover = this.inside(x, y, w, h);
    const focused = this.focusable(id, hover);
    this.block(x, y, w, h);
    const ctx = this.ctx;
    if (hover || focused) {
      ctx.fillStyle = 'rgba(108,92,255,0.12)';
      roundRect(ctx, x, y, w, h, 6);
      ctx.fill();
    }
    this.text(label, x + 10, y + h / 2, { baseline: 'middle', size: o.size || 14, color: focused ? '#fff' : C.text, maxW: w - 80 });
    const sw = 42;
    const sx = x + w - sw - 8;
    const sy = y + h / 2 - 9;
    ctx.fillStyle = value ? rgba(C.cyan, 0.3) : 'rgba(255,255,255,0.06)';
    roundRect(ctx, sx, sy, sw, 18, 9);
    ctx.fill();
    ctx.strokeStyle = value ? C.cyan : 'rgba(140,147,184,0.6)';
    ctx.lineWidth = 1;
    roundRect(ctx, sx + 0.5, sy + 0.5, sw - 1, 17, 9);
    ctx.stroke();
    const kx = value ? sx + sw - 10 : sx + 10;
    if (value) drawGlow(ctx, kx, sy + 9, 14, C.cyan, 0.6);
    ctx.fillStyle = value ? '#ffffff' : C.dim;
    ctx.beginPath();
    ctx.arc(kx, sy + 9, 6, 0, Math.PI * 2);
    ctx.fill();
    if (focused) this.focusRing(x, y, w, h);
    if (o.tooltip && hover) this.tip(Array.isArray(o.tooltip) ? o.tooltip : [o.tooltip]);
    if (this.clicked(x, y, w, h) || (this.activate === id && focused) || (focused && this.navX)) {
      this.activate = null;
      this.navX = 0;
      this.game.audio?.play('ui_click');
      return !value;
    }
    return undefined;
  }

  focusRing(x, y, w, h) {
    const ctx = this.ctx;
    const p = 0.45 + Math.sin(this.time * 6) * 0.25;
    ctx.strokeStyle = rgba(C.cyan, p);
    ctx.lineWidth = 1;
    roundRect(ctx, x - 1.5, y - 1.5, w + 3, h + 3, 7);
    ctx.stroke();
  }

  /** Ползунок. @returns {number|undefined} новое значение */
  slider(id, x, y, w, label, value, min, max, step, o = {}) {
    const h = o.h || 34;
    const ctx = this.ctx;
    const hover = this.inside(x, y, w, h);
    const focused = this.focusable(id, hover);
    this.block(x, y, w, h);
    if (hover || focused) {
      ctx.fillStyle = 'rgba(108,92,255,0.1)';
      roundRect(ctx, x, y, w, h, 6);
      ctx.fill();
    }
    const fmt = o.format ? o.format(value) : `${Math.round(((value - min) / (max - min)) * 100)}%`;
    const labW = o.labelW ?? Math.min(200, w * 0.42);
    this.text(label, x + 10, y + h / 2, { baseline: 'middle', size: o.size || 14, color: focused ? '#fff' : C.text, maxW: labW - 12 });
    const tx = x + labW;
    const tw = w - labW - 62;
    const ty = y + h / 2;
    const v01 = (value - min) / (max - min);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, tx, ty - 2, tw, 4, 2);
    ctx.fill();
    ctx.fillStyle = rgba(o.accent || C.cyan, 0.8);
    roundRect(ctx, tx, ty - 2, Math.max(4, tw * v01), 4, 2);
    ctx.fill();
    const kx = tx + tw * v01;
    drawGlow(ctx, kx, ty, 16, o.accent || C.cyan, 0.55);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(kx, ty, 6.5, 0, Math.PI * 2);
    ctx.fill();
    this.text(fmt, x + w - 10, ty, { align: 'right', baseline: 'middle', size: 13, color: C.cyan, font: `600 13px ${MONO}` });
    if (focused) this.focusRing(x, y, w, h);
    const snap = (v) => {
      v = Math.max(min, Math.min(max, v));
      if (step) v = Math.round((v - min) / step) * step + min;
      return Math.round(v * 1000) / 1000;
    };
    if (this.pressed(0) && this.inside(tx - 10, y, tw + 20, h)) {
      this.take(0);
      this.drag = id;
    }
    if (this.drag === id) {
      if (!this.input.keyDown('Mouse0')) this.drag = null;
      else {
        const nv = snap(min + ((this.mx - tx) / tw) * (max - min));
        if (nv !== value) return nv;
        return undefined;
      }
    }
    if (focused && this.navX) {
      const d = this.navX;
      this.navX = 0;
      return snap(value + d * (step || (max - min) / 20));
    }
    return undefined;
  }

  /** Выбор из вариантов (кнопки-чипы в ряд). options: [{id, label, color?, tooltip?}] @returns {string|undefined} */
  chips(id, x, y, w, options, value, o = {}) {
    const h = o.h || 30;
    const gap = o.gap ?? 6;
    const n = options.length;
    const cw = (w - gap * (n - 1)) / n;
    let out;
    const hoverAny = this.inside(x, y, w, h);
    const focused = this.focusable(id, hoverAny);
    this.block(x, y, w, h);
    const ctx = this.ctx;
    options.forEach((op, i) => {
      const cx = x + i * (cw + gap);
      const sel = op.id === value;
      this.note(`${id}:${op.id}`, cx, y, cw, h);
      const hov = this.inside(cx, y, cw, h);
      const acc = op.color || o.accent || C.cyan;
      ctx.fillStyle = sel ? rgba(acc, 0.22) : hov ? 'rgba(108,92,255,0.18)' : 'rgba(18,22,46,0.85)';
      roundRect(ctx, cx, y, cw, h, 6);
      ctx.fill();
      ctx.strokeStyle = sel ? acc : hov ? '#a89cff' : 'rgba(108,92,255,0.5)';
      ctx.lineWidth = sel ? 1.4 : 1;
      roundRect(ctx, cx + 0.5, y + 0.5, cw - 1, h - 1, 6);
      ctx.stroke();
      if (sel) drawGlow(ctx, cx + cw / 2, y + h / 2, cw * 0.5, acc, 0.22);
      this.text(op.label, cx + cw / 2, y + h / 2, { align: 'center', baseline: 'middle', size: o.size || 13, bold: sel, color: sel ? '#fff' : C.text, maxW: cw - 8 });
      if (hov && op.tooltip) this.tip(Array.isArray(op.tooltip) ? op.tooltip : [op.tooltip]);
      if (this.clicked(cx, y, cw, h)) {
        this.game.audio?.play('ui_click');
        out = op.id;
      }
    });
    if (focused) {
      this.focusRing(x, y, w, h);
      if (this.navX) {
        const i = options.findIndex((op) => op.id === value);
        const ni = Math.max(0, Math.min(n - 1, (i < 0 ? 0 : i) + this.navX));
        this.navX = 0;
        if (options[ni] && options[ni].id !== value) out = options[ni].id;
      }
      if (this.activate === id) {
        this.activate = null;
        const i = options.findIndex((op) => op.id === value);
        out = options[(i + 1) % n].id;
      }
    }
    return out;
  }

  /** Степпер «− значение +». @returns {number|undefined} */
  stepper(id, x, y, w, label, value, min, max, o = {}) {
    const h = o.h || 34;
    const hover = this.inside(x, y, w, h);
    const focused = this.focusable(id, hover);
    this.block(x, y, w, h);
    const ctx = this.ctx;
    if (hover || focused) {
      ctx.fillStyle = 'rgba(108,92,255,0.1)';
      roundRect(ctx, x, y, w, h, 6);
      ctx.fill();
    }
    this.text(label, x + 10, y + h / 2, { baseline: 'middle', size: o.size || 14, color: focused ? '#fff' : C.text });
    const bx = x + w - 130;
    let out;
    const prev = this.mode;
    if (this.smallBtn(bx, y + 5, 28, h - 10, '−', value <= min)) out = value - 1;
    this.text(o.format ? o.format(value) : String(value), bx + 64, y + h / 2, { align: 'center', baseline: 'middle', size: 15, bold: true, color: C.cyan });
    if (this.smallBtn(bx + 100, y + 5, 28, h - 10, '+', value >= max)) out = value + 1;
    void prev;
    if (focused) {
      this.focusRing(x, y, w, h);
      if (this.navX) {
        out = value + this.navX;
        this.navX = 0;
      }
    }
    if (out !== undefined) out = Math.max(min, Math.min(max, out));
    return out === value ? undefined : out;
  }

  smallBtn(x, y, w, h, label, disabled) {
    const ctx = this.ctx;
    const hover = !disabled && this.inside(x, y, w, h);
    ctx.fillStyle = hover ? 'rgba(94,242,255,0.2)' : 'rgba(18,22,46,0.9)';
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = disabled ? 'rgba(108,92,255,0.25)' : hover ? C.cyan : 'rgba(108,92,255,0.6)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 5);
    ctx.stroke();
    this.text(label, x + w / 2, y + h / 2 + 0.5, { align: 'center', baseline: 'middle', size: 15, bold: true, color: disabled ? C.faint : '#fff' });
    if (!disabled && this.clicked(x, y, w, h)) {
      this.game.audio?.play('ui_click');
      return true;
    }
    return false;
  }

  /** Текстовое поле. @returns {string} текущее значение */
  textField(id, x, y, w, h, value, o = {}) {
    const ctx = this.ctx;
    this.note(id, x, y, w, h);
    const hover = this.inside(x, y, w, h);
    const focusedNav = this.focusable(id, hover);
    const editing = this.textFocus === id;
    this.block(x, y, w, h);
    ctx.fillStyle = editing ? 'rgba(94,242,255,0.08)' : 'rgba(10,12,28,0.9)';
    roundRect(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = editing ? C.cyan : hover || focusedNav ? '#a89cff' : 'rgba(108,92,255,0.55)';
    ctx.lineWidth = editing ? 1.5 : 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 6);
    ctx.stroke();
    if (o.label) this.text(o.label, x, y - 17, { size: 12, color: C.dim });
    let v = String(value ?? '');
    if (editing && this._typedFrame !== this.frameNo) {
      this._typedFrame = this.frameNo;
      for (const ch of this.input.typed) {
        if (ch === '\b') v = v.slice(0, -1);
        else if (ch >= ' ' && v.length < (o.maxLen || 32)) v += ch;
      }
      if (this.input.keyPressed('Enter') || this.input.keyPressed('NumpadEnter')) this.blurText();
    }
    const shown = v || (editing ? '' : o.placeholder || '');
    const tw = this.text(shown, x + 10, y + h / 2, { baseline: 'middle', size: o.size || 15, color: v ? '#fff' : C.faint, maxW: w - 24 });
    if (editing && Math.floor(this.time * 2.2) % 2 === 0) {
      ctx.fillStyle = C.cyan;
      ctx.fillRect(x + 11 + (v ? tw : 0), y + 7, 1.5, h - 14);
    }
    if (focusedNav && !editing) this.focusRing(x, y, w, h);
    if (this.clicked(x, y, w, h) || (this.activate === id && focusedNav)) {
      this.activate = null;
      this.focusText(id);
    } else if (editing && this.pressed(0) && !this.inside(x, y, w, h)) this.blurText();
    return v;
  }

  focusText(id) {
    this.textFocus = id;
    this.input.captureText('ui');
  }

  blurText() {
    if (this.textFocus) {
      this.textFocus = null;
      this.input.releaseText();
    }
  }

  // ---------- Прокрутка ----------
  /** Область прокрутки: вызывает draw(offsetY) с клипом. @returns {number} смещение */
  scrollArea(id, x, y, w, h, contentH, draw) {
    const ctx = this.ctx;
    let sc = this.scroll[id] || 0;
    if (this.inside(x, y, w, h)) {
      const wh = this.wheel();
      if (wh) sc += wh * 48;
    }
    sc = Math.max(0, Math.min(Math.max(0, contentH - h), sc));
    this.scroll[id] = sc;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const prev = this.interactive;
    // вне видимой области клики не принимаем
    if (!this.inside(x, y, w, h)) this.interactive = false;
    try {
      draw(sc);
    } finally {
      this.interactive = prev;
      ctx.restore();
    }
    if (contentH > h) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + w - 3, y, 3, h);
      ctx.fillStyle = rgba(C.line, 0.9);
      ctx.fillRect(x + w - 3, y + (sc / contentH) * h, 3, Math.max(14, (h / contentH) * h));
    }
    return sc;
  }

  // ---------- Подсказка ----------
  tip(lines) {
    if (!lines || !lines.length) return;
    this.tipLines = lines;
  }

  /** Нарисовать отложенную подсказку (слой ui:overlay) у курсора. */
  drawTip(ctx, screenW, screenH) {
    const lines0 = this.tipLines;
    this.tipLines = null;
    if (!lines0) return;
    this.ctx = ctx;
    this.s = this.scale();
    this.push(ctx);
    const lines = lines0.map((l) => (typeof l === 'string' ? { text: l } : l));
    let w = 0;
    let h = 12;
    for (const l of lines) {
      if (l.sep) {
        h += 8;
        continue;
      }
      if (l.bar !== undefined) {
        h += 10;
        continue;
      }
      w = Math.max(w, this.measure(l.text, l.size || 12, l.bold ? 600 : 400));
      h += (l.size || 12) + 6;
    }
    w = Math.min(w + 24, 420);
    const W = screenW / this.s;
    const H = screenH / this.s;
    let x = this.mx + 16;
    let y = this.my + 18;
    if (x + w > W - 6) x = Math.max(6, this.mx - w - 12);
    if (y + h > H - 6) y = Math.max(6, H - h - 6);
    ctx.fillStyle = 'rgba(6,8,20,0.95)';
    roundRect(ctx, x, y, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(108,92,255,0.85)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 7);
    ctx.stroke();
    let cy = y + 7;
    for (const l of lines) {
      if (l.sep) {
        this.sep(x + 8, cy + 3, w - 16);
        cy += 8;
        continue;
      }
      if (l.bar !== undefined) {
        this.bar(x + 12, cy + 2, w - 24, 4, l.bar, l.color || C.cyan, { glow: false });
        cy += 10;
        continue;
      }
      this.text(l.text, x + 12, cy, { size: l.size || 12, bold: l.bold, color: l.color || C.text, maxW: w - 24 });
      cy += (l.size || 12) + 6;
    }
    this.pop(ctx);
  }
}

/** Свечение текста без shadowBlur в цикле: один проход с shadowBlur — только для немногих заголовков. */
function drawTextGlow(ctx, s, x, y, color, blur) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.globalAlpha *= 0.75;
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** Простые векторные иконки UI. */
export function drawIcon(ctx, name, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, r * 0.22);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (name) {
    case 'play':
      ctx.moveTo(-r * 0.5, -r * 0.7);
      ctx.lineTo(r * 0.7, 0);
      ctx.lineTo(-r * 0.5, r * 0.7);
      ctx.closePath();
      ctx.fill();
      break;
    case 'plus':
      ctx.moveTo(-r * 0.7, 0);
      ctx.lineTo(r * 0.7, 0);
      ctx.moveTo(0, -r * 0.7);
      ctx.lineTo(0, r * 0.7);
      ctx.stroke();
      break;
    case 'save':
      ctx.rect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
      ctx.moveTo(-r * 0.35, -r * 0.7);
      ctx.lineTo(-r * 0.35, -r * 0.2);
      ctx.lineTo(r * 0.35, -r * 0.2);
      ctx.lineTo(r * 0.35, -r * 0.7);
      ctx.stroke();
      break;
    case 'load':
      ctx.moveTo(0, -r * 0.8);
      ctx.lineTo(0, r * 0.3);
      ctx.moveTo(-r * 0.45, -r * 0.1);
      ctx.lineTo(0, r * 0.35);
      ctx.lineTo(r * 0.45, -r * 0.1);
      ctx.moveTo(-r * 0.75, r * 0.75);
      ctx.lineTo(r * 0.75, r * 0.75);
      ctx.stroke();
      break;
    case 'gear':
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        ctx.lineTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'info':
      ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.1);
      ctx.lineTo(0, r * 0.45);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -r * 0.4, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'door':
      ctx.moveTo(-r * 0.5, r * 0.8);
      ctx.lineTo(-r * 0.5, -r * 0.8);
      ctx.lineTo(r * 0.5, -r * 0.8);
      ctx.lineTo(r * 0.5, r * 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.2, 0, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'back':
      ctx.moveTo(r * 0.6, 0);
      ctx.lineTo(-r * 0.6, 0);
      ctx.moveTo(-r * 0.1, -r * 0.5);
      ctx.lineTo(-r * 0.6, 0);
      ctx.lineTo(-r * 0.1, r * 0.5);
      ctx.stroke();
      break;
    case 'dice':
      ctx.rect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
      ctx.stroke();
      for (const [dx, dy] of [[-0.3, -0.3], [0.3, 0.3], [0, 0]]) {
        ctx.beginPath();
        ctx.arc(dx * r, dy * r, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'trash':
      ctx.moveTo(-r * 0.7, -r * 0.5);
      ctx.lineTo(r * 0.7, -r * 0.5);
      ctx.moveTo(-r * 0.5, -r * 0.5);
      ctx.lineTo(-r * 0.35, r * 0.8);
      ctx.lineTo(r * 0.35, r * 0.8);
      ctx.lineTo(r * 0.5, -r * 0.5);
      ctx.moveTo(-r * 0.2, -r * 0.5);
      ctx.lineTo(-r * 0.15, -r * 0.8);
      ctx.lineTo(r * 0.15, -r * 0.8);
      ctx.lineTo(r * 0.2, -r * 0.5);
      ctx.stroke();
      break;
    case 'check':
      ctx.moveTo(-r * 0.6, 0);
      ctx.lineTo(-r * 0.15, r * 0.5);
      ctx.lineTo(r * 0.7, -r * 0.5);
      ctx.stroke();
      break;
    case 'cross':
      ctx.moveTo(-r * 0.5, -r * 0.5);
      ctx.lineTo(r * 0.5, r * 0.5);
      ctx.moveTo(r * 0.5, -r * 0.5);
      ctx.lineTo(-r * 0.5, r * 0.5);
      ctx.stroke();
      break;
    case 'warn':
      ctx.moveTo(0, -r * 0.85);
      ctx.lineTo(r * 0.85, r * 0.7);
      ctx.lineTo(-r * 0.85, r * 0.7);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.3);
      ctx.lineTo(0, r * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, r * 0.45, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'skull':
      ctx.arc(0, -r * 0.15, r * 0.6, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(r * 0.35, r * 0.7);
      ctx.lineTo(-r * 0.35, r * 0.7);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-r * 0.22, -r * 0.1, r * 0.13, 0, Math.PI * 2);
      ctx.arc(r * 0.22, -r * 0.1, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'heart':
      ctx.moveTo(0, r * 0.75);
      ctx.bezierCurveTo(-r * 1.1, 0, -r * 0.6, -r * 0.95, 0, -r * 0.35);
      ctx.bezierCurveTo(r * 0.6, -r * 0.95, r * 1.1, 0, 0, r * 0.75);
      ctx.fill();
      break;
    case 'bolt':
      ctx.moveTo(r * 0.2, -r * 0.9);
      ctx.lineTo(-r * 0.45, r * 0.1);
      ctx.lineTo(0, r * 0.1);
      ctx.lineTo(-r * 0.2, r * 0.9);
      ctx.lineTo(r * 0.45, -r * 0.1);
      ctx.lineTo(0, -r * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    case 'swords':
      ctx.moveTo(-r * 0.75, -r * 0.75);
      ctx.lineTo(r * 0.6, r * 0.6);
      ctx.moveTo(r * 0.75, -r * 0.75);
      ctx.lineTo(-r * 0.6, r * 0.6);
      ctx.moveTo(-r * 0.75, r * 0.3);
      ctx.lineTo(-r * 0.3, r * 0.75);
      ctx.moveTo(r * 0.75, r * 0.3);
      ctx.lineTo(r * 0.3, r * 0.75);
      ctx.stroke();
      break;
    case 'food':
      ctx.arc(0, r * 0.1, r * 0.65, 0, Math.PI);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -r * 0.3);
      ctx.quadraticCurveTo(-r * 0.1, -r * 0.6, -r * 0.3, -r * 0.9);
      ctx.moveTo(r * 0.2, -r * 0.3);
      ctx.quadraticCurveTo(r * 0.4, -r * 0.6, r * 0.2, -r * 0.9);
      ctx.stroke();
      break;
    case 'fire':
      ctx.moveTo(0, -r * 0.95);
      ctx.quadraticCurveTo(r * 0.85, -r * 0.1, r * 0.45, r * 0.75);
      ctx.quadraticCurveTo(0, r * 1.0, -r * 0.45, r * 0.75);
      ctx.quadraticCurveTo(-r * 0.85, -r * 0.05, 0, -r * 0.95);
      ctx.fill();
      break;
    case 'flag':
      ctx.moveTo(-r * 0.6, r * 0.9);
      ctx.lineTo(-r * 0.6, -r * 0.9);
      ctx.lineTo(r * 0.7, -r * 0.5);
      ctx.lineTo(-r * 0.6, -r * 0.1);
      ctx.stroke();
      break;
    case 'train':
      ctx.rect(-r * 0.8, -r * 0.55, r * 1.6, r * 1.0);
      ctx.moveTo(-r * 0.4, -r * 0.55);
      ctx.lineTo(-r * 0.4, -r * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-r * 0.4, r * 0.65, r * 0.2, 0, Math.PI * 2);
      ctx.arc(r * 0.4, r * 0.65, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'clock':
      ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r * 0.5);
      ctx.moveTo(0, 0);
      ctx.lineTo(r * 0.35, r * 0.15);
      ctx.stroke();
      break;
    case 'crown':
      ctx.moveTo(-r * 0.8, r * 0.5);
      ctx.lineTo(-r * 0.8, -r * 0.4);
      ctx.lineTo(-r * 0.35, r * 0.05);
      ctx.lineTo(0, -r * 0.6);
      ctx.lineTo(r * 0.35, r * 0.05);
      ctx.lineTo(r * 0.8, -r * 0.4);
      ctx.lineTo(r * 0.8, r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case 'zzz':
      ctx.moveTo(-r * 0.6, -r * 0.6);
      ctx.lineTo(r * 0.6, -r * 0.6);
      ctx.lineTo(-r * 0.6, r * 0.6);
      ctx.lineTo(r * 0.6, r * 0.6);
      ctx.stroke();
      break;
    case 'candle':
      ctx.rect(-r * 0.25, -r * 0.1, r * 0.5, r * 0.95);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.9);
      ctx.quadraticCurveTo(r * 0.3, -r * 0.4, 0, -r * 0.2);
      ctx.quadraticCurveTo(-r * 0.3, -r * 0.4, 0, -r * 0.9);
      ctx.fill();
      break;
    case 'pin':
      ctx.arc(0, -r * 0.25, r * 0.5, 0, Math.PI * 2);
      ctx.moveTo(0, r * 0.25);
      ctx.lineTo(0, r * 0.95);
      ctx.stroke();
      break;
    case 'eye':
      ctx.moveTo(-r * 0.9, 0);
      ctx.quadraticCurveTo(0, -r * 0.9, r * 0.9, 0);
      ctx.quadraticCurveTo(0, r * 0.9, -r * 0.9, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'book':
      ctx.moveTo(0, -r * 0.6);
      ctx.lineTo(0, r * 0.75);
      ctx.moveTo(0, -r * 0.6);
      ctx.quadraticCurveTo(-r * 0.4, -r * 0.85, -r * 0.85, -r * 0.6);
      ctx.lineTo(-r * 0.85, r * 0.6);
      ctx.quadraticCurveTo(-r * 0.4, r * 0.4, 0, r * 0.75);
      ctx.quadraticCurveTo(r * 0.4, r * 0.4, r * 0.85, r * 0.6);
      ctx.lineTo(r * 0.85, -r * 0.6);
      ctx.quadraticCurveTo(r * 0.4, -r * 0.85, 0, -r * 0.6);
      ctx.stroke();
      break;
    case 'lock':
      ctx.rect(-r * 0.6, -r * 0.1, r * 1.2, r * 0.9);
      ctx.moveTo(-r * 0.35, -r * 0.1);
      ctx.arc(0, -r * 0.35, r * 0.35, Math.PI, 0);
      ctx.lineTo(r * 0.35, -r * 0.1);
      ctx.stroke();
      break;
    case 'bag':
      ctx.moveTo(-r * 0.7, -r * 0.2);
      ctx.lineTo(r * 0.7, -r * 0.2);
      ctx.lineTo(r * 0.55, r * 0.8);
      ctx.lineTo(-r * 0.55, r * 0.8);
      ctx.closePath();
      ctx.moveTo(-r * 0.3, -r * 0.2);
      ctx.quadraticCurveTo(0, -r * 0.95, r * 0.3, -r * 0.2);
      ctx.stroke();
      break;
    default:
      ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
  }
  ctx.restore();
}
