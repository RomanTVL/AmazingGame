// Отрисовка сущностей по видам. Порядок выбора отрисовщика: def.draw → game.render.registerDefDrawer(defId)
// → game.render.registerDrawer(kind). Сигнатура: draw(ctx, e, game, view), мировые пиксели (клетка = TILE).
// Ночью дополнительно вызывается drawEmissive(ctx, e, game, view, alpha) — неон поверх темноты.
// Сущности вне обзора скрываются (динамичные — если клетка не видна, статичные — если не исследована).
import { TILE } from '../core/constants.js';
import { hash2, hash01 } from '../core/math.js';
import { sprite } from '../engine/assets.js';
import { drawGlow, glowSprite } from './glow.js';
import { rgba, mix } from './color.js';
import { roundRect } from '../engine/ui.js';

const DYNAMIC = new Set(['pawn', 'projectile']);

const byY = (a, b) => a.y - b.y;

/** Видна ли сущность с учётом тумана: динамичные — если клетка видна, статичные — если исследована. */
export function isEntityVisible(game, e) {
  const vis = game.vision;
  if (!vis.enabled) return true;
  return DYNAMIC.has(e.kind) ? vis.isVisible(Math.floor(e.x), Math.floor(e.y)) : vis.isExplored(e.x, e.y);
}

/**
 * Видимые сущности вида (с учётом тумана), по желанию отсортированы по y для «глубины».
 * out — переиспользуемый массив (очищается); без него создаётся новый.
 */
export function visibleOfKind(game, view, kind, sortY = false, out = []) {
  out.length = 0;
  game.entities.queryRect(view.x0 - 1, view.y0 - 1, view.x1 + 1, view.y1 + 1, kind, out);
  if (game.vision.enabled) {
    let n = 0;
    for (let i = 0; i < out.length; i++) if (isEntityVisible(game, out[i])) out[n++] = out[i];
    out.length = n;
  }
  if (sortY) out.sort(byY);
  return out;
}

export function drawEntity(ctx, game, view, e) {
  const def = game.entities.defOf(e);
  const d = game.render.drawerFor(e, def);
  if (d?.draw) d.draw(ctx, e, game, view, def);
}

export function makeKindLayer(id, order, kind, sortY = false, filter = null) {
  const buf = [];
  return {
    id,
    order,
    draw(ctx, game, view) {
      for (const e of visibleOfKind(game, view, kind, sortY, buf)) {
        if (filter && !filter(e, game)) continue;
        drawEntity(ctx, game, view, e);
      }
    },
  };
}

/** Слой пешек: тело (drawer) + оверлеи game.render.pawnOverlays для каждой видимой пешки, по y. */
export function pawnsLayer(id = 'pawns', order = 60) {
  const buf = [];
  return {
    id,
    order,
    draw(ctx, game, view) {
      const overlays = game.render.pawnOverlays.all();
      for (const p of visibleOfKind(game, view, 'pawn', true, buf)) {
        drawEntity(ctx, game, view, p);
        for (let i = 0; i < overlays.length; i++) {
          const o = overlays[i];
          if (o.enabled === false) continue;
          ctx.save();
          try {
            o.draw(ctx, p, view, game);
          } catch (err) {
            game.error(err, `pawnOverlay:${o.id}`);
          }
          ctx.restore();
        }
      }
    },
  };
}

