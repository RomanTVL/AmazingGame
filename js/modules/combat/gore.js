// Кровь и жёсткость (дозированно, стилизованно-неоново): брызги-декали, лужица под упавшим, отрубленная часть
// тела на 'health:partLost', пепел/костяная пыль у нежити. Декали тускнеют за ~2–3 дня и исчезают; их число ограничено.
import { hash01 } from '../../core/math.js';
import { TICKS_PER_DAY } from '../../core/constants.js';

const MAX_DECALS = 160;
const FADE_PER_HOUR = 0.55 / (2.5 * 24);

export const BLOOD = { flesh: '#b0102e', undead: '#cfe0f0', rot: '#6a3fa0', beast: '#8a1430' };

function bloodColor(p) {
  if (p.undead) return BLOOD.undead;
  if (p.enemyFaction === 'rot_beasts' || p.boss?.id === 'rot_heart') return BLOOD.rot;
  if (p.beast) return BLOOD.beast;
  return BLOOD.flesh;
}

export function installGore(game, C) {
  C.decal = (defId, x, y, props) => {
    if (!game.map || !game.map.inBounds(Math.floor(x), Math.floor(y))) return null;
    C.R.decalCount = (C.R.decalCount || 0) + 1;
    return game.entities.spawn('decal', { defId, x: Math.floor(x), y: Math.floor(y), born: game.time.tick, combat: true, ...props });
  };
  C.gore = (target, dmg, type, angle = 0) => {
    if (!(dmg >= 5) || target.kind !== 'pawn') return;
    const now = game.time.tick;
    const color = bloodColor(target);
    const h = (k) => hash01(target.id, now, k);
    if (dmg < 14 && h(11) > 0.55) return; // дозированно: не каждый удар оставляет след
    const n = dmg >= 24 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      // брызги — по направлению удара
      const off = 0.3 + h(i * 3) * (0.5 + dmg / 40);
      const a = (angle || 0) + (h(i * 3 + 1) - 0.5) * 0.9;
      const x = target.x + Math.cos(a) * off;
      const y = target.y + Math.sin(a) * off;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      C.decal('combat_blood', x, y, {
        color, alpha: Math.min(0.75, 0.35 + dmg / 60), r: 3 + Math.min(7, dmg / 5) * (0.6 + h(i * 3 + 2) * 0.6),
        ox: (x - tx - 0.5) * 32, oy: (y - ty - 0.5) * 32, a, splat: 1 + Math.floor(h(9 + i) * 3), undead: !!target.undead,
      });
    }
  };
  C.pool = (p) => {
    if (p.undead || p.simpleHealth) return;
    C.decal('combat_blood', p.x, p.y, { color: bloodColor(p), alpha: 0.6, r: 10, ox: (p.x - Math.floor(p.x) - 0.5) * 32, oy: (p.y - Math.floor(p.y) - 0.5) * 32, a: hash01(p.id, 1, 2) * 3, splat: 0, pool: true });
  };
  C.limb = (pawn, part, x, y) => {
    const a = hash01(pawn.id, game.time.tick, 5) * Math.PI * 2;
    const d = 0.6 + hash01(pawn.id, game.time.tick, 6) * 0.8;
    const lx = (x ?? pawn.x) + Math.cos(a) * d;
    const ly = (y ?? pawn.y) + Math.sin(a) * d;
    C.decal('combat_limb', lx, ly, {
      part, color: pawn.undead ? '#dfe8f2' : '#e9cfb4', blood: bloodColor(pawn), alpha: 0.95, a, ox: (lx - Math.floor(lx) - 0.5) * 32, oy: (ly - Math.floor(ly) - 0.5) * 32,
    });
    C.gore(pawn, 20, 'cut', a);
  };
}

/** Раз в час: декали тускнеют; лишние (самые старые) убираются. */
export function fadeDecals(game, C) {
  const ents = game.entities;
  let n = 0;
  const now = game.time.tick;
  for (const d of ents.ofKind('decal')) {
    if (!d.combat) continue;
    n++;
    const age = now - (d.born || 0);
    const perHour = d.defId === 'combat_limb' ? FADE_PER_HOUR * 0.6 : FADE_PER_HOUR;
    d.alpha = (d.alpha ?? 0.5) - perHour;
    if (d.alpha <= 0.04 || age > TICKS_PER_DAY * 4) {
      ents.remove(d, 'faded');
      n--;
    }
  }
  if (n > MAX_DECALS) {
    let extra = n - MAX_DECALS;
    for (const d of ents.ofKind('decal')) {
      if (extra <= 0) break;
      if (!d.combat) continue;
      ents.remove(d, 'culled');
      extra--;
    }
  }
  C.R.decalCount = Math.min(n, MAX_DECALS);
}

/** Быстрая отсечка при всплеске (не ждать часа). */
export function cullIfNeeded(game, C) {
  if ((C.R.decalCount || 0) > MAX_DECALS + 60) fadeDecals(game, C);
}
