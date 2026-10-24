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
import { generateName } from '../sim/pawn.js';

const clamp100 = (v) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

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
      /** «Память» колонии о павших 0..100 (game.colony.memory). */
      getMemory: () => game.colony.memory ?? 0,
      /** Изменить память (clamp 0..100), событие 'health:memoryChanged' {value, delta, reason}. @returns {number} */
      addMemory(delta, reason = '') {
        const prev = game.colony.memory ?? 0;
        const value = clamp100(prev + (Number.isFinite(delta) ? delta : 0));
        game.colony.memory = value;
        if (value !== prev) game.events.emit(EVENTS.HEALTH_MEMORY_CHANGED, { value, delta: value - prev, reason });
        return value;
      },
      /** Несёт ли пешка кого-то (тело/раненого). */
      isCarrying: (_pawn) => false,
      /** Может ли пешка нести другого. */
      canCarry: (pawn) => !!pawn && !pawn.dead,
      /** Записать павшего в «Павшие». Заглушка — no-op. @returns {object|null} запись */
      recordFallen: (_pawn, _opts) => null,
      /** Создать запись павшего без пешки (предыстория сценария). Заглушка → null. */
      createFallen: (_spec, _opts) => null,
      /** Список записей «Павших». */
      getFallen: () => [],
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
      /** Авторитет лидера 0..100 (game.colony.authority). */
      getAuthority: () => game.colony.authority ?? 50,
      /** Изменить авторитет (clamp 0..100), событие 'mind:authorityChanged' {value, delta, reason}. @returns {number} */
      addAuthority(delta, reason = '') {
        const prev = game.colony.authority ?? 50;
        const value = clamp100(prev + (Number.isFinite(delta) ? delta : 0));
        game.colony.authority = value;
        if (value !== prev) game.events.emit(EVENTS.MIND_AUTHORITY_CHANGED, { value, delta: value - prev, reason });
        return value;
      },
      /** Послушается ли пешка приказа. @returns {{ok: boolean, reply: string|null}} */
      willObey: (_pawn, _orderId, _opts) => ({ ok: true, reply: null }),
      /** Дать черту (заглушка: добавляет id в pawn.traits). */
      addTrait(pawn, traitId, _opts) {
        if (!pawn || !traitId) return;
        pawn.traits ||= [];
        if (!pawn.traits.includes(traitId)) pawn.traits.push(traitId);
      },
      /** Раскрыть скрытую черту (заглушка — no-op). */
      revealTrait: (_pawn, _traitId) => {},
      /** Отношение a → b (заглушка: a.relations[b.id] = {kind, opinion}). */
      setRelation(a, b, kind, opinion = 0) {
        if (!a || !b || a === b) return;
        a.relations ||= {};
        a.relations[b.id] = { ...(a.relations[b.id] || {}), kind, opinion };
      },
      /**
       * Кандидат в поселенцы для экрана новой игры (реролл): простой spec для createPawn / opts.roster.
       * rng — game.rng.fork(...) (детерминированно). opts: {gender?, role?, lang?}
       */
      generateCandidate(rng, opts = {}) {
        const gender = opts.gender || (rng.chance(0.5) ? 'male' : 'female');
        return {
          name: generateName(rng, opts.lang || game.i18n.lang, gender),
          gender,
          age: rng.int(18, 62),
          bio: null,
          traits: [],
          skills: {},
          look: {},
          role: opts.role || null,
        };
      },
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
      /** Шум в точке (выстрел, крик, гудок): заглушка шлёт 'vision:noise' {x, y, radius, kind}. */
      noise(x, y, radius = 6, kind = 'generic') {
        game.events.emit(EVENTS.VISION_NOISE, { x, y, radius, kind });
      },
      /** Слышит ли лидер точку (заглушка: расстояние до лидера ≤ 8 клеток). */
      canLeaderHear(x, y) {
        const l = game.getLeader();
        return !!l && Math.hypot(l.x - x, l.y - y) <= 8;
      },
      /** Последнее известное состояние сущности вне обзора: {x, y, tick, ...} | null. */
      lastKnown: (_entityId) => null,
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
      /** Есть ли у пешки посох (лидер-маг без посоха не колдует). */
      hasStaff: (_pawn) => true,
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
      /** Зависим ли поселенец (kind — id вещества или категории). */
      isAddicted: (_pawn, _kind) => false,
      /** Начать обыск Инквизиции на станции. @returns {boolean} начат ли */
      startInspection: (_opts) => false,
    },

    // ---------------- journey (модуль journey) ----------------
    // Пространство 'journey' делят два модуля: journey (маршрут, станции, Гниль) и train (локомотив, котёл,
    // топливо, вагоны). Кто что предоставляет — docs/ARCHITECTURE.md, таблица владения.
    journey: {
      getBiome: () => game.map?.biome ?? 'forest',
      getStation: () => ({ index: 0, id: 'start', nameKey: 'station.start' }),
      isTravelling: () => false,
      /** [train] Топливо: {kind, amount, max} | null. */
      getFuel: () => null,
      depart: () => false,
      /** [train] Состояние локомотива (снимок, не мутировать). */
      getTrainState: () => ({
        engine: 'steam', moving: false, speed: 0, regulator: 0, heat: 0, pressure: 0, boilerState: 'ok',
        fuel: 0, battery: 0, noise: 0, rotGapHours: null, rotGapExact: false,
      }),
      /** [train] Положение регулятора 0..1. @returns {boolean} принято ли */
      setRegulator: (_value) => false,
      /** [journey] Температура воздуха снаружи, °C. */
      getAmbientTemp: () => 15,
      /** [train] Тепло вагона (относительно наружного), °C. */
      getCarHeat: (_carIndex) => 0,
      /** [train] Стоит ли пешка в кабине машиниста. */
      isInCab: (_pawn) => false,
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
      /** Цель/задача на экране (заглушка хранит в game.colony.objectives[id] = {text, ...opts}). */
      setObjective(id, text, opts = {}) {
        if (!id) return;
        (game.colony.objectives ||= {})[id] = { text, ...opts };
      },
      clearObjective(id) {
        if (game.colony.objectives) delete game.colony.objectives[id];
      },
    },

    // ---------------- av (модуль av) ----------------
    av: {
      shake: (amount = 0.3) => game.camera?.addShake?.(amount),
      floatText: (x, y, text, color = '#fff') => game.events.emit(EVENTS.AV_FLOAT_TEXT, { x, y, text, color }),
      play: (sfxId, opts) => game.audio?.play?.(sfxId, opts),
      /** «Хит-стоп»: короткий стоп-кадр симуляции (заглушка: game.slowMo(0.05, ms)). @returns {number} id slowMo */
      hitStop: (ms = 60) => game.slowMo(0.05, Math.max(0, Math.min(500, ms))),
      /** Вспышка сущности (попадание). Заглушка — no-op. */
      flash: (_entity, _ms) => {},
    },
  };
  return api;
}