// ---------------- Растения ----------------
function canopySprite(def, variant, ripe) {
  const key = `plant:${def.id}:${variant}:${ripe ? 1 : 0}`;
  const S = 96;
  return sprite(key, S, S, (ctx) => {
    const c = S / 2;
    const color = def.color || '#2fe39a';
    const R = (def.canopy || 0.6) * TILE;
    const h = (k) => hash01(variant * 17 + k, def.id.length * 7 + k, 99);
    if (def.id === 'glowcap') {
      for (let k = 0; k < 3; k++) {
        const x = c - 6 + h(k) * 12;
        const y = c - 6 + h(k + 5) * 12;
        const r = 2.2 + h(k + 9) * 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fillStyle = rgba(color, 0.9);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#e8ffff';
        ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
      }
      return;
    }
    // тень
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(c + 4, c + 6, R * 0.95, R * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    const lobes = def.id === 'tree_pine' ? 9 : def.id === 'tree_oak' ? 7 : def.id === 'bush_berry' ? 5 : 6;
    const pts = [];
    for (let k = 0; k < lobes; k++) {
      const a = (k / lobes) * Math.PI * 2 + h(k) * 0.4;
      const rr = R * (0.55 + h(k + 20) * 0.2);
      pts.push([c + Math.cos(a) * rr, c + Math.sin(a) * rr, R * (0.42 + h(k + 40) * 0.18)]);
    }
    const body = mix(color, '#000000', 0.8);
    const mid = mix(color, '#000000', 0.62);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.6, 0, Math.PI * 2);
    for (const [x, y, r] of pts) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    // неоновый контур
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    ctx.strokeStyle = rgba(color, 0.75);
    ctx.lineWidth = 1.3;
    for (const [x, y, r] of pts) {
      const a0 = Math.atan2(y - c, x - c);
      ctx.beginPath();
      ctx.arc(x, y, r, a0 - 1.25, a0 + 1.25);
      ctx.stroke();
    }
    ctx.restore();
    // внутренний ярус
    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.arc(c - R * 0.08, c - R * 0.1, R * 0.42, 0, Math.PI * 2);
    ctx.fill();
    if (def.id === 'tree_pine') {
      ctx.strokeStyle = rgba(color, 0.35);
      ctx.lineWidth = 1;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + h(k + 60);
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(c + Math.cos(a) * R * 0.7, c + Math.sin(a) * R * 0.7);
        ctx.stroke();
      }
    }
    // блики-«иголки»
    ctx.fillStyle = rgba(mix(color, '#ffffff', 0.3), 0.55);
    for (let k = 0; k < 10; k++) {
      const a = h(k + 80) * Math.PI * 2;
      const r = h(k + 90) * R * 0.75;
      ctx.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 1.4, 1.4);
    }
    if (def.harvestYield && ripe) {
      ctx.save();
      ctx.shadowColor = '#ff4f7a';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#ff5f8a';
      for (let k = 0; k < 7; k++) {
        const a = h(k + 120) * Math.PI * 2;
        const r = 3 + h(k + 130) * R * 0.6;
        ctx.beginPath();
        ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  });
}

const plantDrawer = {
  draw(ctx, e, game, view, def) {
    if (!def) return;
    const ripe = (e.growth ?? 1) >= 1;
    const spr = canopySprite(def, (e.variant ?? hash2(e.x, e.y) % 8) & 7, ripe);
    const sway = def.blocksMove ? Math.sin(view.time * 1.1 + e.x * 0.7 + e.y * 0.3) * 0.9 : 0;
    const scale = 0.55 + 0.45 * Math.min(1, e.growth ?? 1);
    const s = 96 * (def.blocksMove ? 1 : scale);
    ctx.drawImage(spr, e.x * TILE + 16 - s / 2 + sway, e.y * TILE + 16 - s / 2, s, s);
  },
  drawEmissive(ctx, e, game, view, alpha, def) {
    if (def?.light) drawGlow(ctx, e.x * TILE + 16, e.y * TILE + 16, def.light.radius * TILE * 0.5, def.light.color, alpha * 0.6);
  },
};

