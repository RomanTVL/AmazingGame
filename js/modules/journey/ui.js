// journey — интерфейс: HUD (станция, таймер Гнили, ход перегона), карта маршрута (F4), окна беженца и победы,
// слой «в пути» (земля с прокруткой вокруг поезда). Всё рисование — только в draw (в headless не вызывается).
import { TILE } from '../../core/constants.js';
import { hash01 } from '../../core/math.js';
import { stationInfo, targetOption, optionName } from './state.js';
import { optionOf, TYPE_COLOR, STEP_BIOME, STEPS } from './route.js';
import { rotHoursLeft } from './rot.js';
import { choose, isMoving } from './travel.js';
import { answerDialog } from './teller.js';
import { leaderNeedsLine } from './leader.js';

const OWNER = 'journey';

const GROUND = {
  forest: { base: '#0b1a14', speck: '#16352a', tuft: '#2fae6e', tree: '#0f3a26', tree2: '#1f6a44', rock: '#1d2238' },
  ash: { base: '#1a120d', speck: '#3a281e', tuft: '#8a7a3a', tree: '#3a281e', tree2: '#6a4a34', rock: '#2a2026' },
};

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function registerUI(J) {
  const game = J.game;
  const t = (k, v) => game.t(k, v);

  // ---------------- слой «в пути» ----------------
  game.render.registerLayer({
    id: 'journey:travel',
    order: 5,
    space: 'world',
    draw(ctx, g, view) {
      if (g.map?.biome !== 'travel' || !g.train?.stamped) return;
      const S = J.S;
      const tr = g.train;
      const mv = isMoving(J) && !g.paused;
      J.R.speedVis += ((mv ? 1 : 0) - J.R.speedVis) * Math.min(1, view.dt * 0.8);
      J.R.scroll += J.R.speedVis * 16 * view.dt * (g.speed || 1);
      if (J.R.scroll > 1e6) J.R.scroll -= 1e6;
      const biome = targetOption(J)?.biome || STEP_BIOME[S.leg?.to] || 'forest';
      const P = GROUND[biome] || GROUND.forest;
      const half = view.w / 2 / view.scale;
      const halfH = view.h / 2 / view.scale;
      const x0 = Math.floor(view.camX - half) - 2;
      const x1 = Math.ceil(view.camX + half) + 2;
      const y0 = Math.floor(view.camY - halfH) - 2;
      const y1 = Math.ceil(view.camY + halfH) + 2;
      const top = tr.railY - 3;
      const bx = tr.x0;
      const bw = tr.length;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 * TILE, y0 * TILE, (x1 - x0) * TILE, (y1 - y0) * TILE);
      ctx.rect(bx * TILE, top * TILE, bw * TILE, 7 * TILE);
      ctx.clip('evenodd');
      ctx.fillStyle = P.base;
      ctx.fillRect(x0 * TILE, y0 * TILE, (x1 - x0) * TILE, (y1 - y0) * TILE);
      const sc = J.R.scroll;
      const c0 = Math.floor(x0 + sc);
      const c1 = Math.ceil(x1 + sc);
      // рельсы и шпалы (вне поезда)
      const ry = tr.railY * TILE;
      ctx.fillStyle = '#2a2430';
      for (let c = c0; c <= c1; c++) ctx.fillRect((c - sc) * TILE + 6, ry + 4, 8, TILE - 8);
      ctx.fillStyle = '#8fa0ff';
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x0 * TILE, ry + 9, (x1 - x0) * TILE, 2);
      ctx.fillRect(x0 * TILE, ry + TILE - 11, (x1 - x0) * TILE, 2);
      ctx.globalAlpha = 1;
      // мелочь: крапины, трава, камни
      for (let c = c0; c <= c1; c++) {
        const sx = (c - sc) * TILE;
        for (let y = y0; y <= y1; y++) {
          if (y === tr.railY) continue;
          const h = hash01(c, y, 11);
          const sy = y * TILE;
          if (h < 0.18) {
            ctx.fillStyle = P.speck;
            ctx.fillRect(sx + hash01(c, y, 3) * 24, sy + hash01(c, y, 5) * 24, 4, 4);
          } else if (h < 0.24) {
            ctx.fillStyle = P.tuft;
            ctx.globalAlpha = 0.6;
            ctx.fillRect(sx + 10, sy + 12, 2, 8);
            ctx.fillRect(sx + 14, sy + 10, 2, 10);
            ctx.fillRect(sx + 18, sy + 13, 2, 7);
            ctx.globalAlpha = 1;
          } else if (h < 0.26) {
            ctx.fillStyle = P.rock;
            ctx.beginPath();
            ctx.ellipse(sx + 16, sy + 18, 9, 6, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      // деревья дальше от путей (крупнее, «быстрее» не делаем — один план)
      for (let c = c0 - 2; c <= c1 + 2; c++) {
        const sx = (c - sc) * TILE;
        for (let y = y0; y <= y1; y++) {
          const dr = Math.abs(y - tr.railY);
          if (dr < 7) continue;
          const h = hash01(c, y, 29);
          if (h > (biome === 'ash' ? 0.035 : 0.09)) continue;
          const r = 14 + hash01(c, y, 31) * 14;
          ctx.fillStyle = P.tree;
          ctx.beginPath();
          ctx.arc(sx + 16, y * TILE + 16, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = P.tree2;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.arc(sx + 12, y * TILE + 12, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      // полосы скорости
      if (J.R.speedVis > 0.3) {
        ctx.strokeStyle = 'rgba(200,220,255,0.08)';
        ctx.lineWidth = 2;
        for (let k = 0; k < 10; k++) {
          const yy = (top - 2 - k * 1.7) * TILE + hash01(k, 1, 7) * 20;
          const yy2 = (top + 9 + k * 1.7) * TILE + hash01(k, 2, 7) * 20;
          const len = 60 + hash01(k, 3, 7) * 140;
          const xx = ((x1 - x0) * TILE) * (1 - (((sc * 0.7 + k * 13.7) % 20) / 20)) + x0 * TILE;
          ctx.beginPath();
          ctx.moveTo(xx, yy);
          ctx.lineTo(xx + len, yy);
          ctx.moveTo(xx - 90, yy2);
          ctx.lineTo(xx - 90 + len, yy2);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  }, OWNER);

  // ---------------- HUD ----------------
  game.ui.registerHud({
    id: 'journey:status',
    slot: 'top-center',
    order: 20,
    visible: (g) => !!g.map && !!J.S.route,
    draw(ctx, g, ui, box) {
      const S = J.S;
      const T = ui.theme;
      const w = 360;
      const h = 48;
      const x = box.x - w / 2;
      const y = box.y + 4;
      ui.panel(x, y, w, h, { accent: S.phase === 'travel' ? '#5ef2ff' : '#ff4fd8' });
      let line1 = '';
      let line2 = '';
      let col2 = T.dim;
      if (S.phase === 'travel' && S.leg) {
        const tgt = targetOption(J);
        line1 = t('journey.hud.travel', { n: S.leg.to, name: tgt ? optionName(J, tgt) : t('journey.hud.fork') });
        const k = S.leg.t / Math.max(1, S.leg.len);
        ui.bar(x + 12, y + 30, w - 24, 5, k, '#5ef2ff');
        if (S.leg.halt === 'ambush') {
          line2 = t('journey.hud.ambush');
          col2 = T.bad;
        } else if (S.leg.halt === 'regroup') line2 = t('journey.hud.regroup');
      } else if (S.phase === 'ended') {
        line1 = t('journey.hud.victory');
        line2 = '';
      } else {
        const st = stationInfo(J);
        line1 = S.phase === 'wild' ? st.name : `${t('journey.hud.station', { n: S.step })}: ${st.name}`;
        const left = rotHoursLeft(J);
        if (left > 0) {
          line2 = t('journey.hud.rotIn', { h: Math.ceil(left) });
          col2 = left < 6 ? T.warn : T.dim;
        } else {
          line2 = t('journey.hud.rotHere', { level: S.rot.level });
          col2 = T.bad;
        }
        if (S.step >= STEPS && S.phase === 'station') {
          const bl = (S.boss.at - g.time.tick) / 600;
          line2 = !S.boss.spawned && bl > 0 ? t('journey.hud.bossIn', { h: Math.ceil(bl) }) : t('journey.hud.boss');
          col2 = T.bad;
        }
      }
      ui.text(line1, x + 12, y + 8, { size: 13, bold: true, color: T.text });
      if (line2) ui.text(line2, x + w - 12, y + (S.phase === 'travel' ? 8 : 28), { size: 12, color: col2, align: 'right' });
      if (S.phase !== 'travel') ui.text(t('journey.hud.keys'), x + 12, y + 29, { size: 11, color: T.dim });
      return h + 6;
    },
  }, OWNER);

  // ---------------- голод/усталость лидера ----------------
  game.ui.registerHud({
    id: 'journey:leaderNeeds',
    slot: 'bottom-left',
    order: 5,
    height: (g) => (leaderNeedsLine(g) ? 30 : 0),
    draw(ctx, g, ui, box) {
      const l = leaderNeedsLine(g);
      if (!l) return 0;
      const txt = t(l.key);
      const w = Math.max(260, ui.measure(txt, 13, true) + 24);
      ui.panel(box.x, box.y, w, 26, { accent: l.bad ? ui.theme.bad : ui.theme.warn });
      ui.text(txt, box.x + 12, box.y + 6, { size: 13, bold: true, color: l.bad ? ui.theme.bad : ui.theme.warn });
      return 30;
    },
  }, OWNER);

  // ---------------- Карта маршрута F4 ----------------
  game.ui.registerPanel({
    id: 'route',
    key: 'F4',
    title: 'journey.route.title',
    width: 820,
    height: 400,
    anchor: 'center',
    draw(ctx, g, ui, r) {
      const S = J.S;
      const T = ui.theme;
      if (!S.route) return;
      const cols = STEPS + 1;
      const cw = (r.w - 16) / cols;
      const cardW = cw - 18;
      const cardH = 122;
      const next = S.phase === 'travel' || S.phase === 'wild' ? S.leg?.to : S.phase === 'station' ? S.step + 1 : 0;
      const cardPos = (step, i) => ({ x: r.x + step * cw + 8, y: step === 0 ? r.y + 92 : r.y + 18 + i * (cardH + 22) });
      // связи
      ctx.lineWidth = 2;
      for (let step = 1; step <= STEPS; step++) {
        const prev = step === 1 ? [0] : [S.choice[step - 2] ?? -1];
        for (let i = 0; i < 2; i++) {
          for (const p of prev) {
            const a = cardPos(step - 1, step === 1 ? 0 : Math.max(0, p));
            const b = cardPos(step, i);
            const active = (step === 1 || p >= 0) && step <= S.step + 1;
            ctx.strokeStyle = active ? 'rgba(94,242,255,0.45)' : 'rgba(140,147,184,0.18)';
            ctx.beginPath();
            ctx.moveTo(a.x + cardW, a.y + cardH / 2);
            ctx.lineTo(b.x, b.y + cardH / 2);
            ctx.stroke();
          }
        }
      }
      // старт
      {
        const p = cardPos(0, 0);
        card(ui, ctx, p.x, p.y, cardW, cardH, { title: t('journey.st.start'), sub: t('journey.type.start'), color: '#ffd9a0', current: S.step === 0 && S.phase === 'station', done: S.step > 0 });
      }
      for (let step = 1; step <= STEPS; step++) {
        for (let i = 0; i < 2; i++) {
          const o = optionOf(S.route, step, i);
          if (!o) continue;
          const p = cardPos(step, i);
          const chosen = S.choice[step - 1] === i;
          const selectable = step === next && S.phase !== 'ended' && !(S.phase === 'travel' && S.leg && S.leg.t >= S.leg.len);
          const current = S.step === step && chosen && S.phase === 'station';
          const done = step < S.step || (step === S.step && chosen);
          card(ui, ctx, p.x, p.y, cardW, cardH, {
            title: optionName(J, o), sub: t(`journey.type.${o.type}`), desc: t(`journey.desc.${o.type}`), color: TYPE_COLOR[o.type],
            boss: o.boss ? t('journey.boss.name') : null, chosen, current, done, selectable, dim: step < next && !chosen,
          });
          if (selectable && ui.clicked(p.x, p.y, cardW, cardH)) {
            choose(J, step, i);
            g.audio?.play('ui_click');
          }
        }
        ui.text(t('journey.route.step', { n: step }), r.x + step * cw + 8 + cardW / 2, r.y + 2, { size: 11, color: T.dim, align: 'center' });
      }
      // подпись снизу
      let foot = '';
      if (S.phase === 'ended') foot = t('journey.hud.victory');
      else if (next && (S.choice[next - 1] === null || S.choice[next - 1] === undefined)) foot = t('journey.route.pick', { n: next });
      else if (next) foot = t('journey.route.picked', { name: optionName(J, optionOf(S.route, next, S.choice[next - 1])) });
      else foot = t('journey.route.final');
      ui.text(foot, r.x + 8, r.y + r.h - 18, { size: 13, color: T.accent });
    },
  }, OWNER);

  function card(ui, ctx, x, y, w, h, o) {
    const T = ui.theme;
    ui.block(x, y, w, h);
    const hover = o.selectable && ui.mouseIn(x, y, w, h);
    ctx.fillStyle = o.current ? 'rgba(94,242,255,0.16)' : hover ? 'rgba(108,92,255,0.25)' : 'rgba(16,20,40,0.9)';
    drawRoundRect(ctx, x, y, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = o.chosen || o.current ? o.color : o.selectable ? 'rgba(168,156,255,0.8)' : 'rgba(108,92,255,0.35)';
    ctx.lineWidth = o.chosen || o.current ? 2.5 : 1;
    drawRoundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 7);
    ctx.stroke();
    ctx.globalAlpha = o.dim ? 0.45 : 1;
    ui.text(o.sub, x + 8, y + 7, { size: 11, bold: true, color: o.color });
    ui.text(clip(ui, o.title, w - 16, 13), x + 8, y + 24, { size: 13, bold: true, color: T.text });
    if (o.desc) wrap(ui, o.desc, x + 8, y + 46, w - 16, 11, 14, 3, T.dim);
    if (o.boss) ui.text(`☠ ${o.boss}`, x + 8, y + h - 18, { size: 11, bold: true, color: T.bad });
    else if (o.current) ui.text(J.game.t('journey.route.here'), x + 8, y + h - 18, { size: 11, bold: true, color: T.accent });
    else if (o.chosen && !o.done) ui.text(J.game.t('journey.route.next'), x + 8, y + h - 18, { size: 11, color: T.accent });
    ctx.globalAlpha = 1;
  }

  function clip(ui, s, w, size) {
    if (ui.measure(s, size, true) <= w) return s;
    let out = s;
    while (out.length > 1 && ui.measure(`${out}…`, size, true) > w) out = out.slice(0, -1);
    return `${out}…`;
  }

  function wrap(ui, text, x, y, w, size, lh, maxLines, color) {
    const words = String(text).split(/\s+/);
    let line = '';
    let n = 0;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ui.measure(test, size) > w && line) {
        ui.text(line, x, y + n * lh, { size, color });
        n++;
        line = word;
        if (n >= maxLines) return;
      } else line = test;
    }
    if (line && n < maxLines) ui.text(line, x, y + n * lh, { size, color });
  }

  // ---------------- беженец ----------------
  game.ui.registerPanel({
    id: 'journey_dialog',
    title: 'journey.dialog.title',
    width: 440,
    height: 220,
    anchor: 'right',
    draw(ctx, g, ui, r) {
      const d = J.S.dialogs[0];
      if (!d) {
        g.ui.closePanel('journey_dialog');
        return;
      }
      ui.text(t('journey.dialog.refugee', { name: d.spec?.name || '?' }), r.x, r.y + 4, { size: 14, bold: true });
      wrap(ui, t('journey.dialog.refugeeText'), r.x, r.y + 30, r.w, 12, 16, 4, ui.theme.dim);
      const left = Math.max(0, Math.ceil((d.expires - g.time.tick) / 600));
      ui.text(t('journey.dialog.left', { h: left }), r.x, r.y + r.h - 58, { size: 11, color: ui.theme.warn });
      const bw = (r.w - 12) / 2;
      if (ui.button(r.x, r.y + r.h - 34, bw, 32, t('journey.dialog.yes'))) answerDialog(J, d.id, true);
      if (ui.button(r.x + bw + 12, r.y + r.h - 34, bw, 32, t('journey.dialog.no'))) answerDialog(J, d.id, false);
    },
  }, OWNER);

  // ---------------- победа ----------------
  game.ui.registerPanel({
    id: 'journey_victory',
    title: 'journey.victory.title',
    width: 480,
    height: 290,
    anchor: 'center',
    modal: true,
    draw(ctx, g, ui, r) {
      const v = J.S.victory || {};
      ui.text(t('journey.victory.text'), r.x, r.y + 4, { size: 15, bold: true, color: ui.theme.good, glow: 8 });
      const rows = [
        t('journey.victory.days', { n: v.day ?? g.time.day }),
        t('journey.victory.survivors', { n: v.survivors ?? g.colonists().length }),
        t('journey.victory.raids', { n: (J.S.stats.raids || 0) + (J.S.stats.ambushes || 0) + (J.S.stats.rotWaves || 0) }),
        t('journey.victory.left', { n: v.leftBehind ?? 0 }),
      ];
      rows.forEach((s, i) => ui.text(s, r.x + 4, r.y + 40 + i * 22, { size: 13 }));
      if (ui.button(r.x, r.y + r.h - 34, r.w, 32, t('journey.victory.ok'))) g.ui.closePanel('journey_victory');
    },
  }, OWNER);

  // открыть окна по флагам симуляции (только браузер)
  game.frameSystems.add({
    id: 'journey:ui',
    order: 12,
    update(g) {
      const R = J.R;
      if (g.isHeadless) {
        R.openRoute = R.openDialog = R.showVictory = false;
        return;
      }
      if (R.openRoute) {
        R.openRoute = false;
        g.ui.openPanel('route');
      }
      if (R.openDialog) {
        R.openDialog = false;
        if (J.S.dialogs.length) g.ui.openPanel('journey_dialog');
      }
      if (R.showVictory) {
        R.showVictory = false;
        g.ui.openPanel('journey_victory');
      }
    },
  }, OWNER);
}
