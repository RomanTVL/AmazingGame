// Лидер под прямым управлением: WASD (с коллизиями), взгляд на курсор, E — действие руками,
// Q — меню приказов (модуль vision/orders), R — «К оружию!» (combat), 1–4 — заклинания (combat),
// ЛКМ — атака (combat), Shift — рывок (combat), C+перетаскивание — временный инструмент пометок
// (модуль build заменит полноценным). Смерть лидера → наследник (см. sim/colony.js, событие leader:died).
//
// Взаимодействия (E) расширяемы: game.defs.interactions —
//   {id, order, find(game, pawn, tx, ty) → {label, run(game, pawn), x?, y?} | null}
// Удерживаемые (лопата, нести, сесть, канал заклинания): def или результат find с
//   {hold: true, onHoldStart(game, pawn), onHoldTick?(game, pawn, heldMs, dtReal), onRelease(game, pawn, heldMs)}
// — run не вызывается; пока E зажата, цель не меняется; отпускание/потеря фокуса/смерть → onRelease.
import { EVENTS } from '../core/events.js';
import { clamp, dist, safeNum } from '../core/math.js';
import { moveTo, stopMoving, sanitizePosition } from '../sim/pawn.js';
import { resKey } from '../sim/jobs.js';

export const PLAYER_KEYS = [
  ['player:up', 'KeyW', 'input.up'],
  ['player:down', 'KeyS', 'input.down'],
  ['player:left', 'KeyA', 'input.left'],
  ['player:right', 'KeyD', 'input.right'],
  ['player:interact', 'KeyE', 'input.interact'],
  ['player:designate', 'KeyC', 'input.designate'],
];
/** Клавиши, выделенные модулям (регистрирует ядро, чтобы раскладка была единой). */
export const RESERVED_PLAYER_KEYS = [
  ['player:orders', 'KeyQ', 'input.orders', 'vision'],
  ['player:callToArms', 'KeyR', 'input.call_to_arms', 'combat'],
  ['player:spell1', 'Digit1', 'input.spell1', 'combat'],
  ['player:spell2', 'Digit2', 'input.spell2', 'combat'],
  ['player:spell3', 'Digit3', 'input.spell3', 'combat'],
  ['player:spell4', 'Digit4', 'input.spell4', 'combat'],
  ['player:attack', 'Mouse0', 'input.attack', 'combat'],
  ['player:dash', 'ShiftLeft', 'input.dash', 'combat'],
];

/**
 * Клавиши модулей, которые ядро регистрирует заранее (раскладка едина, имена событий — 'journey:*').
 * Пространство имён действий 'journey:', владелец — модуль train (локомотив).
 */
export const RESERVED_MODULE_KEYS = [
  ['journey:horn', 'KeyH', 'input.horn', 'train'],
  ['journey:regUp', 'BracketRight', 'input.regUp', 'train'],
  ['journey:regDown', 'BracketLeft', 'input.regDown', 'train'],
];

const REACH = 1.75; // ближняя досягаемость (клетки)
const HOVER_RANGE = 8; // наведённая цель в этом радиусе — лидер сам подойдёт

export class PlayerController {
  constructor(game) {
    this.game = game;
    this.hint = null;
    this.tool = null; // {mode: 'add'|'remove', x0, y0}
    this.toolActive = false;
    /**
     * Временный инструмент пометок ядра (C + перетаскивание). Модуль build, заменяя его своим,
     * ставит false и сам опрашивает game.input.isDown('player:designate').
     */
    this.coreDesignateTool = true;
    /** Идущее удержание E: {hint, pawn, ms} | null */
    this.holding = null;
    this._stepT = 0;
  }

  /** Сброс состояния ввода (новая игра / загрузка / потеря фокуса). */
  reset() {
    this.hint = null;
    this.tool = null;
    this.toolActive = false;
    this.holding = null;
  }

