// Маг-лидер: мана, слоты заклинаний 1–4, атака посохом (ЛКМ), рывок/блинк (Shift), опыт и уровни,
// выбор 1 из 3 улучшений (ветви flame/road/voice), посох проводника (без него — только «Искра» и мана ×0.3),
// ученик-наследник (Искра + Лечение ×0.6 до полной метки), непослушный посох (флаг staffDisobeys).
import { dist, clamp } from '../../core/math.js';
import { hasStaff, weaponStats, equipItem, dropSlot, WEAPON_STATS } from './items.js';
import { isHostile, meleeStrike, fireFree, attackReady, setCooldown, dealDamage, explode, spawnProjectile, skillLevel, shotLine, pickPart } from './fight.js';
import { voiceRadius } from './ai.js';
import { secs } from './state.js';

/** Заклинания. mana — стоимость, cd — перезарядка (с). */
export const SPELLS = {
  spark: { mana: 6, cd: 0.55, color: '#9ff8ff', glyph: 'spark' },
  fireball: { mana: 25, cd: 4, color: '#ff9f43', glyph: 'fire' },
  chain_lightning: { mana: 30, cd: 6, color: '#bfe8ff', glyph: 'bolt' },
  ice_ring: { mana: 28, cd: 8, color: '#8fd8ff', glyph: 'ice' },
  rune_shield: { mana: 35, cd: 14, color: '#b77dff', glyph: 'shield' },
  healing_light: { mana: 30, cd: 10, color: '#7dff9a', glyph: 'heal' },
  blink: { mana: 18, cd: 3, color: '#e2c8ff', glyph: 'blink' },
  okrik: { mana: 20, cd: 12, color: '#ffd27a', glyph: 'voice' },
  wagon_ward: { mana: 40, cd: 60, color: '#5ef2ff', glyph: 'ward' },
};
export const DEFAULT_SLOTS = ['fireball', 'chain_lightning', 'ice_ring', 'rune_shield'];

/** Улучшения уровня (карточки 1 из 3). branch: flame | road | voice. learn — новое заклинание. */
export const UPGRADES = [
  { id: 'fireball_power', branch: 'flame', max: 3 },
  { id: 'chain_power', branch: 'flame', max: 3 },
  { id: 'ice_power', branch: 'flame', max: 3 },
  { id: 'mana_well', branch: 'flame', max: 4 },
  { id: 'road_fuel', branch: 'road', max: 2 },
  { id: 'road_eye', branch: 'road', max: 2 },
  { id: 'learn_wagon_ward', branch: 'road', max: 1, learn: 'wagon_ward' },
  { id: 'learn_blink', branch: 'road', max: 1, learn: 'blink' },
  { id: 'voice_loud', branch: 'voice', max: 1 },
  { id: 'voice_obey', branch: 'voice', max: 2 },
  { id: 'learn_okrik', branch: 'voice', max: 1, learn: 'okrik' },
  { id: 'learn_healing_light', branch: 'voice', max: 1, learn: 'healing_light' },
  { id: 'voice_rally', branch: 'voice', max: 2 },
];
const UPG = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
export const upgradeDef = (id) => UPG[id] || null;

export const xpForLevel = (lvl) => Math.round(80 + 55 * Math.pow(Math.max(0, lvl - 1), 1.3));

// ---------------- Состояние лидера ----------------
/** Завести перки/ману пешке-лидеру (у наследника перков нет — начинает с нуля). */
export function ensureLeader(game, C, p) {
  if (!p) return;
  const pk = (p.perks ||= {});
  if (!pk.level) {
    pk.level = 1;
    pk.xp = 0;
    pk.known = DEFAULT_SLOTS.slice();
    pk.slots = DEFAULT_SLOTS.slice();
    pk.upgrades = {};
    pk.cd = {};
    pk.pending = 0;
    pk.cards = null;
  }
  pk.known ||= DEFAULT_SLOTS.slice();
  pk.slots ||= DEFAULT_SLOTS.slice();
  pk.upgrades ||= {};
  pk.cd ||= {};
  if (!p.mana || typeof p.mana !== 'object') p.mana = { cur: 0, max: 0 };
  const max = maxMana(game, p);
  if (!(p.mana.max > 0)) p.mana.cur = max;
  p.mana.max = max;
  p.mana.cur = clamp(p.mana.cur, 0, max);
}

