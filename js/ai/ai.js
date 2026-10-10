// Базовый ИИ пешек: «дерево мыслей» из узлов с приоритетами.
//   game.ai.registerThinkNode({ id, priority, interrupts?, factions?, evaluate(game, pawn, ctx) → job|null })
// Пешка без задачи перебирает узлы по убыванию priority, первый вернувший задачу — побеждает.
// Узлы с interrupts=true раз в 30 тиков могут прервать текущую задачу с меньшим приоритетом.
// Пешку под прямым управлением (controlled === 'player') ИИ не трогает.
import { FACTION } from '../core/constants.js';

export class AIManager {
  constructor(game) {
    this.game = game;
    this.nodes = [];
  }

  /**
   * @param {{id: string, priority: number, interrupts?: boolean, factions?: string[],
   *          evaluate: (game, pawn, ctx: {interrupt: boolean}) => object|null, override?: boolean}} node
   */
  registerThinkNode(node, owner = 'core') {
    if (!node?.id || typeof node.evaluate !== 'function') throw new Error('[ai] узел: нужны id и evaluate');
    const i = this.nodes.findIndex((n) => n.id === node.id);
    if (i >= 0 && !node.override) throw new Error(`[ai] дубликат узла ${node.id}`);
    node.owner = owner;
    if (i >= 0) this.nodes[i] = node;
    else this.nodes.push(node);
    this.nodes.sort((a, b) => b.priority - a.priority);
    return node;
  }

  removeThinkNode(id) {
    this.nodes = this.nodes.filter((n) => n.id !== id);
  }

  getNode(id) {
    return this.nodes.find((n) => n.id === id);
  }

  _allowed(node, pawn) {
    return !node.factions || node.factions.includes(pawn.faction);
  }

  /** Подумать: вернуть новую задачу (или null). */
  think(pawn, interrupt = false) {
    const game = this.game;
    const minPriority = interrupt && pawn.job ? pawn.job.priority : -Infinity;
    for (const node of this.nodes) {
      if (node.priority <= minPriority) break;
      if (interrupt && !node.interrupts) continue;
      if (!this._allowed(node, pawn)) continue;
      let job = null;
      try {
        job = node.evaluate(game, pawn, { interrupt });
      } catch (err) {
        game.error(err, `ai:${node.id}`);
      }
      if (job) {
        job.priority = Math.max(job.priority ?? 0, node.priority);
        if (game.jobs.startJob(pawn, job)) return job;
      }
    }
    return null;
  }
}

export function registerAI(game) {
  const ai = game.ai;

  // Система мышления (порядок 30): выбор задач
  game.systems.add({
    id: 'ai',
    order: 30,
    update(game) {
      const tick = game.time.tick;
      for (const p of game.entities.ofKind('pawn')) {
        if (p.dead || p.downed || p.controlled === 'player') continue;
        if (p.job) {
          if ((tick + p.id) % 30 === 0) ai.think(p, true);
          continue;
        }
        if (p._thinkCooldown > 0) {
          p._thinkCooldown--;
          continue;
        }
        if (!ai.think(p, false)) p._thinkCooldown = 20 + (p.id % 7);
      }
    },
  });

  // Система выполнения задач (порядок 40): шаги текущей задачи — и для ИИ, и для лидера (ручная работа)
  game.systems.add({
    id: 'jobs',
    order: 40,
    update(game, dt) {
      for (const p of game.entities.ofKind('pawn')) {
        if (p.dead) continue;
        if (p.job) game.jobs.tickPawn(p, dt);
      }
    },
  });

  // --- Бегство от врагов ---
  game.jobs.registerJobType({
    id: 'flee',
    workType: null,
    labelKey: 'job.flee',
    priority: 95,
    makeToils(game, pawn, job) {
      return [{ type: 'goto', x: job.x, y: job.y }, { type: 'wait', ticks: 60 }];
    },
  });

  ai.registerThinkNode({
    id: 'flee',
    priority: 95,
    interrupts: true,
    factions: [FACTION.COLONY, FACTION.NEUTRAL],
    evaluate(game, pawn) {
      if (pawn.drafted || pawn.job?.type === 'flee') return null;
      const threats = game.entities.queryRadius(pawn.x, pawn.y, 6, 'pawn', (o) => !o.dead && !o.downed && game.api.combat.isHostile(pawn, o));
      if (!threats.length) return null;
      let ax = 0;
      let ay = 0;
      for (const t of threats) {
        ax += pawn.x - t.x;
        ay += pawn.y - t.y;
      }
      const l = Math.hypot(ax, ay) || 1;
      // бежим от врагов, предпочтительно к поезду
      const home = game.train?.center();
      let tx = pawn.x + (ax / l) * 9;
      let ty = pawn.y + (ay / l) * 9;
      if (home) {
        tx = tx * 0.6 + home.x * 0.4;
        ty = ty * 0.6 + home.y * 0.4;
      }
      const spot = game.map.randomPassableNear(game.rng, tx, ty, 3, 20, (x, y) => game.pathfinder.canReach(pawn.x, pawn.y, x, y));
      if (!spot) return null;
      return game.jobs.createJob('flee', pawn, { x: spot.x, y: spot.y });
    },
  });

  // --- Работа по приоритетам ---
  ai.registerThinkNode({
    id: 'work',
    priority: 50,
    factions: [FACTION.COLONY],
    evaluate(game, pawn) {
      return game.jobs.findWork(pawn);
    },
  });

  // --- Прогулка рядом с домом (поездом) ---
  ai.registerThinkNode({
    id: 'wander',
    priority: 10,
    evaluate(game, pawn) {
      const rng = game.rng;
      const home = pawn.faction === FACTION.COLONY ? game.train?.center() : null;
      let cx = pawn.x;
      let cy = pawn.y;
      let r = 6;
      if (home) {
        const far = Math.hypot(home.x - pawn.x, home.y - pawn.y) > 14;
        if (far || game.time.isNight()) {
          cx = home.x;
          cy = home.y;
          r = game.time.isNight() ? 4 : 10;
        }
      }
      const spot = game.map.randomPassableNear(rng, cx, cy, r, 16, (x, y) => game.pathfinder.canReach(pawn.x, pawn.y, x, y));
      if (!spot) return game.jobs.createJob('wait', pawn, { data: { ticks: 60 } });
      return game.jobs.createJob('wander', pawn, { x: spot.x, y: spot.y, data: { wait: rng.int(60, 260) } });
    },
  });
}
