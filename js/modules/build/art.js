// Отрисовка построек build (неон без shadowBlur в кадре). Стены запекает ядро (paintWall по connects: 'wall').
// Каждый отрисовщик — {draw(ctx, e, game, view, def), drawEmissive?}; e может быть «призраком» {x, y, w, h, rot, defId}.
import { TILE } from '../../core/constants.js';
import { drawGlow } from '../../render/glow.js';
import { rgba, mix } from '../../render/color.js';
import { roundRect } from '../../engine/ui.js';

const T = TILE;
const dims = (e) => [e.x * T, e.y * T, (e.w || 1) * T, (e.h || 1) * T];

function box(ctx, x, y, w, h, color, r = 4, fillMix = 0.8) {
  ctx.fillStyle = mix(color, '#000000', fillMix);
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.lineWidth = 1.4;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();
}

/** Сторона «изголовья/спинки» по повороту: 0 N, 1 E, 2 S, 3 W. */
function sideRect(x, y, w, h, rot, depth) {
  switch ((rot | 0) & 3) {
    case 1: return [x + w - depth, y, depth, h];
    case 2: return [x, y + h - depth, w, depth];
    case 3: return [x, y, depth, h];
    default: return [x, y, w, depth];
  }
}

const bed = {
  draw(ctx, e, game, view, def) {
    const [x, y, w, h] = dims(e);
    const c = def.color || '#ffb86b';
    box(ctx, x + 3, y + 2, w - 6, h - 4, c, 5);
    // одеяло
    const blanket = def.id === 'bedroll' ? '#ff8fc8' : '#7a5cff';
    ctx.fillStyle = rgba(blanket, 0.45);
    const [bx, by, bw, bh] = sideRect(x + 6, y + 5, w - 12, h - 10, (e.rot + 2) & 3, Math.max(w, h) * 0.55);
    roundRect(ctx, bx, by, bw, bh, 3);
    ctx.fill();
    // подушка
    const [px, py, pw, ph] = sideRect(x + 7, y + 6, w - 14, h - 12, e.rot, 9);
    ctx.fillStyle = 'rgba(240,236,255,0.85)';
    roundRect(ctx, px, py, pw, ph, 3);
    ctx.fill();
  },
};

