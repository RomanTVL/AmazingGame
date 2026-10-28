// UI на канвасе (immediate-mode): помощники рисования + реестры панелей, HUD и подсказок.
//   game.ui.registerPanel({id, title, key, width, height, anchor, draw(ctx, game, ui, rect), handleInput?})
//   game.ui.registerHud({id, slot, order, height?, draw(ctx, game, ui, box) → высота})
//   game.ui.registerTooltip({id, order, lines(game, hover) → [строки | {text, color}]})
// Регистрация безопасна в headless (рисование вызывается только в браузере).
import { Registry } from '../core/registry.js';
import { EVENTS } from '../core/events.js';
import { Input } from './input.js';

export const HUD_SLOTS = ['top-left', 'top-center', 'top-right', 'left', 'right', 'bottom-left', 'bottom-center', 'bottom-right'];

export const THEME = {
  font: '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  panelBg: 'rgba(7, 9, 20, 0.88)',
  panelBg2: 'rgba(16, 20, 40, 0.92)',
  border: '#6c5cff',
  accent: '#5ef2ff',
  accent2: '#ff4fd8',
  text: '#e8ecff',
  dim: '#8c93b8',
  good: '#7dff6a',
  bad: '#ff5f6d',
  warn: '#ffb347',
};

export class UI {
  constructor(game) {
    this.game = game;
    this.theme = THEME;
    this.panels = new Registry('panels', { defaults: { width: 520, height: 420, anchor: 'center' } });
    this.hud = new Registry('hud', { sortBy: 'order', defaults: { order: 100, slot: 'top-left' } });
    this.tooltips = new Registry('tooltips', { sortBy: 'order', defaults: { order: 100 } });
    /** Открытые панели (порядок = порядок открытия). */
    this.open = [];
    this.rects = [];
    this.prevRects = [];
    this.scroll = {};
    this.ctx = null;
    this.w = 0;
    this.h = 0;
    this._tooltip = null;
    this.hoverWorld = null;
  }

  // ---------- Реестры ----------
  registerPanel(def, owner = 'core') {
    const p = this.panels.add(def, owner);
    if (def.key) this.game.input.registerKey(`panel:${def.id}`, def.key, owner, { label: def.title });
    return p;
  }

  registerHud(def, owner = 'core') {
    if (!HUD_SLOTS.includes(def.slot || 'top-left')) throw new Error(`[ui] неизвестный HUD-слот ${def.slot}`);
    return this.hud.add(def, owner);
  }

  registerTooltip(def, owner = 'core') {
    return this.tooltips.add(def, owner);
  }

  // ---------- Панели ----------
  isOpen(id) {
    return this.open.includes(id);
  }

  openPanel(id) {
    const def = this.panels.get(id);
    if (!def || this.isOpen(id)) return;
    // одна панель на «якорь»
    for (const o of this.open.slice()) if (this.panels.get(o)?.anchor === def.anchor) this.closePanel(o);
    this.open.push(id);
    def.onOpen?.(this.game);
    this.game.audio?.play('ui_open');
    this.game.events.emit(EVENTS.UI_PANEL_OPENED, { id });
  }

  closePanel(id) {
    const i = this.open.indexOf(id);
    if (i < 0) return;
    this.open.splice(i, 1);
    this.panels.get(id)?.onClose?.(this.game);
    this.game.audio?.play('ui_close');
    this.game.events.emit(EVENTS.UI_PANEL_CLOSED, { id });
  }

  togglePanel(id) {
    if (this.isOpen(id)) this.closePanel(id);
    else this.openPanel(id);
  }

  closeTop() {
    const id = this.open[this.open.length - 1];
    if (id) this.closePanel(id);
    return !!id;
  }

  /** Есть ли открытая модальная панель (блокирует управление лидером). */
  get modalOpen() {
    return this.open.some((id) => this.panels.get(id)?.modal);
  }

