// Частицы: пул фиксированного размера, аддитивное свечение. Только косметика (Math.random допустим).
//   game.fx.emit(x, y, {count, speed, angle, spread, life, size, color, gravity, drag, glow})
//   game.fx.preset('chips', x, y, opts)   — пресеты в game.defs.fxPresets: {id, emit(fx, x, y, opts)}
// Координаты — клетки мира. В headless всё — no-op.
import { glowSprite } from '../render/glow.js';
import { TILE } from '../core/constants.js';

const MAX = 3000;

export const CORE_FX_PRESETS = [
  { id: 'chips', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 7, speed: 3, life: 0.5, size: 2.2, color: o.color || '#e0a060', gravity: 9, drag: 1.5, glow: false, ...o }) },
  { id: 'leaves', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 5, speed: 1.6, life: 0.9, size: 2.4, color: o.color || '#5effa0', gravity: 1.5, drag: 2.5, glow: true, ...o }) },
  { id: 'sparks', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 8, speed: 4.5, life: 0.35, size: 1.6, color: o.color || '#bfe8ff', gravity: 6, drag: 2, glow: true, ...o }) },
  { id: 'dust', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 10, speed: 1.2, life: 0.9, size: 3.5, color: o.color || '#6a6f88', gravity: -0.5, drag: 3, glow: false, alpha: 0.5, ...o }) },
  { id: 'magic', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 12, speed: 2.2, life: 0.8, size: 2.6, color: o.color || '#9ff8ff', gravity: -1.5, drag: 2.5, glow: true, ...o }) },
  { id: 'smoke', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 1, speed: 0.4, angle: -Math.PI / 2, spread: 0.8, life: 2.2, size: 6, color: o.color || '#3a4058', gravity: -0.6, drag: 0.6, glow: false, alpha: 0.35, grow: 2.2, ...o }) },
  { id: 'embers', emit: (fx, x, y, o = {}) => fx.emit(x, y, { count: 2, speed: 0.8, angle: -Math.PI / 2, spread: 1.2, life: 1.4, size: 1.6, color: o.color || '#5ef2ff', gravity: -1.2, drag: 1, glow: true, ...o }) },
];

export class Particles {
  constructor(game) {
    this.game = game;
    this.enabled = !game.isHeadless;
    this.n = 0;
    this.x = new Float32Array(MAX);
    this.y = new Float32Array(MAX);
    this.vx = new Float32Array(MAX);
    this.vy = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.grow = new Float32Array(MAX);
    this.col = new Uint16Array(MAX);
    this.glow = new Uint8Array(MAX);
    this.colors = [];
    this.colorIdx = new Map();
  }

  _color(c) {
    let i = this.colorIdx.get(c);
    if (i === undefined) {
      i = this.colors.length;
      this.colors.push(c);
      this.colorIdx.set(c, i);
    }
    return i;
  }

  emit(x, y, o = {}) {
    if (!this.enabled) return;
    const count = o.count ?? 8;
    const ci = this._color(o.color || '#ffffff');
    for (let k = 0; k < count; k++) {
      if (this.n >= MAX) return;
      const i = this.n++;
      const ang = (o.angle ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const sp = (o.speed ?? 2) * (0.4 + Math.random() * 0.8);
      this.x[i] = x + (Math.random() - 0.5) * (o.jitter ?? 0.2);
      this.y[i] = y + (Math.random() - 0.5) * (o.jitter ?? 0.2);
      this.vx[i] = Math.cos(ang) * sp;
      this.vy[i] = Math.sin(ang) * sp;
      const life = (o.life ?? 0.6) * (0.7 + Math.random() * 0.6);
      this.life[i] = life;
      this.max[i] = life;
      this.size[i] = (o.size ?? 2) * (0.7 + Math.random() * 0.6);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 2;
      this.alpha[i] = o.alpha ?? 1;
      this.grow[i] = o.grow ?? 0;
      this.col[i] = ci;
      this.glow[i] = o.glow === false ? 0 : 1;
    }
  }

  preset(id, x, y, opts) {
    if (!this.enabled) return;
    const p = this.game.defs.fxPresets.get(id);
    if (p) p.emit(this, x, y, opts);
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this._kill(i);
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.size[i] += this.grow[i] * dt;
      i++;
    }
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.life[i] = this.life[j];
    this.max[i] = this.max[j];
    this.size[i] = this.size[j];
    this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j];
    this.alpha[i] = this.alpha[j];
    this.grow[i] = this.grow[j];
    this.col[i] = this.col[j];
    this.glow[i] = this.glow[j];
  }

  /** Рисует в мировых координатах (ctx уже с трансформом камеры). glowPass — только светящиеся. */
  draw(ctx, view, glowPass) {
    const x0 = view.x0;
    const x1 = view.x1;
    const y0 = view.y0;
    const y1 = view.y1;
    if (glowPass) ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.n; i++) {
      if ((this.glow[i] === 1) !== glowPass) continue;
      const x = this.x[i];
      const y = this.y[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const t = this.life[i] / this.max[i];
      const a = Math.min(1, t * 1.6) * this.alpha[i];
      const s = this.size[i];
      const c = this.colors[this.col[i]];
      ctx.globalAlpha = a;
      if (glowPass) {
        const g = glowSprite(c, 16);
        const r = s * 3.2;
        ctx.drawImage(g, x * TILE - r, y * TILE - r, r * 2, r * 2);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = a * 0.8;
        ctx.fillRect(x * TILE - s * 0.35, y * TILE - s * 0.35, s * 0.7, s * 0.7);
      } else {
        ctx.fillStyle = c;
        ctx.fillRect(x * TILE - s / 2, y * TILE - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
