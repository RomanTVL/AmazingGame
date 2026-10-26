// Задачи стройки: подноска материалов (hauling), стройка (construction), разборка по пометке.
// Действия E лидера: строить (удерживать), принести/отдать материалы, разобрать (удерживать).
import { resKey, thingWorkJob } from '../../sim/jobs.js';
import { OWNER } from './core.js';

const MAX_BP_SCAN = 80;

export function installJobs(B) {
  const game = B.game;
  const J = game.jobs;

  // ---------------- Подноска материалов (носильщики; строители — для своих чертежей тоже) ----------------
  const deliverJob = (id, workType, priority) => ({
    id,
    workType,
    labelKey: 'build.job.deliver',
    priority,
    adjacent: true,
    findJob: (g, pawn) => findDelivery(B, pawn),
    reserve(g, pawn, job) {
      const keys = [`bpm:${job.data.bpId}:${job.data.defId}`];
      if (job.targetId) keys.push(resKey.entity(job.targetId));
      return keys;
    },
    makeToils(g, pawn, job) {
      const toils = [];
      if (!job.data.carried) {
        toils.push({ type: 'goto', targetId: job.targetId, adjacent: true }, { type: 'pickup', targetId: job.targetId, count: job.data.count });
      }
      toils.push(
        { type: 'goto', targetId: job.data.bpId, adjacent: true },
        {
          type: 'interact',
          fn(gg, p) {
            const bp = gg.entities.get(job.data.bpId);
            return B.depositCarry(bp, p) ? 'done' : 'failed';
          },
        },
      );
      return toils;
    },
    failIf(g, pawn, job) {
      const bp = g.entities.get(job.data.bpId);
      if (!bp || bp.removed) return true;
      if (job.data.carried && job.i === 0 && pawn.carry?.defId !== job.data.defId) return true;
      return false;
    },
  });
  J.registerJobType(deliverJob('build_deliver', 'hauling', 60), OWNER);
  J.registerJobType(deliverJob('build_supply', 'construction', 50), OWNER);

  // ---------------- Стройка по чертежу ----------------
  J.registerJobType(
    {
      id: 'build_construct',
      workType: 'construction',
      labelKey: 'build.job.construct',
      priority: 55,
      adjacent: true,
      *findTargets(g) {
        if (!B.ensure()) return;
        for (const bp of g.entities.ofKind('blueprint')) if (bp.faction === 'colony' && B.isReady(bp)) yield { x: bp.x, y: bp.y, targetId: bp.id };
      },
      canDo(g, pawn, spec) {
        const bp = g.entities.get(spec.targetId);
        return !!bp && bp.kind === 'blueprint' && B.isReady(bp);
      },
      makeToils(g, pawn, job) {
        const bp = g.entities.get(job.targetId);
        if (!bp) return [];
        const start = bp.work || 0;
        const total = Math.max(1, bp.workTotal || 60);
        const left = Math.max(1, total - start);
        return [
          { type: 'goto', targetId: bp.id, adjacent: true },
          {
            type: 'work',
            ticks: left,
            workType: 'construction',
            targetId: bp.id,
            fx: 'build',
            onTick(gg) {
              const b = gg.entities.get(job.targetId);
              if (!b) return 'failed';
              b.work = Math.min(total, start + (this._p || 0));
              return undefined;
            },
            onDone(gg, p) {
              const b = gg.entities.get(job.targetId);
              if (!b) return 'failed';
              b.work = total;
              return B.finish(b, p) ? undefined : 'failed';
            },
          },
        ];
      },
      failIf(g, pawn, job) {
        const bp = g.entities.get(job.targetId);
        return !bp || bp.removed || !B.hasMaterials(bp);
      },
    },
    OWNER,
  );

  // ---------------- Разборка по пометке ----------------
  game.designations.registerType(
    {
      id: 'deconstruct',
      nameKey: 'build.des.deconstruct',
      color: '#ff5f6d',
      glyph: 'hammer',
      jobType: 'build_deconstruct',
      valid(g, x, y) {
        const b = g.map.buildingAt(x, y);
        return b && B.canDeconstruct(b) ? b.id : 0;
      },
      draw(ctx, d, g) {
        const t = g.entities.get(d.targetId);
        if (!t) return;
        const T = 32;
        ctx.strokeStyle = 'rgba(255,95,109,0.55)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(t.x * T + 2, t.y * T + 2, (t.w || 1) * T - 4, (t.h || 1) * T - 4);
        ctx.setLineDash([]);
      },
    },
    OWNER,
  );
  J.registerJobType(
    thingWorkJob({
      id: 'build_deconstruct',
      workType: 'construction',
      designation: 'deconstruct',
      labelKey: 'build.job.deconstruct',
      fx: 'build',
      kind: 'building',
      priority: 45,
      workTicks: (def) => Math.max(30, Math.round((def.workToBuild ?? 100) * 0.5)),
      canTarget: (g, t) => B.canDeconstruct(t),
      complete(g, pawn, t) {
        B.deconstructNow(t, pawn);
      },
    }),
    OWNER,
  );

  installInteractions(B);
}

