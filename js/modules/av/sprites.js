// av — генератор спрайтов персонажей (вид сверху): тело (одежда, руки, ноги — кадры ходьбы и позы),
// голова (кожа, причёски, бороды, белые пряди метки), лежачая поза, белые силуэты для вспышек.
// Все спрайты кэшируются (js/engine/assets.js: sprite(key, ...)) по позе/кадру/палитре; свечение контура —
// shadowBlur ТОЛЬКО при запекании спрайта. Спрайт смотрит вправо (+x) — при выводе поворачивается на pawn.dir.
import { sprite } from '../../engine/assets.js';
import { mix, rgba, hexToRgb, lighten } from '../../render/color.js';
import { hid, clamp01 } from './util.js';

export const SS = 2; // пикселей спрайта на мировой пиксель
export const BODY = 44; // размер спрайта тела (мировые px)
export const HEAD = 24;

export const SKIN_TONES = ['#f2d4ba', '#e6bf9c', '#d2a27c', '#b07c56', '#8a5a3a', '#653f28'];
const HAIR_M = ['short', 'short', 'crop', 'long', 'mohawk', 'bald', 'curly', 'ponytail', 'crop'];
const HAIR_F = ['long', 'bun', 'braid', 'ponytail', 'curly', 'short', 'long', 'bun'];
const BEARDS = ['stubble', 'full', 'goatee', 'mustache'];
export const HAIR_STYLES = ['short', 'crop', 'long', 'bun', 'ponytail', 'braid', 'curly', 'mohawk', 'bald'];
export const MARK_STRANDS = 8;

function grey(c) {
  const [r, g, b] = hexToRgb(c);
  const l = Math.round(r * 0.3 + g * 0.55 + b * 0.15);
  const h = l.toString(16).padStart(2, '0');
  return mix(c, `#${h}${h}${h}`, 0.88);
}

/**
 * Внешность пешки (кэш на пешке в _avLook; пересчёт при смене цвета/волос/look/флагов).
 * pawn.look может задавать {skin, hair, beard, clothes, build} (ui/mind) — уважаем.
 */
export function lookOf(game, p) {
  const lk = p.look || {};
  const soot = Math.round(clamp01(Number(p.soot) || 0) * 5);
  const src = `${p.color}|${p.hairColor}|${lk.skin}|${lk.hair}|${lk.beard}|${lk.clothes}|${p.gender}|${p.age}|${p.naked ? 1 : 0}|${soot}|${p.nameless ? 1 : 0}`;
  if (p._avLook && p._avLookSrc === src) return p._avLook;
  const id = p.id | 0;
  const female = p.gender === 'female';
  const skinI = Number.isInteger(lk.skin) ? lk.skin : Math.floor(hid(id, 1) * SKIN_TONES.length);
  let skin = typeof lk.skin === 'string' ? lk.skin : SKIN_TONES[Math.max(0, Math.min(SKIN_TONES.length - 1, skinI))];
  const hairStyle = HAIR_STYLES.includes(lk.hair) ? lk.hair : (female ? HAIR_F : HAIR_M)[Math.floor(hid(id, 2) * (female ? HAIR_F.length : HAIR_M.length))];
  let beard = lk.beard ?? 'none';
  if (lk.beard === undefined && !female && (p.age ?? 30) >= 20 && hid(id, 3) < 0.42) beard = BEARDS[Math.floor(hid(id, 4) * BEARDS.length)];
  const trim0 = typeof p.color === 'string' ? p.color : '#9aa8ff';
  let trim = trim0;
  let cloth = typeof lk.clothes === 'string' ? lk.clothes : mix(trim0, '#0b0d18', 0.74);
  let hair = typeof p.hairColor === 'string' ? p.hairColor : '#3b2a20';
  const s = soot * 0.12;
  if (s > 0) {
    cloth = mix(cloth, '#000000', s);
    skin = mix(skin, '#17110d', s * 0.8);
    trim = mix(trim, '#2a2420', s * 0.7);
  }
  if (p.nameless) {
    cloth = grey(cloth);
    skin = grey(skin);
    trim = grey(trim);
    hair = grey(hair);
  }
  const build = 0.92 + hid(id, 5) * 0.16;
  const look = {
    skin, cloth, trim, hair, hairStyle, beard, build, naked: !!p.naked, soot, grey: !!p.nameless,
    sleeve: mix(cloth, '#000000', 0.25),
  };
  look.key = `${cloth}|${trim}|${skin}|${look.naked ? 1 : 0}|${build.toFixed(2)}`;
  look.hkey = `${skin}|${hair}|${hairStyle}|${beard}`;
  p._avLook = look;
  p._avLookSrc = src;
  return look;
}

