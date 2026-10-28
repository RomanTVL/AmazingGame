// Декоративные сцены экранов (только отрисовка, браузер): ночной лес с идущим поездом (главное меню),
// поезд в профиль, ночной перрон с фонарями и силуэтами («Перрон отбора»). Случайность — хеши (раскладка)
// и Math.random (частицы дыма/искр — косметика).
import { sprite, makeCanvas } from '../../engine/assets.js';
import { drawGlow, glowSprite } from '../../render/glow.js';
import { rgba, mix } from '../../render/color.js';
import { hash01 } from '../../core/math.js';
import { roundRect } from '../../engine/ui.js';

const WAGON_TINTS = ['#ff4fd8', '#5ef2ff', '#ffb347', '#7dff6a', '#c77dff', '#5aa8ff', '#ff8fa3'];

// ---------- Лесные полосы (кэш-спрайты, тайлятся по горизонтали) ----------
function forestStrip(key, w, h, opts) {
  return sprite(`ui:forest:${key}:${w}:${h}`, w, h, (ctx) => {
    const { color, rim, density, minH, maxH, seed } = opts;
    const n = Math.floor((w / 40) * density);
    // подложка у земли
    ctx.fillStyle = color;
    ctx.fillRect(0, h - h * 0.18, w, h * 0.18);
    for (let i = 0; i < n; i++) {
      const x = hash01(i, 1, seed) * w;
      const th = h * (minH + hash01(i, 2, seed) * (maxH - minH));
      const tw = th * (0.28 + hash01(i, 3, seed) * 0.12);
      const base = h - h * 0.08 * hash01(i, 4, seed);
      for (const dx of [0, -w, w]) drawPine(ctx, x + dx, base, tw, th, color, rim);
    }
  });
}

function drawPine(ctx, x, base, tw, th, color, rim) {
  const tiers = 5;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let k = 0; k < tiers; k++) {
    const t0 = k / tiers;
    const yTop = base - th * (0.18 + t0 * 0.82);
    const half = tw * (1 - t0 * 0.78) * 0.5;
    const yBot = base - th * (0.02 + t0 * 0.7);
    ctx.moveTo(x, yTop - th * 0.12);
    ctx.lineTo(x + half, yBot);
    ctx.lineTo(x - half, yBot);
    ctx.closePath();
  }
  ctx.rect(x - tw * 0.04, base - th * 0.12, tw * 0.08, th * 0.12);
  ctx.fill();
  if (rim) {
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - tw * 0.18, base - th * 0.62);
    ctx.lineTo(x, base - th * 1.0);
    ctx.lineTo(x + tw * 0.18, base - th * 0.62);
    ctx.stroke();
  }
}

function starField(w, h) {
  return sprite(`ui:stars:${w}:${h}`, w, h, (ctx) => {
    const n = Math.floor((w * h) / 2600);
    for (let i = 0; i < n; i++) {
      const x = hash01(i, 11, 7) * w;
      const y = Math.pow(hash01(i, 12, 7), 1.6) * h;
      const b = hash01(i, 13, 7);
      ctx.fillStyle = `rgba(${200 + b * 55 | 0},${210 + b * 45 | 0},255,${0.25 + b * 0.6})`;
      const s = b > 0.92 ? 2 : b > 0.6 ? 1.4 : 1;
      ctx.fillRect(x, y, s, s);
    }
  });
}

function tiled(ctx, img, offset, y, viewW, snap = false) {
  const w = img.width;
  let x = -(((offset % w) + w) % w);
  if (snap) x = Math.floor(x); // целые пиксели: без шва между плитками и без дорогой фильтрации
  for (; x < viewW; x += w) ctx.drawImage(img, x, y);
}

// ---------- Поезд в профиль ----------
/**
 * Нарисовать поезд сбоку: (fx, ry) — передний край локомотива и верх рельса; sc — масштаб; t — время;
 * o: {moving, wagons, wheel (фаза колёс), dim 0..1, glowWindows}
 */
export function drawTrainSide(ctx, fx, ry, sc, t, o = {}) {
  const wagons = o.wagons ?? 6;
  const wheelA = o.wheel ?? 0;
  const dim = o.dim ?? 0;
  const bob = o.moving ? Math.sin(t * 9) * 0.8 * sc : 0;
  ctx.save();
  ctx.translate(0, bob);
  // вагоны (справа налево за кабиной)
  let x = fx - 175 * sc;
  for (let i = 0; i < wagons; i++) {
    const L = 150 * sc;
    const wx = x - L;
    drawWagon(ctx, wx, ry, L, sc, t, i, WAGON_TINTS[i % WAGON_TINTS.length], wheelA, dim, o);
    // сцепка
    ctx.fillStyle = '#1a1830';
    ctx.fillRect(x - 2 * sc, ry - 22 * sc, 12 * sc, 3 * sc);
    x = wx - 10 * sc;
  }
  drawLoco(ctx, fx, ry, sc, t, wheelA, dim, o);
  ctx.restore();
}

