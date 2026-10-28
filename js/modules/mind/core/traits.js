// Черты: сводные эффекты (кэш по набору черт), выдача/скрытые черты/раскрытие, генерация.

const PRODUCT = ['workSpeed', 'joyDecay', 'foodDecay', 'restDecay', 'comfortNeed', 'beautyNeed', 'griefMul', 'smallJoyMul',
  'insultMul', 'jokeMul', 'deepMul', 'comfortMul', 'romanceMul'];

/** Синонимы, под которыми черты ищут другие модули. */
export const TRAIT_ALIASES = {
  ruthless: 'bloodthirsty', psychopath: 'bloodthirsty', kind: 'softhearted', kindhearted: 'softhearted', pampered: 'soft',
  addict: 'addictive', addiction: 'addictive', chemical_interest: 'addictive', engineer_son: 'son_of_engineer', motion_sickness: 'motion_sick',
  acrophobia: 'afraid_of_heights', widow: 'widowed', widower: 'widowed', debtor: 'runaway_debtor', cultist: 'ex_cultist',
};

function baseEffects() {
  const e = { breakShift: 0, opinionOfMe: 0, skills: {}, thoughtMul: {}, breakWeights: {}, joyWeights: {}, refuseJobs: [] };
  for (const k of PRODUCT) e[k] = 1;
  return e;
}

/** Сводные эффекты черт пешки (кэш в pawn._eff по ключу набора). */
export function traitEffects(M, pawn) {
  const list = pawn?.traits || [];
  const key = list.join(',');
  if (pawn && pawn._eff && pawn._effKey === key) return pawn._eff;
  const e = baseEffects();
  const reg = M.game.defs.traits;
  for (const id of list) {
    const def = reg.get(id);
    const x = def?.effects;
    if (!x) continue;
    for (const k of PRODUCT) if (Number.isFinite(x[k])) e[k] *= x[k];
    if (Number.isFinite(x.breakShift)) e.breakShift += x.breakShift;
    if (Number.isFinite(x.opinionOfMe)) e.opinionOfMe += x.opinionOfMe;
    for (const [s, v] of Object.entries(x.skills || {})) e.skills[s] = (e.skills[s] || 0) + v;
    for (const [s, v] of Object.entries(x.thoughtMul || {})) e.thoughtMul[s] = (e.thoughtMul[s] ?? 1) * v;
    for (const [s, v] of Object.entries(x.breakWeights || {})) e.breakWeights[s] = (e.breakWeights[s] ?? 1) * v;
    for (const [s, v] of Object.entries(x.joyWeights || {})) e.joyWeights[s] = (e.joyWeights[s] ?? 1) * v;
    if (Array.isArray(x.refuseJobs)) e.refuseJobs.push(...x.refuseJobs);
  }
  if (pawn) {
    pawn._eff = e;
    pawn._effKey = key;
  }
  return e;
}

export function hasTrait(M, pawn, id) {
  if (!pawn?.traits || !id) return false;
  if (pawn.traits.includes(id)) return true;
  const a = TRAIT_ALIASES[id];
  return !!a && pawn.traits.includes(a);
}

export function isHidden(pawn, id) {
  return Array.isArray(pawn?.hiddenTraits) && pawn.hiddenTraits.includes(id);
}

/** Дать черту. opts: {hidden, silent}. @returns {boolean} добавлена ли */
export function addTrait(M, pawn, id, opts = {}) {
  const game = M.game;
  if (!pawn || !id) return false;
  id = game.defs.traits.has(id) ? id : TRAIT_ALIASES[id] || id;
  pawn.traits ||= [];
  if (pawn.traits.includes(id)) return false;
  const def = game.defs.traits.get(id);
  // конфликтующая черта уступает новой (например, «Вдовец» не конфликтует ни с чем)
  if (def?.conflicts?.length) pawn.traits = pawn.traits.filter((t) => !def.conflicts.includes(t));
  pawn.traits.push(id);
  const hidden = opts.hidden ?? def?.hidden ?? false;
  if (hidden) {
    pawn.hiddenTraits ||= [];
    if (!pawn.hiddenTraits.includes(id) && !pawn.revealedTraits?.includes(id)) pawn.hiddenTraits.push(id);
  }
  pawn._effKey = null;
  game.events.emit('mind:traitAdded', { pawn, id, hidden: !!hidden });
  if (!opts.silent && id === 'widowed' && pawn.faction === 'colony') {
    try {
      game.api.ui.notify(game.t('mind.trait.widowed', { name: firstName(pawn) }), { type: 'bad', pawnId: pawn.id });
    } catch (err) {
      game.error(err, 'mind.addTrait');
    }
  }
  return true;
}

export function removeTrait(M, pawn, id) {
  if (!pawn?.traits) return false;
  const n = pawn.traits.length;
  pawn.traits = pawn.traits.filter((t) => t !== id);
  if (pawn.hiddenTraits) pawn.hiddenTraits = pawn.hiddenTraits.filter((t) => t !== id);
  pawn._effKey = null;
  return pawn.traits.length !== n;
}

/** Раскрыть скрытую черту. @returns {boolean} */
export function revealTrait(M, pawn, id) {
  const game = M.game;
  if (!pawn || !id) return false;
  id = game.defs.traits.has(id) ? id : TRAIT_ALIASES[id] || id;
  if (!pawn.traits?.includes(id)) addTrait(M, pawn, id, { hidden: false, silent: true });
  const was = isHidden(pawn, id);
  if (pawn.hiddenTraits) pawn.hiddenTraits = pawn.hiddenTraits.filter((t) => t !== id);
  pawn.revealedTraits ||= [];
  if (!pawn.revealedTraits.includes(id)) pawn.revealedTraits.push(id);
  if (was) {
    game.events.emit('mind:traitRevealed', { pawn, id });
    try {
      game.api.ui.notify(game.t('mind.trait.revealed', { name: firstName(pawn), trait: game.t(`mind.traits.${id}.name`) }), { type: 'info', pawnId: pawn.id, x: pawn.x, y: pawn.y });
    } catch (err) {
      game.error(err, 'mind.revealTrait');
    }
  }
  return was;
}

const firstName = (p) => String(p?.name || '???').split(' ')[0];

/** Случайные черты (2–3) по весам, без конфликтов. forced — обязательные id. */
export function rollTraits(game, rng, count, forced = []) {
  const out = [];
  const reg = game.defs.traits;
  for (const id of forced) if (reg.has(id) && !out.includes(id)) out.push(id);
  const pool = reg.all().filter((d) => d.gen !== false && !d.hidden && (d.weight ?? 1) > 0);
  let guard = 0;
  while (out.length < count && guard++ < 40) {
    const cand = pool.filter((d) => !out.includes(d.id) && !out.some((o) => d.conflicts?.includes(o) || reg.get(o)?.conflicts?.includes(d.id)));
    if (!cand.length) break;
    out.push(rng.weighted(cand, (d) => d.weight ?? 1).id);
  }
  return out;
}