  /** Мышь над UI (по прямоугольникам прошлого кадра) — мир не должен реагировать на клик. */
  get wantsMouse() {
    const m = this.game.input.mouse;
    for (const r of this.prevRects) if (m.sx >= r.x && m.sy >= r.y && m.sx < r.x + r.w && m.sy < r.y + r.h) return true;
    return false;
  }

  /** Логика панелей (каждый кадр, до управления лидером). */
  frame(game) {
    for (const id of game.input.bindings.keys()) {
      if (!id.startsWith('panel:')) continue;
      if (game.input.pressed(id)) {
        game.input.consume(id);
        this.togglePanel(id.slice(6));
      }
    }
    for (const id of this.open) {
      const def = this.panels.get(id);
      try {
        def?.handleInput?.(game, game.input);
      } catch (err) {
        game.error(err, `ui.panel:${id}`);
      }
    }
  }

  // ---------- Immediate-mode помощники ----------
  beginFrame(ctx, w, h) {
    this.ctx = ctx;
    this.w = w;
    this.h = h;
    this.prevRects = this.rects;
    this.rects = [];
    this._tooltip = null;
  }

  /** Отметить область как UI (блокирует мышь мира). */
  block(x, y, w, h) {
    this.rects.push({ x, y, w, h });
  }

  mouseIn(x, y, w, h) {
    const m = this.game.input.mouse;
    return m.sx >= x && m.sy >= y && m.sx < x + w && m.sy < y + h;
  }

  /** Клик ЛКМ в области (поглощает клик). */
  clicked(x, y, w, h, button = 0) {
    const code = `Mouse${button}`;
    if (this.game.input.keyPressed(code) && this.mouseIn(x, y, w, h)) {
      this.game.input.consumeCode(code);
      return true;
    }
    return false;
  }

  font(size = 13, weight = '') {
    return `${weight} ${size}px ${THEME.font}`.trim();
  }

  text(str, x, y, o = {}) {
    const ctx = this.ctx;
    ctx.font = o.font || this.font(o.size || 13, o.bold ? '600' : '');
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'top';
    if (o.glow) {
      ctx.save();
      ctx.shadowColor = o.glowColor || o.color || THEME.accent;
      ctx.shadowBlur = o.glow === true ? 8 : o.glow;
      ctx.fillStyle = o.color || THEME.text;
      ctx.fillText(str, x, y);
      ctx.restore();
    } else {
      ctx.fillStyle = o.color || THEME.text;
      ctx.fillText(str, x, y);
    }
    return ctx.measureText(str).width;
  }

  measure(str, size = 13, bold = false) {
    this.ctx.font = this.font(size, bold ? '600' : '');
    return this.ctx.measureText(str).width;
  }

  /** Фон панели с неоновой рамкой. Возвращает внутренний прямоугольник. */
  panel(x, y, w, h, o = {}) {
    const ctx = this.ctx;
    this.block(x, y, w, h);
    ctx.fillStyle = o.bg || THEME.panelBg;
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    const c = o.accent || THEME.border;
    ctx.strokeStyle = c;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 4;
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.2;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
    ctx.stroke();
    let top = y + 10;
    if (o.title) {
      this.text(o.title, x + 14, y + 10, { size: 15, bold: true, color: o.titleColor || THEME.accent, glow: 6 });
      top = y + 36;
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(x + 12, y + 31, w - 24, 1);
      ctx.globalAlpha = 1;
    }
    return { x: x + 12, y: top, w: w - 24, h: h - (top - y) - 10 };
  }

