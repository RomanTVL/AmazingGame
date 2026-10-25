// Отрисовка боя (только регистрация в register — рисуется в браузере): снаряды, враги и боссы, декали крови,
// постройки обороны, оверлеи пешек (оружие, щит, огонь, лёд, марионетки, безымянные), эффекты (взмахи, взрывы,
// молнии, кольца, телеграфы, нити), HUD маны и слотов, карточки уровня, панель пленных, подсказки, звуки.
import { TILE } from '../../core/constants.js';
import { clamp01, dist } from '../../core/math.js';
import { drawGlow, neonStroke, neonCircle } from '../../render/glow.js';
import { rgba, mix, lighten } from '../../render/color.js';
import { drawPawnBody } from '../../render/pawns.js';
import { roundRect } from '../../engine/ui.js';
import { gearSprite, hasStaff, weaponStats } from './items.js';
import { SPELLS, activeSlots, xpForLevel, chooseUpgrade, cycleSlot, upgradeDef } from './leader.js';
import { FACTIONS } from './enemies.js';
import { AMMO_PER_CRYSTAL } from './defense.js';
import { realNow } from './state.js';

const T = TILE;
const TAU = Math.PI * 2;

// ======================= Звуки и частицы =======================
const O = (wave, freq, freqEnd, dur, vol, extra = {}) => ({ type: 'osc', wave, freq, freqEnd, dur, vol, ...extra });
const N = (dur, vol, filter, extra = {}) => ({ type: 'noise', dur, vol, filter, ...extra });
export const SFX = [
  { id: 'combat:bow', cooldown: 0.04, jitter: 0.15, layers: [N(0.08, 0.25, { type: 'bandpass', freq: 1800, q: 2 }), O('triangle', 320, 140, 0.1, 0.22)] },
  { id: 'combat:crossbow', cooldown: 0.05, jitter: 0.1, layers: [N(0.05, 0.35, { type: 'highpass', freq: 1500 }), O('square', 220, 90, 0.08, 0.15)] },
  { id: 'combat:rune_shot', cooldown: 0.04, jitter: 0.12, layers: [O('sawtooth', 900, 260, 0.14, 0.16, { filter: { type: 'lowpass', freq: 2400 } }), O('sine', 1800, 600, 0.12, 0.08)] },
  { id: 'combat:clash', cooldown: 0.03, jitter: 0.2, layers: [O('square', 1700, 1200, 0.06, 0.16, { filter: { type: 'highpass', freq: 900 } }), N(0.07, 0.3, { type: 'highpass', freq: 3000 }), O('sine', 3100, 3000, 0.22, 0.05, { delay: 0.01 })] },
  { id: 'combat:thud', cooldown: 0.03, jitter: 0.2, layers: [N(0.08, 0.4, { type: 'lowpass', freq: 700 }), O('triangle', 140, 60, 0.12, 0.35)] },
  { id: 'combat:explosion', cooldown: 0.06, jitter: 0.1, layers: [N(0.7, 0.6, { type: 'lowpass', freq: 1600, freqEnd: 180 }), O('sine', 90, 30, 0.6, 0.6)] },
  { id: 'combat:fireball', cooldown: 0.05, layers: [N(0.35, 0.3, { type: 'bandpass', freq: 900, freqEnd: 400, q: 0.8 }, { attack: 0.05 }), O('sawtooth', 160, 90, 0.3, 0.12, { filter: { type: 'lowpass', freq: 900 } })] },
  { id: 'combat:zap', cooldown: 0.04, jitter: 0.1, layers: [O('sawtooth', 2400, 400, 0.18, 0.14, { filter: { type: 'highpass', freq: 500 } }), N(0.15, 0.25, { type: 'highpass', freq: 4000 })] },
  { id: 'combat:ice', cooldown: 0.05, layers: [O('sine', 2600, 1300, 0.4, 0.1), O('triangle', 1900, 2900, 0.35, 0.08, { delay: 0.05 }), N(0.3, 0.15, { type: 'highpass', freq: 5000 })] },
  { id: 'combat:shield', cooldown: 0.1, layers: [O('sine', 440, 880, 0.35, 0.16, { attack: 0.05 }), O('sine', 660, 1320, 0.35, 0.08, { delay: 0.04 })] },
  { id: 'combat:heal', cooldown: 0.1, layers: [O('sine', 523, 784, 0.5, 0.12, { attack: 0.08 }), O('sine', 659, 988, 0.5, 0.08, { delay: 0.1 })] },
  { id: 'combat:blink', cooldown: 0.05, layers: [O('sine', 1400, 300, 0.18, 0.14), N(0.12, 0.2, { type: 'bandpass', freq: 3000, q: 3 })] },
  { id: 'combat:dash', cooldown: 0.05, jitter: 0.1, layers: [N(0.16, 0.28, { type: 'bandpass', freq: 1200, freqEnd: 400, q: 1 })] },
  { id: 'combat:fizzle', cooldown: 0.1, layers: [N(0.35, 0.3, { type: 'highpass', freq: 2500, freqEnd: 6000 }, { attack: 0.02 })] },
  { id: 'combat:levelup', cooldown: 0.5, layers: [O('triangle', 523, 523, 0.18, 0.15), O('triangle', 659, 659, 0.18, 0.15, { delay: 0.12 }), O('triangle', 784, 784, 0.3, 0.15, { delay: 0.24 }), O('sine', 1046, 1046, 0.5, 0.1, { delay: 0.36 })] },
  { id: 'combat:roar', cooldown: 0.8, layers: [N(1.1, 0.5, { type: 'lowpass', freq: 500, freqEnd: 150 }, { attack: 0.1 }), O('sawtooth', 70, 45, 1.0, 0.3, { filter: { type: 'lowpass', freq: 400 } })] },
  { id: 'combat:breath', cooldown: 0.3, layers: [N(0.9, 0.5, { type: 'bandpass', freq: 700, freqEnd: 250, q: 0.7 }, { attack: 0.04 })] },
  { id: 'combat:call', cooldown: 0.4, layers: [O('sawtooth', 220, 330, 0.25, 0.12, { filter: { type: 'lowpass', freq: 1400 } }), O('sawtooth', 330, 440, 0.3, 0.1, { delay: 0.15, filter: { type: 'lowpass', freq: 1600 } })] },
  { id: 'combat:release', cooldown: 0.3, layers: [O('triangle', 440, 220, 0.3, 0.1)] },
  { id: 'combat:spike', cooldown: 0.05, layers: [O('square', 900, 300, 0.08, 0.14), N(0.1, 0.3, { type: 'highpass', freq: 2000 })] },
  { id: 'combat:loot_tink', cooldown: 0.03, layers: [O('sine', 1760, 1760, 0.22, 0.07), O('sine', 2640, 2640, 0.16, 0.035, { delay: 0.01 })] },
];

function registerFx(game) {
  const fxp = game.defs.fxPresets;
  if (!fxp.has('combat:hit_sparks')) {
    fxp.add({
      id: 'combat:hit_sparks',
      emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 7, speed: 5.5, angle: o.angle ?? 0, spread: 0.7, life: 0.28, size: 1.7, color: o.color || '#fff2c8', gravity: 2, drag: 4, glow: true }),
    }, 'combat');
  }
}

// ======================= Снаряды =======================
const PROJ_COLOR = { arrow: '#ffd9a0', bolt: '#ffe6b0', rune: '#5ef2ff', spark: '#9ff8ff', fireball: '#ff9f43', curse: '#c77dff', ice: '#8fd8ff' };

