// Неоновое свечение без shadowBlur в горячих циклах:
//  - glowSprite(color, radius) — заранее отрисованный радиальный градиент (кэш по цвету/радиусу);
//  - drawGlow(ctx, x, y, r, color, alpha) — рисует спрайт в режиме 'lighter' (аддитивно);
//  - neonStroke(ctx, pathFn, color, width) — «трубка»: широкий полупрозрачный штрих + тонкий яркий.
// shadowBlur допустим только при запекании в кэш (чанки тайлов, спрайты).
import { sprite } from '../engine/assets.js';
import { hexToRgb, rgba } from './color.js';

/** Радиальный спрайт свечения (диаметр 2r, r квантуется до 8 px). */
export function glowSprite(color, radius = 32, falloff = 2) {
  const r = Math.max(8, Math.ceil(radius / 8) * 8);
  return sprite(`glow:${color}:${r}:${falloff}`, r * 2, r * 2, (ctx) => {
    const [cr, cg, cb] = hexToRgb(color);
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = Math.pow(1 - t, falloff);
      g.addColorStop(t, `rgba(${cr},${cg},${cb},${a.toFixed(3)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, r * 2, r * 2);
  });
}

/** Аддитивное свечение в точке (координаты контекста). */
export function drawGlow(ctx, x, y, r, color, alpha = 1) {
  if (alpha <= 0.01 || r <= 0) return;
  const s = glowSprite(color, r);
  const prevOp = ctx.globalCompositeOperation;
  const prevA = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = prevA * Math.min(1, alpha);
  ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = prevA;
  ctx.globalCompositeOperation = prevOp;
}

/** Неоновая линия: pathFn(ctx) строит путь (beginPath делается здесь). */
export function neonStroke(ctx, pathFn, color, width = 2, glowAlpha = 0.35) {
  ctx.beginPath();
  pathFn(ctx);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(color, glowAlpha * 0.5);
  ctx.lineWidth = width * 4;
  ctx.stroke();
  ctx.strokeStyle = rgba(color, glowAlpha);
  ctx.lineWidth = width * 2.2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function neonCircle(ctx, x, y, r, color, width = 2, fill = null, glowAlpha = 0.35) {
  if (fill) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  neonStroke(ctx, (c) => c.arc(x, y, r, 0, Math.PI * 2), color, width, glowAlpha);
}

/** Текст со свечением (для UI; shadowBlur — немного текста за кадр). */
export function glowText(ctx, text, x, y, color = '#fff', blur = 8) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