// ---------------- тело ----------------
/** Позиции кистей и стоп для позы (мировые px относительно центра, лицом вправо). */
function handsFor(pose, f, build) {
  const w = 8.6 * build;
  const sw = Math.sin((f / 8) * Math.PI * 2) * 3.2;
  switch (pose) {
    case 'walk': return { l: [sw, -w + 0.2], r: [-sw, w - 0.2], feet: [[-sw * 1.1, -3.2], [sw * 1.1, 3.2]] };
    case 'limp': return { l: [sw * 0.6, -w + 0.2], r: [-sw * 0.6, w - 0.2], feet: [[-sw * 1.2, -3.2], [sw * 0.5, 3.2]] };
    case 'sit': return { l: [3.5, -6.5], r: [3.5, 6.5], legs: true };
    case 'carry': return { l: [7, -5], r: [7, 5] };
    case 'shovel': return { l: [6.5, -2.5], r: [2.5, 6] };
    case 'raise': return { l: [1.5, -w], r: [5.5, w + 1.5], rBig: true };
    case 'raise2': return { l: [5.5, -w - 1.5], r: [5.5, w + 1.5], lBig: true, rBig: true };
    case 'stretch': return { l: [-1, -w - 3.5], r: [-1, w + 3.5], lBig: true, rBig: true };
    case 'belly': return { l: [1.5, -w], r: [4.6, 1.8] };
    case 'hug': return { l: [7.5, -7], r: [7.5, 7] };
    case 'pet': return { l: [1.5, -w], r: [8.5, 2.5] };
    case 'hold': return { l: [6.2, -2.6], r: [6.2, 2.6] };
    case 'hairfix': return { l: [1.5, -w], r: [2.5, 3.5], rBig: true };
    default: return { l: [1.5, -w], r: [1.5, w] };
  }
}

export const BODY_POSES = ['stand', 'walk', 'limp', 'sit', 'carry', 'shovel', 'raise', 'raise2', 'stretch', 'belly', 'hug', 'pet', 'hold', 'hairfix'];

export function bodySprite(look, pose, frame = 0) {
  const f = pose === 'walk' || pose === 'limp' ? frame & 7 : 0;
  return sprite(`avb:${look.key}:${pose}:${f}`, BODY * SS, BODY * SS, (ctx) => {
    ctx.scale(SS, SS);
    ctx.translate(BODY / 2, BODY / 2);
    paintBody(ctx, look, pose, f);
  });
}

