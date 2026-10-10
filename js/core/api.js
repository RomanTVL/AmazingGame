// game.api — пространство межмодульных вызовов.
// Ядро даёт безопасные заглушки (stubs), чтобы модули могли вызывать друг друга
// ДО того, как появятся настоящие реализации. Модуль-владелец переопределяет функции
// в своём register(game) через game.provide('health', { applyDamage(...) {...} }).
//
// Правила:
//  - сигнатуры заглушек = контракт; меняйте их только через docs/ARCHITECTURE.md;
//  - заглушки детерминированы и не используют Math.random;
//  - вызывайте всегда через game.api.<ns>.<fn>(...) в момент вызова (не кешируйте ссылку на функцию).
import { EVENTS } from './events.js';
import { FACTION } from './constants.js';

export function createApi(game) {
  const api = {
    // ---------------- colony (ядро) ----------------
    colony: {
      getLeader: () => game.getLeader(),
      getColonists: () => game.colonists(),
      /** Выбрать наследника. Модуль health/mind может учитывать назначенного наследника и уважение. */
      chooseHeir(exclude) {
        const heirId = game.colony.heirId;
        const all = game.colonists().filter((p) => p !== exclude && !p.dead);
        const designated = all.find((p) => p.id === heirId);
        if (designated) return designated;
        // по умолчанию — самый «опытный» (сумма навыков), затем меньший id
        let best = null;
        let bestScore = -Infinity;
        for (const p of all) {
          let s = 0;
          for (const k in p.skills || {}) s += p.skills[k]?.level ?? 0;
          if (s > bestScore || (s === bestScore && best && p.id < best.id)) {
            best = p;
            bestScore = s;
          }
        }
        return best;
      },
      /** Передать управление пешке (становится лидером под прямым управлением). */
      transferLeadership(pawn) {
        const prev = game.getLeader();
        if (prev && prev !== pawn) {
          prev.isLeader = false;
          prev.controlled = 'ai';
        }
        if (!pawn) return;
        if (pawn.job) game.jobs.endJob(pawn, 'cancelled');
        pawn.isLeader = true;
        pawn.controlled = 'player';
        game.colony.leaderId = pawn.id;
        if (game.colony.heirId === pawn.id) game.colony.heirId = 0;
        game.events.emit(EVENTS.LEADER_CHANGED, { from: prev || null, to: pawn });
      },
    },

    // ---------------- health (модуль health) ----------------
    health: {
      /**
       * Нанести урон. opts: {part?: string, type?: 'cut'|'blunt'|'burn'|'magic'|'starvation'|..., source?: entity}
       * Заглушка: простой запас hp; при 0 — kill.
       * @returns {number} реально нанесённый урон
       */
      applyDamage(pawn, amount, opts = {}) {
        if (!pawn || pawn.dead) return 0;
        const h = (pawn.health ||= { hp: 100, maxHp: 100 });
        const dmg = Math.max(0, amount);
        h.hp = Math.max(0, (h.hp ?? 100) - dmg);
        if (h.hp <= 0) api.health.kill(pawn, opts.type || 'damage', opts);
        return dmg;
      },
      heal(pawn, amount) {
        const h = pawn?.health;
        if (h) h.hp = Math.min(h.maxHp ?? 100, (h.hp ?? 0) + amount);
      },
      /** Смерть: убирает пешку, создаёт труп, шлёт pawn:died. */
      kill(pawn, cause = 'unknown', opts = {}) {
        if (!pawn || pawn.dead) return null;
        pawn.dead = true;
        if (pawn.job) game.jobs.endJob(pawn, 'cancelled');
        if (pawn.carry) game.items.dropCarried(pawn);
        const corpse = game.entities.spawn('corpse', {
          x: Math.floor(pawn.x),
          y: Math.floor(pawn.y),
          pawnId: pawn.id,
          name: pawn.name,
          color: pawn.color,
          faction: pawn.faction,
          wasLeader: !!pawn.isLeader,
          diedTick: game.time.tick,
          cause,
          rot: 0,
        });
        game.entities.remove(pawn, 'died');
        game.events.emit(EVENTS.PAWN_DIED, { pawn, corpse, cause, opts });
        return corpse;
      },
      /** Без сознания / не может действовать. */
      isDowned: (pawn) => !!pawn?.downed,
      canWork: (pawn) => !!pawn && !pawn.dead && !pawn.downed,
      moveSpeedFactor: (_pawn) => 1,
      workSpeedFactor: (_pawn) => 1,
      /** Наложить состояние (болезнь, зависимость, опьянение...). Заглушка — no-op. */
      addCondition: (_pawn, _conditionId, _opts) => null,
      hasCondition: (_pawn, _conditionId) => false,
      /** Краткая сводка для UI: {ratio: 0..1, label: string} */
      getSummary(pawn) {
        const h = pawn?.health || { hp: 100, maxHp: 100 };
        const ratio = (h.hp ?? 100) / (h.maxHp ?? 100);
        return { ratio, label: game.t(ratio > 0.7 ? 'health.ok' : ratio > 0.3 ? 'health.hurt' : 'health.critical') };
      },
    },

    // ---------------- mind (модуль mind) ----------------
    mind: {
      /** Добавить мысль (влияет на настроение). opts: {mood?: number, days?: number, source?: entity, otherPawnId?} */
      addThought: (_pawn, _thoughtId, _opts) => {},
      removeThought: (_pawn, _thoughtId) => {},
      /** Настроение 0..1 */
      getMood: (pawn) => pawn?.mood?.value ?? 0.6,
      /** Опыт навыка: skillId — из game.defs.skills (модуль mind), xp — очки. */
      learn: (_pawn, _skillId, _xp) => {},
      skillLevel: (pawn, skillId) => pawn?.skills?.[skillId]?.level ?? 3,
      /** Множитель скорости работы от навыков/черт. */
      skillFactor: (_pawn, _workTypeId) => 1,
      isInBreak: (_pawn) => false,
      hasTrait: (pawn, traitId) => !!pawn?.traits?.includes(traitId),
      /** Реплика поселенца (облачко над головой рисует ui/av). */
      say(pawn, text) {
        game.events.emit(EVENTS.PAWN_SAID, { pawn, text });
      },
      /** Может ли пешка сейчас спать/есть по расписанию (mind даст расписание). */
      scheduleAllows: (_pawn, _activity) => true,
    },

    // ---------------- vision (модуль vision) ----------------
    vision: {
      isVisible: (_tx, _ty) => true,
      isExplored: (_tx, _ty) => true,
      canPawnSee: (_pawn, _tx, _ty) => true,
      /** Сообщение о событии в точке: vision может исказить/задержать его, если точка вне обзора. */
      report(text, opts = {}) {
        api.ui.notify(text, opts);
      },
    },

    // ---------------- orders (модуль vision: приказы лидера) ----------------
    orders: {
      /** Список доступных приказов для пешки: [{id, label}] */
      list: (_leader, _pawn) => [],
      /** Отдать приказ. @returns {boolean} принят ли */
      give: (_leader, _pawn, _orderId, _target) => false,
      openMenu: (_leader, _pawn) => {},
    },

    // ---------------- combat (модуль combat) ----------------
    combat: {
      isHostile(a, b) {
        if (!a || !b || a === b) return false;
        const fa = a.faction;
        const fb = b.faction;
        return (fa === FACTION.ENEMY && fb !== FACTION.ENEMY) || (fb === FACTION.ENEMY && fa !== FACTION.ENEMY);
      },
      isDrafted: (pawn) => !!pawn?.drafted,
      setDrafted(pawn, v) {
        if (pawn) pawn.drafted = !!v;
      },
      /** Атака цели (пешки/сущности или точки). */
      attack: (_attacker, _target) => false,
      /** Запустить рейд. opts: {faction, points, kind} */
      spawnRaid: (_opts) => null,
      getMana: (_pawn) => null,
    },

    // ---------------- economy (модуль economy) ----------------
    economy: {
      itemValue: (defId) => game.defs.items.get(defId)?.value ?? 1,
      colonyWealth() {
        let w = 0;
        for (const it of game.entities.ofKind('item')) w += (game.defs.items.get(it.defId)?.value ?? 1) * it.count;
        return w;
      },
      /** Хватает ли ресурсов колонии: cost = {wood: 10, stone: 5} */
      canAfford: (cost) => Object.entries(cost || {}).every(([id, n]) => game.items.count(id) >= n),
      /** Списать ресурсы (ближайшие к точке). @returns {boolean} */
      consume: (cost, nearX = 0, nearY = 0) => game.items.consume(cost, nearX, nearY),
    },

    // ---------------- journey (модуль journey) ----------------
    journey: {
      getBiome: () => game.map?.biome ?? 'forest',
      getStation: () => ({ index: 0, id: 'start', nameKey: 'station.start' }),
      isTravelling: () => false,
      getFuel: () => null,
      depart: () => false,
    },

    // ---------------- build (модуль build) ----------------
    build: {
      /** Можно ли поставить постройку. Заглушка проверяет границы, проходимость и placeableOn. */
      canPlace(defId, x, y, rot = 0) {
        const def = game.defs.buildings.get(defId);
        const map = game.map;
        if (!def || !map) return false;
        const [w, h] = game.entities.footprintSize(def, rot);
        for (let j = 0; j < h; j++)
          for (let i = 0; i < w; i++) {
            const tx = x + i;
            const ty = y + j;
            if (!map.inBounds(tx, ty)) return false;
            const k = map.idx(tx, ty);
            if (map.building[k] || map.plant[k]) return false;
            if (!map.terrainDef(tx, ty).buildable && !map.floor[k]) return false;
            const inWagon = map.roof[k] > 0 && map.room[k] > 0;
            if (def.placeableOn === 'wagon' && !inWagon) return false;
            if (def.placeableOn === 'ground' && inWagon) return false;
          }
        return true;
      },
      /** Поставить постройку. Заглушка: сразу готовая (без чертежа и материалов). */
      place(defId, x, y, opts = {}) {
        if (!opts.force && !api.build.canPlace(defId, x, y, opts.rot || 0)) return null;
        return game.entities.spawn('building', { defId, x, y, rot: opts.rot || 0, faction: 'colony' });
      },
      deconstruct(entity) {
        if (!entity || entity.removed) return false;
        game.entities.remove(entity, 'deconstructed');
        return true;
      },
    },

    // ---------------- ui (модуль ui) ----------------
    ui: {
      /** Уведомление игроку. opts: {type: 'info'|'good'|'bad'|'danger', x?, y?, pawnId?} */
      notify(text, opts = {}) {
        const entry = { text, type: opts.type || 'info', tick: game.time.tick, day: game.time.day, ...opts };
        game.log.push(entry);
        if (game.log.length > 500) game.log.shift();
        game.events.emit(EVENTS.UI_NOTIFY, entry);
      },
    },

    // ---------------- av (модуль av) ----------------
    av: {
      shake: (amount = 0.3) => game.camera?.addShake?.(amount),
      floatText: (x, y, text, color = '#fff') => game.events.emit(EVENTS.AV_FLOAT_TEXT, { x, y, text, color }),
      play: (sfxId, opts) => game.audio?.play?.(sfxId, opts),
    },
  };
  return api;
}