const projectileDrawer = {
  draw(ctx, pr) {
    const x = pr.x * T;
    const y = pr.y * T;
    const a = pr.dir || 0;
    const c = PROJ_COLOR[pr.style] || '#ffffff';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.lineCap = 'round';
    if (pr.style === 'arrow' || pr.style === 'bolt') {
      const L = pr.style === 'bolt' ? 9 : 12;
      ctx.strokeStyle = rgba(c, 0.35);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-L - 8, 0);
      ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.strokeStyle = '#d8b88a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-L, 0);
      ctx.lineTo(2, 0);
      ctx.stroke();
      ctx.fillStyle = '#f2f6ff';
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(0, -2.2);
      ctx.lineTo(0, 2.2);
      ctx.fill();
      ctx.restore();
      drawGlow(ctx, x, y, 8, c, 0.35);
      return;
    }
    if (pr.style === 'fireball') {
      ctx.restore();
      const t = realNow() / 1000;
      drawGlow(ctx, x, y, 22, '#ff7a2a', 0.8);
      drawGlow(ctx, x - Math.cos(a) * 8, y - Math.sin(a) * 8, 14, '#ffb347', 0.5);
      ctx.fillStyle = '#fff2c8';
      ctx.beginPath();
      ctx.arc(x, y, 4 + Math.sin(t * 30) * 0.8, 0, TAU);
      ctx.fill();
      return;
    }
    // руна / искра / проклятие: светящийся сгусток с хвостом
    ctx.strokeStyle = rgba(c, 0.45);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.strokeStyle = lighten(c, 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(2, 0);
    ctx.stroke();
    ctx.restore();
    drawGlow(ctx, x, y, pr.style === 'spark' ? 10 : 14, c, 0.85);
  },
  drawEmissive(ctx, pr, game, view, alpha) {
    drawGlow(ctx, pr.x * T, pr.y * T, pr.style === 'fireball' ? 34 : 16, PROJ_COLOR[pr.style] || '#fff', alpha * 0.8);
  },
};

// ======================= Враги =======================
function drawHumanoidEnemy(ctx, p, game, view, kind) {
  drawPawnBody(ctx, p, game, view);
  if (p.asleep) return;
  const x = p.x * T;
  const y = p.y * T;
  const dir = p.dir || 0;
  const hx = x + Math.cos(dir) * 1.5;
  const hy = y + Math.sin(dir) * 1.5;
  if (kind === 'cultist') {
    // капюшон и светящиеся глаза
    ctx.fillStyle = '#16200f';
    ctx.beginPath();
    ctx.arc(hx - Math.cos(dir) * 0.8, hy - Math.sin(dir) * 0.8, 5.6, dir + Math.PI * 0.35, dir + Math.PI * 1.65);
    ctx.fill();
    ctx.strokeStyle = rgba(p.color, 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const s of [-1, 1]) {
      const ex = hx + Math.cos(dir) * 3 + Math.cos(dir + s * 1.57) * 1.6;
      const ey = hy + Math.sin(dir) * 3 + Math.sin(dir + s * 1.57) * 1.6;
      ctx.fillStyle = '#c3ff6a';
      ctx.fillRect(ex - 0.8, ey - 0.8, 1.6, 1.6);
    }
  } else {
    // повязка на лице разбойника
    ctx.strokeStyle = p.enemyId === 'bandit_chief' ? '#ffd27a' : '#c8283c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, 4, dir - 0.9, dir + 0.9);
    ctx.stroke();
    if (p.enemyId === 'bandit_chief') {
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath();
      ctx.moveTo(hx - Math.cos(dir) * 4, hy - Math.sin(dir) * 4);
      ctx.arc(hx - Math.cos(dir) * 1, hy - Math.sin(dir) * 1, 3, dir + 2, dir + 4.3);
      ctx.fill();
    }
  }
}

function drawSkeleton(ctx, p, game, view) {
  const x = p.x * T;
  const y = p.y * T;
  const dir = p.dir || 0;
  const bob = p.moving ? Math.sin(p.walkPhase * 2) * 1.2 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 9, 4, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y - Math.abs(bob));
  ctx.rotate(dir);
  ctx.strokeStyle = '#e8f4ff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.6;
  // позвоночник и рёбра
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(3, 0);
  for (let i = -4; i <= 1; i += 2.5) {
    ctx.moveTo(i, -5);
    ctx.quadraticCurveTo(i + 1.5, 0, i, 5);
  }
  // руки
  const sw = p.moving ? Math.sin(p.walkPhase * 2) * 2 : 0;
  ctx.moveTo(0, -6);
  ctx.lineTo(4 + sw, -8);
  ctx.moveTo(0, 6);
  ctx.lineTo(4 - sw, 8);
  ctx.stroke();
  ctx.restore();
  // череп
  const hx = x + Math.cos(dir) * 4;
  const hy = y + Math.sin(dir) * 4 - Math.abs(bob);
  ctx.fillStyle = '#eef6ff';
  ctx.beginPath();
  ctx.arc(hx, hy, 4.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#5ef2ff';
  for (const s of [-1, 1]) ctx.fillRect(hx + Math.cos(dir) * 1.5 + Math.cos(dir + s * 1.57) * 1.5 - 0.9, hy + Math.sin(dir) * 1.5 + Math.sin(dir + s * 1.57) * 1.5 - 0.9, 1.8, 1.8);
  drawGlow(ctx, hx, hy, 8, '#5ef2ff', 0.25);
}

function drawGhoul(ctx, p, game, view) {
  drawPawnBody(ctx, { ...p, hairColor: '#1a2a1a' }, game, view);
  const x = p.x * T;
  const y = p.y * T;
  const dir = p.dir || 0;
  ctx.strokeStyle = rgba('#9dffb0', 0.9);
  ctx.lineWidth = 1.2;
  for (const s of [-1, 1]) {
    const a = dir + s * 0.9;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
    ctx.lineTo(x + Math.cos(a - s * 0.3) * 12, y + Math.sin(a - s * 0.3) * 12);
    ctx.stroke();
  }
  if (p.unburied && view.zoom > 0.6) {
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = rgba('#c77dff', 0.9);
    ctx.fillText('✝', x, y - 15);
  }
}

function drawWolf(ctx, p, game, view) {
  const x = p.x * T;
  const y = p.y * T;
  const dir = p.dir || 0;
  const run = p.moving ? Math.sin(p.walkPhase * 3) : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y + 7, 12, 4, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir);
  ctx.fillStyle = '#2a2f2a';
  ctx.strokeStyle = p.color || '#a8b8a0';
  ctx.lineWidth = 1.3;
  // лапы
  ctx.beginPath();
  for (const [lx, ly] of [[5, -4], [5, 4], [-6, -4], [-6, 4]]) {
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + run * 2.5 * (lx > 0 ? 1 : -1), ly * 1.6);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 4.5, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // голова и хвост
  ctx.beginPath();
  ctx.moveTo(9, -3);
  ctx.lineTo(16, 0);
  ctx.lineTo(9, 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.quadraticCurveTo(-15, -3 + run * 2, -18, -1);
  ctx.stroke();
  // гнилые наросты
  ctx.fillStyle = '#b9a6ff';
  ctx.fillRect(-3, -2, 2, 2);
  ctx.fillRect(2, 1, 1.6, 1.6);
  ctx.fillStyle = '#ff4f6d';
  ctx.fillRect(12, -1.6, 1.4, 1.4);
  ctx.restore();
  drawGlow(ctx, x, y, 12, '#b9a6ff', 0.15);
}

function drawTendril(ctx, p, game, view) {
  const x = p.x * T;
  const y = p.y * T;
  const t = view.time + p.id;
  ctx.fillStyle = 'rgba(40,10,60,0.6)';
  ctx.beginPath();
  ctx.ellipse(x, y + 6, 9, 4, 0, 0, TAU);
  ctx.fill();
  neonStroke(ctx, (c) => {
    c.moveTo(x, y + 6);
    for (let i = 1; i <= 6; i++) {
      const k = i / 6;
      c.lineTo(x + Math.sin(t * 2 + k * 4) * 6 * k + Math.cos(p.dir || 0) * k * 6, y + 6 - k * 22);
    }
  }, '#b9a6ff', 2.2, 0.35);
}