  /** Завершить удержание E (если идёт): onRelease(game, pawn, heldMs) + событие 'player:interactEnd'. */
  endHold() {
    const h = this.holding;
    if (!h) return;
    this.holding = null;
    const game = this.game;
    try {
      h.hint.onRelease?.(game, h.pawn, h.ms);
    } catch (err) {
      game.error(err, `interaction:${h.hint.id}`);
    }
    game.events.emit(EVENTS.PLAYER_INTERACT_END, { pawn: h.pawn, interaction: h.hint, heldMs: h.ms });
  }

  /** Пешка под управлением игрока (лидер или наследник). */
  get pawn() {
    const p = this.game.getLeader();
    return p && p.controlled === 'player' ? p : null;
  }

  /** Подойти в клетку (автоходьба; WASD прерывает). */
  walkTo(x, y) {
    const p = this.pawn;
    if (!p) return false;
    if (p.job) this.game.jobs.endJob(p, 'cancelled');
    return moveTo(this.game, p, Math.floor(x), Math.floor(y));
  }

  // ---------- Кадр (ввод) ----------
  frame(dtReal = 0) {
    const game = this.game;
    const input = game.input;
    const p = this.pawn;
    if (input.lostFocus) {
      this.tool = null; // окно потеряло фокус посреди перетаскивания — отменяем
      this.endHold();
    }
    if (!p) {
      this.hint = null;
      this.tool = null;
      this.endHold();
      return;
    }
    if (game.ui.modalOpen) {
      p.moveInput.x = p.moveInput.y = 0;
      this.endHold();
      return;
    }
    // движение
    let mx = (input.isDown('player:right') ? 1 : 0) - (input.isDown('player:left') ? 1 : 0);
    let my = (input.isDown('player:down') ? 1 : 0) - (input.isDown('player:up') ? 1 : 0);
    if (mx && my) {
      mx *= Math.SQRT1_2;
      my *= Math.SQRT1_2;
    }
    p.moveInput.x = mx;
    p.moveInput.y = my;
    if (mx || my) {
      if (p.job?.manual) game.jobs.endJob(p, 'cancelled');
      if (p.path) stopMoving(p);
    }
    const m = input.mouse;
    const overUI = game.ui.wantsMouse;

    // временный инструмент пометок (C + перетаскивание)
    this.toolActive = this.coreDesignateTool && input.isDown('player:designate');
    if (!this.coreDesignateTool) this.tool = null;
    if (this.toolActive && !overUI) {
      if (!this.tool && input.keyPressed('Mouse0')) this.tool = { mode: 'add', x0: m.tx, y0: m.ty };
      if (!this.tool && input.keyPressed('Mouse2')) this.tool = { mode: 'remove', x0: m.tx, y0: m.ty };
    }
    if (this.tool) {
      const btn = this.tool.mode === 'add' ? 'Mouse0' : 'Mouse2';
      if (!input.keyDown(btn)) {
        this.applyTool(this.tool, m.tx, m.ty);
        this.tool = null;
      }
    }

    // взаимодействие (тап — run; hold — onHoldStart … onRelease)
    if (this.holding) {
      const h = this.holding;
      h.ms += (Number.isFinite(dtReal) ? dtReal : 0) * 1000;
      if (h.pawn !== p || !input.isDown('player:interact')) this.endHold();
      else {
        try {
          h.hint.onHoldTick?.(game, p, h.ms, dtReal);
        } catch (err) {
          game.error(err, `interaction:${h.hint.id}`);
        }
      }
    } else this.hint = this.findInteraction(p);
    if (!this.holding && input.pressed('player:interact')) {
      const h = this.hint;
      if (h) {
        if (h.hold) {
          this.holding = { hint: h, pawn: p, ms: 0 };
          try {
            h.onHoldStart?.(game, p);
          } catch (err) {
            game.error(err, `interaction:${h.id}`);
          }
        } else h.run?.(game, p);
        game.events.emit(EVENTS.PLAYER_INTERACT, { pawn: p, interaction: h });
      } else game.audio.play('error');
    }

    // события для модулей
    if (input.pressed('player:orders')) {
      const target = this.hoveredColonist(p);
      game.events.emit(EVENTS.PLAYER_ORDER_MENU, { leader: p, target, x: m.wx, y: m.wy });
      game.api.orders.openMenu(p, target);
    }
    if (input.pressed('player:callToArms')) game.events.emit(EVENTS.PLAYER_CALL_TO_ARMS, { leader: p });
    for (let i = 0; i < 4; i++) {
      if (input.pressed(`player:spell${i + 1}`)) game.events.emit(EVENTS.PLAYER_SPELL, { leader: p, slot: i, x: m.wx, y: m.wy });
    }
    if (!this.toolActive && !this.tool && !overUI && input.pressed('player:attack')) {
      game.events.emit(EVENTS.PLAYER_ATTACK, { leader: p, x: m.wx, y: m.wy });
    }
    if (input.pressed('player:dash')) game.events.emit(EVENTS.PLAYER_DASH, { leader: p, x: m.wx, y: m.wy });

    // взгляд на курсор
    if (m.inside && !p.job) p.dir = Math.atan2(m.wy - p.y, m.wx - p.x);
  }

