// UI стройки: меню B (вкладки, список), призрак под мышью (зелёный/красный), G — поворот, протяжка линией (стены)
// и прямоугольником (пол), ПКМ — отмена; инструменты Z (зоны склада + фильтр) и X (снос/отмена).
// Отрисовка — только в draw(); кадровая система (order 15) перехватывает ЛКМ до атаки лидера (player, order 30).
import { TILE } from '../../core/constants.js';
import { rgba } from '../../render/color.js';
import { OWNER } from './core.js';
import { MENU_TABS, CATEGORY_TAB, MENU_FLOORS, STOCK_FILTERS } from './defs.js';
import { ghostDrawer } from './art.js';

const T = TILE;
const MAX_CELLS = 160;
const OK_COLOR = '#5effa0';
const BAD_COLOR = '#ff5f6d';

export function freshUi() {
  return { mode: null, tab: 'walls', sel: null, rot: 0, drag: null, zoneSel: 0, zoneFilter: 'all', reason: '' };
}

/** Вкладка меню для постройки (или null — не показывать). */
export function tabOf(def) {
  if (!def || def.buildable === false || def.natural || def.category === 'train' || def.lockedOf) return null;
  if (def.menu) return MENU_TABS.includes(def.menu) ? def.menu : null;
  if (def.bed || def.prisonerBed) return 'furniture';
  return CATEGORY_TAB[def.category] || null;
}

/** Пункты вкладки: [{kind: 'building'|'floor', id, def}]. */
export function menuItems(game, tab) {
  const out = [];
  for (const def of game.defs.buildings.all()) if (tabOf(def) === tab) out.push({ kind: 'building', id: def.id, def });
  for (const f of MENU_FLOORS) {
    const def = game.defs.floors.get(f.id);
    if (def && f.menu === tab) out.push({ kind: 'floor', id: f.id, def, color: f.color });
  }
  return out;
}

/** Клетки протяжки: линия по главной оси (стены) или прямоугольник (пол). */
export function dragCells(x0, y0, x1, y1, mode) {
  const out = [];
  if (mode === 'rect') {
    const xa = Math.min(x0, x1);
    const xb = Math.max(x0, x1);
    const ya = Math.min(y0, y1);
    const yb = Math.max(y0, y1);
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb && out.length < MAX_CELLS; x++) out.push([x, y]);
    return out;
  }
  if (mode === 'line') {
    if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
      const s = Math.sign(x1 - x0) || 1;
      for (let x = x0; out.length < MAX_CELLS; x += s) {
        out.push([x, y0]);
        if (x === x1) break;
      }
    } else {
      const s = Math.sign(y1 - y0) || 1;
      for (let y = y0; out.length < MAX_CELLS; y += s) {
        out.push([x0, y]);
        if (y === y1) break;
      }
    }
    return out;
  }
  return [[x1, y1]];
}

function selMode(sel) {
  if (!sel) return 'single';
  if (sel.kind === 'floor') return 'rect';
  return sel.def.placeMode === 'line' ? 'line' : 'single';
}

function costText(game, cost, totals) {
  const parts = [];
  let ok = true;
  for (const [id, n] of Object.entries(cost || {})) {
    const have = totals?.get(id) || 0;
    if (have < n) ok = false;
    parts.push(`${game.t(game.defs.items.get(id)?.nameKey || id)} ${n}`);
  }
  return { text: parts.join(', ') || '—', ok };
}