function drawDragon(ctx, p, game, view) {
  const x = p.x * T;
  const y = p.y * T;
  const dir = p.dir || 0;
  const t = view.time;
  const flap = Math.sin(t * 3.2) * 0.35;
  const S = 1.9;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + 26, 36, 10, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y - 6);
  ctx.rotate(dir);
  ctx.scale(S, S);
  ctx.strokeStyle = '#e8f4ff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // крылья — костяные «пальцы» с перепонкой
  for (const s of [-1, 1]) {
    ctx.fillStyle = rgba('#7a6cff', 0.3);
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    const wa = s * (1.2 + flap);
    for (let k = 0; k < 4; k++) {
      const a = wa + s * (k * 0.28 - 0.4);
      ctx.lineTo(Math.cos(a) * 28 - k * 3, Math.sin(a) * 28);
    }
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = wa + s * (k * 0.28 - 0.4);
      ctx.moveTo(-2, 0);
      ctx.lineTo(Math.cos(a) * 28 - k * 3, Math.sin(a) * 28);
    }
    ctx.stroke();
  }
  // хребет и хвост
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-10, 0);
  ctx.quadraticCurveTo(-20, Math.sin(t * 2) * 6, -30, Math.sin(t * 2 + 1) * 4);
  ctx.stroke();
  ctx.lineWidth = 1.1;
  for (let i = -8; i <= 8; i += 3) {
    ctx.beginPath();
    ctx.moveTo(i, -4);
    ctx.lineTo(i - 1, 4);
    ctx.stroke();
  }
  // череп
  ctx.fillStyle = '#eef6ff';
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(13, -4);
  ctx.lineTo(11, 0);
  ctx.lineTo(13, 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff9f43';
  ctx.fillRect(15, -2.4, 1.6, 1.6);
  ctx.fillRect(15, 0.8, 1.6, 1.6);
  ctx.restore();
  // уязвимый позвонок — светится после выдоха
  const weak = p.boss?.weakUntil > game.time.tick;
  const vx = x - Math.cos(dir) * 6 * S;
  const vy = y - 6 - Math.sin(dir) * 6 * S;
  drawGlow(ctx, vx, vy, weak ? 22 : 8, weak ? '#ffd27a' : '#9fb8ff', weak ? 0.9 : 0.35);
  if (weak) {
    ctx.fillStyle = '#fff6d0';
    ctx.beginPath();
    ctx.arc(vx, vy, 3, 0, TAU);
    ctx.fill();
  }
  drawGlow(ctx, x, y - 6, 40, '#9fb8ff', 0.12);
}

function drawLich(ctx, p, game, view) {
  const x = p.x * T;
  const y = p.y * T;
  const t = view.time + p.id;
  const fl = Math.sin(t * 2) * 2;
  const clone = p.enemyId === 'lich_clone';
  const a = clone ? 0.55 : 1;
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 9, 10, 4, 0, 0, TAU);
  ctx.fill();
  // мантия
  ctx.fillStyle = '#1a0f2a';
  ctx.strokeStyle = '#c77dff';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - 10, y + 8 + fl * 0.3);
  ctx.quadraticCurveTo(x - 6, y - 8 + fl, x, y - 12 + fl);
  ctx.quadraticCurveTo(x + 6, y - 8 + fl, x + 10, y + 8 + fl * 0.3);
  ctx.quadraticCurveTo(x, y + 4 + fl, x - 10, y + 8 + fl * 0.3);
  ctx.fill();
  ctx.stroke();
  // корона и глаза
  ctx.fillStyle = '#e8f4ff';
  ctx.beginPath();
  ctx.arc(x, y - 12 + fl, 4.5, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#ffd27a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) {
    ctx.moveTo(x + i * 2, y - 16 + fl);
    ctx.lineTo(x + i * 2, y - 19 + fl - (i === 0 ? 2 : 0));
  }
  ctx.stroke();
  ctx.fillStyle = '#ff4fd8';
  ctx.fillRect(x - 2.4, y - 13 + fl, 1.6, 1.6);
  ctx.fillRect(x + 0.8, y - 13 + fl, 1.6, 1.6);
  ctx.globalAlpha = 1;
  drawGlow(ctx, x, y - 6 + fl, 22, '#c77dff', clone ? 0.15 : 0.35);
}

function drawHeart(ctx, p, game, view) {
  const x = p.x * T;
  const y = p.y * T;
  const t = view.time;
  const beat = 1 + Math.max(0, Math.sin(t * 5)) * 0.12;
  const R = 26 * beat;
  // корни-вены
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + Math.sin(t * 0.7 + i) * 0.1;
    neonStroke(ctx, (c) => {
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(a + 0.4) * 30, y + Math.sin(a + 0.4) * 30, x + Math.cos(a) * 54, y + Math.sin(a) * 54);
    }, '#7a4fd0', 1.6, 0.25);
  }
  drawGlow(ctx, x, y, R * 2.2, '#b9a6ff', 0.4);
  ctx.fillStyle = '#2a0c3a';
  ctx.strokeStyle = '#ff4f9a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + R * 0.9);
  ctx.bezierCurveTo(x - R * 1.3, y, x - R * 0.7, y - R * 1.1, x, y - R * 0.4);
  ctx.bezierCurveTo(x + R * 0.7, y - R * 1.1, x + R * 1.3, y, x, y + R * 0.9);
  ctx.fill();
  ctx.stroke();
  drawGlow(ctx, x, y - 2, R * 0.8 * beat, '#ff4f9a', 0.6);
}

const ENEMY_DRAWERS = {
  enemy_bandit: (ctx, p, g, v) => drawHumanoidEnemy(ctx, p, g, v, 'bandit'),
  enemy_cultist: (ctx, p, g, v) => drawHumanoidEnemy(ctx, p, g, v, 'cultist'),
  enemy_skeleton: drawSkeleton,
  enemy_ghoul: drawGhoul,
  enemy_rot_wolf: drawWolf,
  enemy_rot_tendril: drawTendril,
  enemy_bone_dragon: drawDragon,
  enemy_lich: drawLich,
  enemy_rot_heart: drawHeart,
};

function downedWrap(fn) {
  return {
    draw(ctx, p, game, view) {
      if (p.downed && !p.boss) {
        ctx.save();
        ctx.translate(p.x * T, p.y * T);
        ctx.rotate(Math.PI / 2);
        ctx.translate(-p.x * T, -p.y * T);
        ctx.globalAlpha = 0.85;
        fn(ctx, { ...p, moving: false }, game, view);
        ctx.restore();
        return;
      }
      fn(ctx, p, game, view);
    },
    drawEmissive(ctx, p, game, view, alpha) {
      drawGlow(ctx, p.x * T, p.y * T, p.boss ? 50 : 18, p.color || '#ffffff', alpha * (p.boss ? 0.45 : 0.3));
    },
  };
}

// ======================= Декали =======================
const decalDrawers = {
  combat_blood: {
    draw(ctx, d) {
      const x = d.x * T + 16 + (d.ox || 0);
      const y = d.y * T + 16 + (d.oy || 0);
      const r = d.r || 5;
      const al = clamp01(d.alpha ?? 0.5);
      ctx.fillStyle = rgba(d.color || '#b0102e', al * (d.undead ? 0.5 : 0.85));
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.65, d.a || 0, 0, TAU);
      ctx.fill();
      // капли вдоль удара
      for (let i = 1; i <= (d.splat || 0); i++) {
        const k = i * r * 0.55 + 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(d.a || 0) * (r + k), y + Math.sin(d.a || 0) * (r + k), Math.max(0.8, r * 0.3 - i * 0.4), 0, TAU);
        ctx.fill();
      }
      // неоновый блик по краю (стилизация)
      if (!d.undead && al > 0.25) {
        ctx.strokeStyle = rgba('#ff3d6e', al * 0.35);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.65, d.a || 0, 0, TAU);
        ctx.stroke();
      }
    },
  },
  combat_limb: {
    draw(ctx, d) {
      const x = d.x * T + 16 + (d.ox || 0);
      const y = d.y * T + 16 + (d.oy || 0);
      const al = clamp01(d.alpha ?? 0.8);
      ctx.save();
      ctx.globalAlpha = al;
      ctx.translate(x, y);
      ctx.rotate(d.a || 0);
      ctx.fillStyle = rgba(d.blood || '#b0102e', 0.7);
      ctx.beginPath();
      ctx.ellipse(-1, 1, 7, 4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = d.color || '#e9cfb4';
      const head = d.part === 'head';
      if (head) {
        ctx.beginPath();
        ctx.arc(0, 0, 4.2, 0, TAU);
        ctx.fill();
      } else {
        roundRect(ctx, -6, -1.8, 11, 3.6, 1.8);
        ctx.fill();
        ctx.fillStyle = '#ff3d6e';
        ctx.fillRect(-6.5, -1.6, 1.4, 3.2);
      }
      ctx.restore();
    },
  },
};

