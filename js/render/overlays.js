// Мировые оверлеи: блики воды, зоны, пометки, полосы работы, имена, рамка инструмента, подсветка цели E,
// декор поезда (нос локомотива, искры двигателя, подписи вагонов).
import { TILE, TILE_FLAG } from '../core/constants.js';
import { hash01 } from '../core/math.js';
import { drawGlow, glowSprite } from './glow.js';
import { rgba } from './color.js';
import { roundRect } from '../engine/ui.js';

export function waterFxLayer() {
  return {
    id: 'water-fx',
    order: 10,
    draw(ctx, game, view) {
      const map = game.map;
      const water = game.defs.terrain.get('water')?.index;
      const t = view.time;
      const spr = glowSprite('#7fe8ff', 8);
      ctx.globalCompositeOperation = 'lighter';
      for (let y = view.y0; y <= view.y1; y++)
        for (let x = view.x0; x <= view.x1; x++) {
          if (map.terrain[map.idx(x, y)] !== water) continue;
          const h = hash01(x, y, 77);
          const s = Math.sin(t * (0.8 + h) + h * 40);
          if (s < 0.75) continue;
          ctx.globalAlpha = (s - 0.75) * 2.2;
          const px = x * TILE + 4 + h * 24;
          const py = y * TILE + 6 + hash01(y, x, 5) * 20;
          ctx.drawImage(spr, px - 6, py - 3, 12, 6);
        }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

export function zonesLayer() {
  return {
    id: 'zones',
    order: 20,
    draw(ctx, game, view) {
      const map = game.map;
      const zm = game.zones;
      if (!zm.cellZone) return;
      for (const z of zm.zones.values()) {
        ctx.fillStyle = rgba(z.color || '#ffd27a', 0.05);
        ctx.strokeStyle = rgba(z.color || '#ffd27a', 0.3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const i of z.cells) {
          const x = i % map.w;
          const y = (i - x) / map.w;
          if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          const same = (dx, dy) => map.inBounds(x + dx, y + dy) && zm.cellZone[map.idx(x + dx, y + dy)] === z.id;
          const px = x * TILE;
          const py = y * TILE;
          if (!same(0, -1)) { ctx.moveTo(px, py + 1.5); ctx.lineTo(px + TILE, py + 1.5); }
          if (!same(0, 1)) { ctx.moveTo(px, py + TILE - 1.5); ctx.lineTo(px + TILE, py + TILE - 1.5); }
          if (!same(-1, 0)) { ctx.moveTo(px + 1.5, py); ctx.lineTo(px + 1.5, py + TILE); }
          if (!same(1, 0)) { ctx.moveTo(px + TILE - 1.5, py); ctx.lineTo(px + TILE - 1.5, py + TILE); }
        }
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    },
  };
}

function glyph(ctx, kind, x, y, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (kind === 'axe') {
    ctx.moveTo(x - 4, y + 5);
    ctx.lineTo(x + 3, y - 4);
    ctx.moveTo(x + 1, y - 6);
    ctx.quadraticCurveTo(x + 7, y - 5, x + 6, y + 0);
    ctx.lineTo(x + 2, y - 3);
  } else if (kind === 'pick') {
    ctx.moveTo(x - 4, y + 5);
    ctx.lineTo(x + 3, y - 3);
    ctx.moveTo(x - 3, y - 5);
    ctx.quadraticCurveTo(x + 3, y - 7, x + 7, y - 1);
  } else if (kind === 'hand') {
    ctx.arc(x, y + 1, 3.5, 0, Math.PI * 2);
    ctx.moveTo(x - 3, y - 2);
    ctx.lineTo(x - 3, y - 6);
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x, y - 7);
    ctx.moveTo(x + 3, y - 2);
    ctx.lineTo(x + 3, y - 6);
  } else {
    ctx.arc(x, y, 4, 0, Math.PI * 2);
  }
  ctx.stroke();
}

export function designationsLayer() {
  return {
    id: 'designations',
    order: 97,
    draw(ctx, game, view) {
      const t = view.time;
      for (const def of game.defs.designations.all()) {
        for (const d of game.designations.ofType(def.id)) {
          if (d.x < view.x0 - 1 || d.x > view.x1 + 1 || d.y < view.y0 - 1 || d.y > view.y1 + 1) continue;
          if (!game.vision.isExplored(d.x, d.y)) continue;
          const target = game.entities.get(d.targetId);
          const cx = (d.x + (target?.w || 1) / 2) * TILE;
          const cy = (d.y + (target?.h || 1) / 2) * TILE;
          const c = def.color || '#ffffff';
          const pulse = 0.75 + Math.sin(t * 3 + d.x) * 0.25;
          ctx.strokeStyle = rgba(c, 0.55 * pulse);
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(cx, cy, 13, t * 0.8, t * 0.8 + Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(5,6,14,0.75)';
          ctx.beginPath();
          ctx.arc(cx + 9, cy - 9, 7, 0, Math.PI * 2);
          ctx.fill();
          glyph(ctx, def.glyph, cx + 9, cy - 9, c);
          if (def.draw) def.draw(ctx, d, game, view);
        }
      }
    },
  };
}

export function overlayLayer() {
  return {
    id: 'overlay',
    order: 98,
    draw(ctx, game, view) {
      const t = view.time;
      const pc = game.player;
      const leader = game.getLeader();
      // подсветка цели действия E
      const h = pc?.hint;
      if (h && h.tx !== undefined && !pc.toolActive) {
        const b = game.map.buildingAt(h.tx, h.ty);
        const w = b ? b.w || 1 : 1;
        const hh = b ? b.h || 1 : 1;
        const x = (b ? b.x : h.tx) * TILE;
        const y = (b ? b.y : h.ty) * TILE;
        ctx.strokeStyle = rgba('#5ef2ff', 0.55 + Math.sin(t * 5) * 0.2);
        ctx.lineWidth = 1.5;
        const L = 7;
        ctx.beginPath();
        const W = w * TILE;
        const H = hh * TILE;
        ctx.moveTo(x, y + L); ctx.lineTo(x, y); ctx.lineTo(x + L, y);
        ctx.moveTo(x + W - L, y); ctx.lineTo(x + W, y); ctx.lineTo(x + W, y + L);
        ctx.moveTo(x + W, y + H - L); ctx.lineTo(x + W, y + H); ctx.lineTo(x + W - L, y + H);
        ctx.moveTo(x + L, y + H); ctx.lineTo(x, y + H); ctx.lineTo(x, y + H - L);
        ctx.stroke();
      }
      // полосы прогресса работы
      for (const p of game.entities.ofKind('pawn')) {
        const wp = p.workProgress;
        if (!wp) continue;
        if (game.vision.enabled && !game.vision.isVisible(Math.floor(p.x), Math.floor(p.y))) continue;
        const x = wp.x * TILE - 14;
        const y = wp.y * TILE - 24;
        ctx.fillStyle = 'rgba(5,6,14,0.8)';
        roundRect(ctx, x - 1, y - 1, 30, 6, 2);
        ctx.fill();
        ctx.fillStyle = p.color || '#5ef2ff';
        ctx.fillRect(x, y, 28 * wp.p, 4);
        drawGlow(ctx, x + 28 * wp.p, y + 2, 6, p.color || '#5ef2ff', 0.8);
      }
      // имена
      if (view.zoom >= 0.95) {
        ctx.font = '500 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const hover = game.ui.hoverWorld;
        for (const p of game.entities.ofKind('pawn')) {
          if (p.dead) continue;
          if (game.vision.enabled && !game.vision.isVisible(Math.floor(p.x), Math.floor(p.y))) continue;
          const isHover = hover?.entities?.includes(p);
          if (!isHover && view.zoom < 1.3 && p !== leader) continue;
          if (p._nameSrc !== p.name) {
            p._nameSrc = p.name;
            p._firstName = String(p.name ?? '').split(' ')[0];
          }
          const name = p._firstName;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillText(name, p.x * TILE + 0.5, p.y * TILE + 12.5);
          ctx.fillStyle = rgba(p.color || '#fff', isHover ? 1 : 0.8);
          ctx.fillText(name, p.x * TILE, p.y * TILE + 12);
        }
      }
      // рамка инструмента пометок
      const tool = pc?.tool;
      const m = game.input.mouse;
      if (pc?.toolActive || tool) {
        const x0 = tool ? Math.min(tool.x0, m.tx) : m.tx;
        const y0 = tool ? Math.min(tool.y0, m.ty) : m.ty;
        const x1 = tool ? Math.max(tool.x0, m.tx) : m.tx;
        const y1 = tool ? Math.max(tool.y0, m.ty) : m.ty;
        const c = tool?.mode === 'remove' ? '#ff5f6d' : '#ff9f43';
        ctx.fillStyle = rgba(c, 0.08);
        ctx.fillRect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
        ctx.strokeStyle = rgba(c, 0.85);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(x0 * TILE + 0.5, y0 * TILE + 0.5, (x1 - x0 + 1) * TILE - 1, (y1 - y0 + 1) * TILE - 1);
        ctx.setLineDash([]);
      }
    },
  };
}

/** Декор поезда: нос локомотива, искры, подписи вагонов. */
export function trainDecoLayer() {
  return {
    id: 'train-deco',
    order: 65,
    draw(ctx, game, view) {
      const train = game.train;
      if (!train?.stamped) return;
      const t = view.time;
      for (const car of train.cars) {
        const r = car.rect;
        if (!r) continue;
        if (r.x > view.x1 + 3 || r.x + r.w < view.x0 - 3) continue;
        const def = train.carDef(car);
        if (def.locomotive) {
          // нос-«скотосбрасыватель»
          const fx = (r.x + r.w) * TILE;
          const top = (r.y + 1) * TILE;
          const bot = (r.y + r.h - 1) * TILE;
          const mid = (top + bot) / 2;
          ctx.fillStyle = '#0a1420';
          ctx.beginPath();
          ctx.moveTo(fx, top);
          ctx.lineTo(fx + 30, mid);
          ctx.lineTo(fx, bot);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = rgba(def.color, 0.35);
          ctx.lineWidth = 5;
          ctx.stroke();
          ctx.strokeStyle = def.color;
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.strokeStyle = rgba(def.color, 0.4);
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let k = 1; k < 5; k++) {
            const yy = top + ((bot - top) * k) / 5;
            ctx.moveTo(fx, yy);
            ctx.lineTo(fx + 30 * (1 - Math.abs(yy - mid) / ((bot - top) / 2)), mid + (yy - mid) * 0.15);
          }
          ctx.stroke();
          // фара
          const lp = 0.85 + Math.sin(t * 2) * 0.15;
          drawGlow(ctx, fx + 26, mid, 34 * lp, '#bffaff', 0.6);
          // искры мана-двигателя
          if (!game.isHeadless && view.frame % 9 === 0 && !game.paused) {
            game.fx.preset('embers', r.x + r.w - 3, r.y + 0.6, { count: 1 });
          }
        }
        if (view.zoom >= 0.7) {
          ctx.font = `600 ${Math.round(11)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = rgba(def.color, 0.55);
          ctx.fillText(game.t(def.nameKey).toUpperCase(), (r.x + r.w / 2) * TILE, r.y * TILE - 4);
        }
      }
      void TILE_FLAG;
    },
  };
}
