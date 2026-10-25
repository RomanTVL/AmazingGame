// av — значки тем разговора/снов и облачка (кэшированные спрайты, рисуются в браузере лениво).
// Значки: food, heart, skull, coin, cat, rot, train, home, star, fire (+ friend_dead, nightmare, cup, moon, note, zzz).
import { sprite } from '../../engine/assets.js';
import { rgba, mix } from '../../render/color.js';

const SS = 3; // пикселей спрайта на мировой пиксель
export const GLYPH = 16;

export const GLYPH_COLORS = {
  food: '#ffc46b', heart: '#ff5f8a', skull: '#e8ecff', coin: '#ffd84f', cat: '#ffb0d8', rot: '#a6b39a',
  train: '#5ef2ff', home: '#ffcf8a', star: '#fff27a', fire: '#ff8a3d', friend_dead: '#c9d4ff', nightmare: '#ff4f6d',
  cup: '#ffd9a0', moon: '#d8e4ff', note: '#c9b8ff', zzz: '#c9d4ff', knife: '#e0e8ff',
};

const DRAW = {
  food(c) {
    // миска с паром
    c.beginPath();
    c.moveTo(2.5, 8.5);
    c.quadraticCurveTo(8, 16, 13.5, 8.5);
    c.closePath();
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(6, 6.5);
    c.quadraticCurveTo(7.5, 4.5, 6, 2.5);
    c.moveTo(10, 6.5);
    c.quadraticCurveTo(11.5, 4.5, 10, 2.5);
    c.stroke();
  },
  heart(c) {
    c.beginPath();
    c.moveTo(8, 13.5);
    c.bezierCurveTo(1, 9, 2, 3, 5.5, 3);
    c.bezierCurveTo(7, 3, 8, 4.5, 8, 5.5);
    c.bezierCurveTo(8, 4.5, 9, 3, 10.5, 3);
    c.bezierCurveTo(14, 3, 15, 9, 8, 13.5);
    c.fill();
  },
  skull(c) {
    c.beginPath();
    c.arc(8, 7, 5, Math.PI * 0.85, Math.PI * 2.15);
    c.lineTo(11, 13);
    c.lineTo(5, 13);
    c.closePath();
    c.fill();
    c.fillStyle = '#10121e';
    c.beginPath();
    c.arc(6, 7.5, 1.4, 0, Math.PI * 2);
    c.arc(10, 7.5, 1.4, 0, Math.PI * 2);
    c.fill();
    c.fillRect(7.5, 10, 1, 1.5);
  },
  coin(c) {
    c.beginPath();
    c.arc(8, 8, 5.5, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(80,50,0,0.8)';
    c.beginPath();
    c.arc(8, 8, 3.6, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(8, 5.5);
    c.lineTo(8, 10.5);
    c.stroke();
  },
  cat(c) {
    c.beginPath();
    c.moveTo(3, 13);
    c.lineTo(3, 5);
    c.lineTo(5.5, 2.5);
    c.lineTo(6.5, 5.5);
    c.lineTo(9.5, 5.5);
    c.lineTo(10.5, 2.5);
    c.lineTo(13, 5);
    c.lineTo(13, 13);
    c.closePath();
    c.fill();
    c.fillStyle = '#10121e';
    c.fillRect(5.5, 8, 1.5, 1.5);
    c.fillRect(9, 8, 1.5, 1.5);
    c.strokeStyle = '#10121e';
    c.beginPath();
    c.moveTo(1, 10.5);
    c.lineTo(5, 10.5);
    c.moveTo(11, 10.5);
    c.lineTo(15, 10.5);
    c.stroke();
  },
  rot(c) {
    // серая клякса-спираль
    c.beginPath();
    for (let i = 0; i <= 28; i++) {
      const a = i * 0.45;
      const r = 1 + i * 0.22;
      const x = 8 + Math.cos(a) * r;
      const y = 8 + Math.sin(a) * r;
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.lineWidth = 1.6;
    c.stroke();
    c.beginPath();
    c.arc(3, 12.5, 1.1, 0, Math.PI * 2);
    c.arc(13, 3.5, 0.9, 0, Math.PI * 2);
    c.fill();
  },
  train(c) {
    c.fillRect(2, 5, 9, 6);
    c.beginPath();
    c.moveTo(11, 5);
    c.lineTo(14.5, 8);
    c.lineTo(11, 11);
    c.closePath();
    c.fill();
    c.fillRect(4, 2.5, 2.2, 2.5);
    c.fillStyle = '#10121e';
    c.fillRect(3.5, 6.5, 2, 2);
    c.fillRect(7, 6.5, 2, 2);
    c.beginPath();
    c.arc(4.5, 12.5, 1.5, 0, Math.PI * 2);
    c.arc(9.5, 12.5, 1.5, 0, Math.PI * 2);
    c.fill();
  },
  home(c) {
    c.beginPath();
    c.moveTo(2, 8);
    c.lineTo(8, 2.5);
    c.lineTo(14, 8);
    c.lineTo(12.5, 8);
    c.lineTo(12.5, 13.5);
    c.lineTo(3.5, 13.5);
    c.lineTo(3.5, 8);
    c.closePath();
    c.fill();
    c.fillStyle = '#ffe9a0';
    c.fillRect(6.8, 9, 2.4, 2.4);
  },
  star(c) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 2.6 : 6.2;
      c.lineTo(8 + Math.cos(a) * r, 8.5 + Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  },
  fire(c) {
    c.beginPath();
    c.moveTo(8, 1.5);
    c.bezierCurveTo(12, 6, 14, 9, 12, 12);
    c.bezierCurveTo(10.5, 14.5, 5.5, 14.5, 4, 12);
    c.bezierCurveTo(2.5, 9.5, 4.5, 7.5, 5.5, 5.5);
    c.bezierCurveTo(6, 7.5, 7, 8, 7.5, 8);
    c.bezierCurveTo(7, 6, 7, 4, 8, 1.5);
    c.fill();
    c.fillStyle = '#fff2b0';
    c.beginPath();
    c.ellipse(8.3, 11.3, 1.8, 2.2, 0, 0, Math.PI * 2);
    c.fill();
  },
  friend_dead(c) {
    // силуэт со свечой
    c.beginPath();
    c.arc(6, 5, 2.4, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(2, 14);
    c.quadraticCurveTo(6, 6, 10, 14);
    c.fill();
    c.fillRect(11.5, 8, 2, 6);
    c.fillStyle = '#ffd27a';
    c.beginPath();
    c.ellipse(12.5, 6.3, 0.9, 1.6, 0, 0, Math.PI * 2);
    c.fill();
  },
  nightmare(c) {
    c.beginPath();
    c.moveTo(1.5, 8);
    c.quadraticCurveTo(8, 1.5, 14.5, 8);
    c.quadraticCurveTo(8, 14.5, 1.5, 8);
    c.fill();
    c.fillStyle = '#10121e';
    c.beginPath();
    c.arc(8, 8, 2.6, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ff9aa8';
    c.fillRect(7.2, 7.2, 1.6, 1.6);
  },
  cup(c) {
    c.fillRect(4, 5, 7, 8);
    c.lineWidth = 1.4;
    c.beginPath();
    c.arc(11.5, 9, 2.2, -Math.PI / 2, Math.PI / 2);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.fillRect(4.5, 5, 6, 1.4);
  },
  moon(c) {
    c.beginPath();
    c.arc(8, 8, 5.5, Math.PI * 0.35, Math.PI * 1.65);
    c.quadraticCurveTo(4, 8, 10.5, 12.8);
    c.fill();
  },
  note(c) {
    c.fillRect(9.5, 2.5, 1.3, 9);
    c.beginPath();
    c.ellipse(8, 12, 2.6, 1.9, -0.4, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(10.8, 2.5);
    c.quadraticCurveTo(14, 4, 13, 7);
    c.stroke();
  },
  zzz(c) {
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(3, 4);
    c.lineTo(8, 4);
    c.lineTo(3, 9);
    c.lineTo(8, 9);
    c.moveTo(9, 9);
    c.lineTo(13, 9);
    c.lineTo(9, 13);
    c.lineTo(13, 13);
    c.stroke();
  },
  knife(c) {
    c.beginPath();
    c.moveTo(3, 13);
    c.lineTo(11, 5);
    c.lineTo(13.5, 2.5);
    c.lineTo(12.5, 6);
    c.lineTo(5, 14);
    c.closePath();
    c.fill();
  },
};

export const GLYPH_IDS = Object.keys(DRAW);

/** Спрайт значка (16×16 мировых px). */
export function glyphSprite(id, color) {
  const name = DRAW[id] ? id : 'star';
  const col = color || GLYPH_COLORS[name] || '#ffffff';
  return sprite(`avg:${name}:${col}`, GLYPH * SS, GLYPH * SS, (ctx) => {
    ctx.scale(SS, SS);
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur = 3 * SS;
    DRAW[name](ctx);
    ctx.shadowBlur = 0;
  });
}

/**
 * Облачко: 'round' (пастель, болтовня), 'jagged' (спор), 'soft' (душевный), 'dream' (сон, с кружками-хвостом).
 * Размер 24×20 мировых px; хвост вниз.
 */
export function bubbleSprite(style, color) {
  const W = 24;
  const H = 20;
  return sprite(`avb:${style}:${color}`, W * SS, H * SS, (ctx) => {
    ctx.scale(SS, SS);
    const fill = style === 'jagged' ? rgba(mix(color, '#200008', 0.6), 0.92) : rgba(mix(color, '#0b0d1a', 0.55), 0.9);
    ctx.fillStyle = fill;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.1;
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 4 * SS;
    ctx.beginPath();
    if (style === 'jagged') {
      const cx = 12;
      const cy = 9;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const r = i % 2 ? 6.2 : 8.6;
        ctx.lineTo(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 0.95);
      }
      ctx.closePath();
    } else {
      const r = style === 'soft' ? 7 : 6;
      ctx.moveTo(2 + r, 1.5);
      ctx.arcTo(22, 1.5, 22, 15, r);
      ctx.arcTo(22, 15, 2, 15, r);
      if (style !== 'dream') {
        ctx.lineTo(13, 15);
        ctx.lineTo(10, 18.5);
        ctx.lineTo(9.5, 15);
      }
      ctx.arcTo(2, 15, 2, 1.5, r);
      ctx.arcTo(2, 1.5, 22, 1.5, r);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (style === 'dream') {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(6, 17, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(3, 19, 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });
}

/** Нарисовать значок в мировых px по центру (x, y) размера size. */
export function drawGlyph(ctx, id, x, y, size = 12, alpha = 1, color) {
  if (alpha <= 0.01) return;
  const s = glyphSprite(id, color);
  const pa = ctx.globalAlpha;
  ctx.globalAlpha = pa * alpha;
  ctx.drawImage(s, x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = pa;
}

export function drawBubble(ctx, style, color, x, y, scale = 1, alpha = 1) {
  if (alpha <= 0.01) return;
  const s = bubbleSprite(style, color);
  const w = 24 * scale;
  const h = 20 * scale;
  const pa = ctx.globalAlpha;
  ctx.globalAlpha = pa * alpha;
  ctx.drawImage(s, x - w / 2, y - h, w, h);
  ctx.globalAlpha = pa;
}