// ======================= Постройки обороны =======================
export const BUILDING_DRAWERS = {
  rune_turret: {
    draw(ctx, e, game, view) {
      const x = e.x * T + 16;
      const y = e.y * T + 16;
      ctx.fillStyle = '#121a2c';
      ctx.strokeStyle = e.faded ? '#7a7f8c' : '#5ef2ff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + Math.PI / 6;
        ctx.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const a = e.aim ?? -Math.PI / 2;
      ctx.strokeStyle = '#bffaff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14);
      ctx.stroke();
      const def = game.defs.buildings.get(e.defId);
      const k = clamp01((e.ammo || 0) / (def?.turret?.ammoMax || 60));
      drawGlow(ctx, x, y, 12, e.ammo > 0 ? '#5ef2ff' : '#ff5f6d', 0.35 + 0.3 * Math.sin(view.time * 3));
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x - 12, y + 14, 24, 2.5);
      ctx.fillStyle = k > 0.25 ? '#5ef2ff' : '#ff5f6d';
      ctx.fillRect(x - 12, y + 14, 24 * k, 2.5);
    },
    drawEmissive(ctx, e, game, view, alpha) {
      drawGlow(ctx, e.x * T + 16, e.y * T + 16, 26, '#5ef2ff', alpha * 0.6);
    },
  },
  spike_trap: {
    draw(ctx, e, game) {
      const x = e.x * T;
      const y = e.y * T;
      const armed = !(e.armedAt > game.time.tick);
      ctx.fillStyle = 'rgba(30,26,40,0.7)';
      ctx.fillRect(x + 4, y + 4, 24, 24);
      ctx.strokeStyle = armed ? rgba('#c9b8ff', 0.7) : rgba('#8c93b8', 0.4);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 4.5, y + 4.5, 23, 23);
      ctx.fillStyle = armed ? '#dfe6f5' : '#5a6070';
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          const cx = x + 9 + i * 7;
          const cy = y + 9 + j * 7;
          ctx.beginPath();
          ctx.moveTo(cx, cy - (armed ? 3 : 1.5));
          ctx.lineTo(cx + 2, cy + 2);
          ctx.lineTo(cx - 2, cy + 2);
          ctx.fill();
        }
    },
  },
  fire_trap: {
    draw(ctx, e, game, view) {
      const x = e.x * T + 16;
      const y = e.y * T + 16;
      const armed = !(e.armedAt > game.time.tick);
      ctx.fillStyle = 'rgba(40,20,10,0.75)';
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = armed ? '#ff9f43' : '#6a5040';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + view.time * 0.5;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
      }
      ctx.stroke();
      if (armed) drawGlow(ctx, x, y, 10, '#ff9f43', 0.3);
    },
  },
  prisoner_bed: {
    draw(ctx, e, game) {
      const x = e.x * T;
      const y = e.y * T;
      ctx.fillStyle = '#2a2016';
      ctx.fillRect(x + 3, y + 2, 26, 28);
      ctx.fillStyle = '#5a4a3a';
      ctx.fillRect(x + 5, y + 4, 22, 9);
      ctx.strokeStyle = e.faded ? '#7a7f8c' : '#ffb347';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x + 3.5, y + 2.5, 25, 27);
      // решётка-изголовье
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        ctx.moveTo(x + 6 + i * 5, y + 2);
        ctx.lineTo(x + 6 + i * 5, y + 30);
      }
      ctx.globalAlpha = 0.35;
      ctx.stroke();
      ctx.globalAlpha = 1;
      void game;
    },
  },
};

// ======================= Оверлеи пешек =======================
function drawHeldWeapon(ctx, p, game) {
  const id = p.equipment?.weapon;
  if (!id || id === 'conductor_staff' || p.asleep || p.downed) return;
  if (p.mage) return;
  const ed = p.enemyId && game.defs.enemies.get(p.enemyId);
  if (ed && !ed.humanoid) return;
  const x = p.x * T;
  const y = p.y * T;
  const dir = p.dir || 0;
  const hx = x + Math.cos(dir + 1.2) * 8;
  const hy = y + Math.sin(dir + 1.2) * 8;
  const c = game.defs.items.get(id)?.color || '#cccccc';
  ctx.lineCap = 'round';
  const fx = Math.cos(dir);
  const fy = Math.sin(dir);
  const line = (a, b, w, col) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(hx + fx * a, hy + fy * a);
    ctx.lineTo(hx + fx * b, hy + fy * b);
    ctx.stroke();
  };
  switch (id) {
    case 'bow':
    case 'crossbow':
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(hx + fx * 2, hy + fy * 2, 7, dir - 1.2, dir + 1.2);
      ctx.stroke();
      if (id === 'crossbow') line(-4, 6, 2.2, '#7a5030');
      break;
    case 'spear':
      line(-8, 14, 1.6, '#d9b77a');
      line(14, 18, 2.4, '#e8f6ff');
      break;
    case 'rune_rifle':
      line(-4, 12, 3, '#2a3550');
      line(-4, 12, 1, c);
      break;
    case 'rune_staff':
      line(-8, 13, 2, '#6b4a2e');
      drawGlow(ctx, hx + fx * 13, hy + fy * 13, 8, c, 0.8);
      break;
    case 'axe':
      line(-2, 10, 2, '#7a5030');
      line(8, 11, 4, c);
      break;
    case 'club':
      line(-2, 9, 3.2, c);
      break;
    case 'knife':
      line(0, 6, 1.6, '#e8f6ff');
      break;
    default:
      line(0, 10, 1.8, '#e8f6ff');
  }
}

function pawnOverlay(C) {
  return {
    id: 'combat:pawn',
    order: 40,
    draw(ctx, p, view, game) {
      const x = p.x * T;
      const y = p.y * T;
      const now = game.time.tick;
      drawHeldWeapon(ctx, p, game);
      if (p._flashUntil > C.R.clock) {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, x, y, 18, '#ffffff', 0.9);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (p.shield && p.shield.untilTick > now) {
        const k = clamp01(p.shield.hp / (p.shield.max || 50));
        neonCircle(ctx, x, y, 14 + Math.sin(view.time * 4) * 0.8, '#b77dff', 1.2, rgba('#b77dff', 0.08 + 0.1 * k), 0.3);
      }
      if (p.frozenUntil > now) {
        ctx.fillStyle = rgba('#bfe8ff', 0.35);
        ctx.strokeStyle = '#e8f8ff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          ctx.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.chill) drawGlow(ctx, x, y, 14, '#8fd8ff', 0.35);
      if (p.burnUntil > now) {
        const t = view.time * 8 + p.id;
        for (let i = 0; i < 3; i++) drawGlow(ctx, x + Math.sin(t + i * 2) * 5, y - 6 - ((t * 2 + i * 5) % 9), 7, '#ff9f43', 0.7);
      }
      if (p.puppet) {
        ctx.strokeStyle = rgba('#ff7ae0', 0.8);
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (p.nameless && view.zoom > 0.5) {
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = rgba('#b9a6ff', 0.6 + 0.3 * Math.sin(view.time * 3));
        ctx.fillText('???', x, y - 18);
      }
      if (p.prisoner && view.zoom > 0.5) {
        ctx.strokeStyle = '#ffb347';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x - 3, y + 12, 2.2, 0, TAU);
        ctx.arc(x + 3, y + 12, 2.2, 0, TAU);
        ctx.stroke();
      }
      // полоска здоровья: враги в бою и раненые
      const h = p.health;
      if (h && !p.prisoner && (p.faction === 'enemy' || C.R.hostiles) && h.hp < (h.maxHp ?? 100) && !p.boss) {
        const k = clamp01(h.hp / (h.maxHp || 100));
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x - 11, y - 19, 22, 3);
        ctx.fillStyle = p.faction === 'enemy' ? '#ff5f6d' : '#7dff6a';
        ctx.fillRect(x - 11, y - 19, 22 * k, 3);
      }
      if (p.id === C.R.leaderTargetId || p.id === C.R.hoverEnemyId) {
        const sel = p.id === C.R.leaderTargetId;
        const r = (p.boss ? 30 : 15) + Math.sin(view.time * 6) * 1.2;
        ctx.strokeStyle = sel ? '#ff4f4f' : rgba('#ff4f4f', 0.5);
        ctx.lineWidth = sel ? 1.6 : 1;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + view.time * (sel ? 1.5 : 0.5);
          ctx.beginPath();
          ctx.arc(x, y, r, a, a + 0.9);
          ctx.stroke();
        }
      }
    },
  };
}

