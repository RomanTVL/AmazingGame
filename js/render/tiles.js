// Отрисовка карты чанками 16×16 в офскрин-канвасы (кэш). Перерисовываются только «грязные» чанки
// (по событию map:changed). В кэш запекается: ландшафт + шум, трава, вода, полы, рельсы и постройки с def.bake
// (стены вагонов, скалы). Свои «запекаемые» постройки модули рисуют через def.paintBaked(ctx, px, py, e, game)
// или game.render.registerDefDrawer(defId, {paintBaked}).
import { TILE, CHUNK, TILE_FLAG } from '../core/constants.js';
import { EVENTS } from '../core/events.js';
import { hash2, hash01 } from '../core/math.js';
import { valueNoise } from '../core/noise.js';
import { makeCanvas } from '../engine/assets.js';
import { rgba, mix, hexToRgb } from './color.js';

const CPX = CHUNK * TILE;
const key = (cx, cy) => cx + cy * 1024;
const MAX_CHUNKS = 72;

export class TileRenderer {
  constructor(game) {
    this.game = game;
    this.chunks = new Map(); // key → {canvas, scale, used}
    this.dirty = new Set();
    this.mapRef = null;
    this.bakesPerFrame = 6;
    /** Масштаб запекания (device px на мировой px). Чанки рисуются 1:1, когда масштаб совпадает с текущим. */
    this.scale = 1;
    this.targetScale = 1;
    this.scaleSince = 0;
    this.colorMap = null;
    this.colorDirty = null;
    this.stats = { baked: 0 };
    game.events.on(EVENTS.MAP_CHANGED, ({ x, y, w, h }) => {
      // запас 2 клетки: кроны деревьев и свечение заходят на соседние чанки
      const cx0 = Math.floor((x - 2) / CHUNK);
      const cy0 = Math.floor((y - 2) / CHUNK);
      const cx1 = Math.floor((x + w + 1) / CHUNK);
      const cy1 = Math.floor((y + h + 1) / CHUNK);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.dirty.add(key(cx, cy));
      if (this.colorMap) (this.colorDirty ||= []).push({ x, y, w, h });
    });
  }

  reset() {
    this.chunks.clear();
    this.dirty.clear();
    this.mapRef = this.game.map;
    this.colorMap = null;
    this.colorDirty = null;
  }

  /** Карта цветов ландшафта: 1 пиксель = 1 клетка; при запекании растягивается со сглаживанием → мягкие переходы. */
  ensureColorMap() {
    const map = this.game.map;
    const biome = this.game.defs.biomes.get(map.biome) || this.game.defs.biomes.all()[0];
    if (!this.colorMap) {
      this.colorMap = makeCanvas(map.w, map.h);
      this.paintColorMap(biome, 0, 0, map.w, map.h);
    } else if (this.colorDirty) {
      for (const r of this.colorDirty) this.paintColorMap(biome, r.x, r.y, r.w, r.h);
    }
    this.colorDirty = null;
    return this.colorMap;
  }

