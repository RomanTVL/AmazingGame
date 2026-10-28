// Отрисовка пешек. Лидер — белобрысый кудрявый маг: плащ, посох с кристаллом, светящиеся белые кудри-завитки,
// которые колышутся при ходьбе. Поселенцы — неоновые силуэты своего цвета.
// Модули могут переопределить: game.render.registerDrawer('pawn', {draw, drawEmissive}) или задать pawn.drawAs —
// id отрисовщика из game.render.defDrawers (например, враги: pawn.defId = 'enemy_ghoul' + registerDefDrawer).
import { TILE } from '../core/constants.js';
import { drawGlow } from './glow.js';
import { rgba, mix, lighten } from './color.js';
import { itemSprite } from './entities.js';

const SKIN = '#e9cfb4';

function walkBob(p, view) {
  return p.moving ? Math.sin(p.walkPhase * 2) : Math.sin(view.time * 1.6 + p.id) * 0.25;
}

/** Завиток кудрей: маленькая спираль. */
function curl(ctx, x, y, r, rot) {
  ctx.moveTo(x + Math.cos(rot) * r, y + Math.sin(rot) * r);
  const turns = 1.5;
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = rot + t * turns * Math.PI * 2;
    const rr = r * (1 - t * 0.75);
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
}

function drawShadow(ctx, x, y, rx = 10, ry = 5) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(x, y + 8, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSleeping(ctx, p, view) {
  const x = p.x * TILE;
  const y = p.y * TILE;
  drawShadow(ctx, x, y - 4, 12, 5);
  ctx.fillStyle = '#151a2a';
  ctx.strokeStyle = rgba(p.color, 0.7);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.ellipse(x, y + 2, 11, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(x - 10, y + 1, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.hairColor;
  ctx.beginPath();
  ctx.arc(x - 12, y + 1, 4, Math.PI * 0.5, Math.PI * 1.5);
  ctx.fill();
  const t = view.time + p.id;
  ctx.font = '600 9px system-ui, sans-serif';
  ctx.fillStyle = rgba('#c9d4ff', 0.6 + Math.sin(t * 2) * 0.2);
  ctx.fillText('z', x + 4, y - 8 - ((t * 6) % 6));
  ctx.fillText('z', x + 9, y - 14 - ((t * 6 + 3) % 6));
}

/** Обычный поселенец/враг. */
export function drawPawnBody(ctx, p, game, view) {
  if (p.asleep) return drawSleeping(ctx, p, view);
  const x = p.x * TILE;
  const y = p.y * TILE;
  const bob = walkBob(p, view);
  const dir = p.dir || 0;
  const color = p.color || '#ffffff';
  drawShadow(ctx, x, y);
  ctx.save();
  ctx.translate(x, y - Math.abs(bob) * 1.2);
  // руки (качаются при ходьбе)
  const sw = p.moving ? Math.sin(p.walkPhase * 2) * 3 : 0;
  ctx.fillStyle = mix(color, '#000000', 0.55);
  for (const side of [-1, 1]) {
    const a = dir + side * 1.25;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 8 + Math.cos(dir) * sw * side, Math.sin(a) * 8 + Math.sin(dir) * sw * side, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // тело (плечи)
  ctx.save();
  ctx.rotate(dir);
  ctx.fillStyle = '#141826';
  ctx.beginPath();
  ctx.ellipse(0, 0, 6.5, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.35);
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  // голова
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(Math.cos(dir) * 1.5, Math.sin(dir) * 1.5, 4.6, 0, Math.PI * 2);
  ctx.fill();
  // волосы — на затылке
  ctx.fillStyle = p.hairColor || '#3b2a20';
  ctx.beginPath();
  ctx.arc(Math.cos(dir) * 0.5, Math.sin(dir) * 0.5, 4.8, dir + Math.PI * 0.55, dir + Math.PI * 1.45);
  ctx.fill();
  ctx.restore();
  if (p.drafted) {
    ctx.strokeStyle = 'rgba(255,79,79,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawCarry(ctx, p, game, x, y);
}

/** Лидер-маг. */
export function drawLeader(ctx, p, game, view) {
  if (p.asleep) return drawSleeping(ctx, p, view);
  const x = p.x * TILE;
  const y = p.y * TILE;
  const t = view.time;
  const bob = walkBob(p, view);
  const dir = p.dir || 0;
  const color = p.color || '#c9b8ff';
  const look = p.look || {};
  const crystal = typeof look.crystal === 'string' ? look.crystal : '#5ef2ff';
  const curlLen = Number.isFinite(look.curlLen) ? Math.max(0.6, Math.min(1.4, look.curlLen)) : 1;
  drawShadow(ctx, x, y, 11, 5);
  ctx.save();
  ctx.translate(x, y - Math.abs(bob) * 1.3);
  // плащ: развевается назад от направления
  const back = dir + Math.PI;
  const flutter = p.moving ? Math.sin(p.walkPhase * 2.4) * 0.22 : Math.sin(t * 1.5) * 0.06;
  const len = p.moving ? 16 : 12;
  ctx.save();
  ctx.rotate(back);
  ctx.beginPath();
  ctx.moveTo(-2, -8.5);
  ctx.quadraticCurveTo(len * 0.6, -11 - flutter * 10, len, -7 + flutter * 14);
  ctx.quadraticCurveTo(len + 2, 0, len, 7 + flutter * 14);
  ctx.quadraticCurveTo(len * 0.6, 11 - flutter * 10, -2, 8.5);
  ctx.closePath();
  ctx.fillStyle = '#1b1033';
  ctx.fill();
  ctx.strokeStyle = rgba('#9b6cff', 0.4);
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = '#9b6cff';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // руны по краю плаща
  ctx.fillStyle = rgba('#c9b8ff', 0.7);
  for (let k = 0; k < 3; k++) ctx.fillRect(len - 3 - k * 0.5, -4 + k * 4 + flutter * 8, 1.5, 1.5);
  ctx.restore();
  // посох в правой руке
  const hand = dir + 1.1;
  const hx = Math.cos(hand) * 8;
  const hy = Math.sin(hand) * 8;
  const sx = hx + Math.cos(dir) * 13;
  const sy = hy + Math.sin(dir) * 13;
  const bx = hx - Math.cos(dir) * 9;
  const by = hy - Math.sin(dir) * 9;
  ctx.strokeStyle = '#6b4a2e';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(sx, sy);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,220,170,0.35)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // тело
  ctx.save();
  ctx.rotate(dir);
  ctx.fillStyle = '#16102a';
  ctx.beginPath();
  ctx.ellipse(0, 0, 6.8, 9.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.4);
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  // руки
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(hx, hy, 2.4, 0, Math.PI * 2);
  ctx.arc(Math.cos(dir - 1.1) * 8, Math.sin(dir - 1.1) * 8, 2.4, 0, Math.PI * 2);
  ctx.fill();
  // кристалл на посохе
  const pulse = 0.8 + Math.sin(t * 4) * 0.2;
  drawGlow(ctx, sx, sy, 16 * pulse, crystal, 0.9);
  ctx.fillStyle = lighten(crystal, 0.75);
  ctx.beginPath();
  ctx.moveTo(sx + Math.cos(dir) * 4.5, sy + Math.sin(dir) * 4.5);
  ctx.lineTo(sx + Math.cos(dir + 1.57) * 2.5, sy + Math.sin(dir + 1.57) * 2.5);
  ctx.lineTo(sx - Math.cos(dir) * 3, sy - Math.sin(dir) * 3);
  ctx.lineTo(sx + Math.cos(dir - 1.57) * 2.5, sy + Math.sin(dir - 1.57) * 2.5);
  ctx.closePath();
  ctx.fill();
  // голова
  const hcx = Math.cos(dir) * 1.2;
  const hcy = Math.sin(dir) * 1.2;
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(hcx, hcy, 5, 0, Math.PI * 2);
  ctx.fill();
  if (look.scar) {
    ctx.strokeStyle = 'rgba(150,60,70,0.9)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(hcx + Math.cos(dir + 0.5) * 3.8, hcy + Math.sin(dir + 0.5) * 3.8);
    ctx.lineTo(hcx + Math.cos(dir + 0.2) * 1.2, hcy + Math.sin(dir + 0.2) * 1.2);
    ctx.stroke();
  }
  // кудри: белые светящиеся завитки, шевелятся при ходьбе (число и длина — pawn.look.curls/curlLen)
  drawGlow(ctx, hcx - Math.cos(dir) * 1.5, hcy - Math.sin(dir) * 1.5, 15, '#ffffff', 0.55);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.25;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const N = Number.isFinite(look.curls) ? Math.max(5, Math.min(9, Math.round(look.curls))) + 4 : 11;
  for (let i = 0; i < N; i++) {
    const a = dir + Math.PI * 0.42 + (i / (N - 1)) * Math.PI * 1.16;
    const wob = p.moving ? Math.sin(p.walkPhase * 2.2 + i * 1.3) * 1.1 : Math.sin(t * 2 + i * 1.7) * 0.35;
    const rr = 4.6 + (i % 2) * 1.1 + wob * 0.4;
    const cx = hcx + Math.cos(a) * rr + Math.cos(back) * wob * 0.5;
    const cy = hcy + Math.sin(a) * rr + Math.sin(back) * wob * 0.5;
    curl(ctx, cx, cy, (2.1 + (i % 3) * 0.3) * curlLen, a + t * 0.5 + i);
  }
  // макушка — пара завитков сверху
  curl(ctx, hcx - Math.cos(dir) * 1.8, hcy - Math.sin(dir) * 1.8, 2.3, t * 0.7);
  curl(ctx, hcx - Math.cos(dir) * 0.2 + Math.cos(dir + 1.57) * 2, hcy - Math.sin(dir) * 0.2 + Math.sin(dir + 1.57) * 2, 1.9, -t * 0.6);
  ctx.stroke();
  ctx.restore();
  drawCarry(ctx, p, game, x, y);
}

function drawCarry(ctx, p, game, x, y) {
  if (!p.carry) return;
  const def = game.defs.items.get(p.carry.defId);
  if (!def) return;
  ctx.drawImage(itemSprite(def), x - 9, y - 26, 18, 18);
}

export const pawnDrawer = {
  draw(ctx, p, game, view) {
    const custom = p.drawAs && game.render.defDrawers.get(p.drawAs);
    if (custom?.draw) return custom.draw(ctx, p, game, view);
    if (p.mage && p.isLeader) return drawLeader(ctx, p, game, view);
    if (p.mage) return drawLeader(ctx, p, game, view);
    return drawPawnBody(ctx, p, game, view);
  },
  drawEmissive(ctx, p, game, view, alpha) {
    const x = p.x * TILE;
    const y = p.y * TILE;
    drawGlow(ctx, x, y, 20, p.color || '#ffffff', alpha * 0.35);
    if (p.mage) {
      const dir = p.dir || 0;
      const hx = Math.cos(dir + 1.1) * 8 + Math.cos(dir) * 13;
      const hy = Math.sin(dir + 1.1) * 8 + Math.sin(dir) * 13;
      drawGlow(ctx, x + hx, y + hy, 26, typeof p.look?.crystal === 'string' ? p.look.crystal : '#5ef2ff', alpha * 0.8);
      drawGlow(ctx, x, y, 14, '#ffffff', alpha * 0.5);
    }
  },
};