// ======================= Эффекты =======================
function vfxLayer(C) {
  return {
    id: 'combat:vfx',
    order: 94,
    draw(ctx, game, view) {
      const R = C.R;
      const now = R.clock;
      // нити Лича
      for (const t of C.S.threads) {
        const a = game.entities.get(t.lichId);
        const b = game.entities.get(t.pawnId);
        if (!a || !b) continue;
        const mx = ((a.x + b.x) / 2) * T;
        const my = ((a.y + b.y) / 2) * T;
        neonStroke(ctx, (c) => {
          c.moveTo(a.x * T, a.y * T - 10);
          c.quadraticCurveTo(mx + Math.sin(now * 2) * 10, my - 18, b.x * T, b.y * T - 8);
        }, '#ff7ae0', 1, 0.3);
        drawGlow(ctx, mx, my - 9, 10, '#ff7ae0', 0.5 + 0.3 * Math.sin(now * 5));
      }
      // телеграф серого пламени
      for (const p of R.enemies) {
        const br = p.boss?.breath;
        if (!br) continue;
        const left = (br.fireAt - game.time.tick) / 78;
        const x0 = br.x0 * T;
        const y0 = br.y0 * T;
        const x1 = (br.x0 + Math.cos(br.ang) * br.len) * T;
        const y1 = (br.y0 + Math.sin(br.ang) * br.len) * T;
        ctx.strokeStyle = rgba('#d8dce8', 0.15 + 0.25 * (1 - left));
        ctx.lineWidth = T * 2.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.setLineDash([8, 8]);
        ctx.strokeStyle = rgba('#ffffff', 0.7);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // проклятые постройки
      if (C.R.enemies.some((p) => p.boss?.cursed?.length)) {
        for (const p of R.enemies) for (const id of p.boss?.cursed || []) {
          const b = game.entities.get(id);
          if (!b || !(b.cursedUntil > game.time.tick)) continue;
          drawGlow(ctx, (b.x + (b.w || 1) / 2) * T, (b.y + (b.h || 1) / 2) * T, 20, '#c77dff', 0.35 + 0.2 * Math.sin(now * 4 + id));
        }
      }
      // горящие постройки
      if (R.burningIds?.size) for (const id of R.burningIds) {
        const b = game.entities.get(id);
        if (!b) continue;
        for (let i = 0; i < 3; i++) drawGlow(ctx, (b.x + 0.5) * T + Math.sin(now * 7 + i * 2) * 6, (b.y + 0.5) * T - ((now * 30 + i * 9) % 18), 12, '#ff7a2a', 0.6);
      }
      // одноразовые эффекты
      const list = R.vfx;
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        const age = now - v.born;
        const life = VFX_LIFE[v.type] ?? 0.4;
        if (age > life + (v.delay || 0)) continue;
        list[w++] = v;
        try {
          drawVfx(ctx, game, C, v, age, life, view);
        } catch (err) {
          game.error(err, `combat.vfx:${v.type}`);
        }
      }
      list.length = w;
    },
  };
}

const VFX_LIFE = { slash: 0.18, explosion: 0.45, frost: 0.5, chain: 0.25, voice_ring: 0.7, spark: 0.2, ward_hit: 0.3, shield_hit: 0.25, shield_cast: 0.5, heal: 0.7, blink: 0.35, dash: 0.25, puff: 0.6, levelup: 1.2, loot: 0.7, float: 1.0, breath: 0.7, summon: 0.6, thread_cut: 0.5, curse: 0.6, spikes: 0.4 };

