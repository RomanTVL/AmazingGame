// Детерминированный 2D value-noise + fbm. Без состояния: зависит только от seed.
import { hash2 } from './math.js';

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise в [0,1]. */
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi, seed) / 4294967296;
  const b = hash2(xi + 1, yi, seed) / 4294967296;
  const c = hash2(xi, yi + 1, seed) / 4294967296;
  const d = hash2(xi + 1, yi + 1, seed) / 4294967296;
  const u = fade(xf);
  const v = fade(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Фрактальный шум (сумма октав) в [0,1]. */
export function fbm(x, y, seed = 0, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