// ---------------- Предметы ----------------
function itemSprite(def) {
  return sprite(`item:${def.id}`, 32, 32, (ctx) => {
    const c = def.color || '#ccc';
    const dark = mix(c, '#000000', 0.7);
    ctx.lineWidth = 1.2;
    ctx.shadowColor = c;
    ctx.shadowBlur = 5;
    switch (def.icon) {
      case 'logs':
        for (let k = 0; k < 3; k++) {
          const y = 9 + k * 5 + (k === 1 ? -2 : 0);
          const x = 6 + (k === 1 ? 4 : 0);
          ctx.fillStyle = dark;
          roundRect(ctx, x, y, 18, 5, 2.5);
          ctx.fill();
          ctx.strokeStyle = c;
          ctx.stroke();
          ctx.fillStyle = mix(c, '#fff', 0.3);
          ctx.beginPath();
          ctx.arc(x + 17, y + 2.5, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'stone':
      case 'ore':
        for (let k = 0; k < 4; k++) {
          const x = 9 + (k % 2) * 8 + (k > 1 ? 3 : 0);
          const y = 11 + Math.floor(k / 2) * 7;
          ctx.fillStyle = dark;
          ctx.beginPath();
          ctx.ellipse(x, y, 5, 4, k, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = c;
          ctx.stroke();
        }
        break;
      case 'crystal':
        ctx.shadowBlur = 10;
        for (let k = 0; k < 3; k++) {
          const x = 10 + k * 6;
          const y = 18 - (k === 1 ? 4 : 0);
          ctx.fillStyle = rgba(c, 0.8);
          ctx.beginPath();
          ctx.moveTo(x, y - 8);
          ctx.lineTo(x + 3, y);
          ctx.lineTo(x, y + 5);
          ctx.lineTo(x - 3, y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#e8ffff';
          ctx.stroke();
        }
        break;
      case 'berries':
        ctx.fillStyle = c;
        for (let k = 0; k < 7; k++) {
          ctx.beginPath();
          ctx.arc(11 + (k % 3) * 5 + (k > 2 ? 2 : 0), 12 + Math.floor(k / 3) * 5, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'meat':
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.ellipse(16, 16, 9, 6, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c;
        ctx.stroke();
        ctx.fillStyle = '#ffe0e0';
        ctx.fillRect(20, 12, 3, 3);
        break;
      case 'meal':
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(16, 17, 8, 0, Math.PI);
        ctx.fill();
        ctx.strokeStyle = c;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(12, 12);
        ctx.quadraticCurveTo(14, 8, 12, 5);
        ctx.moveTo(18, 12);
        ctx.quadraticCurveTo(20, 8, 18, 5);
        ctx.stroke();
        break;
      case 'cross':
        ctx.fillStyle = dark;
        roundRect(ctx, 8, 8, 16, 16, 3);
        ctx.fill();
        ctx.strokeStyle = c;
        ctx.stroke();
        ctx.fillStyle = c;
        ctx.fillRect(14.5, 11, 3, 10);
        ctx.fillRect(11, 14.5, 10, 3);
        break;
      case 'bag':
        ctx.fillStyle = dark;
        roundRect(ctx, 7, 10, 18, 12, 5);
        ctx.fill();
        ctx.strokeStyle = c;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(12, 10);
        ctx.lineTo(12, 22);
        ctx.moveTo(20, 10);
        ctx.lineTo(20, 22);
        ctx.stroke();
        break;
      default:
        ctx.fillStyle = dark;
        roundRect(ctx, 8, 9, 16, 14, 2);
        ctx.fill();
        ctx.strokeStyle = c;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(8, 14);
        ctx.lineTo(24, 14);
        ctx.stroke();
    }
  });
}

const itemDrawer = {
  draw(ctx, e, game, view, def) {
    if (!def) return;
    ctx.drawImage(itemSprite(def), e.x * TILE, e.y * TILE);
    if (view.zoom >= 0.8 && e.count > 1) {
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(String(e.count), e.x * TILE + 31, e.y * TILE + 32);
      ctx.fillStyle = '#e8ecff';
      ctx.fillText(String(e.count), e.x * TILE + 30, e.y * TILE + 31);
    }
    if (e.forbidden) {
      ctx.strokeStyle = '#ff5f6d';
      ctx.strokeRect(e.x * TILE + 2, e.y * TILE + 2, 28, 28);
    }
  },
  drawEmissive(ctx, e, game, view, alpha, def) {
    if (def?.glow) drawGlow(ctx, e.x * TILE + 16, e.y * TILE + 16, 26, def.color, alpha * 0.7);
  },
};

// ---------------- Постройки ----------------
function doorOrientation(game, e) {
  const L = game.map.buildingAt(e.x - 1, e.y);
  const R = game.map.buildingAt(e.x + 1, e.y);
  return L || R ? 'h' : 'v';
}

const doorDrawer = {
  draw(ctx, e, game, view, def) {
    const near = game.entities.queryRadius(e.x + 0.5, e.y + 0.5, 1.3, 'pawn').length > 0;
    e._open = Math.max(0, Math.min(1, (e._open ?? 0) + (near ? 0.12 : -0.08)));
    const o = e._open;
    const px = e.x * TILE;
    const py = e.y * TILE;
    const color = e.tint || def.color || '#ffb86b';
    const horiz = (e._orient ||= doorOrientation(game, e)) === 'h';
    ctx.fillStyle = '#120d0a';
    if (horiz) ctx.fillRect(px, py + 8, TILE, TILE - 16);
    else ctx.fillRect(px + 8, py, TILE - 16, TILE);
    const slide = o * 13;
    ctx.fillStyle = '#1c1630';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    if (horiz) {
      ctx.fillRect(px + 1 - slide, py + 10, 14, TILE - 20);
      ctx.strokeRect(px + 1 - slide, py + 10, 14, TILE - 20);
      ctx.fillRect(px + 17 + slide, py + 10, 14, TILE - 20);
      ctx.strokeRect(px + 17 + slide, py + 10, 14, TILE - 20);
    } else {
      ctx.fillRect(px + 10, py + 1 - slide, TILE - 20, 14);
      ctx.strokeRect(px + 10, py + 1 - slide, TILE - 20, 14);
      ctx.fillRect(px + 10, py + 17 + slide, TILE - 20, 14);
      ctx.strokeRect(px + 10, py + 17 + slide, TILE - 20, 14);
    }
    ctx.restore();
  },
};

const engineDrawer = {
  draw(ctx, e, game, view) {
    const cx = (e.x + 1) * TILE;
    const cy = (e.y + 1) * TILE;
    const t = view.time;
    ctx.fillStyle = '#081624';
    ctx.beginPath();
    ctx.arc(cx, cy, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(94,242,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.stroke();
    // вращающиеся руны
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.6);
    ctx.strokeStyle = 'rgba(183,125,255,0.85)';
    ctx.lineWidth = 1.3;
    for (let k = 0; k < 6; k++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(18, -3);
      ctx.lineTo(22, 0);
      ctx.lineTo(18, 3);
      ctx.stroke();
    }
    ctx.restore();
    const pulse = 0.75 + Math.sin(t * 3) * 0.25;
    drawGlow(ctx, cx, cy, 40, '#5ef2ff', 0.55 * pulse);
    ctx.fillStyle = '#bffaff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 11);
    ctx.lineTo(cx + 6, cy);
    ctx.lineTo(cx, cy + 11);
    ctx.lineTo(cx - 6, cy);
    ctx.closePath();
    ctx.fill();
  },
  drawEmissive(ctx, e, game, view, alpha) {
    drawGlow(ctx, (e.x + 1) * TILE, (e.y + 1) * TILE, 70, '#5ef2ff', alpha * 0.6);
  },
};

/** Запасной отрисовщик построек модулей без своего draw: прямоугольник с неоновой рамкой. */
const genericBuildingDrawer = {
  draw(ctx, e, game, view, def) {
    const w = (e.w || 1) * TILE;
    const h = (e.h || 1) * TILE;
    const x = e.x * TILE;
    const y = e.y * TILE;
    const c = def?.color || '#9aa8ff';
    ctx.fillStyle = mix(c, '#000000', 0.82);
    roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 4);
    ctx.fill();
    ctx.strokeStyle = rgba(c, 0.9);
    ctx.lineWidth = 1.4;
    roundRect(ctx, x + 3.5, y + 3.5, w - 7, h - 7, 4);
    ctx.stroke();
    if (e.blueprint) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(94,242,255,0.9)';
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.setLineDash([]);
    }
    if (view.zoom > 0.9 && def) {
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(c, 0.9);
      ctx.fillText(game.t(def.nameKey || def.id).slice(0, 1), x + w / 2, y + h / 2);
    }
  },
  drawEmissive(ctx, e, game, view, alpha, def) {
    if (def?.light) drawGlow(ctx, (e.x + (e.w || 1) / 2) * TILE, (e.y + (e.h || 1) / 2) * TILE, def.light.radius * TILE * 0.5, def.light.color, alpha * 0.6);
  },
};

const bakedEmissive = {
  draw() {},
  drawEmissive: genericBuildingDrawer.drawEmissive,
};

const corpseDrawer = {
  draw(ctx, e, game) {
    const x = e.x * TILE + 16;
    const y = e.y * TILE + 16;
    const c = mix(e.color || '#888888', '#555555', 0.6);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 4, 12, 6, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#141420';
    ctx.strokeStyle = rgba(c, 0.8);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(x, y, 11, 6, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 11, y + 3, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    void game;
  },
};

const decalDrawer = {
  draw(ctx, e) {
    ctx.fillStyle = rgba(e.color || '#8a0a1a', e.alpha ?? 0.5);
    ctx.beginPath();
    ctx.ellipse(e.x * TILE + 16 + (e.ox || 0), e.y * TILE + 16 + (e.oy || 0), (e.r || 6), (e.r || 6) * 0.7, e.a || 0, 0, Math.PI * 2);
    ctx.fill();
  },
};

/** Слой «неона поверх темноты»: drawEmissive всех видимых сущностей. */
export function emissiveLayer() {
  const buf = [];
  return {
    id: 'emissive',
    order: 92,
    draw(ctx, game, view) {
      const alpha = view.night;
      if (alpha < 0.05) return;
      buf.length = 0;
      const list = game.entities.queryRect(view.x0 - 2, view.y0 - 2, view.x1 + 2, view.y1 + 2, undefined, buf);
      for (const e of list) {
        if (!isEntityVisible(game, e)) continue;
        const def = game.entities.defOf(e);
        let d = game.render.drawerFor(e, def);
        if (e.kind === 'building' && def?.bake && def.light && !def.drawEmissive) d = bakedEmissive;
        if (d?.drawEmissive) d.drawEmissive(ctx, e, game, view, alpha, def);
      }
    },
  };
}

export function registerEntityDrawers(game) {
  const r = game.render;
  r.registerDrawer('plant', plantDrawer);
  r.registerDrawer('item', itemDrawer);
  r.registerDrawer('building', genericBuildingDrawer);
  r.registerDrawer('corpse', corpseDrawer);
  r.registerDrawer('decal', decalDrawer);
  r.registerDefDrawer('wagon_door', doorDrawer);
  r.registerDefDrawer('mana_engine', engineDrawer);
  void glowSprite;
}

export { itemSprite, canopySprite };