  applyTool(tool, x1, y1) {
    const game = this.game;
    const x0 = Math.min(tool.x0, x1);
    const y0 = Math.min(tool.y0, y1);
    const xa = Math.max(tool.x0, x1);
    const ya = Math.max(tool.y0, y1);
    const types = ['chop', 'harvest', 'mine'];
    const n = tool.mode === 'add' ? game.designations.addRect(types, x0, y0, xa, ya) : game.designations.removeRect(types, x0, y0, xa, ya);
    if (n > 0) game.audio.play('designate');
    return n;
  }

  hoveredColonist(p) {
    const game = this.game;
    const m = game.input.mouse;
    const near = game.entities.queryRadius(m.wx, m.wy, 0.8, 'pawn', (o) => o !== p && !o.dead && o.faction === 'colony');
    if (near.length) return near[0];
    const around = game.entities.queryRadius(p.x, p.y, 4, 'pawn', (o) => o !== p && !o.dead && o.faction === 'colony');
    around.sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y));
    return around[0] || null;
  }

  /** Лучшее доступное действие E: наведённая клетка (до 8 клеток) → ближайшие клетки вокруг лидера. */
  findInteraction(p) {
    const game = this.game;
    const map = game.map;
    if (!map) return null;
    const m = game.input.mouse;
    const list = game.defs.interactions.all();
    const tryTile = (tx, ty) => {
      if (!map.inBounds(tx, ty)) return null;
      if (!game.api.vision.isVisible(tx, ty)) return null;
      for (const it of list) {
        const r = it.find(game, p, tx, ty);
        if (r) {
          const out = { ...r, id: it.id, tx, ty };
          if (it.hold && out.hold === undefined) out.hold = true;
          for (const k of ['onHoldStart', 'onHoldTick', 'onRelease']) if (!out[k] && it[k]) out[k] = it[k];
          return out;
        }
      }
      return null;
    };
    if (m.inside && dist(m.tx + 0.5, m.ty + 0.5, p.x, p.y) <= HOVER_RANGE) {
      const r = tryTile(m.tx, m.ty);
      if (r) return r;
    }
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const near = [];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const d = dist(px + dx + 0.5, py + dy + 0.5, p.x, p.y);
        if (d <= REACH + 0.5) {
          // предпочитаем то, что перед лицом
          const ang = Math.atan2(dy, dx);
          const facing = Math.cos(ang - p.dir);
          near.push({ x: px + dx, y: py + dy, score: d - facing * 0.4 });
        }
      }
    near.sort((a, b) => a.score - b.score);
    for (const c of near) {
      const r = tryTile(c.x, c.y);
      if (r) return r;
    }
    if (p.carry) {
      return {
        id: 'drop',
        label: game.t('act.drop', { name: game.t(game.defs.items.get(p.carry.defId)?.nameKey || '') }),
        run: (g, pawn) => g.items.dropCarried(pawn),
      };
    }
    return null;
  }

  // ---------- Тик симуляции (движение WASD) ----------
  step(dt) {
    const game = this.game;
    const p = this.pawn;
    const map = game.map;
    if (!p || !map || p.dead || p.downed) return;
    sanitizePosition(game, p);
    const mx = safeNum(p.moveInput?.x, -1, 1, 0);
    const my = safeNum(p.moveInput?.y, -1, 1, 0);
    if (!mx && !my) {
      if (!p.path) p.moving = false;
      return;
    }
    const cost = map.cost[map.idx(clamp(Math.floor(p.x), 0, map.w - 1), clamp(Math.floor(p.y), 0, map.h - 1))] || 1;
    const speed = (safeNum(p.speed, 0, 40, 4) * safeNum(game.api.health.moveSpeedFactor(p), 0.05, 3)) / Math.max(0.6, cost);
    const r = p.radius ?? 0.3;
    const stuck = this.collides(p.x, p.y, r);
    const nx = p.x + mx * speed * dt;
    if (stuck || !this.collides(nx, p.y, r)) p.x = nx;
    const ny = p.y + my * speed * dt;
    if (stuck || !this.collides(p.x, ny, r)) p.y = ny;
    p.x = clamp(p.x, r, map.w - r);
    p.y = clamp(p.y, r, map.h - r);
    p.moving = true;
    p.walkPhase += speed * dt * 2.6;
    if (!game.input.mouse.inside) p.dir = Math.atan2(my, mx);
    game.entities.moved(p);
  }

  /** Пересекает ли круг (x, y, r) непроходимые клетки. */
  collides(x, y, r) {
    const map = this.game.map;
    const x0 = Math.floor(x - r);
    const x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r);
    const y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        if (!map.inBounds(tx, ty)) return true;
        if (map.cost[map.idx(tx, ty)] > 0) continue;
        const cx = clamp(x, tx, tx + 1);
        const cy = clamp(y, ty, ty + 1);
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
      }
    return false;
  }
}

