// Цветовые помощники для отрисовки.
// Принимают '#rgb', '#rgba', '#rrggbb', '#rrggbbaa', 'rgb(r,g,b)', 'rgba(r,g,b,a)'; всё прочее → белый
// (без исключений: неверный цвет модуля не должен ронять слой отрисовки).
// Кэши ограничены по размеру — но всё равно квантуйте «плавающие» цвета (mix с непрерывным t) перед
// передачей в glowSprite/частицы: каждый новый цвет — новый спрайт.

const RGB_CACHE_MAX = 4096;
const rgbCache = new Map();

function parseColor(str) {
  if (typeof str !== 'string') return [255, 255, 255];
  const s = str.trim();
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((x) => x + x).join('');
    if (h.length >= 6) {
      const n = parseInt(h.slice(0, 6), 16);
      if (Number.isFinite(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return [255, 255, 255];
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(Number(v)) || 0)));
  return [255, 255, 255];
}

/** Цвет → [r, g, b] (0..255). */
export function hexToRgb(hex) {
  let c = rgbCache.get(hex);
  if (c) return c;
  c = parseColor(hex);
  if (rgbCache.size >= RGB_CACHE_MAX) rgbCache.clear();
  rgbCache.set(hex, c);
  return c;
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Смешать два цвета, t ∈ [0,1] → '#rrggbb'. */
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  t = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const r = Math.round(A[0] + (B[0] - A[0]) * t);
  const g = Math.round(A[1] + (B[1] - A[1]) * t);
  const bb = Math.round(A[2] + (B[2] - A[2]) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bb).toString(16).slice(1);
}

export function lighten(hex, t) {
  return mix(hex, '#ffffff', t);
}

export function darken(hex, t) {
  return mix(hex, '#000000', t);
}