export function maxMana(game, p) {
  const pk = p.perks || {};
  const up = pk.upgrades || {};
  const base = 100 + 20 * (up.mana_well || 0) + 4 * Math.max(0, (pk.level || 1) - 1);
  return Math.round(base * (hasStaff(p) ? 1 : 0.3));
}

/** Ученик: посох есть, но не маг, магия < 6 и метка не полная. */
export const isApprentice = (game, p) => hasStaff(p) && !p.mage && skillLevel(game, p, 'magic') < 6 && (p.markProgress ?? 0) < 1;

/** Доступные слоты (4) и сила. */
export function activeSlots(game, p) {
  if (!hasStaff(p)) return { slots: ['spark', null, null, null], power: 1, mode: 'nostaff' };
  if (isApprentice(game, p)) return { slots: ['spark', 'healing_light', null, null], power: 0.6, mode: 'apprentice' };
  const s = p.perks?.slots || DEFAULT_SLOTS;
  return { slots: [s[0] || null, s[1] || null, s[2] || null, s[3] || null], power: 1, mode: 'full' };
}

export function regenMana(game, C, p, dt) {
  if (!p.mana) ensureLeader(game, C, p);
  const max = maxMana(game, p);
  p.mana.max = max;
  const rate = (2.4 + (p.perks?.level || 1) * 0.12) * (hasStaff(p) ? 1 : 0.5);
  p.mana.cur = Math.min(max, (p.mana.cur || 0) + rate * dt);
}

export function spendMana(game, p, n) {
  if (!p?.mana || !(n >= 0)) return false;
  if (p.mana.cur < n) return false;
  p.mana.cur -= n;
  return true;
}

// ---------------- Опыт и уровни ----------------
export function grantXp(game, C, p, amount, reason = '') {
  if (!p || p.faction !== 'colony' || !p.isLeader || !(amount > 0)) return;
  ensureLeader(game, C, p);
  const pk = p.perks;
  pk.xp += amount;
  let guard = 0;
  while (pk.level < 30 && pk.xp >= xpForLevel(pk.level) && guard++ < 10) {
    pk.xp -= xpForLevel(pk.level);
    pk.level++;
    pk.pending = (pk.pending || 0) + 1;
    if (!pk.cards) rollCards(game, p);
    p.mana.max = maxMana(game, p);
    p.mana.cur = p.mana.max;
    game.events.emit('combat:levelUp', { pawn: p, level: pk.level, reason });
    game.api.ui.notify(game.t('combat.level.up', { name: p.name, level: pk.level }), { type: 'good', pawnId: p.id });
    C.sfx('combat:levelup', p.x, p.y);
    C.vfx('levelup', { x: p.x, y: p.y, targetId: p.id });
  }
}

/** Карточки выбора (детерминированно по уровню). */
export function rollCards(game, p) {
  const pk = p.perks;
  const rng = game.rng.fork(`combat:cards:${p.id}:${pk.level}:${pk.pending}`);
  const avail = UPGRADES.filter((u) => (pk.upgrades[u.id] || 0) < u.max && !(u.learn && pk.known.includes(u.learn)));
  const shuffled = rng.shuffle(avail.slice());
  const out = [];
  const branches = new Set();
  for (const u of shuffled) if (out.length < 3 && !branches.has(u.branch)) {
    out.push(u.id);
    branches.add(u.branch);
  }
  for (const u of shuffled) if (out.length < 3 && !out.includes(u.id)) out.push(u.id);
  pk.cards = out.length ? out : null;
  return pk.cards;
}

/** Выбрать улучшение (индекс карточки или id). @returns {boolean} */
export function chooseUpgrade(game, C, p, which) {
  const pk = p?.perks;
  if (!pk?.cards?.length) return false;
  const id = typeof which === 'number' ? pk.cards[which] : which;
  if (!id || !pk.cards.includes(id)) return false;
  const u = UPG[id];
  pk.upgrades[id] = (pk.upgrades[id] || 0) + 1;
  applyPerkEffects(p);
  if (u.learn && !pk.known.includes(u.learn)) {
    pk.known.push(u.learn);
    const free = pk.slots.findIndex((s) => !s);
    if (free >= 0) pk.slots[free] = u.learn;
  }
  pk.pending = Math.max(0, (pk.pending || 1) - 1);
  pk.cards = null;
  if (pk.pending > 0) rollCards(game, p);
  p.mana.max = maxMana(game, p);
  game.events.emit('combat:upgradeChosen', { pawn: p, id, branch: u.branch });
  game.api.ui.notify(game.t('combat.level.chosen', { name: game.t(`combat.upg.${id}.name`) }), { type: 'good' });
  return true;
}