const table = {
  draw(ctx, e, game, view, def) {
    const [x, y, w, h] = dims(e);
    const c = def.color || '#ffb86b';
    box(ctx, x + 2, y + 4, w - 4, h - 8, c, 3, 0.72);
    ctx.strokeStyle = rgba(c, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (w >= h) for (let k = x + 8; k < x + w - 4; k += 8) { ctx.moveTo(k, y + 6); ctx.lineTo(k, y + h - 6); }
    else for (let k = y + 8; k < y + h - 4; k += 8) { ctx.moveTo(x + 6, k); ctx.lineTo(x + w - 6, k); }
    ctx.stroke();
  },
};

const chair = {
  draw(ctx, e, game, view, def) {
    const [x, y, w, h] = dims(e);
    const c = def.color || '#ffb86b';
    box(ctx, x + 8, y + 8, w - 16, h - 16, c, 3);
    const [sx, sy, sw, sh] = sideRect(x + 7, y + 6, w - 14, h - 12, e.rot, 4);
    ctx.fillStyle = rgba(c, 0.95);
    ctx.fillRect(sx, sy, sw, sh);
  },
};

const torch = {
  draw(ctx, e, game, view) {
    const cx = e.x * T + T / 2;
    const cy = e.y * T + T / 2;
    ctx.fillStyle = '#3a2412';
    ctx.fillRect(cx - 2, cy - 4, 4, 14);
    const fl = Math.sin((view?.time || 0) * 11 + e.x * 3) * 1.2;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 7 + fl * 0.3, 4 + fl * 0.4, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff1c2';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 6, 2, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  drawEmissive(ctx, e, game, view, alpha) {
    drawGlow(ctx, e.x * T + T / 2, e.y * T + T / 2 - 6, 30, '#ffb347', alpha * 0.8);
  },
};

const chest = {
  draw(ctx, e, game, view, def) {
    const [x, y, w, h] = dims(e);
    const c = def.color || '#ffd27a';
    if (def.id === 'shelf') {
      box(ctx, x + 2, y + 3, w - 4, h - 6, c, 2, 0.84);
      ctx.strokeStyle = rgba(c, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (w >= h) for (let k = x + T; k < x + w - 2; k += T) { ctx.moveTo(k, y + 4); ctx.lineTo(k, y + h - 4); }
      else for (let k = y + T; k < y + h - 2; k += T) { ctx.moveTo(x + 4, k); ctx.lineTo(x + w - 4, k); }
      ctx.stroke();
      return;
    }
    box(ctx, x + 5, y + 7, w - 10, h - 13, c, 3);
    ctx.fillStyle = rgba(c, 0.9);
    ctx.fillRect(x + 5, y + 13, w - 10, 1.5);
    ctx.fillRect(x + w / 2 - 2, y + 12, 4, 5);
  },
};

function doorHoriz(game, e) {
  const map = game.map;
  const wall = (x, y) => {
    const b = map?.buildingAt(x, y);
    const d = b && game.defs.buildings.get(b.defId);
    return !!d && (d.connects === 'wall' || !d.passable);
  };
  if (wall(e.x - 1, e.y) || wall(e.x + 1, e.y)) return true;
  if (wall(e.x, e.y - 1) || wall(e.x, e.y + 1)) return false;
  return true;
}

const door = {
  draw(ctx, e, game, view, def) {
    const px = e.x * T;
    const py = e.y * T;
    const c = def.color || '#ffb86b';
    const target = e.open ? 1 : 0;
    if (e.id) e._anim = (e._anim ?? target) + Math.max(-0.15, Math.min(0.15, target - (e._anim ?? target)));
    const o = e.id ? e._anim : 0;
    const horiz = doorHoriz(game, e);
    // проём
    ctx.fillStyle = '#120d0a';
    if (horiz) ctx.fillRect(px, py + 9, T, T - 18);
    else ctx.fillRect(px + 9, py, T - 18, T);
    // две створки разъезжаются
    const slide = o * 12;
    ctx.fillStyle = mix(c, '#000000', 0.78);
    ctx.strokeStyle = rgba(c, 0.95);
    ctx.lineWidth = 1.4;
    if (horiz) {
      ctx.fillRect(px + 1 - slide, py + 10, 14, T - 20);
      ctx.strokeRect(px + 1.5 - slide, py + 10.5, 13, T - 21);
      ctx.fillRect(px + 17 + slide, py + 10, 14, T - 20);
      ctx.strokeRect(px + 17.5 + slide, py + 10.5, 13, T - 21);
    } else {
      ctx.fillRect(px + 10, py + 1 - slide, T - 20, 14);
      ctx.strokeRect(px + 10.5, py + 1.5 - slide, T - 21, 13);
      ctx.fillRect(px + 10, py + 17 + slide, T - 20, 14);
      ctx.strokeRect(px + 10.5, py + 17.5 + slide, T - 21, 13);
    }
  },
};

/** Стена-«призрак» (для чертежей и превью; готовые стены запекает ядро). */
const wallGhost = {
  draw(ctx, e, game, view, def) {
    const [x, y, w, h] = dims(e);
    box(ctx, x + 6, y + 6, w - 12, h - 12, def.color || '#8fa8ff', 2, 0.85);
  },
};

export const DRAWERS = { bed, bedroll: bed, table, chair, torch, chest, shelf: chest, door, door_wood: door };

/** Отрисовщик для превью/чертежа: свой, иначе стена, иначе запасной прямоугольник. */
export function ghostDrawer(game, def) {
  if (!def) return null;
  const own = DRAWERS[def.art || def.id] || game.render.defDrawers.get(def.id);
  if (own?.draw) return own;
  if (def.draw) return def;
  if (def.connects === 'wall' && !def.passable) return wallGhost;
  return { draw: (ctx, e) => box(ctx, e.x * T + 3, e.y * T + 3, (e.w || 1) * T - 6, (e.h || 1) * T - 6, def.color || '#9aa8ff') };
}

export function registerArt(game, defs) {
  for (const d of defs) {
    const dr = DRAWERS[d.art || d.id];
    if (dr) game.render.registerDefDrawer(d.id, dr);
  }
}
