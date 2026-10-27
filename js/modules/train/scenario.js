// Сценарии старта (MVP: только «Трое выживших» — старт по умолчанию). Остальные 4 — после MVP.

export const START_COAL = 72;

export const SCENARIOS = [
  {
    id: 'three_survivors', order: 10, nameKey: 'train.scen.three.name', descKey: 'train.scen.three.desc',
    difficulty: 'normal', rerolls: 1, colonists: 2,
    // с хвоста к голове, локомотив последним
    consist: ['residential', 'storage', 'tender', 'locomotive'],
    // еда ≈ на 10 дней для троих (1,5 сытости в сутки; сухпаёк 0,8)
    items: [['ration', 50], ['ration', 8], ['berries', 30], ['medicine_herbal', 6], ['wood', 40], ['cloth', 10], ['stone', 20]],
    silver: 0,
    rotGapHours: 30,
    engine: 'steam',
    flags: {},
    apply(game, opts, ctx) {
      // уголь — в тендер (на 2 перегона)
      const tender = ctx.train.carOfType('tender');
      const cells = tender ? ctx.train.interior(tender) : [];
      const c = cells[Math.floor(cells.length / 2)] || ctx.train.center();
      if (c) game.items.spawn('coal', START_COAL, Math.floor(c.x), Math.floor(c.y));
    },
  },
];

export function registerScenarios(game) {
  for (const s of SCENARIOS) if (!game.defs.scenarios.has(s.id)) game.defs.scenarios.add(s, 'train');
}