/** Поля перков, которые читают другие модули (journey/vision/mind). */
export function applyPerkEffects(p) {
  const pk = p.perks;
  const up = pk.upgrades || {};
  pk.fuelMul = Math.pow(0.9, up.road_fuel || 0);
  pk.camRadius = 3 * (up.road_eye || 0);
  pk.voiceMul = up.voice_loud ? 1.5 : 1;
  pk.obeyBonus = 0.15 * (up.voice_obey || 0);
}

/** Сменить заклинание в слоте на следующее известное (клик по слоту в HUD). */
export function cycleSlot(game, p, slot) {
  const pk = p?.perks;
  if (!pk?.known?.length) return;
  const cur = pk.slots[slot];
  const list = pk.known.filter((s) => s === cur || !pk.slots.includes(s));
  const i = list.indexOf(cur);
  pk.slots[slot] = list[(i + 1) % list.length] || cur;
}

// ---------------- Атака лидера (ЛКМ) ----------------
const BOLT = { damage: 8, range: 10, speed: 26, type: 'rune', projectile: 'rune', sfx: 'combat:rune_shot' };

export function leaderAttack(game, C, L, x, y, targetId = 0) {
  if (!L || L.dead || L.downed) return false;
  if (!attackReady(game, L)) return false;
  const w = weaponStats(game, C, L);
  const ang = Math.atan2(y - L.y, x - L.x);
  L.dir = ang;
  if (w.kind === 'ranged') {
    fireFree(game, C, L, x, y, w);
    setCooldown(game, L, w.cooldown);
    return true;
  }
  const reach = (w.reach || 1.5) + 0.35;
  const hits = [];
  for (const o of C.R.enemies) {
    if (hits.length >= 3) break;
    const d = dist(L.x, L.y, o.x, o.y);
    if (d > reach + (o.radius || 0.3)) continue;
    let da = Math.abs(Math.atan2(o.y - L.y, o.x - L.x) - ang);
    if (da > Math.PI) da = Math.PI * 2 - da;
    if (da > 1.05 && d > 0.8) continue;
    if (!isHostile(L, o)) continue;
    hits.push(o);
  }
  // явно выбранного упавшего врага можно добить (осознанный выбор игрока)
  if (!hits.length && targetId) {
    const t = game.entities.get(targetId);
    if (t && !t.dead && t.downed && t.faction === 'enemy' && !t.prisoner && dist(L.x, L.y, t.x, t.y) <= reach + 0.4) hits.push(t);
  }
  // нить Лича тоже можно перерубить посохом
  if (!hits.length && C.S.threads.length) C.hitThreadsAt(L.x + Math.cos(ang) * 1.2, L.y + Math.sin(ang) * 1.2, 0.9, w.damage * 1.5, null);
  if (hits.length) {
    for (const o of hits) meleeStrike(game, C, L, o, w, { accBonus: 0.1, dmgMul: 1 + 0.04 * ((L.perks?.level || 1) - 1) });
    if (!hits[0].downed) C.R.leaderTargetId = hits[0].id;
    setCooldown(game, L, w.cooldown);
    return true;
  }
  if (w.staff) {
    // дальняя «стрела» рун посохом — бесплатно, медленнее
    fireFree(game, C, L, x, y, BOLT, { damage: BOLT.damage * (1 + 0.05 * ((L.perks?.level || 1) - 1)), style: 'rune', speed: BOLT.speed, range: BOLT.range, sfx: BOLT.sfx });
    setCooldown(game, L, 0.75);
    return true;
  }
  C.vfx('slash', { x: L.x, y: L.y, a: ang, r: reach * 0.9, color: '#ffcf8a' });
  setCooldown(game, L, w.cooldown * 0.6);
  return true;
}

// ---------------- Рывок / блинк (Shift) ----------------
export function leaderDash(game, C, L, x, y) {
  if (!L || L.dead || L.downed) return false;
  const pk = L.perks || {};
  const now = game.time.tick;
  pk.cd ||= {};
  const canBlink = pk.known?.includes('blink') && hasStaff(L) && !isApprentice(game, L);
  if (canBlink && !(pk.cd.blink > now) && L.mana?.cur >= SPELLS.blink.mana) return castSpellId(game, C, L, 'blink', x, y, 1);
  if (pk.cd.dash > now) return false;
  let dx = L.moveInput?.x || 0;
  let dy = L.moveInput?.y || 0;
  if (!dx && !dy) {
    dx = x - L.x;
    dy = y - L.y;
  }
  const l = Math.hypot(dx, dy) || 1;
  L._dash = { vx: (dx / l) * 18, vy: (dy / l) * 18, t: 10 };
  pk.cd.dash = now + secs(1.2);
  C.vfx('dash', { x: L.x, y: L.y, a: Math.atan2(dy, dx), targetId: L.id });
  C.sfx('combat:dash', L.x, L.y);
  return true;
}

