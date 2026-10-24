// Строки ядра (ru — основной, en — запасной). Модули добавляют свои через game.i18n.add(lang, table)
// с префиксом модуля: { combat: { spell: { fireball: 'Огненный шар' } } } → 'combat.spell.fireball'.

export const RU = {
  game: { title: 'Последний поезд', subtitle: 'Колония на рунных рельсах' },
  terrain: { grass: 'Трава', dirt: 'Земля', stone: 'Каменистая земля', water: 'Вода', sand: 'Песок', snow: 'Снег', ash: 'Пепел' },
  floor: { none: '—', wagon_planks: 'Доски вагона', wood_floor: 'Деревянный пол', stone_tiles: 'Каменная плитка' },
  item: {
    wood: 'Дерево', stone: 'Камень', iron_ore: 'Железная руда', mana_crystal: 'Кристалл маны', berries: 'Ягоды',
    meat_raw: 'Сырое мясо', ration: 'Сухпаёк', meal_simple: 'Простая еда', medicine_herbal: 'Травяное лекарство', cloth: 'Ткань',
  },
  plant: { tree_pine: 'Сосна', tree_birch: 'Берёза', tree_oak: 'Дуб', bush_berry: 'Ягодный куст', glowcap: 'Светогриб' },
  building: {
    rock: 'Скала', ore_iron: 'Железная жила', mana_vein: 'Жила маны',
    wagon_wall: 'Стенка вагона', wagon_window: 'Окно вагона', wagon_door: 'Дверь вагона', mana_engine: 'Мана-двигатель',
  },
  wagon: {
    locomotive: 'Локомотив', residential: 'Жилой вагон', kitchen: 'Кухня', storage: 'Склад', workshop: 'Мастерская',
    greenhouse: 'Теплица', infirmary: 'Лазарет', battle: 'Боевой вагон', hearse: 'Катафалк', unknown: 'Вагон',
  },
  biome: { forest: 'Лес Шёпота' },
  station: { start: 'Полустанок у Леса Шёпота' },
  zone: { stockpile: 'Склад' },
  designation: { chop: 'Срубить', harvest: 'Собрать', mine: 'Добыть' },
  work: {
    doctoring: 'Лечение', construction: 'Стройка', mining: 'Добыча', cutting: 'Рубка', growing: 'Растения',
    cooking: 'Готовка', hunting: 'Охота', crafting: 'Ремесло', hauling: 'Переноска', cleaning: 'Уборка', research: 'Исследования',
  },
  job: {
    chop: 'рубит дерево', harvest: 'собирает урожай', mine: 'добывает камень', wander: 'бродит', idle: 'отдыхает',
    goto: 'идёт', haul: 'несёт на склад', eat: 'ест', sleep: 'спит', flee: 'убегает!',
  },
  act: {
    chop: 'Срубить: {name}', harvest: 'Собрать: {name}', mine: 'Добыть: {name}', eat: 'Съесть: {name}',
    pickup: 'Взять: {name} ×{count}', drop: 'Бросить: {name}', store: 'Положить на склад: {name}', sleep: 'Лечь спать',
  },
  health: { ok: 'Здоров', hurt: 'Ранен', critical: 'При смерти' },
  needs: { food: 'Сытость', rest: 'Бодрость' },
  colony: {
    heir: '{dead} погиб. Власть переходит к наследнику: {heir}.',
    lost: 'Последний поезд опустел. Никого не осталось.',
    defaultName: 'Последний поезд',
  },
  scenario: {
    standard: { name: 'Последний поезд', desc: 'Маг-проводник и четверо поселенцев, полный состав и скромные запасы.' },
  },
  difficulty: {
    easy: { name: 'Мирный', desc: 'Редкие угрозы, щадящие события. Для стройки и историй.' },
    normal: { name: 'Обычный', desc: 'Задуманный баланс: тяжело, но честно.' },
    hard: { name: 'Тяжёлый', desc: 'Рейды чаще и злее, ошибки дорого стоят.' },
    brutal: { name: 'Жестокий', desc: 'Частые рейды и беды. Гниль не ждёт.' },
  },
  save: { failed: 'Не удалось сохранить: хранилище браузера переполнено или недоступно.' },
  hint: {
    start: 'WASD — идти, E — действие рядом. Зажмите C и выделите деревья мышью — поселенцы срубят их.',
    designate: 'C + ЛКМ — пометить (рубить/собрать/добыть), C + ПКМ — снять',
  },
  hud: {
    day: 'День {day}', paused: 'ПАУЗА', hungry: 'Вы голодны — подойдите к еде и нажмите E', tired: 'Вы устали — лягте спать в вагоне (E)', leader: 'Лидер', heir: 'Наследник', carrying: 'Несёт: {name} ×{count}',
    controls: 'WASD идти · E действие · C+мышь пометить · Пробел пауза · +/− скорость · колесо зум · F9 отладка',
    seasons: { spring: 'весна', summer: 'лето', autumn: 'осень', winter: 'зима' },
  },
  tt: {
    job: 'Занят: {job}', asleep: 'Спит', carrying: 'Несёт: {name} ×{count}', count: '{name} ×{count}',
    designated: 'Помечено: {what}', growth: 'Созрело: {pct}%', ripe: 'Ягоды созрели', stored: 'на складе', leader: 'Лидер (вы)',
    corpse: 'Тело: {name}', roofed: 'под крышей', inWagon: '{wagon}',
  },
  input: {
    up: 'Вверх', down: 'Вниз', left: 'Влево', right: 'Вправо', interact: 'Действие', designate: 'Пометки (временно)',
    orders: 'Приказы', call_to_arms: 'К оружию!', spell1: 'Заклинание 1', spell2: 'Заклинание 2', spell3: 'Заклинание 3', spell4: 'Заклинание 4',
    attack: 'Атака', dash: 'Рывок', pause: 'Пауза', faster: 'Быстрее', slower: 'Медленнее', speed1: 'Скорость 1', speed2: 'Скорость 2',
    speed3: 'Скорость 3', debug: 'Отладка', back: 'Назад / меню', horn: 'Гудок', regUp: 'Регулятор +', regDown: 'Регулятор −',
  },
};

