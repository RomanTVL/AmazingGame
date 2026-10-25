// av — библиотека эффектов: пресеты частиц (game.defs.fxPresets), «фигурные» частицы av (сердечки, уголь,
// кольца, щепки, «ха!»), временные источники света, всплывающие тексты и game.api.av.effect(name, x, y, opts).
// Всё — косметика (Math.random допустим), кроме 'blood_trail': он оставляет декаль-сущность (детерминированно,
// без ГСЧ — по хешу клетки), поэтому работает и в headless.
import { TILE, TICKS_PER_DAY } from '../../core/constants.js';
import { hash01 } from '../../core/math.js';
import { drawGlow } from '../../render/glow.js';
import { rgba } from '../../render/color.js';
import { glyphSprite } from './glyphs.js';
import { sprite } from '../../engine/assets.js';
import { Pool, num, clamp01 } from './util.js';
import { t as tr } from '../../core/i18n.js';

const UP = -Math.PI / 2;

/** Пресеты частиц ядра + av. S передаётся замыканием (фигуры, свет). */
export function makePresets(S) {
  const shapes = (shape, x, y, o) => S.shapes && emitShapes(S, shape, x, y, o);
  return [
    { id: 'fire', emit: (fx, x, y, o = {}) => {
      fx.emit(x, y, { count: 5, speed: 1.1, angle: UP, spread: 0.9, life: 0.55, size: 3.2, color: o.color || '#ff8a3d', gravity: -2.6, drag: 1.6, glow: true, jitter: 0.5, ...o });
      fx.emit(x, y, { count: 2, speed: 0.7, angle: UP, spread: 0.6, life: 0.4, size: 2.2, color: '#ffe08a', gravity: -2.2, drag: 1.6, glow: true, jitter: 0.3 });
    } },
    { id: 'smoke_black', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 2, speed: 0.6, angle: UP, spread: 0.7, life: 2.6, size: 7, color: '#16131c', gravity: -0.8, drag: 0.6, glow: false, alpha: 0.6, grow: 3.2, ...o }) },
    { id: 'steam', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 2, speed: 0.6, angle: UP, spread: 0.9, life: 1.5, size: 5, color: '#dfe8f2', gravity: -1, drag: 1, glow: false, alpha: 0.38, grow: 4, ...o }) },
    { id: 'steam_thin', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 1, speed: 0.35, angle: UP, spread: 0.4, life: 1.1, size: 1.8, color: '#e8f0ff', gravity: -0.9, drag: 0.8, glow: false, alpha: 0.35, grow: 2, jitter: 0.05, ...o }) },
    { id: 'steam_jet', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 4, speed: 6, angle: num(o.angle, UP), spread: 0.25, life: 0.5, size: 3, color: '#f0f6ff', gravity: -1, drag: 2.2, glow: false, alpha: 0.5, grow: 6, jitter: 0.1, ...o }) },
    { id: 'blood_mist', emit: (fx, x, y, o = {}) => {
      const count = Math.min(8, Math.max(1, o.count ?? 5)); // дозированно
      fx.emit(x, y, { speed: 2.2, angle: num(o.angle, 0), spread: o.angle !== undefined ? 1.1 : Math.PI * 2, life: 0.5, size: 2.2, color: '#8a1426', gravity: 4, drag: 3, glow: false, alpha: 0.7, ...o, count });
    } },
    { id: 'magic_burst', emit: (fx, x, y, o = {}) => {
      const c = o.color || '#9ff8ff';
      fx.emit(x, y, { count: 16, speed: 3.2, life: 0.7, size: 2.4, color: c, gravity: -0.6, drag: 3, glow: true, ...o });
      fx.emit(x, y, { count: 6, speed: 1, life: 1.1, size: 1.6, color: '#ffffff', gravity: -1.2, drag: 2, glow: true });
      shapes('ring', x, y, { color: c, size: o.radius ?? 1.4, life: 0.45 });
    } },
    { id: 'dust', override: true, emit: (fx, x, y, o = {}) => {
      fx.emit(x, y, { count: 12, speed: 1.6, life: 0.85, size: 4, color: o.color || '#6f7590', gravity: -0.4, drag: 3, glow: false, alpha: 0.45, grow: 3, ...o });
      if ((o.count ?? 12) >= 8) shapes('ring', x, y, { color: '#9aa0b8', size: 0.9, life: 0.35, alpha: 0.35 });
    } },
    { id: 'snow_puff', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 10, speed: 1.4, life: 0.7, size: 2.4, color: '#e8f4ff', gravity: 1.5, drag: 2.5, glow: false, alpha: 0.8, ...o }) },
    { id: 'rot_spores', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 6, speed: 0.5, life: 2.2, size: 2, color: o.color || '#9aa88a', gravity: -0.3, drag: 0.8, glow: true, alpha: 0.6, jitter: 0.8, ...o }) },
    { id: 'heal_motes', emit: (fx, x, y, o = {}) => {
      fx.emit(x, y, { count: 10, speed: 0.8, angle: UP, spread: 1.8, life: 1.2, size: 1.8, color: '#9dffb0', gravity: -1.6, drag: 1.5, glow: true, jitter: 0.7, ...o });
      fx.emit(x, y, { count: 4, speed: 0.6, angle: UP, spread: 1.4, life: 1.3, size: 1.4, color: '#fff6a0', gravity: -1.4, drag: 1.5, glow: true, jitter: 0.6 });
    } },
    { id: 'hit_sparks', emit: (fx, x, y, o = {}) => {
      fx.emit(x, y, { count: 10, speed: 6, angle: num(o.angle, 0), spread: o.angle !== undefined ? 0.75 : Math.PI * 2, life: 0.25, size: 1.6, color: o.color || '#fff1c0', gravity: 2, drag: 4, glow: true, jitter: 0.05, ...o });
      fx.emit(x, y, { count: 3, speed: 2, life: 0.15, size: 3, color: '#ffffff', drag: 6, glow: true, jitter: 0.05 });
    } },
    { id: 'blood_trail', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 2, speed: 0.4, life: 0.5, size: 1.6, color: '#7a0d1c', gravity: 2, drag: 4, glow: false, alpha: 0.7, ...o }) },
    { id: 'hearts', emit: (fx, x, y, o = {}) => {
      fx.emit(x, y - 0.3, { count: 5, speed: 0.8, angle: UP, spread: 1.6, life: 0.9, size: 1.8, color: '#ff8fb8', gravity: -1.2, drag: 1.5, glow: true });
      shapes('heart', x, y - 0.3, { count: o.count ?? 3, color: o.color || '#ff5f8a' });
    } },
    { id: 'wood_chips', emit: (fx, x, y, o = {}) => {
      fx.emit(x, y, { count: 6, speed: 3.2, life: 0.5, size: 2.2, color: o.color || '#d9a066', gravity: 9, drag: 1.5, glow: false, ...o });
      shapes('chip', x, y, { count: 3, color: '#e8b478' });
    } },
    { id: 'sawdust', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 8, speed: 1.1, angle: UP, spread: Math.PI, life: 0.9, size: 1.4, color: '#e8c48a', gravity: 2, drag: 2.5, glow: false, alpha: 0.8, ...o }) },
    { id: 'hammer_sparks', emit: (fx, x, y, o = {}) => {
      fx.emit(x, y, { count: 7, speed: 4.5, angle: UP, spread: 2.2, life: 0.3, size: 1.4, color: '#ffd27a', gravity: 7, drag: 2, glow: true, jitter: 0.1, ...o });
      fx.emit(x, y, { count: 2, speed: 1.5, life: 0.12, size: 2.4, color: '#ffffff', drag: 5, glow: true, jitter: 0.05 });
    } },
    { id: 'brake_sparks', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 4, speed: 5, angle: num(o.angle, Math.PI), spread: 0.7, life: 0.3, size: 1.3, color: '#ffcf6b', gravity: 4, drag: 2.5, glow: true, jitter: 0.2, ...o }) },
    { id: 'wheel_sparks', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 2, speed: 3.5, angle: num(o.angle, Math.PI), spread: 0.5, life: 0.22, size: 1.1, color: '#fff0b0', gravity: 3, drag: 3, glow: true, jitter: 0.15, ...o }) },
    { id: 'breath', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 2, speed: 0.6, angle: num(o.angle, UP), spread: 0.5, life: 0.9, size: 2.2, color: '#e0ecff', gravity: -0.3, drag: 1.5, glow: false, alpha: 0.32, grow: 3, jitter: 0.05, ...o }) },
    { id: 'embers_orange', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 2, speed: 0.8, angle: UP, spread: 1.2, life: 1.3, size: 1.5, color: '#ff9a4a', gravity: -1.3, drag: 1, glow: true, ...o }) },
    { id: 'coal_bits', emit: (fx, x, y, o = {}) => {
      fx.emit(x, y, { count: 5, speed: 2.2, life: 0.4, size: 1.8, color: '#1d1a20', gravity: 6, drag: 3, glow: false });
      shapes('coal', x, y, { count: o.count ?? 4 });
    } },
    { id: 'clap_flash', emit: (fx, x, y) => {
      fx.emit(x, y, { count: 8, speed: 2.8, life: 0.3, size: 1.5, color: '#fff6c8', drag: 4, glow: true, jitter: 0.05 });
      shapes('ring', x, y, { color: '#ffffff', size: 0.55, life: 0.25 });
    } },
    { id: 'glass_spark', emit: (fx, x, y) => {
      fx.emit(x, y, { count: 6, speed: 2, life: 0.35, size: 1.3, color: '#fff6d8', drag: 3, glow: true, jitter: 0.05 });
      shapes('ring', x, y, { color: '#ffe6a8', size: 0.35, life: 0.25 });
    } },
    { id: 'frost_sparkle', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 2, speed: 0.3, life: 0.6, size: 1.2, color: '#d8f6ff', drag: 1, glow: true, jitter: 0.4, ...o }) },
    { id: 'fireflies', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 1, speed: 0.25, life: 3.2, size: 1.3, color: o.color || '#d4ff7a', gravity: -0.05, drag: 0.2, glow: true, jitter: 1.2, ...o }) },
    { id: 'ash_motes', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 1, speed: 0.3, angle: UP, spread: 1, life: 2.8, size: 1.3, color: o.color || '#ff8a4a', gravity: -0.15, drag: 0.3, glow: true, jitter: 1.4, ...o }) },
    { id: 'leaves_drift', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 1, speed: 1.2, angle: num(o.angle, 0.3), spread: 0.6, life: 2.4, size: 2, color: o.color || '#5effa0', gravity: 0.4, drag: 0.4, glow: false, alpha: 0.7, jitter: 1, ...o }) },
    { id: 'okrik_wave', emit: (fx, x, y, o = {}) => shapes('ring', x, y, { color: o.color || '#ffe08a', size: o.radius ?? 3, life: 0.6 }) },
  ];
}