/** Действия (общие для ввода и тестов). */
export function makeActions(B) {
  const game = B.game;
  const U = () => B.ui;

  const setMode = (mode) => {
    const u = U();
    u.drag = null;
    if (mode !== 'place' && game.ui.isOpen('build')) {
      u.mode = mode;
      game.ui.closePanel('build');
    }
    u.mode = mode;
    if (mode !== 'place') u.sel = null;
  };

  /** Поставить чертежи по протяжке. @returns {number} сколько поставлено */
  const placeDrag = (x0, y0, x1, y1) => {
    const u = U();
    if (!u.sel) return 0;
    let n = 0;
    for (const [x, y] of dragCells(x0, y0, x1, y1, selMode(u.sel))) {
      const bp = u.sel.kind === 'floor' ? B.placeFloor(u.sel.id, x, y) : B.place(u.sel.id, x, y, { rot: u.rot, blueprint: true });
      if (bp) n++;
    }
    game.audio.play(n ? 'designate' : 'error');
    return n;
  };

  const ourZone = (z) => !!z && z.type === 'stockpile' && !!z.data?.build;

  /** Разметить склад (add) или стереть (remove). */
  const zoneRect = (x0, y0, x1, y1, remove) => {
    const u = U();
    const map = game.map;
    const cells = dragCells(x0, y0, x1, y1, 'rect').filter(([x, y]) => map.inBounds(x, y));
    if (remove) {
      const del = cells.filter(([x, y]) => ourZone(game.zones.zoneAt(x, y)));
      if (del.length) game.zones.removeCells(del);
      game.audio.play(del.length ? 'designate' : 'error');
      return del.length;
    }
    const start = game.zones.zoneAt(x0, y0);
    if (x0 === x1 && y0 === y1 && start && game.zones.isStorage(start)) {
      u.zoneSel = start.id; // клик по готовому складу — выбрать (для фильтра)
      game.audio.play('ui_click');
      return 0;
    }
    const add = cells.filter(([x, y]) => !game.zones.zoneAt(x, y) && map.cost[map.idx(x, y)] > 0);
    if (!add.length) {
      game.audio.play('error');
      return 0;
    }
    let z = ourZone(start) ? start : null;
    if (z) game.zones.addCells(z, add);
    else {
      const n = [...game.zones.zones.values()].filter(ourZone).length + 1;
      const f = STOCK_FILTERS.find((s) => s.id === u.zoneFilter)?.filter || null;
      z = game.zones.create('stockpile', add, { name: game.t('build.zone.n', { n }), priority: 2, filter: f ? structuredClone(f) : null, data: { build: true, filterId: u.zoneFilter } });
    }
    u.zoneSel = z.id;
    game.audio.play('designate');
    return add.length;
  };

  const setZoneFilter = (zone, filterId) => {
    const f = STOCK_FILTERS.find((s) => s.id === filterId);
    if (!zone || !f) return false;
    zone.filter = f.filter ? structuredClone(f.filter) : null;
    zone.data = { ...(zone.data || {}), filterId };
    U().zoneFilter = filterId;
    game.zones._changed?.(zone);
    return true;
  };

  /** X: отменить чертежи и пометить постройки к сносу (remove — снять пометки сноса). */
  const clearRect = (x0, y0, x1, y1, remove) => {
    const xa = Math.min(x0, x1);
    const xb = Math.max(x0, x1);
    const ya = Math.min(y0, y1);
    const yb = Math.max(y0, y1);
    if (remove) {
      const n = game.designations.removeRect(['deconstruct'], xa, ya, xb, yb);
      game.audio.play(n ? 'designate' : 'error');
      return n;
    }
    let n = 0;
    const seen = new Set();
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        if (!game.map.inBounds(x, y)) continue;
        const k = game.map.idx(x, y);
        B.ensure();
        for (const id of [B.rt.bp[k], B.rt.fbp[k]]) {
          if (!id || seen.has(id)) continue;
          seen.add(id);
          if (B.cancel(game.entities.get(id))) n++;
        }
        const b = game.map.buildingAt(x, y);
        if (b && !seen.has(b.id)) {
          seen.add(b.id);
          if (B.designateDeconstruct(b)) n++;
        }
      }
    game.audio.play(n ? 'designate' : 'error');
    return n;
  };

  const select = (item) => {
    const u = U();
    if (u.sel && item && u.sel.kind === item.kind && u.sel.id === item.id) u.sel = null;
    else u.sel = item || null;
    u.mode = 'place';
  };

  return { setMode, placeDrag, zoneRect, setZoneFilter, clearRect, select, ourZone };
}