export const EN = {
  game: { title: 'The Last Train', subtitle: 'A colony on rune rails' },
  terrain: { grass: 'Grass', dirt: 'Dirt', stone: 'Rocky ground', water: 'Water', sand: 'Sand', snow: 'Snow', ash: 'Ash' },
  floor: { none: '—', wagon_planks: 'Wagon planks', wood_floor: 'Wood floor', stone_tiles: 'Stone tiles' },
  item: {
    wood: 'Wood', stone: 'Stone', iron_ore: 'Iron ore', mana_crystal: 'Mana crystal', berries: 'Berries',
    meat_raw: 'Raw meat', ration: 'Ration', meal_simple: 'Simple meal', medicine_herbal: 'Herbal medicine', cloth: 'Cloth',
  },
  plant: { tree_pine: 'Pine', tree_birch: 'Birch', tree_oak: 'Oak', bush_berry: 'Berry bush', glowcap: 'Glowcap' },
  building: {
    rock: 'Rock', ore_iron: 'Iron vein', mana_vein: 'Mana vein',
    wagon_wall: 'Wagon wall', wagon_window: 'Wagon window', wagon_door: 'Wagon door', mana_engine: 'Mana engine',
  },
  wagon: {
    locomotive: 'Locomotive', residential: 'Living car', kitchen: 'Kitchen', storage: 'Storage', workshop: 'Workshop',
    greenhouse: 'Greenhouse', infirmary: 'Infirmary', battle: 'Battle car', hearse: 'Hearse', unknown: 'Car',
  },
  biome: { forest: 'Whispering Woods' },
  station: { start: 'Whispering Woods halt' },
  zone: { stockpile: 'Stockpile' },
  designation: { chop: 'Chop', harvest: 'Harvest', mine: 'Mine' },
  work: {
    doctoring: 'Doctor', construction: 'Construct', mining: 'Mine', cutting: 'Cut', growing: 'Grow',
    cooking: 'Cook', hunting: 'Hunt', crafting: 'Craft', hauling: 'Haul', cleaning: 'Clean', research: 'Research',
  },
  job: {
    chop: 'chopping a tree', harvest: 'harvesting', mine: 'mining', wander: 'wandering', idle: 'idling',
    goto: 'walking', haul: 'hauling', eat: 'eating', sleep: 'sleeping', flee: 'fleeing!',
  },
  act: {
    chop: 'Chop: {name}', harvest: 'Harvest: {name}', mine: 'Mine: {name}', eat: 'Eat: {name}',
    pickup: 'Pick up: {name} ×{count}', drop: 'Drop: {name}', store: 'Store: {name}', sleep: 'Go to sleep',
  },
  health: { ok: 'Healthy', hurt: 'Wounded', critical: 'Dying' },
  needs: { food: 'Food', rest: 'Rest' },
  colony: {
    heir: '{dead} has died. Leadership passes to the heir: {heir}.',
    lost: 'The Last Train is empty. No one is left.',
    defaultName: 'The Last Train',
  },
  scenario: {
    standard: { name: 'The Last Train', desc: 'The mage conductor, four colonists, a full consist and modest supplies.' },
  },
  difficulty: {
    easy: { name: 'Peaceful', desc: 'Rare threats, gentle events. For building and stories.' },
    normal: { name: 'Normal', desc: 'The intended balance: hard but fair.' },
    hard: { name: 'Hard', desc: 'Raids come more often and hit harder; mistakes cost.' },
    brutal: { name: 'Brutal', desc: 'Frequent raids and disasters. The Rot does not wait.' },
  },
  save: { failed: 'Could not save: browser storage is full or unavailable.' },
  hint: {
    start: 'WASD to walk, E to act. Hold C and drag over trees — colonists will chop them.',
    designate: 'C + LMB — designate (chop/harvest/mine), C + RMB — clear',
  },
  hud: {
    day: 'Day {day}', paused: 'PAUSED', hungry: 'You are hungry — walk to food and press E', tired: 'You are tired — sleep inside a wagon (E)', leader: 'Leader', heir: 'Heir', carrying: 'Carrying: {name} ×{count}',
    controls: 'WASD walk · E act · C+mouse designate · Space pause · +/− speed · wheel zoom · F9 debug',
    seasons: { spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' },
  },
  tt: {
    job: 'Busy: {job}', asleep: 'Asleep', carrying: 'Carrying: {name} ×{count}', count: '{name} ×{count}',
    designated: 'Designated: {what}', growth: 'Grown: {pct}%', ripe: 'Berries are ripe', stored: 'stored', leader: 'Leader (you)',
    corpse: 'Corpse: {name}', roofed: 'roofed', inWagon: '{wagon}',
  },
  input: {
    up: 'Up', down: 'Down', left: 'Left', right: 'Right', interact: 'Interact', designate: 'Designate (temp)',
    orders: 'Orders', call_to_arms: 'Call to arms!', spell1: 'Spell 1', spell2: 'Spell 2', spell3: 'Spell 3', spell4: 'Spell 4',
    attack: 'Attack', dash: 'Dash', pause: 'Pause', faster: 'Faster', slower: 'Slower', speed1: 'Speed 1', speed2: 'Speed 2',
    speed3: 'Speed 3', debug: 'Debug', back: 'Back / menu', horn: 'Horn', regUp: 'Regulator +', regDown: 'Regulator −',
  },
};

export function registerCoreStrings(game) {
  game.i18n.add('ru', RU);
  game.i18n.add('en', EN);
}