function drawVfx(ctx, game, C, v, age, life, view) {
  const k = clamp01(age / life);
  const fade = 1 - k;
  const P = (q) => q * T;
  switch (v.type) {
    case 'slash': {
      const r = P(v.r || 1.4);
      const a0 = v.a - 1 + k * 0.4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(v.color || '#e8f6ff', 0.9 * fade);
      ctx.lineWidth = 3 * fade + 0.5;
      ctx.beginPath();
      ctx.arc(P(v.x), P(v.y), r, a0, a0 + 2 * Math.min(1, k * 3));
      ctx.stroke();
      break;
    }
    case 'explosion':
      drawGlow(ctx, P(v.x), P(v.y), P(v.r || 2) * (0.6 + k), v.color || '#ff9f43', fade);
      neonCircle(ctx, P(v.x), P(v.y), P(v.r || 2) * (0.3 + k * 0.8), v.color || '#ff9f43', 2 * fade + 0.3, null, 0.4 * fade);
      break;
    case 'frost':
      neonCircle(ctx, P(v.x), P(v.y), P(v.r || 3) * (0.3 + k * 0.7), '#bfe8ff', 2 * fade + 0.4, rgba('#8fd8ff', 0.12 * fade), 0.4);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        const rr = P(v.r || 3) * (0.3 + k * 0.7);
        ctx.fillStyle = rgba('#e8f8ff', fade);
        ctx.fillRect(P(v.x) + Math.cos(a) * rr - 1.5, P(v.y) + Math.sin(a) * rr - 1.5, 3, 3);
      }
      break;
    case 'chain': {
      const pts = v.pts || [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        neonStroke(ctx, (c) => {
          c.moveTo(P(a.x), P(a.y));
          const n = 5;
          for (let j = 1; j < n; j++) {
            const t = j / n;
            c.lineTo(P(a.x + (b.x - a.x) * t) + (Math.random() - 0.5) * 10, P(a.y + (b.y - a.y) * t) + (Math.random() - 0.5) * 10);
          }
          c.lineTo(P(b.x), P(b.y));
        }, '#bfe8ff', 1.6 * fade + 0.4, 0.5);
        drawGlow(ctx, P(b.x), P(b.y), 16, '#bfe8ff', fade);
      }
      break;
    }
    case 'voice_ring': {
      const L = v.targetId ? game.entities.get(v.targetId) : null;
      const x = L ? L.x : v.x;
      const y = L ? L.y : v.y;
      neonCircle(ctx, P(x), P(y), P(v.r || 12) * Math.min(1, k * 1.6), v.color || '#ff4f4f', 1.6, null, 0.4 * fade);
      break;
    }
    case 'spark':
    case 'ward_hit':
      drawGlow(ctx, P(v.x), P(v.y), 10, v.color || '#5ef2ff', fade);
      break;
    case 'shield_hit': {
      const e = game.entities.get(v.targetId);
      if (e) neonCircle(ctx, P(e.x), P(e.y), 15, '#e2c8ff', 2 * fade, null, 0.6 * fade);
      break;
    }
    case 'shield_cast':
      neonCircle(ctx, P(v.x), P(v.y), P(3.2) * k, '#b77dff', 2 * fade, rgba('#b77dff', 0.1 * fade), 0.4);
      break;
    case 'heal': {
      const e = game.entities.get(v.targetId);
      const x = P(e ? e.x : v.x);
      const y = P(e ? e.y : v.y);
      drawGlow(ctx, x, y - k * 10, 24, '#7dff9a', fade);
      ctx.fillStyle = rgba('#e8ffe8', fade);
      ctx.fillRect(x - 1.5, y - 14 - k * 12, 3, 9);
      ctx.fillRect(x - 4.5, y - 11 - k * 12, 9, 3);
      break;
    }
    case 'blink':
      drawGlow(ctx, P(v.x), P(v.y), 22 * fade, '#e2c8ff', fade);
      drawGlow(ctx, P(v.x2), P(v.y2), 22 * k + 6, '#e2c8ff', fade);
      ctx.strokeStyle = rgba('#e2c8ff', 0.5 * fade);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(P(v.x), P(v.y));
      ctx.lineTo(P(v.x2), P(v.y2));
      ctx.stroke();
      break;
    case 'dash':
      for (let i = 0; i < 4; i++) drawGlow(ctx, P(v.x) + Math.cos(v.a) * i * 10, P(v.y) + Math.sin(v.a) * i * 10, 10, '#c9b8ff', fade * (1 - i * 0.2));
      break;
    case 'puff':
      ctx.fillStyle = rgba('#8c93b8', 0.5 * fade);
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(P(v.x) + Math.cos(i * 1.3) * k * 12, P(v.y) - k * 10 + Math.sin(i * 1.7) * k * 6, 3 + k * 4, 0, TAU);
        ctx.fill();
      }
      break;
    case 'levelup': {
      const e = game.entities.get(v.targetId);
      const x = P(e ? e.x : v.x);
      const y = P(e ? e.y : v.y);
      neonCircle(ctx, x, y, 10 + k * 30, '#ffd27a', 2 * fade, null, 0.5 * fade);
      drawGlow(ctx, x, y - k * 20, 30, '#ffd27a', fade);
      break;
    }
    case 'loot': {
      const tgt = game.entities.get(v.targetId);
      const t = clamp01((age - (v.delay || 0)) / 0.5);
      if (age < (v.delay || 0) || !tgt) break;
      const x = v.x0 + (tgt.x - v.x0) * t;
      const y = v.y0 + (tgt.y - v.y0) * t - Math.sin(t * Math.PI) * 1.5;
      const spr = gearSprite(game, v.defId);
      if (spr) ctx.drawImage(spr, P(x) - 10, P(y) - 10, 20, 20);
      else drawGlow(ctx, P(x), P(y), 8, '#ffd27a', 1);
      drawGlow(ctx, P(x), P(y), 10, '#ffd27a', 0.6 * (1 - t));
      if (t >= 1 && !v.tinked) {
        v.tinked = true;
        C.playTink();
      }
      break;
    }
    case 'float': {
      ctx.font = `700 ${v.big ? 15 : 11}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = rgba(v.color || '#ffffff', fade);
      ctx.fillText(v.text, P(v.x), P(v.y) - k * 18);
      break;
    }
    case 'breath': {
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba('#b8bcc8', 0.7 * fade);
      ctx.lineWidth = T * 2.2 * (0.6 + k * 0.6);
      ctx.beginPath();
      ctx.moveTo(P(v.x0), P(v.y0));
      ctx.lineTo(P(v.x1), P(v.y1));
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.6 * fade);
      ctx.lineWidth = 3;
      ctx.stroke();
      break;
    }
    case 'summon':
      drawGlow(ctx, P(v.x), P(v.y), 20 * (1 - k * 0.5), v.color || '#e8f4ff', fade);
      neonCircle(ctx, P(v.x), P(v.y), 6 + k * 12, v.color || '#e8f4ff', 1.2, null, 0.4 * fade);
      break;
    case 'thread_cut':
      drawGlow(ctx, P(v.x), P(v.y), 24 * fade + 4, '#ff7ae0', fade);
      break;
    case 'curse':
      drawGlow(ctx, P(v.x), P(v.y), 26, '#c77dff', fade);
      break;
    case 'spikes':
      drawGlow(ctx, P(v.x), P(v.y), 14, '#dfe6f5', fade);
      break;
    default:
  }
  void view;
}

/** Мрак вокруг Сердца Гнили (под светом, поверх мира). */
function heartDarkLayer(C) {
  return {
    id: 'combat:rot-dark',
    order: 86,
    draw(ctx, game, view) {
      const h = C.R.heartId && game.entities.get(C.R.heartId);
      if (!h) return;
      const x = h.x * T;
      const y = h.y * T;
      const r = T * 16;
      const g = ctx.createRadialGradient(x, y, T * 2, x, y, r);
      g.addColorStop(0, 'rgba(20,0,30,0.55)');
      g.addColorStop(1, 'rgba(20,0,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      void view;
    },
  };
}

// ======================= HUD =======================
const GLYPH = {
  spark(ctx, x, y, c) {
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 6);
    ctx.lineTo(x + 1, y - 1);
    ctx.lineTo(x - 1, y + 1);
    ctx.lineTo(x + 6, y - 6);
    ctx.strokeStyle = c;
    ctx.stroke();
  },
  fire(ctx, x, y, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.quadraticCurveTo(x + 8, y, x, y + 7);
    ctx.quadraticCurveTo(x - 8, y, x, y - 8);
    ctx.fill();
    ctx.fillStyle = '#fff2c8';
    ctx.beginPath();
    ctx.arc(x, y + 2, 2.5, 0, TAU);
    ctx.fill();
  },
  bolt(ctx, x, y, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 3, y - 8);
    ctx.lineTo(x - 3, y);
    ctx.lineTo(x + 3, y);
    ctx.lineTo(x - 3, y + 8);
    ctx.stroke();
  },
  ice(ctx, x, y, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      ctx.moveTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
      ctx.lineTo(x - Math.cos(a) * 8, y - Math.sin(a) * 8);
    }
    ctx.stroke();
  },
  shield(ctx, x, y, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 7, y - 5);
    ctx.quadraticCurveTo(x + 6, y + 5, x, y + 8);
    ctx.quadraticCurveTo(x - 6, y + 5, x - 7, y - 5);
    ctx.closePath();
    ctx.stroke();
  },
  heal(ctx, x, y, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x - 2, y - 7, 4, 14);
    ctx.fillRect(x - 7, y - 2, 14, 4);
  },
  blink(ctx, x, y, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x - 3, y, 4, 0, TAU);
    ctx.moveTo(x + 8, y);
    ctx.arc(x + 5, y, 3, 0, TAU);
    ctx.stroke();
  },
  voice(ctx, x, y, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 3);
    ctx.lineTo(x - 3, y - 3);
    ctx.lineTo(x + 2, y - 7);
    ctx.lineTo(x + 2, y + 7);
    ctx.lineTo(x - 3, y + 3);
    ctx.lineTo(x - 7, y + 3);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 3, y, 6, -0.8, 0.8);
    ctx.stroke();
  },
  ward(ctx, x, y, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(x - 7, y - 4, 14, 8);
    ctx.beginPath();
    ctx.arc(x, y, 9, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  },
};

function drawSpellIcon(ctx, id, x, y, dim) {
  const s = SPELLS[id];
  if (!s) return;
  const c = dim ? mix(s.color, '#30364a', 0.6) : s.color;
  if (!dim) drawGlow(ctx, x, y, 18, s.color, 0.45);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.8;
  (GLYPH[s.glyph] || GLYPH.spark)(ctx, x, y, c);
}

function registerHud(game, C) {
  const ui = game.ui;
  ui.registerHud({
    id: 'combat:spells',
    slot: 'bottom-center',
    order: 5,
    height: (g) => {
      const L = g.getLeader();
      return L && L.controlled === 'player' && L.mana ? 76 : 0;
    },
    draw(ctx, g, ui2, box) {
      const L = g.getLeader();
      if (!L?.mana) return 0;
      const { slots, mode } = activeSlots(g, L);
      const pk = L.perks || {};
      const now = g.time.tick;
      const S = 46;
      const gap = 8;
      const w = S * 4 + gap * 3 + 24;
      const x0 = box.x - w / 2;
      const y0 = box.y;
      ui2.panel(x0, y0, w, 76, { accent: '#9b6cff' });
      // мана
      const mk = clamp01(L.mana.cur / (L.mana.max || 1));
      ui2.bar(x0 + 12, y0 + 8, w - 24, 5, mk, '#5ef2ff');
      ui2.text(`${Math.floor(L.mana.cur)}/${L.mana.max}`, x0 + w - 12, y0 + 14, { size: 9, align: 'right', color: '#8fe8ff' });
      // опыт
      const lvl = pk.level || 1;
      ui2.bar(x0 + 12, y0 + 70, w - 24, 2, clamp01((pk.xp || 0) / xpForLevel(lvl)), '#ffd27a');
      ui2.text(g.t('combat.hud.level', { n: lvl }), x0 + 12, y0 + 14, { size: 9, color: '#ffd27a' });
      for (let i = 0; i < 4; i++) {
        const id = slots[i];
        const sx = x0 + 12 + i * (S + gap);
        const sy = y0 + 22;
        const def = id && SPELLS[id];
        const cd = id ? Math.max(0, (pk.cd?.[id] || 0) - now) : 0;
        const noMana = def && L.mana.cur < def.mana;
        ctx.fillStyle = 'rgba(16,14,32,0.9)';
        roundRect(ctx, sx, sy, S, S - 2, 6);
        ctx.fill();
        ctx.strokeStyle = def ? rgba(def.color, cd || noMana ? 0.35 : 0.9) : 'rgba(108,92,255,0.25)';
        ctx.lineWidth = 1.2;
        roundRect(ctx, sx + 0.5, sy + 0.5, S - 1, S - 3, 6);
        ctx.stroke();
        if (def) {
          drawSpellIcon(ctx, id, sx + S / 2, sy + S / 2 - 2, cd > 0 || noMana);
          if (cd > 0) {
            const tot = Math.max(1, def.cd * 60);
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.beginPath();
            ctx.moveTo(sx + S / 2, sy + S / 2);
            ctx.arc(sx + S / 2, sy + S / 2, S / 2 - 3, -Math.PI / 2, -Math.PI / 2 + TAU * (cd / tot));
            ctx.fill();
          }
        }
        ui2.text(String(i + 1), sx + 4, sy + 2, { size: 9, color: '#8c93b8' });
        if (def) ui2.text(String(def.mana), sx + S - 4, sy + S - 13, { size: 9, align: 'right', color: noMana ? '#ff5f6d' : '#8fe8ff' });
        if (ui2.mouseIn(sx, sy, S, S)) {
          const lines = def ? [{ text: g.t(`combat.spell.${id}.name`), bold: true, color: def.color }, g.t(`combat.spell.${id}.desc`), g.t('combat.hud.cost', { mana: def.mana, cd: def.cd })] : [g.t('combat.spell.empty')];
          if (mode === 'full' && (pk.known?.length || 0) > 4) lines.push({ text: g.t('combat.hud.cycle'), color: '#8c93b8' });
          ui2.tooltip(lines);
          if (mode === 'full' && ui2.clicked(sx, sy, S, S)) cycleSlot(g, L, i);
        }
      }
      if (mode !== 'full') ui2.text(g.t(mode === 'nostaff' ? 'combat.hud.noStaff' : 'combat.hud.apprentice'), box.x, y0 + 14, { size: 9, align: 'center', color: '#ffb347' });
      // новый уровень — кнопка карточек
      if (pk.cards?.length) {
        const bw = 180;
        if (ui2.button(box.x - bw / 2, y0 - 34, bw, 24, g.t('combat.hud.levelReady'), { active: true })) ui2.openPanel('combat_levelup');
      }
      return 76;
    },
  }, 'combat');

  // индикатор рейда и призыва
  ui.registerHud({
    id: 'combat:raid',
    slot: 'top-center',
    order: 60,
    visible: (g) => C.S.raids.length > 0 || C.R.colony.some((p) => p.drafted),
    draw(ctx, g, ui2, box) {
      const parts = [];
      for (const r of C.S.raids) {
        if (r.kind === 'boss') continue; // у босса — своя полоса с именем
        let alive = 0;
        for (const id of r.pawnIds) {
          const p = g.entities.get(id);
          if (p && !p.dead && !p.downed && p.faction === 'enemy') alive++;
        }
        const f = FACTIONS[r.faction];
        parts.push({ text: g.t(r.kind === 'boss' ? 'combat.hud.boss' : 'combat.hud.raid', { faction: g.t(f?.nameKey || 'combat.faction.bandits'), n: alive }), color: f?.color || '#ff5f6d' });
      }
      const dr = C.R.colony.filter((p) => p.drafted).length;
      if (dr) parts.push({ text: g.t('combat.hud.drafted', { n: dr }), color: '#ff4f4f' });
      if (!parts.length) return 0;
      let y = box.y;
      for (const pt of parts) {
        const w = ui2.measure(pt.text, 12, true) + 28;
        ctx.fillStyle = 'rgba(30,6,14,0.85)';
        roundRect(ctx, box.x - w / 2, y, w, 22, 11);
        ctx.fill();
        ctx.strokeStyle = rgba(pt.color, 0.8);
        ctx.lineWidth = 1;
        roundRect(ctx, box.x - w / 2 + 0.5, y + 0.5, w - 1, 21, 11);
        ctx.stroke();
        ui2.text(pt.text, box.x, y + 11, { size: 12, bold: true, align: 'center', baseline: 'middle', color: pt.color });
        y += 26;
      }
      // боссы — полоса здоровья
      for (const r of C.S.raids) {
        if (r.kind !== 'boss') continue;
        const b = g.entities.get(r.bossId);
        if (!b || b.dead) continue;
        const w = 360;
        const k = clamp01((b.health?.hp ?? 0) / (b.health?.maxHp || 1));
        ui2.text(g.t(`combat.enemy.${b.enemyId}`), box.x, y + 2, { size: 13, bold: true, align: 'center', color: '#ffd27a', glow: 6 });
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(box.x - w / 2, y + 20, w, 7);
        ctx.fillStyle = '#ff4f9a';
        ctx.fillRect(box.x - w / 2, y + 20, w * k, 7);
        ctx.strokeStyle = 'rgba(255,79,154,0.7)';
        ctx.strokeRect(box.x - w / 2 + 0.5, y + 20.5, w - 1, 6);
        y += 32;
      }
      return y - box.y;
    },
  }, 'combat');
}

// ======================= Панели =======================
function registerPanels(game, C) {
  game.ui.registerPanel({
    id: 'combat_levelup',
    title: 'combat.panel.levelup',
    width: 760,
    height: 330,
    anchor: 'center',
    draw(ctx, g, ui, r) {
      const L = g.getLeader();
      const cards = L?.perks?.cards;
      if (!cards?.length) {
        ui.text(g.t('combat.panel.noCards'), r.x, r.y, { color: '#8c93b8' });
        return;
      }
      ui.text(g.t('combat.panel.choose', { level: L.perks.level }), r.x, r.y, { size: 13, color: '#e8ecff' });
      const cw = (r.w - 24) / 3;
      const BR = { flame: '#ff9f43', road: '#5ef2ff', voice: '#ffd27a' };
      for (let i = 0; i < cards.length; i++) {
        const id = cards[i];
        const u = upgradeDef(id);
        if (!u) continue;
        const x = r.x + i * (cw + 12);
        const y = r.y + 26;
        const h = r.h - 30;
        const c = BR[u.branch];
        const hover = ui.mouseIn(x, y, cw, h);
        ctx.fillStyle = hover ? 'rgba(40,30,70,0.95)' : 'rgba(16,14,32,0.95)';
        roundRect(ctx, x, y, cw, h, 10);
        ctx.fill();
        ctx.strokeStyle = rgba(c, hover ? 1 : 0.6);
        ctx.lineWidth = hover ? 2 : 1.2;
        roundRect(ctx, x + 0.5, y + 0.5, cw - 1, h - 1, 10);
        ctx.stroke();
        drawGlow(ctx, x + cw / 2, y + 52, 40, c, hover ? 0.5 : 0.3);
        if (u.learn) drawSpellIcon(ctx, u.learn, x + cw / 2, y + 52, false);
        else {
          ctx.strokeStyle = c;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + cw / 2, y + 38);
          ctx.lineTo(x + cw / 2, y + 66);
          ctx.moveTo(x + cw / 2 - 14, y + 52);
          ctx.lineTo(x + cw / 2 + 14, y + 52);
          ctx.stroke();
        }
        ui.text(g.t(`combat.branch.${u.branch}`), x + cw / 2, y + 12, { size: 10, align: 'center', color: c });
        ui.text(g.t(`combat.upg.${id}.name`), x + cw / 2, y + 92, { size: 15, bold: true, align: 'center', color: '#ffffff', glow: 6, glowColor: c });
        const desc = g.t(`combat.upg.${id}.desc`);
        wrap(ui, desc, x + 14, y + 120, cw - 28, 12, '#c8cde8');
        const lvl = L.perks.upgrades?.[id] || 0;
        if (u.max > 1) ui.text(g.t('combat.panel.rank', { n: lvl, max: u.max }), x + cw / 2, y + h - 22, { size: 10, align: 'center', color: '#8c93b8' });
        if (ui.clicked(x, y, cw, h)) {
          chooseUpgrade(g, C, L, i);
          g.audio.play('ui_click');
          if (!L.perks.cards?.length) ui.closePanel('combat_levelup');
        }
      }
    },
  }, 'combat');

  game.ui.registerPanel({
    id: 'combat_prisoners',
    title: 'combat.panel.prisoners',
    width: 420,
    height: 420,
    anchor: 'right',
    draw(ctx, g, ui, r) {
      const list = g.entities.listKind('pawn').filter((p) => p.prisoner && !p.dead);
      if (!list.length) {
        ui.text(g.t('combat.panel.noPrisoners'), r.x, r.y, { color: '#8c93b8' });
        return;
      }
      let y = r.y;
      for (const p of list) {
        const sel = C.R.prisonerSel === p.id;
        ctx.fillStyle = sel ? 'rgba(255,179,71,0.12)' : 'rgba(255,255,255,0.03)';
        ctx.fillRect(r.x, y, r.w, 84);
        ui.text(p.name, r.x + 8, y + 6, { size: 13, bold: true, color: '#ffb347' });
        const ed = g.defs.enemies.get(p.enemyId);
        const fac = FACTIONS[p.prisoner.origFaction];
        ui.text(`${ed ? g.t(ed.nameKey) : ''} · ${fac ? g.t(fac.nameKey) : ''}`, r.x + 8, y + 24, { size: 10, color: '#8c93b8' });
        ui.text(g.t('combat.panel.resist', { n: Math.round(p.prisoner.resist) }), r.x + r.w - 8, y + 8, { size: 10, align: 'right', color: '#c8cde8' });
        if (!p.prisoner.bedId) ui.text(g.t('combat.panel.noBed'), r.x + r.w - 8, y + 24, { size: 10, align: 'right', color: '#ff5f6d' });
        const bw = (r.w - 24) / 4;
        const by = y + 46;
        const m = p.prisoner.mode;
        if (ui.button(r.x + 4, by, bw, 26, g.t('combat.prison.hold'), { active: m === 'hold' })) C.setPrisonerMode(p, 'hold');
        if (ui.button(r.x + 8 + bw, by, bw, 26, g.t('combat.prison.recruit'), { active: m === 'recruit' })) C.setPrisonerMode(p, 'recruit');
        if (ui.button(r.x + 12 + bw * 2, by, bw, 26, g.t('combat.prison.release'))) C.setPrisonerMode(p, 'release');
        const confirm = C.R.execConfirm === p.id;
        if (ui.button(r.x + 16 + bw * 3, by, bw, 26, g.t(confirm ? 'combat.prison.executeSure' : 'combat.prison.execute'), { tooltip: g.t('combat.prison.executeWarn') })) {
          if (confirm) {
            C.R.execConfirm = 0;
            C.setPrisonerMode(p, 'execute');
          } else C.R.execConfirm = p.id;
        }
        y += 92;
        if (y > r.y + r.h - 80) break;
      }
    },
    onClose() {
      C.R.execConfirm = 0;
    },
  }, 'combat');
}

function wrap(ui, text, x, y, w, size, color) {
  const words = String(text).split(' ');
  let line = '';
  let yy = y;
  for (const wd of words) {
    const test = line ? `${line} ${wd}` : wd;
    if (ui.measure(test, size) > w && line) {
      ui.text(line, x, yy, { size, color });
      line = wd;
      yy += size + 4;
    } else line = test;
  }
  if (line) ui.text(line, x, yy, { size, color });
}

// ======================= Подсказки =======================
function registerTooltips(game, C) {
  game.ui.registerTooltip({
    id: 'combat',
    order: 30,
    lines(g, hover) {
      const out = [];
      for (const e of hover.entities) {
        if (e.kind === 'pawn') {
          if (e.faction === 'enemy' || e.prisoner) {
            const ed = g.defs.enemies.get(e.enemyId);
            const f = FACTIONS[e.enemyFaction];
            out.push({ text: e.name, bold: true, color: f?.color || '#ff5f6d' });
            if (ed && e.name !== g.t(ed.nameKey)) out.push({ text: g.t(ed.nameKey), color: '#8c93b8', size: 11 });
            const h = e.health;
            if (h) out.push({ text: g.t('combat.tip.hp', { n: Math.max(0, Math.round((h.hp / (h.maxHp || 100)) * 100)) }), size: 11 });
            if (e.downed) out.push({ text: g.t('combat.tip.downed'), color: '#ffb347', size: 11 });
            if (e.prisoner) out.push({ text: g.t('combat.tip.prisoner'), color: '#ffb347', size: 11 });
          }
          const wid = e.equipment?.weapon;
          if (wid && g.defs.items.has(wid)) {
            const meta = e.equipment.weaponMeta;
            const name = C.gearLabel(wid, meta);
            out.push({ text: g.t('combat.tip.weapon', { name, q: g.t(`combat.quality.${meta?.quality || 'normal'}`) }), size: 11, color: '#c8cde8' });
          }
          if (e.puppet) out.push({ text: g.t('combat.tip.puppet'), color: '#ff7ae0', size: 11 });
          if (e.nameless) out.push({ text: g.t('combat.tip.nameless'), color: '#b9a6ff', size: 11 });
          if (e.drafted) out.push({ text: g.t('combat.tip.drafted'), color: '#ff4f4f', size: 11 });
        } else if (e.kind === 'item' && e.nick) {
          out.push({ text: `«${e.nick}»`, bold: true, color: '#ffd27a' });
          out.push({ text: g.t('combat.tip.kills', { n: e.kills || 0 }), size: 11 });
        } else if (e.kind === 'building') {
          const def = g.defs.buildings.get(e.defId);
          if (def?.turret) out.push({ text: g.t('combat.tip.ammo', { n: e.ammo || 0, max: def.turret.ammoMax, per: AMMO_PER_CRYSTAL }), size: 11, color: '#5ef2ff' });
          if (e.burnUntil > g.time.tick) out.push({ text: g.t('combat.tip.burning'), color: '#ff9f43', size: 11 });
          if (e.faded) out.push({ text: '???', color: '#8c93b8', size: 11 });
        }
      }
      return out;
    },
  }, 'combat');
}

// ======================= Регистрация =======================
export function registerRender(game, C) {
  for (const s of SFX) if (!game.defs.sfx.has(s.id)) game.audio.registerSfx(s.id, s, 'combat');
  registerFx(game);
  const r = game.render;
  r.registerDrawer('projectile', projectileDrawer);
  for (const [id, fn] of Object.entries(ENEMY_DRAWERS)) r.registerDefDrawer(id, downedWrap(fn));
  for (const [id, d] of Object.entries(decalDrawers)) r.registerDefDrawer(id, d);
  r.registerPawnOverlay(pawnOverlay(C), 'combat');
  r.registerLayer(vfxLayer(C), 'combat');
  r.registerLayer(heartDarkLayer(C), 'combat');
  registerHud(game, C);
  registerPanels(game, C);
  registerTooltips(game, C);
  // новый уровень — открыть карточки (только в браузере)
  game.events.on('combat:levelUp', ({ pawn }) => {
    if (!game.isHeadless && pawn?.perks?.cards?.length && !game.ui.modalOpen) game.ui.openPanel('combat_levelup');
  }, 'combat');
  void dist;
  void hasStaff;
  void weaponStats;
}