/** Базовые действия E. */
function registerInteractions(game) {
  const reg = game.defs.create('interactions', { sortBy: 'order', defaults: { order: 100 } });
  const name = (key) => game.t(key);

  reg.add({
    id: 'work-thing',
    order: 10,
    find(game, p, tx, ty) {
      const plant = game.map.plantAt(tx, ty);
      if (plant) {
        const def = game.defs.plants.get(plant.defId);
        if (def?.harvestYield && (plant.growth ?? 1) >= 1)
          return { label: game.t('act.harvest', { name: name(def.nameKey) }), x: tx, y: ty, run: (g, pawn) => manual(g, pawn, 'harvest', plant) };
        if (def?.choppable) return { label: game.t('act.chop', { name: name(def.nameKey) }), x: tx, y: ty, run: (g, pawn) => manual(g, pawn, 'chop', plant) };
      }
      const b = game.map.buildingAt(tx, ty);
      const bd = b && game.defs.buildings.get(b.defId);
      if (bd?.mineable) return { label: game.t('act.mine', { name: name(bd.nameKey) }), x: tx, y: ty, run: (g, pawn) => manual(g, pawn, 'mine', b) };
      return null;
    },
  });

  reg.add({
    id: 'eat',
    order: 20,
    find(game, p, tx, ty) {
      const it = game.items.itemAt(tx, ty);
      const def = it && game.defs.items.get(it.defId);
      if (!def || !(def.nutrition > 0) || (p.needs.food ?? 1) > 0.85) return null;
      return {
        label: game.t('act.eat', { name: name(def.nameKey) }),
        x: tx,
        y: ty,
        run(g, pawn) {
          const count = Math.max(1, Math.min(it.count, Math.ceil((1 - pawn.needs.food) / def.nutrition)));
          if (!g.jobs.startManual(pawn, 'eat', { targetId: it.id, x: it.x, y: it.y, data: { count } })) g.audio.play('error');
        },
      };
    },
  });

  reg.add({
    id: 'store',
    order: 25,
    find(game, p, tx, ty) {
      if (!p.carry) return null;
      const z = game.zones.zoneAt(tx, ty);
      if (!z || !game.zones.isStorage(z) || game.items.roomAt(p.carry.defId, tx, ty) <= 0) return null;
      return {
        label: game.t('act.store', { name: name(game.defs.items.get(p.carry.defId)?.nameKey) }),
        x: tx,
        y: ty,
        run: (g, pawn) => g.jobs.startManual(pawn, 'player_drop', { x: tx, y: ty }),
      };
    },
  });

  reg.add({
    id: 'pickup',
    order: 30,
    find(game, p, tx, ty) {
      const it = game.items.itemAt(tx, ty);
      if (!it) return null;
      if (p.carry && p.carry.defId !== it.defId) return null;
      const def = game.defs.items.get(it.defId);
      return {
        label: game.t('act.pickup', { name: name(def?.nameKey), count: it.count }),
        x: tx,
        y: ty,
        run: (g, pawn) => {
          if (!g.jobs.startManual(pawn, 'player_pickup', { targetId: it.id, x: it.x, y: it.y })) g.audio.play('error');
        },
      };
    },
  });

  reg.add({
    id: 'sleep',
    order: 90,
    find(game, p, tx, ty) {
      if ((p.needs.rest ?? 1) > 0.35) return null;
      const map = game.map;
      const b = map.buildingAt(tx, ty);
      const bed = b && game.defs.buildings.get(b.defId)?.bed ? b : null;
      if (!bed && (!map.isRoofed(tx, ty) || !map.isPassable(tx, ty) || b)) return null;
      return {
        label: game.t('act.sleep'),
        x: tx,
        y: ty,
        run: (g, pawn) => g.jobs.startManual(pawn, 'sleep', { x: tx, y: ty, data: { bedId: bed?.id || 0 } }),
      };
    },
  });

  // служебные задачи лидера
  game.jobs.registerJobType({
    id: 'player_pickup',
    workType: null,
    labelKey: 'job.haul',
    makeToils: (g, pawn, job) => {
      job.keepCarry = true;
      return [
        { type: 'goto', targetId: job.targetId, adjacent: true },
        { type: 'pickup', targetId: job.targetId },
      ];
    },
  });
  game.jobs.registerJobType({
    id: 'player_drop',
    workType: null,
    labelKey: 'job.haul',
    reserve: (g, pawn, job) => [resKey.cell(job.x, job.y)],
    makeToils: (g, pawn, job) => {
      job.keepCarry = true;
      return [
        { type: 'goto', x: job.x, y: job.y, adjacent: true },
        { type: 'drop', x: job.x, y: job.y },
      ];
    },
  });
}