export function installUI(B) {
  const game = B.game;
  B.ui = freshUi();
  const A = makeActions(B);
  B.actions = A;
  const t = (k, v) => game.t(k, v);

  // ---------- Меню (B) ----------
  game.ui.registerPanel(
    {
      id: 'build',
      title: 'build.panel.title',
      key: 'KeyB',
      width: 300,
      height: 470,
      anchor: 'left',
      onOpen() {
        const u = B.ui;
        u.mode = 'place';
        u.drag = null;
      },
      onClose() {
        const u = B.ui;
        if (u.mode === 'place') {
          u.mode = null;
          u.sel = null;
          u.drag = null;
        }
      },
      draw(ctx, g, ui, r) {
        const u = B.ui;
        const bw = (r.w - 6) / 2;
        MENU_TABS.forEach((tab, i) => {
          const x = r.x + (i % 2) * (bw + 6);
          const y = r.y + Math.floor(i / 2) * 30;
          if (ui.button(x, y, bw, 26, t(`build.tab.${tab}`), { active: u.tab === tab, size: 12 })) u.tab = tab;
        });
        const items = menuItems(g, u.tab);
        const totals = B.totals();
        const top = r.y + 66;
        const listH = r.h - 66 - 38;
        const clicked = ui.list(`build:${u.tab}`, r.x, top, r.w, listH, items, 40, (c, it, x, y, w, h) => {
          const active = u.sel && u.sel.kind === it.kind && u.sel.id === it.id;
          if (active) {
            c.fillStyle = 'rgba(94,242,255,0.14)';
            c.fillRect(x, y + 1, w, h - 2);
            c.strokeStyle = 'rgba(94,242,255,0.8)';
            c.lineWidth = 1;
            c.strokeRect(x + 0.5, y + 1.5, w - 1, h - 3);
          }
          const col = it.color || it.def.color || '#9aa8ff';
          c.fillStyle = rgba(col, 0.25);
          c.fillRect(x + 6, y + 8, 24, 24);
          c.strokeStyle = col;
          c.strokeRect(x + 6.5, y + 8.5, 23, 23);
          const name = t(it.def.nameKey);
          ui.text(it.kind === 'floor' ? `${name} (${t('build.floor')})` : name, x + 38, y + 5, { size: 13, bold: active });
          const cost = costText(g, it.def.materials, totals);
          ui.text(cost.text, x + 38, y + 22, { size: 11, color: cost.ok ? '#9aa3c0' : '#ff8a8a' });
        });
        if (clicked) A.select(clicked);
        ui.text(t('build.hint'), r.x, r.y + r.h - 30, { size: 11, color: '#9aa3c0' });
        ui.text(`[Z] ${t('build.key.zones')} · [X] ${t('build.key.clear')}`, r.x, r.y + r.h - 14, { size: 11, color: '#9aa3c0' });
      },
    },
    OWNER,
  );

  // ---------- Ввод (кадровая система до лидера) ----------
  game.frameSystems.add(
    {
      id: 'build:input',
      order: 15,
      update(g) {
        const u = B.ui;
        const input = g.input;
        if (!g.map) return;
        if (input.lostFocus) u.drag = null;
        if (g.ui.modalOpen) {
          u.drag = null;
          return;
        }
        if (input.pressed('build:zones')) A.setMode(u.mode === 'zone' ? null : 'zone');
        if (input.pressed('build:clear')) A.setMode(u.mode === 'clear' ? null : 'clear');
        if (u.mode === 'place' && !g.ui.isOpen('build')) {
          u.mode = null;
          u.sel = null;
        }
        const active = u.mode === 'zone' || u.mode === 'clear' || (u.mode === 'place' && !!u.sel);
        if (!active) {
          u.drag = null;
          return;
        }
        if (u.mode === 'place' && input.pressed('build:rotate')) {
          u.rot = (u.rot + 1) & 3;
          g.audio.play('ui_click');
        }
        if (input.pressed('ui:back')) {
          input.consume('ui:back');
          if (u.mode === 'place') u.sel = null;
          else A.setMode(null);
          u.drag = null;
          return;
        }
        input.consume('player:attack'); // ЛКМ в режиме стройки — не удар посохом
        const m = input.mouse;
        const over = g.ui.wantsMouse;
        if (!u.drag && !over && m.inside) {
          if (input.keyPressed('Mouse0')) u.drag = { x0: m.tx, y0: m.ty, btn: 0 };
          else if (input.keyPressed('Mouse2')) {
            if (u.mode === 'place') {
              const bp = B.blueprintAt(m.tx, m.ty, true);
              if (bp) B.cancel(bp);
              else u.sel = null;
              g.audio.play('ui_close');
            } else u.drag = { x0: m.tx, y0: m.ty, btn: 2 };
          }
        }
        if (u.drag && !input.keyDown(`Mouse${u.drag.btn}`)) {
          const d = u.drag;
          u.drag = null;
          if (u.mode === 'place') A.placeDrag(d.x0, d.y0, m.tx, m.ty);
          else if (u.mode === 'zone') A.zoneRect(d.x0, d.y0, m.tx, m.ty, d.btn === 2);
          else if (u.mode === 'clear') A.clearRect(d.x0, d.y0, m.tx, m.ty, d.btn === 2);
        }
      },
    },
    OWNER,
  );

  // ---------- Чертежи и вспышки «готово» ----------
  game.render.registerLayer(
    {
      id: 'build:blueprints',
      order: 52,
      draw(ctx, g, view) {
        if (!B.ensure()) return;
        for (const bp of g.entities.ofKind('blueprint')) {
          if (bp.x + (bp.w || 1) < view.x0 - 1 || bp.x > view.x1 + 1 || bp.y + (bp.h || 1) < view.y0 - 1 || bp.y > view.y1 + 1) continue;
          drawBlueprint(ctx, g, B, bp);
        }
        const pops = B.rt.pops;
        for (let i = pops.length - 1; i >= 0; i--) {
          const p = pops[i];
          if (p.t0 < 0) p.t0 = view.time;
          const k = (view.time - p.t0) / 0.5;
          if (k >= 1 || k < 0) {
            pops.splice(i, 1);
            continue;
          }
          const grow = 2 + k * 6;
          ctx.strokeStyle = rgba(p.color, 0.9 * (1 - k));
          ctx.lineWidth = 2;
          ctx.strokeRect(p.x * T - grow, p.y * T - grow, p.w * T + grow * 2, p.h * T + grow * 2);
        }
      },
    },
    OWNER,
  );

  // ---------- Призрак и рамки инструментов ----------
  game.render.registerLayer(
    {
      id: 'build:ghost',
      order: 98,
      draw(ctx, g, view) {
        const u = B.ui;
        const m = g.input.mouse;
        if (!u.mode || !m.inside || g.ui.wantsMouse) return;
        if (u.mode === 'place' && u.sel) drawGhost(ctx, g, B, u, m);
        else if (u.mode === 'zone' || u.mode === 'clear') {
          const d = u.drag;
          const x0 = d ? Math.min(d.x0, m.tx) : m.tx;
          const y0 = d ? Math.min(d.y0, m.ty) : m.ty;
          const x1 = d ? Math.max(d.x0, m.tx) : m.tx;
          const y1 = d ? Math.max(d.y0, m.ty) : m.ty;
          const c = d?.btn === 2 || u.mode === 'clear' ? BAD_COLOR : '#ffd27a';
          ctx.fillStyle = rgba(c, 0.16);
          ctx.fillRect(x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T);
          ctx.strokeStyle = rgba(c, 0.9);
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.strokeRect(x0 * T + 0.5, y0 * T + 0.5, (x1 - x0 + 1) * T - 1, (y1 - y0 + 1) * T - 1);
          ctx.setLineDash([]);
          if (u.mode === 'zone' && u.zoneSel) {
            const z = g.zones.zones.get(u.zoneSel);
            if (z) {
              ctx.strokeStyle = 'rgba(255,224,138,0.8)';
              ctx.lineWidth = 1;
              for (const i of z.cells) ctx.strokeRect((i % g.map.w) * T + 2, Math.floor(i / g.map.w) * T + 2, T - 4, T - 4);
            }
          }
        }
      },
    },
    OWNER,
  );

  // ---------- Подсказка режима (низ экрана) + фильтр склада ----------
  game.ui.registerHud(
    {
      id: 'build:mode',
      slot: 'bottom-center',
      order: 5,
      height: () => {
        const u = B.ui;
        if (u.mode === 'zone') return 62;
        return u.mode === 'clear' || (u.mode === 'place' && u.sel) ? 28 : 0;
      },
      draw(ctx, g, ui, box) {
        const u = B.ui;
        let text = '';
        if (u.mode === 'zone') text = t('build.mode.zone');
        else if (u.mode === 'clear') text = t('build.mode.clear');
        else if (u.sel) {
          const sm = selMode(u.sel);
          text = t('build.mode.place', {
            name: t(u.sel.def.nameKey),
            drag: sm === 'line' ? t('build.mode.drag') : sm === 'rect' ? t('build.mode.dragRect') : '',
            rot: u.sel.def.rotatable ? t('build.mode.rot') : '',
          });
          if (u.reason) text += ` — ${t(`build.reason.${u.reason}`)}`;
        }
        const w = ui.measure(text, 13) + 28;
        const x = box.x - w / 2;
        ctx.fillStyle = 'rgba(6,8,18,0.86)';
        ctx.fillRect(x, box.y, w, 26);
        ui.block(x, box.y, w, 26);
        ui.text(text, box.x, box.y + 13, { align: 'center', baseline: 'middle', size: 13, color: u.reason && u.mode === 'place' ? '#ffb0b0' : '#e8ecff' });
        if (u.mode === 'zone') {
          const z = g.zones.zones.get(u.zoneSel);
          const cur = z ? z.data?.filterId || 'all' : u.zoneFilter;
          const label = t('build.filter.label');
          const lw = ui.measure(label, 12) + 8;
          const bw = 92;
          const total = lw + STOCK_FILTERS.length * (bw + 4);
          let bx = box.x - total / 2;
          const by = box.y + 32;
          ctx.fillStyle = 'rgba(6,8,18,0.86)';
          ctx.fillRect(bx - 6, by - 3, total + 12, 30);
          ui.block(bx - 6, by - 3, total + 12, 30);
          ui.text(label, bx, by + 12, { baseline: 'middle', size: 12 });
          bx += lw;
          for (const f of STOCK_FILTERS) {
            if (ui.button(bx, by, bw, 24, t(`build.filter.${f.id}`), { active: cur === f.id, size: 12 })) {
              if (z) A.setZoneFilter(z, f.id);
              else u.zoneFilter = f.id;
            }
            bx += bw + 4;
          }
        }
        return u.mode === 'zone' ? 62 : 28;
      },
    },
    OWNER,
  );

  // ---------- Подсказка к клетке ----------
  game.ui.registerTooltip(
    {
      id: 'build',
      order: 15,
      lines(g, hover) {
        const out = [];
        const bp = B.blueprintAt(hover.tx, hover.ty, true);
        if (bp) {
          out.push({ text: B.displayName(bp), bold: true, color: '#5ef2ff' });
          for (const [id, total] of Object.entries(bp.cost || {})) {
            const have = bp.delivered?.[id] || 0;
            out.push({ text: t('build.tt.need', { what: t(g.defs.items.get(id)?.nameKey || id), have, total }), color: have >= total ? '#9effc0' : '#ffd27a' });
          }
          out.push({ text: t('build.tt.work', { pct: Math.round(((bp.work || 0) / Math.max(1, bp.workTotal || 1)) * 100) }), color: '#9aa3c0' });
        }
        const b = g.map.buildingAt(hover.tx, hover.ty);
        const def = b && g.defs.buildings.get(b.defId);
        if (def && !def.natural && !b.train && b.faction === 'colony') {
          const max = B.maxHp(b, def);
          out.push({ text: t('build.tt.hp', { hp: Math.ceil(b.hp ?? max), max }), color: '#9aa3c0' });
          if (def.door) out.push({ text: t(b.open ? 'build.tt.door_open' : 'build.tt.door_closed'), color: '#9aa3c0' });
        }
        return out;
      },
    },
    OWNER,
  );
}

