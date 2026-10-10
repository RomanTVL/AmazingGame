// Рендер: упорядоченный реестр слоёв.
//   game.render.registerLayer({ id, order, space: 'world'|'screen', draw(ctx, game, view) })
// Мировые слои рисуют в «мировых пикселях» (клетка = TILE = 32), трансформ камеры уже применён.
// Экранные слои рисуют в CSS-пикселях. Таблица порядков — docs/ARCHITECTURE.md.
// Реестр (RenderRegistry) существует и в headless (регистрация без отрисовки).
import { Registry } from '../core/registry.js';
import { TILE } from '../core/constants.js';

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

export class Renderer {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.time = 0;
    this.frameNo = 0;
    this.view = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
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

  frame(dt) {
    const game = this.game;
    this.time += dt;
    this.frameNo++;
    const ctx = this.ctx;
    const view = this.computeView(dt);
    this.view = view;
    const dpr = this.dpr;
    const biome = game.map && game.defs.biomes.get(game.map.biome);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = biome?.palette?.bg || '#04060c';
    ctx.fillRect(0, 0, this.w, this.h);
    const z = view.zoom * dpr;
    const tx = dpr * (this.w / 2 - view.camX * TILE * view.zoom);
    const ty = dpr * (this.h / 2 - view.camY * TILE * view.zoom);
    for (const layer of game.render.layers.all()) {
      if (!layer.enabled) continue;
      if (layer.space === 'world') {
        if (!game.map) continue;
        ctx.setTransform(z, 0, 0, z, tx, ty);
      } else ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      try {
        layer.draw(ctx, game, view);
      } catch (err) {
        game.error(err, `render:${layer.id}`);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
