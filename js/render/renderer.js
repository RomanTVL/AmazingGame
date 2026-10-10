// Рендер: упорядоченный реестр слоёв.
//   game.render.registerLayer({ id, order, space: 'world'|'screen', draw(ctx, game, view) })
// Мировые слои рисуют в «мировых пикселях» (клетка = TILE = 32), трансформ камеры уже применён.
// Экранные слои рисуют в CSS-пикселях. Таблица порядков — docs/ARCHITECTURE.md.
// Реестр (RenderRegistry) существует и в headless (регистрация без отрисовки).
import { Registry } from '../core/registry.js';
import { TILE } from '../core/constants.js';
import { LIGHT_SCALE } from './lighting.js';

export const LAYER = Object.freeze({
  GROUND: 0, WATER_FX: 10, ZONES: 20, DECALS: 30, ITEMS: 40, PLANTS: 45, BUILDINGS: 50, CORPSES: 55,
  PAWNS: 60, TRAIN_DECO: 65, PROJECTILES: 70, PARTICLES: 80, WEATHER: 85, TINT: 88, LIGHTING: 90,
  EMISSIVE: 92, PARTICLES_GLOW: 93, FOG: 95, DESIGNATIONS: 97, OVERLAY: 98,
  // экранные
  SCREEN_FX: 150, UI: 200, CURSOR: 900,
});

export class RenderRegistry {
  constructor(game) {
    this.game = game;
    this.layers = new Registry('layers', { sortBy: 'order', defaults: { space: 'world', order: 100, enabled: true } });
    /** kind → {draw(ctx, e, game, view), drawEmissive?} */
    this.drawers = new Map();
    /** defId → {draw?, drawEmissive?, paintBaked?} — переопределение для конкретного def */
    this.defDrawers = new Map();
    /** Поставщики источников света: {id, collect(game, view, out: Light[])} */
    this.lights = new Registry('lights');
  }

  registerLayer(def, owner = 'core') {
    if (typeof def.draw !== 'function') throw new Error(`[render] слой ${def.id}: нужен draw()`);
    return this.layers.add(def, owner);
  }

  registerDrawer(kind, drawer) {
    this.drawers.set(kind, drawer);
  }

  registerDefDrawer(defId, drawer) {
    this.defDrawers.set(defId, drawer);
  }

  /** Light = {x, y (клетки), radius (клетки), color, intensity 0..1, flicker?} */
  registerLightSource(def, owner = 'core') {
    if (typeof def.collect !== 'function') throw new Error(`[render] свет ${def.id}: нужен collect()`);
    return this.lights.add(def, owner);
  }

  /** Отрисовщик сущности: def.draw → defDrawers → drawers[kind]. */
  drawerFor(e, def) {
    if (def && def.draw) return def;
    return this.defDrawers.get(e.defId) || this.drawers.get(e.kind) || null;
  }
}

/**
 * Рендер в браузере. Три канваса (композитор браузера смешивает их):
 *   base  — мир и всё с order ≤ LIGHTING (90);
 *   light — карта освещённости (CSS mix-blend-mode: multiply), видна только когда темно;
 *   top   — слои с order > 90 (неон поверх темноты, туман, пометки, оверлеи, UI, курсор).
 * Днём (темноты нет) всё рисуется в base, light/top скрыты.
 */
export class Renderer {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.light = this._overlay('light', 'multiply');
    this.top = this._overlay('top', 'normal');
    this.topCtx = this.top.getContext('2d');
    this.split = false;
    this.dpr = 1;
    this.time = 0;
    this.frameNo = 0;
    this.view = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _overlay(id, blend) {
    const c = document.createElement('canvas');
    c.id = `game-${id}`;
    Object.assign(c.style, {
      position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh',
      pointerEvents: 'none', mixBlendMode: blend, display: 'none',
    });
    this.canvas.after(c);
    return c;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.top.width = this.canvas.width;
    this.top.height = this.canvas.height;
    this.light.width = Math.ceil(w * LIGHT_SCALE);
    this.light.height = Math.ceil(h * LIGHT_SCALE);
    this.w = w;
    this.h = h;
    this.game.camera.setViewport(w, h);
  }

  computeView(dt) {
    const game = this.game;
    const cam = game.camera;
    const b = cam.bounds(1);
    const map = game.map;
    if (map) {
      b.x0 = Math.max(0, b.x0);
      b.y0 = Math.max(0, b.y0);
      b.x1 = Math.min(map.w - 1, b.x1);
      b.y1 = Math.min(map.h - 1, b.y1);
    }
    return {
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      zoom: cam.zoom,
      scale: TILE * cam.zoom,
      camX: cam.viewX,
      camY: cam.viewY,
      ...b,
      time: this.time,
      dt,
      frame: this.frameNo,
      night: game.time.nightFactor,
      daylight: game.time.daylight,
    };
  }

  _setSplit(on) {
    if (on === this.split) return;
    this.split = on;
    this.light.style.display = on ? 'block' : 'none';
    this.top.style.display = on ? 'block' : 'none';
  }

  frame(dt) {
    const game = this.game;
    this.time += dt;
    this.frameNo++;
    const view = this.computeView(dt);
    this.view = view;
    const lighting = game.render.lighting;
    const split = !!lighting && lighting.darkness(view) >= 0.01;
    this._setSplit(split);
    if (lighting) lighting.domCanvas = split ? this.light : null;
    const dpr = this.dpr;
    const base = this.ctx;
    const top = this.topCtx;
    const biome = game.map && game.defs.biomes.get(game.map.biome);
    base.setTransform(dpr, 0, 0, dpr, 0, 0);
    base.globalAlpha = 1;
    base.globalCompositeOperation = 'source-over';
    base.fillStyle = biome?.palette?.bg || '#04060c';
    base.fillRect(0, 0, this.w, this.h);
    if (split) {
      top.setTransform(1, 0, 0, 1, 0, 0);
      top.clearRect(0, 0, this.top.width, this.top.height);
    }
    const z = view.zoom * dpr;
    const tx = dpr * (this.w / 2 - view.camX * TILE * view.zoom);
    const ty = dpr * (this.h / 2 - view.camY * TILE * view.zoom);
    for (const layer of game.render.layers.all()) {
      if (!layer.enabled) continue;
      const ctx = split && layer.order > LAYER.LIGHTING ? top : base;
      if (layer.space === 'world') {
        if (!game.map) continue;
        ctx.setTransform(z, 0, 0, z, tx, ty);
      } else ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      const t0 = performance.now();
      try {
        layer.draw(ctx, game, view);
      } catch (err) {
        game.error(err, `render:${layer.id}`);
      }
      layer.ms = (layer.ms ?? 0) * 0.95 + (performance.now() - t0) * 0.05;
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