function drawBlueprint(ctx, g, B, bp) {
  const def = B.defOfBp(bp);
  const x = bp.x * T;
  const y = bp.y * T;
  const w = (bp.w || 1) * T;
  const h = (bp.h || 1) * T;
  ctx.save();
  if (bp.layer === 'floor') {
    ctx.fillStyle = 'rgba(94,242,255,0.10)';
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  } else if (def) {
    ctx.globalAlpha = 0.35;
    ghostDrawer(g, def)?.draw(ctx, { x: bp.x, y: bp.y, w: bp.w, h: bp.h, rot: bp.rot, defId: def.id }, g, { time: 0 }, def);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = 'rgba(94,242,255,0.85)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.setLineDash([]);
  // полоса: сначала материалы (жёлтая), потом работа (голубая)
  let need = 0;
  let have = 0;
  for (const [id, n] of Object.entries(bp.cost || {})) {
    need += n;
    have += Math.min(n, bp.delivered?.[id] || 0);
  }
  const mat = need ? have / need : 1;
  const work = (bp.work || 0) / Math.max(1, bp.workTotal || 1);
  const v = mat < 1 ? mat : work;
  if (v > 0 || mat < 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x + 3, y + h - 6, w - 6, 3);
    ctx.fillStyle = mat < 1 ? '#ffd27a' : '#5ef2ff';
    ctx.fillRect(x + 3, y + h - 6, (w - 6) * v, 3);
  }
  ctx.restore();
}