function wheel(ctx, x, y, r, a, color) {
  ctx.fillStyle = '#0b0a16';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.8, r * 0.08);
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const b = a + (k / 6) * Math.PI * 2;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(b) * r * 0.85, y + Math.sin(b) * r * 0.85);
  }
  ctx.stroke();
}

function drawWagon(ctx, x, ry, L, sc, t, i, tint, wheelA, dim, o) {
  const top = ry - 66 * sc;
  const bot = ry - 18 * sc;
  const H = bot - top;
  // тень/корпус
  ctx.fillStyle = mix('#0d0f22', '#000000', dim * 0.5);
  roundRect(ctx, x, top, L, H, 6 * sc);
  ctx.fill();
  // крыша
  ctx.fillStyle = '#151634';
  ctx.beginPath();
  ctx.moveTo(x + 4 * sc, top + 2 * sc);
  ctx.quadraticCurveTo(x + L / 2, top - 10 * sc, x + L - 4 * sc, top + 2 * sc);
  ctx.closePath();
  ctx.fill();
  // окна
  const nW = 4;
  const ww = 20 * sc;
  const wh = 17 * sc;
  for (let k = 0; k < nW; k++) {
    const wx = x + 16 * sc + k * ((L - 32 * sc - ww) / (nW - 1));
    const wy = top + 12 * sc;
    const seed = i * 7 + k;
    const lit = hash01(seed, 5, 3) > 0.12;
    const flick = 0.82 + Math.sin(t * (2 + hash01(seed, 6, 3) * 3) + seed) * 0.08 + (hash01(Math.floor(t * 8), seed, 9) > 0.97 ? -0.25 : 0);
    if (lit) {
      const a = (1 - dim * 0.6) * flick;
      drawGlow(ctx, wx + ww / 2, wy + wh / 2, 26 * sc, '#ffb85a', 0.35 * a);
      const g = ctx.createLinearGradient(0, wy, 0, wy + wh);
      g.addColorStop(0, rgba('#ffe2a0', a));
      g.addColorStop(1, rgba('#ff9a3a', a));
      ctx.fillStyle = g;
    } else ctx.fillStyle = '#121430';
    roundRect(ctx, wx, wy, ww, wh, 3 * sc);
    ctx.fill();
    // силуэт в окне
    if (lit && hash01(seed, 8, 3) > 0.62) {
      const sx = wx + ww * (0.3 + 0.4 * hash01(seed, 9, 3)) + Math.sin(t * 0.7 + seed) * 2 * sc;
      ctx.fillStyle = 'rgba(30,14,10,0.75)';
      ctx.beginPath();
      ctx.arc(sx, wy + wh * 0.5, 3.6 * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(sx - 5 * sc, wy + wh * 0.68, 10 * sc, wh * 0.32);
    }
    ctx.strokeStyle = rgba(tint, 0.5);
    ctx.lineWidth = 1;
    roundRect(ctx, wx, wy, ww, wh, 3 * sc);
    ctx.stroke();
  }
  // неоновый контур
  ctx.strokeStyle = rgba(tint, 0.25 * (1 - dim));
  ctx.lineWidth = 4 * sc;
  roundRect(ctx, x, top, L, H, 6 * sc);
  ctx.stroke();
  ctx.strokeStyle = rgba(tint, 0.9 - dim * 0.5);
  ctx.lineWidth = 1.3 * sc;
  roundRect(ctx, x, top, L, H, 6 * sc);
  ctx.stroke();
  // полоса-руны
  ctx.fillStyle = rgba(tint, 0.6 - dim * 0.3);
  for (let k = 0; k < 9; k++) ctx.fillRect(x + 10 * sc + k * (L - 20 * sc) / 9, bot - 7 * sc, 6 * sc, 1.5 * sc);
  // тележки
  for (const bx of [x + 26 * sc, x + L - 26 * sc]) {
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(bx - 18 * sc, bot - 2 * sc, 36 * sc, 6 * sc);
    wheel(ctx, bx - 10 * sc, ry - 8 * sc, 8 * sc, wheelA, rgba(tint, 0.7));
    wheel(ctx, bx + 10 * sc, ry - 8 * sc, 8 * sc, wheelA + 0.6, rgba(tint, 0.7));
  }
  // отсвет окон на земле
  if (!o.noGround) drawGlow(ctx, x + L / 2, ry + 8 * sc, L * 0.45, '#ff9a3a', 0.08 * (1 - dim));
}

function drawLoco(ctx, fx, ry, sc, t, wheelA, dim, o) {
  const cabX = fx - 175 * sc;
  const cabW = 58 * sc;
  // кабина
  ctx.fillStyle = '#0f1126';
  roundRect(ctx, cabX, ry - 84 * sc, cabW, 66 * sc, 5 * sc);
  ctx.fill();
  ctx.fillStyle = '#18183a';
  ctx.fillRect(cabX - 4 * sc, ry - 88 * sc, cabW + 8 * sc, 6 * sc);
  // окно кабины
  const fl = 0.85 + Math.sin(t * 11) * 0.06 + Math.sin(t * 3.1) * 0.05;
  drawGlow(ctx, cabX + cabW / 2, ry - 62 * sc, 34 * sc, '#ff9f43', 0.5 * fl * (1 - dim * 0.6));
  ctx.fillStyle = rgba('#ffcf7a', fl * (1 - dim * 0.5));
  roundRect(ctx, cabX + 12 * sc, ry - 74 * sc, cabW - 24 * sc, 22 * sc, 3 * sc);
  ctx.fill();
  // котёл
  const bx = cabX + cabW - 2 * sc;
  const bw = fx - 14 * sc - bx;
  ctx.fillStyle = '#10142a';
  roundRect(ctx, bx, ry - 66 * sc, bw, 40 * sc, 18 * sc);
  ctx.fill();
  ctx.strokeStyle = rgba('#5ef2ff', 0.25 * (1 - dim));
  ctx.lineWidth = 4 * sc;
  roundRect(ctx, bx, ry - 66 * sc, bw, 40 * sc, 18 * sc);
  ctx.stroke();
  ctx.strokeStyle = rgba('#5ef2ff', 0.95 - dim * 0.5);
  ctx.lineWidth = 1.4 * sc;
  roundRect(ctx, bx, ry - 66 * sc, bw, 40 * sc, 18 * sc);
  ctx.stroke();
  ctx.strokeStyle = rgba('#5ef2ff', 0.9 - dim * 0.5);
  roundRect(ctx, cabX, ry - 84 * sc, cabW, 66 * sc, 5 * sc);
  ctx.stroke();
  // обручи котла
  ctx.strokeStyle = rgba('#5ef2ff', 0.35);
  ctx.lineWidth = 1;
  for (let k = 1; k < 4; k++) {
    const hx = bx + (bw * k) / 4;
    ctx.beginPath();
    ctx.moveTo(hx, ry - 64 * sc);
    ctx.lineTo(hx, ry - 28 * sc);
    ctx.stroke();
  }
  // рунное ядро
  const pulse = 0.75 + Math.sin(t * 3.2) * 0.25;
  const rx = bx + bw * 0.42;
  const rcy = ry - 46 * sc;
  drawGlow(ctx, rx, rcy, 30 * sc, '#5ef2ff', 0.55 * pulse * (1 - dim * 0.5));
  ctx.strokeStyle = rgba('#c8f6ff', 0.9);
  ctx.lineWidth = 1.2 * sc;
  ctx.beginPath();
  ctx.moveTo(rx, rcy - 9 * sc);
  ctx.lineTo(rx + 7 * sc, rcy);
  ctx.lineTo(rx, rcy + 9 * sc);
  ctx.lineTo(rx - 7 * sc, rcy);
  ctx.closePath();
  ctx.moveTo(rx - 3 * sc, rcy);
  ctx.lineTo(rx + 3 * sc, rcy);
  ctx.stroke();
  // труба
  const chX = fx - 50 * sc;
  ctx.fillStyle = '#121433';
  ctx.beginPath();
  ctx.moveTo(chX - 7 * sc, ry - 64 * sc);
  ctx.lineTo(chX - 10 * sc, ry - 92 * sc);
  ctx.lineTo(chX + 10 * sc, ry - 92 * sc);
  ctx.lineTo(chX + 7 * sc, ry - 64 * sc);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba('#ff4fd8', 0.85 - dim * 0.4);
  ctx.lineWidth = 1.2 * sc;
  ctx.stroke();
  // путеочиститель
  ctx.fillStyle = '#0c0d1e';
  ctx.beginPath();
  ctx.moveTo(fx - 14 * sc, ry - 30 * sc);
  ctx.lineTo(fx + 6 * sc, ry - 2 * sc);
  ctx.lineTo(fx - 14 * sc, ry - 2 * sc);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba('#ff4fd8', 0.7);
  ctx.stroke();
  // фонарь и луч
  const lx = fx - 10 * sc;
  const ly = ry - 50 * sc;
  if (o.headlight !== false) {
    const g = ctx.createLinearGradient(lx, 0, lx + 360 * sc, 0);
    g.addColorStop(0, `rgba(255,240,200,${0.22 * (1 - dim)})`);
    g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(lx, ly - 4 * sc);
    ctx.lineTo(lx + 360 * sc, ly - 50 * sc);
    ctx.lineTo(lx + 360 * sc, ly + 70 * sc);
    ctx.lineTo(lx, ly + 5 * sc);
    ctx.closePath();
    ctx.fill();
  }
  drawGlow(ctx, lx, ly, 22 * sc, '#fff3d0', 0.9 * (1 - dim * 0.5));
  ctx.fillStyle = '#fffbe8';
  ctx.beginPath();
  ctx.arc(lx, ly, 3.5 * sc, 0, Math.PI * 2);
  ctx.fill();
  // ведущие колёса + дышло
  const wy = ry - 13 * sc;
  const wxs = [cabX + 20 * sc, cabX + 62 * sc, cabX + 104 * sc];
  for (const wx of wxs) wheel(ctx, wx, wy, 13 * sc, wheelA, rgba('#5ef2ff', 0.8));
  const ca = wheelA;
  const ox = Math.cos(ca) * 7 * sc;
  const oy = Math.sin(ca) * 7 * sc;
  ctx.strokeStyle = rgba('#c8f6ff', 0.8);
  ctx.lineWidth = 2 * sc;
  ctx.beginPath();
  ctx.moveTo(wxs[0] + ox, wy + oy);
  ctx.lineTo(wxs[2] + ox, wy + oy);
  ctx.stroke();
}

// ---------- Главное меню: ночной лес и поезд ----------
// Производительность (программный растр headless-Chromium: градиенты, масштаб и дробные координаты в drawImage
// в ~10 раз дороже целочисленного копирования 1:1): статичные слои — кэш-канвасы на размер экрана (небо со
// звёздами и луной — непрозрачный; сияние перерисовывается в него ~10 раз в секунду; насыпь с рельсами;
// виньетка); дымка запечена в полосу дальнего леса, туман — в полосу кустарника (наложение «поверх»
// ассоциативно — картинка та же); полосы и свечения дыма/тумана/рун — в целых пикселях без масштаба.
const FW = 1400;
const FAR = { color: '#140f30', rim: 'rgba(120,90,220,0.35)', density: 1.6, minH: 0.45, maxH: 0.95, seed: 3 };
const MID = { color: '#090718', rim: 'rgba(94,242,255,0.22)', density: 1.1, minH: 0.5, maxH: 1, seed: 9 };
const NEAR = { color: '#030209', rim: 'rgba(108,92,255,0.18)', density: 2.2, minH: 0.25, maxH: 0.7, seed: 17 };
const AURORA_DT = 0.1; // с: сияние ползёт медленно (≤ 7 px/с) — перерисовка 10 раз в секунду незаметна

/** Масштаб контекста (dpr) — кэши рисуются в пикселях устройства. */
function ctxScale(ctx) {
  const a = ctx.getTransform?.().a;
  return Number.isFinite(a) && a > 0 ? Math.min(2, a) : 1;
}

/** Кэш-слой экрана: draw(ctx) рисует в координатах экрана (CSS px), полоса [y0, y0 + hh) по высоте. */
function screenLayer(key, w, hh, y0, s, draw) {
  return sprite(`ui:menu:${key}:${w}:${hh}:${y0}:${s}`, w * s, hh * s, (ctx) => {
    ctx.setTransform(s, 0, 0, s, 0, -y0 * s);
    draw(ctx);
  });
}

/** Свой непрозрачный канвас размера экрана (копируется без смешивания). */
function opaqueCanvas(holder, key, w, h, s) {
  const cw = Math.max(1, Math.ceil(w * s));
  const ch = Math.max(1, Math.ceil(h * s));
  let e = holder[key];
  if (!e || e.c.width !== cw || e.c.height !== ch) {
    const c = makeCanvas(cw, ch);
    e = holder[key] = { c, ctx: c.getContext('2d', { alpha: false }), at: -1e9 };
  }
  e.ctx.setTransform(s, 0, 0, s, 0, 0);
  return e;
}

/** Свечение без масштабирования: спрайт (радиус кратен 8) в целых пикселях; мелкие (заметна разница
 * радиусов) — обычным drawGlow, они дешёвые. */
function glowPx(ctx, x, y, r, color, alpha) {
  if (!(alpha > 0.01) || !(r > 0)) return;
  const sp = glowSprite(color, r);
  const R = sp.width / 2;
  if (R > r * 1.15) return drawGlow(ctx, x, y, r, color, alpha);
  const prevOp = ctx.globalCompositeOperation;
  const prevA = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = prevA * Math.min(1, alpha);
  ctx.drawImage(sp, Math.round(x - R), Math.round(y - R));
  ctx.globalAlpha = prevA;
  ctx.globalCompositeOperation = prevOp;
}

export class MenuScene {
  constructor() {
    this.smoke = [];
    this.sparks = [];
    this.smokeT = 0;
    this.flies = [];
    this.canv = {};
    for (let i = 0; i < 18; i++) this.flies.push({ x: Math.random(), y: 0.55 + Math.random() * 0.4, p: Math.random() * 10, s: 0.4 + Math.random() });
  }

  draw(ctx, w, h, t, dt) {
    const s = ctxScale(ctx);
    const horizon = h * 0.66;
    // небо, звёзды, луна (статично) + северное сияние (перерисовка ~10 раз/с)
    const sky = opaqueCanvas(this.canv, 'sky', w, h, s);
    if (Math.abs(t - sky.at) >= AURORA_DT) {
      sky.at = t;
      const c = sky.ctx;
      c.drawImage(screenLayer('sky', w, h, 0, s, (x) => drawSky(x, w, h, horizon)), 0, 0, w, h);
      drawAurora(c, w, h, t);
      drawMoon(c, w, h);
    }
    ctx.drawImage(sky.c, 0, 0, w, h);
    // мерцающие звёзды
    for (let i = 0; i < 9; i++) {
      const x = hash01(i, 21, 5) * w;
      const y = hash01(i, 22, 5) * horizon * 0.7;
      glowPx(ctx, x, y, 7, '#cfe0ff', 0.25 + 0.25 * Math.sin(t * (1 + i * 0.3) + i));
    }
    // дальний лес + дымка у горизонта
    const farH = Math.ceil((h * 0.3) / 20) * 20;
    const farY = Math.floor(horizon - farH + h * 0.02);
    const farHH = Math.ceil(horizon + h * 0.06) - farY;
    const far = sprite(`ui:menu:far:${h}:${farH}`, FW, farHH, (c) => {
      c.drawImage(forestStrip('far', FW, farH, FAR), 0, horizon - farH + h * 0.02 - farY);
      c.translate(0, -farY);
      const mist = c.createLinearGradient(0, horizon - h * 0.1, 0, horizon + h * 0.06);
      mist.addColorStop(0, 'rgba(120,80,200,0)');
      mist.addColorStop(0.6, 'rgba(120,80,200,0.16)');
      mist.addColorStop(1, 'rgba(40,20,80,0)');
      c.fillStyle = mist;
      c.fillRect(0, horizon - h * 0.1, FW, h * 0.16);
    });
    tiled(ctx, far, t * 14, farY, w, true);
    // ближний лес
    const midH = Math.ceil((h * 0.36) / 20) * 20;
    tiled(ctx, forestStrip('mid', FW, midH, MID), t * 46, Math.round(h * 0.76 - midH), w, true);
    // насыпь и рельсы — статичный слой; шпалы бегут
    const ry = h * 0.83;
    const gY = Math.floor(h * 0.75);
    ctx.drawImage(screenLayer('ground', w, h - gY, gY, s, (c) => drawGround(c, w, h, ry)), 0, gY, w, h - gY);
    const speed = 260;
    const off = (t * speed) % 28;
    ctx.fillStyle = '#16122a';
    for (let x = -off; x < w; x += 28) ctx.fillRect(x, ry + 1, 16, 6);
    // руны на рельсах
    for (let k = 0; k < 10; k++) {
      const x = ((k * 197 - t * speed) % (w + 200) + w + 200) % (w + 200) - 100;
      glowPx(ctx, x, ry, 12, '#5ef2ff', 0.25);
    }
    // поезд
    const sc = Math.max(0.6, Math.min(1.6, h / 620));
    const fx = w * 0.74;
    const wheelA = t * speed / (13 * sc);
    drawTrainSide(ctx, fx, ry, sc, t, { moving: true, wagons: Math.ceil((fx / (160 * sc))) + 1, wheel: wheelA });
    this._particles(ctx, fx, ry, sc, t, dt);
    // передний план: низкий кустарник у насыпи (быстро уходит назад) + туман снизу — одна полоса
    const nearH = Math.ceil((h * 0.12) / 20) * 20;
    const fogY = Math.floor(h * 0.82);
    const nearHH = h + 4 - fogY;
    const near = sprite(`ui:menu:near:${h}:${nearH}`, FW, nearHH, (c) => {
      c.globalAlpha = 0.85;
      c.drawImage(forestStrip('near', FW, nearH, NEAR), 0, h - nearH + 4 - fogY);
      c.globalAlpha = 1;
      c.translate(0, -fogY);
      const fog = c.createLinearGradient(0, h * 0.82, 0, h);
      fog.addColorStop(0, 'rgba(30,24,60,0)');
      fog.addColorStop(1, 'rgba(30,24,60,0.55)');
      c.fillStyle = fog;
      c.fillRect(0, h * 0.82, FW, h * 0.18);
      c.fillStyle = 'rgba(30,24,60,0.55)';
      c.fillRect(0, h, FW, 4);
    });
    tiled(ctx, near, t * 520, fogY, w, true);
    // клубы тумана
    for (let k = 0; k < 6; k++) {
      const x = ((k * 330 - t * 30) % (w + 400) + w + 400) % (w + 400) - 200;
      glowPx(ctx, x, h * (0.9 + 0.03 * Math.sin(k + t * 0.2)), 220, '#3a2d6a', 0.22);
    }
    // светлячки
    for (const f of this.flies) {
      const x = ((f.x * w + Math.sin(t * 0.3 * f.s + f.p) * 60) % w + w) % w;
      const y = f.y * h + Math.sin(t * 0.7 * f.s + f.p * 2) * 18;
      glowPx(ctx, x, y, 9, '#d6ff7a', 0.25 + 0.35 * Math.max(0, Math.sin(t * 1.3 * f.s + f.p)));
    }
    // виньетка — статичный слой
    ctx.drawImage(screenLayer('vignette', w, h, 0, s, (c) => {
      const vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.6)');
      c.fillStyle = vg;
      c.fillRect(0, 0, w, h);
    }), 0, 0, w, h);
  }

  _particles(ctx, fx, ry, sc, t, dt) {
    const d = Math.min(0.05, Math.max(0, dt || 0.016));
    this.smokeT += d;
    while (this.smokeT > 0.07) {
      this.smokeT -= 0.07;
      this.smoke.push({ x: fx - 50 * sc, y: ry - 94 * sc, vx: -120 - Math.random() * 60, vy: -30 - Math.random() * 25, r: 8 * sc, life: 0, max: 2.6 + Math.random() });
      if (Math.random() < 0.5) this.sparks.push({ x: fx - 175 * sc + Math.random() * 120 * sc, y: ry - 2, vx: -200 - Math.random() * 200, vy: -40 - Math.random() * 80, life: 0, max: 0.4 + Math.random() * 0.4 });
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.life += d;
      if (p.life > p.max) {
        this.smoke.splice(i, 1);
        continue;
      }
      p.x += p.vx * d;
      p.y += p.vy * d;
      p.vy *= 0.985;
      p.r += 16 * sc * d;
      const a = (1 - p.life / p.max) * 0.22;
      glowPx(ctx, p.x, p.y, p.r * 2.2, '#8a7ac8', a);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.life += d;
      if (p.life > p.max) {
        this.sparks.splice(i, 1);
        continue;
      }
      p.x += p.vx * d;
      p.y += p.vy * d;
      p.vy += 300 * d;
      glowPx(ctx, p.x, p.y, 5, '#ffb347', 1 - p.life / p.max);
    }
    if (this.smoke.length > 80) this.smoke.splice(0, this.smoke.length - 80);
    if (this.sparks.length > 60) this.sparks.splice(0, this.sparks.length - 60);
    void t;
  }
}