  /** Кнопка. @returns {boolean} нажата в этом кадре */
  button(x, y, w, h, label, o = {}) {
    const ctx = this.ctx;
    const hover = !o.disabled && this.mouseIn(x, y, w, h);
    this.block(x, y, w, h);
    ctx.fillStyle = o.active ? 'rgba(94,242,255,0.18)' : hover ? 'rgba(108,92,255,0.25)' : 'rgba(20,24,48,0.85)';
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = o.active ? THEME.accent : hover ? '#a89cff' : 'rgba(108,92,255,0.6)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 5);
    ctx.stroke();
    this.text(label, x + w / 2, y + h / 2, { align: 'center', baseline: 'middle', size: o.size || 13, color: o.disabled ? THEME.dim : THEME.text });
    if (o.tooltip && hover) this.tooltip([o.tooltip]);
    if (!o.disabled && this.clicked(x, y, w, h)) {
      this.game.audio?.play('ui_click');
      return true;
    }
    return false;
  }

  /** Полоса значения 0..1. */
  bar(x, y, w, h, v, color = THEME.accent, bg = 'rgba(255,255,255,0.08)') {
    const ctx = this.ctx;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(0, Math.min(1, v)) * w, h);
  }

  /** Подсказка у курсора (рисуется в конце кадра поверх всего). */
  tooltip(lines, x, y) {
    const m = this.game.input.mouse;
    this._tooltip = { lines, x: x ?? m.sx + 16, y: y ?? m.sy + 18 };
  }

  /**
   * Прокручиваемый список. drawRow(ctx, item, x, y, w, rowH, hover, index). Возвращает кликнутый элемент или null.
   */
  list(id, x, y, w, h, items, rowH, drawRow) {
    const ctx = this.ctx;
    this.block(x, y, w, h);
    const total = items.length * rowH;
    let sc = this.scroll[id] || 0;
    if (this.mouseIn(x, y, w, h) && this.game.input.mouse.wheel) {
      sc += this.game.input.mouse.wheel * rowH * 2;
      this.game.input.mouse.wheel = 0;
    }
    sc = Math.max(0, Math.min(Math.max(0, total - h), sc));
    this.scroll[id] = sc;
    let clicked = null;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const first = Math.floor(sc / rowH);
    const last = Math.min(items.length - 1, Math.ceil((sc + h) / rowH));
    for (let i = first; i <= last; i++) {
      const ry = y + i * rowH - sc;
      const hover = this.mouseIn(x, Math.max(y, ry), w, Math.min(rowH, y + h - ry));
      if (hover) {
        ctx.fillStyle = 'rgba(108,92,255,0.15)';
        ctx.fillRect(x, ry, w, rowH);
      }
      drawRow(ctx, items[i], x, ry, w, rowH, hover, i);
      if (hover && this.clicked(x, ry, w, rowH)) clicked = items[i];
    }
    ctx.restore();
    if (total > h) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + w - 3, y, 3, h);
      ctx.fillStyle = THEME.border;
      ctx.fillRect(x + w - 3, y + (sc / total) * h, 3, (h / total) * h);
    }
    return clicked;
  }

  // ---------- Полная отрисовка UI (вызывает слой 'ui' рендера) ----------
  drawAll(ctx, game, w, h) {
    this.beginFrame(ctx, w, h);
    this._drawHud(ctx, game, w, h);
    this._drawPanels(ctx, game, w, h);
    this._drawWorldTooltip(ctx, game);
    if (this._tooltip) this._drawTooltip(ctx, this._tooltip);
  }

  _drawHud(ctx, game, w, h) {
    const pad = 14;
    const cursor = {
      'top-left': pad, 'top-center': pad, 'top-right': pad, left: h * 0.25, right: h * 0.22,
      'bottom-left': h - pad, 'bottom-center': h - pad, 'bottom-right': h - pad,
    };
    for (const item of this.hud.all()) {
      if (item.visible && !item.visible(game)) continue;
      const slot = item.slot;
      const bottom = slot.startsWith('bottom');
      const align = slot.endsWith('right') ? 'right' : slot.endsWith('center') ? 'center' : 'left';
      const x = align === 'left' ? pad : align === 'right' ? w - pad : w / 2;
      let y = cursor[slot];
      let hh = 0;
      if (bottom) {
        hh = typeof item.height === 'function' ? item.height(game, this) : item.height ?? 24;
        if (!hh) continue;
        y -= hh;
      }
      try {
        const used = item.draw(ctx, game, this, { x, y, align, slot, w: w * 0.4 }) ?? hh;
        cursor[slot] = bottom ? y - 6 : y + used + 6;
      } catch (err) {
        game.error(err, `ui.hud:${item.id}`);
      }
    }
  }

  _drawPanels(ctx, game, w, h) {
    for (const id of this.open) {
      const def = this.panels.get(id);
      if (!def) continue;
      const pw = Math.min(def.width, w - 40);
      const ph = Math.min(def.height, h - 120);
      let x = (w - pw) / 2;
      let y = (h - ph) / 2;
      if (def.anchor === 'left') x = 20;
      if (def.anchor === 'right') x = w - pw - 20;
      if (def.anchor === 'left' || def.anchor === 'right') y = 70;
      const title = def.title ? game.t(def.title) : '';
      const inner = this.panel(x, y, pw, ph, { title });
      // кнопка закрытия
      if (this.button(x + pw - 30, y + 8, 20, 20, '×', { size: 14 })) {
        this.closePanel(id);
        continue;
      }
      try {
        def.draw(ctx, game, this, inner);
      } catch (err) {
        game.error(err, `ui.panel:${id}`);
      }
    }
  }

  _drawWorldTooltip(ctx, game) {
    const m = game.input.mouse;
    if (!m.inside || this.wantsMouse || !game.map || !game.map.inBounds(m.tx, m.ty)) return;
    if (game.input.keyDown('Mouse0') || game.input.keyDown('Mouse2')) return;
    if (!game.api.vision.isExplored(m.tx, m.ty)) return;
    const hover = { tx: m.tx, ty: m.ty, wx: m.wx, wy: m.wy, entities: game.entities.atTile(m.tx, m.ty) };
    // пешки рядом с курсором (по радиусу)
    for (const p of game.entities.queryRadius(m.wx, m.wy, 0.6, 'pawn')) if (!hover.entities.includes(p)) hover.entities.push(p);
    this.hoverWorld = hover;
    const lines = [];
    for (const tp of this.tooltips.all()) {
      try {
        const l = tp.lines(game, hover);
        if (l && l.length) {
          if (lines.length) lines.push({ sep: true });
          lines.push(...l);
        }
      } catch (err) {
        game.error(err, `ui.tooltip:${tp.id}`);
      }
    }
    if (lines.length && !this._tooltip) this._tooltip = { lines, x: m.sx + 18, y: m.sy + 20 };
  }

  _drawTooltip(ctx, tt) {
    const lines = tt.lines.map((l) => (typeof l === 'string' ? { text: l } : l));
    let w = 0;
    let h = 8;
    for (const l of lines) {
      if (l.sep) {
        h += 6;
        continue;
      }
      w = Math.max(w, this.measure(l.text, l.size || 12, l.bold));
      h += (l.size || 12) + 5;
    }
    w += 20;
    let x = tt.x;
    let y = tt.y;
    if (x + w > this.w - 6) x = this.w - w - 6;
    if (y + h > this.h - 6) y = this.h - h - 6;
    ctx.fillStyle = 'rgba(6,8,18,0.92)';
    roundRect(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(108,92,255,0.7)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 6);
    ctx.stroke();
    let cy = y + 6;
    for (const l of lines) {
      if (l.sep) {
        ctx.fillStyle = 'rgba(108,92,255,0.35)';
        ctx.fillRect(x + 8, cy + 2, w - 16, 1);
        cy += 6;
        continue;
      }
      this.text(l.text, x + 10, cy, { size: l.size || 12, color: l.color || THEME.text, bold: l.bold });
      cy += (l.size || 12) + 5;
    }
  }

  /** Подпись клавиши действия: '[E]' */
  keyHint(action) {
    return `[${Input.keyLabel(this.game.input.keyOf(action))}]`;
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
