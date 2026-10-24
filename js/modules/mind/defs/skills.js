// Навыки (game.defs.skills). id совпадают с workTypes[].skill ядра (construction, mining, plants, cooking,
// medicine, crafting, shooting, intellect) + melee, magic, trade, social.
// workTypes — какие типы работ ускоряет навык (для skillFactor и «неспособен к…»).
export const SKILL_DEFS = [
  { id: 'construction', order: 10, workTypes: ['construction'], color: '#ffb86b', ru: 'Стройка', en: 'Construction' },
  { id: 'mining', order: 20, workTypes: ['mining'], color: '#8fa8ff', ru: 'Добыча', en: 'Mining' },
  { id: 'plants', order: 30, workTypes: ['cutting', 'growing'], color: '#7dff6a', ru: 'Растениеводство', en: 'Plants' },
  { id: 'cooking', order: 40, workTypes: ['cooking'], color: '#ff7a5c', ru: 'Готовка', en: 'Cooking' },
  { id: 'medicine', order: 50, workTypes: ['doctoring'], color: '#ff8fa3', ru: 'Медицина', en: 'Medicine' },
  { id: 'crafting', order: 60, workTypes: ['crafting'], color: '#ffd27a', ru: 'Ремесло', en: 'Crafting' },
  { id: 'shooting', order: 70, workTypes: ['hunting'], color: '#ff5f6d', ru: 'Стрельба', en: 'Shooting' },
  { id: 'melee', order: 80, workTypes: [], color: '#ff4f4f', ru: 'Ближний бой', en: 'Melee' },
  { id: 'magic', order: 90, workTypes: [], color: '#5ef2ff', ru: 'Магия', en: 'Magic' },
  { id: 'trade', order: 100, workTypes: [], color: '#f5ff6a', ru: 'Торговля', en: 'Trade' },
  { id: 'social', order: 110, workTypes: [], color: '#ff4fd8', ru: 'Общение', en: 'Social' },
  { id: 'intellect', order: 120, workTypes: ['research'], color: '#c77dff', ru: 'Знания', en: 'Intellect' },
];

export const PASSIONS = ['none', 'minor', 'major'];