function manual(game, pawn, typeId, target) {
  const ok = game.jobs.startManual(pawn, typeId, { targetId: target.id, x: target.x, y: target.y });
  if (!ok) game.audio.play('error');
  return ok;
}

export function registerPlayer(game) {
  const pc = new PlayerController(game);
  game.player = pc;
  for (const [a, k, label] of PLAYER_KEYS) game.input.registerKey(a, k, 'core', { label });
  for (const [a, k, label, owner] of RESERVED_PLAYER_KEYS) game.input.registerKey(a, k, owner, { label });
  for (const [a, k, label, owner] of RESERVED_MODULE_KEYS) game.input.registerKey(a, k, owner, { label });
  registerInteractions(game);
  game.frameSystems.add({ id: 'player', order: 30, update: (g, dt) => pc.frame(dt) });
  game.systems.add({ id: 'player', order: 15, update: (g, dt) => pc.step(dt) });
  // звук шагов лидера (косметика)
  game.frameSystems.add({
    id: 'player-steps',
    order: 31,
    update(g, dt) {
      const p = pc.pawn;
      if (!p || !p.moving) return;
      pc._stepT += dt;
      if (pc._stepT > 0.32) {
        pc._stepT = 0;
        g.audio.play('step', { x: p.x, y: p.y, vol: 0.6 });
      }
    },
  });
}