/** Лучшая подноска: (чертёж, материал, ближайшая стопка) по сумме расстояний. */
export function findDelivery(B, pawn, onlyBp = null) {
  const game = B.game;
  if (!B.ensure()) return null;
  const carry = pawn.carry;
  const cache = new Map();
  let best = null;
  let bestScore = Infinity;
  let scanned = 0;
  const list = onlyBp ? [onlyBp] : game.entities.ofKind('blueprint');
  for (const bp of list) {
    if (bp.removed || bp.faction !== 'colony') continue;
    const need = B.needs(bp);
    if (!need) continue;
    if (++scanned > MAX_BP_SCAN) break;
    if (!game.pathfinder.canReach(pawn.x, pawn.y, bp.x, bp.y, true, bp.w || 1, bp.h || 1)) continue;
    const dBp = Math.hypot(bp.x + 0.5 - pawn.x, bp.y + 0.5 - pawn.y);
    for (const [defId, n] of need) {
      if (game.jobs.isReserved(`bpm:${bp.id}:${defId}`, pawn)) continue;
      if (carry && carry.defId === defId) {
        if (dBp < bestScore) {
          bestScore = dBp;
          best = { bp, defId, item: null, n };
        }
        continue;
      }
      let it = cache.get(defId);
      if (it === undefined) {
        it = game.items.findNearest(pawn, (i) => i.defId === defId) || null;
        cache.set(defId, it);
      }
      if (!it) continue;
      const s = Math.hypot(it.x + 0.5 - pawn.x, it.y + 0.5 - pawn.y) + Math.hypot(bp.x - it.x, bp.y - it.y);
      if (s < bestScore) {
        bestScore = s;
        best = { bp, defId, item: it, n };
      }
    }
  }
  if (!best) return null;
  const { bp, defId, item, n } = best;
  if (!item) return { targetId: 0, x: bp.x, y: bp.y, data: { bpId: bp.id, defId, count: 0, carried: true } };
  const lim = game.defs.items.get(defId)?.stackLimit ?? 75;
  return { targetId: item.id, x: item.x, y: item.y, data: { bpId: bp.id, defId, count: Math.max(1, Math.min(n, item.count, lim)) } };
}

function installInteractions(B) {
  const game = B.game;
  const I = game.defs.interactions;
  const t = (k, v) => game.t(k, v);
  const err = (g, p, x, y, key) => {
    g.audio.play('error');
    if (key) g.api.av.floatText(x + 0.5, y, t(key), '#ff9a8a');
  };
  const matName = (id) => t(game.defs.items.get(id)?.nameKey || id);

  // Строить / принести материалы (чертёж под курсором или рядом)
  I.add(
    {
      id: 'build:construct',
      order: 15,
      find(g, p, tx, ty) {
        const bp = B.blueprintAt(tx, ty, true);
        if (!bp || bp.faction !== 'colony') return null;
        const def = B.defOfBp(bp);
        const name = t(def?.nameKey || '');
        const need = B.needs(bp);
        if (need) {
          const give = p.carry && need.find(([id]) => id === p.carry.defId);
          if (give) {
            return {
              label: t('build.act.give', { what: matName(give[0]), n: Math.min(give[1], p.carry.count), name }),
              x: bp.x, y: bp.y,
              run: (gg, pawn) => {
                if (!manualDeliver(B, pawn, bp)) err(gg, pawn, bp.x, bp.y, 'build.err.busy');
              },
            };
          }
          const [id] = need[0];
          const have = (bp.delivered?.[id] || 0);
          const total = bp.cost[id];
          return {
            label: t('build.act.fetch', { what: matName(id), have, total, name }),
            x: bp.x, y: bp.y,
            run: (gg, pawn) => {
              if (!manualDeliver(B, pawn, bp)) err(gg, pawn, bp.x, bp.y, 'build.err.noMaterial');
            },
          };
        }
        const block = B.blockedReason(bp);
        if (block) return { label: t(`build.act.blocked_${block}`, { name }), x: bp.x, y: bp.y, run: (gg, pawn) => err(gg, pawn, bp.x, bp.y) };
        const pct = Math.round(((bp.work || 0) / Math.max(1, bp.workTotal || 1)) * 100);
        return {
          label: t('build.act.construct', { name, pct }),
          x: bp.x, y: bp.y,
          hold: true,
          onHoldStart(gg, pawn) {
            if (!gg.jobs.startManual(pawn, 'build_construct', { targetId: bp.id, x: bp.x, y: bp.y })) err(gg, pawn, bp.x, bp.y, 'build.err.busy');
          },
          onRelease(gg, pawn) {
            if (pawn.job?.type === 'build_construct' && pawn.job.manual) gg.jobs.endJob(pawn, 'cancelled');
          },
        };
      },
    },
    OWNER,
  );

  // Разобрать (удерживать E на помеченной постройке)
  I.add(
    {
      id: 'build:deconstruct',
      order: 16,
      find(g, p, tx, ty) {
        const b = g.map.buildingAt(tx, ty);
        if (!b || !g.designations.get('deconstruct', b.x, b.y)) return null;
        return {
          label: t('build.act.deconstruct', { name: B.displayName(b) }),
          x: b.x, y: b.y,
          hold: true,
          onHoldStart(gg, pawn) {
            if (!gg.jobs.startManual(pawn, 'build_deconstruct', { targetId: b.id, x: b.x, y: b.y })) err(gg, pawn, b.x, b.y, 'build.err.busy');
          },
          onRelease(gg, pawn) {
            if (pawn.job?.type === 'build_deconstruct' && pawn.job.manual) gg.jobs.endJob(pawn, 'cancelled');
          },
        };
      },
    },
    OWNER,
  );
}

/** Ручная подноска лидером (тап E по чертежу): отдать несомое или сходить за ближайшим материалом. */
export function manualDeliver(B, pawn, bp) {
  const game = B.game;
  const spec = findDelivery(B, pawn, bp);
  if (!spec) return false;
  // уже рядом и несём нужное — сразу
  if (spec.data.carried && Math.abs(pawn.x - (bp.x + (bp.w || 1) / 2)) <= (bp.w || 1) / 2 + 1.2 && Math.abs(pawn.y - (bp.y + (bp.h || 1) / 2)) <= (bp.h || 1) / 2 + 1.2) {
    return B.depositCarry(bp, pawn);
  }
  return game.jobs.startManual(pawn, 'build_deliver', spec);
}