function paintBody(ctx, look, pose, f) {
  const H = handsFor(pose, f, look.build);
  const rx = 6;
  const ry = 8.6 * look.build;
  const naked = look.naked;
  const skin = look.skin;
  const cloth = naked ? skin : look.cloth;
  const sleeve = naked ? skin : look.sleeve;
  const trim = look.trim;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // стопы (ходьба)
  if (H.feet) {
    ctx.fillStyle = naked ? mix(skin, '#000', 0.25) : '#16131c';
    for (const [x, y] of H.feet) {
      ctx.beginPath();
      ctx.ellipse(x, y, 2.6, 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // ноги сидящего
  if (H.legs) {
    ctx.strokeStyle = naked ? skin : mix(look.cloth, '#000', 0.35);
    ctx.lineWidth = 3.4;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(1, s * 3.2);
      ctx.lineTo(9.5, s * 3.4);
      ctx.stroke();
    }
    ctx.fillStyle = '#16131c';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(10.5, s * 3.4, 1.6, 1.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // руки (рукав → кисть), под туловищем — только «опущенные»
  const arm = (hx, hy, big) => {
    const sy = hy < 0 ? -ry + 1.8 : ry - 1.8;
    ctx.strokeStyle = sleeve;
    ctx.lineWidth = big ? 3.6 : 3.1;
    ctx.beginPath();
    ctx.moveTo(-0.5, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(hx, hy, big ? 2.8 : 2.35, 0, Math.PI * 2);
    ctx.fill();
  };
  // туловище
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = cloth;
  ctx.fill();
  if (!naked) {
    // тень на спине, свет на груди
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(-4, 0, rx, ry * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(lighten(cloth, 0.3), 0.35);
    ctx.beginPath();
    ctx.ellipse(3.5, 0, 2.6, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    // пояс/шов
    ctx.strokeStyle = rgba(trim, 0.35);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(1.2, -ry);
    ctx.lineTo(1.2, ry);
    ctx.stroke();
  } else {
    // нейтральный силуэт: тёмная полоса-шорты поперёк, без анатомии
    ctx.clip();
    ctx.fillStyle = '#2a2230';
    ctx.fillRect(-2.6, -ry - 1, 3.4, ry * 2 + 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(-4, 0, rx, ry * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // неоновый контур (запекается со свечением)
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  if (!naked) {
    ctx.shadowColor = trim;
    ctx.shadowBlur = 5 * SS;
    ctx.strokeStyle = rgba(trim, 0.95);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(lighten(trim, 0.6), 0.5);
    ctx.lineWidth = 0.5;
    ctx.stroke();
  } else {
    ctx.strokeStyle = rgba(mix(skin, '#000', 0.4), 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // воротник
  if (!naked) {
    ctx.strokeStyle = rgba(trim, 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(1.2, 0, 4.4, -0.9, 0.9);
    ctx.stroke();
  }
  arm(H.l[0], H.l[1], H.lBig);
  arm(H.r[0], H.r[1], H.rBig);
}

// ---------------- голова ----------------
/** whiteN — сколько прядей метки побелело (0..MARK_STRANDS), -1 — нет метки. */
export function headSprite(look, whiteN = -1) {
  return sprite(`avh:${look.hkey}:${whiteN}`, HEAD * SS, HEAD * SS, (ctx) => {
    ctx.scale(SS, SS);
    ctx.translate(HEAD / 2, HEAD / 2);
    paintHead(ctx, look, whiteN);
  });
}

function paintHead(ctx, look, whiteN) {
  const hx = 1.3;
  const r = 4.7;
  const hair = look.hair;
  ctx.lineCap = 'round';
  // задние элементы причёски
  ctx.fillStyle = hair;
  ctx.strokeStyle = hair;
  switch (look.hairStyle) {
    case 'long':
      ctx.beginPath();
      ctx.ellipse(hx - 4.6, 0, 3.2, 4.6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bun':
      ctx.beginPath();
      ctx.arc(hx - 5.6, 0, 2.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'ponytail':
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(hx - 4, 0);
      ctx.quadraticCurveTo(hx - 7.5, 0.5, hx - 9.5, 1.6);
      ctx.stroke();
      break;
    case 'braid':
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(hx - 5.2 - k * 1.9, 0.4 * k, 1.35 - k * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    default:
      break;
  }
  // голова
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(hx, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // глаза — направление взгляда
  ctx.fillStyle = 'rgba(26,20,32,0.85)';
  ctx.beginPath();
  ctx.arc(hx + 3.5, -1.6, 0.6, 0, Math.PI * 2);
  ctx.arc(hx + 3.5, 1.6, 0.6, 0, Math.PI * 2);
  ctx.fill();
  // борода
  const beardC = mix(hair, '#000000', 0.15);
  if (look.beard === 'full' || look.beard === 'stubble') {
    ctx.strokeStyle = look.beard === 'full' ? beardC : rgba(beardC, 0.45);
    ctx.lineWidth = look.beard === 'full' ? 1.8 : 1.2;
    ctx.beginPath();
    ctx.arc(hx, 0, r - 0.6, -1.15, 1.15);
    ctx.stroke();
  } else if (look.beard === 'goatee') {
    ctx.fillStyle = beardC;
    ctx.beginPath();
    ctx.ellipse(hx + 4.4, 0, 1.2, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (look.beard === 'mustache') {
    ctx.strokeStyle = beardC;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hx + 3.2, 0, 1.6, -1.3, 1.3);
    ctx.stroke();
  }
  // макушка (волосы сверху закрывают затылок)
  ctx.save();
  ctx.beginPath();
  ctx.arc(hx, 0, r + 0.35, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = hair;
  switch (look.hairStyle) {
    case 'bald':
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(hx - 1, -1.2, 1.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'mohawk':
      ctx.fillRect(hx - 5, -1.15, 8, 2.3);
      break;
    case 'crop':
      ctx.beginPath();
      ctx.arc(hx - 1.8, 0, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'curly':
      ctx.beginPath();
      ctx.arc(hx - 1.2, 0, r - 0.4, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 9; k++) {
        const a = Math.PI * 0.45 + (k / 8) * Math.PI * 1.1;
        ctx.beginPath();
        ctx.arc(hx - 1.2 + Math.cos(a) * 3.6, Math.sin(a) * 3.6, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    default:
      ctx.beginPath();
      ctx.arc(hx - 1.15, 0, r, 0, Math.PI * 2);
      ctx.fill();
      // чёлка
      ctx.beginPath();
      ctx.arc(hx + 1.6, -0.5, 1.6, 0, Math.PI * 2);
      ctx.fill();
  }
  if (look.hairStyle !== 'bald') {
    ctx.strokeStyle = rgba(lighten(hair, 0.35), 0.35);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(hx - 1.2, 0, r - 1.8, Math.PI * 0.7, Math.PI * 1.3);
    ctx.stroke();
  }
  ctx.restore();
  // пряди метки: белеют одна за другой (наследник)
  if (whiteN >= 0) {
    const all = whiteN >= MARK_STRANDS;
    for (let i = 0; i < MARK_STRANDS; i++) {
      const a = Math.PI * 0.6 + (i / (MARK_STRANDS - 1)) * Math.PI * 0.8;
      const cx = hx - 1.1 + Math.cos(a) * 3.3;
      const cy = Math.sin(a) * 3.3;
      const white = i < whiteN;
      ctx.strokeStyle = white ? '#ffffff' : lighten(hair, 0.25);
      ctx.lineWidth = white ? 0.95 : 0.7;
      if (white && all) {
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 3 * SS;
      }
      ctx.beginPath();
      for (let s = 0; s <= 8; s++) {
        const t = s / 8;
        const aa = a + t * Math.PI * 2.4;
        const rr = 1.5 * (1 - t * 0.7);
        const x = cx + Math.cos(aa) * rr;
        const y = cy + Math.sin(aa) * rr;
        if (s) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}

// ---------------- лежачая поза ----------------
export function lyingSprite(look, blanket = false, whiteN = -1) {
  return sprite(`avl:${look.key}:${look.hkey}:${blanket ? 1 : 0}:${whiteN}`, 48 * SS, 32 * SS, (ctx) => {
    ctx.scale(SS, SS);
    ctx.translate(26, 16);
    const naked = look.naked;
    const cloth = naked ? look.skin : look.cloth;
    // тело
    ctx.beginPath();
    ctx.ellipse(2.5, 0, 10.5, 6.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = cloth;
    ctx.fill();
    if (naked) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#2a2230';
      ctx.fillRect(4, -7, 3.6, 14);
      ctx.restore();
    }
    // руки вдоль тела
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(6, -6.4, 2.1, 0, Math.PI * 2);
    ctx.arc(6, 6.4, 2.1, 0, Math.PI * 2);
    ctx.fill();
    if (blanket) {
      ctx.fillStyle = mix(look.trim, '#0b0d18', 0.62);
      ctx.beginPath();
      ctx.moveTo(-3.5, -7.5);
      ctx.lineTo(14.5, -7.5);
      ctx.quadraticCurveTo(16.5, 0, 14.5, 7.5);
      ctx.lineTo(-3.5, 7.5);
      ctx.quadraticCurveTo(-5, 0, -3.5, -7.5);
      ctx.fill();
      ctx.strokeStyle = rgba(look.trim, 0.55);
      ctx.lineWidth = 0.8;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(1 + k * 4.5, -7);
        ctx.lineTo(1 + k * 4.5, 7);
        ctx.stroke();
      }
    }
    ctx.shadowColor = naked ? 'transparent' : look.trim;
    ctx.shadowBlur = naked ? 0 : 4 * SS;
    ctx.strokeStyle = naked ? rgba(mix(look.skin, '#000', 0.4), 0.8) : rgba(look.trim, 0.75);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(2.5, 0, 10.5, 6.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // голова (сверху: макушка к -x), повернём голову-спрайт на -90°
    ctx.save();
    ctx.translate(-10, 0);
    ctx.rotate(Math.PI);
    ctx.drawImage(headSprite(look, whiteN), -HEAD / 2, -HEAD / 2, HEAD, HEAD);
    ctx.restore();
  });
}

// ---------------- белый силуэт (вспышка попадания) ----------------
const whites = new Map();
/** Белая копия спрайта (кэш по самому канвасу). */
export function whiteOf(canvas) {
  let w = whites.get(canvas);
  if (w) return w;
  if (whites.size > 400) whites.clear();
  w = sprite(`avw:${whites.size}:${Math.random().toString(36).slice(2, 8)}`, canvas.width, canvas.height, (ctx) => {
    ctx.drawImage(canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });
  whites.set(canvas, w);
  return w;
}

/** Тень под персонажем. */
export function shadowSprite(rx = 10, ry = 5) {
  return sprite(`avsh:${rx}:${ry}`, (rx * 2 + 4) * SS, (ry * 2 + 4) * SS, (ctx) => {
    ctx.scale(SS, SS);
    const g = ctx.createRadialGradient(rx + 2, ry + 2, 0, rx + 2, ry + 2, rx);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(rx + 2, ry + 2);
    ctx.scale(1, ry / rx);
    ctx.translate(-(rx + 2), -(rx + 2) + 0);
    ctx.beginPath();
    ctx.arc(rx + 2, rx + 2, rx, 0, Math.PI * 2);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.ellipse(rx + 2, ry + 2, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function drawShadow(ctx, x, y, rx = 10, ry = 5, alpha = 1) {
  const s = shadowSprite(rx, ry);
  const pa = ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = pa * alpha;
  ctx.drawImage(s, x - rx - 2, y - ry - 2, rx * 2 + 4, ry * 2 + 4);
  ctx.globalAlpha = pa;
}
