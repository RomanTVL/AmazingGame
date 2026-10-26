// Отрисовка mind: пузыри разговоров над пешками (значок темы; ссора — красный пузырь) и значок срыва.
// Только браузер: вызывается из оверлея пешки (game.render.registerPawnOverlay), в мировых пикселях.
import { TILE } from '../../../core/constants.js';

const INK = '#1a1626';

/** Значки 12×12 (центр в 0,0). */
const GLYPHS = {
  none(c) {
    for (const x of [-3.5, 0, 3.5]) {
      c.beginPath();
      c.arc(x, 0.5, 1.3, 0, Math.PI * 2);
      c.fill();
    }
  },
  food(c) {
    c.beginPath();
    c.moveTo(-5, -0.5);
    c.quadraticCurveTo(0, 7, 5, -0.5);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(-1.8, -2.5);
    c.quadraticCurveTo(-0.6, -4, -1.8, -5.5);
    c.moveTo(1.8, -2.5);
    c.quadraticCurveTo(3, -4, 1.8, -5.5);
    c.stroke();
  },
  heart(c) {
    c.beginPath();
    c.moveTo(0, 5);
    c.bezierCurveTo(-6.5, 0.5, -5, -5, -2.4, -5);
    c.bezierCurveTo(-1, -5, 0, -3.8, 0, -2.6);
    c.bezierCurveTo(0, -3.8, 1, -5, 2.4, -5);
    c.bezierCurveTo(5, -5, 6.5, 0.5, 0, 5);
    c.fill();
  },
  skull(c) {
    c.beginPath();
    c.arc(0, -1, 4.6, Math.PI * 0.85, Math.PI * 2.15);
    c.lineTo(2.6, 5);
    c.lineTo(-2.6, 5);
    c.closePath();
    c.fill();
    c.save();
    c.fillStyle = '#f4f1ff';
    c.beginPath();
    c.arc(-1.8, -0.6, 1.2, 0, Math.PI * 2);
    c.arc(1.8, -0.6, 1.2, 0, Math.PI * 2);
    c.fill();
    c.restore();
  },
  star(c) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 2.4 : 5.6;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  },
  train(c) {
    c.fillRect(-5, -3.5, 10, 6);
    c.save();
    c.fillStyle = '#f4f1ff';
    c.fillRect(-3.5, -2, 2.5, 2);
    c.fillRect(1, -2, 2.5, 2);
    c.restore();
    c.beginPath();
    c.arc(-2.8, 4, 1.5, 0, Math.PI * 2);
    c.arc(2.8, 4, 1.5, 0, Math.PI * 2);
    c.fill();
  },
  home(c) {
    c.beginPath();
    c.moveTo(-5.5, 0);
    c.lineTo(0, -5);
    c.lineTo(5.5, 0);
    c.lineTo(4, 0);
    c.lineTo(4, 5);
    c.lineTo(-4, 5);
    c.lineTo(-4, 0);
    c.closePath();
    c.fill();
  },
  coin(c) {
    c.beginPath();
    c.arc(0, 0, 5, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.strokeStyle = '#f4f1ff';
    c.beginPath();
    c.arc(0, 0, 3, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  },
  fire(c) {
    c.beginPath();
    c.moveTo(0, -6);
    c.quadraticCurveTo(5, -1, 3.8, 2.5);
    c.quadraticCurveTo(2.5, 5.5, 0, 5.5);
    c.quadraticCurveTo(-2.5, 5.5, -3.8, 2.5);
    c.quadraticCurveTo(-4.5, -0.5, -1, -2.5);
    c.quadraticCurveTo(-0.5, -4, 0, -6);
    c.fill();
  },
  laugh(c) {
    c.beginPath();
    c.arc(0, 0, 5.2, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(-1.8, -1.5, 0.9, 0, Math.PI * 2);
    c.arc(1.8, -1.5, 0.9, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(0, 0.6, 2.8, 0.1 * Math.PI, 0.9 * Math.PI);
    c.closePath();
    c.fill();
  },
  anger(c) {
    // «молния» ссоры
    c.beginPath();
    c.moveTo(1.5, -6);
    c.lineTo(-3.5, 1);
    c.lineTo(-0.3, 1);
    c.lineTo(-1.5, 6);
    c.lineTo(3.5, -1);
    c.lineTo(0.3, -1);
    c.closePath();
    c.fill();
  },
  tear(c) {
    c.beginPath();
    c.moveTo(0, -6);
    c.quadraticCurveTo(4.5, 0, 4, 2);
    c.arc(0, 2, 4, 0, Math.PI);
    c.quadraticCurveTo(-4.5, 0, 0, -6);
    c.fill();
  },
  cloud(c) {
    c.beginPath();
    c.arc(-2.5, 1, 3, 0, Math.PI * 2);
    c.arc(1, -1, 3.6, 0, Math.PI * 2);
    c.arc(3.5, 1.8, 2.4, 0, Math.PI * 2);
    c.fill();
    c.fillRect(-2.5, 1.5, 6, 2.6);
  },
  hide(c) {
    // закрытый глаз
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(0, -2, 5, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
    for (const x of [-3.5, 0, 3.5]) {
      c.beginPath();
      c.moveTo(x * 0.9, 2.6);
      c.lineTo(x * 1.2, 5);
      c.stroke();
    }
  },
};

export const GLYPH_IDS = Object.keys(GLYPHS);

function bubble(ctx, x, y, w, h, fill, stroke) {
  const r = 5;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + r, y - h);
  ctx.lineTo(x + w / 2 - r, y - h);
  ctx.quadraticCurveTo(x + w / 2, y - h, x + w / 2, y - h + r);
  ctx.lineTo(x + w / 2, y - r);
  ctx.quadraticCurveTo(x + w / 2, y, x + w / 2 - r, y);
  ctx.lineTo(x + 3, y);
  ctx.lineTo(x - 1, y + 5);
  ctx.lineTo(x - 2, y);
  ctx.lineTo(x - w / 2 + r, y);
  ctx.quadraticCurveTo(x - w / 2, y, x - w / 2, y - r);
  ctx.lineTo(x - w / 2, y - h + r);
  ctx.quadraticCurveTo(x - w / 2, y - h, x - w / 2 + r, y - h);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/** Пузырь со значком над точкой (мировые пиксели). */
export function drawGlyphBubble(ctx, glyph, x, y, style = 'talk', alpha = 1) {
  const draw = GLYPHS[glyph] || GLYPHS.none;
  ctx.save();
  ctx.globalAlpha = alpha;
  const red = style === 'red';
  const brk = style === 'break';
  const fill = red ? '#ff4f6d' : brk ? '#6b5bd6' : '#f4f1ff';
  const stroke = red ? '#ffd1da' : brk ? '#c9b8ff' : 'rgba(26,22,38,0.55)';
  bubble(ctx, x, y, 22, 18, fill, stroke);
  ctx.translate(x, y - 9);
  const ink = red || brk ? '#ffffff' : glyph === 'heart' ? '#ff4f8a' : glyph === 'fire' ? '#ff8a3d' : glyph === 'star' ? '#e0a800' : INK;
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  draw(ctx);
  ctx.restore();
}

/** Оверлей пешки: разговор или срыв. */
export function pawnOverlay(M) {
  return {
    id: 'mind:bubbles',
    order: 80,
    draw(ctx, p, view, game) {
      const now = game.time.tick;
      const x = p.x * TILE + 10;
      const y = p.y * TILE - TILE * 0.62;
      const t = M.R.talks.get(p.id);
      if (t && now >= t.start && now < t.until) {
        const age = now - t.start;
        const left = t.until - now;
        const a = Math.min(1, age / 12, left / 30);
        const bob = Math.sin((now + p.id * 17) * 0.08) * 1.2;
        drawGlyphBubble(ctx, t.glyph, x, y + bob, t.red ? 'red' : 'talk', a);
        return;
      }
      const b = p.mindBreak;
      if (b) {
        const glyph = b.kind === 'cry' ? 'tear' : b.kind === 'hide_in_room' ? 'hide' : 'cloud';
        const a = 0.75 + 0.25 * Math.sin(now * 0.06);
        drawGlyphBubble(ctx, glyph, x, y, 'break', a);
      }
    },
  };
}
