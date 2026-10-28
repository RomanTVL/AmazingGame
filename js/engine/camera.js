// Камера: следует за лидером (плавно, с упреждением к курсору), зум колесом, тряска.
// Координаты мира — клетки (дробные). Экран — CSS-пиксели канваса.
import { TILE } from '../core/constants.js';
import { clamp, damp } from '../core/math.js';

export class Camera {
  constructor(game) {
    this.game = game;
    this.x = 70;
    this.y = 45;
    this.zoom = 1.25;
    this.targetZoom = 1.25;
    this.minZoom = 0.45;
    this.maxZoom = 2.6;
    this.w = 1280;
    this.h = 720;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    /** Сущность, за которой следуем (по умолчанию лидер). Модуль может навести на событие. */
    this.followId = 0;
    this.lookAhead = 0.18;
  }

  get scale() {
    return TILE * this.zoom;
  }

  setViewport(w, h) {
    this.w = Math.max(1, w || 1);
    this.h = Math.max(1, h || 1);
  }

  snapTo(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.x = x;
    this.y = y;
  }

  addShake(amount) {
    if (this.game.settings?.get('shake') === false) return;
    this.shake = Math.min(1.5, this.shake + amount);
  }

  zoomBy(steps) {
    if (!Number.isFinite(steps)) return;
    this.targetZoom = clamp(this.targetZoom * Math.pow(1.15, -steps), this.minZoom, this.maxZoom);
  }

  update(dt) {
    const game = this.game;
    const target = (this.followId && game.entities.get(this.followId)) || game.getLeader();
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
      let tx = target.x;
      let ty = target.y;
      const m = game.input?.mouse;
      if (m?.inside) {
        tx += (m.wx - target.x) * this.lookAhead;
        ty += (m.wy - target.y) * this.lookAhead;
      }
      this.x = damp(this.x, tx, 6, dt);
      this.y = damp(this.y, ty, 6, dt);
    }
    this.zoom = damp(this.zoom, this.targetZoom, 10, dt);
    if (Math.abs(this.zoom - this.targetZoom) < 0.002) this.zoom = this.targetZoom;
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.35;
      this.shakeX = (Math.random() * 2 - 1) * s;
      this.shakeY = (Math.random() * 2 - 1) * s;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    } else {
      this.shakeX = this.shakeY = 0;
    }
    if (!Number.isFinite(this.x) || !Number.isFinite(this.y)) {
      this.x = game.map ? game.map.w / 2 : 0;
      this.y = game.map ? game.map.h / 2 : 0;
    }
    const map = game.map;
    if (map) {
      const hw = this.w / 2 / this.scale;
      const hh = this.h / 2 / this.scale;
      this.x = map.w > hw * 2 ? clamp(this.x, hw - 2, map.w - hw + 2) : map.w / 2;
      this.y = map.h > hh * 2 ? clamp(this.y, hh - 2, map.h - hh + 2) : map.h / 2;
    }
  }

  get viewX() {
    return this.x + this.shakeX;
  }

  get viewY() {
    return this.y + this.shakeY;
  }

  worldToScreen(wx, wy) {
    const s = this.scale;
    return { x: (wx - this.viewX) * s + this.w / 2, y: (wy - this.viewY) * s + this.h / 2 };
  }

  screenToWorld(sx, sy) {
    const s = this.scale;
    return { x: (sx - this.w / 2) / s + this.viewX, y: (sy - this.h / 2) / s + this.viewY };
  }

  /** Видимые границы в клетках (с запасом). */
  bounds(margin = 1) {
    const s = this.scale;
    const hw = this.w / 2 / s;
    const hh = this.h / 2 / s;
    return {
      x0: Math.floor(this.viewX - hw) - margin,
      y0: Math.floor(this.viewY - hh) - margin,
      x1: Math.ceil(this.viewX + hw) + margin,
      y1: Math.ceil(this.viewY + hh) + margin,
    };
  }
}