/** Тик рывка: короткий бросок с коллизиями. */
export function dashStep(game, C, L, dt) {
  const d = L?._dash;
  if (!d) return;
  if (L.dead || L.downed || d.t-- <= 0) {
    L._dash = null;
    return;
  }
  const pc = game.player;
  const r = L.radius ?? 0.3;
  const nx = L.x + d.vx * dt;
  const ny = L.y + d.vy * dt;
  if (!pc.collides(nx, L.y, r)) L.x = nx;
  if (!pc.collides(L.x, ny, r)) L.y = ny;
  game.entities.moved(L);
}

// ---------------- Заклинания ----------------
export function castSlot(game, C, L, slot, x, y) {
  if (!L || L.dead || L.downed) return false;
  ensureLeader(game, C, L);
  const { slots, power } = activeSlots(game, L);
  const id = slots[slot];
  if (!id) {
    C.floatText(L.x, L.y - 0.9, game.t('combat.spell.empty'), '#8c93b8');
    C.sfx('error');
    return false;
  }
  return castSpellId(game, C, L, id, x, y, power);
}

function fail(game, C, L, key) {
  C.floatText(L.x, L.y - 0.9, game.t(key), '#8c93b8');
  C.sfx('error');
  return false;
}

export function castSpellId(game, C, L, id, x, y, power = 1) {
  const def = SPELLS[id];
  if (!def) return false;
  ensureLeader(game, C, L);
  const pk = L.perks;
  const now = game.time.tick;
  if (pk.cd[id] > now) return fail(game, C, L, 'combat.spell.cooldown');
  if (L.mana.cur < def.mana) return fail(game, C, L, 'combat.spell.noMana');
  // непослушный посох
  const auth = game.api.mind.getAuthority();
  if (game.colony.flags?.staffDisobeys && auth < 40 && game.rng.chance(0.3)) {
    L.mana.cur -= def.mana * 0.5;
    pk.cd[id] = now + secs(def.cd * 0.5);
    C.vfx('puff', { x: L.x + Math.cos(L.dir) * 0.6, y: L.y + Math.sin(L.dir) * 0.6 });
    C.floatText(L.x, L.y - 0.9, game.t('combat.spell.fizzle'), '#c9b8ff');
    C.sfx('combat:fizzle', L.x, L.y);
    game.events.emit('combat:spellFizzled', { caster: L, spellId: id });
    return false;
  }
  const ok = SPELL_FX[id](game, C, L, x, y, power, pk.upgrades || {});
  if (ok === false) return false;
  L.mana.cur -= def.mana;
  pk.cd[id] = now + secs(def.cd);
  L.dir = Math.atan2(y - L.y, x - L.x);
  L.pose = 'cast';
  L.poseUntil = now + 20;
  game.events.emit('combat:spellCast', { caster: L, spellId: id, x, y });
  game.api.mind.learn(L, 'magic', 8);
  return true;
}

function clampAim(L, x, y, maxR) {
  const d = dist(L.x, L.y, x, y);
  if (d <= maxR) return { x, y, d };
  const k = maxR / d;
  return { x: L.x + (x - L.x) * k, y: L.y + (y - L.y) * k, d: maxR };
}

