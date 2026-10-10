// Слой видимости (туман войны). Ядро по умолчанию: всё видно (game.vision.enabled === false) — слой ничего не рисует.
// Модуль vision включает: game.vision.enabled = true и переопределяет game.api.vision.isVisible/isExplored,
// увеличивая game.vision.version при каждом пересчёте (тогда маска перестраивается).
// Неисследованное — почти чёрное, исследованное вне обзора — затемнено («память»).
import { TILE } from '../core/constants.js';
import { makeCanvas } from '../engine/assets.js';
import { hexToRgb } from './color.js';

export class FogRenderer {
  constructor(game) {
    this.game = game;
    this.canvas = null;
    this.key = '';
    this.memoryAlpha = 0.6;
  }

  draw(ctx, game, view) {
    const vision = game.vision;
    if (!vision.enabled || !game.map) return;
    const x0 = view.x0;
    const y0 = view.y0;
    const w = view.x1 - x0 + 1;
    const h = view.y1 - y0 + 1;
    if (w <= 0 || h <= 0) return;
    const key = `${x0},${y0},${w},${h},${vision.version}`;
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = makeCanvas(w, h);
      this.key = '';
    }
    if (key !== this.key) {
      this.key = key;
      const c = this.canvas.getContext('2d');
      const img = c.createImageData(w, h);
      const biome = game.defs.biomes.get(game.map.biome);
      const [r, g, b] = hexToRgb(biome?.palette?.fog || '#000208');
      const d = img.data;
      const api = game.api.vision;
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const tx = x0 + i;
          const ty = y0 + j;
          const p = (j * w + i) * 4;
          d[p] = r;
          d[p + 1] = g;
          d[p + 2] = b;
          let a = 0;
          if (!api.isExplored(tx, ty)) a = 250;
          else if (!api.isVisible(tx, ty)) a = Math.round(this.memoryAlpha * 255);
          d[p + 3] = a;
        }
      c.putImageData(img, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, x0 * TILE, y0 * TILE, w * TILE, h * TILE);
  }
}