// ---------------- фигурные частицы av ----------------
function makeShape() {
  return { shape: '', x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: '#fff', rot: 0, vr: 0, grav: 0, drag: 0, alpha: 1, glow: false, z: 0, vz: 0 };
}

export function createShapes() {
  return new Pool(makeShape, 400);
}

export function emitShapes(S, shape, x, y, o = {}) {
  const pool = S.shapes;
  if (!pool || S.game.isHeadless) return;
  const n = Math.max(1, Math.min(24, o.count ?? 1));
  for (let k = 0; k < n; k++) {
    const p = pool.add();
    if (!p) return;
    p.shape = shape;
    p.x = x + (Math.random() - 0.5) * (o.jitter ?? 0.3);
    p.y = y + (Math.random() - 0.5) * (o.jitter ?? 0.3);
    p.rot = Math.random() * 6.28;
    p.vr = (Math.random() - 0.5) * 8;
    p.color = o.color || '#ffffff';
    p.alpha = o.alpha ?? 1;
    p.glow = false;
    p.z = 0;
    p.vz = 0;
    switch (shape) {
      case 'heart':
        p.vx = (Math.random() - 0.5) * 1.2;
        p.vy = -1 - Math.random() * 0.8;
        p.grav = 0.4;
        p.drag = 1.2;
        p.size = 7 + Math.random() * 3;
        p.max = p.life = 1.1 + Math.random() * 0.4;
        p.vr = (Math.random() - 0.5) * 1.5;
        p.rot = (Math.random() - 0.5) * 0.4;
        break;
      case 'coal':
        p.vx = (Math.random() - 0.5) * 3;
        p.vy = (Math.random() - 0.5) * 3;
        p.grav = 0;
        p.drag = 5;
        p.size = 2 + Math.random() * 1.5;
        p.max = p.life = 0.5;
        p.color = '#141218';
        break;
      case 'chip':
        p.vx = (Math.random() - 0.5) * 5;
        p.vy = -2 - Math.random() * 2;
        p.grav = 10;
        p.drag = 1.2;
        p.size = 2.6 + Math.random() * 1.6;
        p.max = p.life = 0.55;
        break;
      case 'ring':
        p.vx = p.vy = 0;
        p.grav = p.drag = 0;
        p.size = o.size ?? 1;
        p.max = p.life = o.life ?? 0.4;
        p.vr = 0;
        p.glow = true;
        break;
      case 'ha':
        p.vx = 0;
        p.vy = -0.9;
        p.grav = 0;
        p.drag = 1;
        p.size = o.size ?? 9;
        p.max = p.life = 1;
        p.vr = 0;
        p.rot = (Math.random() - 0.5) * 0.3;
        p.glow = true;
        break;
      default: {
        // glyph:<id>
        p.vx = (Math.random() - 0.5) * 0.4;
        p.vy = -0.7;
        p.grav = 0;
        p.drag = 0.8;
        p.size = o.size ?? 10;
        p.max = p.life = o.life ?? 1.2;
        p.vr = 0;
        p.rot = 0;
      }
    }
  }
}