const SPELL_FX = {
  spark(game, C, L, x, y, power) {
    fireFree(game, C, L, x, y, BOLT, { damage: 11 * power, style: 'spark', speed: 30, range: 11, spell: 'spark', sfx: 'combat:zap' });
  },
  fireball(game, C, L, x, y, power, up) {
    const n = up.fireball_power || 0;
    const a = clampAim(L, x, y, 12);
    const ang = Math.atan2(a.y - L.y, a.x - L.x);
    spawnProjectile(game, C, L.x + Math.cos(ang) * 0.5, L.y + Math.sin(ang) * 0.5, a.x, a.y, {
      sourceId: L.id, faction: L.faction, style: 'fireball', speed: 15, type: 'burn', dmg: 0, avg: 0, mode: 'free', burstAt: true,
      range: Math.max(1, a.d), spell: 'fireball',
      aoe: { r: 2.2 + 0.4 * n, dmg: 26 * (1 + 0.3 * n) * power, type: 'burn', burn: 3, fire: 0.12, friendly: 0.25, color: '#ff9f43', spell: 'fireball', shake: 5 },
    });
    C.sfx('combat:fireball', L.x, L.y);
  },
  chain_lightning(game, C, L, x, y, power, up) {
    const n = up.chain_power || 0;
    let first = null;
    let bestD = 1e9;
    for (const o of C.R.enemies) {
      if (!isHostile(L, o) || dist(L.x, L.y, o.x, o.y) > 11) continue;
      const d = dist(o.x, o.y, x, y);
      if (d < bestD && d < 3) {
        bestD = d;
        first = o;
      }
    }
    if (!first) {
      for (const o of C.R.enemies) {
        if (!isHostile(L, o)) continue;
        const d = dist(L.x, L.y, o.x, o.y);
        if (d < bestD && d < 8) {
          bestD = d;
          first = o;
        }
      }
    }
    if (!first || shotLine(game, L.x, L.y, first.x, first.y) < 0) return fail(game, C, L, 'combat.spell.noTarget');
    const pts = [{ x: L.x, y: L.y }];
    const hit = new Set();
    let cur = first;
    let dmg = 20 * (1 + 0.2 * n) * power;
    const jumps = 4 + n;
    for (let i = 0; i < jumps && cur; i++) {
      hit.add(cur.id);
      pts.push({ x: cur.x, y: cur.y });
      dealDamage(game, C, cur, dmg, { type: 'rune', part: pickPart(game), source: L, avg: dmg, spell: 'chain_lightning', angle: Math.atan2(cur.y - pts[i].y, cur.x - pts[i].x) });
      dmg *= 0.8;
      let next = null;
      let nd = 4.5 * 4.5;
      for (const o of C.R.enemies) {
        if (hit.has(o.id) || o.dead || !isHostile(L, o)) continue;
        const d2 = (o.x - cur.x) ** 2 + (o.y - cur.y) ** 2;
        if (d2 < nd) {
          nd = d2;
          next = o;
        }
      }
      cur = next;
    }
    C.vfx('chain', { pts });
    game.api.vision.noise(L.x, L.y, 15, 'shot');
    C.sfx('combat:zap', L.x, L.y);
  },
  ice_ring(game, C, L, x, y, power, up) {
    const n = up.ice_power || 0;
    explode(game, C, L.x, L.y, {
      r: 3.5 + 0.5 * n, dmg: 10 * power, type: 'frost', friendly: 0, chill: { factor: 0.4, seconds: 4, freeze: 1.5 + n }, color: '#8fd8ff',
      vfx: 'frost', kind: 'quiet', spell: 'ice_ring',
    }, L);
    C.sfx('combat:ice', L.x, L.y);
    game.api.vision.noise(L.x, L.y, 10, 'spell');
  },
  rune_shield(game, C, L, x, y, power) {
    const until = game.time.tick + secs(10);
    L.shield = { hp: Math.round(50 * power), max: Math.round(50 * power), untilTick: until };
    for (const o of C.R.colony) if (o !== L && !o.dead && dist(o.x, o.y, L.x, L.y) <= 3.2) o.shield = { hp: Math.round(25 * power), max: Math.round(25 * power), untilTick: until };
    C.vfx('shield_cast', { x: L.x, y: L.y, targetId: L.id });
    C.sfx('combat:shield', L.x, L.y);
  },
  healing_light(game, C, L, x, y, power) {
    let t = null;
    for (const o of C.R.colony) if (!o.dead && dist(o.x, o.y, x, y) < 1.1 && dist(o.x, o.y, L.x, L.y) <= 9) t = o;
    if (!t) {
      let worst = 1;
      for (const o of C.R.colony) {
        if (o.dead || dist(o.x, o.y, L.x, L.y) > 5) continue;
        const r = (o.health?.hp ?? 100) / (o.health?.maxHp ?? 100);
        if (r < worst) {
          worst = r;
          t = o;
        }
      }
    }
    t ||= L;
    game.api.health.heal(t, 25 * power);
    if (t.burnUntil) t.burnUntil = 0;
    C.vfx('heal', { x: t.x, y: t.y, targetId: t.id });
    C.floatText(t.x, t.y - 0.8, `+${Math.round(25 * power)}`, '#7dff9a');
    C.sfx('combat:heal', t.x, t.y);
    if (t !== L) game.api.mind.addThought(t, 'healed_by_leader', { source: L });
  },
  blink(game, C, L, x, y) {
    const a = clampAim(L, x, y, 7);
    const pc = game.player;
    const r = L.radius ?? 0.3;
    let tx = a.x;
    let ty = a.y;
    let ok = false;
    for (let k = 0; k < 14; k++) {
      if (game.map.isPassable(Math.floor(tx), Math.floor(ty)) && !pc.collides(tx, ty, r)) {
        ok = true;
        break;
      }
      tx -= (a.x - L.x) / 14;
      ty -= (a.y - L.y) / 14;
    }
    if (!ok || dist(tx, ty, L.x, L.y) < 1) return fail(game, C, L, 'combat.spell.noRoom');
    C.vfx('blink', { x: L.x, y: L.y, x2: tx, y2: ty });
    L.x = tx;
    L.y = ty;
    if (L.path) L.path = null;
    game.entities.moved(L);
    C.sfx('combat:blink', tx, ty);
  },
  okrik(game, C, L) {
    const r = voiceRadius(game, L);
    C.voiceCleanse(L, r);
    const mind = game.api.mind;
    for (const o of C.R.colony) {
      if (o === L || dist(o.x, o.y, L.x, L.y) > r) continue;
      if (mind.isInBreak(o)) {
        for (const fn of ['endBreak', 'stopBreak', 'interruptBreak']) if (typeof mind[fn] === 'function') {
          mind[fn](o, 'okrik');
          break;
        }
        game.events.emit('combat:okrik', { pawn: o, leader: L });
      }
    }
    // враги рядом вздрагивают
    for (const o of C.R.enemies) if (!o.boss && dist(o.x, o.y, L.x, L.y) <= 6) {
      o.frozenUntil = Math.max(o.frozenUntil || 0, game.time.tick + secs(1));
    }
    mind.say(L, game.t('combat.spell.okrikShout', { variant: game.time.tick }));
    C.vfx('voice_ring', { x: L.x, y: L.y, r, targetId: L.id, color: '#ffd27a' });
    game.api.vision.noise(L.x, L.y, 18, 'shout');
    C.sfx('combat:call', L.x, L.y);
  },
  wagon_ward(game, C, L) {
    const train = game.train;
    if (!train?.stamped) return fail(game, C, L, 'combat.spell.noWagon');
    let car = train.carAt(Math.floor(L.x), Math.floor(L.y));
    if (!car) {
      let bd = 1e9;
      for (const c of train.cars) {
        if (!c.rect) continue;
        const d = dist(L.x, L.y, c.rect.x + c.rect.w / 2, c.rect.y + c.rect.h / 2);
        if (d < bd) {
          bd = d;
          car = c;
        }
      }
      if (bd > 12) car = null;
    }
    if (!car) return fail(game, C, L, 'combat.spell.noWagon');
    const until = game.time.tick + secs(30);
    const w = C.S.wards.find((q) => q.carId === car.id);
    if (w) w.untilTick = until;
    else C.S.wards.push({ carId: car.id, untilTick: until });
    C.sfx('combat:shield', L.x, L.y);
    game.api.ui.notify(game.t('combat.spell.wardUp'), { type: 'good' });
  },
};

// ---------------- Посох ----------------
/** Подобрали посох: лидер сразу берёт его в руку (item:picked). */
export function onItemPicked(game, C, { pawn, defId }) {
  if (defId !== 'conductor_staff' || !pawn) return;
  if (!pawn.isLeader) return;
  if (pawn.carry?.defId === 'conductor_staff') {
    pawn.carry.count -= 1;
    if (pawn.carry.count <= 0) pawn.carry = null;
  }
  equipStaff(game, C, pawn);
}

export function equipStaff(game, C, p) {
  const eq = (p.equipment ||= {});
  if (eq.weapon && eq.weapon !== 'conductor_staff') dropSlot(game, p, 'weapon');
  eq.weapon = 'conductor_staff';
  eq.weaponMeta = { quality: 'legendary', kills: eq.weaponMeta?.kills || 0 };
  game.api.ui.clearObjective('take_staff');
  ensureLeader(game, C, p);
  C.sfx('magic', p.x, p.y);
  game.events.emit('combat:equipped', { pawn: p, defId: 'conductor_staff' });
}

export { equipItem, WEAPON_STATS };
