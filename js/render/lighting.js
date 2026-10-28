// День/ночь: тонировка + карта освещённости.
// Источники света:
//   - сущности с полем light: {radius, color, intensity, flicker?} (пешки), def.light у построек/растений/предметов;
//   - поставщики: game.render.registerLightSource({id, collect(game, view, out)}) — out.push({x, y, radius, color, intensity}).
//
// Карта освещённости L рисуется в уменьшенный канвас (1/3 экрана): заливка «ночным» цветом окружения,
// источники — аддитивно своим цветом. Затем сцена умножается на L (multiply):
//   - в браузере — отдельным DOM-канвасом с CSS mix-blend-mode: multiply (масштаб и смешивание делает
//     композитор, это в разы дешевле drawImage на весь экран); слои с order > 90 рисуются на верхний канвас;
//   - запасной путь — drawImage с globalCompositeOperation = 'multiply' в основной канвас.
import { makeCanvas } from '../engine/assets.js';
import { glowSprite } from './glow.js';
import { hexToRgb } from './color.js';

export const LIGHT_SCALE = 1 / 3;

export class Lighting {
  constructor(game) {
    this.game = game;
    this.canvas = null;
    this.lights = [];
    /** Пул объектов-источников (без аллокаций в кадре). */
    this.pool = [];
    this.maxDarkness = 0.84;
    /** Если задано рендером — DOM-канвас с CSS multiply (тогда drawDarkness только обновляет его). */
    this.domCanvas = null;
  }

  /** Насколько темно сейчас (0..maxDarkness). */
  darkness(view) {
    return view.night * this.maxDarkness;
  }

  /** Собрать источники в видимой области (+ запас). Объекты сущностей берутся из пула — не храните ссылки. */
  collect(view) {
    const game = this.game;
    const out = this.lights;
    out.length = 0;
    const pool = this.pool;
    let pi = 0;
    const put = (x, y, L) => {
      if (!L || !(L.radius > 0)) return;
      const o = pool[pi] || (pool[pi] = { x: 0, y: 0, radius: 1, color: '#ffffff', intensity: 1, flicker: 0 });
      pi++;
      o.x = x;
      o.y = y;
      o.radius = L.radius;
      o.color = L.color || '#ffffff';
      o.intensity = L.intensity ?? 1;
      o.flicker = L.flicker || 0;
      out.push(o);
    };
    const m = 8;
    for (const e of game.entities.queryRect(view.x0 - m, view.y0 - m, view.x1 + m, view.y1 + m)) {
      if (e.kind === 'pawn') {
        if (e.light && !e.dead) put(e.x, e.y, e.light);
        continue;
      }
      if (e.light) {
        put(e.x + (e.w || 1) / 2, e.y + (e.h || 1) / 2, e.light);
        continue;
      }
      if (e.kind !== 'building' && e.kind !== 'plant' && e.kind !== 'item') continue;
      const def = game.entities.defOf(e);
      if (def?.light) put(e.x + (e.w || 1) / 2, e.y + (e.h || 1) / 2, def.light);
    }
    for (const p of game.render.lights.all()) {
      try {
        p.collect(game, view, out);
      } catch (err) {
        game.error(err, `light:${p.id}`);
      }
    }
    return out;
  }

  /** Слой тонировки сумерек (тёплый). Экранный. */
  drawTint(ctx, game, view) {
    const d = view.daylight;
    if (d > 0.98) return;
    const dusk = Math.max(0, 1 - Math.abs(d - 0.5) * 2.2);
    if (dusk > 0.01) {
      ctx.fillStyle = `rgba(255,110,80,${(dusk * 0.07).toFixed(3)})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }

  /** Нарисовать карту освещённости в канвас target (размер ≈ экран × LIGHT_SCALE). */
  renderLightMap(game, view, target) {
    const dark = this.darkness(view);
    const w = target.width;
    const h = target.height;
    const sc = w / view.w;
    const lctx = target.getContext('2d');
    const biome = game.map && game.defs.biomes.get(game.map.biome);
    const [tr, tg, tb] = hexToRgb(biome?.palette?.nightTint || '#0a1030');
    const k = 1 - dark;
    const amb = (tint) => Math.round(255 * k + tint * 0.9 * dark);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    lctx.globalAlpha = 1;
    lctx.fillStyle = `rgb(${amb(tr)},${amb(tg)},${amb(tb)})`;
    lctx.fillRect(0, 0, w, h);
    lctx.globalCompositeOperation = 'lighter';
    const t = view.time;
    const hw = view.w / 2;
    const hh = view.h / 2;
    for (const L of this.collect(view)) {
      if (!Number.isFinite(L.x) || !Number.isFinite(L.y) || !(L.radius > 0)) continue;
      const fl = L.flicker ? 1 + Math.sin(t * 13 + L.x * 7.1 + L.y * 3.3) * L.flicker * 0.5 + Math.sin(t * 29 + L.x) * L.flicker * 0.3 : 1;
      const r = L.radius * view.scale * fl * sc;
      const x = ((L.x - view.camX) * view.scale + hw) * sc;
      const y = ((L.y - view.camY) * view.scale + hh) * sc;
      if (x < -r || y < -r || x > w + r || y > h + r) continue;
      lctx.globalAlpha = Math.min(1, (L.intensity ?? 1) * dark * 1.15);
      lctx.drawImage(glowSprite(L.color || '#ffffff', 48, 1.5), x - r, y - r, r * 2, r * 2);
    }
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = 'source-over';
    return dark;
  }

  /** Слой темноты (экранный). При DOM-канвасе рендера — только обновляет его. */
  drawDarkness(ctx, game, view) {
    const dark = this.darkness(view);
    if (dark < 0.01) return;
    if (this.domCanvas) {
      this.renderLightMap(game, view, this.domCanvas);
      return;
    }
    const w = Math.ceil(view.w * LIGHT_SCALE);
    const h = Math.ceil(view.h * LIGHT_SCALE);
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) this.canvas = makeCanvas(w, h);
    this.renderLightMap(game, view, this.canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.canvas, 0, 0, view.w, view.h);
    ctx.globalCompositeOperation = 'source-over';
  }
}
