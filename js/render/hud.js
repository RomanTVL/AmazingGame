// HUD ядра (минимальный; модуль ui заменит/дополнит): часы и скорость, лидер, подсказка E,
// список поселенцев, тосты уведомлений, подсказка управления, отладка (F9), подсказки к клеткам, курсор.
import { THEME, roundRect } from '../engine/ui.js';
import { Input } from '../engine/input.js';
import { drawGlow } from './glow.js';
import { rgba } from './color.js';

const pad = (n) => String(n).padStart(2, '0');

function pill(ui, ctx, x, y, w, h, accent = THEME.border) {
  ctx.fillStyle = THEME.panelBg;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.7);
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2);
  ctx.stroke();
  ui.block(x, y, w, h);
}

export function registerCoreHud(game) {
  const ui = game.ui;
  const t = (k, v) => game.t(k, v);

  // --- Часы, день, скорость ---
  ui.registerHud({
    id: 'core:clock',
    slot: 'top-center',
    order: 10,
    draw(ctx, game, ui, box) {
      const time = game.time;
      const w = 330;
      const h = 34;
      const x = box.x - w / 2;
      const y = box.y;
      pill(ui, ctx, x, y, w, h);
      // солнце/луна
      const d = time.daylight;
      const ix = x + 22;
      const iy = y + h / 2;
      if (d > 0.5) {
        drawGlow(ctx, ix, iy, 16, '#ffd27a', 0.8);
        ctx.fillStyle = '#ffe6a8';
        ctx.beginPath();
        ctx.arc(ix, iy, 5.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        drawGlow(ctx, ix, iy, 16, '#9fb8ff', 0.6);
        ctx.fillStyle = '#dfe8ff';
        ctx.beginPath();
        ctx.arc(ix, iy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = THEME.panelBg;
        ctx.beginPath();
        ctx.arc(ix + 3, iy - 2, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ui.text(t('hud.day', { day: time.day }), x + 40, y + 9, { size: 14, bold: true, color: THEME.text });
      ui.text(`${pad(time.hourInt)}:${pad(Math.floor(time.minute / 10) * 10)}`, x + 104, y + 9, { size: 14, color: THEME.accent, glow: 6, font: `600 14px ${THEME.mono}` });
      ui.text(t(`hud.seasons.${time.season}`), x + 156, y + 10, { size: 12, color: THEME.dim });
      // кнопки скорости
      const bx = x + w - 128;
      const labels = ['❚❚', '▶', '▶▶', '▶▶▶'];
      for (let i = 0; i < 4; i++) {
        const active = i === 0 ? game.paused : !game.paused && game.speed === i;
        if (ui.button(bx + i * 30, y + 5, 27, 24, labels[i], { active, size: i === 3 ? 9 : 11 })) {
          if (i === 0) game.togglePause();
          else game.setSpeed(i);
        }
      }
      if (game.paused) {
        ui.text(t('hud.paused'), box.x, y + h + 6, { align: 'center', size: 13, bold: true, color: THEME.warn, glow: 8 });
        return h + 22;
      }
      return h;
    },
  });

  // --- Список поселенцев (простой; ui-модуль сделает портреты) ---
  ui.registerHud({
    id: 'core:colonists',
    slot: 'top-left',
    order: 20,
    draw(ctx, game, ui, box) {
      const list = game.colonists();
      const leader = game.getLeader();
      list.sort((a, b) => (b === leader) - (a === leader) || a.id - b.id);
      const w = 230;
      const rowH = 22;
      const h = 10 + list.length * rowH;
      ui.panel(box.x, box.y, w, h, {});
      list.forEach((p, i) => {
        const y = box.y + 6 + i * rowH;
        drawGlow(ctx, box.x + 14, y + 9, 10, p.color, 0.8);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(box.x + 14, y + 9, 4, 0, Math.PI * 2);
        ctx.fill();
        const name = p.name;
        ui.text(name, box.x + 26, y + 2, { size: 12, bold: p === leader, color: p === leader ? '#ffffff' : THEME.text });
        const jt = p.job && game.defs.jobTypes.get(p.job.type);
        const status = p === leader ? t('hud.leader') : p.asleep ? t('tt.asleep') : jt ? game.t(jt.labelKey) : '';
        ui.text(status, box.x + w - 10, y + 3, { size: 10, align: 'right', color: p === leader ? THEME.accent : THEME.dim });
        // полоска сытости
        ui.bar(box.x + 26, y + 17, 80, 2, p.needs.food ?? 1, p.needs.food < 0.3 ? THEME.bad : 'rgba(125,255,106,0.6)');
        ui.bar(box.x + 110, y + 17, 60, 2, p.needs.rest ?? 1, 'rgba(159,184,255,0.6)');
        if (ui.clicked(box.x, y, w, rowH)) game.camera.followId = p === leader ? 0 : p.id;
      });
      return h;
    },
  });

  // --- Отладка (F9) ---
  ui.registerHud({
    id: 'core:debug',
    slot: 'top-left',
    order: 5,
    visible: (g) => !!g.settings.get('showDebug'),
    draw(ctx, game, ui, box) {
      const perf = game.perf || {};
      const map = game.map;
      const m = game.input.mouse;
      const sysMs = game.systems.list.reduce((s, x) => s + x.ms, 0);
      const lines = [
        `FPS ${perf.fps?.toFixed(0) ?? '—'}  кадр ${perf.frameMs?.toFixed(1) ?? '—'} мс  сим ${sysMs.toFixed(2)} мс/тик`,
        `сущности ${game.entities.count}  пешки ${game.entities.countKind('pawn')}  предметы ${game.entities.countKind('item')}`,
        `растения ${game.entities.countKind('plant')}  постройки ${game.entities.countKind('building')}  частицы ${game.fx.n}`,
        `работ: сделано ${game.stats.jobsDone}, сорвано ${game.stats.jobsFailed}  пометок ${game.designations.count()}`,
        `A*: ${game.pathfinder.stats.searches} поисков, кэш ${game.pathfinder.stats.cacheHits}  регионов ${game.pathfinder.regionCount ?? '—'}`,
        `тик ${game.time.tick}  скорость ${game.paused ? 'пауза' : game.speed + 'x'}  зум ${game.camera.zoom.toFixed(2)}`,
        `мышь ${m.tx},${m.ty}${map?.inBounds(m.tx, m.ty) ? ` cost ${map.cost[map.idx(m.tx, m.ty)].toFixed(2)} room ${map.room[map.idx(m.tx, m.ty)]}` : ''}`,
        `ошибки ${game.errors.length}  модули: ${game.modules.join(', ')}`,
      ];
      const w = 440;
      const h = 12 + lines.length * 15;
      ui.panel(box.x, box.y, w, h, { accent: THEME.accent2 });
      lines.forEach((l, i) => ui.text(l, box.x + 10, box.y + 7 + i * 15, { size: 11, font: `11px ${THEME.mono}`, color: i === 7 && game.errors.length ? THEME.bad : THEME.text }));
      return h;
    },
  });

  // --- Лидер ---
  ui.registerHud({
    id: 'core:leader',
    slot: 'bottom-left',
    order: 10,
    height: (g) => (g.getLeader() ? 66 : 0),
    draw(ctx, game, ui, box) {
      const p = game.getLeader();
      if (!p) return 0;
      const w = 260;
      const h = 66;
      ui.panel(box.x, box.y, w, h, { accent: p.color });
      drawGlow(ctx, box.x + 24, box.y + 22, 18, '#ffffff', 0.6);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(box.x + 24, box.y + 22, 6, 0, Math.PI * 2);
      ctx.fill();
      ui.text(p.name, box.x + 40, box.y + 9, { size: 14, bold: true, color: '#ffffff', glow: 6, glowColor: p.color });
      ui.text(p.mage ? `${t('hud.leader')} · маг-проводник` : t('hud.leader'), box.x + 40, box.y + 27, { size: 11, color: THEME.dim });
      const hs = game.api.health.getSummary(p);
      ui.text('❤', box.x + 12, box.y + 44, { size: 11, color: THEME.bad });
      ui.bar(box.x + 26, box.y + 49, 60, 4, hs.ratio, THEME.bad);
      ui.text('◐', box.x + 94, box.y + 44, { size: 11, color: THEME.good });
      ui.bar(box.x + 108, box.y + 49, 60, 4, p.needs.food ?? 1, THEME.good);
      ui.text('☾', box.x + 176, box.y + 44, { size: 11, color: '#9fb8ff' });
      ui.bar(box.x + 190, box.y + 49, 58, 4, p.needs.rest ?? 1, '#9fb8ff');
      return h;
    },
  });

  // --- Подсказка действия ---
  ui.registerHud({
    id: 'core:hint',
    slot: 'bottom-center',
    order: 10,
    height: (g) => {
      const l = g.getLeader();
      const need = l && !l.job && ((l.needs.food ?? 1) < 0.25 || (l.needs.rest ?? 1) < 0.2);
      return g.player?.hint || g.player?.toolActive || l?.carry || need ? 34 : 0;
    },
    draw(ctx, game, ui, box) {
      const pc = game.player;
      let text = '';
      if (pc.toolActive) text = t('hint.designate');
      else if (pc.hint) text = `${ui.keyHint('player:interact')}  ${pc.hint.label}`;
      const leader = game.getLeader();
      const carry = leader?.carry;
      if (!text && carry) text = t('hud.carrying', { name: t(game.defs.items.get(carry.defId)?.nameKey), count: carry.count });
      if (!text && leader && !leader.job && (leader.needs.food ?? 1) < 0.25) text = t('hud.hungry');
      else if (!text && leader && !leader.job && (leader.needs.rest ?? 1) < 0.2) text = t('hud.tired');
      if (!text) return 0;
      ctx.font = ui.font(14, '600');
      const w = ctx.measureText(text).width + 36;
      pill(ui, ctx, box.x - w / 2, box.y, w, 30, THEME.accent);
      ui.text(text, box.x, box.y + 15, { align: 'center', baseline: 'middle', size: 14, bold: true, color: '#ffffff', glow: 6, glowColor: THEME.accent });
      return 30;
    },
  });

  // --- Подсказка управления ---
  ui.registerHud({
    id: 'core:controls',
    slot: 'bottom-right',
    order: 10,
    height: 18,
    draw(ctx, game, ui, box) {
      ui.text(t('hud.controls'), box.x, box.y + 2, { align: 'right', size: 11, color: rgba('#8c93b8', 0.85) });
      return 18;
    },
  });

  // --- Тосты уведомлений ---
  ui.registerHud({
    id: 'core:toasts',
    slot: 'top-right',
    order: 10,
    draw(ctx, game, ui, box) {
      const now = game.time.tick;
      const realNow = typeof performance !== 'undefined' ? performance.now() : 0;
      const recent = game.log.filter((e) => (e._shownAt ??= realNow) && realNow - e._shownAt < 9000).slice(-5);
      let y = box.y;
      for (const e of recent) {
        const age = (realNow - e._shownAt) / 9000;
        const a = age > 0.85 ? (1 - age) / 0.15 : 1;
        const color = e.type === 'danger' ? THEME.bad : e.type === 'bad' ? THEME.warn : e.type === 'good' ? THEME.good : THEME.accent;
        ctx.globalAlpha = a;
        const maxW = 380;
        ctx.font = ui.font(12);
        const words = e.text.split(' ');
        const lines = [];
        let cur = '';
        for (const wd of words) {
          const test = cur ? `${cur} ${wd}` : wd;
          if (ctx.measureText(test).width > maxW - 24 && cur) {
            lines.push(cur);
            cur = wd;
          } else cur = test;
        }
        if (cur) lines.push(cur);
        const h = 12 + lines.length * 16;
        ui.panel(box.x - maxW, y, maxW, h, { accent: color });
        lines.forEach((l, i) => ui.text(l, box.x - maxW + 12, y + 7 + i * 16, { size: 12 }));
        ctx.globalAlpha = 1;
        y += h + 6;
      }
      void now;
      return y - box.y;
    },
  });

  // --- Подсказки к наведённой клетке ---
  ui.registerTooltip({
    id: 'core:things',
    order: 10,
    lines(game, hover) {
      const out = [];
      const ents = hover.entities.slice().sort((a, b) => (a.kind === 'pawn' ? -1 : 0) - (b.kind === 'pawn' ? -1 : 0));
      for (const e of ents) {
        if (e.kind === 'pawn') {
          if (game.vision.enabled && !game.vision.isVisible(Math.floor(e.x), Math.floor(e.y))) continue;
          out.push({ text: e.name, bold: true, color: e.color, size: 13 });
          if (e.isLeader) out.push({ text: t('tt.leader'), color: THEME.accent });
          const jt = e.job && game.defs.jobTypes.get(e.job.type);
          if (e.asleep) out.push(t('tt.asleep'));
          else if (jt) out.push(t('tt.job', { job: t(jt.labelKey) }));
          if (e.carry) out.push(t('tt.carrying', { name: t(game.defs.items.get(e.carry.defId)?.nameKey), count: e.carry.count }));
          if (e.faction === 'colony') {
            out.push({ text: `${t('needs.food')} ${Math.round((e.needs.food ?? 1) * 100)}%  ·  ${t('needs.rest')} ${Math.round((e.needs.rest ?? 1) * 100)}%`, color: THEME.dim });
          }
          out.push({ text: game.api.health.getSummary(e).label, color: THEME.dim });
          continue;
        }
        const def = game.entities.defOf(e);
        if (e.kind === 'item') {
          out.push({ text: t('tt.count', { name: t(def?.nameKey), count: e.count }), bold: true });
          if (game.items.isStored(e)) out.push({ text: t('tt.stored'), color: THEME.dim });
        } else if (e.kind === 'plant' || e.kind === 'building') {
          if (!def) continue;
          if (def.id === 'wagon_wall' && e.gangway) continue;
          out.push({ text: t(def.nameKey), bold: true });
          if (def.harvestYield) out.push({ text: (e.growth ?? 1) >= 1 ? t('tt.ripe') : t('tt.growth', { pct: Math.round((e.growth ?? 0) * 100) }), color: THEME.dim });
          for (const d of game.designations.forTarget(e.id)) out.push({ text: t('tt.designated', { what: t(game.defs.designations.get(d.type)?.nameKey) }), color: game.defs.designations.get(d.type)?.color });
        } else if (e.kind === 'corpse') {
          out.push({ text: t('tt.corpse', { name: e.name }), bold: true, color: THEME.bad });
        }
      }
      return out;
    },
  });
  ui.registerTooltip({
    id: 'core:tile',
    order: 100,
    lines(game, hover) {
      const map = game.map;
      const td = map.terrainDef(hover.tx, hover.ty);
      const fd = map.floorDef(hover.tx, hover.ty);
      const car = game.train?.carAt(hover.tx, hover.ty);
      const parts = [];
      if (car) parts.push(t(game.train.carDef(car).nameKey));
      parts.push(fd ? t(fd.nameKey) : t(td.nameKey));
      const z = game.zones.zoneAt(hover.tx, hover.ty);
      if (z) parts.push(t(game.defs.zoneTypes.get(z.type)?.nameKey));
      return [{ text: parts.join(' · '), color: THEME.dim, size: 11 }];
    },
  });
}

/** Курсор (системный скрыт CSS). */
export function cursorLayer() {
  return {
    id: 'cursor',
    order: 900,
    space: 'screen',
    draw(ctx, game, view) {
      const m = game.input.mouse;
      if (!m.inside) return;
      const pc = game.player;
      const tool = pc?.toolActive;
      const c = tool ? '#ff9f43' : '#5ef2ff';
      drawGlow(ctx, m.sx, m.sy, 14, c, 0.5);
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(m.sx, m.sy, 6, 0, Math.PI * 2);
      ctx.moveTo(m.sx - 11, m.sy);
      ctx.lineTo(m.sx - 8, m.sy);
      ctx.moveTo(m.sx + 8, m.sy);
      ctx.lineTo(m.sx + 11, m.sy);
      ctx.moveTo(m.sx, m.sy - 11);
      ctx.lineTo(m.sx, m.sy - 8);
      ctx.moveTo(m.sx, m.sy + 8);
      ctx.lineTo(m.sx, m.sy + 11);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(m.sx - 1, m.sy - 1, 2, 2);
      if (tool) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillStyle = c;
        ctx.fillText(Input.keyLabel(game.input.keyOf('player:designate')), m.sx + 12, m.sy + 16);
      }
      void view;
    },
  };
}