export function updateShapes(S, dt) {
  const pool = S.shapes;
  if (!pool) return;
  let i = 0;
  while (i < pool.n) {
    const p = pool.items[i];
    p.life -= dt;
    if (p.life <= 0) {
      pool.kill(i);
      continue;
    }
    const d = Math.exp(-p.drag * dt);
    p.vx *= d;
    p.vy = p.vy * d + p.grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    i++;
  }
}

function haSprite() {
  const word = tr('av.ha');
  return sprite(`avt:ha:${word}`, 72, 36, (ctx) => {
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ffe27a';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#fff2a8';
    ctx.fillText(word, 36, 18);
  });
}

export function drawShapes(S, ctx, view, glowPass) {
  const pool = S.shapes;
  if (!pool || !pool.n) return;
  const x0 = view.x0 - 1;
  const x1 = view.x1 + 1;
  const y0 = view.y0 - 1;
  const y1 = view.y1 + 1;
  for (let i = 0; i < pool.n; i++) {
    const p = pool.items[i];
    if (p.glow !== glowPass) continue;
    if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
    const k = p.life / p.max;
    const a = Math.min(1, k * 2) * p.alpha;
    const px = p.x * TILE;
    const py = p.y * TILE;
    if (p.shape === 'ring') {
      const r = (1 - k * k) * p.size * TILE + 2;
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2 * k + 0.5;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    if (p.shape === 'ha') {
      const s = haSprite();
      ctx.globalAlpha = a;
      const w = p.size * 2.6;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(p.rot);
      ctx.drawImage(s, -w / 2, -w / 4, w, w / 2);
      ctx.restore();
      continue;
    }
    ctx.globalAlpha = a;
    if (p.shape === 'heart') {
      const s = glyphSprite('heart', p.color);
      const z = p.size * (0.8 + 0.2 * Math.sin((1 - k) * 12));
      ctx.drawImage(s, px - z / 2, py - z / 2, z, z);
    } else if (p.shape === 'coal' || p.shape === 'chip') {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'chip') ctx.fillRect(-p.size / 2, -p.size / 5, p.size, p.size / 2.5);
      else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    } else if (p.shape.startsWith('glyph:')) {
      const s = glyphSprite(p.shape.slice(6), p.color === '#ffffff' ? undefined : p.color);
      ctx.drawImage(s, px - p.size / 2, py - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------- временные источники света ----------------
export function addLight(S, x, y, radius, color, intensity = 1, dur = 0.4, flicker = 0) {
  if (S.game.isHeadless || !Number.isFinite(x) || !Number.isFinite(y)) return;
  if (S.lights.length > 48) S.lights.shift();
  S.lights.push({ x, y, radius, color, intensity, t0: S.now, dur, flicker, out: { x, y, radius, color, intensity, flicker } });
}

/** Поставщик света av: временные вспышки (угасают по времени). */
export function collectTransientLights(S, view, out) {
  const now = S.now;
  let n = 0;
  for (let i = 0; i < S.lights.length; i++) {
    const L = S.lights[i];
    const k = 1 - (now - L.t0) / L.dur;
    if (k <= 0) continue;
    S.lights[n++] = L;
    if (L.x < view.x0 - 10 || L.x > view.x1 + 10 || L.y < view.y0 - 10 || L.y > view.y1 + 10) continue;
    const o = L.out;
    o.x = L.x;
    o.y = L.y;
    o.radius = L.radius * (0.7 + 0.3 * k);
    o.intensity = L.intensity * k;
    o.color = L.color;
    o.flicker = L.flicker;
    out.push(o);
  }
  S.lights.length = n;
}

// ---------------- всплывающие тексты (цифры урона) ----------------
export function addFloat(S, x, y, text, color = '#ffffff') {
  const game = S.game;
  if (game.isHeadless || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const s = String(text ?? '');
  if (!s) return;
  const numeric = /^[+\-−]?\d/.test(s);
  if (numeric && game.settings.get('damageNumbers') === false) return;
  if (S.floats.length > 60) S.floats.shift();
  S.floats.push({ x: x + (Math.random() - 0.5) * 0.3, y, text: s.slice(0, 40), color, t0: S.now, dur: numeric ? 0.9 : 1.6, vx: (Math.random() - 0.5) * 0.6, big: numeric && Math.abs(parseFloat(s)) >= 20 });
}

export function drawFloats(S, ctx, view) {
  const list = S.floats;
  if (!list.length) return;
  const now = S.now;
  let n = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const t = (now - f.t0) / f.dur;
    if (t >= 1) continue;
    list[n++] = f;
    const ease = 1 - (1 - t) * (1 - t);
    const x = (f.x + f.vx * t) * TILE;
    const y = (f.y - 0.6 - ease * 0.9) * TILE;
    const pop = t < 0.15 ? 1 + (0.15 - t) * 3 : 1;
    const size = Math.round((f.big ? 15 : 11) * pop);
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    ctx.globalAlpha = clamp01((1 - t) * 1.8);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(f.text, x + 1, y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, x, y);
    if (f.big) drawGlow(ctx, x, y, 18, f.color, 0.35 * (1 - t));
  }
  list.length = n;
  ctx.globalAlpha = 1;
}

// ---------------- декаль кровавого следа (сущность; работает и в headless) ----------------
const TRAIL_MAX = 500;

export function spawnTrailDecal(game, S, x, y, o = {}) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const map = game.map;
  if (!map || !map.inBounds(tx, ty)) return null;
  for (const e of game.entities.atTile(tx, ty, 'decal')) {
    if (e.avTrail) {
      e.alpha = Math.min(0.55, (e.alpha ?? 0.3) + 0.06);
      e.bornTick = game.time.tick;
      return e;
    }
  }
  if ((S.trailCount ?? 0) >= TRAIL_MAX) return null;
  S.trailCount = (S.trailCount ?? 0) + 1;
  const h = hash01(tx, ty, 4242);
  const h2 = hash01(ty, tx, 777);
  return game.entities.spawn('decal', {
    x: tx, y: ty, color: o.color || '#6e0b18', alpha: 0.32 + h * 0.12, r: 3.5 + h2 * 3,
    ox: (x - tx - 0.5) * 32 + (h - 0.5) * 6, oy: (y - ty - 0.5) * 32 + (h2 - 0.5) * 6, a: h * 3.14,
    avTrail: true, bornTick: game.time.tick,
  });
}

/** Раз в 10 игровых минут: старые следы бледнеют и исчезают через ~2 дня. */
export function fadeTrails(game, S) {
  let n = 0;
  const now = game.time.tick;
  for (const e of game.entities.ofKind('decal')) {
    if (!e.avTrail) continue;
    const age = now - (e.bornTick ?? now);
    if (age > TICKS_PER_DAY * 1.2) e.alpha = (e.alpha ?? 0.3) * 0.85;
    if ((e.alpha ?? 0) < 0.05 || age > TICKS_PER_DAY * 3) game.entities.remove(e, 'faded');
    else n++;
  }
  S.trailCount = n;
}

/** game.api.av.effect: составные эффекты (свет, звук, тряска, декаль) или пресет частиц. */
export function effect(game, S, play, name, x, y, opts = {}) {
  if (typeof name !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const o = opts && typeof opts === 'object' ? opts : {};
  switch (name) {
    case 'blood_trail':
      spawnTrailDecal(game, S, x, y, o);
      game.fx.preset('blood_trail', x, y, o);
      return true;
    case 'explosion': {
      const r = num(o.radius, 2.5);
      game.fx.emit(x, y, { count: 34, speed: 7 * Math.sqrt(r / 2.5), life: 0.55, size: 2, color: '#ffd27a', gravity: 2, drag: 2.6, glow: true });
      game.fx.emit(x, y, { count: 14, speed: 3.5, life: 0.9, size: 3.2, color: '#ff6a2a', gravity: -1, drag: 2, glow: true });
      for (let k = 0; k < 6; k++) game.fx.preset('smoke_black', x + (Math.random() - 0.5) * r, y + (Math.random() - 0.5) * r, { count: 2, size: 9 });
      emitShapes(S, 'ring', x, y, { color: '#ffb36b', size: r, life: 0.4 });
      addLight(S, x, y, r * 3.2, '#ffb060', 1, 0.6, 0.2);
      if (!o.silent) play('explosion', { x, y });
      game.api.av.shake(Math.min(1.2, 0.5 + r * 0.15));
      S.screenFlash.t0 = S.now;
      S.screenFlash.dur = 0.18;
      S.screenFlash.color = '#ffd8a0';
      S.screenFlash.alpha = 0.18;
      return true;
    }
    case 'magic_burst':
      game.fx.preset('magic_burst', x, y, o);
      addLight(S, x, y, num(o.radius, 1.4) * 3, o.color || '#9ff8ff', 0.9, 0.35);
      return true;
    case 'fire':
      game.fx.preset('fire', x, y, o);
      if (Math.random() < 0.3) game.fx.preset('embers_orange', x, y);
      addLight(S, x, y, 3, '#ff9a4a', 0.7, 0.3, 0.3);
      return true;
    case 'heal_motes':
      game.fx.preset('heal_motes', x, y, o);
      addLight(S, x, y, 2.5, '#9dffb0', 0.55, 0.8);
      return true;
    case 'sparks':
      game.fx.preset('sparks', x, y, o);
      addLight(S, x, y, 1.6, '#bfe8ff', 0.5, 0.15);
      return true;
    case 'ha':
      emitShapes(S, 'ha', x, y, o);
      return true;
    default:
      if (name.startsWith('glyph:')) {
        emitShapes(S, name, x, y, o);
        return true;
      }
      if (game.defs.fxPresets.has(name)) {
        game.fx.preset(name, x, y, o);
        return true;
      }
      return false;
  }
}

export { rgba };
