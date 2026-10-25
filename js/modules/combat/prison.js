// Пленные: взять упавшего врага (E лидера), тюремные койки, надзиратель (вербовка — навык social),
// отпустить, казнить (тяжёлый моральный выбор: мысли и авторитет через mind).
import { dist } from '../../core/math.js';
import { resKey } from '../../sim/jobs.js';
import { skillLevel } from './fight.js';
import { raidOf } from './enemies.js';
import { secs } from './state.js';
import { TICKS_PER_HOUR } from '../../core/constants.js';

export function canCapture(game, p) {
  if (!p || p.dead || p.removed || !p.downed || p.faction !== 'enemy' || p.prisoner) return false;
  const def = game.defs.enemies.get(p.enemyId);
  return !!def?.capturable;
}

function freeBeds(game) {
  const taken = new Set();
  for (const p of game.entities.ofKind('pawn')) if (p.prisoner?.bedId) taken.add(p.prisoner.bedId);
  const out = [];
  for (const b of game.entities.ofKind('building')) {
    if (b.blueprint || taken.has(b.id)) continue;
    if (game.defs.buildings.get(b.defId)?.prisonerBed) out.push(b);
  }
  return out;
}

export function installPrison(game, C) {
  C.assignPrisonerBed = (p) => {
    const beds = freeBeds(game);
    if (!beds.length) return null;
    beds.sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y));
    p.prisoner.bedId = beds[0].id;
    return beds[0];
  };
  C.freePrisonerBed = (p) => {
    if (p.prisoner) p.prisoner.bedId = 0;
  };

  /** Взять в плен. @returns {boolean} */
  C.capture = (p, by) => {
    if (!canCapture(game, p)) return false;
    const raid = raidOf(C, p);
    if (raid) raid.pawnIds = raid.pawnIds.filter((id) => id !== p.id);
    const def = game.defs.enemies.get(p.enemyId);
    p.prisoner = { since: game.time.tick, bedId: 0, mode: 'hold', resist: 40 + (def?.points || 25) * 0.5 + (p.id % 9) * 3, nextTalk: 0, origFaction: p.enemyFaction };
    p.faction = 'neutral';
    p.raidId = 0;
    p.leaving = false;
    if (p.job) game.jobs.endJob(p, 'cancelled');
    // оружие отбирают
    const eq = p.equipment || {};
    if (eq.weapon) C.dropSlot(p, 'weapon');
    // из «без сознания» — на ноги (в заглушке здоровья: подлечить до трети)
    if (!game.providers.health?.applyDamage) {
      p.downed = false;
      const h = p.health;
      if (h) h.hp = Math.max(h.hp, h.maxHp * 0.3);
    }
    const bed = C.assignPrisonerBed(p);
    game.api.ui.notify(game.t(bed ? 'combat.prison.captured' : 'combat.prison.capturedNoBed', { name: p.name }), { type: bed ? 'good' : 'bad', pawnId: p.id });
    game.events.emit('combat:captured', { pawn: p, by: by || null });
    if (by) game.api.mind.addAuthority(1, 'capture');
    return true;
  };

  C.setPrisonerMode = (p, mode) => {
    if (!p?.prisoner) return false;
    if (mode === 'release') return C.releasePrisoner(p);
    if (mode === 'execute') return C.executePrisoner(p);
    p.prisoner.mode = mode === 'recruit' ? 'recruit' : 'hold';
    return true;
  };

  C.releasePrisoner = (p) => {
    if (!p?.prisoner) return false;
    p.prisoner.mode = 'release';
    p.prisoner.bedId = 0;
    p.leaving = true;
    if (p.job) game.jobs.endJob(p, 'cancelled');
    game.api.mind.addAuthority(2, 'releasePrisoner');
    for (const c of C.R.colony) game.api.mind.addThought(c, 'prisoner_released', { otherPawnId: p.id });
    game.api.ui.notify(game.t('combat.prison.released', { name: p.name }), { type: 'info', pawnId: p.id });
    game.events.emit('combat:prisonerReleased', { pawn: p });
    return true;
  };

  /** Казнь — тяжёлый выбор: мысли у всех, удар по авторитету. */
  C.executePrisoner = (p) => {
    if (!p?.prisoner || p.dead) return false;
    const L = game.getLeader();
    const name = p.name;
    C.S.stats.executions++;
    for (const c of C.R.colony) {
      const ruthless = game.api.mind.hasTrait(c, 'ruthless') || game.api.mind.hasTrait(c, 'psychopath');
      game.api.mind.addThought(c, ruthless ? 'execution_justice' : 'witnessed_execution', { otherPawnId: p.id, source: L });
    }
    game.api.mind.addAuthority(-6, 'execution');
    p.prisoner.mode = 'executed';
    game.api.health.kill(p, 'execution', { source: L || null });
    game.api.ui.notify(game.t('combat.prison.executed', { name }), { type: 'danger' });
    game.events.emit('combat:prisonerExecuted', { name, leader: L || null });
    return true;
  };

  /** Удачная вербовка. */
  C.recruit = (p, by) => {
    if (!p?.prisoner) return false;
    p.prisoner = null;
    p.faction = 'colony';
    p.enemyId = null;
    p.drawAs = null;
    p.raidId = 0;
    p.leaving = false;
    p.workPriorities = game.jobs.defaultPriorities();
    p.needs ||= {};
    p.needs.food ??= 0.7;
    p.needs.rest ??= 0.7;
    if (p.job) game.jobs.endJob(p, 'cancelled');
    C.S.stats.recruited++;
    game.api.ui.notify(game.t('combat.prison.recruited', { name: p.name, by: by?.name || '' }), { type: 'good', pawnId: p.id });
    game.events.emit('combat:recruited', { pawn: p, by: by || null });
    if (by) game.api.mind.addThought(by, 'recruited_prisoner', { otherPawnId: p.id });
    return true;
  };

  // --- надзиратель ---
  if (!game.defs.workTypes.has('warden')) {
    game.jobs.registerWorkType({ id: 'warden', nameKey: 'combat.work.warden', order: 15, skill: 'social', defaultPriority: 3 }, 'combat');
  }
  game.jobs.registerJobType({
    id: 'combat:warden',
    workType: 'warden',
    labelKey: 'combat.job.warden',
    priority: 55,
    adjacent: true,
    findJob(g, w) {
      if (!C.R.prisoners) return null;
      const now = g.time.tick;
      for (const p of g.entities.ofKind('pawn')) {
        const pr = p.prisoner;
        if (!pr || pr.mode !== 'recruit' || pr.nextTalk > now || p.dead) continue;
        if (g.jobs.isReserved(resKey.entity(p.id), w)) continue;
        if (!g.pathfinder.canReach(w.x, w.y, Math.floor(p.x), Math.floor(p.y), true)) continue;
        return { targetId: p.id, x: Math.floor(p.x), y: Math.floor(p.y) };
      }
      return null;
    },
    makeToils: (g, w, job) => [
      { type: 'goto', targetId: job.targetId, adjacent: true },
      {
        type: 'work',
        ticks: 240,
        workType: 'warden',
        targetId: job.targetId,
        onDone(g2, pawn, j) {
          const p = g2.entities.get(j.targetId);
          if (!p?.prisoner) return 'failed';
          const social = skillLevel(g2, pawn, 'social');
          const pr = p.prisoner;
          pr.nextTalk = g2.time.tick + TICKS_PER_HOUR * 6;
          pr.resist = Math.max(0, pr.resist - (4 + social * 1.3));
          g2.api.mind.learn(pawn, 'social', 30);
          const chance = pr.resist <= 0 ? 0.35 + social * 0.03 : 0.02 + social * 0.006;
          if (g2.rng.next() < chance) C.recruit(p, pawn);
          else g2.api.mind.say(p, g2.t('combat.prison.refuse', { variant: g2.time.tick + p.id }));
          return undefined;
        },
      },
    ],
  }, 'combat');
}

/** Раз в час: пленных кормят (упрощение), в заглушке здоровья подлечивают. */
export function hourlyPrisoners(game, C) {
  if (!C.R.prisoners) return;
  for (const p of game.entities.ofKind('pawn')) {
    if (!p.prisoner || p.dead) continue;
    if (p.needs) {
      if ('food' in p.needs) p.needs.food = Math.max(p.needs.food, 0.6);
      if ('rest' in p.needs) p.needs.rest = Math.max(p.needs.rest, 0.6);
    }
    if (!p.prisoner.bedId) C.assignPrisonerBed(p);
  }
}

export { secs };