  paintColorMap(biome, x, y, w, h) {
    const map = this.game.map;
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(map.w - x, w);
    h = Math.min(map.h - y, h);
    if (w <= 0 || h <= 0) return;
    const ctx = this.colorMap.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const pal = biome.palette;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const tx = x + i;
        const ty = y + j;
        const td = map.terrainDef(tx, ty);
        const p = pal.terrain[td.id] || pal.terrain.grass;
        const A = hexToRgb(p.base);
        const B = hexToRgb(p.alt || p.base);
        const n = valueNoise(tx / 4.5, ty / 4.5, 17) * 0.7 + hash01(tx, ty, 7) * 0.3;
        const k = (j * w + i) * 4;
        d[k] = A[0] + (B[0] - A[0]) * n * 1.6;
        d[k + 1] = A[1] + (B[1] - A[1]) * n * 1.6;
        d[k + 2] = A[2] + (B[2] - A[2]) * n * 1.6;
        d[k + 3] = 255;
      }
    ctx.putImageData(img, x, y);
  }

  draw(ctx, game, view) {
    if (game.isHeadless) return;
    if (this.mapRef !== game.map) this.reset();
    const map = game.map;
    const s = view.zoom * view.dpr;
    // пере-запекаем под новый зум, когда он устоялся
    if (Math.abs(s - this.targetScale) > 1e-6) {
      this.targetScale = s;
      this.scaleSince = view.time;
    }
    if (this.scale !== this.targetScale && view.time - this.scaleSince > 0.25) {
      this.scale = this.targetScale;
      for (const k of this.chunks.keys()) this.dirty.add(k);
    }
    this.ensureColorMap();
    const cx0 = Math.max(0, Math.floor(view.x0 / CHUNK));
    const cy0 = Math.max(0, Math.floor(view.y0 / CHUNK));
    const cx1 = Math.min(Math.ceil(map.w / CHUNK) - 1, Math.floor(view.x1 / CHUNK));
    const cy1 = Math.min(Math.ceil(map.h / CHUNK) - 1, Math.floor(view.y1 / CHUNK));
    const W = view.w * view.dpr;
    const H = view.h * view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let budget = this.bakesPerFrame;
    const frame = view.frame;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = key(cx, cy);
        let c = this.chunks.get(k);
        if (!c || (this.dirty.has(k) && (budget > 0 || c.scale !== this.scale))) {
          if (!c || budget > 0) {
            c = this.bake(cx, cy, c);
            this.chunks.set(k, c);
            this.dirty.delete(k);
            budget--;
          }
        }
        c.used = frame;
        const fx = (cx * CPX - view.camX * TILE) * s + W / 2;
        const fy = (cy * CPX - view.camY * TILE) * s + H / 2;
        if (Math.abs(c.scale - s) < 1e-6) ctx.drawImage(c.canvas, Math.round(fx), Math.round(fy));
        else ctx.drawImage(c.canvas, fx, fy, c.canvas.width * (s / c.scale), c.canvas.height * (s / c.scale));
      }
    // освобождаем дальние чанки
    if (this.chunks.size > MAX_CHUNKS) {
      const old = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < old.length - MAX_CHUNKS; i++) this.chunks.delete(old[i][0]);
    }
  }

  bake(cx, cy, reuse) {
    const game = this.game;
    const map = game.map;
    const sc = this.scale;
    const size = Math.ceil(CPX * sc) + 1;
    let canvas = reuse?.canvas;
    if (!canvas || canvas.width !== size) canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    const biome = game.defs.biomes.get(map.biome) || game.defs.biomes.all()[0];
    const pal = biome.palette;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    // 0) мягкая цветовая подложка
    const cm = this.ensureColorMap();
    const sx0 = Math.max(0, x0 - 1);
    const sy0 = Math.max(0, y0 - 1);
    const sx1 = Math.min(map.w, x0 + CHUNK + 2);
    const sy1 = Math.min(map.h, y0 + CHUNK + 2);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cm, sx0, sy0, sx1 - sx0, sy1 - sy0, (sx0 - x0 - 0.5) * TILE, (sy0 - y0 - 0.5) * TILE, (sx1 - sx0) * TILE, (sy1 - sy0) * TILE);
    // диапазон клеток с перекрытием в 1 клетку справа/снизу (без щелей между чанками)
    const each = (fn) => {
      for (let ty = 0; ty <= CHUNK; ty++)
        for (let tx = 0; tx <= CHUNK; tx++) {
          const x = x0 + tx;
          const y = y0 + ty;
          if (map.inBounds(x, y)) fn(x, y, tx * TILE, ty * TILE);
        }
    };
    // 1) детали ландшафта
    each((x, y, px, py) => this.paintTerrain(ctx, map, pal, x, y, px, py));
    // 2) полы и рельсы
    each((x, y, px, py) => {
      const i = map.idx(x, y);
      if (map.floor[i]) this.paintFloor(ctx, map, x, y, px, py);
      else if (map.flags[i] & TILE_FLAG.RAIL) this.paintRail(ctx, map, pal, x, y, px, py);
    });
    // 3) запекаемые постройки
    each((x, y, px, py) => {
      const b = map.buildingAt(x, y);
      if (!b || b.x !== x || b.y !== y) return;
      const def = game.defs.buildings.get(b.defId);
      if (!def?.bake) return;
      const dd = game.render.defDrawers.get(b.defId);
      const painter = def.paintBaked || dd?.paintBaked || (def.natural ? paintRock : paintWall);
      ctx.save();
      try {
        painter(ctx, px, py, b, game, def);
      } catch (err) {
        game.error(err, `bake:${b.defId}`);
      }
      ctx.restore();
    });
    // 4) запекаемые растения (с запасом 2 клетки — кроны заходят на соседей), по y
    const plants = game.entities.queryRect(x0 - 2, y0 - 2, x0 + CHUNK + 2, y0 + CHUNK + 2, 'plant');
    plants.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const p of plants) {
      const def = game.defs.plants.get(p.defId);
      if (!def || def.bake === false || def.draw) continue;
      const d = game.render.drawerFor(p, def);
      if (!d?.draw) continue;
      ctx.save();
      ctx.translate(-x0 * TILE, -y0 * TILE);
      try {
        d.draw(ctx, p, game, BAKE_VIEW, def);
      } catch (err) {
        game.error(err, `bake:${p.defId}`);
      }
      ctx.restore();
    }
    this.stats.baked++;
    return { canvas, scale: sc, used: 0 };
  }

  /** Детали клетки поверх цветовой подложки: крапинки, трава, рябь и кромка воды. */
  paintTerrain(ctx, map, pal, x, y, px, py) {
    const td = map.terrainDef(x, y);
    const p = pal.terrain[td.id] || pal.terrain.grass;
    const h = hash2(x, y, 7);
    // крапинки
    ctx.fillStyle = rgba(p.speck, 0.8);
    for (let k = 0; k < 3; k++) {
      const hh = hash2(x * 7 + k, y * 13 - k, 3);
      const sz = 1 + ((hh >>> 16) & 1);
      ctx.fillRect(px + (hh % TILE), py + ((hh >>> 8) % TILE), sz, sz);
    }
    if (td.water) {
      const edge = p.edge || '#2bd9ff';
      ctx.strokeStyle = rgba(edge, 0.1);
      ctx.lineWidth = 1;
      const off = (h >>> 4) % 16;
      ctx.beginPath();
      ctx.moveTo(px + 4 + off * 0.5, py + 10 + (h % 7));
      ctx.quadraticCurveTo(px + 12 + off * 0.5, py + 6 + (h % 7), px + 20 + off * 0.5, py + 10 + (h % 7));
      ctx.stroke();
      const nb = (dx, dy) => map.inBounds(x + dx, y + dy) && !map.terrainDef(x + dx, y + dy).water;
      ctx.save();
      ctx.shadowColor = edge;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = rgba(edge, 0.5);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (nb(0, -1)) { ctx.moveTo(px, py + 2); ctx.lineTo(px + TILE, py + 2); }
      if (nb(0, 1)) { ctx.moveTo(px, py + TILE - 2); ctx.lineTo(px + TILE, py + TILE - 2); }
      if (nb(-1, 0)) { ctx.moveTo(px + 2, py); ctx.lineTo(px + 2, py + TILE); }
      if (nb(1, 0)) { ctx.moveTo(px + TILE - 2, py); ctx.lineTo(px + TILE - 2, py + TILE); }
      ctx.stroke();
      ctx.restore();
      return;
    }
    // трава: светящиеся пучки
    if (p.tuft) {
      const n = h % 5;
      if (n >= 2) {
        ctx.strokeStyle = rgba(p.tuft, 0.22 + ((h >>> 20) & 3) * 0.06);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k < n - 1; k++) {
          const hh = hash2(x + k * 31, y - k * 17, 5);
          const bx = px + 3 + (hh % 26);
          const by = py + 6 + ((hh >>> 8) % 24);
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - 2, by - 5);
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + 1, by - 6);
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + 3, by - 4);
        }
        ctx.stroke();
      }
    }
  }

  paintFloor(ctx, map, x, y, px, py) {
    const game = this.game;
    const fd = map.floorDef(x, y);
    const dd = fd && game.render.defDrawers.get(fd.id);
    if (fd?.paint) return fd.paint(ctx, px, py, x, y, map, game);
    if (dd?.paint) return dd.paint(ctx, px, py, x, y, map, game);
    if (fd?.id === 'stone_tiles') {
      ctx.fillStyle = '#1a1d2a';
      ctx.fillRect(px, py, TILE, TILE);
      ctx.strokeStyle = 'rgba(120,130,170,0.25)';
      ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
      return;
    }
    // доски (вагон / деревянный пол)
    const h = hash2(x, y, 21);
    const train = fd?.id === 'wagon_planks';
    ctx.fillStyle = train ? ((h & 1) ? '#2a1a12' : '#2d1c13') : '#261a10';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 0; k < 4; k++) ctx.fillRect(px, py + k * 8, TILE, 1);
    ctx.fillStyle = 'rgba(255,190,120,0.06)';
    for (let k = 0; k < 4; k++) ctx.fillRect(px, py + k * 8 + 1, TILE, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let k = 0; k < 4; k++) {
      const sx = (hash2(x, y * 4 + k, 9) % 28) + 2;
      ctx.fillRect(px + sx, py + k * 8, 1, 8);
    }
    // гвоздики
    ctx.fillStyle = 'rgba(255,210,150,0.18)';
    ctx.fillRect(px + 2, py + 3, 1, 1);
    ctx.fillRect(px + TILE - 3, py + 19, 1, 1);
  }

  paintRail(ctx, map, pal, x, y, px, py) {
    // шпалы
    ctx.fillStyle = '#1b130d';
    for (let k = 0; k < 2; k++) ctx.fillRect(px + 3 + k * 16, py + 2, 9, TILE - 4);
    ctx.fillStyle = 'rgba(255,200,150,0.05)';
    for (let k = 0; k < 2; k++) ctx.fillRect(px + 3 + k * 16, py + 2, 9, 1);
    // рельсы со свечением
    const rc = pal.rail || '#8fa0ff';
    ctx.save();
    ctx.shadowColor = rc;
    ctx.shadowBlur = 5;
    ctx.fillStyle = mix(rc, '#202436', 0.35);
    ctx.fillRect(px, py + 8, TILE, 2);
    ctx.fillRect(px, py + TILE - 10, TILE, 2);
    ctx.restore();
    ctx.fillStyle = rgba('#ffffff', 0.25);
    ctx.fillRect(px, py + 8, TILE, 1);
    ctx.fillRect(px, py + TILE - 10, TILE, 1);
    if (map.flags[map.idx(x, y)] & TILE_FLAG.RAIL_RUNE) {
      const cx = px + TILE / 2;
      const cy = py + TILE / 2;
      ctx.save();
      ctx.shadowColor = pal.rune || '#b77dff';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = pal.rune || '#b77dff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 4);
      ctx.lineTo(cx + 4, cy);
      ctx.lineTo(cx, cy + 4);
      ctx.lineTo(cx - 4, cy);
      ctx.closePath();
      ctx.moveTo(cx - 2, cy);
      ctx.lineTo(cx + 2, cy);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------- Запекаемые отрисовщики ядра ----------
function sameGroup(game, x, y, group) {
  const b = game.map.buildingAt(x, y);
  if (!b) return false;
  const d = game.defs.buildings.get(b.defId);
  return !!d && d.connects === group;
}

/** Стена со связностью: тёмное тело (центр + «рукава» к соседям) и неоновый контур. */
export function paintWall(ctx, px, py, e, game, def) {
  const color = e.tint || def.color || '#8fa8ff';
  const g = def.connects || 'wall';
  const n = sameGroup(game, e.x, e.y - 1, g);
  const s = sameGroup(game, e.x, e.y + 1, g);
  const w = sameGroup(game, e.x - 1, e.y, g);
  const ee = sameGroup(game, e.x + 1, e.y, g);
  const a = 7;
  const b = TILE - 7;
  ctx.fillStyle = '#0b0e1b';
  ctx.fillRect(px + a, py + a, b - a, b - a);
  if (n) ctx.fillRect(px + a, py, b - a, a);
  if (s) ctx.fillRect(px + a, py + b, b - a, TILE - b);
  if (w) ctx.fillRect(px, py + a, a, b - a);
  if (ee) ctx.fillRect(px + b, py + a, TILE - b, b - a);
  // лёгкий внутренний отлив
  ctx.fillStyle = rgba(color, 0.07);
  ctx.fillRect(px + a, py + a, b - a, b - a);
  const L = (x0, y0, x1, y1) => {
    ctx.moveTo(px + x0, py + y0);
    ctx.lineTo(px + x1, py + y1);
  };
  ctx.shadowColor = color;
  ctx.shadowBlur = 7;
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'square';
  ctx.beginPath();
  if (!n) L(a, a, b, a);
  if (!s) L(a, b, b, b);
  if (!w) L(a, a, a, b);
  if (!ee) L(b, a, b, b);
  if (n) { L(a, 0, a, a); L(b, 0, b, a); }
  if (s) { L(a, b, a, TILE); L(b, b, b, TILE); }
  if (w) { L(0, a, a, a); L(0, b, a, b); }
  if (ee) { L(b, a, TILE, a); L(b, b, TILE, b); }
  ctx.stroke();
  ctx.shadowBlur = 0;
  const horiz = (w || ee) && !(n || s);
  if (def.window) {
    const lc = game.train?.carDef(game.train.cars[e.carIndex])?.light || '#ffd9a0';
    ctx.shadowColor = lc;
    ctx.shadowBlur = 10;
    ctx.fillStyle = rgba(lc, 0.9);
    if (horiz) ctx.fillRect(px + 5, py + TILE / 2 - 3, TILE - 10, 6);
    else ctx.fillRect(px + TILE / 2 - 3, py + 5, 6, TILE - 10);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    if (horiz) ctx.fillRect(px + 7, py + TILE / 2 - 1, TILE - 14, 1);
    else ctx.fillRect(px + TILE / 2 - 1, py + 7, 1, TILE - 14);
  }
  if (e.gangway) {
    // гармошка перехода
    ctx.strokeStyle = rgba(color, 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = a + 3; k < b; k += 4) L(k, a + 2, k, b - 2);
    ctx.stroke();
  }
}

/** Скала / рудная жила: угловатый многоугольник с лиловой гранью. */
export function paintRock(ctx, px, py, e, game, def) {
  const h = hash2(e.x, e.y, 33);
  const pts = [];
  const cx = px + TILE / 2;
  const cy = py + TILE / 2;
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (h % 10) * 0.05;
    const r = 13 + ((hash2(e.x + k, e.y - k, 4) % 5) - 1);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const fill = def.id === 'ore_iron' ? '#1e1712' : def.id === 'mana_vein' ? '#0d1a26' : '#161a2a';
  const rim = def.color || '#8d96b8';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = rim;
  ctx.shadowBlur = def.id === 'mana_vein' ? 10 : 4;
  ctx.strokeStyle = rgba(rim, def.id === 'rock' ? 0.55 : 0.85);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // грань-блик
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(cx, cy);
  ctx.lineTo(pts[3][0], pts[3][1]);
  ctx.stroke();
  if (def.id === 'ore_iron') {
    ctx.fillStyle = '#ff9a5c';
    for (let k = 0; k < 4; k++) {
      const hh = hash2(e.x * 3 + k, e.y, 8);
      ctx.fillRect(cx - 8 + (hh % 16), cy - 8 + ((hh >>> 8) % 16), 2, 2);
    }
  }
  if (def.id === 'mana_vein') {
    ctx.shadowColor = '#5ef2ff';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#9ff8ff';
    for (let k = 0; k < 3; k++) {
      const hh = hash2(e.x + k * 5, e.y * 2, 12);
      const sx = cx - 7 + (hh % 14);
      const sy = cy - 7 + ((hh >>> 8) % 14);
      ctx.beginPath();
      ctx.moveTo(sx, sy - 5);
      ctx.lineTo(sx + 2.5, sy);
      ctx.lineTo(sx, sy + 4);
      ctx.lineTo(sx - 2.5, sy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}

/** Вид для запекания (без анимации). */
const BAKE_VIEW = { time: 0, zoom: 1, frame: 0, night: 0 };