function drawSky(ctx, w, h, horizon) {
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#03040d');
  sky.addColorStop(0.55, '#0b0a26');
  sky.addColorStop(1, '#251040');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const sw = Math.ceil(w / 100) * 100;
  const sh = Math.ceil(horizon / 50) * 50;
  ctx.globalAlpha = 0.9;
  ctx.drawImage(starField(sw, sh), 0, 0);
  ctx.globalAlpha = 1;
  // луна
  const mx = w * 0.8;
  const my = h * 0.17;
  const mr = h * 0.045;
  drawGlow(ctx, mx, my, mr * 7, '#9fb8ff', 0.35);
  drawGlow(ctx, mx, my, mr * 2.4, '#e6eeff', 0.5);
}

/** Диск луны (поверх сияния). */
function drawMoon(ctx, w, h) {
  const mx = w * 0.8;
  const my = h * 0.17;
  const mr = h * 0.045;
  ctx.fillStyle = '#eef3ff';
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0d0b26';
  ctx.beginPath();
  ctx.arc(mx + mr * 0.45, my - mr * 0.2, mr * 0.92, 0, Math.PI * 2);
  ctx.fill();
}

function drawAurora(ctx, w, h, t) {
  ctx.globalCompositeOperation = 'lighter';
  for (let b = 0; b < 2; b++) {
    const col = b ? '#ff4fd8' : '#3dffc5';
    ctx.beginPath();
    const base = h * (0.2 + b * 0.07);
    ctx.moveTo(0, base);
    for (let x = 0; x <= w; x += w / 24) ctx.lineTo(x, base + Math.sin(x * 0.004 + t * 0.15 + b) * h * 0.04 + Math.sin(x * 0.011 - t * 0.1) * h * 0.015);
    ctx.lineTo(w, base + h * 0.12);
    ctx.lineTo(0, base + h * 0.12);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, base - h * 0.02, 0, base + h * 0.12);
    g.addColorStop(0, rgba(col, 0));
    g.addColorStop(0.3, rgba(col, 0.06));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawGround(ctx, w, h, ry) {
  ctx.fillStyle = '#05040c';
  ctx.fillRect(0, h * 0.75, w, h * 0.25);
  const grd = ctx.createLinearGradient(0, h * 0.75, 0, ry);
  grd.addColorStop(0, 'rgba(60,40,120,0.18)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, h * 0.75, w, ry - h * 0.75);
  ctx.fillStyle = '#3a3f66';
  ctx.fillRect(0, ry - 1, w, 2);
  ctx.fillStyle = rgba('#5ef2ff', 0.35);
  ctx.fillRect(0, ry - 2, w, 1);
}

// ---------- Перрон отбора ----------
/** Фон перрона: небо, стоящий поезд, платформа. @returns {{ry, floorY}} */
export function drawPlatformBg(ctx, w, h, t) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
  sky.addColorStop(0, '#03040d');
  sky.addColorStop(1, '#1a0f36');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.7;
  const sw = Math.ceil(w / 100) * 100;
  const sh = Math.ceil((h * 0.5) / 50) * 50;
  ctx.drawImage(starField(sw, sh), 0, 0);
  ctx.globalAlpha = 1;
  const farH = Math.ceil((h * 0.26) / 20) * 20;
  tiled(ctx, forestStrip('far', 1400, farH, { color: '#140f30', rim: 'rgba(120,90,220,0.35)', density: 1.6, minH: 0.45, maxH: 0.95, seed: 3 }), 0, h * 0.5 - farH, w);
  // поезд стоит у перрона
  const ry = h * 0.6;
  const sc = Math.max(0.55, Math.min(1.3, h / 760));
  drawTrainSide(ctx, w * 0.92, ry, sc, t, { moving: false, wagons: Math.ceil(w / (160 * sc)) + 1, wheel: 0, dim: 0.35, headlight: false, noGround: true });
  // платформа
  const floorY = ry + 6;
  const pg = ctx.createLinearGradient(0, floorY, 0, h);
  pg.addColorStop(0, '#15122a');
  pg.addColorStop(1, '#07060f');
  ctx.fillStyle = pg;
  ctx.fillRect(0, floorY, w, h - floorY);
  // жёлтая линия края
  ctx.fillStyle = rgba('#ffd27a', 0.55);
  ctx.fillRect(0, floorY + 4, w, 3);
  drawGlow(ctx, w / 2, floorY + 6, w * 0.4, '#ffd27a', 0.04);
  // доски
  ctx.strokeStyle = 'rgba(108,92,255,0.08)';
  ctx.lineWidth = 1;
  for (let k = 1; k < 7; k++) {
    const y = floorY + 10 + Math.pow(k / 7, 1.6) * (h - floorY);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  return { ry, floorY };
}

/** Туман у краёв (куда уходят люди). */
export function drawPlatformFog(ctx, w, h, t) {
  for (let k = 0; k < 7; k++) {
    const side = k % 2 ? w * 1.02 : -w * 0.02;
    const x = side + Math.sin(t * 0.25 + k) * 60;
    drawGlow(ctx, x, h * (0.62 + k * 0.05), 260 + k * 20, '#4a3d80', 0.2);
  }
  const fog = ctx.createLinearGradient(0, h * 0.85, 0, h);
  fog.addColorStop(0, 'rgba(30,24,60,0)');
  fog.addColorStop(1, 'rgba(30,24,60,0.5)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, h * 0.85, w, h * 0.15);
}

/** Фонарный столб с конусом света. */
export function drawLamp(ctx, x, floorY, H, t, i) {
  const top = floorY - H;
  const fl = 0.9 + Math.sin(t * 7 + i * 3) * 0.04 + (hash01(Math.floor(t * 6), i, 4) > 0.985 ? -0.4 : 0);
  // конус
  const g = ctx.createLinearGradient(0, top, 0, floorY + 30);
  g.addColorStop(0, `rgba(255,214,140,${0.22 * fl})`);
  g.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - 10, top + 8);
  ctx.lineTo(x + 10, top + 8);
  ctx.lineTo(x + H * 0.42, floorY + 30);
  ctx.lineTo(x - H * 0.42, floorY + 30);
  ctx.closePath();
  ctx.fill();
  // пятно на полу
  ctx.save();
  ctx.translate(x, floorY + 22);
  ctx.scale(1, 0.22);
  drawGlow(ctx, 0, 0, H * 0.5, '#ffd28c', 0.4 * fl);
  ctx.restore();
  // столб
  ctx.fillStyle = '#0c0b18';
  ctx.fillRect(x - 2.5, top, 5, H + 22);
  ctx.strokeStyle = 'rgba(255,210,122,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 2.5, top, 5, H + 22);
  // фонарь
  ctx.fillStyle = '#1c1830';
  ctx.beginPath();
  ctx.moveTo(x - 12, top + 4);
  ctx.lineTo(x + 12, top + 4);
  ctx.lineTo(x + 7, top - 12);
  ctx.lineTo(x - 7, top - 12);
  ctx.closePath();
  ctx.fill();
  drawGlow(ctx, x, top + 2, 46, '#ffc874', 0.75 * fl);
  ctx.fillStyle = `rgba(255,236,190,${fl})`;
  ctx.fillRect(x - 6, top - 2, 12, 6);
}

/**
 * Силуэт с чемоданом. phase: {walk (смещение по x), alpha, carry 0..1 (чемодан в руке), step (фаза шага)}
 * hover/selected — подсветка контура.
 */
export function drawSilhouette(ctx, x, floorY, hgt, o = {}) {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= a;
  const walk = o.walk || 0;
  const step = o.step || 0;
  const cx = x + walk;
  const s = hgt / 120;
  const legSw = Math.sin(step) * 8 * s * (o.walking ? 1 : 0);
  const body = '#07060d';
  const rim = o.selected ? '#5ef2ff' : o.hover ? '#ffe2a0' : 'rgba(255,214,140,0.55)';
  // ноги
  ctx.strokeStyle = body;
  ctx.lineCap = 'round';
  ctx.lineWidth = 7 * s;
  ctx.beginPath();
  ctx.moveTo(cx - 5 * s, floorY - 48 * s);
  ctx.lineTo(cx - 6 * s + legSw, floorY);
  ctx.moveTo(cx + 5 * s, floorY - 48 * s);
  ctx.lineTo(cx + 6 * s - legSw, floorY);
  ctx.stroke();
  // пальто
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx - 16 * s, floorY - 40 * s);
  ctx.quadraticCurveTo(cx - 19 * s, floorY - 86 * s, cx - 10 * s, floorY - 94 * s);
  ctx.lineTo(cx + 10 * s, floorY - 94 * s);
  ctx.quadraticCurveTo(cx + 19 * s, floorY - 86 * s, cx + 16 * s, floorY - 40 * s);
  ctx.closePath();
  ctx.fill();
  // голова + шляпа/волосы
  ctx.beginPath();
  ctx.arc(cx, floorY - 104 * s, 10 * s, 0, Math.PI * 2);
  ctx.fill();
  if (o.hat) {
    ctx.fillRect(cx - 14 * s, floorY - 112 * s, 28 * s, 3 * s);
    ctx.fillRect(cx - 8 * s, floorY - 122 * s, 16 * s, 10 * s);
  }
  // контур света сверху
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, floorY - 104 * s, 10 * s, Math.PI * 1.1, Math.PI * 1.9);
  ctx.moveTo(cx - 10 * s, floorY - 94 * s);
  ctx.lineTo(cx + 10 * s, floorY - 94 * s);
  ctx.stroke();
  if (o.selected || o.hover) {
    ctx.strokeStyle = rgba(o.selected ? '#5ef2ff' : '#ffe2a0', 0.7);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 16 * s, floorY - 40 * s);
    ctx.quadraticCurveTo(cx - 19 * s, floorY - 86 * s, cx - 10 * s, floorY - 94 * s);
    ctx.moveTo(cx + 16 * s, floorY - 40 * s);
    ctx.quadraticCurveTo(cx + 19 * s, floorY - 86 * s, cx + 10 * s, floorY - 94 * s);
    ctx.stroke();
  }
  // чемодан: стоит рядом (carry 0) → в руке (carry 1)
  const c = o.carry || 0;
  const sx = cx + (24 - c * 6) * s;
  const sy = floorY - (16 + c * 22) * s;
  ctx.fillStyle = o.caseColor || '#3a2418';
  roundRect(ctx, sx - 13 * s, sy - 14 * s + (c ? 6 * s : 0), 26 * s, 20 * s, 3 * s);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,214,140,0.45)';
  ctx.lineWidth = 1;
  roundRect(ctx, sx - 13 * s, sy - 14 * s + (c ? 6 * s : 0), 26 * s, 20 * s, 3 * s);
  ctx.stroke();
  ctx.strokeStyle = body;
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.arc(sx, sy - 14 * s + (c ? 6 * s : 0), 5 * s, Math.PI, 0);
  ctx.stroke();
  if (c > 0.5) {
    ctx.strokeStyle = body;
    ctx.lineWidth = 5 * s;
    ctx.beginPath();
    ctx.moveTo(cx + 12 * s, floorY - 82 * s);
    ctx.lineTo(sx, sy - 18 * s + 6 * s);
    ctx.stroke();
  }
  ctx.restore();
}