function drawGhost(ctx, g, B, u, m) {
  const sel = u.sel;
  const d = u.drag;
  const cells = d ? dragCells(d.x0, d.y0, m.tx, m.ty, selMode(sel)) : [[m.tx, m.ty]];
  let reason = '';
  for (const [x, y] of cells) {
    if (sel.kind === 'floor') {
      const chk = B.checkFloor(sel.id, x, y);
      if (!chk.ok) reason ||= chk.reason;
      const c = chk.ok ? OK_COLOR : BAD_COLOR;
      ctx.fillStyle = rgba(c, 0.22);
      ctx.fillRect(x * T + 1, y * T + 1, T - 2, T - 2);
      ctx.strokeStyle = rgba(c, 0.85);
      ctx.lineWidth = 1;
      ctx.strokeRect(x * T + 1.5, y * T + 1.5, T - 3, T - 3);
      continue;
    }
    const def = sel.def;
    const chk = B.check(sel.id, x, y, u.rot);
    if (!chk.ok) reason ||= chk.reason;
    const [w, h] = g.entities.footprintSize(def, chk.rot);
    const c = chk.ok ? OK_COLOR : BAD_COLOR;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ghostDrawer(g, def)?.draw(ctx, { x, y, w, h, rot: chk.rot, defId: def.id }, g, { time: 0 }, def);
    ctx.restore();
    ctx.fillStyle = rgba(c, 0.2);
    ctx.fillRect(x * T, y * T, w * T, h * T);
    ctx.strokeStyle = rgba(c, 0.95);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x * T + 0.75, y * T + 0.75, w * T - 1.5, h * T - 1.5);
  }
  u.reason = reason;
}
